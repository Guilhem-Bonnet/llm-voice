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

import * as vscode from "vscode";
import packageJson from "../../package.json";
import type { CaptureContext, SourceAdapter, SourceDocument, SourceSegment } from "../core/source.js";
import type { VoiceProfile } from "../core/profile.js";
import type { NarratorProvider } from "../core/narration.js";
import type { TtsProvider } from "../core/tts.js";
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
  type PlaybackErrorInfo
} from "../playback/index.js";
import {
  createEgressGuard,
  verifyLocalMode as computeVerifyLocalMode,
  type EgressGuardHandle,
  type EgressMode,
  type VerifyLocalModeInputs
} from "../net/index.js";
import { HighlightController } from "../highlight/HighlightController.js";
import { PlayerViewProvider } from "../views/player/PlayerViewProvider.js";
import { StatusBar, type StatusBarPlaybackState, type StatusBarViewModel } from "../ui/StatusBar.js";
import { ClipboardSource, MarkdownDocumentSource, TextSelectionSource, readCaptureRange } from "../sources/index.js";
import { ProfileRepository } from "../profiles/index.js";
import { InMemoryProviderRegistry, OpenAICompatibleTtsProvider } from "../tts/index.js";
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
  private readonly registry = new InMemoryProviderRegistry<TtsProvider>();
  private readonly narratorRegistry = new InMemoryProviderRegistry<NarratorProvider>();
  private readonly diskCache: DiskAudioCache;
  private readonly profiles: ProfileRepository;
  private readonly controller: PlaybackController;
  private readonly sources: readonly SourceAdapter[];

  private currentUri: vscode.Uri | undefined;
  private currentProfileLabel = "—";
  private lastCaptureContext: CaptureContext | undefined;
  private captureAbort: AbortController | undefined;
  private narratorWarningShown = false;

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
        this.output.appendLine(
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

    void this.initStatusBar();
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
      const profile = await this.profiles.getSelected();
      this.currentProfileLabel = profile.label;
      const segments = await this.buildSegments(doc, profile);

      if (segments.length === 0) {
        void vscode.window.showInformationMessage("LLM Voice : rien à lire pour cette sélection.");
        return;
      }

      const narrator = profile.mode === "narrated" ? await this.narratorFor(profile) : undefined;
      const build = await buildSession(segments, profile, narrator, {
        signal: abort.signal,
        onWarning: (warning) => this.handleNarratorWarning(warning)
      });
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
      this.output.appendLine(`[pipeline] start failed: ${messageOf(error)}`);
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
      profiles.map((profile) => ({
        label: profile.id === selected.id ? `$(check) ${profile.label}` : profile.label,
        ...(profile.description !== undefined ? { description: profile.description } : {}),
        id: profile.id
      })),
      { placeHolder: "LLM Voice : choisir un profil" }
    );
    if (picked === undefined) {
      return;
    }
    await this.profiles.select(picked.id);
    const next = profiles.find((profile) => profile.id === picked.id);
    if (next !== undefined) {
      this.currentProfileLabel = next.label;
      this.statusBar.update(this.statusBarModel(this.controller.getState()));
    }
  }

  async openProfiles(): Promise<void> {
    await this.profiles.openInEditor();
  }

  // ------------------------------------------------------------------ misc

  async clearAudioCache(): Promise<void> {
    await this.diskCache.clear();
    void vscode.window.showInformationMessage("LLM Voice : cache audio vidé.");
  }

  async verifyLocalMode(): Promise<void> {
    const profile = await this.profiles.getSelected();
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
    this.statusBar.update({ ...this.statusBarModel(this.controller.getState()), isLocalOnly: result.badge === "local" });

    const items = result.checks.map((check) => ({
      label: `${check.status === "ok" ? "$(check)" : check.status === "warn" ? "$(warning)" : check.status === "unverifiable" ? "$(question)" : "$(error)"} ${check.label}`,
      detail: check.detail
    }));
    await vscode.window.showQuickPick(items, {
      placeHolder: result.badge === "local" ? "$(lock) Mode local vérifié" : "$(warning) Mode local non vérifié"
    });
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
    this.output.appendLine(message);
    void vscode.window.showInformationMessage(message);
  }

  private async ttsFor(profile: VoiceProfile): Promise<TtsProvider> {
    if (this.ttsProviderOverride !== undefined) {
      return this.ttsProviderOverride;
    }
    const resolved = resolveTtsConfig(profile.tts, this.ttsSettings());
    const key = `${resolved.providerId}@${resolved.baseUrl}`;
    const existing = this.registry.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const apiKey =
      profile.tts.apiKeyRef !== undefined ? await this.context.secrets.get(profile.tts.apiKeyRef) : undefined;
    const provider = new OpenAICompatibleTtsProvider({
      id: key,
      baseUrl: resolved.baseUrl,
      egress: this.egress,
      ...(apiKey !== undefined ? { apiKey } : {})
    });
    this.registry.register(provider);
    return provider;
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
    this.output.appendLine(`[pipeline] chunk ${info.chunk.id} failed (${info.origin}): ${info.message}`);
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
   */
  private handleNarratorWarning(warning: NarrationWarning): void {
    this.output.appendLine(
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
          const context = this.lastCaptureContext;
          if (context !== undefined) {
            void this.start(context);
          }
        } else if (choice === "Cancel") {
          void this.stop();
        }
        // "Read without narration" (or dismissed): no-op — playback is
        // already reading the degraded groups faithfully.
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
    try {
      const profile = await this.profiles.getSelected();
      this.currentProfileLabel = profile.label;
      this.statusBar.update(this.statusBarModel("idle"));
    } catch (error) {
      this.output.appendLine(`[pipeline] failed to load default profile: ${messageOf(error)}`);
    }
  }

  private statusBarModel(state: string): StatusBarViewModel {
    return {
      state: toStatusBarState(state),
      profileLabel: this.currentProfileLabel,
      positionMs: this.controller.getPositionMs(),
      isLocalOnly: this.egressMode() === "local"
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
