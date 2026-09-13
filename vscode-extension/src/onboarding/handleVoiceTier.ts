/**
 * The decision logic behind `LLM Voice: Setup Voice`'s three tiers (S7.2),
 * factored out of `SetupVoice.ts` so it is unit-testable in plain Node —
 * same idea as `src/ui/notifications.ts` (see that file's header): every
 * `vscode` call this needs comes in as an explicit `VoiceTierActions`
 * parameter instead of an `import * as vscode`, so a test can pass a stub
 * that records what was called and resolves to a fixed answer, exactly
 * like a real user clicking a button.
 *
 * S7.1 landed `llmVoice.installPiperVoice` (`src/commands/index.ts`) with
 * **no arguments** and **no "system" equivalent** — it only ever installs
 * Piper. `handleTier` used to delegate both "system" and "piper" to one
 * `{ tier }`-parameterised command that never existed (a repli/fallback
 * for "S7.1 hasn't landed yet"); now that it has, "piper" calls the real
 * command directly and "system" — which has nothing to install, the whole
 * point of that tier — never calls it at all.
 */

import {
  CHATTERBOX_COMPOSE_COMMAND,
  CHATTERBOX_DOCS_URL,
  INSTALL_PIPER_VOICE_COMMAND,
  SYSTEM_VOICE_READY_MESSAGE,
  type VoiceTier
} from "./voiceTiers.js";

/** Mirrors `vscode.window.show{Information}Message`'s modal overload closely enough for every call site here. */
export type ShowMessage = (
  message: string,
  options: { modal?: boolean },
  ...items: string[]
) => PromiseLike<string | undefined>;

export interface VoiceTierActions {
  showMessage: ShowMessage;
  executeCommand: (command: string) => PromiseLike<unknown>;
  openExternal: (url: string) => PromiseLike<unknown>;
  writeClipboardText: (text: string) => PromiseLike<void>;
  /**
   * Bug fix (voice-selection-not-applied / infinite loop): persists
   * `ttsBindingForTier(tier)` onto the active profile (`Pipeline.
   * applyVoiceTierChoice`). Called unconditionally, before any
   * tier-specific dialog — the choice is made the moment the user picks a
   * row in `Setup Voice`'s Quick Pick, not once a background install or a
   * Docker container happens to finish, so it survives even a dismissed
   * "chatterbox" modal (that dialog is instructions, not a confirmation of
   * the choice itself).
   */
  applyProviderChoice: (tier: VoiceTier) => PromiseLike<void>;
}

const COPY_COMMAND_LABEL = "Copier la commande";
const OPEN_DOCS_LABEL = "Ouvrir la documentation";

async function handleChatterbox(actions: VoiceTierActions): Promise<void> {
  const choice = await actions.showMessage(
    "Chatterbox offre la meilleure qualité de voix (clonage inclus) mais nécessite Docker. " +
      `Démarrez le service localement :\n\n${CHATTERBOX_COMPOSE_COMMAND}`,
    { modal: true },
    COPY_COMMAND_LABEL,
    OPEN_DOCS_LABEL
  );
  if (choice === COPY_COMMAND_LABEL) {
    await actions.writeClipboardText(CHATTERBOX_COMPOSE_COMMAND);
    await actions.showMessage("LLM Voice : commande copiée dans le presse-papiers.", {});
  } else if (choice === OPEN_DOCS_LABEL) {
    await actions.openExternal(CHATTERBOX_DOCS_URL);
  }
}

/** `handleTier` (`SetupVoice.ts`'s exported name for this): dispatches on the Quick Pick's chosen tier. */
export async function handleVoiceTier(tier: VoiceTier, actions: VoiceTierActions): Promise<void> {
  // Bug fix (voice-selection-not-applied / infinite loop): persist the
  // choice first, unconditionally — see `VoiceTierActions.applyProviderChoice`'s
  // doc comment for why this must not wait for a tier's own dialog/install.
  await actions.applyProviderChoice(tier);
  switch (tier) {
    case "system":
      // Nothing to install — `SystemTtsProvider` (S7.1) already works.
      await actions.showMessage(SYSTEM_VOICE_READY_MESSAGE, {});
      return;
    case "piper":
      await actions.executeCommand(INSTALL_PIPER_VOICE_COMMAND);
      return;
    case "chatterbox":
      await handleChatterbox(actions);
      return;
  }
}
