/**
 * A frozen copy of what version 0.3 validates `profiles.json` with
 * (`src/core/profile.schema.ts` at the time of ADR-017): what the migrated file must
 * still pass, and what a rewrite by 0.3 does to it (`z.object` drops every key it does
 * not declare: the mark and `hidden`). Do not update it with the live schema.
 */
import { z } from "zod";

const HttpUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith("http://") || value.startsWith("https://"));

const TtsBinding = z.object({
  providerId: z.string().min(1).optional(),
  baseUrl: HttpUrl.optional(),
  model: z.string().min(1).optional(),
  voice: z.string().min(1).optional(),
  format: z.string().min(1).optional(),
  apiKeyRef: z.string().min(1).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  referenceAudio: z.string().min(1).optional()
});

const Profile = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  mode: z.enum(["faithful", "narrated"]),
  language: z.string().min(2),
  tts: TtsBinding,
  narrator: z
    .object({
      providerId: z.string().min(1).optional(),
      baseUrl: HttpUrl.optional(),
      model: z.string().min(1).optional(),
      temperature: z.number().min(0).max(2).optional(),
      apiKeyRef: z.string().min(1).optional()
    })
    .optional(),
  chunking: z.object({
    unit: z.enum(["sentence", "block"]),
    maxSentences: z.number().int().min(1).max(10),
    prefetchChunks: z.number().int().min(0).max(10)
  }),
  playback: z.object({ rate: z.number().min(0.5).max(3), volume: z.number().min(0).max(1) }),
  description: z.string().optional(),
  style: z.string().optional(),
  markdown: z
    .object({
      headings: z.enum(["read", "skip"]),
      links: z.enum(["labelOnly"]),
      images: z.enum(["altText", "skip"]),
      code: z.enum(["skip", "read", "explain", "summarize"]),
      tables: z.enum(["skip", "read", "summarize"]),
      frontmatter: z.enum(["skip", "read"])
    })
    .optional(),
  synchronization: z.object({ mode: z.enum(["highlight-scroll", "highlight", "off"]) }).optional()
});

export const FrozenProfileCollectionV2 = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  defaultProfileId: z.string().min(1),
  profiles: z.array(Profile).min(1)
});
