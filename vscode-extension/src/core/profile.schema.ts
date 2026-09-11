/**
 * Runtime validation of voice profiles, and the pure locality predicate the
 * 🔒 / ☁ badge relies on. See ADR-004 (`profiles.json`) and ADR-005 / D10.
 */

import { z } from "zod";

import type { VoiceProfile } from "./profile.js";
import { REFERENCE_AUDIO_PATTERN, SAFE_API_KEY_REF, rejectReferenceAudioPath } from "./safePath.js";
import { CHATTERBOX_LOCAL_PRESET } from "../tts/presets.js";

/** Chunk granularity accepted in a profile (CdC §33). */
export const ChunkUnitSchema = z.enum(["sentence", "block"]);

/** Faithful reading or narrator-rewritten reading (CdC §4). */
export const NarrationModeSchema = z.enum(["faithful", "narrated"]);

/** Segmentation settings, bounded so a profile cannot starve the queue. */
export const ChunkingOptionsSchema = z.object({
  unit: ChunkUnitSchema,
  maxSentences: z.number().int().min(1).max(10),
  prefetchChunks: z.number().int().min(0).max(10)
});

/** Player defaults; rate matches the `<audio>` playbackRate range we support. */
export const PlaybackDefaultsSchema = z.object({
  rate: z.number().min(0.5).max(3),
  volume: z.number().min(0).max(1)
});

/** Mirrors `MarkdownPolicy` (`src/parser/types.ts`, CdC §13) for the profile editor (S8.2). */
export const MarkdownPolicySchema = z.object({
  headings: z.enum(["read", "skip"]),
  links: z.enum(["labelOnly"]),
  images: z.enum(["altText", "skip"]),
  code: z.enum(["skip", "read", "explain", "summarize"]),
  tables: z.enum(["skip", "read", "summarize"]),
  frontmatter: z.enum(["skip", "read"])
});

/** Mirrors `SyncMode` (CdC §49 "Highlight behavior"). */
export const SyncModeSchema = z.enum(["highlight-scroll", "highlight", "off"]);

/** Absolute http(s) URL; anything else is rejected before the egress guard. */
const HttpUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    { message: "baseUrl must be an http(s) URL" }
  );

/**
 * Binding to a speech engine; the API key itself never lives here.
 *
 * `providerId`/`baseUrl` are optional: an omitted value falls back to
 * `llmVoice.tts.provider`/`llmVoice.tts.baseUrl` at resolution time
 * (`resolveTtsConfig`, `src/pipeline/resolveProviderConfig.ts`) — the setting
 * is the default, the profile can override it.
 */
/**
 * A `SecretStorage` key an imported profile is allowed to name (AC-SEC-08,
 * S6.1 audit F-01): only `llmVoice.apiKey.<providerId>`, the shape
 * `apiKeySecretKey()` writes. `Pipeline` additionally requires the ref to
 * match the profile's own resolved `providerId` — this schema only keeps a
 * profile from naming something outside the namespace at all.
 */
const ApiKeyRefSchema = z
  .string()
  .min(1)
  .regex(SAFE_API_KEY_REF, { message: "apiKeyRef must be llmVoice.apiKey.<providerId>" });

/**
 * Voice-cloning reference sample (CdC §55). An imported profile's value is
 * read from disk and uploaded to the TTS endpoint, so it is validated here
 * before it can reach either — see `rejectReferenceAudioPath`.
 */
const ReferenceAudioSchema = z
  .string()
  .min(1)
  // As a pattern *and* as a predicate: the pattern is what reaches the
  // generated JSON Schema (editor-side validation of `profiles.json`), the
  // predicate is what catches the rest (deceptive characters, length).
  .regex(REFERENCE_AUDIO_PATTERN, { message: "referenceAudio must be an audio file" })
  .superRefine((value, ctx) => {
    const rejection = rejectReferenceAudioPath(value);
    if (rejection !== undefined) {
      ctx.addIssue({ code: "custom", message: `referenceAudio rejected: ${rejection}` });
    }
  });

export const TtsBindingSchema = z.object({
  providerId: z.string().min(1).optional(),
  baseUrl: HttpUrlSchema.optional(),
  model: z.string().min(1).optional(),
  voice: z.string().min(1).optional(),
  format: z.string().min(1).optional(),
  apiKeyRef: ApiKeyRefSchema.optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  /** Voice cloning reference sample, local path (CdC §55). Backward-compatible: optional. */
  referenceAudio: ReferenceAudioSchema.optional()
});

/**
 * Optional narrator binding; absent means faithful reading only.
 *
 * Same fallback as `TtsBindingSchema` above, against `llmVoice.narrator.*`
 * (`resolveNarratorConfig`).
 */
export const NarratorBindingSchema = z.object({
  providerId: z.string().min(1).optional(),
  baseUrl: HttpUrlSchema.optional(),
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  apiKeyRef: ApiKeyRefSchema.optional()
});

/** Full profile schema, also exported as the JSON Schema attached to profiles.json. */
export const VoiceProfileSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  mode: NarrationModeSchema,
  language: z.string().min(2),
  tts: TtsBindingSchema,
  narrator: NarratorBindingSchema.optional(),
  chunking: ChunkingOptionsSchema,
  playback: PlaybackDefaultsSchema,
  description: z.string().optional(),
  style: z.string().optional(),
  markdownPolicy: MarkdownPolicySchema.optional(),
  syncMode: SyncModeSchema.optional()
});

/** The whole `profiles.json` document. */
export const ProfileCollectionSchema = z.object({
  schemaVersion: z.literal(1),
  defaultProfileId: z.string().min(1),
  profiles: z.array(VoiceProfileSchema).min(1)
});

/** Hostnames that are always loopback without any DNS resolution. */
/** Hostnames that are always loopback without any DNS resolution.
 *  `0.0.0.0` is deliberately *not* here (S6.1 audit F-11): it is the
 *  unspecified address, `EgressGuard` refuses it, and listing it made the
 *  🔒 badge claim "local" for a destination the guard would deny. */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "::1", "[::1]"]);

/**
 * Pure, offline check that a URL points at the loopback interface.
 *
 * It deliberately performs no DNS resolution: a hostname that merely looks
 * local is still treated as remote here, and `EgressGuard` re-checks the
 * resolved address at call time (D10).
 */
export function isLoopbackUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (LOOPBACK_HOSTNAMES.has(hostname)) {
    return true;
  }
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

/**
 * True when any endpoint of the profile leaves the loopback interface.
 *
 * This is the same lexical, no-DNS check as `isLoopbackUrl` above: it drives
 * the 🔒 / ☁ badge only and must never be relied on as a security boundary.
 * The actual guarantee that nothing leaves the machine in local mode is
 * enforced at call time by `EgressGuard` (ADR-005, D10, phase 3), which
 * resolves DNS and re-checks the real destination on every request.
 */
export function isRemoteProfile(profile: VoiceProfile): boolean {
  // An omitted `baseUrl` resolves against `llmVoice.*.baseUrl` at call time
  // (`resolveTtsConfig`/`resolveNarratorConfig`) — this pure, settings-blind
  // check has no way to know that resolved value, so it only judges the URLs
  // the profile actually states; the 🔒/☁ badge itself is driven by
  // `Pipeline.verifyLocalMode`, which resolves against settings first.
  const urls = [profile.tts.baseUrl, profile.narrator?.baseUrl].filter(
    (url): url is string => url !== undefined
  );
  return urls.some((url) => !isLoopbackUrl(url));
}

/** Profile shipped out of the box: faithful reading through a local engine. */
export const DEFAULT_PROFILE: VoiceProfile = {
  id: "faithful-local",
  label: "Lecture fidèle (local)",
  mode: "faithful",
  language: "fr-FR",
  tts: {
    // ADR-005/CdC §28: `chatterbox`, not `openai-compatible` pointed at
    // Chatterbox's port — `POST /v1/audio/speech` ignores `language` on this
    // server (docs/e2e/report-2026-09-08.md), `ChatterboxProvider`'s native
    // `POST /tts` doesn't. Voice-cloned by default (CdC §55) against the
    // validated SIWIS-derived French reference.
    providerId: "chatterbox",
    baseUrl: CHATTERBOX_LOCAL_PRESET.baseUrl,
    ...(CHATTERBOX_LOCAL_PRESET.referenceAudio !== undefined
      ? { referenceAudio: CHATTERBOX_LOCAL_PRESET.referenceAudio }
      : {}),
    ...(CHATTERBOX_LOCAL_PRESET.parameters !== undefined
      ? { parameters: { ...CHATTERBOX_LOCAL_PRESET.parameters } }
      : {}),
    format: "wav"
  },
  chunking: {
    unit: "sentence",
    maxSentences: 3,
    prefetchChunks: 2
  },
  playback: {
    rate: 1,
    volume: 1
  },
  description: "Chatterbox sur la machine locale, aucune sortie réseau."
};

/** Parses an unknown value into a profile, throwing on the first violation. */
export function parseVoiceProfile(value: unknown): VoiceProfile {
  return VoiceProfileSchema.parse(value) as VoiceProfile;
}
