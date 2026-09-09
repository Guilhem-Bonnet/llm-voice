/**
 * `Install Claude Code Hook` / `Uninstall Claude Code Hook` (ADR-003):
 * Quick Pick "Plugin (recommandé) / Éditer settings.json / Annuler", explicit
 * consent before any edit, targeted write to `~/.claude/settings.json`.
 * Delegates the actual JSON edit to `hookInstallerIO.ts` (pure Node, no
 * `vscode`); this file only owns the dialogs and path resolution.
 */

import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { claudeSettingsFiles, findExistingHook, writeHookInstalled, writeHookUninstalled } from "./hookInstallerIO.js";

const PLUGIN_README_HINT =
  "Installez le plugin Claude Code (voie recommandée, réversible) : " +
  "`claude plugin install <chemin-du-dépôt>/integrations/claude-code/plugin`, " +
  "ou copiez ce dossier dans vos plugins Claude Code. Détails : integrations/claude-code/README.md.";

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Absolute path to the bundled collector, copied into the VSIX at build time. */
export function bundledCaptureScriptPath(extensionUri: vscode.Uri): string {
  return vscode.Uri.joinPath(extensionUri, "resources", "claude-code", "plugin", "scripts", "llm-voice-capture.js")
    .fsPath;
}

function userSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

export async function installClaudeHook(extensionUri: vscode.Uri): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: "$(extensions) Plugin (recommandé)", id: "plugin" as const },
      { label: "$(edit) Éditer settings.json", id: "settings" as const },
      { label: "$(close) Annuler", id: "cancel" as const }
    ],
    { placeHolder: "LLM Voice : installer la capture Claude Code" }
  );
  if (choice === undefined || choice.id === "cancel") {
    return;
  }

  if (choice.id === "plugin") {
    void vscode.window.showInformationMessage(PLUGIN_README_HINT);
    return;
  }

  const files = claudeSettingsFiles(os.homedir(), workspaceRoot());
  const existing = await findExistingHook(files);
  if (existing !== undefined) {
    void vscode.window.showInformationMessage(
      `LLM Voice : un hook Claude Code est déjà présent (${existing.label}). Rien à faire.`
    );
    return;
  }

  const target = userSettingsPath();
  const command = `node "${bundledCaptureScriptPath(extensionUri)}"`;
  const consent = await vscode.window.showWarningMessage(
    `LLM Voice va ajouter une entrée "Stop" dans ${target} :\n${command}\n` +
      "Une sauvegarde .bak du fichier actuel sera créée. Confirmer ?",
    { modal: true },
    "Installer"
  );
  if (consent !== "Installer") {
    return;
  }

  try {
    await writeHookInstalled(target, command);
    void vscode.window.showInformationMessage(`LLM Voice : hook Claude Code installé dans ${target}.`);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `LLM Voice : échec de l'installation du hook (${error instanceof Error ? error.message : String(error)}).`
    );
  }
}

export async function uninstallClaudeHook(): Promise<void> {
  const target = userSettingsPath();
  const consent = await vscode.window.showWarningMessage(
    `LLM Voice va retirer l'entrée "llm-voice-capture" de ${target}. Une sauvegarde .bak sera créée. Confirmer ?`,
    { modal: true },
    "Désinstaller"
  );
  if (consent !== "Désinstaller") {
    return;
  }
  try {
    await writeHookUninstalled(target);
    void vscode.window.showInformationMessage(`LLM Voice : hook Claude Code retiré de ${target}.`);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `LLM Voice : échec de la désinstallation du hook (${error instanceof Error ? error.message : String(error)}).`
    );
  }
}
