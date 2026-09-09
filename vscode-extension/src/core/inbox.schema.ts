/**
 * Runtime validation of `InboxMessage` (ADR-003's schema, ADR-007's open
 * protocol). Zod-parsed on every read: a file that fails validation is
 * reported as a rejection, never thrown past the caller — the inbox
 * directory is written to by external processes (D8) and must tolerate a
 * malformed or half-written entry (ADR-004: `.tmp-*` is filtered out by the
 * caller before this schema ever sees it, but a corrupt/truncated final
 * file is still possible).
 */

import { z } from "zod";

/**
 * ADR-003's canonical wire shape uses `capturedAt` as epoch milliseconds
 * (the naming scheme derives the file name from it); ADR-007's illustrative
 * payload shows an ISO-8601 string. Accepting both keeps every producer
 * (collector, CLI, a future non-Node tool) valid without picking a side —
 * the in-memory shape (`InboxMessage.capturedAt: number`) always ends up as
 * epoch ms.
 */
const CapturedAtSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  return value;
}, z.number().finite());

/** Free-form by design (D8): any tool can declare its own provider id. */
export const InboxProviderIdSchema = z.string().min(1);

/**
 * One JSON file dropped in the inbox directory (ADR-003, ADR-007). Not
 * expressed as `satisfies z.ZodType<InboxMessage>` (see `ProfileRepository`'s
 * `parse(...) as ProfileCollection` for the same pattern): Zod's inferred
 * type for an `.optional()` field is `T | undefined` even where it is
 * present, which `exactOptionalPropertyTypes` correctly tells apart from
 * `InboxMessage`'s `cwd?: string`. Callers cast to `InboxMessage` after
 * `.parse()`/`.safeParse()`, same as every other schema in `src/core`.
 */
export const InboxMessageSchema = z.object({
  schemaVersion: z.literal(1),
  provider: InboxProviderIdSchema,
  sessionId: z.string().min(1),
  capturedAt: CapturedAtSchema,
  cwd: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  message: z.string()
});
