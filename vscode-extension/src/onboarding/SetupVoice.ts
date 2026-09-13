/**
 * `LLM Voice: Setup Voice` (S7.2). Answers the real user complaint on the
 * 0.1.0 install ("il me dit que Chatterbox n'est pas installé") with an
 * honest three-way choice instead of a single hard-coded provider.
 *
 * The Quick Pick is the only `vscode`-specific part of this file; the
 * decision logic behind each tier (`handleVoiceTier`, `handleVoiceTier.ts`)
 * takes every `vscode` call as an injected parameter and is unit-tested
 * there in plain Node.
 */

import * as vscode from "vscode";
import { handleVoiceTier, type VoiceTierActions } from "./handleVoiceTier.js";
import { VOICE_TIER_OPTIONS, type VoiceTier, type VoiceTierOption } from "./voiceTiers.js";

type VoiceTierQuickPickItem = vscode.QuickPickItem & { tier: VoiceTier };

function toQuickPickItem(option: VoiceTierOption): VoiceTierQuickPickItem {
  return {
    tier: option.tier,
    label: option.label,
    description: option.description,
    detail: option.detail
  };
}

/**
 * Bug fix (voice-selection-not-applied / infinite loop): the one side
 * effect `SetupVoice.ts` cannot itself perform — writing the chosen tier's
 * `tts` binding onto the active profile requires `ProfileRepository`,
 * which lives behind `Pipeline` (`extension.ts` wires the real
 * implementation to `Pipeline.applyVoiceTierChoice`, resolved lazily
 * through `pipelineRef` since `llmVoice.setupVoice` registers before the
 * `Pipeline` instance itself exists).
 */
export type ApplyProviderChoice = (tier: VoiceTier) => Promise<void>;

function realActions(applyProviderChoice: ApplyProviderChoice): VoiceTierActions {
  return {
    showMessage: (message, options, ...items) =>
      vscode.window.showInformationMessage(message, options, ...items),
    executeCommand: (command) => vscode.commands.executeCommand(command),
    openExternal: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
    writeClipboardText: (text) => vscode.env.clipboard.writeText(text),
    applyProviderChoice
  };
}

/** Registered as `llmVoice.setupVoice` (`extension.ts` — not `commands/index.ts`, S7.2's own file). */
export async function setupVoice(applyProviderChoice: ApplyProviderChoice): Promise<void> {
  const picked = await vscode.window.showQuickPick(VOICE_TIER_OPTIONS.map(toQuickPickItem), {
    title: "LLM Voice : choisir une voix",
    placeHolder: "Quel niveau de qualité vocale voulez-vous utiliser ?",
    matchOnDescription: true,
    matchOnDetail: true
  });
  if (picked === undefined) {
    return;
  }
  await handleVoiceTier(picked.tier, realActions(applyProviderChoice));
}
