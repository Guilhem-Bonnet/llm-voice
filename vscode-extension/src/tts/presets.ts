/**
 * Named TTS presets covering ADR-009's three tiers on one contract: a preset
 * is pure data (`{kind, baseUrl, model?, voice?, remote}`) plus
 * `createTtsProvider`, the one factory that turns a preset (or an arbitrary
 * `baseUrl` for the generic tier) into a concrete `TtsProvider`. Profiles and
 * `llmVoice.tts.*` settings only ever name a preset id or a `providerId`
 * string — never a class (ADR-005).
 */

import type { TtsProvider } from "../core/tts.js";
import type { EgressGuardHandle } from "../net/EgressGuard.js";
import { ChatterboxProvider } from "./ChatterboxProvider.js";
import { KokoroProvider, KOKORO_DEFAULT_FR_VOICE } from "./KokoroProvider.js";
import { KyutaiPocketProvider } from "./KyutaiPocketProvider.js";
import { OpenAICompatibleTtsProvider } from "./OpenAICompatibleTtsProvider.js";
import { SystemTtsProvider, type SystemTtsProcessRunner } from "./SystemTtsProvider.js";

/** Which concrete class a preset instantiates; never guessed from an id (ADR-005). */
export type TtsPresetKind = "chatterbox" | "kokoro" | "kyutai-pocket" | "openai-compatible" | "system";

export interface TtsProviderPreset {
  id: string;
  label: string;
  kind: TtsPresetKind;
  baseUrl: string;
  model?: string;
  voice?: string;
  /**
   * Mirrors the `--language` flag the user's `pocket-tts serve` process was
   * started with (`kind: "kyutai-pocket"` only — ignored for every other
   * kind, same restriction as `referenceAudio`/`parameters` below). Unlike
   * those two fields, this one *is* read directly by `createTtsProvider`
   * itself (see its `"kyutai-pocket"` case) rather than merely mirrored by
   * `src/profiles/defaults.ts` into a profile — there is no `profile.tts.*`
   * field carrying it yet, and `KyutaiPocketProvider`'s own file header is
   * explicit that this can never be auto-detected (no endpoint exposes a
   * running server's language), so it must come from this static preset
   * data or an explicit caller, never a guess.
   */
  languages?: readonly string[];
  /**
   * Path to a reference sample for voice cloning (CdC §55, `chatterbox` kind
   * only). Relative paths are resolved against the extension root by
   * `Pipeline.ttsFor` (`docs/providers.md` "Voice cloning" documents exactly
   * how, and its dev-only limitation); this field itself is pure data, read
   * by nothing here — `src/profiles/defaults.ts` mirrors it into the shipped
   * profiles' `tts.referenceAudio`.
   */
  referenceAudio?: string;
  /**
   * Engine tuning mirrored into a profile's `tts.parameters` (documentation
   * only here, exactly like `referenceAudio` above — `createTtsProvider`
   * never reads a preset's `parameters`/`referenceAudio` itself, only its
   * `kind`/`baseUrl`; the *profile* is what actually carries them to a
   * `TtsRequest`, `AudioQueue.requestFor`).
   */
  parameters?: Readonly<Record<string, unknown>>;
  /** ADR-009: false for `localhost`-only tiers 1/1b, true for tier 2/3. */
  remote: boolean;
}

/**
 * ADR-009 niveau 1: Chatterbox Multilingual V3 on its RDNA4 container
 * default port.
 *
 * Bug fix (voice-selection-not-applied / infinite loop, 2026-09-12,
 * `_grimoire/_memory/shared-context.md`): this preset used to default to
 * voice-cloning against a SIWIS-derived French reference
 * (`referenceAudio: "../deploy/tts/reference-audio/fr-female-siwis.wav"`).
 * That path only ever resolves from a *repository checkout*
 * (`Pipeline.resolveReferenceAudioPath`'s own doc comment) — a packaged
 * `.vsix` does not bundle `deploy/` (ops tooling, not extension content),
 * so every install from the Marketplace/a built VSIX shipped a default
 * profile pointing at a file that exists nowhere on the user's disk.
 * `ChatterboxProvider` already degrades gracefully when a reference cannot
 * be read (falls back to `voice_mode: "predefined"`, defect 3's original
 * fix) — but nothing then supplied a `predefined_voice_id`, so the
 * fallback request was itself rejected (`HTTP 400`) by the community
 * server, which is what actually produced the "aucune voix configurée"
 * loop a real user hit on the 0.2.0 build.
 *
 * Fix, tranche taken and justified here rather than shipping the ~2 MB
 * sample inside every install: **stop defaulting to a reference that
 * cannot resolve outside dev** — `defaults.ts`/`DEFAULT_PROFILE` mirror
 * this preset's `referenceAudio` only `if (!== undefined)`, so dropping it
 * here means a fresh install's Chatterbox-backed profiles use the
 * predefined-voice path from the start. `Pipeline.withDefaultVoice` (new,
 * same fix) now guarantees a `tts.voice` is always resolved from
 * `listVoices()` before synthesis when the profile does not name one, so
 * "predefined" mode never again reaches the server without a
 * `predefined_voice_id`. Voice cloning remains fully supported — set
 * `tts.referenceAudio` explicitly (profile editor, `Use My Own Voice`,
 * S8.2) — it is simply no longer the unconditional shipped default.
 */
export const CHATTERBOX_LOCAL_PRESET: TtsProviderPreset = {
  id: "chatterbox-local",
  label: "Chatterbox (local, voix prédéfinie ou clonée FR)",
  kind: "chatterbox",
  baseUrl: "http://localhost:8004",
  parameters: { exaggeration: 0.4, cfg_weight: 0.5, temperature: 0.6 },
  remote: false
};

/** ADR-009 niveau 1: Kokoro, the lightweight fallback (CdC §27). */
export const KOKORO_LOCAL_PRESET: TtsProviderPreset = {
  id: "kokoro-local",
  label: "Kokoro (local)",
  kind: "kokoro",
  baseUrl: "http://localhost:8880",
  voice: KOKORO_DEFAULT_FR_VOICE,
  remote: false
};

/** ADR-009 niveau 1b: Piper behind an OpenAI-compatible wrapper, no GPU required. */
export const PIPER_LOCAL_PRESET: TtsProviderPreset = {
  id: "piper-local",
  label: "Piper (local, sans installation)",
  kind: "openai-compatible",
  baseUrl: "http://localhost:5000",
  voice: "fr_FR-siwis-medium",
  remote: false
};

/** ADR-009 niveaux 2/3: generic OpenAI-compatible endpoint (enterprise or cloud). */
export const OPENAI_COMPATIBLE_PRESET: TtsProviderPreset = {
  id: "openai-compatible",
  label: "Compatible OpenAI (générique)",
  kind: "openai-compatible",
  baseUrl: "",
  remote: true
};

/**
 * ADR-009 niveau 1b (S7.1, `SystemTtsProvider`): zero-install system voices
 * — Piper (once installed via `LLM Voice: Install Local Voice (Piper)`),
 * `espeak-ng`, macOS `say`, or Windows SAPI, in that order per platform.
 * `baseUrl` is empty and unused: `SystemTtsProvider` never makes a network
 * call (its file header), so there is nothing to point it at.
 */
export const SYSTEM_LOCAL_PRESET: TtsProviderPreset = {
  id: "system",
  label: "Voix système (aucune installation)",
  kind: "system",
  baseUrl: "",
  remote: false
};

/**
 * ADR-016 §2/§4 "voie intermédiaire" for Kyutai TTS: `pocket-tts serve`, a
 * Python process the user starts and keeps running themselves — opt-in and
 * advanced (no entry in `llmVoice.tts.provider`'s enum, never named by
 * `src/profiles/defaults.ts`'s shipped profiles: a user reaches this preset
 * only by naming it explicitly in their own profile). `languages: ["fr"]`
 * mirrors the one `--language` flag the label below requires of that
 * process — `createTtsProvider`'s `"kyutai-pocket"` case is what actually
 * reads it (see `TtsProviderPreset.languages`'s own doc comment); `voice:
 * "estelle"` by contrast is plain preset data here, exactly like every
 * other preset's `voice` (e.g. `KOKORO_LOCAL_PRESET`) — not read by
 * `createTtsProvider` itself. `"estelle"` is the one voice the official
 * README (`github.com/kyutai-labs/pocket-tts`, "Trying it with the CLI")
 * tags `(fr)`, and the first entry of `KYUTAI_POCKET_VOICE_CATALOG` (fix 2026-11-05: an
 * earlier version of this preset defaulted to `"alba"`, which that same
 * README tags English, not French — wrong for a preset whose entire
 * purpose is a French voice).
 */
export const KYUTAI_POCKET_LOCAL_PRESET: TtsProviderPreset = {
  id: "kyutai-pocket-local",
  label: "Kyutai Pocket TTS (local, nécessite d'avoir lancé « pocket-tts serve --language french » soi-même)",
  kind: "kyutai-pocket",
  baseUrl: "http://localhost:8000",
  languages: ["fr"],
  voice: "estelle",
  remote: false
};

export const TTS_PROVIDER_PRESETS: readonly TtsProviderPreset[] = [
  CHATTERBOX_LOCAL_PRESET,
  KOKORO_LOCAL_PRESET,
  PIPER_LOCAL_PRESET,
  SYSTEM_LOCAL_PRESET,
  KYUTAI_POCKET_LOCAL_PRESET,
  OPENAI_COMPATIBLE_PRESET
];

export function findTtsProviderPreset(id: string): TtsProviderPreset | undefined {
  return TTS_PROVIDER_PRESETS.find((preset) => preset.id === id);
}

export interface CreateTtsProviderOptions {
  /** Overrides `preset.baseUrl`; a profile's own `tts.baseUrl` always wins. */
  baseUrl?: string;
  /** Provider id stored in the cache key and shown in the UI; defaults per class. */
  id?: string;
  egress: EgressGuardHandle;
  /** Resolved secret value (`SecretStorage`, ADR-004/D9 niveau 2-3), never logged. */
  apiKey?: string;
  /**
   * Absolute filesystem path to a voice-cloning reference sample (CdC §55).
   * `chatterbox` kind only — ignored for every other preset kind. Callers
   * resolve a possibly-relative `profile.tts.referenceAudio`/
   * `preset.referenceAudio` to an absolute path themselves (`Pipeline.ttsFor`)
   * before reaching here; this factory never touches the filesystem.
   */
  referenceAudioPath?: string;
  /**
   * Voice name or voice-cloning URL (`http://`, `https://`, `hf://`) sent
   * when a request names none (`kind: "kyutai-pocket"` only — ignored for
   * every other preset kind, forwarded verbatim to
   * `KyutaiPocketProvider`'s own `defaultVoice` constructor option). No
   * caller resolves this from `preset.voice` today (that field stays plain
   * documentation for this kind too, see `KYUTAI_POCKET_LOCAL_PRESET`'s own
   * doc comment) — an explicit caller-supplied value only, same spirit as
   * `apiKey`/`referenceAudioPath` above.
   */
  defaultVoice?: string;
  /**
   * Bug fix (voice-selection-not-applied, defect 3): forwarded to
   * `ChatterboxProvider`'s own `onReferenceAudioWarning` — called (at most
   * once per instance) when `referenceAudioPath` cannot be read locally,
   * so the caller can surface a warning instead of the synthesis silently
   * failing. `chatterbox` kind only — ignored for every other preset kind.
   */
  onReferenceAudioWarning?: (message: string) => void;
  /**
   * `globalStorageUri/piper` (`kind: "system"` only): where `PiperSetup`
   * installs the optional Piper binary/voice — `SystemTtsProvider` only
   * ever trusts an install found there (its file header). `undefined`
   * disables the Piper tier for this instance (still falls back to
   * `espeak-ng`/`say`/SAPI).
   */
  systemPiperInstallDir?: string;
  /**
   * Test-only (coordinator review, voice-selection-not-applied / infinite
   * loop fix): replaces `SystemTtsProvider`'s default `child_process`/`fs`
   * runner (`createDefaultRunner`) entirely — `kind: "system"` only. Manipulating
   * the extension host's `PATH` to make `SystemTtsProvider` deterministic in
   * an integration test was verified live not to work (VS Code's own
   * "resolve shell environment" startup step re-derives `PATH` from the
   * real login shell regardless of what `.vscode-test.mjs`'s `env` sets);
   * injecting the runner directly is what actually removes the dependency
   * on whatever engines happen to be installed on the machine running the
   * suite. Same `extensionMode !== Production` gate as `ttsProviderOverride`
   * (`extension.ts`), never reachable from a packaged install.
   */
  systemRunner?: SystemTtsProcessRunner;
}

/**
 * Instantiates the `TtsProvider` a preset (or a bare `kind`) describes. The
 * one place that maps `TtsPresetKind` to a class, so the rest of the
 * codebase only ever handles `TtsProvider` (ADR-005).
 */
export function createTtsProvider(
  preset: Pick<TtsProviderPreset, "kind" | "baseUrl" | "languages">,
  options: CreateTtsProviderOptions
): TtsProvider {
  const baseUrl = options.baseUrl ?? preset.baseUrl;
  const providerOptions = {
    baseUrl,
    egress: options.egress,
    ...(options.id !== undefined ? { id: options.id } : {}),
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {})
  };
  switch (preset.kind) {
    case "chatterbox":
      return new ChatterboxProvider({
        ...providerOptions,
        ...(options.referenceAudioPath !== undefined ? { referenceAudioPath: options.referenceAudioPath } : {}),
        ...(options.onReferenceAudioWarning !== undefined
          ? { onReferenceAudioWarning: options.onReferenceAudioWarning }
          : {})
      });
    case "kokoro":
      return new KokoroProvider(providerOptions);
    case "kyutai-pocket":
      return new KyutaiPocketProvider({
        ...providerOptions,
        languages: preset.languages ?? [],
        ...(options.defaultVoice !== undefined ? { defaultVoice: options.defaultVoice } : {})
      });
    case "openai-compatible":
      return new OpenAICompatibleTtsProvider(providerOptions);
    case "system":
      return new SystemTtsProvider({
        ...(options.id !== undefined ? { id: options.id } : {}),
        ...(options.systemPiperInstallDir !== undefined ? { piperInstallDir: options.systemPiperInstallDir } : {}),
        ...(options.systemRunner !== undefined ? { runner: options.systemRunner } : {})
      });
    default: {
      const exhaustive: never = preset.kind;
      return exhaustive;
    }
  }
}

/** `TtsPresetKind` for a resolved `providerId` (`chatterbox`, `kokoro`, `system`, ...), else generic. */
export function presetKindForProviderId(providerId: string): TtsPresetKind {
  if (providerId === "chatterbox") {
    return "chatterbox";
  }
  if (providerId === "kokoro") {
    return "kokoro";
  }
  if (providerId === "system") {
    return "system";
  }
  // Convention (`chatterbox`/`kokoro`/`system` above): a *provider* id, not
  // a *preset* id — `"kyutai-pocket-local"` (`KYUTAI_POCKET_LOCAL_PRESET.id`)
  // is deliberately not matched here, same as `"chatterbox-local"`/
  // `"kokoro-local"` never were.
  if (providerId === "kyutai-pocket") {
    return "kyutai-pocket";
  }
  return "openai-compatible";
}
