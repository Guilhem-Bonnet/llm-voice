/**
 * Splits a plain-text paragraph into individual sentences.
 *
 * This is a deliberately minimal, pure implementation for the phase-1
 * skeleton. It is not the final FR/EN-aware segmenter described in the
 * cahier des charges (§14, §33); it only guarantees stable, testable
 * behaviour so the CI pipeline can exercise a real unit under test.
 *
 * @param text - the paragraph to segment
 * @returns an array of trimmed, non-empty sentences
 */
export function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}
