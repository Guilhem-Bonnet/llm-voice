/**
 * Runtime validation of voice profiles, and the pure locality predicate the
 * 🔒 / ☁ badge relies on. See ADR-004 (`profiles.json`) and ADR-005 / D10.
 */

import { z } from "zod";

import type { VoiceProfile } from "./profile.js";

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

/** Absolute http(s) URL; anything else is rejected before the egress guard. */
const HttpUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    { message: "baseUrl must be an http(s) URL" }
  );

/** Binding to a speech engine; the API key itself never lives here. */
export const TtsBindingSchema = z.object({
  providerId: z.string().min(1),
  baseUrl: HttpUrlSchema,
  model: z.string().min(1).optional(),
  voice: z.string().min(1).optional(),
  format: z.string().min(1).optional(),
  apiKeyRef: z.string().min(1).optional(),
  parameters: z.record(z.string(), z.unknown()).optional()
});

/** Optional narrator binding; absent means faithful reading only. */
export const NarratorBindingSchema = z.object({
  providerId: z.string().min(1),
  baseUrl: HttpUrlSchema,
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  apiKeyRef: z.string().min(1).optional()
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
  description: z.string().optional()
});

/** The whole `profiles.json` document. */
export const ProfileCollectionSchema = z.object({
  schemaVersion: z.literal(1),
  defaultProfileId: z.string().min(1),
  profiles: z.array(VoiceProfileSchema).min(1)
});

/** Hostnames that are always loopback without any DNS resolution. */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "::1", "[::1]", "0.0.0.0"]);

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
  const urls = [profile.tts.baseUrl];
  if (profile.narrator !== undefined) {
    urls.push(profile.narrator.baseUrl);
  }
  return urls.some((url) => !isLoopbackUrl(url));
}

/** Profile shipped out of the box: faithful reading through a local engine. */
export const DEFAULT_PROFILE: VoiceProfile = {
  id: "faithful-local",
  label: "Lecture fidèle (local)",
  mode: "faithful",
  language: "fr-FR",
  tts: {
    providerId: "openai-compatible",
    baseUrl: "http://127.0.0.1:8004",
    model: "chatterbox",
    voice: "default",
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
