/**
 * `LLM Voice: Setup Voice` (S7.2). Answers the real user complaint on the
 * 0.1.0 install ("il me dit que Chatterbox n'est pas installé") with an
 * honest three-way choice instead of a single hard-coded provider.
 *
 * The first two entries delegate to `llmVoice.installLocalVoice` (story
 * S7.1, a parallel branch): this command is written so it never depends on
 * S7.1 landing first — if the command isn't registered yet, it falls back
 * to a plain "available after update" message instead of throwing.
 */

import * as vscode from "vscode";
import {
  CHATTERBOX_COMPOSE_COMMAND,
  CHATTERBOX_DOCS_URL,
  INSTALL_LOCAL_VOICE_COMMAND,
  NOT_YET_AVAILABLE_MESSAGE,
  VOICE_TIER_OPTIONS,
  type VoiceTier,
  type VoiceTierOption
} from "./voiceTiers.js";

type VoiceTierQuickPickItem = vscode.QuickPickItem & { tier: VoiceTier };

function toQuickPickItem(option: VoiceTierOption): VoiceTierQuickPickItem {
  return {
    tier: option.tier,
    label: option.label,
    description: option.description,
    detail: option.detail
  };
}

async function delegateToInstallLocalVoice(tier: "system" | "piper"): Promise<void> {
  const registered = await vscode.commands.getCommands(true);
  if (!registered.includes(INSTALL_LOCAL_VOICE_COMMAND)) {
    void vscode.window.showInformationMessage(NOT_YET_AVAILABLE_MESSAGE);
    return;
  }
  await vscode.commands.executeCommand(INSTALL_LOCAL_VOICE_COMMAND, { tier });
}

async function handleChatterbox(): Promise<void> {
  const copyCommand = "Copier la commande";
  const openDocs = "Ouvrir la documentation";
  const choice = await vscode.window.showInformationMessage(
    "Chatterbox offre la meilleure qualité de voix (clonage inclus) mais nécessite Docker. " +
      `Démarrez le service localement :\n\n${CHATTERBOX_COMPOSE_COMMAND}`,
    { modal: true },
    copyCommand,
    openDocs
  );
  if (choice === copyCommand) {
    await vscode.env.clipboard.writeText(CHATTERBOX_COMPOSE_COMMAND);
    void vscode.window.showInformationMessage("LLM Voice : commande copiée dans le presse-papiers.");
  } else if (choice === openDocs) {
    await vscode.env.openExternal(vscode.Uri.parse(CHATTERBOX_DOCS_URL));
  }
}

async function handleTier(tier: VoiceTier): Promise<void> {
  switch (tier) {
    case "system":
    case "piper":
      await delegateToInstallLocalVoice(tier);
      return;
    case "chatterbox":
      await handleChatterbox();
      return;
  }
}

/** Registered as `llmVoice.setupVoice` (`extension.ts` — not `commands/index.ts`, S7.2's own file). */
export async function setupVoice(): Promise<void> {
  const picked = await vscode.window.showQuickPick(VOICE_TIER_OPTIONS.map(toQuickPickItem), {
    title: "LLM Voice : choisir une voix",
    placeHolder: "Quel niveau de qualité vocale voulez-vous utiliser ?",
    matchOnDescription: true,
    matchOnDetail: true
  });
  if (picked === undefined) {
    return;
  }
  await handleTier(picked.tier);
}
