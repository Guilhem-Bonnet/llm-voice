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

import { normalizeSelections } from "../core/source.js";
import type { PlayerNotice } from "../core/playback.js";
import type { TtsHoldReason } from "../core/tts.js";
import { DEFAULT_GROUP_SIZE } from "../playback/SessionFactory.js";
import {
  WaitTracker,
  estimateWait,
  recordWaitMeasure,
  sanitizeWaitMeasures,
  type WaitEstimate,
  type WaitEstimateInput,
  type WaitMeasureKind,
  type WaitMeasureStore,
  type WaitStep
} from "../playback/waitEstimate.js";
import { charsOf, describeReading, passagesAhead } from "../views/player/readingText.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { createGpuYieldProbe } from "../direction/director/gpuYield.js";
import { KYUTAI16_DEFAULT_VOICE } from "../tts/kyutai16VoiceCatalog.js";
import packageJson from "../../package.json";
import type { CaptureContext, SourceAdapter, SourceDocument, SourceSegment } from "../core/source.js";
import type { PlaybackState, ResponseCodeChipView } from "../core/playback.js";
import type { SyncMode, TtsBinding, VoiceProfile } from "../core/profile.js";
import { isRemoteProfile } from "../core/profile.schema.js";
import type { NarratorProvider } from "../core/narration.js";
import type { ProviderHealth, ProviderHealthStatus } from "../core/health.js";
import type { TtsParameterDescriptor, TtsProvider, Voice } from "../core/tts.js";
import type { MarkdownPolicy, SegmentationPolicy, SourceBlock } from "../parser/types.js";
import { parseMarkdown } from "../parser/MarkdownParser.js";
import { readResponse } from "../parser/ResponseReading.js";
import { responseCodeChipOf, type ResponseBeingRead } from "../views/player/responseCodeChip.js";
import { NARRATOR_SPEAKER_ID } from "../core/direction.js";
import type { NarrationSegment } from "../core/narration.js";
import type { AudioChunk, PlayerScriptView } from "../core/playback.js";
import { BibleStore } from "../direction/bible/BibleStore.js";
import { documentKeyOf, documentScope } from "../direction/bible/scopes.js";
import { assignCast } from "../direction/cast/castSegments.js";
import { nearestVoice, proposalCacheKey, proposalLabels, proposeCast, type ProposalRole, type VerifiedProposal } from "../direction/director/castProposals.js";
import { DEFAULT_DIRECTION_MODEL, OllamaDirectionLlm } from "../direction/director/OllamaDirectionLlm.js";
import { castFromBible, recastFromScratch, recordUserVoice } from "../direction/cast/castStore.js";
import { CastPanel } from "../views/castPanel/CastPanel.js";
import { castNotice, engineLabelOf, traitChoices, type CastPanelState, type CastProposal } from "../views/castPanel/castPanelModel.js";
import { createQwen3Voice, fetchQwen3VoiceSample } from "../tts/qwen3Voices.js";
import { planReading, type ReadingPlan } from "../direction/cast/synthesisPlan.js";
import { parseScript, plainTextBlocks } from "../direction/script/parseScript.js";
import { sameWordsApartFromLabels } from "../direction/script/scriptFidelity.js";
import { bindingForChunk, cacheKeyFor, type AudioQueueBinding } from "../playback/AudioQueue.js";
import { groupPassages } from "../playback/passageGroups.js";
import { bindingFrom, chunksFrom } from "../playback/PlaybackController.js";
import { ReadingPreparer, type PreparationOutcome } from "../playback/ReadingPreparer.js";
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
  formatPlaybackFailedMessage,
  type TtsFailureDiagnostic,
  type TtsUnavailableChoice
} from "../ui/notifications.js";
import { formatProviderHealthQuickPickItem, titleCaseProviderId } from "../ui/providerStatusText.js";
import { ClipboardSource, MarkdownDocumentSource, TextSelectionSource, readCaptureRanges } from "../sources/index.js";
import {
  ProfileRepository,
  apiKeySecretKey,
  bindingForEngineVoice,
  bindingOfGlobalVoice,
  collectRemoteProviderIds,
  declaredVoiceLanguage,
  describeSpeedGap,
  describeVoice,
  formatProfileQuickPickItem,
  formatVoiceLanguageWarning,
  readModesBySource,
  requestedSpeed,
  resolveEngineSpeed,
  type BySourceSetting,
  type EngineSpeed,
  type ReadingResolution
} from "../profiles/index.js";
import {
  ChatterboxProvider,
  CHATTERBOX_LOCAL_PRESET,
  createTtsProvider,
  fallbackMessageFor,
  formatAutoVoiceInstallPrompt,
  INSTALL_VOICE_ACTION_LABEL,
  installPiperVoice as runPiperInstall,
  KYUTAI_POCKET_LOCAL_PRESET,
  KYUTAI16_LOCAL_PRESET,
  nextActionFor,
  QWEN3_LOCAL_PRESET,
  OpenAICompatibleTtsProvider,
  PIPER_LOCAL_PRESET,
  presetKindForProviderId,
  probeHealth,
  shouldOfferAutoVoiceInstall,
  TtsProviderRegistry,
  warmupProvider,
  type HealthCheckable,
  type PiperInstallConsentDetails,
  type PiperInstallOutcome,
  type SystemTtsProcessRunner
} from "../tts/index.js";
import { createNarratorProvider } from "../narrator/index.js";
import type { Logger } from "../infrastructure/logger.js";
import type { PipelineFacade } from "../commands/PipelineFacade.js";
import { decidePlay, decidePlayPause, type PlayDecision } from "../commands/playDecision.js";
import { plainScriptSegments, plainTextSegments, rangesOverlap } from "./textSegments.js";
import { createInstallFreshnessCheck, installedBundlePath } from "./installFreshness.js";
import {
  chooseQwen3OrFallback,
  qwen3FallbackMessage,
  resolveNarratorConfig,
  resolveTtsConfig,
  selectAutoTtsProvider,
  ttsInstanceKey,
  type NarratorSettings,
  type ResolvedTtsConfig,
  type TtsSettings
} from "./resolveProviderConfig.js";
import type { InboxEntry } from "../core/inbox.js";
import { ClaudeInboxSource } from "../claude/ClaudeInboxSource.js";
import { GlobalStateReadStore } from "../claude/GlobalStateReadStore.js";
import { InboxContentProvider, INBOX_CONTENT_SCHEME, inboxContentUri } from "../claude/InboxContentProvider.js";
import { InboxRepository } from "../claude/InboxRepository.js";
import { ResponsesViewProvider } from "../views/inbox/ResponsesViewProvider.js";
import { InboxWatcher } from "../claude/InboxWatcher.js";
import { showInboxQuickPick } from "../claude/InboxQuickPick.js";
import { resolveInboxPath } from "../claude/resolveInboxPath.js";
import {
  installClaudeHook as runInstallClaudeHook,
  uninstallClaudeHook as runUninstallClaudeHook
} from "../claude/ClaudeHookCommand.js";
import {
  buildVoiceQuickPickItems,
  defaultVoiceFor,
  previewButton,
  voiceLanguageDiffers
} from "../profiles/voiceBrowser.js";
import { useOwnVoice as runUseOwnVoice } from "../onboarding/UseOwnVoice.js";
import { isPiperAlreadyInstalled } from "../tts/PiperSetup.js";
import { showChatterboxInstructions } from "../onboarding/handleVoiceTier.js";
import { INSTALL_PIPER_VOICE_COMMAND, ttsBindingForTier, type VoiceTier } from "../onboarding/voiceTiers.js";
import {
  activeEntryId,
  activeLabel,
  bindingForEntry,
  buildVoiceMenuRows,
  galleryEntry,
  rememberRecent,
  type PrepareTarget,
  type VoiceMenuAction
} from "../views/voiceGallery/galleryModel.js";
import { findTrial, storeTrial, trialKey } from "../views/voiceGallery/trialAudioStore.js";
import { VoiceGalleryPanel } from "../views/voiceGallery/VoiceGalleryPanel.js";
import {
  ProfileEditorPanel,
  type ProfileEditorDeps,
  type WebviewToExtensionMessage as ProfileEditorTestMessage
} from "../views/profileEditor/ProfileEditorPanel.js";

/** Default `llmVoice.tts.readyTimeoutMs` (CdC §51's "Loading" health status):
 *  how long `start()` waits for a still-warming-up TTS server before
 *  attempting the first synthesis anyway, instead of failing immediately. */
/** `globalState` keys of the voice menu and the gallery (card 0-005). */
const RECENT_VOICES_KEY = "llmVoice.voices.recent";
const FAVORITE_VOICES_KEY = "llmVoice.voices.favorites";
/** Under `globalStorageUri`: the gallery's trial phrases, and nothing else. */
const GALLERY_TRIALS_FOLDER = "gallery-trials";

const DEFAULT_READY_TIMEOUT_MS = 180_000;
/** `globalState`: durations and rates by engine (`WaitMeasureStore`), never any text. */
const WAIT_MEASURES_KEY = "llmVoice.waitMeasures";
/** `globalState`: the fingerprints of the documents read with several voices (ADR-018 §3), nothing else. */
const CAST_DOCUMENTS_KEY = "llmVoice.cast.documents";
const CAST_STORE_ATTEMPTS = 5;
const CAST_STORE_SETTLE_MS = 50;
const SCENE_PREPARE = "Préparer";
const SCENE_READ_ANYWAY = "Lire quand même";
const CAST_VOICE_REQUIRED = "LLM Voice : ce moteur ne lit qu'à une seule voix. Pour donner une voix à chaque personnage, choisissez un moteur à plusieurs voix (galerie de voix). La lecture reste à une voix.";
const CAST_NARRATOR_ABSENT = "LLM Voice : la voix du narrateur n'est pas disponible sur le moteur de voix, elle manque à sa liste. Le jeu d'acteurs ne peut pas démarrer : choisissez une autre voix.";

/** What a reading with several voices needs on top of a plain one. */
interface CastReading {
  /** The source segments, labels removed. */
  segments: readonly SourceSegment[];
  /** Absent: one voice, the engine or the voice cannot do more. */
  voices?: {
    narration: readonly NarrationSegment[];
    plan: ReadingPlan;
    binding: AudioQueueBinding;
    speakers: CastSpeakers;
  };
}

/** For "qui parle". Names come from the content: shown, never logged. */
interface CastSpeakers {
  names: ReadonlyMap<string, string>;
  voiceLabels: ReadonlyMap<string, string>;
  narratorVoice: string | undefined;
}
const WAIT_TICK_MS = 1000;
/** How long the bar stays at 100 % once the sound has started. */
const WAIT_COMPLETE_HOLD_MS = 400;
/** A second passage ready before the sound: a slightly later start, no cut right after it. */
const START_AHEAD_PASSAGES = 1;
const HOLD_NOTICES: Readonly<Record<TtsHoldReason, PlayerNotice>> = {
  "gpu-yield": {
    title: "La voix se met en retrait pendant le jeu",
    body: "Le moteur libère la carte graphique tant que vous jouez. Relancez la lecture une fois le jeu terminé."
  },
  "gpu-memory": {
    title: "La carte graphique n'a pas assez de mémoire",
    body: "Le modèle a été déchargé. Fermez ce qui utilise la carte, puis réessayez."
  }
};
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
 * ADR-017 §1.4: asking an engine what it can do before a reading must not delay
 * one on an unreachable server: same bound as the voice lookup above.
 */
const ENGINE_CAPABILITIES_TIMEOUT_MS = 3_000;

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
 * when `llmVoice.chooseVoice` (a parallel onboarding story's command) is not
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

/**
 * GAO-qwen3-dans-l-001: per-request timeout of a whole-reading preparation, at least. Qwen3
 * needs about 2.7 s per second of audio: a 300-character passage (about 20 s heard) takes about
 * 55 s, at the edge of the 60 s default, and a timeout would throw the work away to retry it.
 */
const WHOLE_READING_TIMEOUT_MS = 180_000;

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
  /**
   * Test-only (bug fix, voice-selection-not-applied / infinite loop review):
   * overrides `CHATTERBOX_LOCAL_PRESET.baseUrl`/`PIPER_LOCAL_PRESET.baseUrl`
   * for `autoSelectTts()`'s own health probes — the two are otherwise
   * hardcoded, by design (ADR-009's zero-config "auto" chain probes a fixed
   * local address, never a user setting). A real integration test needs a
   * closed port it actually controls to deterministically prove "provider
   * unreachable → falls through the chain" regardless of whether a real
   * Chatterbox/Piper happens to be running on the machine executing the
   * suite — same rationale, same `extensionMode !== Production` gate
   * (`extension.ts`) as `ttsProviderOverride` above, never reachable from a
   * packaged install.
   */
  autoChatterboxBaseUrlOverride?: string;
  autoPiperLocalBaseUrlOverride?: string;
  /** Test-only, same gate: where the automatic choice and the Qwen3 fallback probe Qwen3 and Kyutai 1.6B. */
  autoQwen3BaseUrlOverride?: string;
  autoKyutai16BaseUrlOverride?: string;
  /**
   * Test-only (coordinator review, same trace as the two overrides above):
   * replaces `SystemTtsProvider`'s process/filesystem runner entirely
   * (`createTtsProvider`'s `systemRunner` option) whenever the resolved
   * provider is `"system"` — see `presets.ts`'s own doc comment for why
   * `PATH` manipulation alone could not make this deterministic.
   */
  systemRunnerOverride?: SystemTtsProcessRunner;
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
  private readonly autoChatterboxBaseUrlOverride: string | undefined;
  private readonly autoPiperLocalBaseUrlOverride: string | undefined;
  private readonly autoQwen3BaseUrlOverride: string | undefined;
  private readonly autoKyutai16BaseUrlOverride: string | undefined;
  /** One warning per cause and per VS Code session: the voice shown in the panel says the rest. */
  private readonly qwen3FallbackNoticesShown = new Set<string>();
  private readonly systemRunnerOverride: SystemTtsProcessRunner | undefined;
  private wait: WaitTracker | undefined;
  private waitTicker: ReturnType<typeof setInterval> | undefined;
  private waitCompleteTimer: ReturnType<typeof setTimeout> | undefined;
  private waitTitle = "";
  private waitEngineId = "";
  private firstChunkPaysForLoad = false;
  private notice: PlayerNotice | undefined;
  private heldTts: TtsProvider | undefined;
  private castBible: BibleStore | undefined;
  private currentSpeakers: CastSpeakers | undefined;
  /** The reply being read, when it is one: what the chip "Code : ignoré / lu" needs. */
  private responseBeingRead: ResponseBeingRead | undefined;
  /** A click on that chip, and the setting it was made against. */
  private responseCodeChoice: { value: boolean; setting: boolean } | undefined;
  private preparer: ReadingPreparer | undefined;
  /** Not part of `PipelineFacade`: what the integration tests await. */
  private preparation: Promise<void> | undefined;
  /** This session's "Lire à plusieurs voix", by document fingerprint: see `storeCastChoices`. */
  private readonly castChoices = new Map<string, boolean>();
  private castDocumentsWrite: Promise<void> = Promise.resolve();
  /** A long-scene question or a preparation under way: what Stop has to end while the player is idle. */
  private sceneAbort: AbortController | undefined;
  private sceneChoice: (message: string) => Thenable<string | undefined> = (message) =>
    vscode.window.showInformationMessage(message, SCENE_PREPARE, SCENE_READ_ANYWAY);
  private currentHeadings: readonly SourceSegment[] = [];
  private responseCodeIds: readonly string[] = [];

  private readonly egress: EgressGuardHandle;
  /** Propositions de voix d'après le texte, par document (clé : texte, personnages, modèle). */
  private readonly castProposals = new Map<string, readonly VerifiedProposal[]>();
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
  private readonly responses: ResponsesViewProvider;
  private responsesViewRegistration: vscode.Disposable | undefined;
  private inboxContentProviderRegistration: vscode.Disposable | undefined;

  private readonly warnIfInstallIsNewer: () => Promise<void>;
  private currentUri: vscode.Uri | undefined;
  private currentProfileLabel = "—";
  /**
   * Audit 2026-11-05 P1: mirrors `currentProfileLabel`, updated at every
   * site that updates it from a profile whose `tts.providerId` is known —
   * the only persistent, always-visible confirmation that a voice choice
   * took effect (`statusBarModel`/`pushPlayerState`), where previously only
   * a transitory toast confirmed it.
   */
  private currentVoiceLabel = "";
  /** ADR-017 §1.4: why what is heard differs from the speed asked; displayed by the header of card 0-007. */
  private currentSpeedGap: string | undefined;
  /** S8.2: `profile.synchronization.mode` for the session in progress, `"highlight-scroll"` (0.1 behaviour) until a session sets it. */
  private currentSyncMode: SyncMode = "highlight-scroll";
  private lastCaptureContext: CaptureContext | undefined;
  private captureAbort: AbortController | undefined;
  /** Set while `startInternal` prepares a reading, before the controller knows about it. */
  private pendingStart: AbortController | undefined;
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
  private disconnectNarration: (() => void) | undefined;
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
    this.warnIfInstallIsNewer = createInstallFreshnessCheck({
      bundlePath: installedBundlePath(this.context.extensionPath),
      activatedAtMs: Date.now(),
      showWarning: (message, action) => vscode.window.showWarningMessage(message, action),
      reloadWindow: () => vscode.commands.executeCommand("workbench.action.reloadWindow")
    });
    this.output = options.output;
    this.highlight = options.highlight;
    this.player = options.player;
    this.statusBar = options.statusBar;
    this.sinkOverride = options.sinkOverride;
    this.ttsProviderOverride = options.ttsProviderOverride;
    this.narratorProviderOverride = options.narratorProviderOverride;
    this.autoChatterboxBaseUrlOverride = options.autoChatterboxBaseUrlOverride;
    this.autoPiperLocalBaseUrlOverride = options.autoPiperLocalBaseUrlOverride;
    this.autoQwen3BaseUrlOverride = options.autoQwen3BaseUrlOverride;
    this.autoKyutai16BaseUrlOverride = options.autoKyutai16BaseUrlOverride;
    this.systemRunnerOverride = options.systemRunnerOverride;

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
    this.responses = new ResponsesViewProvider({
      extensionUri: this.context.extensionUri,
      player: this.player,
      list: () => this.inboxRepository.list(),
      actions: {
        speak: (entry) => this.speakInboxEntry(entry),
        openText: (entry) => this.openInboxFullResponse(entry),
        toggleRead: async (entry) => {
          await this.inboxRepository.markRead(entry.id, !entry.read);
          await this.refreshInbox();
        },
        remove: async (entry) => {
          await this.inboxRepository.remove(entry.id);
          await this.refreshInbox();
        },
        showAll: () => this.showAllResponses(),
        readClipboard: async () => void (await vscode.commands.executeCommand("llmVoice.speakClipboard")),
        connectTool: async () => void (await vscode.commands.executeCommand("llmVoice.installClaudeHook"))
      },
      onError: (error) => this.output.error("reply action failed", { error: messageOf(error) })
    });
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
      this.syncWaitWithState(change.state);
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

  /** ADR-017 V3: forgets the memoised `auto` resolution, as if `HEALTH_CACHE_TTL_MS` had elapsed. */
  resetAutoTtsCacheForTest(): void {
    this.autoTtsCache = undefined;
  }

  /** S9 (ADR-011 revision 2026-09-12): the unread badge currently shown on `llmVoice.inboxView` (and, transitively, the `llmVoice` activity bar icon). */
  getInboxBadgeForTest(): { value: number; tooltip: string } | undefined {
    return this.responses.shownBadge;
  }

  // ------------------------------------------------------------- lifecycle

  dispose(): void {
    this.endWaitTimers();
    this.preparer?.cancel();
    this.sceneAbort?.abort();
    this.controller.dispose();
    this.captureAbort?.abort();
    this.inboxWatcher.dispose();
    this.responses.dispose();
    this.responsesViewRegistration?.dispose();
    this.inboxContentProviderRegistration?.dispose();
  }

  // ---------------------------------------------------------------- start

  async start(captureContext: CaptureContext): Promise<void> {
    return this.startInternal(captureContext);
  }

  /** The panel's "Réessayer" after a mode jeu or a full GPU: the engine loads first, then the same passage. */
  async retryAfterHold(): Promise<void> {
    this.notice = undefined;
    this.notificationGate.clear("ttsUnavailable");
    const tts = this.heldTts;
    if (tts !== undefined) {
      const abort = new AbortController();
      this.pendingStart = abort;
      await this.prepareEngine(tts, { narrated: false, narrationChars: 0, firstPassagesChars: 0 }, abort.signal);
      if (this.pendingStart === abort) {
        this.pendingStart = undefined;
      }
      if (abort.signal.aborted) {
        this.endWait();
        return;
      }
    }
    this.pushPlayerState();
    this.controller.retryCurrentChunk();
  }

  /** The panel's "Lire avec la voix système": the same request, spoken by the system voice this once. */
  async readWithSystemVoice(): Promise<void> {
    this.notice = undefined;
    const context = this.lastCaptureContext;
    if (context !== undefined) {
      await this.startInternal(context, { systemVoice: true });
    }
  }

  /**
   * `doc.sourceType` (S5.1/S5.2) resolves the per-source default profile
   * via `llmVoice.profiles.bySource` (CdC §47, `resolveDefaultProfileId`)
   * — e.g. a Claude Code inbox message defaults to "Résumé LLM" — falling
   * back to the last-selected profile, then the collection default.
   */
  private async startInternal(captureContext: CaptureContext, options: { systemVoice?: boolean; readAnyway?: boolean } = {}): Promise<void> {
    this.lastCaptureContext = captureContext;
    this.notice = undefined;
    // One owner of the engine at a time: reading stops a preparation, which then resumes nothing.
    this.preparer?.cancel();
    this.sceneAbort = undefined;
    this.endWait();
    this.captureAbort?.abort();
    const abort = new AbortController();
    this.captureAbort = abort;
    this.pendingStart = abort;
    this.notificationGate.reset();
    void this.warnIfInstallIsNewer();

    try {
      const source = this.sources.find((candidate) => candidate.canCapture(captureContext));
      if (source === undefined) {
        void vscode.window.showWarningMessage("LLM Voice : aucune source disponible pour cette action.");
        return;
      }

      this.currentSpeakers = undefined;
      this.responseBeingRead = undefined;
      const doc = await source.capture(captureContext, abort.signal);
      const reading = await this.profiles.resolveReading(doc.sourceType, this.modesBySourceSettings());
      // ADR-017 §1.3: everything downstream receives the effective mode, whichever
      // voice it speaks with, and never needs to know where that voice came from.
      const profile: VoiceProfile = options.systemVoice === true
        ? { ...reading.effective, tts: { providerId: "system", baseUrl: "" } }
        : await this.withQwen3Fallback(reading.effective, abort.signal);
      this.waitTitle = doc.title ?? "";
      this.currentProfileLabel = profile.label;
      this.currentVoiceLabel = describeVoice(profile.tts);
      this.currentSyncMode = profile.synchronization?.mode ?? "highlight-scroll";

      // S8.3 (no Docker by default): a fresh install with no local engine
      // at all gets exactly one action ("Installer la voix française")
      // instead of building a session that is guaranteed to fail its first
      // chunk. `"retry"` re-runs this whole method once the voice is
      // installed — the original request is transparently resumed.
      if ((await this.ensureVoiceReady(profile, abort.signal)) === "retry") {
        return this.startInternal(captureContext, options);
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
      const tts = await this.ttsFor(profile);
      this.currentResolvedTts = await this.resolveTtsProviderConfig(profile);
      this.heldTts = tts;
      const cast = await this.castReadingFor(doc, captureContext, reading, profile, tts, abort.signal, options.systemVoice === true);
      if (abort.signal.aborted) {
        return;
      }
      // A warm-up is a synthesis: with several voices nothing leaves before the plan says so,
      // and never two requests at once (ADR-018 §5.2). Every other reading warms up as before.
      if (cast?.voices === undefined) {
        await this.ttsFor(profile, { warmUp: true });
      }
      const castPlan = cast?.voices?.plan;
      if (castPlan?.decision === "ask" && options.readAnyway !== true && cast?.voices !== undefined) {
        // Nothing leaves before the choice: no model load, no synthesis.
        this.sceneAbort = abort;
        this.preparation = this.askAboutLongScene(captureContext, cast.voices, tts, abort)
          .catch((error: unknown) => {
            this.output.error("long scene failed", { error: messageOf(error) });
          })
          .finally(() => {
            if (this.sceneAbort === abort) {
              this.sceneAbort = undefined;
            }
          });
        return;
      }
      const toRead = cast?.segments ?? segments;
      const narrated = narrator !== undefined;
      const passagesBeforeSound =
        castPlan !== undefined ? 1 + castPlan.leadChunks : 1 + (this.audioPrefetchChunks() > 0 ? START_AHEAD_PASSAGES : 0);
      const firstPassagesMin = castPlan !== undefined ? { firstPassagesMinMs: castPlan.leadSeconds * 1000 } : {};
      const narrationChars = charsOf(toRead.slice(0, DEFAULT_GROUP_SIZE).map((seg) => seg.rawText));
      // Grouped passages: the wait counts what the first requests really say.
      const firstTexts = cast?.voices !== undefined ? cast.voices.narration.map((seg) => seg.spokenText) : toRead.map((seg) => seg.rawText);
      // CdC §51 "Loading": the engine loads first, so that a synthesis request's
      // timeout measures a synthesis, and never the 40 to 60 s of a first load.
      // Everything already generated plays with no engine at all: nothing to load.
      if (castPlan?.decision !== "immediate") {
        await this.prepareEngine(
          tts,
          {
            narrated,
            narrationChars,
            firstPassagesChars: charsOf(firstTexts.slice(0, passagesBeforeSound)),
            ...firstPassagesMin
          },
          abort.signal
        );
      }
      if (abort.signal.aborted) {
        return;
      }
      if (narrated) {
        this.reviseWait("narration", {
          modelLoaded: true,
          narrated,
          narrationChars,
          firstPassagesChars: charsOf(toRead.slice(0, passagesBeforeSound).map((seg) => seg.rawText))
        });
      }
      const narrationStartedAt = Date.now();
      let narrationDegraded = false;
      const build = await buildSession(toRead, profile, narrator, {
        signal: abort.signal,
        onWarning: (warning) => {
          narrationDegraded = true;
          this.handleNarratorWarning(warning);
        }
      });
      if (narrated && !narrationDegraded && !abort.signal.aborted && narrationChars > 0) {
        this.recordWaitMeasure(tts.id, "narrationMsPerChar", (Date.now() - narrationStartedAt) / narrationChars);
      }
      this.stopNarration();
      this.currentSessionBuild = build;
      if (abort.signal.aborted) {
        return;
      }
      const toPlay = cast?.voices !== undefined ? [...cast.voices.narration] : this.passagesOfReply(doc, build.segments, profile, narrator !== undefined);
      this.reviseWait("first-passage", {
        modelLoaded: true,
        narrated: false,
        narrationChars: 0,
        firstPassagesChars: charsOf(toPlay.slice(0, passagesBeforeSound).map((seg) => seg.spokenText)),
        ...firstPassagesMin
      });
      // GAO-qwen3-dans-l-001: an engine slower than its audio prepares the whole reading before
      // its first sound, so that nothing cuts once it plays, with one voice or several (GAO-studio-distr-001).
      // A narrated reading (its passages still arrive) keeps its path.
      const capabilities = await tts.getCapabilities(abort.signal).catch(() => undefined);
      const wholeReading = capabilities?.wholeReadingFirst === true && !narrated && toPlay.length > 1;
      if (wholeReading) {
        this.reviseWait("whole-reading", {
          modelLoaded: true,
          narrated: false,
          narrationChars: 0,
          firstPassagesChars: charsOf(toPlay.map((seg) => seg.spokenText))
        });
        this.wait?.setPassages(0, toPlay.length);
        this.refreshWait();
      }
      const sink = this.sinkOverride ?? this.player.playbackSink;

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
      const engineSpeed = await this.engineSpeedFor(tts, requestedSpeed(reading.voice, reading.mode), abort.signal);
      if (abort.signal.aborted) {
        return;
      }
      this.pendingStart = undefined;
      // A narrated reading starts on its first group: the others arrive while it plays,
      // and only the end of the narration may end the reading.
      const narrating = narrator !== undefined;
      // Fixed for the whole reading: a voice changed now applies to the next one (ADR-017 §1.3).
      this.currentSpeakers = cast?.voices?.speakers;
      const starting = this.controller.start({
        segments: toPlay,
        profile: effectiveProfile,
        tts,
        sink,
        sealed: !narrating,
        startAhead: wholeReading ? toPlay.length - 1 : passagesBeforeSound - 1,
        ...(castPlan !== undefined ? { prefetchChunks: Math.max(castPlan.prefetchChunks, this.audioPrefetchChunks()) } : {}),
        ...(wholeReading ? { prefetchChunks: toPlay.length, timeoutMs: Math.max(this.ttsTimeoutMs(), WHOLE_READING_TIMEOUT_MS) } : {}),
        ...(engineSpeed !== undefined ? { engineSpeed } : {})
      });
      if (narrating) {
        this.disconnectNarration = build.onSegmentsAppended((added) => {
          if (this.currentSessionBuild === build) {
            this.controller.appendSegments(added);
          }
        });
        void build.completion.then(() => {
          if (this.currentSessionBuild === build) {
            this.controller.sealSegments();
          }
        });
      }
      await starting;
    } catch (error) {
      // A reading cancelled while preparing unwinds through here: the user asked for it.
      if (abort.signal.aborted) {
        return;
      }
      this.output.error("start failed", { error: messageOf(error) });
      void vscode.window.showErrorMessage(`LLM Voice : ${messageOf(error)}`);
    } finally {
      if (this.pendingStart === abort) {
        this.pendingStart = undefined;
      }
      // An early return or a cancel: nobody will tell this wait it is over.
      if (this.captureAbort === abort && !["preparing", "buffering", "playing"].includes(this.controller.getState())) {
        this.endWait();
      }
    }
  }

  /**
   * GAO-qwen3-dans-l-001: a reading asked of Qwen3 (chosen, or picked by the automatic choice)
   * that Qwen3 cannot give right now is read with Kyutai 1.6B, else the system voice, for this
   * reading only, and says so. Nothing is written: the next reading asks Qwen3 again.
   */
  private async withQwen3Fallback(profile: VoiceProfile, signal: AbortSignal): Promise<VoiceProfile> {
    const resolved = resolveTtsConfig(profile.tts, this.ttsSettings());
    if (resolved.providerId !== "qwen3") {
      return profile;
    }
    const gameMode = createGpuYieldProbe()();
    const kyutai16BaseUrl = this.autoKyutai16BaseUrlOverride ?? KYUTAI16_LOCAL_PRESET.baseUrl;
    const probe = async (preset: typeof QWEN3_LOCAL_PRESET, baseUrl: string) =>
      createTtsProvider(preset, { id: `fallback-probe-${preset.kind}`, baseUrl, egress: this.egress })
        .health(signal)
        .catch(() => undefined);
    const qwen3 = gameMode ? undefined : await probe(QWEN3_LOCAL_PRESET, resolved.baseUrl);
    const needsKyutai = !gameMode && (qwen3 === undefined || qwen3.status === "unreachable" || qwen3.status === "unauthorized" || qwen3.status === "unverified");
    const kyutai16 = needsKyutai ? await probe(KYUTAI16_LOCAL_PRESET, kyutai16BaseUrl) : undefined;
    const choice = chooseQwen3OrFallback({ gameMode, qwen3, kyutai16 });
    if (choice.use === "qwen3") {
      return profile;
    }
    const message = qwen3FallbackMessage(choice);
    this.output.warn("qwen3 fallback", { use: choice.use, reason: choice.reason });
    const noticeKey = `${choice.use}:${choice.reason}`;
    if (!this.qwen3FallbackNoticesShown.has(noticeKey)) {
      this.qwen3FallbackNoticesShown.add(noticeKey);
      void vscode.window.showWarningMessage(message);
    }
    const tts =
      choice.use === "kyutai-1-6b"
        ? { providerId: "kyutai-1-6b", baseUrl: kyutai16BaseUrl, voice: KYUTAI16_DEFAULT_VOICE }
        : { providerId: "system", baseUrl: "" };
    return { ...profile, tts };
  }

  // ------------------------------------------------------------ several voices (ADR-018)

  private castStore(): BibleStore {
    this.castBible ??= new BibleStore({ directory: vscode.Uri.joinPath(this.context.globalStorageUri, "direction").fsPath });
    return this.castBible;
  }

  private storedCastDocuments(): Readonly<Record<string, boolean>> {
    const stored = this.context.globalState.get<unknown>(CAST_DOCUMENTS_KEY);
    return typeof stored === "object" && stored !== null ? (stored as Record<string, boolean>) : {};
  }

  private isCastEnabled(rawKey: string): boolean {
    const key = documentKeyOf(rawKey);
    return this.castChoices.get(key) ?? this.storedCastDocuments()[key] === true;
  }

  /**
   * `globalState` is not a safe place to read back: each write comes back from the main
   * process with the whole state as it was, and that echo replaces what the extension
   * host holds, later writes included. Two writes a few milliseconds apart lose the second
   * (118 out of 400 on VS Code 1.145). So this session's choices are kept here, and written
   * until the store shows them.
   */
  private async storeCastChoices(): Promise<void> {
    for (let attempt = 0; attempt < CAST_STORE_ATTEMPTS; attempt += 1) {
      const documents = { ...this.storedCastDocuments() };
      for (const [key, enabled] of this.castChoices) {
        if (enabled) {
          documents[key] = true;
        } else {
          delete documents[key];
        }
      }
      await this.context.globalState.update(CAST_DOCUMENTS_KEY, documents);
      await new Promise((resolve) => setTimeout(resolve, CAST_STORE_SETTLE_MS));
      const stored = this.storedCastDocuments();
      if ([...this.castChoices].every(([key, enabled]) => (stored[key] === true) === enabled)) {
        return;
      }
    }
    this.output.warn("cast: the choice of documents could not be stored, it holds for this session");
  }

  /** A setting, retained for this document. Nothing here can start a reading. */
  async toggleCast(uri?: string): Promise<boolean | undefined> {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri.toString();
    if (target === undefined) {
      void vscode.window.showInformationMessage("LLM Voice : ouvrez d'abord un document.");
      return undefined;
    }
    const enabled = !this.isCastEnabled(target);
    this.castChoices.set(documentKeyOf(target), enabled);
    this.castDocumentsWrite = this.castDocumentsWrite.then(() => this.storeCastChoices());
    this.player.refreshDocument();
    return enabled;
  }

  private blocksOf(rawText: string, markdown: boolean, uri?: string): Promise<SourceBlock[]> | SourceBlock[] {
    return markdown ? parseMarkdown(rawText, uri) : plainTextBlocks(rawText);
  }

  /** The line of the "Document ouvert" block. A count, never a name. */
  async describeScript(document: { uri: string; languageId: string; text: string }): Promise<PlayerScriptView | undefined> {
    const markdown = document.languageId === "markdown";
    const script = parseScript(await this.blocksOf(document.text, markdown, document.uri), { plainText: !markdown });
    if (!script.active) {
      return script.dialogueBlocks >= 3
        ? { text: "Dialogues de roman : lus par le narrateur pour l'instant.", roles: 0, enabled: false }
        : undefined;
    }
    const count = script.roles.length;
    const people = count > 1 ? `${count} personnages` : "1 personnage";
    const reading = await this.profiles.resolveReading(markdown ? "markdown" : "text", this.modesBySourceSettings());
    const faithful = reading.effective.mode === "faithful";
    const enabled = this.isCastEnabled(document.uri);
    const found = enabled
      ? `Lecture à plusieurs voix activée, ${people}. Elle part quand vous la lancez.`
      : `${script.form === "theatre" ? "Théâtre repéré" : "Balises repérées"} : ${people}.`;
    return { text: faithful ? found : `${found} Réservé au mode Fidèle.`, roles: count, enabled };
  }

  private offerCastVoice(message: string): void {
    void vscode.window.showInformationMessage(message, "Choisir une voix").then((answer) => {
      if (answer === "Choisir une voix") {
        void this.chooseVoice();
      }
    });
  }

  /** The voices this engine can give, or why it cannot read with several (ADR-018 §3). */
  private async castVoicesOf(
    profile: VoiceProfile,
    tts: TtsProvider,
    signal?: AbortSignal
  ): Promise<{ voices: readonly Voice[]; effective: VoiceProfile; narratorVoice: string; playsStates: boolean; refused?: undefined } | { refused: string }> {
    const capabilities = await tts.getCapabilities(signal).catch(() => undefined);
    if (capabilities?.multiVoice !== true) {
      return { refused: CAST_VOICE_REQUIRED };
    }
    const effective = await this.withDefaultVoice(profile, tts, signal);
    const narratorVoice = effective.tts.voice;
    // A cloning sample or "Ma voix" as the narrator: this engine does not clone.
    if (narratorVoice === undefined || effective.tts.referenceAudio !== undefined) {
      return { refused: CAST_VOICE_REQUIRED };
    }
    const voices = (await tts.listVoices?.(signal)) ?? capabilities.voices;
    if (!voices.some((voice) => voice.id === narratorVoice)) {
      return { refused: CAST_NARRATOR_ABSENT };
    }
    return { voices, effective, narratorVoice, playsStates: capabilities.direction?.instructions === true };
  }

  /** Only a file has a bible on disk; a selection reads the file's cast, and writes nothing. */
  private castScopeOf(uri: string | undefined, rawText: string, capture: CaptureContext["scope"]) {
    const onDisk = uri?.startsWith("file:") === true && capture !== "clipboard" && capture !== "inbox-message";
    return { scope: documentScope(uri ?? rawText, { persist: onDisk }), readOnly: onDisk && capture === "selection" };
  }

  /**
   * What several voices change in this reading, or `undefined` for a reading that stays what
   * it was: not activated, not a script, not the faithful mode, or the guard refused.
   */
  private async castReadingFor(
    doc: SourceDocument,
    capture: CaptureContext,
    reading: { voice: Parameters<typeof requestedSpeed>[0]; mode: Parameters<typeof requestedSpeed>[1] },
    profile: VoiceProfile,
    tts: TtsProvider,
    signal: AbortSignal,
    systemVoice: boolean
  ): Promise<CastReading | undefined> {
    if (!this.isCastEnabled(doc.uri ?? doc.rawText)) {
      return undefined;
    }
    if (profile.mode !== "faithful") {
      void vscode.window.showInformationMessage("LLM Voice : le jeu d'acteurs est réservé au mode Fidèle. La lecture reste à une voix.");
      return undefined;
    }
    const markdown = doc.sourceType === "markdown";
    const blocks = await this.blocksOf(doc.rawText, markdown, doc.uri);
    const script = parseScript(blocks, { plainText: !markdown });
    if (!script.active) {
      return undefined;
    }
    // Each source keeps its own reading: a text file says its text as written, not normalised.
    const scripted = markdown ? segment(script.blocks, segmentationPolicyFor(profile, this.audioFirstChunkSentences())) : plainScriptSegments(script.blocks);
    const spoken = (seg: SourceSegment): string => seg.spokenText ?? seg.rawText;
    // Against what the plain reading of this very document delivers.
    if (!sameWordsApartFromLabels((await this.plainReadingOf(doc, profile)).map(spoken), scripted.map(spoken), script.labels)) {
      this.output.warn("cast abandoned: the reading with several voices changed words");
      void vscode.window.showWarningMessage("LLM Voice : ce découpage aurait changé des mots. Cette lecture reste à une voix.");
      return undefined;
    }
    this.currentHeadings = scripted.filter((seg) => seg.type === "heading");
    const segments = this.withinCapture(doc, scripted);
    const engine = await this.castVoicesOf(profile, tts, signal);
    if (engine.refused !== undefined) {
      if (!systemVoice) {
        this.offerCastVoice(engine.refused);
      }
      return { segments };
    }
    const { scope, readOnly } = this.castScopeOf(doc.uri, doc.rawText, capture.scope);
    const cast = await castFromBible(this.castStore(), scope, script, {
      providerId: tts.id,
      voices: engine.voices,
      narratorVoice: engine.narratorVoice,
      readOnly
    });
    const voiceOfRole = new Map(cast.entries.map((entry) => [entry.roleId, entry.voice]));
    const engineSpeed = await this.engineSpeedFor(tts, requestedSpeed(reading.voice, reading.mode), signal);
    const binding: AudioQueueBinding = bindingFrom(engine.effective, engineSpeed);
    const faithful = await buildSession(segments, profile);
    const narration = groupPassages(assignCast(faithful.segments, { binding, voiceOf: (speakerId) => voiceOfRole.get(speakerId), playsStates: engine.playsStates }), {
      maxSentences: profile.chunking.maxSentences,
      lang: profile.language
    });
    const providerId = tts.cacheIdentity !== undefined ? await tts.cacheIdentity(signal) : tts.id;
    const passages = await Promise.all(
      narration.map(async (seg) => {
        const key = cacheKeyFor(providerId, bindingForChunk(binding, seg.metadata?.["cast"] as AudioChunk["cast"]), seg.spokenText);
        return { chars: seg.spokenText.length, cached: (await this.diskCache.getMeta(key)) !== undefined };
      })
    );
    return {
      segments,
      voices: {
        narration,
        plan: planReading(passages),
        binding,
        speakers: {
          names: new Map(cast.entries.map((entry) => [entry.roleId, entry.name])),
          voiceLabels: new Map(engine.voices.map((voice) => [voice.id, voice.label])),
          narratorVoice: engine.narratorVoice
        }
      }
    };
  }

  /** "Rien ne part" (ADR-018 §5.1): the choice is a click, and each answer is a gesture. */
  private async askAboutLongScene(
    capture: CaptureContext,
    voices: NonNullable<CastReading["voices"]>,
    tts: TtsProvider,
    abort: AbortController
  ): Promise<void> {
    const minutes = Math.max(1, Math.ceil(voices.plan.synthesisSeconds / 60));
    const answer = await this.sceneChoice(`Cette scène demande environ ${minutes} min de préparation.`);
    // Another reading started meanwhile: this question is over.
    if (this.captureAbort !== abort || abort.signal.aborted) {
      return;
    }
    if (answer === SCENE_READ_ANYWAY) {
      await this.startInternal(capture, { readAnyway: true });
    } else if (answer === SCENE_PREPARE) {
      await this.prepareReading(capture, voices, tts, abort);
    }
  }

  /**
   * Fills the cache and stops there: `ReadingPreparer` has nothing to play with. The engine
   * loads first, as for a reading: the first request's timeout must measure a synthesis.
   */
  private async prepareReading(capture: CaptureContext, voices: NonNullable<CastReading["voices"]>, tts: TtsProvider, abort: AbortController): Promise<void> {
    if (this.controller.getState() !== "idle") {
      this.stopNarration();
      this.stopPlayer();
    }
    const preparer = new ReadingPreparer(
      { tts, cache: this.diskCache, binding: voices.binding },
      { maxRetries: this.audioMaxRetries(), timeoutMs: this.ttsTimeoutMs() }
    );
    this.preparer = preparer;
    const chunks = chunksFrom("preparation", voices.narration, 0);
    // Anything else has taken over, or Stop was pressed: nothing more to say, nothing to start.
    const over = (): boolean => abort.signal.aborted || this.captureAbort !== abort;
    let outcome: PreparationOutcome;
    try {
      outcome = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "LLM Voice : préparation de la lecture", cancellable: true },
        async (progress, token) => {
          token.onCancellationRequested(() => {
            preparer.cancel();
            abort.abort();
          });
          await this.prepareEngine(tts, { narrated: false, narrationChars: 0, firstPassagesChars: chunks[0]?.spokenText.length ?? 0 }, abort.signal).catch((error: unknown) => {
            if (!abort.signal.aborted) {
              throw error;
            }
          });
          // The bar of a reading: this is not one, and its first chunk is a preparation's to pay.
          this.firstChunkPaysForLoad = false;
          if (!over()) {
            this.endWait();
          }
          return preparer.run(chunks, (done, total) => progress.report({ increment: 100 / total, message: `${done} passages sur ${total}` }));
        }
      );
    } finally {
      if (this.preparer === preparer) {
        this.preparer = undefined;
      }
      if (this.captureAbort === abort) {
        this.endWait();
      }
    }
    if (over()) {
      return;
    }
    const stoppedAt = `Préparation arrêtée à ${outcome.done} passages sur ${outcome.total}.`;
    if (outcome.status === "ready") {
      const answer = await vscode.window.showInformationMessage(`LLM Voice : prêt, ${outcome.total} passages.`, "Lire");
      if (answer === "Lire" && !over()) {
        await this.startInternal(capture);
      }
    } else if (outcome.status === "held") {
      void vscode.window.showWarningMessage(`LLM Voice : ${HOLD_NOTICES[outcome.holdReason].title}. ${stoppedAt}`);
    } else if (outcome.status === "failed") {
      void vscode.window.showWarningMessage(`LLM Voice : le moteur de voix a échoué sur un passage (${outcome.error}). ${stoppedAt}`);
    }
  }

  /** Not part of `PipelineFacade`: resolves once the choice of documents has reached the store. */
  async flushCastDocumentsForTest(): Promise<void> {
    await this.castDocumentsWrite;
  }

  /** Not part of `PipelineFacade`: lets the integration tests answer the long-scene question. */
  setSceneChoiceForTest(choice: (message: string) => Thenable<string | undefined>): void {
    this.sceneChoice = choice;
  }

  getPreparationForTest(): Promise<void> | undefined {
    return this.preparation;
  }

  /** Not part of `PipelineFacade`: the line the panel shows for the passage being read. */
  getSpeakerLineForTest(): string | undefined {
    return this.speakerLine(this.controller.getChunks()[this.controller.getCurrentIndex()]);
  }

  /** "Juliette · voix Camille", in the panel only: the status bar keeps the effective voice. */
  private speakerLine(chunk: AudioChunk | undefined): string | undefined {
    const speakers = this.currentSpeakers;
    if (speakers === undefined || chunk?.cast === undefined) {
      return undefined;
    }
    const narrator = chunk.cast.speakerId === NARRATOR_SPEAKER_ID;
    const name = narrator ? "Narrateur" : speakers.names.get(chunk.cast.speakerId);
    const voice = speakers.voiceLabels.get(chunk.cast.voice ?? speakers.narratorVoice ?? "");
    const who = name !== undefined && voice !== undefined ? `${name} · voix ${voice}` : name;
    const state = chunk.cast.stage?.map((item) => item.label).join(", ");
    return who !== undefined && state ? `${who} · ${state}` : who;
  }

  /** The Quick Pick of ADR-018 §7, step 4: the Distribution panel comes at step 5. */
  async chooseCastVoices(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      void vscode.window.showInformationMessage("LLM Voice : ouvrez d'abord un document.");
      return;
    }
    const document = editor.document;
    const markdown = document.languageId === "markdown";
    const script = parseScript(await this.blocksOf(document.getText(), markdown, document.uri.toString()), { plainText: !markdown });
    if (!script.active) {
      void vscode.window.showInformationMessage("LLM Voice : aucun personnage repéré dans ce document.");
      return;
    }
    const reading = await this.profiles.resolveReading(markdown ? "markdown" : "text", this.modesBySourceSettings());
    const tts = await this.ttsFor(reading.effective);
    const engine = await this.castVoicesOf(reading.effective, tts);
    if (engine.refused !== undefined) {
      this.offerCastVoice(engine.refused);
      return;
    }
    const { scope } = this.castScopeOf(document.uri.toString(), document.getText(), "document");
    const context = { providerId: tts.id, voices: engine.voices, narratorVoice: engine.narratorVoice };
    const cast = await castFromBible(this.castStore(), scope, script, context);
    const labelOf = (id: string | undefined): string => engine.voices.find((voice) => voice.id === id)?.label ?? "voix absente";
    const rows = [
      { label: "Narrateur", description: `voix ${labelOf(engine.narratorVoice)}`, roleId: undefined as string | undefined, lines: 0 },
      ...cast.entries.map((entry) => ({
        label: entry.name,
        description: [
          `${entry.lines} répliques`,
          `voix ${labelOf(entry.voice)}`,
          ...(entry.locked ? ["Choisie par vous"] : []),
          ...(entry.shared ? ["Voix partagée"] : []),
          ...(entry.narratorClash ? ["Même voix que le narrateur"] : [])
        ].join(" · "),
        roleId: entry.roleId as string | undefined,
        lines: entry.lines
      }))
    ];
    const row = await vscode.window.showQuickPick(rows, { placeHolder: "Distribution : de qui changer la voix ?" });
    if (row === undefined) {
      return;
    }
    if (row.roleId === undefined) {
      await this.chooseVoice();
      return;
    }
    const takenBy = new Map(cast.entries.filter((entry) => entry.roleId !== row.roleId).map((entry) => [entry.voice, entry.name]));
    const voiceRows: (vscode.QuickPickItem & { voiceId?: string })[] = engine.voices.map((voice) =>
      voice.id === engine.narratorVoice
        ? { label: `${voice.label} : c'est la voix du narrateur`, kind: vscode.QuickPickItemKind.Separator }
        : {
            label: voice.label,
            voiceId: voice.id,
            ...(takenBy.has(voice.id) ? { description: `déjà prise par ${takenBy.get(voice.id) ?? ""}` } : {})
          }
    );
    const voiceRow = await vscode.window.showQuickPick(voiceRows, { placeHolder: `Voix de ${row.label}` });
    if (voiceRow?.voiceId === undefined) {
      return;
    }
    await recordUserVoice(this.castStore(), scope, row.roleId, tts.id, voiceRow.voiceId);
    void vscode.window.showInformationMessage(`LLM Voice : sera appliqué à la prochaine lecture, ${row.lines} répliques à régénérer.`);
  }

  /** Ce que le panneau Distribution lit d'un document : personnages, moteur, voix, bible. */
  private async castPanelContext(uri: string) {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
    const markdown = document.languageId === "markdown";
    const text = document.getText();
    const script = parseScript(await this.blocksOf(text, markdown, uri), { plainText: !markdown });
    const reading = await this.profiles.resolveReading(markdown ? "markdown" : "text", this.modesBySourceSettings());
    const tts = await this.ttsFor(reading.effective);
    const resolved = resolveTtsConfig(reading.effective.tts, this.ttsSettings());
    const capabilities = await tts.getCapabilities().catch(() => undefined);
    const multiVoice = capabilities?.multiVoice === true;
    const effective = await this.withDefaultVoice(reading.effective, tts);
    const narratorVoice = effective.tts.referenceAudio === undefined ? effective.tts.voice : undefined;
    const voices: readonly Voice[] = multiVoice ? ((await tts.listVoices?.()) ?? capabilities.voices) : [];
    const { scope } = this.castScopeOf(uri, text, "document");
    const firstLineOf = (roleId: string | undefined): string => {
      const block = script.blocks.find((item) => (item as { speakerId?: string }).speakerId === roleId && item.text.trim().length > 0);
      return (block?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    };
    return { document, script, tts, resolved, capabilities, multiVoice, effective, narratorVoice, voices, scope, firstLineOf };
  }

  private async castPanelState(uri: string): Promise<CastPanelState> {
    const context = await this.castPanelContext(uri);
    const { script, tts, resolved, capabilities, multiVoice, narratorVoice, voices, scope, firstLineOf } = context;
    const cast = await castFromBible(this.castStore(), scope, script, {
      providerId: tts.id,
      voices,
      narratorVoice,
      readOnly: !multiVoice
    });
    const labelOf = (id: string | undefined): string | undefined =>
      id === undefined ? undefined : (voices.find((voice) => voice.id === id)?.label ?? capabilities?.voices.find((voice) => voice.id === id)?.label ?? id);
    const canCreateVoice = resolved.providerId === "qwen3";
    const staticIds = new Set((capabilities?.voices ?? []).map((voice) => voice.id));
    return {
      documentName: context.document.uri.path.split("/").pop() ?? "document",
      engineLabel: engineLabelOf(resolved.providerId),
      narrator: { voiceLabel: labelOf(narratorVoice), firstLine: firstLineOf(undefined) },
      rows: cast.entries.map((entry) => ({
        roleId: entry.roleId,
        name: entry.name,
        lines: entry.lines,
        firstLine: firstLineOf(entry.roleId),
        voiceId: entry.voice,
        voiceLabel: labelOf(entry.voice),
        byUser: entry.origin === "user",
        shared: entry.shared,
        unavailable: entry.unavailable,
        narratorClash: entry.narratorClash,
        ...this.panelProposalOf(context.document.getText(), script, entry.roleId, voices, narratorVoice, cast.entries)
      })),
      voices: voices.map((voice) => ({
        id: voice.id,
        label: voice.label,
        created: !staticIds.has(voice.id),
        narrator: voice.id === narratorVoice,
        takenBy: cast.entries.filter((entry) => entry.voice === voice.id).map((entry) => entry.name)
      })),
      notice: script.active
        ? castNotice({ multiVoice, canCreateVoice, characters: cast.entries.length, freeVoices: voices.filter((voice) => voice.id !== narratorVoice).length })
        : "Aucun personnage repéré dans ce document : il sera lu par le narrateur.",
      canCreateVoice,
      slowFactor: capabilities?.wholeReadingFirst === true ? 2 : undefined,
      traitChoices: traitChoices()
    };
  }

  /** Les personnages tels que l'analyste les voit : identifiant et nom affiché, rien d'autre. */
  private proposalRolesOf(script: ReturnType<typeof parseScript>): ProposalRole[] {
    return script.roles.map((role) => ({ roleId: role.roleId, name: role.name }));
  }

  /**
   * « Proposer d'après le texte » : un appel à l'analyste local, mis en cache par document.
   * Mode jeu : aucun appel. Le journal ne porte que des comptes et des raisons, aucun mot du texte.
   */
  async prepareCastProposals(uri: string, signal?: AbortSignal): Promise<string> {
    const { document, script } = await this.castPanelContext(uri);
    const text = document.getText();
    const roles = this.proposalRolesOf(script);
    const llm = new OllamaDirectionLlm({ egress: this.egress, model: DEFAULT_DIRECTION_MODEL, temperature: 0 });
    const key = proposalCacheKey(text, roles, llm.model);
    if (this.castProposals.has(key)) {
      return "Propositions déjà prêtes pour ce texte.";
    }
    const outcome = await proposeCast(text, roles, llm, { gpuYield: createGpuYieldProbe(), ...(signal !== undefined ? { signal } : {}) });
    if (outcome.status === "gpu-yield") {
      this.output.info("distribution : propositions différées, mode jeu actif");
      return "Mode jeu actif : les propositions attendront la fin de la partie.";
    }
    if (outcome.status === "failed") {
      this.output.warn("distribution : propositions indisponibles", { reason: outcome.reason });
      return "L'analyste local ne répond pas (Ollama). Aucune proposition.";
    }
    this.castProposals.set(key, outcome.check.proposals);
    this.output.info("distribution : propositions", {
      roles: roles.length,
      proposed: outcome.check.proposals.length,
      fields: outcome.check.proposals.map((proposal) => Object.keys(proposal).filter((name) => name !== "roleId").length),
      rejected: outcome.check.rejected.map((item) => `${item.field}:${item.reason}`),
      durationMs: outcome.durationMs
    });
    return outcome.check.proposals.length > 0
      ? "Propositions prêtes, avec les mots du texte qui les fondent. Vous gardez le dernier mot."
      : "Aucun indice écrit sur l'âge ou le genre : aucune proposition.";
  }

  /** Une proposition déjà préparée pour ce personnage, et la voix la plus proche par sa description. */
  private panelProposalOf(
    text: string,
    script: ReturnType<typeof parseScript>,
    roleId: string,
    voices: readonly Voice[],
    narratorVoice: string | undefined,
    entries: readonly { readonly roleId: string; readonly voice: string | undefined }[]
  ): { proposal?: CastProposal } {
    const key = proposalCacheKey(text, this.proposalRolesOf(script), DEFAULT_DIRECTION_MODEL);
    const proposal = this.castProposals.get(key)?.find((item) => item.roleId === roleId);
    if (proposal === undefined) {
      return {};
    }
    const taken = new Set(entries.filter((entry) => entry.roleId !== roleId && entry.voice !== undefined).map((entry) => entry.voice as string));
    const voice = nearestVoice(proposal, voices, { ...(narratorVoice !== undefined ? { narratorVoice } : {}), taken });
    const labels = proposalLabels(proposal);
    return {
      proposal: {
        ...(labels.age !== undefined ? { age: labels.age } : {}),
        ...(labels.gender !== undefined ? { gender: labels.gender } : {}),
        ...(labels.character !== undefined ? { character: labels.character } : {}),
        quotes: labels.quotes,
        ...(voice !== undefined ? { voiceId: voice.id, voiceLabel: voice.label } : {})
      }
    };
  }

  /** Une phrase synthétisée pour le panneau, mise en cache comme les essais de la galerie. */
  private async castPanelSynthesis(uri: string, voice: string | undefined, text: string, signal: AbortSignal, trialDir: string): Promise<string> {
    const { tts, effective } = await this.castPanelContext(uri);
    const key = trialKey({ providerId: tts.id, ...(voice !== undefined ? { voice } : {}) }, effective.language, text);
    const existing = await findTrial(trialDir, key);
    if (existing !== undefined) {
      return existing;
    }
    const audio = await tts.synthesize({ text, language: effective.language, ...(voice !== undefined ? { voice } : {}) }, signal);
    return storeTrial(trialDir, key, audio.format, audio.data);
  }

  /** `LLM Voice: Distribution` : le panneau du document actif, même si les voix manquent. */
  async openCastPanel(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      void vscode.window.showInformationMessage("LLM Voice : ouvrez d'abord un document.");
      return;
    }
    const uri = editor.document.uri.toString();
    const languageId = editor.document.languageId;
    const trialDir = vscode.Uri.joinPath(this.context.globalStorageUri, "cast-trials");
    await vscode.workspace.fs.createDirectory(trialDir);
    const SAMPLE_PHRASE = "Bonjour, voici ma voix. Je peux lire ce texte pour vous.";
    CastPanel.open(
      {
        trialDir,
        documentKey: documentKeyOf(uri),
        loadState: () => this.castPanelState(uri),
        listenToFile: async (roleId, voiceId, signal) => {
          const context = await this.castPanelContext(uri);
          const voice = voiceId ?? (await this.castPanelState(uri)).rows.find((row) => row.roleId === roleId)?.voiceId ?? context.narratorVoice;
          const text = context.firstLineOf(roleId) || context.firstLineOf(undefined);
          return this.castPanelSynthesis(uri, voice, text, signal, trialDir.fsPath);
        },
        sampleToFile: async (voiceId, signal) => {
          const { resolved, tts } = await this.castPanelContext(uri);
          if (resolved.providerId === "qwen3") {
            const key = trialKey({ providerId: tts.id, voice: voiceId }, "sample", "GET /voices/sample");
            const existing = await findTrial(trialDir.fsPath, key);
            if (existing !== undefined) {
              return existing;
            }
            try {
              return await storeTrial(trialDir.fsPath, key, "wav", await fetchQwen3VoiceSample(this.egress, resolved.baseUrl, voiceId, signal));
            } catch (error) {
              this.output.warn("distribution : extrait indisponible, synthèse courte", { error: error instanceof Error ? error.message : String(error) });
            }
          }
          return this.castPanelSynthesis(uri, voiceId, SAMPLE_PHRASE, signal, trialDir.fsPath);
        },
        assign: async (roleId, voiceId) => {
          const { tts, scope } = await this.castPanelContext(uri);
          await recordUserVoice(this.castStore(), scope, roleId, tts.id, voiceId);
        },
        createVoice: async (input, signal) => {
          const { resolved, tts, scope, firstLineOf } = await this.castPanelContext(uri);
          if (resolved.providerId !== "qwen3") {
            throw new Error("Créer une voix demande la voix Qwen3.");
          }
          const sampleText = input.forRoleId !== undefined ? firstLineOf(input.forRoleId) : "";
          const created = await createQwen3Voice(
            this.egress,
            resolved.baseUrl,
            { name: input.name, description: input.description, ...(sampleText.length > 0 ? { sampleText } : {}) },
            signal
          );
          if (input.forRoleId !== undefined) {
            await recordUserVoice(this.castStore(), scope, input.forRoleId, tts.id, created.id);
          }
          return created;
        },
        read: async () => {
          if (!this.isCastEnabled(uri)) {
            await this.toggleCast(uri);
          }
          await this.start({ scope: "document", uri, languageId });
        },
        recast: async () => {
          const { tts, scope } = await this.castPanelContext(uri);
          await recastFromScratch(this.castStore(), scope, tts.id);
        },
        propose: async (signal) => this.prepareCastProposals(uri, signal),
        log: (message) => this.output.warn(message)
      },
      this.context.extensionUri
    );
  }

  castPanelStateForTest(): CastPanelState | undefined {
    return CastPanel.testOnlyState();
  }

  async dispatchCastPanelForTest(message: unknown): Promise<void> {
    await CastPanel.testOnlyDispatch(message);
  }

  observeCastPanelForTest(observer: ((message: unknown) => void) | undefined): void {
    CastPanel.testOnlyObserve(observer);
  }

  closeCastPanelForTest(): void {
    CastPanel.testOnlyClose();
  }

  /**
   * Opens the wait with its estimate, then, if the model is not loaded, asks for it and
   * waits. A server that cannot load on demand answers `ok` at once: the estimate still
   * counts its load, which the first synthesis then pays for, and that one is not measured.
   */
  private async prepareEngine(
    tts: TtsProvider,
    plan: { narrated: boolean; narrationChars: number; firstPassagesChars: number; firstPassagesMinMs?: number },
    signal: AbortSignal
  ): Promise<void> {
    this.waitEngineId = tts.id;
    this.firstChunkPaysForLoad = false;
    const health = await tts.health(signal).catch(() => undefined);
    if (signal.aborted) {
      return;
    }
    const loading = health?.status === "degraded" && health.detail === "loading";
    const cold = loading || health?.modelLoaded === false;
    this.beginWait(cold ? "engine" : plan.narrated ? "narration" : "first-passage", {
      ...plan,
      modelLoaded: !cold,
      ...(health?.loadingSinceMs !== undefined ? { loadingSinceMs: health.loadingSinceMs } : {})
    });
    if (!cold || this.ttsReadyTimeoutMs() <= 0) {
      this.firstChunkPaysForLoad = cold;
      return;
    }
    const startedAt = Date.now();
    await tts.prepare?.(signal);
    await this.waitForTtsReady(tts, signal);
    if (signal.aborted) {
      return;
    }
    const after = await tts.health(signal).catch(() => undefined);
    if (after?.modelLoaded === true || (after?.status === "ok" && after.modelLoaded === undefined)) {
      this.recordWaitMeasure(tts.id, "loadMs", (health?.loadingSinceMs ?? 0) + Date.now() - startedAt);
    } else {
      this.firstChunkPaysForLoad = true;
    }
  }

  private waitMeasures(): WaitMeasureStore {
    return sanitizeWaitMeasures(this.context.globalState.get(WAIT_MEASURES_KEY));
  }

  private recordWaitMeasure(engineId: string, kind: WaitMeasureKind, value: number): void {
    void this.context.globalState.update(WAIT_MEASURES_KEY, recordWaitMeasure(this.waitMeasures(), engineId, kind, value));
  }

  /** Not part of `PipelineFacade`: what the integration tests read back. */
  getWaitMeasuresForTest(): WaitMeasureStore {
    return this.waitMeasures();
  }

  private estimateFor(input: Omit<WaitEstimateInput, "measures">): WaitEstimate {
    return estimateWait({ ...input, measures: this.waitMeasures()[this.waitEngineId] });
  }

  private typicalWaitMs(step: WaitStep): number | undefined {
    return step === "engine" ? this.waitMeasures()[this.waitEngineId]?.loadMs : undefined;
  }

  private beginWait(step: WaitStep, input: Omit<WaitEstimateInput, "measures">): void {
    this.endWaitTimers();
    this.wait = new WaitTracker(step, this.estimateFor(input), Date.now, this.typicalWaitMs(step));
    this.waitTicker = setInterval(() => this.refreshWait(), WAIT_TICK_MS);
    (this.waitTicker as unknown as { unref?: () => void }).unref?.();
    this.refreshWait();
  }

  private reviseWait(step: WaitStep, input: Omit<WaitEstimateInput, "measures">): void {
    if (this.wait === undefined) {
      this.beginWait(step, input);
      return;
    }
    this.wait.revise(step, this.estimateFor(input), this.typicalWaitMs(step));
    this.refreshWait();
  }

  private refreshWait(): void {
    this.statusBar.update(this.statusBarModel(this.controller.getState()));
    this.pushPlayerState();
  }

  private endWaitTimers(): void {
    clearInterval(this.waitTicker);
    this.waitTicker = undefined;
    clearTimeout(this.waitCompleteTimer);
    this.waitCompleteTimer = undefined;
  }

  private endWait(): void {
    this.endWaitTimers();
    if (this.wait !== undefined) {
      this.wait = undefined;
      this.refreshWait();
    }
  }

  /** The first real sound: the bar reaches 100 %, is seen there, and goes. */
  private completeWait(): void {
    const wait = this.wait;
    if (wait === undefined) {
      return;
    }
    this.endWaitTimers();
    wait.complete();
    this.refreshWait();
    this.waitCompleteTimer = setTimeout(() => this.endWait(), WAIT_COMPLETE_HOLD_MS);
    (this.waitCompleteTimer as unknown as { unref?: () => void }).unref?.();
  }

  /** The machine's state decides when a wait ends, or when a new one starts mid-reading. */
  private syncWaitWithState(state: PlaybackState): void {
    if (state === "playing") {
      this.completeWait();
      return;
    }
    if (state === "buffering" || state === "preparing") {
      const next = this.controller.getChunks()[this.controller.getCurrentIndex()];
      if (state === "preparing" && this.wait !== undefined) {
        return;
      }
      this.beginWait(state === "buffering" ? "next-passage" : "first-passage", {
        modelLoaded: true,
        narrated: false,
        narrationChars: 0,
        firstPassagesChars: next?.spokenText.length ?? 0
      });
      return;
    }
    this.endWait();
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

  /** The whole document as the plain reading says it: the reference of the cast's fidelity guard. */
  private async plainReadingOf(doc: SourceDocument, profile: VoiceProfile): Promise<SourceSegment[]> {
    return doc.sourceType === "markdown"
      ? segment(
          await parseMarkdown(doc.rawText, doc.uri),
          segmentationPolicyFor(profile, this.audioFirstChunkSentences())
        )
      : plainTextSegments(doc.rawText);
  }

  private async buildSegments(doc: SourceDocument, profile: VoiceProfile): Promise<SourceSegment[]> {
    if (doc.sourceType === "claude-code") {
      return this.responseSegments(doc, profile);
    }
    const all = await this.plainReadingOf(doc, profile);
    this.currentHeadings = all.filter((seg) => seg.type === "heading");
    return this.withinCapture(doc, all);
  }

  /**
   * A reply is said, not dictated. Only this source: a document keeps its profile's policy and
   * a selection its text as written, which is also why `plainReadingOf`, the cast's reference,
   * stays as it is. No section line yet: a reply's sections are another card.
   */
  private async responseSegments(doc: SourceDocument, profile: VoiceProfile): Promise<SourceSegment[]> {
    const codeRead = this.responseCodeRead();
    const reading = await readResponse(doc.rawText, { readCode: codeRead, lang: profile.language });
    this.responseBeingRead = { hasCode: reading.hasCode, codeRead };
    this.currentHeadings = [];
    this.responseCodeIds = reading.segments.filter((seg) => seg.type === "code").map((seg) => seg.id);
    return reading.segments;
  }

  /**
   * A reply's short sentences leave together: "Bilan." alone comes back deformed. A narrated
   * reply arrives group by group and a document keeps its own cut (`passageGroups.ts`). Code
   * lines being read stay one by one: a line of code is not a sentence to run on from.
   */
  private passagesOfReply(doc: SourceDocument, segments: readonly NarrationSegment[], profile: VoiceProfile, narrated: boolean): NarrationSegment[] {
    if (doc.sourceType !== "claude-code" || narrated) {
      return [...segments];
    }
    const codeRead = this.responseBeingRead?.codeRead === true;
    const codeIds = new Set(codeRead ? this.responseCodeIds : []);
    return groupPassages(segments, {
      maxSentences: profile.chunking.maxSentences,
      lang: profile.language,
      keepApart: (segment) => segment.sourceSegmentIds.some((id) => codeIds.has(id))
    });
  }

  /** The chip's choice holds for the session, until the setting itself changes. */
  private responseCodeRead(): boolean {
    const setting = vscode.workspace.getConfiguration("llmVoice").get<boolean>("responses.readCode", false);
    return this.responseCodeChoice?.setting === setting ? this.responseCodeChoice.value : setting;
  }

  /** The chip "Code : ignoré / lu". A reading under way keeps its text: the next one takes the choice. */
  toggleResponseCode(): void {
    const setting = vscode.workspace.getConfiguration("llmVoice").get<boolean>("responses.readCode", false);
    this.responseCodeChoice = { value: !this.responseCodeRead(), setting };
    this.pushPlayerState();
  }

  private responseCodeChip(state: PlaybackState): ResponseCodeChipView | undefined {
    return responseCodeChipOf(this.responseBeingRead, this.responseCodeRead(), state);
  }

  /** @internal test seam */
  getResponseCodeChipForTest(): ResponseCodeChipView | undefined {
    return this.responseCodeChip(this.controller.getState());
  }

  /** Keeps what the selection or the cursor asked for. */
  private withinCapture(doc: SourceDocument, all: SourceSegment[]): SourceSegment[] {
    const captureRanges = readCaptureRanges(doc.metadata);
    if (captureRanges === undefined) {
      return all;
    }
    // `all` is in document order, and a segment over two passages stays one segment: read once.
    return all.filter((seg) => {
      const range = seg.sourceRange;
      return range !== undefined && captureRanges.some((passage) => rangesOverlap(range, passage));
    });
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
      hasNonEmptySelection: editor !== undefined && editor.selections.some((selection) => !selection.isEmpty)
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
    const passages = normalizeSelections(
      editor.selections.map((selection) => ({
        startLine: selection.start.line,
        startColumn: selection.start.character,
        endLine: selection.end.line,
        endColumn: selection.end.character
      }))
    );
    const firstPassage = passages[0];
    const context: CaptureContext = useSelection && firstPassage !== undefined
      ? {
          scope: "selection",
          uri: editor.document.uri.toString(),
          languageId: editor.document.languageId,
          selection: firstPassage,
          ...(passages.length > 1 ? { selections: passages } : {})
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

  /** The narration of the next groups stops with the reading, or the local model keeps working for nothing. */
  private stopNarration(): void {
    this.disconnectNarration?.();
    this.disconnectNarration = undefined;
    this.currentSessionBuild?.cancel();
    this.currentSessionBuild = undefined;
  }

  /** S7.3: same "no silent no-op" treatment as `pause()`. */
  async stop(): Promise<void> {
    // The controller stays idle while a reading is being prepared: without
    // this, a stop would answer "nothing to stop" and the reading would start.
    const pendingStart = this.pendingStart;
    if (pendingStart !== undefined) {
      this.pendingStart = undefined;
      pendingStart.abort();
    }
    // A question still open or a preparation under way: its late answer starts nothing.
    const scene = this.sceneAbort;
    this.sceneAbort = undefined;
    scene?.abort();
    this.preparer?.cancel();
    this.stopNarration();
    if (this.controller.getState() === "idle") {
      if (pendingStart === undefined && scene === undefined) {
        void vscode.window.showInformationMessage("LLM Voice : rien à arrêter.");
      }
      return;
    }
    this.stopPlayer();
  }

  private stopPlayer(): void {
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

  /**
   * `LLM Voice: Choisir le mode` (ADR-017 §3): how the text is read, never who
   * reads it: `global-voice.json` is not touched here. The Auto line is a separator:
   * the slot is reserved and inactive until ADR-013 is accepted (ADR-017 §4).
   */
  async chooseMode(): Promise<void> {
    const modes = await this.profiles.listEffective();
    const selected = await this.profiles.getSelected();
    const items: (vscode.QuickPickItem & { id?: string })[] = [
      { label: "Auto : bientôt disponible", kind: vscode.QuickPickItemKind.Separator },
      ...modes.map((row) => formatProfileQuickPickItem(row.effective, row.mode.id === selected.id, row.voiceOrigin))
    ];
    const picked = await vscode.window.showQuickPick(items, { placeHolder: "LLM Voice : choisir le mode" });
    if (picked?.id === undefined) {
      return;
    }
    await this.selectProfileById(picked.id);
    const reading = await this.profiles.resolveReading();
    this.warnIfVoiceLanguageDiffers(reading, declaredVoiceLanguage(reading.effective.tts));
  }

  /** Non-interactive selection (CdC §47); also what `chooseMode`'s Quick Pick calls into. */
  async selectProfileById(id: string): Promise<void> {
    const profiles = await this.profiles.list();
    const next = profiles.find((profile) => profile.id === id);
    if (next === undefined) {
      throw new Error(`LLM Voice : mode inconnu « ${id} ».`);
    }
    await this.profiles.select(id);
    this.currentProfileLabel = next.label;
    await this.refreshLocalModeBadge();
  }

  /**
   * ADR-017 §1.3 "Langue": inheritance does not depend on the language, or the voice
   * would change without having been asked to. A declared difference is said, with
   * the way out, and blocks nothing; an unknown language says nothing.
   */
  private warnIfVoiceLanguageDiffers(reading: ReadingResolution, voiceLanguage: string | undefined): void {
    if (voiceLanguage === undefined) {
      return;
    }
    const label = describeVoice(reading.effective.tts);
    const voice = { id: reading.effective.tts.voice ?? label, label, language: voiceLanguage };
    if (!voiceLanguageDiffers(voice, reading.mode.language)) {
      return;
    }
    const action = "Donner une voix propre à ce mode";
    void vscode.window
      .showWarningMessage(formatVoiceLanguageWarning(label, voiceLanguage, reading.mode.language), action)
      .then((choice) => {
        if (choice === action) {
          void this.openProfileEditorById(reading.mode.id);
        }
      });
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
    const modes = await this.profiles.listEffective();
    return vscode.window.showQuickPick(
      modes.map((row) => formatProfileQuickPickItem(row.effective, false, row.voiceOrigin)),
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
    const sink = this.sinkOverride ?? this.player.playbackSink;
    this.currentProfileLabel = profile.label;
    this.currentVoiceLabel = describeVoice(profile.tts);
    this.notificationGate.clear("playbackFailed");
    void this.warnIfInstallIsNewer();
    this.player.reveal();
    this.beginPerfSession();
    // Bug fix (voice-selection-not-applied / infinite loop): same
    // session-scoped default-voice fallback as `startInternal` — Test Voice
    // must not be the one path left able to send a voice-less "predefined"
    // request.
    const effectiveProfile = await this.withDefaultVoice(profile, tts);
    const voice = await this.profiles.getGlobalVoice();
    const engineSpeed = await this.engineSpeedFor(tts, requestedSpeed(voice, profile));
    await this.controller.start({
      segments: build.segments,
      profile: effectiveProfile,
      tts,
      sink,
      sealed: true,
      ...(engineSpeed !== undefined ? { engineSpeed } : {})
    });
  }

  /** `LLM Voice: Test Voice` (CdC §50): faithful reading of a short reference text via the pipeline. */
  async testVoice(): Promise<void> {
    try {
      const reading = await this.profiles.resolveReading();
      await this.speakTestText(reading.effective);
    } catch (error) {
      this.output.error("testVoice failed", { error: messageOf(error) });
      void vscode.window.showErrorMessage(`LLM Voice : ${messageOf(error)}`);
    }
  }

  // ---------------------------------------------------------- ADR-017 voice

  /**
   * `LLM Voice: Choisir la voix` (ADR-017 §3, card 0-005): the recent voices, then the
   * way to the gallery and to one's own voice. Asks no engine anything: the whole
   * list and the listening live in the gallery. `setupVoice` is an alias of this.
   */
  async chooseVoice(): Promise<void> {
    try {
      const voice = await this.profiles.getGlobalVoice();
      const binding = bindingOfGlobalVoice(voice);
      type Row = vscode.QuickPickItem & { action?: VoiceMenuAction };
      const rows = buildVoiceMenuRows({
        activeId: activeEntryId(binding),
        activeLabel: activeLabel(binding),
        recents: this.recentVoices()
      }).map(
        (row): Row =>
          row.separator === true
            ? { label: row.label, kind: vscode.QuickPickItemKind.Separator }
            : {
                label: row.label,
                ...(row.description !== undefined ? { description: row.description } : {}),
                ...(row.action !== undefined ? { action: row.action } : {})
              }
      );
      const picked = await vscode.window.showQuickPick(rows, {
        title: "LLM Voice : changer de voix",
        placeHolder: "Changer de voix"
      });
      switch (picked?.action?.kind) {
        case "voice":
          await this.chooseGalleryVoice(picked.action.entryId);
          return;
        case "gallery":
          await this.openVoiceGallery();
          return;
        case "ownVoice":
          await this.useOwnVoice();
          return;
        default:
          return;
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`LLM Voice : ${messageOf(error)}`);
    }
  }

  private recentVoices(): readonly string[] {
    return this.context.globalState.get<readonly string[]>(RECENT_VOICES_KEY, []);
  }

  /** A recent voice of the menu: the same whole binding as its card in the gallery. */
  private async chooseGalleryVoice(entryId: string): Promise<void> {
    const entry = galleryEntry(entryId);
    if (entry === undefined) {
      return;
    }
    const binding = bindingForEntry(entry, bindingOfGlobalVoice(await this.profiles.getGlobalVoice()));
    await this.profiles.setGlobalVoice(binding);
    await this.afterGlobalVoiceChange(declaredVoiceLanguage(binding));
  }

  /** `LLM Voice: Ouvrir la galerie de voix`, one tab whatever the number of calls. Plays and synthesizes nothing. */
  async openVoiceGallery(): Promise<void> {
    const trialDir = vscode.Uri.joinPath(this.context.globalStorageUri, GALLERY_TRIALS_FOLDER);
    await vscode.workspace.fs.createDirectory(trialDir);
    VoiceGalleryPanel.open(
      {
        trialDir,
        getGlobalVoice: () => this.profiles.getGlobalVoice(),
        applyBinding: async (binding) => {
          await this.profiles.setGlobalVoice(binding);
          await this.afterGlobalVoiceChange(declaredVoiceLanguage(binding));
        },
        checkHealth: (target, signal) => this.checkGalleryHealth(target, signal),
        isPiperInstalled: async () => (await isPiperAlreadyInstalled(this.piperInstallDir())) !== undefined,
        synthesizeToFile: (binding, text, signal) => this.synthesizeGalleryTrial(binding, text, signal, trialDir.fsPath),
        getFavorites: () => this.context.globalState.get<readonly string[]>(FAVORITE_VOICES_KEY, []),
        setFavorites: async (ids) => {
          await this.context.globalState.update(FAVORITE_VOICES_KEY, ids);
        },
        writeClipboard: async (text) => {
          await vscode.env.clipboard.writeText(text);
        },
        openExternal: async (url) => {
          await vscode.env.openExternal(vscode.Uri.parse(url, true));
        },
        prepare: (target) => this.prepareGalleryVoice(target),
        log: (message) => this.output.warn(message)
      },
      this.context.extensionUri
    );
  }

  private async prepareGalleryVoice(target: PrepareTarget): Promise<void> {
    switch (target) {
      case "piper":
        await vscode.commands.executeCommand(INSTALL_PIPER_VOICE_COMMAND);
        return;
      case "ownVoice":
        await this.useOwnVoice();
        return;
      case "chatterbox":
        await showChatterboxInstructions({
          showMessage: (message, options, ...items) => vscode.window.showInformationMessage(message, options, ...items),
          openExternal: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
          writeClipboardText: (text) => vscode.env.clipboard.writeText(text)
        });
        return;
    }
  }

  private async checkGalleryHealth(
    target: { providerId: string; baseUrl: string },
    signal: AbortSignal
  ): Promise<ProviderHealthStatus> {
    const candidate = await this.globalVoiceCandidate();
    const tts = await this.ttsFor({ ...candidate, tts: target });
    return (await tts.health(signal)).status;
  }

  /**
   * A trial phrase of the gallery: straight to the engine, without going through the
   * reading pipeline (`speakTestText`), so that it can be cancelled and plays in the
   * page. Same phrase on the same voice: the file already made, no second request.
   */
  private async synthesizeGalleryTrial(
    binding: TtsBinding & { providerId: string },
    text: string,
    signal: AbortSignal,
    trialDir: string
  ): Promise<string> {
    const candidate = await this.globalVoiceCandidate();
    const key = trialKey(binding, candidate.language, text);
    const existing = await findTrial(trialDir, key);
    if (existing !== undefined) {
      return existing;
    }
    const tts = await this.ttsFor({ ...candidate, tts: binding });
    const audio = await tts.synthesize(
      { text, language: candidate.language, ...(binding.voice !== undefined ? { voice: binding.voice } : {}) },
      signal
    );
    return storeTrial(trialDir, key, audio.format, audio.data);
  }

  /** Non-interactive counterpart of `chooseVoice()`'s voice rows: same write, same effects. */
  async chooseVoiceById(voiceId: string): Promise<void> {
    await this.applyEngineVoice(await this.globalVoiceCandidate(), { id: voiceId, label: voiceId });
  }

  /** The active mode as it would read with the global voice, its own voice left aside. */
  private async globalVoiceCandidate(): Promise<VoiceProfile> {
    const reading = await this.profiles.resolveReading();
    return { ...reading.mode, tts: bindingOfGlobalVoice(reading.voice) };
  }

  /** Cause D (ADR-017 §1.1): the engine the voice was listed by is saved with it. */
  private async applyEngineVoice(candidate: VoiceProfile, voice: Voice): Promise<void> {
    const resolved = await this.resolveTtsProviderConfig(candidate);
    const binding = bindingForEngineVoice(candidate.tts, resolved, voice.id);
    await this.profiles.setGlobalVoice({ ...binding, providerId: resolved.providerId });
    await this.afterGlobalVoiceChange(voice.language);
  }

  /**
   * Makes the choice visible at once, instead of leaving a toast its only effect
   * (real-user bug found by testing GAO-impl-mente-l-001), and says on the spot when
   * the active mode will not speak with it: the one case left where a chosen voice is
   * not heard, and it has to show (ADR-017 §1.3). A reading in progress keeps its voice.
   */
  private async afterGlobalVoiceChange(voiceLanguage?: string): Promise<void> {
    await this.refreshLocalModeBadge();
    this.pushPlayerState();
    const reading = await this.profiles.resolveReading();
    const chosenId = activeEntryId(bindingOfGlobalVoice(reading.voice));
    if (chosenId !== undefined) {
      await this.context.globalState.update(RECENT_VOICES_KEY, rememberRecent(this.recentVoices(), chosenId));
    }
    VoiceGalleryPanel.notifyVoiceChanged();
    const chosen = describeVoice(bindingOfGlobalVoice(reading.voice));
    if (reading.voiceOrigin === "mode") {
      const action = "Utiliser la voix globale";
      void vscode.window
        .showInformationMessage(
          `LLM Voice : voix « ${chosen} » choisie. Le mode « ${reading.mode.label} » garde sa voix propre : ` +
            `${describeVoice(reading.effective.tts)}.`,
          action
        )
        .then((choice) => {
          if (choice === action) {
            void this.useGlobalVoiceForMode(reading.mode.id);
          }
        });
      return;
    }
    void vscode.window.showInformationMessage(`LLM Voice : voix « ${chosen} » choisie.`);
    this.warnIfVoiceLanguageDiffers(reading, voiceLanguage ?? declaredVoiceLanguage(reading.effective.tts));
  }

  /** "Utiliser la voix globale": the mode inherits again, its own voice is dropped. */
  async useGlobalVoiceForMode(id: string): Promise<void> {
    await this.profiles.setModeVoice(id, undefined);
    await this.refreshLocalModeBadge();
    this.pushPlayerState();
  }

  /**
   * Quick Pick over `profile`'s TTS provider's voices, one immediate-preview
   * button per row (S8.2), for the profile editor's "Parcourir les voix"
   * (`ProfileEditorDeps.pickVoice`, which applies the result to its own unsaved
   * form instead of writing to disk). Resolves to `undefined` when the user cancels or the provider has
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
      quickPick.title = "LLM Voice : choisir la voix";
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

  /**
   * Plays the test text with the candidate voice, without leaving the Quick Pick and
   * without saving (S8.2). The `tts` is replaced whole, as the write would: the
   * preview used to replay the old sample even before anything was saved (cause A).
   */
  async previewVoice(profile: VoiceProfile, voiceId: string): Promise<void> {
    try {
      const resolved = await this.resolveTtsProviderConfig(profile);
      await this.speakTestText({ ...profile, tts: bindingForEngineVoice(profile.tts, resolved, voiceId) });
    } catch (error) {
      void vscode.window.showErrorMessage(`LLM Voice : ${messageOf(error)}`);
    }
  }

  /**
   * `LLM Voice: Use My Own Voice` (S8.2, CdC §55): the sample becomes the global voice
   * (ADR-017 §3), on the one engine that clones. A named voice goes with what it
   * replaces: the two are exclusive once chosen (ADR-017 §2).
   */
  async useOwnVoice(): Promise<void> {
    await runUseOwnVoice({
      extensionContext: this.context,
      applyReferenceAudio: async (absolutePath) => {
        const { speed: _speed, voice: _voice, ...current } = await this.profiles.getGlobalVoice();
        const binding: TtsBinding & { providerId: string } =
          current.providerId === "chatterbox"
            ? { ...current, referenceAudio: absolutePath }
            : {
                providerId: "chatterbox",
                baseUrl: CHATTERBOX_LOCAL_PRESET.baseUrl,
                referenceAudio: absolutePath
              };
        await this.profiles.setGlobalVoice(binding);
        await this.afterGlobalVoiceChange();
      },
      previewCurrentProfile: async () => {
        await this.speakTestText(await this.globalVoiceCandidate());
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
      // The form may hold a mode that inherits: it speaks, lists and connects with
      // the voice it would read with. What it saves stays what the form says.
      testProfile: async (profile) => this.speakTestText(await this.profiles.effectiveOf(profile)),
      listParameters: async (profile) => this.ttsParametersFor(await this.profiles.effectiveOf(profile)),
      pickVoice: async (profile) => this.pickVoiceForProfile(await this.profiles.effectiveOf(profile)),
      checkHealth: async (profile) => this.checkTtsHealth(await this.profiles.effectiveOf(profile))
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

  getVoiceGalleryHtmlForTest(): string | undefined {
    return VoiceGalleryPanel.testOnlyHtml();
  }

  async dispatchVoiceGalleryMessageForTest(message: unknown): Promise<void> {
    await VoiceGalleryPanel.testOnlyDispatch(message);
  }

  observeVoiceGalleryForTest(observer: ((message: unknown) => void) | undefined): void {
    VoiceGalleryPanel.testOnlyObserve(observer);
  }

  closeVoiceGalleryForTest(): void {
    VoiceGalleryPanel.testOnlyClose();
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

  /**
   * Real-user bug (2026-11-05): `ProfileEditorDeps.checkHealth` — probes
   * `profile`'s resolved TTS provider the same way everything else here
   * does (`ttsFor` + `.health()`, ADR-005), but from the *unsaved* form, so
   * a provider/Base URL mismatch shows up in the editor itself instead of
   * only surfacing as a "fetch failed" once the user tries to actually
   * speak something.
   */
  private async checkTtsHealth(profile: VoiceProfile): Promise<ProviderHealth> {
    const tts = await this.ttsFor(profile);
    return tts.health();
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
    const { effective: profile } = await this.profiles.resolveReading();
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
    const modes = await this.profiles.listEffective();
    const candidates = collectRemoteProviderIds(
      modes.map((row) => row.effective),
      await this.profiles.getGlobalVoice()
    );
    return vscode.window.showQuickPick(candidates, { placeHolder });
  }

  /** `llmVoice.modes.bySource`, or the deprecated `llmVoice.profiles.bySource` (CdC §47, ADR-017 §2). */
  private modesBySourceSettings(): BySourceSetting {
    return readModesBySource(vscode.workspace.getConfiguration("llmVoice"));
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
    // The gallery's trial phrases are audio cached on this machine too.
    await fs.rm(vscode.Uri.joinPath(this.context.globalStorageUri, GALLERY_TRIALS_FOLDER).fsPath, {
      recursive: true,
      force: true
    });
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
    const { effective: profile } = await this.profiles.resolveReading();
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
      const { effective: profile } = await this.profiles.resolveReading();
      this.currentProfileLabel = profile.label;
      this.currentVoiceLabel = describeVoice(profile.tts);
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
        chooseMode: async () => this.chooseMode()
      }
    );
  }

  /** The latest reply of any tool, in the mode `llmVoice.modes.bySource` gives it. Only ever a user's gesture. */
  async speakLatestResponse(): Promise<void> {
    const [latest] = await this.inboxRepository.list();
    if (latest === undefined) {
      void vscode.window.showInformationMessage("LLM Voice : aucune réponse pour l'instant.");
      return;
    }
    await this.speakInboxEntry(latest);
  }

  /** The whole list: its view, or the Quick Pick in a layout that has no view. */
  private async showAllResponses(): Promise<void> {
    if (vscode.workspace.getConfiguration("llmVoice").get<string>("ui.layout") === "full") {
      await vscode.commands.executeCommand("llmVoice.inboxView.focus");
    } else {
      await this.openInbox();
    }
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
    if (outcome.status === "already-installed") {
      // Real-user bug fix (2026-11-05): before this status existed, this
      // branch didn't exist either — every call re-downloaded, forever.
      // Same cache drop as "installed" (Sentinel review): without it, a
      // stale `autoTtsCache` from before Piper was ever detected could
      // still answer "déjà installée et prête" while synthesis kept using
      // whatever "auto" resolved to up to HEALTH_CACHE_TTL_MS ago.
      this.autoTtsCache = undefined;
      void vscode.window.showInformationMessage(
        "LLM Voice : la voix française (Piper) est déjà installée et prête à l'emploi."
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

  /** Speaks one inbox entry (list, Quick Pick, `speakLatestResponse`), marking it read first — zero autoplay: only ever reached from a command the user triggered. */
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
    await this.responses.refresh();
  }

  private inboxEntryFromCommandArg(arg: unknown): InboxEntry | undefined {
    return arg as InboxEntry | undefined;
  }

  /**
   * Registers the view "Réponses" (`full` layout, ADR-011), the `llm-voice-inbox:`
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

    this.responsesViewRegistration = vscode.window.registerWebviewViewProvider(
      ResponsesViewProvider.viewType,
      this.responses
    );

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

  private async ttsFor(profile: VoiceProfile, options: { warmUp?: boolean } = {}): Promise<TtsProvider> {
    if (this.ttsProviderOverride !== undefined) {
      return this.ttsProviderOverride;
    }
    const resolved = await this.resolveTtsProviderConfig(profile);
    const referenceAudioPath =
      profile.tts.referenceAudio !== undefined ? this.resolveReferenceAudioPath(profile.tts.referenceAudio) : undefined;
    // Two profiles sharing `providerId@baseUrl` but cloning different
    // reference voices must never share a `ChatterboxProvider` instance —
    // the upload (and the filename it memoises) is per-instance, so the
    // reference path is part of the registry/cache key too (ADR-017 §1.5).
    const key = ttsInstanceKey(resolved, referenceAudioPath);
    const existing = this.registry.get(key);
    if (existing !== undefined) {
      if (options.warmUp === true) {
        this.warmupIfEnabled(existing, key, profile.language, profile.tts.voice);
      }
      return existing;
    }
    const apiKey = await this.resolveApiKey(profile.tts.apiKeyRef, resolved.providerId);
    // ADR-005/D9: `providerId` picks the class (Chatterbox/Kokoro get their
    // engine-specific parameters, CdC §28), never anything but `baseUrl` +
    // an id string — `presetKindForProviderId` is the single place that maps
    // one to the other; anything unrecognised stays the generic OpenAI-
    // compatible client (enterprise/cloud tiers 2-3, ADR-009).
    const ttsKind = presetKindForProviderId(resolved.providerId);
    // ADR-016 §2: `kyutai-pocket`'s `languages` is never detected (no server
    // endpoint for it) — it only ever reflects what `KYUTAI_POCKET_LOCAL_PRESET`
    // declares the user's own `pocket-tts serve --language ...` was started
    // with. There is exactly one preset of this kind today (opt-in, no
    // per-profile override yet), so this direct reference is exact, not a
    // guess; a second `kyutai-pocket` preset would need this resolved by id
    // instead.
    const provider = createTtsProvider(
      {
        kind: ttsKind,
        baseUrl: resolved.baseUrl,
        ...(ttsKind === "kyutai-pocket" ? { languages: KYUTAI_POCKET_LOCAL_PRESET.languages } : {})
      },
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
        systemPiperInstallDir: this.piperInstallDir(),
        ...(this.systemRunnerOverride !== undefined ? { systemRunner: this.systemRunnerOverride } : {})
      }
    );
    this.registry.register(provider);
    // S6.2: warm up in the background, once per instance, and only for a
    // reading the user asked for: listing voices or checking health must not
    // start a synthesis (`warmedProviderIds` makes a later call a no-op).
    if (options.warmUp === true) {
      this.warmupIfEnabled(provider, key, profile.language, profile.tts.voice);
    }
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
   * ADR-009's zero-config default (S7.1), Qwen3 and Kyutai 1.6B first since
   * GAO-qwen3-dans-l-001: Chatterbox (if `health()`
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
    const chatterboxBaseUrl = this.autoChatterboxBaseUrlOverride ?? CHATTERBOX_LOCAL_PRESET.baseUrl;
    const piperLocalBaseUrl = this.autoPiperLocalBaseUrlOverride ?? PIPER_LOCAL_PRESET.baseUrl;
    const chatterboxProbe = new ChatterboxProvider({
      id: "auto-probe-chatterbox",
      baseUrl: chatterboxBaseUrl,
      egress: this.egress
    });
    const piperLocalProbe = new OpenAICompatibleTtsProvider({
      id: "auto-probe-piper-local",
      baseUrl: piperLocalBaseUrl,
      egress: this.egress
    });
    const qwen3BaseUrl = this.autoQwen3BaseUrlOverride ?? QWEN3_LOCAL_PRESET.baseUrl;
    const kyutai16BaseUrl = this.autoKyutai16BaseUrlOverride ?? KYUTAI16_LOCAL_PRESET.baseUrl;
    const qwen3Probe = createTtsProvider(QWEN3_LOCAL_PRESET, { id: "auto-probe-qwen3", baseUrl: qwen3BaseUrl, egress: this.egress });
    const kyutai16Probe = createTtsProvider(KYUTAI16_LOCAL_PRESET, { id: "auto-probe-kyutai16", baseUrl: kyutai16BaseUrl, egress: this.egress });
    // GAO-qwen3-dans-l-001: Qwen3 first, then Kyutai 1.6B, then the order of ADR-009. In game
    // mode both servers say `gpu_yield` and are skipped (`isHealthyEnough`).
    const config = await selectAutoTtsProvider(
      [
        { providerId: "qwen3", baseUrl: qwen3BaseUrl, health: (s) => qwen3Probe.health(s) },
        { providerId: "kyutai-1-6b", baseUrl: kyutai16BaseUrl, health: (s) => kyutai16Probe.health(s) },
        { providerId: "chatterbox", baseUrl: chatterboxBaseUrl, health: (s) => chatterboxProbe.health(s) },
        { providerId: "piper-local", baseUrl: piperLocalBaseUrl, health: (s) => piperLocalProbe.health(s) }
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
   * ADR-017 §1.4, first choice of the order: the speed the engine should apply, when
   * it declares one. `undefined` otherwise, and when nothing but ×1 is asked: no
   * capability request on the way to a reading that needs none.
   */
  private async engineSpeedFor(tts: TtsProvider, requested: number, signal?: AbortSignal): Promise<number | undefined> {
    if (requested === 1) {
      this.currentSpeedGap = undefined;
      return undefined;
    }
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), ENGINE_CAPABILITIES_TIMEOUT_MS);
    let speed: EngineSpeed;
    try {
      const capabilities = await tts.getCapabilities(controller.signal);
      speed = resolveEngineSpeed(requested, capabilities.parameters);
    } catch (error) {
      this.output.debug("engine capabilities unavailable", { error: messageOf(error) });
      speed = { route: "none", requested };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    this.currentSpeedGap = describeSpeedGap(speed);
    return speed.route === "engine" ? speed.speed : undefined;
  }

  /** ADR-017 V11: the gap the header of card 0-007 will show. */
  getSpeedGapForTest(): string | undefined {
    return this.currentSpeedGap;
  }

  /**
   * The quality tiers of `chooseVoice` (S7.2): the whole binding of the tier replaces
   * the global voice, a fresh, clean choice rather than a merge, so a stale
   * `baseUrl`/`voice` from another engine never survives under the new one.
   */
  async applyVoiceTierChoice(tier: VoiceTier): Promise<void> {
    await this.profiles.setGlobalVoice(ttsBindingForTier(tier));
    await this.afterGlobalVoiceChange();
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
      if (this.notificationGate.shouldNotify("playbackFailed")) {
        this.notificationGate.markShown("playbackFailed");
        void vscode.window.showErrorMessage(formatPlaybackFailedMessage(info.message));
      }
      return "skip";
    }
    this.statusBar.update({ ...this.statusBarModel("error") });

    // The mode jeu or a full GPU: nothing is retried, the panel says what happens and what can be done.
    if (info.chunk.holdReason !== undefined) {
      this.notice = HOLD_NOTICES[info.chunk.holdReason];
      this.player.reveal();
      this.pushPlayerState();
      return "stop";
    }

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
   * S7.3: "Choisir une voix" runs `llmVoice.chooseVoice` when that command is
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
      if (commands.includes("llmVoice.chooseVoice")) {
        await vscode.commands.executeCommand("llmVoice.chooseVoice");
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
    this.measureSynthesis(event);
    if (this.wait?.step === "whole-reading") {
      const chunks = this.controller.getChunks();
      this.wait.setPassages(chunks.filter((chunk) => chunk.audioUri !== undefined).length, chunks.length);
    }
    this.pushPlayerState();
    this.output.debug("chunk timing", {
      index: event.index,
      cacheHit: event.cacheHit,
      ready: event.ready,
      queueSize: event.queueSize,
      ...(event.synthesisMs !== undefined ? { synthesisMs: event.synthesisMs } : {})
    });
  }

  /** Characters and milliseconds only. A first request that also loaded the model measures nothing. */
  private measureSynthesis(event: ChunkTimingEvent): void {
    if (event.synthesisMs === undefined || !event.ready || event.cacheHit) {
      return;
    }
    if (event.index === 0 && this.firstChunkPaysForLoad) {
      this.firstChunkPaysForLoad = false;
      return;
    }
    const chars = this.controller.getChunks()[event.index]?.spokenText.length ?? 0;
    if (chars > 0) {
      this.recordWaitMeasure(this.waitEngineId, "synthesisMsPerChar", event.synthesisMs / chars);
    }
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
    // Not spent while the GPU is yielded to a game: the warm-up is an
    // optimisation, the next reading simply pays for it.
    if (!this.ttsWarmupEnabled() || this.warmedProviderIds.has(providerId) || createGpuYieldProbe()()) {
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
    const wait = this.wait?.view();
    return {
      // The machine stays idle during the steps before `controller.start`.
      state: wait !== undefined && state === "idle" ? "preparing" : toStatusBarState(state),
      ...(wait !== undefined && wait.percent < 100
        ? {
            wait: {
              shortLabel: wait.shortLabel,
              elapsedSeconds: wait.elapsedSeconds,
              showElapsed: wait.step !== "next-passage"
            }
          }
        : {}),
      profileLabel: this.currentProfileLabel,
      positionMs: this.controller.getPositionMs(),
      isLocalOnly: this.cachedLocalModeResult?.badge === "local",
      isRemoteProvider: remoteCheck?.status === "fail",
      voiceLabel: this.currentVoiceLabel
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
    const index = this.controller.getCurrentIndex();
    const state = this.controller.getState();
    const wait = this.wait?.view();
    const current = chunks[index];
    const reading = current === undefined ? undefined : describeReading(this.currentHeadings, current.sourceRanges);
    const ahead = chunks.length > 0 ? passagesAhead(chunks, index) : undefined;
    this.player.audioSink.pushState({
      session: "current",
      index: this.controller.getCurrentIndex(),
      total: chunks.length,
      profile: this.currentProfileLabel,
      voice: this.currentVoiceLabel,
      title: wait !== undefined && state === "idle" ? this.waitTitle : (this.currentUri?.path.split("/").pop() ?? ""),
      state: wait !== undefined && state === "idle" ? "preparing" : state,
      ...(wait !== undefined ? { wait } : {}),
      ...(ahead !== undefined ? { ahead } : {}),
      ...(reading !== undefined ? { reading } : {}),
      ...(this.notice !== undefined ? { notice: this.notice } : {}),
      ...((): { responseCode?: ResponseCodeChipView } => {
        const chip = this.responseCodeChip(wait !== undefined && state === "idle" ? "preparing" : state);
        return chip !== undefined ? { responseCode: chip } : {};
      })(),
      ...((): { speaker?: string } => {
        const speaker = state === "playing" || state === "paused" ? this.speakerLine(current) : undefined;
        return speaker !== undefined ? { speaker } : {};
      })()
    });
  }
}
