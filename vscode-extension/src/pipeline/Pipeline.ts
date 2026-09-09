/**
 * `Pipeline`: the real `PipelineFacade` (S3.5, replacing `NotWiredPipeline`).
 *
 * Wires source capture (`src/sources`) → `parseMarkdown`/`segment` or plain
 * sentence splitting → `buildSession` (narrator disabled, `NoNarrator` — CdC
 * mode "narrated" profiles degrade to faithful reading until phase 4's
 * `OllamaNarrator`) → `PlaybackController` with a `WebviewAudioSink` (or the
 * test-only `FakeAudioSink` injected by `extension.ts`) → `HighlightController`
 * on `onChunkChange` → the status bar on `onStateChange` → the player's
 * `state` snapshot on `onProgress`.
 *
 * Every `TtsProvider` call goes through an `EgressGuardHandle` built from
 * `llmVoice.privacy.localOnly` / `llmVoice.network.trustedHosts` /
 * `LLM_VOICE_STRICT_LOCAL` (ADR-010): synthesis failures never throw past this
 * class — a chunk that fails after `AudioQueue`'s retries surfaces as
 * "LLM Voice: TTS unavailable" with Retry / Open provider settings, and the
 * status bar switches to `error`, never an unhandled rejection.
 */

import * as path from "node:path";
import * as vscode from "vscode";
import packageJson from "../../package.json";
import type { CaptureContext, SourceAdapter, SourceDocument, SourceSegment } from "../core/source.js";
import type { VoiceProfile } from "../core/profile.js";
import { isRemoteProfile } from "../core/profile.schema.js";
import type { NarratorProvider } from "../core/narration.js";
import type { TtsProvider } from "../core/tts.js";
import type { ProviderHealth } from "../core/health.js";
import { redactSecrets } from "../core/redact.js";
import type { MarkdownPolicy, SegmentationPolicy } from "../parser/types.js";
import { parseMarkdown } from "../parser/MarkdownParser.js";
import { segment } from "../parser/Segmenter.js";
import {
  buildSession,
  DiskAudioCache,
  PlaybackController,
  type AudioSink,
  type ChunkErrorDecision,
  type NarrationWarning,
  type PlaybackErrorInfo,
  type SessionBuild
} from "../playback/index.js";
import {
  createEgressGuard,
  verifyLocalMode as computeVerifyLocalMode,
  type EgressGuardHandle,
  type EgressMode,
  type VerifyLocalModeInputs,
  type VerifyLocalModeResult
} from "../net/index.js";
import { HighlightController } from "../highlight/HighlightController.js";
import { PlayerViewProvider } from "../views/player/PlayerViewProvider.js";
import { StatusBar, type StatusBarPlaybackState, type StatusBarViewModel } from "../ui/StatusBar.js";
import { formatProviderHealthQuickPickItem, titleCaseProviderId } from "../ui/providerStatusText.js";
import { ClipboardSource, MarkdownDocumentSource, TextSelectionSource, readCaptureRange } from "../sources/index.js";
import {
  ProfileRepository,
  apiKeySecretKey,
  collectRemoteProviderIds,
  formatProfileQuickPickItem,
  type BySourceSetting
} from "../profiles/index.js";
import {
  createTtsProvider,
  presetKindForProviderId,
  probeHealth,
  TtsProviderRegistry,
  type HealthCheckable
} from "../tts/index.js";
import { createNarratorProvider } from "../narrator/index.js";
import type { PipelineFacade } from "../commands/PipelineFacade.js";
import { plainTextSegments, rangesOverlap } from "./textSegments.js";
import {
  resolveNarratorConfig,
  resolveTtsConfig,
  type NarratorSettings,
  type TtsSettings
} from "./resolveProviderConfig.js";

const ERROR_TTS_UNAVAILABLE = "LLM Voice: TTS unavailable";
const ERROR_NARRATOR_UNAVAILABLE = "LLM Voice: Narrator unavailable";

/**
 * Mirrors `package.json#llmVoice.testVoice.text`'s default (CdC §50's French
 * example) — duplicated rather than read back from `package.json` at
 * runtime, same tradeoff as `narrator.model`'s `qwen2.5:7b` default just
 * above it.
 */
const DEFAULT_TEST_VOICE_TEXT =
  "Bonjour. Voici un exemple de ma voix. Nous allons maintenant examiner un concept technique " +
  "et voir comment l'expliquer clairement.";

/** `LLM Voice: Provider Status` (CdC §51) reuses a probe for 30s before re-querying providers. */
const HEALTH_CACHE_TTL_MS = 30_000;

interface ProviderHealthEntry {
  label: string;
  health: ProviderHealth;
}

const DEFAULT_MARKDOWN_POLICY: MarkdownPolicy = {
  headings: "read",
  links: "labelOnly",
  images: "skip",
  code: "skip",
  tables: "summarize",
  frontmatter: "skip"
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function segmentationPolicyFor(profile: VoiceProfile): SegmentationPolicy {
  return {
    mode: profile.chunking.unit,
    maxSentencesPerChunk: profile.chunking.maxSentences,
    markdown: DEFAULT_MARKDOWN_POLICY,
    lang: profile.language
  };
}

function toStatusBarState(state: string): StatusBarPlaybackState {
  switch (state) {
    case "playing":
    case "paused":
    case "preparing":
    case "buffering":
    case "stale":
    case "error":
      return state;
    default:
      return "idle";
  }
}

export interface PipelineOptions {
  context: vscode.ExtensionContext;
  output: vscode.OutputChannel;
  highlight: HighlightController;
  player: PlayerViewProvider;
  statusBar: StatusBar;
  /** Test-only: replaces `player.audioSink` (webviews don't decode audio under xvfb). */
  sinkOverride?: AudioSink;
  /** Test-only: replaces the real `OpenAICompatibleTtsProvider`. */
  ttsProviderOverride?: TtsProvider;
  /** Test-only: replaces the narrator `createNarratorProvider` would build. */
  narratorProviderOverride?: NarratorProvider;
}

export class Pipeline implements PipelineFacade {
  private readonly context: vscode.ExtensionContext;
  private readonly output: vscode.OutputChannel;
  private readonly highlight: HighlightController;
  private readonly player: PlayerViewProvider;
  private readonly statusBar: StatusBar;
  private readonly sinkOverride: AudioSink | undefined;
  private readonly ttsProviderOverride: TtsProvider | undefined;
  private readonly narratorProviderOverride: NarratorProvider | undefined;

  private readonly egress: EgressGuardHandle;
  private readonly registry = new TtsProviderRegistry<TtsProvider>();
  private readonly narratorRegistry = new TtsProviderRegistry<NarratorProvider>();
  private readonly diskCache: DiskAudioCache;
  private readonly profiles: ProfileRepository;
  private readonly controller: PlaybackController;
  private readonly sources: readonly SourceAdapter[];

  private currentUri: vscode.Uri | undefined;
  private currentProfileLabel = "—";
  private lastCaptureContext: CaptureContext | undefined;
  private captureAbort: AbortController | undefined;
  private narratorWarningShown = false;
  /** Every API key value read from `SecretStorage` this session (redaction, AC-SEC-07/08). */
  private readonly knownSecrets = new Set<string>();
  private cachedLocalModeResult: VerifyLocalModeResult | undefined;
  private healthCache: { entries: readonly ProviderHealthEntry[]; expiresAt: number } | undefined;
  /**
   * Set once "Read without narration" is chosen (CdC §52); every session
   * built after that point starts pre-forced to faithful reading, so the
   * choice sticks for the rest of the VS Code session — not just the
   * document being read when the user answered — until the extension is
   * reloaded or a narrator profile is explicitly re-selected via Retry.
   */
  private narrationDisabledForSession = false;
  private currentSessionBuild: SessionBuild | undefined;

  constructor(options: PipelineOptions) {
    this.context = options.context;
    this.output = options.output;
    this.highlight = options.highlight;
    this.player = options.player;
    this.statusBar = options.statusBar;
    this.sinkOverride = options.sinkOverride;
    this.ttsProviderOverride = options.ttsProviderOverride;
    this.narratorProviderOverride = options.narratorProviderOverride;

    this.egress = createEgressGuard({
      mode: this.egressMode(),
      trustedHosts: this.trustedHosts(),
      strictLocal: process.env.LLM_VOICE_STRICT_LOCAL === "1",
      logger: (event) => {
        this.log(
          `[egress] ${event.decision} ${event.method} ${event.host}${event.path}${event.reason ? ` (${event.reason})` : ""}`
        );
      }
    });

    this.diskCache = new DiskAudioCache({
      root: vscode.Uri.joinPath(this.context.globalStorageUri, "cache").fsPath,
      maxSizeMb: vscode.workspace.getConfiguration("llmVoice").get<number>("cache.maxSizeMb", 512)
    });

    this.profiles = new ProfileRepository(this.context.globalStorageUri.fsPath, this.context.globalState);

    this.sources = [new MarkdownDocumentSource(), new TextSelectionSource(), new ClipboardSource()];

    this.controller = new PlaybackController({
      cache: this.diskCache,
      onChunkError: (info) => this.handleChunkError(info)
    });
    this.controller.onChunkChange((change) => {
      if (this.currentUri !== undefined) {
        this.highlight.show(this.currentUri, change.chunk.sourceRanges);
      }
      this.pushPlayerState();
    });
    this.controller.onStateChange((change) => {
      this.statusBar.update(this.statusBarModel(change.state));
      if (change.state === "stopped" && this.currentUri !== undefined) {
        this.highlight.clear(this.currentUri);
      }
      this.pushPlayerState();
    });
    this.controller.onProgress(() => this.pushPlayerState());

    // Recomputes the 🔒/☁ badge at startup and whenever a relevant setting
    // changes (ADR-010/ADR-011: never a stale green from before the user
    // flipped `privacy.localOnly` or edited a provider `baseUrl`).
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("llmVoice")) {
          void this.refreshLocalModeBadge();
        }
      })
    );

    void this.initStatusBar();
  }

  /** Writes to the Output Channel with every known secret redacted (AC-SEC-07/08). */
  private log(message: string): void {
    this.output.appendLine(redactSecrets(message, [...this.knownSecrets]));
  }

  // --------------------------------------------------------- test inspection

  /**
   * `PlaybackController.getState()`, surfaced so integration tests (AC-01:
   * "état playing observable via une API de test exportée par activate()")
   * can assert playback actually started without depending on `statusBar`
   * text formatting. Not part of `PipelineFacade`; only `ExtensionTestApi`
   * (dev/test mode) casts to reach it.
   */
  getPlaybackState(): string {
    return this.controller.getState();
  }

  /**
   * Total chunks of the running session (AC-06: "Speak Selection ne lit que
   * la sélection" is best proven by chunk *count*, not by
   * `FakeTtsProvider.requests`, which a disk-cache hit from an earlier
   * "document" session can legitimately skip — ADR-004's cache is keyed on
   * spoken text, not on which capture scope produced it).
   */
  getTotalChunks(): number {
    return this.controller.getChunks().length;
  }

  getCurrentChunkIndex(): number {
    return this.controller.getCurrentIndex();
  }

  // ------------------------------------------------------------- lifecycle

  dispose(): void {
    this.controller.dispose();
    this.captureAbort?.abort();
  }

  // ---------------------------------------------------------------- start

  async start(captureContext: CaptureContext): Promise<void> {
    this.lastCaptureContext = captureContext;
    this.captureAbort?.abort();
    const abort = new AbortController();
    this.captureAbort = abort;
    this.narratorWarningShown = false;

    try {
      const source = this.sources.find((candidate) => candidate.canCapture(captureContext));
      if (source === undefined) {
        void vscode.window.showWarningMessage("LLM Voice : aucune source disponible pour cette action.");
        return;
      }

      const doc = await source.capture(captureContext, abort.signal);
      const profile = await this.profiles.getSelected(doc.sourceType, this.bySourceSettings());
      this.currentProfileLabel = profile.label;
      const segments = await this.buildSegments(doc, profile);

      if (segments.length === 0) {
        void vscode.window.showInformationMessage("LLM Voice : rien à lire pour cette sélection.");
        return;
      }

      // "Read without narration" (CdC §52) sticks for the rest of the VS
      // Code session: once set, no later `start()` — this document or the
      // next one — resolves or calls a narrator again, until Retry clears it.
      const narrator =
        profile.mode === "narrated" && !this.narrationDisabledForSession
          ? await this.narratorFor(profile)
          : undefined;
      const build = await buildSession(segments, profile, narrator, {
        signal: abort.signal,
        onWarning: (warning) => this.handleNarratorWarning(warning)
      });
      this.currentSessionBuild = build;
      const tts = await this.ttsFor(profile);
      const sink = this.sinkOverride ?? this.player.audioSink;

      this.currentUri = doc.uri !== undefined ? vscode.Uri.parse(doc.uri) : undefined;
      this.player.reveal();

      await this.controller.start({
        segments: build.segments,
        profile,
        tts,
        sink,
        sealed: true
      });
    } catch (error) {
      this.log(`[pipeline] start failed: ${messageOf(error)}`);
      void vscode.window.showErrorMessage(`LLM Voice : ${messageOf(error)}`);
    }
  }

  private async buildSegments(doc: SourceDocument, profile: VoiceProfile): Promise<SourceSegment[]> {
    const captureRange = readCaptureRange(doc.metadata);
    const all =
      doc.sourceType === "markdown"
        ? segment(await parseMarkdown(doc.rawText, doc.uri), segmentationPolicyFor(profile))
        : plainTextSegments(doc.rawText);
    if (captureRange === undefined) {
      return all;
    }
    return all.filter((seg) => seg.sourceRange !== undefined && rangesOverlap(seg.sourceRange, captureRange));
  }

  // -------------------------------------------------------------- control

  async play(): Promise<void> {
    this.controller.resume();
  }

  async pause(): Promise<void> {
    this.controller.pause();
  }

  async stop(): Promise<void> {
    this.controller.stop();
    if (this.currentUri !== undefined) {
      this.highlight.clear(this.currentUri);
    }
  }

  async previousSegment(): Promise<void> {
    await this.controller.previous();
  }

  async nextSegment(): Promise<void> {
    await this.controller.next();
  }

  // ------------------------------------------------------------- profiles

  async selectProfile(): Promise<void> {
    const profiles = await this.profiles.list();
    const selected = await this.profiles.getSelected();
    const picked = await vscode.window.showQuickPick(
      profiles.map((profile) => formatProfileQuickPickItem(profile, profile.id === selected.id)),
      { placeHolder: "LLM Voice : choisir un profil" }
    );
    if (picked === undefined) {
      return;
    }
    await this.selectProfileById(picked.id);
  }

  /** Non-interactive selection (CdC §47); also what `selectProfile`'s Quick Pick calls into. */
  async selectProfileById(id: string): Promise<void> {
    const profiles = await this.profiles.list();
    const next = profiles.find((profile) => profile.id === id);
    if (next === undefined) {
      throw new Error(`LLM Voice : profil inconnu « ${id} ».`);
    }
    await this.profiles.select(id);
    this.currentProfileLabel = next.label;
    await this.refreshLocalModeBadge();
  }

  async openProfiles(): Promise<void> {
    await this.profiles.openInEditor();
  }

  async duplicateProfile(): Promise<void> {
    const picked = await this.pickProfile("LLM Voice : dupliquer quel profil ?");
    if (picked === undefined) {
      return;
    }
    const copy = await this.duplicateProfileById(picked.id);
    void vscode.window.showInformationMessage(`LLM Voice : profil « ${copy.label} » créé.`);
  }

  /** Test-castable, non-interactive counterpart (`ProfileRepository.duplicate`). */
  async duplicateProfileById(id: string): Promise<VoiceProfile> {
    return this.profiles.duplicate(id);
  }

  async deleteProfile(): Promise<void> {
    const picked = await this.pickProfile("LLM Voice : supprimer quel profil ?");
    if (picked === undefined) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `LLM Voice : supprimer le profil « ${picked.label} » ?`,
      { modal: true },
      "Supprimer"
    );
    if (confirm !== "Supprimer") {
      return;
    }
    await this.deleteProfileById(picked.id);
    void vscode.window.showInformationMessage("LLM Voice : profil supprimé.");
  }

  async deleteProfileById(id: string): Promise<void> {
    await this.profiles.delete(id);
  }

  async setDefaultProfile(): Promise<void> {
    const picked = await this.pickProfile("LLM Voice : profil par défaut");
    if (picked === undefined) {
      return;
    }
    await this.setDefaultProfileById(picked.id);
    void vscode.window.showInformationMessage("LLM Voice : profil par défaut mis à jour.");
  }

  async setDefaultProfileById(id: string): Promise<void> {
    await this.profiles.setDefault(id);
  }

  async importProfile(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { JSON: ["json"] },
      openLabel: "Importer"
    });
    const uri = uris?.[0];
    if (uri === undefined) {
      return;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const imported = await this.importProfileFromJson(Buffer.from(bytes).toString("utf8"));
      if (isRemoteProfile(imported)) {
        void vscode.window.showWarningMessage(
          `LLM Voice : « ${imported.label} » pointe vers un provider distant (☁ Remote provider, AC-SEC-05).`
        );
      }
      void vscode.window.showInformationMessage(`LLM Voice : profil « ${imported.label} » importé.`);
    } catch (error) {
      void vscode.window.showErrorMessage(`LLM Voice : import impossible — ${messageOf(error)}`);
    }
  }

  /** Validates against `VoiceProfileSchema` before touching `profiles.json` (AC-SEC-05). */
  async importProfileFromJson(json: string): Promise<VoiceProfile> {
    return this.profiles.import(json);
  }

  async exportProfile(): Promise<void> {
    const picked = await this.pickProfile("LLM Voice : exporter quel profil ?");
    if (picked === undefined) {
      return;
    }
    const json = await this.exportProfileToJson(picked.id);
    const uri = await vscode.window.showSaveDialog({
      filters: { JSON: ["json"] },
      defaultUri: vscode.Uri.file(`${picked.id}.json`)
    });
    if (uri === undefined) {
      return;
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(json, "utf8"));
    void vscode.window.showInformationMessage(`LLM Voice : profil exporté vers ${uri.fsPath}.`);
  }

  async exportProfileToJson(id: string): Promise<string> {
    return this.profiles.export(id);
  }

  private async pickProfile(
    placeHolder: string
  ): Promise<{ id: string; label: string } | undefined> {
    const profiles = await this.profiles.list();
    return vscode.window.showQuickPick(
      profiles.map((profile) => formatProfileQuickPickItem(profile, false)),
      { placeHolder }
    );
  }

  /** `LLM Voice: Test Voice` (CdC §50): faithful reading of a short reference text via the pipeline. */
  async testVoice(): Promise<void> {
    try {
      const profile = await this.profiles.getSelected();
      const text = vscode.workspace
        .getConfiguration("llmVoice")
        .get<string>("testVoice.text", DEFAULT_TEST_VOICE_TEXT);
      const segments: SourceSegment[] = [
        { id: "test-voice", type: "sentence", rawText: text, spokenText: text }
      ];
      // Forces faithful reading regardless of `profile.mode` — Test Voice is
      // about the TTS engine's voice/speed/exaggeration, not the narrator.
      const build = await buildSession(segments, profile, undefined, {});
      const tts = await this.ttsFor(profile);
      const sink = this.sinkOverride ?? this.player.audioSink;
      this.currentProfileLabel = profile.label;
      this.player.reveal();
      await this.controller.start({ segments: build.segments, profile, tts, sink, sealed: true });
    } catch (error) {
      this.log(`[pipeline] testVoice failed: ${messageOf(error)}`);
      void vscode.window.showErrorMessage(`LLM Voice : ${messageOf(error)}`);
    }
  }

  /** `LLM Voice: Provider Status` (CdC §51). */
  async providerStatus(): Promise<void> {
    const entries = await this.probeProviderHealth();
    const items = entries.map(({ label, health }) => formatProviderHealthQuickPickItem(label, health));
    await vscode.window.showQuickPick(items, { placeHolder: "LLM Voice : santé des providers" });
  }

  /**
   * Probes the current profile's TTS (always) and narrator (when bound)
   * providers, reusing the result for `HEALTH_CACHE_TTL_MS` unless `force`
   * (the command itself always forces a fresh probe — "rafraîchi à
   * l'ouverture", CdC §51 — the cache exists for cheaper, more frequent
   * callers such as a future status-bar poll).
   */
  private async probeProviderHealth(force = true): Promise<readonly ProviderHealthEntry[]> {
    const now = Date.now();
    if (!force && this.healthCache !== undefined && this.healthCache.expiresAt > now) {
      return this.healthCache.entries;
    }
    const profile = await this.profiles.getSelected();
    const resolvedTts = resolveTtsConfig(profile.tts, this.ttsSettings());
    const tts = await this.ttsFor(profile);
    const providers: { label: string; provider: HealthCheckable }[] = [
      { label: titleCaseProviderId(resolvedTts.providerId), provider: tts }
    ];
    if (profile.narrator !== undefined) {
      const resolvedNarrator = resolveNarratorConfig(profile.narrator, this.narratorSettings());
      const narrator = await this.narratorFor(profile);
      if (resolvedNarrator !== undefined && narrator !== undefined) {
        providers.push({ label: titleCaseProviderId(resolvedNarrator.providerId), provider: narrator });
      }
    }
    const healths = await probeHealth(providers.map((entry) => entry.provider));
    const entries: ProviderHealthEntry[] = providers.map((entry, index) => ({
      label: entry.label,
      health: healths[index] as ProviderHealth
    }));
    this.healthCache = { entries, expiresAt: now + HEALTH_CACHE_TTL_MS };
    return entries;
  }

  /** Test hook: last `probeProviderHealth` result, without re-probing. */
  getCachedProviderHealth(): readonly ProviderHealthEntry[] | undefined {
    return this.healthCache?.entries;
  }

  // ---------------------------------------------------------------- secrets

  /** `LLM Voice: Set Provider API Key` (AC-17). */
  async setProviderApiKey(): Promise<void> {
    const providerId = await this.pickRemoteProviderId("LLM Voice : provider distant");
    if (providerId === undefined) {
      return;
    }
    const value = await vscode.window.showInputBox({
      prompt: `Clé API pour « ${providerId} »`,
      password: true,
      ignoreFocusOut: true
    });
    if (value === undefined || value.length === 0) {
      return;
    }
    await this.setProviderApiKeyValue(providerId, value);
    void vscode.window.showInformationMessage(`LLM Voice : clé API enregistrée pour « ${providerId} ».`);
  }

  /** Non-interactive: stores directly in `SecretStorage`, never `globalState` (AC-SEC-08). */
  async setProviderApiKeyValue(providerId: string, value: string): Promise<void> {
    this.knownSecrets.add(value);
    await this.context.secrets.store(apiKeySecretKey(providerId), value);
  }

  /** `LLM Voice: Clear Provider API Key` (AC-17). */
  async clearProviderApiKey(): Promise<void> {
    const providerId = await this.pickRemoteProviderId("LLM Voice : effacer la clé de quel provider ?");
    if (providerId === undefined) {
      return;
    }
    await this.clearProviderApiKeyValue(providerId);
    void vscode.window.showInformationMessage(`LLM Voice : clé API effacée pour « ${providerId} ».`);
  }

  async clearProviderApiKeyValue(providerId: string): Promise<void> {
    await this.context.secrets.delete(apiKeySecretKey(providerId));
  }

  private async pickRemoteProviderId(placeHolder: string): Promise<string | undefined> {
    const profiles = await this.profiles.list();
    const candidates = collectRemoteProviderIds(profiles);
    return vscode.window.showQuickPick(candidates, { placeHolder });
  }

  /** `llmVoice.profiles.bySource` (CdC §47). */
  private bySourceSettings(): BySourceSetting {
    return vscode.workspace.getConfiguration("llmVoice").get<BySourceSetting>("profiles.bySource", {});
  }

  // ------------------------------------------------------------------ misc

  async clearAudioCache(): Promise<void> {
    await this.diskCache.clear();
    void vscode.window.showInformationMessage("LLM Voice : cache audio vidé.");
  }

  async verifyLocalMode(): Promise<void> {
    const profile = await this.profiles.getSelected();
    const result = await this.computeLocalModeResult(profile);
    this.statusBar.update(this.statusBarModel(this.controller.getState()));

    const items = result.checks.map((check) => ({
      label: `${check.status === "ok" ? "$(check)" : check.status === "warn" ? "$(warning)" : check.status === "unverifiable" ? "$(question)" : "$(error)"} ${check.label}`,
      detail: check.detail
    }));
    await vscode.window.showQuickPick(items, {
      placeHolder: result.badge === "local" ? "$(lock) Mode local vérifié" : "$(warning) Mode local non vérifié"
    });
  }

  /**
   * The ten ADR-010 checks for `profile`, cached in `cachedLocalModeResult`
   * for the status bar badge (`statusBarModel`) — computed at startup and on
   * every relevant configuration change (`refreshLocalModeBadge`), and
   * whenever `verifyLocalMode()`/`selectProfileById` run.
   */
  private async computeLocalModeResult(profile: VoiceProfile): Promise<VerifyLocalModeResult> {
    const resolvedTts = resolveTtsConfig(profile.tts, this.ttsSettings());
    const resolvedNarrator = resolveNarratorConfig(profile.narrator, this.narratorSettings());
    const inputs: VerifyLocalModeInputs = {
      ttsBaseUrl: resolvedTts.baseUrl,
      ...(resolvedNarrator !== undefined ? { narratorBaseUrl: resolvedNarrator.baseUrl } : {}),
      egressMode: this.egressMode(),
      strictLocalEnv: process.env.LLM_VOICE_STRICT_LOCAL === "1",
      trustedHosts: this.trustedHosts(),
      trustedHostsConfirmed: this.trustedHosts().length > 0,
      // ADR-001 fixes `connect-src 'none'` in the player's CSP unconditionally.
      webviewConnectSrc: "'none'",
      webviewLocalResourceRoots: this.player.localResourceRoots,
      productionDependencies: Object.keys(packageJson.dependencies ?? {})
    };
    const result = computeVerifyLocalMode(inputs);
    this.cachedLocalModeResult = result;
    return result;
  }

  /** Recomputes the 🔒/☁ badge without opening the `Verify Local Mode` Quick Pick. */
  private async refreshLocalModeBadge(): Promise<void> {
    try {
      const profile = await this.profiles.getSelected();
      this.currentProfileLabel = profile.label;
      await this.computeLocalModeResult(profile);
    } catch (error) {
      this.log(`[pipeline] failed to refresh local mode badge: ${messageOf(error)}`);
    }
    this.statusBar.update(this.statusBarModel(this.controller.getState()));
  }

  async openInbox(): Promise<void> {
    await this.notWired("l'inbox (story ultérieure)");
  }

  async speakLatestClaudeResponse(): Promise<void> {
    await this.notWired("la lecture de la dernière réponse Claude (story ultérieure)");
  }

  async installClaudeHook(): Promise<void> {
    await this.notWired("l'installation du hook Claude Code (story ultérieure)");
  }

  // --------------------------------------------------------------- internals

  private async notWired(feature: string): Promise<void> {
    const message = `LLM Voice : ${feature} n'est pas encore câblée.`;
    this.log(message);
    void vscode.window.showInformationMessage(message);
  }

  private async ttsFor(profile: VoiceProfile): Promise<TtsProvider> {
    if (this.ttsProviderOverride !== undefined) {
      return this.ttsProviderOverride;
    }
    const resolved = resolveTtsConfig(profile.tts, this.ttsSettings());
    const referenceAudioPath =
      profile.tts.referenceAudio !== undefined ? this.resolveReferenceAudioPath(profile.tts.referenceAudio) : undefined;
    // Two profiles sharing `providerId@baseUrl` but cloning different
    // reference voices must never share a `ChatterboxProvider` instance —
    // the upload (and the filename it memoises) is per-instance, so the
    // reference path is part of the registry/cache key too.
    const key =
      referenceAudioPath !== undefined
        ? `${resolved.providerId}@${resolved.baseUrl}@ref:${referenceAudioPath}`
        : `${resolved.providerId}@${resolved.baseUrl}`;
    const existing = this.registry.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const apiKey =
      profile.tts.apiKeyRef !== undefined ? await this.context.secrets.get(profile.tts.apiKeyRef) : undefined;
    if (apiKey !== undefined) {
      this.knownSecrets.add(apiKey);
    }
    // ADR-005/D9: `providerId` picks the class (Chatterbox/Kokoro get their
    // engine-specific parameters, CdC §28), never anything but `baseUrl` +
    // an id string — `presetKindForProviderId` is the single place that maps
    // one to the other; anything unrecognised stays the generic OpenAI-
    // compatible client (enterprise/cloud tiers 2-3, ADR-009).
    const provider = createTtsProvider(
      { kind: presetKindForProviderId(resolved.providerId), baseUrl: resolved.baseUrl },
      {
        id: key,
        egress: this.egress,
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(referenceAudioPath !== undefined ? { referenceAudioPath } : {})
      }
    );
    this.registry.register(provider);
    return provider;
  }

  /**
   * `profile.tts.referenceAudio` (CdC §55) may be an absolute path (a
   * user-recorded sample, `docs/voices.md`) or, for the shipped
   * `chatterbox-local` default, a path relative to the extension root
   * (`CHATTERBOX_LOCAL_PRESET.referenceAudio`, `../deploy/tts/reference-audio/...`).
   *
   * That relative form only resolves in a *repository checkout* —
   * `context.extensionUri` is `vscode-extension/` there, so `../deploy/...`
   * reaches `deploy/tts/reference-audio/` next to it (dev `F5` launch,
   * `vscode-test`, and the real E2E scripts all run this way). A packaged
   * `.vsix` install does **not** bundle `deploy/` (ops tooling, not
   * extension content — `vsce package`'s file list is `vscode-extension/`
   * only), so the shipped clone default has no reference file to read
   * there yet: `ChatterboxProvider.synthesize()` then rejects (missing
   * file) exactly like any other synthesis failure — `AudioQueue`'s retry
   * then the existing "TTS unavailable" / Retry error surface, not a
   * silent switch to a different (predefined, English-accented) voice.
   * Documented as a known gap in `docs/providers.md` "Voice cloning";
   * shipping the reference *inside* the extension package is future work.
   */
  private resolveReferenceAudioPath(referenceAudio: string): string {
    if (path.isAbsolute(referenceAudio)) {
      return referenceAudio;
    }
    return vscode.Uri.joinPath(this.context.extensionUri, referenceAudio).fsPath;
  }

  /**
   * Builds (or reuses) the `NarratorProvider` for a `"narrated"` profile.
   * `resolveNarratorConfig` returning `undefined` means the profile carries
   * no narrator binding at all — `SessionFactory` already treats that as
   * faithful-only, so this returns `undefined` too rather than conjuring a
   * `NoNarrator` out of nothing. A *resolved* `providerId` of `"none"`/`""`
   * (profile or settings explicitly opting out) does return a `NoNarrator`
   * instance, so narration failure UX and AC-09's "zero requests" both go
   * through the same `NarratorProvider` contract.
   */
  private async narratorFor(profile: VoiceProfile): Promise<NarratorProvider | undefined> {
    if (this.narratorProviderOverride !== undefined) {
      return this.narratorProviderOverride;
    }
    const resolved = resolveNarratorConfig(profile.narrator, this.narratorSettings());
    if (resolved === undefined) {
      return undefined;
    }
    const key = `narrator:${resolved.providerId}@${resolved.baseUrl}@${resolved.model}`;
    const existing = this.narratorRegistry.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const apiKey =
      profile.narrator?.apiKeyRef !== undefined
        ? await this.context.secrets.get(profile.narrator.apiKeyRef)
        : undefined;
    if (apiKey !== undefined) {
      this.knownSecrets.add(apiKey);
    }
    const provider = createNarratorProvider({
      id: key,
      providerId: resolved.providerId,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
      egress: this.egress,
      ...(profile.narrator?.temperature !== undefined ? { temperature: profile.narrator.temperature } : {}),
      ...(apiKey !== undefined ? { apiKey } : {})
    });
    this.narratorRegistry.register(provider);
    return provider;
  }

  /** `llmVoice.tts.*`: the default a profile's `tts.providerId`/`tts.baseUrl` overrides when set. */
  private ttsSettings(): TtsSettings {
    const config = vscode.workspace.getConfiguration("llmVoice");
    return {
      provider: config.get<string>("tts.provider", "chatterbox"),
      baseUrl: config.get<string>("tts.baseUrl", "http://127.0.0.1:8880")
    };
  }

  /**
   * `llmVoice.narrator.*`: the default a profile's `narrator.*` overrides
   * when set. `model` defaults to `qwen2.5:7b` — small enough to run
   * comfortably alongside a TTS engine on a single local GPU/CPU, while
   * still reliable at Ollama's JSON-Schema structured output (CdC §21),
   * which smaller `1.5b`/`3b` Qwen variants are noticeably less consistent
   * at. Documented here and in `package.json#llmVoice.narrator.model`.
   */
  private narratorSettings(): NarratorSettings {
    const config = vscode.workspace.getConfiguration("llmVoice");
    return {
      provider: config.get<string>("narrator.provider", ""),
      baseUrl: config.get<string>("narrator.baseUrl", "http://127.0.0.1:11434"),
      model: config.get<string>("narrator.model", "qwen2.5:7b")
    };
  }

  private async handleChunkError(info: PlaybackErrorInfo): Promise<ChunkErrorDecision> {
    this.log(`[pipeline] chunk ${info.chunk.id} failed (${info.origin}): ${info.message}`);
    if (info.origin !== "synthesis") {
      return "skip";
    }
    this.statusBar.update({ ...this.statusBarModel("error") });
    void vscode.window.showErrorMessage(ERROR_TTS_UNAVAILABLE, "Retry", "Open provider settings").then((choice) => {
      if (choice === "Retry") {
        const context = this.lastCaptureContext;
        if (context !== undefined) {
          void this.start(context);
        }
      } else if (choice === "Open provider settings") {
        void vscode.commands.executeCommand("workbench.action.openSettings", "llmVoice.tts");
      }
    });
    return "stop";
  }

  /**
   * CdC §52 "Narrator indisponible" : Retry / Read without narration /
   * Cancel. `SessionFactory` already keeps playing faithfully for every
   * degraded group on its own (ADR-005's mode dégradé), so this is purely
   * notification + the three choices — shown once per session (guarded by
   * `narratorWarningShown`, reset in `start()`) so a long document that
   * degrades on several groups does not stack dialogs.
   *
   * "Read without narration" sets `narrationDisabledForSession` (forcing
   * every group of the current build via `SessionBuild.forceFaithful()`,
   * and every future `start()` call — this document or the next — to skip
   * the narrator entirely) until "Retry" explicitly clears it again.
   */
  private handleNarratorWarning(warning: NarrationWarning): void {
    this.log(
      `[pipeline] narration group ${warning.groupIndex} degraded (${warning.reason}), reading faithfully`
    );
    if (this.narratorWarningShown) {
      return;
    }
    this.narratorWarningShown = true;
    void vscode.window
      .showWarningMessage(ERROR_NARRATOR_UNAVAILABLE, "Retry", "Read without narration", "Cancel")
      .then((choice) => {
        if (choice === "Retry") {
          this.narrationDisabledForSession = false;
          const context = this.lastCaptureContext;
          if (context !== undefined) {
            void this.start(context);
          }
        } else if (choice === "Read without narration") {
          this.narrationDisabledForSession = true;
          this.currentSessionBuild?.forceFaithful();
        } else if (choice === "Cancel") {
          void this.stop();
        }
        // Dismissed (no choice): no-op — playback is already reading the
        // degraded groups faithfully; only this group falls back.
      });
  }

  private egressMode(): EgressMode {
    const config = vscode.workspace.getConfiguration("llmVoice");
    if (config.get<boolean>("privacy.localOnly", true)) {
      return "local";
    }
    return this.trustedHosts().length > 0 ? "trusted" : "open";
  }

  private trustedHosts(): readonly string[] {
    return vscode.workspace.getConfiguration("llmVoice").get<string[]>("network.trustedHosts", []);
  }

  private async initStatusBar(): Promise<void> {
    await this.refreshLocalModeBadge();
  }

  private statusBarModel(state: string): StatusBarViewModel {
    const remoteCheck = this.cachedLocalModeResult?.checks.find((check) => check.id === 1 || check.id === 2);
    return {
      state: toStatusBarState(state),
      profileLabel: this.currentProfileLabel,
      positionMs: this.controller.getPositionMs(),
      isLocalOnly: this.cachedLocalModeResult?.badge === "local",
      isRemoteProvider: remoteCheck?.status === "fail"
    };
  }

  /**
   * Pushes a mini-player snapshot to the *real* webview sink, regardless of
   * whether `sinkOverride` (a `FakeAudioSink`, in tests) is what actually
   * drives playback: `pushState` only feeds the visible mini-player, which
   * always exists via `PlayerViewProvider.audioSink`.
   */
  private pushPlayerState(): void {
    const chunks = this.controller.getChunks();
    this.player.audioSink.pushState({
      session: "current",
      index: this.controller.getCurrentIndex(),
      total: chunks.length,
      profile: this.currentProfileLabel,
      title: this.currentUri?.path.split("/").pop() ?? "",
      state: this.controller.getState()
    });
  }
}
