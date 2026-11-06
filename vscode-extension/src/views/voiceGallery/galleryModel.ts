/**
 * What the voice gallery offers and what each entry writes (ADR-017 § Découpe,
 * card 0-005; ADR-016 §4). Pure and vscode-free. Every message from the page is
 * validated here before anything acts on it: the page is a display, never a source
 * of ids, URLs or commands.
 */

import type { TtsBinding } from "../../core/profile.js";
import { CHATTERBOX_COMPOSE_COMMAND, ttsBindingForTier } from "../../onboarding/voiceTiers.js";
import { bindingForEngineVoice, describeVoice } from "../../profiles/voiceResolution.js";
import { KOKORO_DEFAULT_FR_VOICE } from "../../tts/KokoroProvider.js";
import { KYUTAI_POCKET_VOICE_CATALOG } from "../../tts/kyutaiVoiceCatalog.js";
import {
  CHATTERBOX_LOCAL_PRESET,
  KOKORO_LOCAL_PRESET,
  KYUTAI_POCKET_LOCAL_PRESET
} from "../../tts/presets.js";
import { PIPER_VOICE_ID } from "../../tts/SystemTtsProvider.js";

export type ServerEngine = "kyutai" | "kokoro" | "chatterbox";
export type GalleryEngine = ServerEngine | "system" | "own-voice";
export type PrepareTarget = "chatterbox" | "ownVoice" | "piper";
export type EngineStatus = "started" | "stopped" | "unknown";
export type GallerySection = "local" | "kyutai" | "prepare";

export interface GalleryEntry {
  id: string;
  label: string;
  engine: GalleryEngine;
  detail?: string;
  /** Path under `media/` of an included sample, played in the page itself. */
  sample?: string;
}

const KYUTAI_ENTRIES: readonly GalleryEntry[] = KYUTAI_POCKET_VOICE_CATALOG.map((voice) => ({
  id: voice.id,
  label: voice.label,
  engine: "kyutai",
  ...(voice.preview !== undefined ? { sample: voice.preview } : {})
}));

export const GALLERY_ENTRIES: readonly GalleryEntry[] = [
  { id: "system", label: "Voix système", engine: "system", detail: "Déjà sur votre machine, qualité correcte." },
  { id: "piper", label: "Piper Siwis", engine: "system", detail: "Voix française autonome, bonne qualité." },
  { id: "kokoro", label: "Kokoro Siwis", engine: "kokoro" },
  ...KYUTAI_ENTRIES,
  { id: "chatterbox", label: "Chatterbox", engine: "chatterbox", detail: "Qualité maximale. Nécessite Docker." },
  { id: "own-voice", label: "Ma voix", engine: "own-voice", detail: "Clonez votre voix, le fichier reste sur votre machine." }
];

const ENTRY_BY_ID = new Map(GALLERY_ENTRIES.map((entry) => [entry.id, entry]));
const KNOWN_IDS: ReadonlySet<string> = new Set(ENTRY_BY_ID.keys());

export function galleryEntry(id: string): GalleryEntry | undefined {
  return ENTRY_BY_ID.get(id);
}

export function knownGalleryIds(): ReadonlySet<string> {
  return KNOWN_IDS;
}

/** What the voice menu announces: every entry that can be chosen and listened to as it is. */
export const GALLERY_VOICE_COUNT = GALLERY_ENTRIES.filter(
  (entry) => entry.engine !== "own-voice" && entry.engine !== "chatterbox"
).length;

/** Spoken when the phrase field is empty on a voice with no included sample. */
export const DEFAULT_TRIAL_PHRASE = "Bonjour. Je lis ce document à voix haute.";
export const MAX_TRIAL_PHRASE_LENGTH = 300;

const SERVER_PRESETS: Readonly<Record<ServerEngine, { providerId: string; baseUrl: string }>> = {
  kyutai: { providerId: "kyutai-pocket", baseUrl: KYUTAI_POCKET_LOCAL_PRESET.baseUrl },
  kokoro: { providerId: "kokoro", baseUrl: KOKORO_LOCAL_PRESET.baseUrl },
  chatterbox: { providerId: "chatterbox", baseUrl: CHATTERBOX_LOCAL_PRESET.baseUrl }
};

/** The server this engine talks to: the one already configured for it, or its preset. */
export function engineUrl(engine: ServerEngine, current: TtsBinding): string {
  const preset = SERVER_PRESETS[engine];
  return current.providerId === preset.providerId && current.baseUrl !== undefined && current.baseUrl.length > 0
    ? current.baseUrl
    : preset.baseUrl;
}

export function engineProviderId(engine: ServerEngine): string {
  return SERVER_PRESETS[engine].providerId;
}

/**
 * The whole binding an entry writes: engine, voice and URL together, nothing of the
 * former voice surviving under another engine (cause D of ADR-017 §1.1). `own-voice`
 * has none here: it needs a file, which only the `useOwnVoice` flow can provide.
 */
export function bindingForEntry(entry: GalleryEntry, current: TtsBinding): TtsBinding & { providerId: string } {
  switch (entry.id) {
    case "system":
      return ttsBindingForTier("system");
    case "piper":
      return ttsBindingForTier("piper");
    case "kokoro":
      return serverVoice("kokoro", current, KOKORO_DEFAULT_FR_VOICE);
    case "chatterbox":
      return { providerId: SERVER_PRESETS.chatterbox.providerId, baseUrl: engineUrl("chatterbox", current) };
    default:
      return serverVoice("kyutai", current, entry.id);
  }
}

function serverVoice(engine: ServerEngine, current: TtsBinding, voice: string): TtsBinding & { providerId: string } {
  const providerId = SERVER_PRESETS[engine].providerId;
  // A sample binds to a voice no more than a name does: `bindingForEngineVoice` drops it.
  const binding = bindingForEngineVoice(current, { providerId, baseUrl: engineUrl(engine, current) }, voice);
  return { ...binding, providerId };
}

/** Which entry a binding is, so its card says "Choisie"; `undefined` when it is none of the gallery's. */
export function activeEntryId(binding: TtsBinding): string | undefined {
  if (binding.referenceAudio !== undefined) {
    return "own-voice";
  }
  switch (binding.providerId) {
    case "system":
      return binding.voice === PIPER_VOICE_ID ? "piper" : "system";
    case "kokoro":
      return binding.voice === undefined || binding.voice === KOKORO_DEFAULT_FR_VOICE ? "kokoro" : undefined;
    case "chatterbox":
      return "chatterbox";
    case "kyutai-pocket": {
      const id = binding.voice;
      return id !== undefined && galleryEntry(id)?.engine === "kyutai" ? id : undefined;
    }
    default:
      return undefined;
  }
}

/** The active voice as the header names it. */
export function activeLabel(binding: TtsBinding): string {
  const id = activeEntryId(binding);
  return id !== undefined ? (galleryEntry(id)?.label ?? describeVoice(binding)) : describeVoice(binding);
}

/** A server on this machine: the only place probed without a click. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function portOf(url: string): string | undefined {
  try {
    return new URL(url).port || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The command to run oneself, adapted to the configured port. Shown and copied, never
 * run: starting a server belongs to card 0-006.
 */
export function startCommand(engine: ServerEngine, url: string): string {
  const port = portOf(url);
  switch (engine) {
    case "kyutai": {
      const base = "pocket-tts serve --language french";
      return port !== undefined && port !== portOf(KYUTAI_POCKET_LOCAL_PRESET.baseUrl) ? `${base} --port ${port}` : base;
    }
    case "kokoro":
      return `docker run --rm -p 127.0.0.1:${port ?? "8880"}:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest`;
    case "chatterbox":
      return CHATTERBOX_COMPOSE_COMMAND;
  }
}

export const ENGINE_NAMES: Readonly<Record<ServerEngine, string>> = {
  kyutai: "Kyutai",
  kokoro: "Kokoro",
  chatterbox: "Chatterbox"
};

// ---------------------------------------------------------------- cards

export interface GalleryCard {
  id: string;
  label: string;
  section: GallerySection;
  ready: boolean;
  canChoose: boolean;
  canListen: boolean;
  detail?: string;
  state?: string;
  sampleUri?: string;
  engine?: ServerEngine;
  prepare?: PrepareTarget;
  prepareLabel?: string;
}

export interface CardInputs {
  status: Readonly<Record<ServerEngine, EngineStatus>>;
  piperInstalled: boolean;
  sampleUri: (path: string) => string;
}

function isServerEngine(engine: GalleryEngine): engine is ServerEngine {
  return engine === "kyutai" || engine === "kokoro" || engine === "chatterbox";
}

export function buildCards(inputs: CardInputs): GalleryCard[] {
  return GALLERY_ENTRIES.map((entry) => cardOf(entry, inputs));
}

function cardOf(entry: GalleryEntry, inputs: CardInputs): GalleryCard {
  const base = {
    id: entry.id,
    label: entry.label,
    ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    ...(entry.sample !== undefined ? { sampleUri: inputs.sampleUri(entry.sample) } : {}),
    ...(isServerEngine(entry.engine) ? { engine: entry.engine } : {})
  };
  const started = isServerEngine(entry.engine) && inputs.status[entry.engine] === "started";
  switch (entry.id) {
    case "system":
      return { ...base, section: "local", ready: true, canChoose: true, canListen: true, state: "Prête" };
    case "piper":
      return inputs.piperInstalled
        ? { ...base, section: "local", ready: true, canChoose: true, canListen: true, state: "Installée" }
        : {
            ...base,
            section: "prepare",
            ready: false,
            canChoose: false,
            canListen: false,
            prepare: "piper",
            prepareLabel: "Installer"
          };
    case "kokoro":
      return {
        ...base,
        section: "local",
        ready: started,
        canChoose: true,
        canListen: true,
        state: started ? "Démarrée" : "Arrêtée",
        detail: started ? "Voix locale rapide." : "Voix locale rapide. Serveur à démarrer."
      };
    case "chatterbox":
      return {
        ...base,
        section: "prepare",
        ready: started,
        canChoose: started,
        canListen: false,
        prepare: "chatterbox",
        prepareLabel: "Préparer"
      };
    case "own-voice":
      return {
        ...base,
        section: "prepare",
        ready: false,
        canChoose: false,
        canListen: false,
        prepare: "ownVoice",
        prepareLabel: "Préparer"
      };
    default:
      return { ...base, section: "kyutai", ready: started, canChoose: true, canListen: true };
  }
}

// ---------------------------------------------------------------- credits

export interface CreditGroup {
  source: string;
  licence: string;
  voices: string;
  note?: string;
}

const LICENCE_CC_BY = "https://creativecommons.org/licenses/by/4.0/";
const VOICES_SOURCE = "https://huggingface.co/kyutai/tts-voices";
const MODEL_SOURCE = "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning";
const CODE_SOURCE = "https://github.com/kyutai-labs/pocket-tts";
const VCTK_SOURCE = "https://datashare.ed.ac.uk/handle/10283/3443";
const DONATION_SOURCE = "https://unmute.sh/voice-donation";
const VOICE_ZERO_SOURCE = "https://github.com/OwenTyme/voice-zero";

/** Same facts as `media/voices/CREDITS.md`, which ships next to the samples. */
export const GALLERY_CREDITS = {
  subtitle: "D'où viennent les voix de Kyutai Pocket TTS, et sous quelle licence.",
  groups: [
    {
      source: "VCTK",
      licence: "CC BY 4.0, modifié",
      voices: "Anna, Azelma, Charles, Éponine, Eve, Fantine, George, Jane, Mary, Michael, Paul, Vera",
      note: "Enregistrements retravaillés par Kyutai, puis utilisés par le modèle pour générer de nouvelles paroles."
    },
    { source: "Alba MacKenna", licence: "CC BY 4.0", voices: "Alba" },
    { source: "Dons de voix Unmute", licence: "CC0", voices: "Javert, Marius" },
    { source: "Voice Zero, LibriVox", licence: "CC0", voices: "Bill Boerst, Caro Davy, Peter Yearsley, Stuart Bell" },
    { source: "Unmute, Kyutai", licence: "CC0", voices: "Estelle" }
  ] satisfies readonly CreditGroup[],
  engine: { source: "Moteur", licence: "Modèle CC BY 4.0, code MIT", voices: "Kyutai Pocket TTS" } satisfies CreditGroup,
  clause:
    "Il est interdit de cloner ou d'imiter une voix sans consentement explicite et légal, et de présenter un contenu généré comme un enregistrement authentique de personnes réelles.",
  links: [
    { label: "Voir les licences", url: LICENCE_CC_BY },
    { label: "Source des voix", url: VOICES_SOURCE },
    { label: "Modèle", url: MODEL_SOURCE },
    { label: "Code", url: CODE_SOURCE },
    { label: "VCTK", url: VCTK_SOURCE },
    { label: "Dons de voix", url: DONATION_SOURCE },
    { label: "Voice Zero", url: VOICE_ZERO_SOURCE }
  ]
};

/** The only addresses the page can ask to open, compared whole. */
export const GALLERY_LINKS: readonly string[] = GALLERY_CREDITS.links.map((link) => link.url);

// ---------------------------------------------------------------- messages

export type GalleryMessage =
  | { type: "ready" }
  | { type: "refreshHealth" }
  | { type: "choose"; voiceId: string }
  | { type: "trial"; voiceId: string; text: string; requestId: number }
  | { type: "cancelTrial"; requestId: number }
  | { type: "favorite"; voiceId: string; favorite: boolean }
  | { type: "copyCommand"; engine: ServerEngine }
  | { type: "openLink"; url: string }
  | { type: "prepare"; target: PrepareTarget };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `undefined` for anything but a well-formed message about a known voice. */
export function parseGalleryMessage(raw: unknown, knownIds: ReadonlySet<string>): GalleryMessage | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const voiceId = typeof raw.voiceId === "string" && knownIds.has(raw.voiceId) ? raw.voiceId : undefined;
  const requestId = typeof raw.requestId === "number" && Number.isSafeInteger(raw.requestId) ? raw.requestId : undefined;
  switch (raw.type) {
    case "ready":
    case "refreshHealth":
      return { type: raw.type };
    case "choose":
      return voiceId !== undefined ? { type: "choose", voiceId } : undefined;
    case "trial": {
      if (voiceId === undefined || requestId === undefined || typeof raw.text !== "string") {
        return undefined;
      }
      const text = raw.text.trim();
      return text.length <= MAX_TRIAL_PHRASE_LENGTH ? { type: "trial", voiceId, text, requestId } : undefined;
    }
    case "cancelTrial":
      return requestId !== undefined ? { type: "cancelTrial", requestId } : undefined;
    case "favorite":
      return voiceId !== undefined && typeof raw.favorite === "boolean"
        ? { type: "favorite", voiceId, favorite: raw.favorite }
        : undefined;
    case "copyCommand":
      return raw.engine === "kyutai" || raw.engine === "kokoro" || raw.engine === "chatterbox"
        ? { type: "copyCommand", engine: raw.engine }
        : undefined;
    case "openLink":
      return typeof raw.url === "string" ? { type: "openLink", url: raw.url } : undefined;
    case "prepare":
      return raw.target === "chatterbox" || raw.target === "ownVoice" || raw.target === "piper"
        ? { type: "prepare", target: raw.target }
        : undefined;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------- the voice menu

const MAX_RECENT_VOICES = 5;

export function rememberRecent(recents: readonly string[], id: string): string[] {
  return [id, ...recents.filter((recent) => recent !== id)].slice(0, MAX_RECENT_VOICES);
}

export type VoiceMenuAction =
  | { kind: "voice"; entryId: string }
  | { kind: "current" }
  | { kind: "gallery" }
  | { kind: "ownVoice" };

export interface VoiceMenuRow {
  label: string;
  separator?: true;
  description?: string;
  action?: VoiceMenuAction;
}

/** Maquette Menus : the recent voices, then the way to the others. The catalogue itself stays in the gallery. */
export function buildVoiceMenuRows(inputs: {
  activeId: string | undefined;
  activeLabel: string;
  recents: readonly string[];
}): VoiceMenuRow[] {
  const others = inputs.recents
    .filter((id) => id !== inputs.activeId && id !== "own-voice" && galleryEntry(id) !== undefined)
    .slice(0, inputs.activeId !== undefined ? MAX_RECENT_VOICES - 1 : MAX_RECENT_VOICES);
  return [
    { label: "Voix récentes", separator: true },
    {
      label: inputs.activeLabel,
      description: "active",
      action: { kind: "current" }
    },
    ...others.map(
      (id): VoiceMenuRow => ({
        label: galleryEntry(id)?.label ?? id,
        action: { kind: "voice", entryId: id }
      })
    ),
    { label: "Plus de voix", separator: true },
    { label: "Ouvrir la galerie", description: `${GALLERY_VOICE_COUNT} voix`, action: { kind: "gallery" } },
    { label: "Utiliser ma voix", action: { kind: "ownVoice" } }
  ];
}
