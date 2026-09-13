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
import type { PlaybackState } from "../core/playback.js";
import type { SyncMode, VoiceProfile } from "../core/profile.js";
import { isRemoteProfile } from "../core/profile.schema.js";
import type { NarratorProvider } from "../core/narration.js";
import type { ProviderHealth } from "../core/health.js";
import type { TtsParameterDescriptor, TtsProvider, Voice } from "../core/tts.js";
import type { MarkdownPolicy, SegmentationPolicy } from "../parser/types.js";
import { parseMarkdown } from "../parser/MarkdownParser.js";
import { segment } from "../parser/Segmenter.js";
import {
  buildSession,
  DiskAudioCache,
  PerformanceStats,
  PlaybackController,
  type AudioSink,
  type ChunkErrorDecision,
  type ChunkTimingEvent,
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
import {
  chooseTtsUnavailableMessage,
  NotificationGate,
  notifyChunkInvalid,
  notifyNarratorUnavailable,
  notifyTtsUnavailable,
  type TtsFailureDiagnostic,
  type TtsUnavailableChoice
} from "../ui/notifications.js";
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
  ChatterboxProvider,
  CHATTERBOX_LOCAL_PRESET,
  createTtsProvider,
  fallbackMessageFor,
  formatAutoVoiceInstallPrompt,
  INSTALL_VOICE_ACTION_LABEL,
  installPiperVoice as runPiperInstall,
  nextActionFor,
  OpenAICompatibleTtsProvider,
  PIPER_LOCAL_PRESET,
  presetKindForProviderId,
  probeHealth,
  shouldOfferAutoVoiceInstall,
  TtsProviderRegistry,
  warmupProvider,
  type HealthCheckable,
  type PiperInstallConsentDetails,
  type PiperInstallOutcome
} from "../tts/index.js";
import { createNarratorProvider } from "../narrator/index.js";
import type { Logger } from "../infrastructure/logger.js";
import type { PipelineFacade } from "../commands/PipelineFacade.js";
import { decidePlay, decidePlayPause, type PlayDecision } from "../commands/playDecision.js";
import { plainTextSegments, rangesOverlap } from "./textSegments.js";
import {
  resolveNarratorConfig,
  resolveTtsConfig,
  selectAutoTtsProvider,
  type NarratorSettings,
  type ResolvedTtsConfig,
  type TtsSettings
} from "./resolveProviderConfig.js";
import type { InboxEntry } from "../core/inbox.js";
import { ClaudeInboxSource } from "../claude/ClaudeInboxSource.js";
import { GlobalStateReadStore } from "../claude/GlobalStateReadStore.js";
import { InboxContentProvider, INBOX_CONTENT_SCHEME, inboxContentUri } from "../claude/InboxContentProvider.js";
import { InboxRepository } from "../claude/InboxRepository.js";
import { InboxTreeItem, InboxTreeProvider } from "../claude/InboxTreeProvider.js";
import { computeInboxBadge } from "../claude/inboxFormat.js";
import { InboxWatcher } from "../claude/InboxWatcher.js";
import { showInboxQuickPick } from "../claude/InboxQuickPick.js";
import { resolveInboxPath } from "../claude/resolveInboxPath.js";
import {
  installClaudeHook as runInstallClaudeHook,
  uninstallClaudeHook as runUninstallClaudeHook
} from "../claude/ClaudeHookCommand.js";
import { buildVoiceQuickPickItems, defaultVoiceFor, previewButton } from "../profiles/voiceBrowser.js";
import { useOwnVoice as runUseOwnVoice } from "../onboarding/UseOwnVoice.js";
import { ttsBindingForTier, type VoiceTier } from "../onboarding/voiceTiers.js";
import {
  ProfileEditorPanel,
  type ProfileEditorDeps,
  type WebviewToExtensionMessage as ProfileEditorTestMessage
} from "../views/profileEditor/ProfileEditorPanel.js";

/** Default `llmVoice.tts.readyTimeoutMs` (CdC §51's "Loading" health status):
 *  how long `start()` waits for a still-warming-up TTS server before
 *  attempting the first synthesis anyway, instead of failing immediately. */
const DEFAULT_READY_TIMEOUT_MS = 30_000;
/** Polling interval while `start()` waits on a `"Loading"` provider. */
const READY_POLL_INTERVAL_MS = 500;
/**
 * Bug fix (voice-selection-not-applied / infinite loop, fix(review)):
 * bounds `Pipeline.withDefaultVoice`'s `listVoices()` lookup — an
 * unreachable provider must fail exactly as fast as before this fix added
 * the lookup (see that method's own doc comment).
 */
const DEFAULT_VOICE_LOOKUP_TIMEOUT_MS = 3_000;

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

/**
 * S7.3's "TTS indisponible" dialog, "Choisir une voix" button: opened only
 * when `llmVoice.setupVoice` (a parallel onboarding story's command) is not
 * registered — checked at runtime via `vscode.commands.getCommands()`
 * rather than assumed, so this pipeline never depends on that story landing
 * first.
 */
const TTS_SETUP_DOCS_URL = "https://github.com/Guilhem-Bonnet/llm-voice/blob/main/vscode-extension/docs/providers.md";

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

/** `LLM Voice: Clear Audio Cache` (S7.3): human-sized freed-space figure, MB above 1 MiB, KB below. */
function formatCacheBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

/** Resolves after `ms`, or immediately if/when `signal` aborts — used by `waitForTtsReady`'s poll loop. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function segmentationPolicyFor(profile: VoiceProfile, firstChunkSentences: number): SegmentationPolicy {
  return {
    mode: profile.chunking.unit,
    maxSentencesPerChunk: profile.chunking.maxSentences,
    // S8.2 profile editor: a profile can now carry its own Markdown policy
    // (CdC §13/§49); an existing profile without one keeps the 0.1 default.
    markdown: profile.markdown ?? DEFAULT_MARKDOWN_POLICY,
    lang: profile.language,
    firstChunkSentences
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
  output: Logger;
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
  private readonly output: Logger;
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

  // ADR-003/ADR-004/ADR-007/ADR-011 (S5.1): the open inbox. `inboxTreeView`
  // and `inboxContentProviderRegistration` are `undefined` until they are
  // registered in the constructor below; kept as fields so `dispose()` can
  // tear them down deterministically.
  private readonly inboxRepository: InboxRepository;
  private readonly inboxWatcher: InboxWatcher;
  private readonly inboxTreeProvider: InboxTreeProvider;
  private inboxTreeView: vscode.TreeView<InboxTreeItem> | undefined;
  private inboxContentProviderRegistration: vscode.Disposable | undefined;

  private currentUri: vscode.Uri | undefined;
  private currentProfileLabel = "—";
  /** S8.2: `profile.synchronization.mode` for the session in progress, `"highlight-scroll"` (0.1 behaviour) until a session sets it. */
  private currentSyncMode: SyncMode = "highlight-scroll";
  private lastCaptureContext: CaptureContext | undefined;
  private captureAbort: AbortController | undefined;
  /** CdC §52 "une seule notification par session par type" (anti-spam); reset in `start()`. */
  private readonly notificationGate = new NotificationGate();
  /**
   * Bug fix (voice-selection-not-applied / infinite loop, 2026-09-12): the
   * resolved provider actually used by the *current* session's `tts`
   * instance (`startInternal`/`speakTestText`) — unlike `notificationGate`,
   * deliberately never reset per session, so `handleChunkError` can tell a
   * genuinely repeated failure from a first one even across separate
   * `Speak` attempts (the real user's reported loop spanned several of
   * them, not one session).
   */
  private currentResolvedTts: ResolvedTtsConfig | undefined;
  /**
   * `true` once this `Pipeline` instance has shown `TTS_UNAVAILABLE_MESSAGE`
   * at least once — every chunk-0 failure after that gets
   * `chooseTtsUnavailableMessage`'s diagnostic wording instead (same fix),
   * so the user never sees the exact same uninformative dialog twice.
   */
  private ttsUnavailableSeenBefore = false;
  private cachedLocalModeResult: VerifyLocalModeResult | undefined;
  private healthCache: { entries: readonly ProviderHealthEntry[]; expiresAt: number } | undefined;
  /**
   * `llmVoice.tts.provider: "auto"` (S7.1, ADR-009 default): the last
   * ADR-009-order resolution (Chatterbox → Piper local → système),
   * memoised for `HEALTH_CACHE_TTL_MS` so every `ttsFor`/`probeProviderHealth`
   * call in that window does not re-probe two HTTP endpoints just to find
   * out (again) that neither is up.
   */
  private autoTtsCache: { config: ResolvedTtsConfig; expiresAt: number } | undefined;
  /**
   * Set once "Read without narration" is chosen (CdC §52); every session
   * built after that point starts pre-forced to faithful reading, so the
   * choice sticks for the rest of the VS Code session — not just the
   * document being read when the user answered — until the extension is
   * reloaded or a narrator profile is explicitly re-selected via Retry.
   */
  private narrationDisabledForSession = false;
  private currentSessionBuild: SessionBuild | undefined;
  /**
   * S8.3: once the user declines (or a download fails) the one-action
   * auto-install prompt, `ensureVoiceReady` stops re-asking for the rest of
   * this VS Code session — `Setup Voice`/`llmVoice.installPiperVoice`
   * remain one command away regardless. Never reset on success (nothing to
   * decline anymore once a voice is installed).
   */
  private voiceInstallDeclinedThisSession = false;

  // ------------------------------------------------------- S6.2 (perf/latency)
  /** Counters behind `LLM Voice: Show Performance Report`; reset every `start()`. */
  private readonly perf = new PerformanceStats();
  /** `Date.now()` of the current session's `controller.start()` call, for TTFA. */
  private ttfaStartedAt: number | undefined;
  /** Provider ids already warmed up this VS Code session (`llmVoice.tts.warmup`) — at most once each. */
  private readonly warmedProviderIds = new Set<string>();

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
      // D10: host + path only, never a body/header — `event` is already
      // shaped that way (`EgressLogEvent`), so no extra redaction is needed
      // beyond what `Logger` does for every other field.
      logger: (event) => {
        this.output.debug("egress", {
          decision: event.decision,
          method: event.method,
          host: event.host,
          path: event.path,
          ...(event.reason !== undefined ? { reason: event.reason } : {})
        });
      }
    });

    this.diskCache = new DiskAudioCache({
      root: vscode.Uri.joinPath(this.context.globalStorageUri, "cache").fsPath,
      maxSizeMb: vscode.workspace.getConfiguration("llmVoice").get<number>("cache.maxSizeMb", 512)
    });

    this.profiles = new ProfileRepository(this.context.globalStorageUri.fsPath, this.context.globalState);

    this.inboxRepository = new InboxRepository({
      directory: this.inboxDirectory(),
      readState: new GlobalStateReadStore(this.context.globalState),
      onWarning: (rejection) =>
        this.output.warn("inbox entry ignored", { fileName: rejection.fileName, reason: rejection.reason })
    });
    this.inboxWatcher = new InboxWatcher({ directory: this.inboxRepository.directory });
    this.inboxTreeProvider = new InboxTreeProvider(() => this.inboxRepository.list());
    this.setupInbox();

    this.sources = [
      new MarkdownDocumentSource(),
      new TextSelectionSource(),
      new ClipboardSource(),
      new ClaudeInboxSource(this.inboxRepository)
    ];

    this.controller = new PlaybackController({
      cache: this.diskCache,
      onChunkError: (info) => this.handleChunkError(info),
      maxRetries: this.audioMaxRetries(),
      timeoutMs: this.ttsTimeoutMs(),
      prefetchChunks: this.audioPrefetchChunks(),
      onChunkTiming: (event) => this.handleChunkTiming(event)
    });
    this.controller.onChunkChange((change) => {
      this.recordTtfaOnce();
      // S8.2 profile editor "Highlight behavior" (CdC §49): `"off"` shows no
      // decoration at all; `"highlight"` decorates without auto-scrolling
      // (`reveal = false`); the default, `"highlight-scroll"`, keeps 0.1's
      // behaviour of both.
      if (this.currentUri !== undefined && this.currentSyncMode !== "off") {
        this.highlight.show(this.currentUri, change.chunk.sourceRanges, this.currentSyncMode !== "highlight");
      }
      this.pushPlayerState();
    });
    this.controller.onStateChange((change) => {
      this.statusBar.update(this.statusBarModel(change.state));
      this.updatePlaybackStateContext(change.state);
      if (change.state === "stopped" && this.currentUri !== undefined) {
        this.highlight.clear(this.currentUri);
      }
      this.pushPlayerState();
    });
    this.controller.onProgress(() => this.pushPlayerState());
    // S7.3: seeds `llmVoice.state` at startup (`idle`, `PlaybackController`'s
    // initial state); `onStateChange` above keeps it in sync from then on.
    this.updatePlaybackStateContext(this.controller.getState());

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

  /**
   * S5.1 (AC-12..15): a fresh disk scan, exactly what `openInbox()`/the Tree
   * View read — no index, ADR-004. Not part of `PipelineFacade`; only
   * `ExtensionTestApi` (dev/test mode) casts to reach it.
   */
  async listInboxEntriesForTest(): Promise<readonly InboxEntry[]> {
    return this.inboxRepository.list();
  }

  /** S5.1 (AC-15): which profile the last `start()`/`startInternal()` call actually resolved. */
  getCurrentProfileLabelForTest(): string {
    return this.currentProfileLabel;
  }

  /** S9 (ADR-011 revision 2026-09-12): the unread badge currently shown on `llmVoice.inboxView` (and, transitively, the `llmVoice` activity bar icon). */
  getInboxBadgeForTest(): { value: number; tooltip: string } | undefined {
    return this.inboxTreeView?.badge;
  }

  // ------------------------------------------------------------- lifecycle

  dispose(): void {
    this.controller.dispose();
    this.captureAbort?.abort();
    this.inboxWatcher.dispose();
    this.inboxTreeProvider.dispose();
    this.inboxTreeView?.dispose();
    this.inboxContentProviderRegistration?.dispose();
  }

  // ---------------------------------------------------------------- start

  async start(captureContext: CaptureContext): Promise<void> {
    return this.startInternal(captureContext);
  }

  /**
   * `doc.sourceType` (S5.1/S5.2) resolves the per-source default profile
   * via `llmVoice.profiles.bySource` (CdC §47, `resolveDefaultProfileId`)
   * — e.g. a Claude Code inbox message defaults to "Résumé LLM" — falling
   * back to the last-selected profile, then the collection default.
   */
  private async startInternal(captureContext: CaptureContext): Promise<void> {
    this.lastCaptureContext = captureContext;
    this.captureAbort?.abort();
    const abort = new AbortController();
    this.captureAbort = abort;
    this.notificationGate.reset();

    try {
      const source = this.sources.find((candidate) => candidate.canCapture(captureContext));
      if (source === undefined) {
        void vscode.window.showWarningMessage("LLM Voice : aucune source disponible pour cette action.");
        return;
      }

      const doc = await source.capture(captureContext, abort.signal);
      const profile = await this.profiles.getSelected(doc.sourceType, this.bySourceSettings());
      this.currentProfileLabel = profile.label;
      this.currentSyncMode = profile.synchronization?.mode ?? "highlight-scroll";

      // S8.3 (no Docker by default): a fresh install with no local engine
      // at all gets exactly one action ("Installer la voix française")
      // instead of building a session that is guaranteed to fail its first
      // chunk. `"retry"` re-runs this whole method once the voice is
      // installed — the original request is transparently resumed.
      if ((await this.ensureVoiceReady(profile, abort.signal)) === "retry") {
        return this.startInternal(captureContext);
      }

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
      this.currentResolvedTts = await this.resolveTtsProviderConfig(profile);
      // CdC §51 "Loading": a still-warming-up TTS server gets a grace period
      // instead of an immediate failure on the very first synthesis.
      await this.waitForTtsReady(tts, abort.signal);
      const sink = this.sinkOverride ?? this.player.audioSink;

      this.currentUri = doc.uri !== undefined ? vscode.Uri.parse(doc.uri) : undefined;
      this.player.reveal();

      this.beginPerfSession();
      // Bug fix (voice-selection-not-applied / infinite loop): a profile
      // with no explicit `tts.voice` must never reach `synthesize()` in a
      // "predefined voice" mode without one — several servers (Chatterbox
      // included) reject that outright (HTTP 400) instead of picking a
      // voice on their own. Never persisted to `profiles.json` — a
      // session-scoped default only, exactly like `forceFaithful` above.
      const effectiveProfile = await this.withDefaultVoice(profile, tts, abort.signal);
      await this.controller.start({
        segments: build.segments,
        profile: effectiveProfile,
        tts,
        sink,
        sealed: true
      });
    } catch (error) {
      this.output.error("start failed", { error: messageOf(error) });
      void vscode.window.showErrorMessage(`LLM Voice : ${messageOf(error)}`);
    }
  }

  /**
   * CdC §51 "Loading" health status: polls `tts.health()` until it stops
   * reporting `degraded`/`"loading"` or `llmVoice.tts.readyTimeoutMs` (default
   * 30000) elapses, instead of letting the very first synthesis fail while
   * the server is still warming up (e.g. Chatterbox loading its model onto
   * the GPU). Always returns rather than throws: a provider that stays
   * `unreachable`, or whose `health()` itself rejects, is left to the normal
   * synthesis-failure path (`handleChunkError`) to report.
   */
  private async waitForTtsReady(tts: TtsProvider, signal: AbortSignal): Promise<void> {
    const timeoutMs = this.ttsReadyTimeoutMs();
    if (timeoutMs <= 0) {
      return;
    }
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (signal.aborted) {
        return;
      }
      let health: ProviderHealth;
      try {
        health = await tts.health(signal);
      } catch (error) {
        this.output.debug("TTS readiness probe failed, proceeding to synthesis", {
          providerId: tts.id,
          error: messageOf(error)
        });
        return;
      }
      const loading = health.status === "degraded" && health.detail === "loading";
      if (!loading) {
        return;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        this.output.warn("TTS still loading after readyTimeoutMs, attempting synthesis anyway", {
          providerId: tts.id,
          readyTimeoutMs: timeoutMs
        });
        return;
      }
      await sleep(Math.min(READY_POLL_INTERVAL_MS, remaining), signal);
    }
  }

  private async buildSegments(doc: SourceDocument, profile: VoiceProfile): Promise<SourceSegment[]> {
    const captureRange = readCaptureRange(doc.metadata);
    const all =
      doc.sourceType === "markdown"
        ? segment(
            await parseMarkdown(doc.rawText, doc.uri),
            segmentationPolicyFor(profile, this.audioFirstChunkSentences())
          )
        : plainTextSegments(doc.rawText);
    if (captureRange === undefined) {
      return all;
    }
    return all.filter((seg) => seg.sourceRange !== undefined && rangesOverlap(seg.sourceRange, captureRange));
  }

  // -------------------------------------------------------------- control

  /**
   * `LLM Voice: Play` (S7.3 — fixes the 0.1.0 field bug: this used to call
   * `controller.resume()` unconditionally, a silent no-op whenever
   * `state !== "paused"`, most commonly because no session had ever
   * started). Resumes when paused, starts reading the active editor
   * (selection if non-empty, else the whole document) when there is none,
   * and does nothing while already playing/loading — see `decidePlay`.
   */
  async play(): Promise<void> {
    await this.applyPlayDecision(decidePlay(this.playDecisionInput()));
  }

  /**
   * `Ctrl+Alt+V Space` (ADR-011 "ctrl+alt+v space = Play/Pause"): a genuine
   * toggle, unlike `play()` — pauses a playing session instead of no-op'ing.
   */
  async playPause(): Promise<void> {
    await this.applyPlayDecision(decidePlayPause(this.playDecisionInput()));
  }

  private playDecisionInput(): { state: PlaybackState; hasActiveEditor: boolean; hasNonEmptySelection: boolean } {
    const editor = vscode.window.activeTextEditor;
    return {
      state: this.controller.getState(),
      hasActiveEditor: editor !== undefined,
      hasNonEmptySelection: editor !== undefined && !editor.selection.isEmpty
    };
  }

  private async applyPlayDecision(decision: PlayDecision): Promise<void> {
    switch (decision.kind) {
      case "noop":
        return;
      case "pause":
        this.controller.pause();
        return;
      case "resume":
        this.controller.resume();
        return;
      case "startDocument":
        await this.startFromActiveEditor(false);
        return;
      case "startSelection":
        await this.startFromActiveEditor(true);
        return;
      case "noEditor": {
        const choice = await vscode.window.showInformationMessage(
          "LLM Voice : aucun document ouvert à lire.",
          "Ouvrir un document"
        );
        if (choice === "Ouvrir un document") {
          void vscode.commands.executeCommand("workbench.action.files.openFile");
        }
        return;
      }
      default:
        // Exhaustiveness guard: a new `PlayDecision.kind` must be handled above.
        throw new Error(`LLM Voice : décision Play inattendue « ${(decision as { kind: string }).kind} ».`);
    }
  }

  /** Builds a `CaptureContext` from the active editor for `play()`/`playPause()`'s "smart start". */
  private async startFromActiveEditor(useSelection: boolean): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      // Raced shut between `playDecisionInput()` and here (editor closed
      // meanwhile) — same message as the "noEditor" decision, no throw.
      void vscode.window.showInformationMessage("LLM Voice : aucun document ouvert à lire.");
      return;
    }
    const context: CaptureContext = useSelection
      ? {
          scope: "selection",
          uri: editor.document.uri.toString(),
          languageId: editor.document.languageId,
          selection: {
            startLine: editor.selection.start.line,
            startColumn: editor.selection.start.character,
            endLine: editor.selection.end.line,
            endColumn: editor.selection.end.character
          }
        }
      : {
          scope: "document",
          uri: editor.document.uri.toString(),
          languageId: editor.document.languageId
        };
    await this.startInternal(context);
  }

  /**
   * S7.3: no silent no-op — `pause()` on a session that is not `playing`
   * (idle, already paused, stopped, loading…) used to be an unexplained
   * do-nothing (`PlaybackController.pause()`'s own guard).
   */
  async pause(): Promise<void> {
    if (this.controller.getState() !== "playing") {
      void vscode.window.showInformationMessage("LLM Voice : rien n'est en cours de lecture.");
      return;
    }
    this.controller.pause();
  }

  /** S7.3: same "no silent no-op" treatment as `pause()`. */
  async stop(): Promise<void> {
    if (this.controller.getState() === "idle") {
      void vscode.window.showInformationMessage("LLM Voice : rien à arrêter.");
      return;
    }
    this.controller.stop();
    if (this.currentUri !== undefined) {
      this.highlight.clear(this.currentUri);
    }
  }

  /** S7.3: same "no silent no-op" treatment as `pause()`. */
  async previousSegment(): Promise<void> {
    if (this.controller.getState() === "idle") {
      void vscode.window.showInformationMessage("LLM Voice : aucune lecture en cours.");
      return;
    }
    await this.controller.previous();
  }

  /** S7.3: same "no silent no-op" treatment as `pause()`. */
  async nextSegment(): Promise<void> {
    if (this.controller.getState() === "idle") {
      void vscode.window.showInformationMessage("LLM Voice : aucune lecture en cours.");
      return;
    }
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

  /**
   * The reading `LLM Voice: Test Voice` performs, factored out so S8.2's
   * voice-preview button (`previewVoice`) and the profile editor's "Tester"
   * button (`ProfileEditorDeps.testProfile`) can reuse it against a
   * candidate `profile` that may not be (or not yet be) the one saved in
   * `profiles.json` — unlike `testVoice()` below, this never catches: the
   * caller decides how to report a failure (a notification here, a
   * `testResult` webview message there).
   */
  private async speakTestText(profile: VoiceProfile): Promise<void> {
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
    this.currentResolvedTts = await this.resolveTtsProviderConfig(profile);
    const sink = this.sinkOverride ?? this.player.audioSink;
    this.currentProfileLabel = profile.label;
    this.player.reveal();
    this.beginPerfSession();
    // Bug fix (voice-selection-not-applied / infinite loop): same
    // session-scoped default-voice fallback as `startInternal` — Test Voice
    // must not be the one path left able to send a voice-less "predefined"
    // request.
    const effectiveProfile = await this.withDefaultVoice(profile, tts);
    await this.controller.start({ segments: build.segments, profile: effectiveProfile, tts, sink, sealed: true });
  }

  /** `LLM Voice: Test Voice` (CdC §50): faithful reading of a short reference text via the pipeline. */
  async testVoice(): Promise<void> {
    try {
      const profile = await this.profiles.getSelected();
      await this.speakTestText(profile);
    } catch (error) {
      this.output.error("testVoice failed", { error: messageOf(error) });
      void vscode.window.showErrorMessage(`LLM Voice : ${messageOf(error)}`);
    }
  }

  // ------------------------------------------------------- S8.2 voice browser

  /** `LLM Voice: Browse Voices` (CdC §72): applies and saves the picked voice on the current profile. */
  /** Test-castable, non-interactive counterpart of `browseVoices()` (`ProfileEditorDeps`-free): applies a voice by id without the Quick Pick. */
  async applyVoiceToProfileById(id: string, voiceId: string): Promise<VoiceProfile> {
    const updated = await this.profiles.update(id, (current) => ({
      ...current,
      tts: { ...current.tts, voice: voiceId }
    }));
    this.currentProfileLabel = updated.label;
    return updated;
  }

  async browseVoices(): Promise<void> {
    try {
      const profile = await this.profiles.getSelected();
      const picked = await this.pickVoiceForProfile(profile);
      if (picked === undefined) {
        return;
      }
      const updated = await this.profiles.update(profile.id, (current) => ({
        ...current,
        tts: { ...current.tts, voice: picked.id }
      }));
      this.currentProfileLabel = updated.label;
      void vscode.window.showInformationMessage(
        `LLM Voice : voix « ${picked.label} » appliquée à « ${updated.label} ».`
      );
    } catch (error) {
      void vscode.window.showErrorMessage(`LLM Voice : ${messageOf(error)}`);
    }
  }

  /**
   * Quick Pick over `profile`'s TTS provider's voices, one immediate-preview
   * button per row (S8.2) — shared by `browseVoices()` (interactive command)
   * and the profile editor's "Parcourir les voix" (`ProfileEditorDeps.pickVoice`,
   * which applies the result to its own unsaved form instead of writing to
   * disk). Resolves to `undefined` when the user cancels or the provider has
   * no voice list at all.
   */
  private async pickVoiceForProfile(profile: VoiceProfile): Promise<Voice | undefined> {
    const tts = await this.ttsFor(profile);
    if (tts.listVoices === undefined) {
      void vscode.window.showInformationMessage("LLM Voice : ce provider ne fournit pas de liste de voix.");
      return undefined;
    }
    let voices: Voice[];
    try {
      voices = await tts.listVoices();
    } catch (error) {
      void vscode.window.showErrorMessage(`LLM Voice : impossible de lister les voix — ${messageOf(error)}`);
      return undefined;
    }
    if (voices.length === 0) {
      void vscode.window.showInformationMessage("LLM Voice : aucune voix disponible pour ce provider.");
      return undefined;
    }

    return new Promise<Voice | undefined>((resolve) => {
      const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { voiceId: string }>();
      quickPick.title = "LLM Voice : parcourir les voix";
      quickPick.placeholder = "Choisir une voix — bouton lecture pour l'écouter";
      const rows = buildVoiceQuickPickItems(voices, profile.language, profile.tts.voice);
      quickPick.items = rows.map((row) => ({
        label: row.label,
        description: row.description,
        voiceId: row.voiceId,
        buttons: [previewButton()]
      }));
      let settled = false;
      const finish = (voice: Voice | undefined): void => {
        if (settled) {
          return;
        }
        settled = true;
        quickPick.dispose();
        resolve(voice);
      };
      quickPick.onDidTriggerItemButton((event) => {
        const voice = voices.find((candidate) => candidate.id === event.item.voiceId);
        if (voice !== undefined) {
          void this.previewVoice(profile, voice.id);
        }
      });
      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        const voice =
          selected !== undefined ? voices.find((candidate) => candidate.id === selected.voiceId) : undefined;
        finish(voice);
      });
      quickPick.onDidHide(() => finish(undefined));
      quickPick.show();
    });
  }

  /** Plays the test text with `voiceId` substituted, without leaving the Quick Pick and without saving (S8.2). */
  private async previewVoice(profile: VoiceProfile, voiceId: string): Promise<void> {
    try {
      await this.speakTestText({ ...profile, tts: { ...profile.tts, voice: voiceId } });
    } catch (error) {
      void vscode.window.showErrorMessage(`LLM Voice : ${messageOf(error)}`);
    }
  }

  /** `LLM Voice: Use My Own Voice` (S8.2, CdC §55). */
  async useOwnVoice(): Promise<void> {
    await runUseOwnVoice({
      extensionContext: this.context,
      applyReferenceAudio: async (absolutePath) => {
        const profile = await this.profiles.getSelected();
        const updated = await this.profiles.update(profile.id, (current) => ({
          ...current,
          tts: { ...current.tts, referenceAudio: absolutePath }
        }));
        this.currentProfileLabel = updated.label;
      },
      previewCurrentProfile: async () => {
        const profile = await this.profiles.getSelected();
        await this.speakTestText(profile);
      }
    });
  }

  /** `LLM Voice: Edit Profile` (CdC §49): opens the profile editor webview. */
  async editProfile(): Promise<void> {
    const picked = await this.pickProfile("LLM Voice : modifier quel profil ?");
    if (picked === undefined) {
      return;
    }
    await this.openProfileEditorById(picked.id);
  }

  /** Test-castable, non-interactive counterpart of `editProfile()`: opens the editor without the Quick Pick. */
  async openProfileEditorById(id: string): Promise<void> {
    const deps: ProfileEditorDeps = {
      getProfile: (profileId) => this.getProfileById(profileId),
      saveProfile: (profileId, next) => this.profiles.update(profileId, () => next),
      duplicateProfile: (profileId) => this.duplicateProfileById(profileId),
      deleteProfile: (profileId) => this.deleteProfileById(profileId),
      testProfile: (profile) => this.speakTestText(profile),
      listParameters: (profile) => this.ttsParametersFor(profile),
      pickVoice: (profile) => this.pickVoiceForProfile(profile)
    };
    await ProfileEditorPanel.open(deps, this.context.extensionUri, id);
  }

  /**
   * Test-only forwarders to `ProfileEditorPanel`'s own test-only statics.
   *
   * A test file cannot call `ProfileEditorPanel.testOnlyWebviewFor`/
   * `testOnlyDispatch` directly: `dist/extension.js` (what `vscode-test`
   * actually activates, `package.json#main`) is an esbuild bundle, so the
   * class the running extension uses and the class a test imports from
   * `out/src/views/profileEditor/ProfileEditorPanel.js` are two separate
   * module instances with two separate `panels` statics. Routing through
   * `Pipeline` — itself part of the bundle — reaches the real one. Not a
   * public extension API.
   */
  getProfileEditorHtmlForTest(id: string): string | undefined {
    return ProfileEditorPanel.testOnlyWebviewFor(id)?.html;
  }

  async dispatchProfileEditorMessageForTest(id: string, message: ProfileEditorTestMessage): Promise<void> {
    await ProfileEditorPanel.testOnlyDispatch(id, message);
  }

  closeProfileEditorForTest(id: string): void {
    ProfileEditorPanel.testOnlyClose(id);
  }

  /** Test-castable read of a single profile by id (no Quick Pick). */
  async getProfileById(id: string): Promise<VoiceProfile> {
    const profiles = await this.profiles.list();
    const found = profiles.find((profile) => profile.id === id);
    if (found === undefined) {
      throw new Error(`LLM Voice : profil inconnu « ${id} ».`);
    }
    return found;
  }

  private async ttsParametersFor(profile: VoiceProfile): Promise<readonly TtsParameterDescriptor[]> {
    const tts = await this.ttsFor(profile);
    const capabilities = await tts.getCapabilities();
    return capabilities.parameters;
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
    const resolvedTts = await this.resolveTtsProviderConfig(profile);
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
    this.output.trackSecret(value);
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

  /**
   * S7.3: reports the space actually freed instead of a generic "vidé" —
   * computed from `DiskAudioCache.size()` *before* the clear, since
   * `clear()` itself leaves nothing to measure afterwards.
   *
   * Deliberately *not* interactive (no confirm dialog) at this layer: the
   * `llmVoice.clearAudioCache` command (`src/commands/index.ts`) confirms
   * before calling this, but `PipelineFacade.clearAudioCache()` is also
   * called directly, non-interactively, by integration tests that reset the
   * disk cache between cases (e.g. `test/integration-chunk-invalid`) — a
   * confirm dialog here would hit VS Code test-electron's `DialogService`,
   * which refuses to render modals under test and throws instead of
   * resolving.
   */
  async clearAudioCache(): Promise<void> {
    const bytesBefore = await this.diskCache.size();
    if (bytesBefore === 0) {
      void vscode.window.showInformationMessage("LLM Voice : le cache audio est déjà vide.");
      return;
    }
    await this.diskCache.clear();
    void vscode.window.showInformationMessage(
      `LLM Voice : cache audio vidé (${formatCacheBytes(bytesBefore)} libérés).`
    );
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
      this.output.error("failed to refresh local mode badge", { error: messageOf(error) });
    }
    this.statusBar.update(this.statusBarModel(this.controller.getState()));
  }

  // ------------------------------------------------------------ inbox (S5.1)

  /** `minimal` layout's entry point (ADR-011): Quick Pick over the inbox. */
  async openInbox(): Promise<void> {
    await showInboxQuickPick(
      () => this.inboxRepository.list(),
      {
        speak: async (entry) => this.speakInboxEntry(entry),
        openFull: async (entry) => this.openInboxFullResponse(entry),
        remove: async (entry) => {
          await this.inboxRepository.remove(entry.id);
          await this.refreshInbox();
        },
        toggleRead: async (entry) => {
          await this.inboxRepository.markRead(entry.id, !entry.read);
          await this.refreshInbox();
        },
        selectProfile: async () => this.selectProfile()
      }
    );
  }

  /** CdC §47's per-source default profile, bound to `llmVoice.profiles.bySource`. */
  async speakLatestClaudeResponse(): Promise<void> {
    const entries = await this.inboxRepository.list();
    const latest = entries.find((entry) => entry.message.provider === "claude-code");
    if (latest === undefined) {
      void vscode.window.showInformationMessage("LLM Voice : aucune réponse Claude Code capturée pour le moment.");
      return;
    }
    await this.speakInboxEntry(latest);
  }

  async installClaudeHook(): Promise<void> {
    await runInstallClaudeHook(this.context.extensionUri);
  }

  async uninstallClaudeHook(): Promise<void> {
    await runUninstallClaudeHook();
  }

  /**
   * `LLM Voice: Install Local Voice (Piper)` (S7.1, ADR-009 §3): a modal
   * consent dialog naming size/source/licence, a cancellable progress
   * notification, then `PiperSetup.installPiperVoice`. Never runs a
   * download before the user explicitly confirms — `confirmPiperInstall`
   * is the only place `installPiperVoice`'s `prompt.confirm` resolves
   * `true`.
   */
  async installPiperVoice(): Promise<void> {
    const outcome = await vscode.window.withProgress<PiperInstallOutcome>(
      { location: vscode.ProgressLocation.Notification, title: "LLM Voice : voix Piper (fr_FR-siwis-medium)", cancellable: true },
      async (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        let lastPercent = 0;
        return runPiperInstall({
          installDir: this.piperInstallDir(),
          signal: controller.signal,
          prompt: { confirm: (details) => this.confirmPiperInstall(details) },
          progress: {
            report: (info) => {
              const percent = Math.round(info.fraction * 100);
              progress.report({ message: info.message, increment: percent - lastPercent });
              lastPercent = percent;
            }
          },
          onLog: (event) => this.output.debug("piper download", { host: event.host, decision: event.decision, ...(event.reason !== undefined ? { reason: event.reason } : {}) })
        });
      }
    );
    this.reportPiperInstallOutcome(outcome);
  }

  /** The one dialog `installPiperVoice`'s network access is gated behind — names size, source and licence, never assumed. */
  private async confirmPiperInstall(details: PiperInstallConsentDetails): Promise<boolean> {
    const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(0);
    const message =
      `Télécharger le moteur Piper (~${mb(details.binarySizeBytes)} Mo, licence ${details.piperLicense}, ` +
      `${details.piperSourceUrl}) et la voix française « ${details.voiceId} » (~${mb(details.voiceSizeBytes)} Mo, ` +
      `licence ${details.voiceLicense}, ${details.voiceSourceUrl}) ? Total ~${mb(details.totalBytes)} Mo, ` +
      "stocké localement, aucune donnée envoyée au-delà de ce téléchargement.";
    const choice = await vscode.window.showWarningMessage(message, { modal: true }, "Télécharger");
    return choice === "Télécharger";
  }

  private reportPiperInstallOutcome(outcome: PiperInstallOutcome): void {
    if (outcome.status === "installed") {
      // A fresh Piper install may change what "auto" resolves to (S7.1):
      // drop the cache so the very next synthesis notices it, instead of
      // waiting out HEALTH_CACHE_TTL_MS.
      this.autoTtsCache = undefined;
      void vscode.window.showInformationMessage(
        "LLM Voice : voix Piper installée et utilisée automatiquement pour la lecture (llmVoice.tts.provider = auto)."
      );
      return;
    }
    if (outcome.status === "declined") {
      return;
    }
    if (outcome.status === "unsupported-platform") {
      void vscode.window.showErrorMessage(
        "LLM Voice : Piper n'est pas proposé pour cette plateforme/architecture — la voix système (espeak-ng/say/SAPI) reste disponible."
      );
      return;
    }
    this.output.error("piper install failed", { error: outcome.message });
    void vscode.window.showErrorMessage(`LLM Voice : installation de Piper impossible — ${outcome.message}`);
  }

  /**
   * S8.3 (no Docker by default, ADR-009 amendment): runs once per
   * `startInternal` call, *before* building a session. `"proceed"` covers
   * every ordinary case — an explicit/remote/Chatterbox-already-running
   * provider, or a `system` provider that already has an engine
   * (`espeak-ng`, `say`, SAPI, or a previously-installed Piper) — so a
   * machine with `espeak-ng` on `PATH` never sees this prompt at all.
   * `"retry"` means the voice was just installed and `startInternal`
   * should re-run from the top to pick it up.
   */
  private async ensureVoiceReady(profile: VoiceProfile, signal: AbortSignal): Promise<"proceed" | "retry"> {
    if (this.voiceInstallDeclinedThisSession) {
      return "proceed";
    }
    const resolved = await this.resolveTtsProviderConfig(profile);
    if (presetKindForProviderId(resolved.providerId) !== "system") {
      return "proceed";
    }
    const tts = await this.ttsFor(profile);
    const health = await tts.health(signal).catch(
      (error): ProviderHealth => ({
        providerId: tts.id,
        status: "unreachable",
        checkedAt: Date.now(),
        detail: messageOf(error)
      })
    );
    if (!shouldOfferAutoVoiceInstall(resolved.providerId, health)) {
      return "proceed";
    }
    const resumed = await this.offerAutoVoiceInstall(signal);
    if (!resumed) {
      this.voiceInstallDeclinedThisSession = true;
      return "proceed";
    }
    return "retry";
  }

  /**
   * The one dialog behind `ensureVoiceReady`'s auto-install: names the real
   * download size (`formatAutoVoiceInstallPrompt`, from the same
   * `PiperInstallConsentDetails` `installPiperVoice` uses) and exactly one
   * button (`INSTALL_VOICE_ACTION_LABEL`) — declining is simply not
   * clicking it, no second dialog. `true` only when
   * `outcome.status === "installed"` (`nextActionFor`).
   */
  private async offerAutoVoiceInstall(signal: AbortSignal): Promise<boolean> {
    const outcome = await vscode.window.withProgress<PiperInstallOutcome>(
      { location: vscode.ProgressLocation.Notification, title: "LLM Voice : voix française (Piper)", cancellable: true },
      async (progress, token) => {
        const controller = new AbortController();
        const forwardAbort = (): void => controller.abort();
        signal.addEventListener("abort", forwardAbort);
        token.onCancellationRequested(() => controller.abort());
        let lastPercent = 0;
        try {
          return await runPiperInstall({
            installDir: this.piperInstallDir(),
            signal: controller.signal,
            prompt: { confirm: (details) => this.confirmAutoVoiceInstall(details) },
            progress: {
              report: (info) => {
                const percent = Math.round(info.fraction * 100);
                progress.report({ message: info.message, increment: percent - lastPercent });
                lastPercent = percent;
              }
            },
            onLog: (event) =>
              this.output.debug("auto voice install", {
                host: event.host,
                decision: event.decision,
                ...(event.reason !== undefined ? { reason: event.reason } : {})
              })
          });
        } finally {
          signal.removeEventListener("abort", forwardAbort);
        }
      }
    );
    if (nextActionFor(outcome) === "resumed") {
      this.autoTtsCache = undefined;
      return true;
    }
    if (outcome.status === "failed") {
      this.output.error("auto voice install failed", { error: outcome.message });
    }
    if (outcome.status !== "declined") {
      // A dismissed prompt is not worth a second dialog (the whole point of
      // this flow is *one* action); an unsupported platform or a genuine
      // download failure is.
      void vscode.window.showWarningMessage(fallbackMessageFor(outcome));
    }
    return false;
  }

  /** The one-button consent dialog itself — real sizes, never assumed. */
  private async confirmAutoVoiceInstall(details: PiperInstallConsentDetails): Promise<boolean> {
    const choice = await vscode.window.showInformationMessage(
      formatAutoVoiceInstallPrompt(details),
      INSTALL_VOICE_ACTION_LABEL
    );
    return choice === INSTALL_VOICE_ACTION_LABEL;
  }

  /** Speaks one inbox entry (Quick Pick/Tree/`speakLatestClaudeResponse`), marking it read first — zero autoplay: only ever reached from a command the user triggered. */
  private async speakInboxEntry(entry: InboxEntry): Promise<void> {
    await this.inboxRepository.markRead(entry.id, true);
    await this.refreshInbox();
    await this.startInternal({ scope: "inbox-message", inboxMessageId: entry.id });
  }

  private async openInboxFullResponse(entry: InboxEntry): Promise<void> {
    const document = await vscode.workspace.openTextDocument(inboxContentUri(entry.id));
    await vscode.window.showTextDocument(document, { preview: true });
    await this.inboxRepository.markRead(entry.id, true);
    await this.refreshInbox();
  }

  /** `llmVoice.claude.inboxPath` > `LLM_VOICE_INBOX` > `~/.llm-voice/inbox/` (ADR-004). */
  private inboxDirectory(): string {
    const settingValue = vscode.workspace.getConfiguration("llmVoice").get<string>("claude.inboxPath", "");
    return resolveInboxPath({ settingValue });
  }

  private async refreshInbox(): Promise<void> {
    await this.inboxTreeProvider.refresh();
    if (this.inboxTreeView !== undefined) {
      // ADR-011 revision (2026-09-12): same badge, now pulled from
      // `inboxFormat.ts` (`computeInboxBadge`) so it is unit-testable —
      // it also surfaces on the `llmVoice` activity bar icon now that the
      // inbox view lives in that container by default.
      this.inboxTreeView.badge = computeInboxBadge(this.inboxTreeProvider.unreadCount);
    }
  }

  private inboxEntryFromCommandArg(arg: unknown): InboxEntry | undefined {
    if (arg instanceof InboxTreeItem) {
      return arg.entry;
    }
    return arg as InboxEntry | undefined;
  }

  /**
   * Registers the Tree View (`full` layout, ADR-011), the `llm-voice-inbox:`
   * content provider, and the `llmVoice.inbox.*` commands; starts the
   * watcher. `InboxWatcher.onChange` only ever calls `refreshInbox()` — it
   * never reaches `startInternal`/`PlaybackController` (zero autoplay,
   * ADR-003).
   */
  private setupInbox(): void {
    const contentProvider = new InboxContentProvider(this.inboxRepository);
    this.inboxContentProviderRegistration = vscode.workspace.registerTextDocumentContentProvider(
      INBOX_CONTENT_SCHEME,
      contentProvider
    );

    this.inboxTreeView = vscode.window.createTreeView("llmVoice.inboxView", {
      treeDataProvider: this.inboxTreeProvider
    });

    this.context.subscriptions.push(
      vscode.commands.registerCommand("llmVoice.inbox.refresh", () => void this.refreshInbox()),
      vscode.commands.registerCommand("llmVoice.inbox.speak", (arg?: unknown) => {
        const entry = this.inboxEntryFromCommandArg(arg);
        if (entry !== undefined) {
          void this.speakInboxEntry(entry);
        }
      }),
      vscode.commands.registerCommand("llmVoice.inbox.openFull", (arg?: unknown) => {
        const entry = this.inboxEntryFromCommandArg(arg);
        if (entry !== undefined) {
          void this.openInboxFullResponse(entry);
        }
      }),
      vscode.commands.registerCommand("llmVoice.inbox.delete", (arg?: unknown) => {
        const entry = this.inboxEntryFromCommandArg(arg);
        if (entry !== undefined) {
          void this.inboxRepository.remove(entry.id).then(() => this.refreshInbox());
        }
      }),
      vscode.commands.registerCommand("llmVoice.inbox.markRead", (arg?: unknown) => {
        const entry = this.inboxEntryFromCommandArg(arg);
        if (entry !== undefined) {
          void this.inboxRepository.markRead(entry.id, !entry.read).then(() => this.refreshInbox());
        }
      })
    );

    this.inboxWatcher.onChange(() => void this.refreshInbox());
    this.inboxWatcher.start();
    void this.refreshInbox();
  }

  // --------------------------------------------------------------- internals

  private async ttsFor(profile: VoiceProfile): Promise<TtsProvider> {
    if (this.ttsProviderOverride !== undefined) {
      return this.ttsProviderOverride;
    }
    const resolved = await this.resolveTtsProviderConfig(profile);
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
    const apiKey = await this.resolveApiKey(profile.tts.apiKeyRef, resolved.providerId);
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
        ...(referenceAudioPath !== undefined ? { referenceAudioPath } : {}),
        // Bug fix (voice-selection-not-applied, defect 3): a referenceAudio
        // this process cannot read locally (e.g. a stale profile's relative
        // path resolved against the wrong root) must not silently kill
        // synthesis — surfaced in the Output Channel, synthesis falls back
        // to voice_mode "predefined" (`ChatterboxProvider`'s own doc comment).
        onReferenceAudioWarning: (message: string) => this.output.warn(message),
        systemPiperInstallDir: this.piperInstallDir()
      }
    );
    this.registry.register(provider);
    // S6.2: warm up this brand-new instance in the background, once — never
    // for `existing` above, so a document already read once this session
    // never re-pays this even though `warmedProviderIds` alone would already
    // make it a no-op (this early return also skips the `Set` lookup).
    this.warmupIfEnabled(provider, key, profile.language, profile.tts.voice);
    return provider;
  }

  /**
   * `profile.tts.providerId`/`llmVoice.tts.provider` resolved, with
   * `"auto"` (S7.1, the shipped default) expanded to a concrete provider via
   * `autoSelectTts()`. A profile or setting that names a provider
   * explicitly always wins — `"auto"` only ever comes from
   * `resolveTtsConfig` falling through to the setting's own default.
   */
  private async resolveTtsProviderConfig(profile: VoiceProfile): Promise<ResolvedTtsConfig> {
    const settingsResolved = resolveTtsConfig(profile.tts, this.ttsSettings());
    if (settingsResolved.providerId !== "auto") {
      return settingsResolved;
    }
    return this.autoSelectTts();
  }

  /**
   * ADR-009's zero-config default (S7.1): Chatterbox (if `health()`
   * answers) → Piper local (same) → système (`SystemTtsProvider`, always
   * eligible — no server to be down). Memoised for `HEALTH_CACHE_TTL_MS`
   * (`autoTtsCache`): every call in that window reuses the last resolution
   * instead of probing two HTTP endpoints again.
   */
  private async autoSelectTts(): Promise<ResolvedTtsConfig> {
    const now = Date.now();
    if (this.autoTtsCache !== undefined && this.autoTtsCache.expiresAt > now) {
      return this.autoTtsCache.config;
    }
    const chatterboxProbe = new ChatterboxProvider({
      id: "auto-probe-chatterbox",
      baseUrl: CHATTERBOX_LOCAL_PRESET.baseUrl,
      egress: this.egress
    });
    const piperLocalProbe = new OpenAICompatibleTtsProvider({
      id: "auto-probe-piper-local",
      baseUrl: PIPER_LOCAL_PRESET.baseUrl,
      egress: this.egress
    });
    const config = await selectAutoTtsProvider(
      [
        { providerId: "chatterbox", baseUrl: CHATTERBOX_LOCAL_PRESET.baseUrl, health: (s) => chatterboxProbe.health(s) },
        { providerId: "piper-local", baseUrl: PIPER_LOCAL_PRESET.baseUrl, health: (s) => piperLocalProbe.health(s) }
      ],
      { providerId: "system", baseUrl: "" }
    );
    this.autoTtsCache = { config, expiresAt: now + HEALTH_CACHE_TTL_MS };
    return config;
  }

  /** `globalStorageUri/piper` — where `PiperSetup`/`LLM Voice: Install Local Voice (Piper)` installs, and the only place `SystemTtsProvider` ever looks for Piper (its file header). */
  private piperInstallDir(): string {
    return vscode.Uri.joinPath(this.context.globalStorageUri, "piper").fsPath;
  }

  /**
   * Reads the API key a profile's `apiKeyRef` names — but only the one key
   * that profile is entitled to (S6.1 audit F-01, AC-SEC-08).
   *
   * `apiKeyRef` is profile data, and a profile can be *imported* from an
   * untrusted file (AC-SEC-05). Passing it straight to
   * `SecretStorage.get()` let an imported profile name any key in the
   * extension's namespace — e.g. `llmVoice.apiKey.openai` — and have its
   * value sent as a `Bearer` token to that same profile's own `baseUrl`.
   * The ref must now equal `apiKeySecretKey(providerId)` for the provider
   * the profile actually resolves to; anything else is ignored (and
   * reported at `warn`, with the ref name only — never a value).
   */
  private async resolveApiKey(apiKeyRef: string | undefined, providerId: string): Promise<string | undefined> {
    if (apiKeyRef === undefined) {
      return undefined;
    }
    const expected = apiKeySecretKey(providerId);
    if (apiKeyRef !== expected) {
      this.output.warn("Profile apiKeyRef ignored: it does not match the resolved provider", {
        apiKeyRef,
        expected
      });
      return undefined;
    }
    const apiKey = await this.context.secrets.get(apiKeyRef);
    if (apiKey !== undefined) {
      this.output.trackSecret(apiKey);
    }
    return apiKey;
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
   * Bug fix (voice-selection-not-applied / infinite loop, 2026-09-12):
   * resolves a concrete `tts.voice` for `profile` when it does not already
   * name one, from the resolved provider's own `listVoices()`
   * (`defaultVoiceFor`: first voice matching `profile.language`, else the
   * provider's first voice) — never persisted to `profiles.json`, a
   * session-scoped fallback only, exactly like `SessionBuild.forceFaithful`.
   *
   * Safe to apply unconditionally, including when the profile *does* carry
   * a `referenceAudio` for voice cloning: `ChatterboxProvider` only reads
   * `request.voice` when cloning did **not** happen (`buildTtsRequestBody`'s
   * own logic) — a voice cloning session that succeeds simply ignores the
   * extra field. This is also what makes it correct for the case
   * `ChatterboxProvider` itself cannot detect ahead of time: a
   * `referenceAudio` that fails to upload/read falls back to
   * `voice_mode: "predefined"` *inside* `synthesize()`, after this method
   * already ran — without this fallback already having supplied a `voice`,
   * that predefined-mode retry would still have nothing to send and would
   * still 400.
   *
   * fix(review): `tts.listVoices()` (unlike `tts.health()`) does not wrap
   * its `egress.fetch()` in a try/catch of its own (`ChatterboxProvider`'s
   * file), so an unreachable/unresponsive provider can leave this call
   * pending far longer than a closed-port refusal — observed lengthening
   * the real "TTS unavailable" integration test (closed loopback port)
   * past its 20s Mocha timeout. Bounded to `DEFAULT_VOICE_LOOKUP_TIMEOUT_MS`
   * (a provider that cannot even answer this quickly cannot synthesize
   * either — `handleChunkError`'s existing failure path reports that
   * exactly as before, just without this lookup adding to the wait) and to
   * `signal`, so a Stop/new capture during the lookup still cancels it.
   *
   * fix(review): builds the bounded signal by hand (`AbortController` +
   * `setTimeout`, `unref()`'d) rather than `AbortSignal.any`/
   * `AbortSignal.timeout` — the same manual pattern `AudioQueue.withTimeout`
   * already uses in this codebase, kept for consistency and because it
   * needs no assumption about which of those two newer static methods the
   * extension host's bundled Node actually ships.
   */
  private async withDefaultVoice(
    profile: VoiceProfile,
    tts: TtsProvider,
    signal?: AbortSignal
  ): Promise<VoiceProfile> {
    if (profile.tts.voice !== undefined || tts.listVoices === undefined) {
      return profile;
    }
    const controller = new AbortController();
    if (signal?.aborted === true) {
      controller.abort();
    }
    const onAbort = (): void => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), DEFAULT_VOICE_LOOKUP_TIMEOUT_MS);
    if (typeof (timer as unknown as { unref?: () => void }).unref === "function") {
      (timer as unknown as { unref: () => void }).unref();
    }
    let voices: Voice[];
    try {
      voices = await tts.listVoices(controller.signal);
    } catch (error) {
      this.output.debug("default voice lookup failed, proceeding without one", { error: messageOf(error) });
      return profile;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    const defaultVoice = defaultVoiceFor(voices, profile.language);
    if (defaultVoice === undefined) {
      return profile;
    }
    return { ...profile, tts: { ...profile.tts, voice: defaultVoice.id } };
  }

  /**
   * `LLM Voice: Setup Voice` (S7.2), bug fix (voice-selection-not-applied /
   * infinite loop, 2026-09-12): applies `ttsBindingForTier(tier)` to the
   * *active* profile (`ProfileRepository.getSelected`), replacing its
   * entire `tts` binding — a fresh, clean choice rather than a merge, so a
   * profile previously stuck on a stale `baseUrl`/`voice` from a different
   * provider never survives underneath the new one (`browseVoices()`
   * merges because it only ever changes `voice` on an already-correct
   * provider; this changes the provider itself). Called by
   * `extension.ts`'s `llmVoice.setupVoice` wiring — never by
   * `SetupVoice.ts` directly, which has no `ProfileRepository` access.
   */
  async applyVoiceTierChoice(tier: VoiceTier): Promise<void> {
    const profile = await this.profiles.getSelected();
    const binding = ttsBindingForTier(tier);
    const updated = await this.profiles.update(profile.id, (current) => ({
      ...current,
      tts: { ...binding }
    }));
    this.currentProfileLabel = updated.label;
    void vscode.window.showInformationMessage(
      `LLM Voice : voix « ${titleCaseProviderId(binding.providerId)} » appliquée au profil « ${updated.label} ».`
    );
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
    const apiKey = await this.resolveApiKey(profile.narrator?.apiKeyRef, resolved.providerId);
    const provider = createNarratorProvider({
      id: key,
      providerId: resolved.providerId,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
      egress: this.egress,
      timeoutMs: this.narratorTimeoutMs(),
      ...(profile.narrator?.temperature !== undefined ? { temperature: profile.narrator.temperature } : {}),
      ...(apiKey !== undefined ? { apiKey } : {})
    });
    this.narratorRegistry.register(provider);
    return provider;
  }

  /**
   * `llmVoice.tts.*`: the default a profile's `tts.providerId`/`tts.baseUrl`
   * overrides when set. `"auto"` (S7.1, the shipped default, ADR-009) is
   * expanded by `resolveTtsProviderConfig`/`autoSelectTts`, never here —
   * this stays a plain settings read, symmetric with `narratorSettings()`.
   */
  private ttsSettings(): TtsSettings {
    const config = vscode.workspace.getConfiguration("llmVoice");
    return {
      provider: config.get<string>("tts.provider", "auto"),
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

  /** `llmVoice.tts.timeoutMs` (default 60000, S5.3): combined with the job's own signal in `AudioQueue`. */
  private ttsTimeoutMs(): number {
    return vscode.workspace.getConfiguration("llmVoice").get<number>("tts.timeoutMs", 60_000);
  }

  /** `llmVoice.tts.readyTimeoutMs` (default 30000, S5.3): see `waitForTtsReady`. */
  private ttsReadyTimeoutMs(): number {
    return vscode.workspace.getConfiguration("llmVoice").get<number>("tts.readyTimeoutMs", DEFAULT_READY_TIMEOUT_MS);
  }

  /** `llmVoice.narrator.timeoutMs` (default 60000, S5.3): forwarded to `createNarratorProvider`. */
  private narratorTimeoutMs(): number {
    return vscode.workspace.getConfiguration("llmVoice").get<number>("narrator.timeoutMs", 60_000);
  }

  /** `llmVoice.audio.maxRetries` (default 2, CdC §52 "Chunk TTS invalide"). */
  private audioMaxRetries(): number {
    return vscode.workspace.getConfiguration("llmVoice").get<number>("audio.maxRetries", 2);
  }

  /** `llmVoice.audio.prefetchChunks` (CdC §32/§48): chunks synthesised ahead of playback. */
  private audioPrefetchChunks(): number {
    return vscode.workspace.getConfiguration("llmVoice").get<number>("audio.prefetchChunks", 2);
  }

  /**
   * `llmVoice.audio.firstChunkSentences` (S6.2, CdC §63): sentences in the
   * very first chunk of a document, capped below `profile.chunking.maxSentences`
   * so playback starts sooner without shrinking every later chunk's prosody.
   * Default `1` — measured on the reference machine (`docs/performance.md`),
   * a single sentence is the shortest unit that still sounds natural.
   */
  private audioFirstChunkSentences(): number {
    return vscode.workspace.getConfiguration("llmVoice").get<number>("audio.firstChunkSentences", 1);
  }

  /**
   * `llmVoice.tts.warmup` (S6.2, default `true`): absorbs a still-cold TTS
   * engine's first-inference cost on a throwaway phrase instead of the
   * user's real first chunk. See `src/tts/warmup.ts`'s file header.
   */
  private ttsWarmupEnabled(): boolean {
    return vscode.workspace.getConfiguration("llmVoice").get<boolean>("tts.warmup", true);
  }

  /**
   * CdC §52's three synthesis-failure surfaces, all reached through
   * `PlaybackController`'s single `onChunkError` callback:
   *  - `origin !== "synthesis"` (a playback/decode failure) always skips —
   *    unchanged from before S5.3, no dialog fits a broken audio *file*.
   *  - the session's *first* chunk (`index === 0`) failing after
   *    `AudioQueue`'s retries means the provider itself is unreachable
   *    ("TTS indisponible"): `notifyTtsUnavailable`, and its `Retry` re-runs
   *    only that chunk (`PlaybackController.retryCurrentChunk`, CdC §52
   *    "sans recréer la session") rather than a full `start()`.
   *  - any *later* chunk failing after retries, with earlier chunks having
   *    already played, means this one chunk specifically is bad ("Chunk TTS
   *    invalide"): `notifyChunkInvalid` — Skip or Stop, no Retry button.
   * Both dialogs are gated to once per session by `notificationGate` (CdC
   * §52 anti-spam); "Retry" re-arms `ttsUnavailable` so a second genuine
   * failure still prompts again instead of silently stopping.
   *
   * Bug fix (voice-selection-not-applied / infinite loop, 2026-09-12): the
   * chunk-0 dialog used to show `TTS_UNAVAILABLE_MESSAGE` — the exact same
   * wording — every time, including right after the user had just picked a
   * different voice from that same dialog's "Choisir une voix" button. From
   * the second time this `Pipeline` instance has ever shown it
   * (`ttsUnavailableSeenBefore`, deliberately not reset by
   * `notificationGate.reset()` — the real report spanned several separate
   * `Speak` attempts, not one session), `chooseTtsUnavailableMessage` swaps
   * in a diagnostic message naming the resolved provider, its endpoint, and
   * `info.message` (the real synthesis error, already captured by
   * `AudioQueue`) — so two consecutive failures are never worded
   * identically again.
   */
  private async handleChunkError(info: PlaybackErrorInfo): Promise<ChunkErrorDecision> {
    this.output.warn("chunk failed", { chunkId: info.chunk.id, origin: info.origin, index: info.index });
    if (info.origin !== "synthesis") {
      return "skip";
    }
    this.statusBar.update({ ...this.statusBarModel("error") });

    if (info.index === 0) {
      if (this.notificationGate.shouldNotify("ttsUnavailable")) {
        this.notificationGate.markShown("ttsUnavailable");
        const resolved = this.currentResolvedTts;
        const diagnostic: TtsFailureDiagnostic | undefined =
          resolved !== undefined
            ? { providerId: resolved.providerId, baseUrl: resolved.baseUrl, errorDetail: info.message }
            : undefined;
        const message = chooseTtsUnavailableMessage(this.ttsUnavailableSeenBefore, diagnostic);
        this.ttsUnavailableSeenBefore = true;
        void notifyTtsUnavailable((msg, ...items) => vscode.window.showErrorMessage(msg, ...items), message).then(
          (choice) => this.handleTtsUnavailableChoice(choice)
        );
      }
      return "stop";
    }

    if (!this.notificationGate.shouldNotify("chunkInvalid")) {
      // Anti-spam already showed this dialog once this session: default to
      // the safe choice (pause) rather than silently skip more audio.
      return "stop";
    }
    this.notificationGate.markShown("chunkInvalid");
    return notifyChunkInvalid(
      (message, ...items) => vscode.window.showErrorMessage(message, ...items),
      this.audioMaxRetries()
    );
  }

  /**
   * S7.3: "Choisir une voix" runs `llmVoice.setupVoice` when that command is
   * registered (a parallel onboarding story) — checked with
   * `vscode.commands.getCommands()` rather than assumed, so this file never
   * depends on that story merging first — and falls back to the provider
   * docs otherwise. "Réessayer" keeps CdC §52's "sans recréer la session"
   * behaviour (`retryCurrentChunk`, only the failed chunk).
   */
  private async handleTtsUnavailableChoice(choice: TtsUnavailableChoice): Promise<void> {
    if (choice === "retry") {
      this.notificationGate.clear("ttsUnavailable");
      this.controller.retryCurrentChunk();
      return;
    }
    if (choice === "openSettings") {
      void vscode.commands.executeCommand("workbench.action.openSettings", "llmVoice.tts");
      return;
    }
    if (choice === "setupVoice") {
      const commands = await vscode.commands.getCommands(true);
      if (commands.includes("llmVoice.setupVoice")) {
        await vscode.commands.executeCommand("llmVoice.setupVoice");
      } else {
        await vscode.env.openExternal(vscode.Uri.parse(TTS_SETUP_DOCS_URL));
      }
    }
  }

  /**
   * CdC §52 "Narrator indisponible" : Retry / Read without narration /
   * Cancel. `SessionFactory` already keeps playing faithfully for every
   * degraded group on its own (ADR-005's mode dégradé), so this is purely
   * notification + the three choices — shown once per session
   * (`notificationGate`, reset in `start()`) so a long document that
   * degrades on several groups does not stack dialogs.
   *
   * "Read without narration" sets `narrationDisabledForSession` (forcing
   * every group of the current build via `SessionBuild.forceFaithful()`,
   * and every future `start()` call — this document or the next — to skip
   * the narrator entirely) until "Retry" explicitly clears it again.
   */
  // ------------------------------------------------------- S6.2 (perf/latency)

  /**
   * `AudioQueue.onChunkTiming` (S6.2): folds every sample into `this.perf`
   * and mirrors it to the debug log — timings and counts only, never
   * `spokenText`/audio (CdC §81), safe at `debug` level.
   */
  private handleChunkTiming(event: ChunkTimingEvent): void {
    this.perf.recordChunk(event);
    this.output.debug("chunk timing", {
      index: event.index,
      cacheHit: event.cacheHit,
      ready: event.ready,
      queueSize: event.queueSize,
      ...(event.synthesisMs !== undefined ? { synthesisMs: event.synthesisMs } : {})
    });
  }

  /**
   * Time-to-first-audio (CdC §63): `this.ttfaStartedAt` is armed right before
   * `controller.start()`/`testVoice()`'s own `controller.start()` and
   * consumed by the *first* `PlaybackController.onChunkChange` that fires
   * after it — exactly the moment the first chunk starts playing — never by
   * a later chunk change within the same session (`undefined` after the
   * first call makes every later call in the session a no-op).
   */
  private recordTtfaOnce(): void {
    if (this.ttfaStartedAt === undefined) {
      return;
    }
    const ttfaMs = Date.now() - this.ttfaStartedAt;
    this.ttfaStartedAt = undefined;
    this.perf.recordTtfa(ttfaMs);
    this.output.debug("ttfa", { ttfaMs });
  }

  /** Resets the session's performance counters and arms the TTFA clock (S6.2). */
  private beginPerfSession(): void {
    this.perf.reset();
    this.ttfaStartedAt = Date.now();
  }

  /**
   * `llmVoice.tts.warmup` (S6.2, default `true`): fires `warmupProvider`
   * at most once per resolved provider instance, in the background — never
   * awaited by the caller, so it cannot delay the `Speak` that triggered it.
   * Errors are logged at `debug` (never surfaced to the user: warmup is
   * purely a latency optimisation, not a correctness requirement — the
   * normal `waitForTtsReady`/`AudioQueue` retry path is what reports a
   * genuinely broken provider).
   */
  private warmupIfEnabled(tts: TtsProvider, providerId: string, language: string, voice: string | undefined): void {
    if (!this.ttsWarmupEnabled() || this.warmedProviderIds.has(providerId)) {
      return;
    }
    this.warmedProviderIds.add(providerId);
    void warmupProvider(tts, { language, ...(voice !== undefined ? { voice } : {}) }).then((result) => {
      this.output.debug("tts warmup", {
        providerId: result.providerId,
        ok: result.ok,
        totalMs: result.totalMs,
        ...(result.healthMs !== undefined ? { healthMs: result.healthMs } : {}),
        ...(result.synthesisMs !== undefined ? { synthesisMs: result.synthesisMs } : {}),
        ...(result.error !== undefined ? { error: result.error } : {})
      });
    });
  }

  /** `LLM Voice: Show Performance Report` (S6.2): stats of the current/last session. */
  async performanceReport(): Promise<void> {
    const snap = this.perf.snapshot();
    const items: vscode.QuickPickItem[] = [
      {
        label: snap.ttfaMs !== undefined ? `$(watch) TTFA : ${snap.ttfaMs} ms` : "$(watch) TTFA : n/a",
        description: "Délai avant le premier son (CdC §63)"
      },
      {
        label: `$(list-unordered) Chunks : ${snap.chunkCount} (cache ${snap.cacheHits}, synthèse ${snap.cacheMisses}, erreurs ${snap.errors})`
      },
      {
        label:
          snap.avgSynthesisMs !== undefined
            ? `$(zap) Synthèse moyenne : ${snap.avgSynthesisMs} ms/chunk`
            : "$(zap) Synthèse moyenne : n/a",
        description: "Hors cache hits"
      },
      {
        label: `$(server-process) File d'attente (dernière) : ${snap.lastQueueSize ?? "n/a"}`
      }
    ];
    await vscode.window.showQuickPick(items, { placeHolder: "LLM Voice : rapport de performance (session courante)" });
  }

  /** Test hook: last computed snapshot, without a Quick Pick (S6.2). */
  getPerformanceSnapshotForTest(): ReturnType<PerformanceStats["snapshot"]> {
    return this.perf.snapshot();
  }

  private handleNarratorWarning(warning: NarrationWarning): void {
    this.output.warn("narration group degraded, reading faithfully", {
      groupIndex: warning.groupIndex,
      reason: warning.reason
    });
    if (!this.notificationGate.shouldNotify("narratorUnavailable")) {
      return;
    }
    this.notificationGate.markShown("narratorUnavailable");
    void notifyNarratorUnavailable((message, ...items) =>
      vscode.window.showWarningMessage(message, ...items)
    ).then((choice) => {
      if (choice === "retry") {
        this.notificationGate.clear("narratorUnavailable");
        this.narrationDisabledForSession = false;
        const context = this.lastCaptureContext;
        if (context !== undefined) {
          void this.start(context);
        }
      } else if (choice === "readWithoutNarration") {
        this.narrationDisabledForSession = true;
        this.currentSessionBuild?.forceFaithful();
      } else if (choice === "cancel") {
        void this.stop();
      }
      // Dismissed: no-op — playback is already reading the degraded groups
      // faithfully; only this group falls back.
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

  /**
   * S7.3: mirrors `PlaybackController`'s state into the `llmVoice.state`
   * `when`-clause context key (`package.json#contributes.commands[].enablement`
   * greys out Pause/Stop/Next/Previous in the Command Palette instead of
   * leaving them silently do nothing).
   */
  private updatePlaybackStateContext(state: PlaybackState): void {
    void vscode.commands.executeCommand("setContext", "llmVoice.state", state);
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
