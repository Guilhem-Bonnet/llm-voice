/**
 * Pure, human-facing label for a TTS `providerId` (audit `docs/ux/audit-
 * 2026-11-05.md`, section 4, priority 1: "aucune surface n'affiche le
 * provider/voix réellement actif"). Shared by the player panel and the
 * status bar — a single source of truth so the two never drift apart.
 *
 * Known, documented limitation (relecture Sentinel, same audit): `"system"`
 * covers both the "Voix système" and "Voix française autonome (Piper)"
 * onboarding tiers (`ttsBindingForTier`, `voiceTiers.ts`) — they resolve to
 * the same `providerId`, so this function cannot distinguish them without an
 * async `SystemTtsProvider.detectEngine()` call this synchronous label has
 * no access to. The label stays honestly generic ("Voix système") rather
 * than guessing which engine is actually installed.
 *
 * `providerId` is optional on `VoiceProfile["tts"]` (`core/profile.ts`,
 * `TtsBinding`) — an omitted one means "auto" (resolved elsewhere, e.g.
 * `Pipeline.resolveTtsProviderConfig`), reflected here as "Voix automatique",
 * like the explicit `"auto"` (ADR-017 §1.3: it used to show up raw).
 */
export function friendlyTtsProviderLabel(providerId: string | undefined): string {
  switch (providerId) {
    case undefined:
    case "auto":
      return "Voix automatique";
    case "system":
      return "Voix système";
    case "chatterbox":
      return "Chatterbox (qualité maximale)";
    case "kokoro":
      return "Kokoro (voix locale rapide)";
    case "kyutai-pocket":
      return "Kyutai Pocket TTS (avancé)";
    case "kyutai-1-6b":
      return "Kyutai narration (carte graphique)";
    case "qwen3":
      return "Voix Qwen3 (carte graphique)";
    case "openai-compatible":
      return "Compatible OpenAI (distant)";
    default:
      return providerId;
  }
}
