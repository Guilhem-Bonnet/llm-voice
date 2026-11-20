/**
 * `code --install-extension` replaces the files on disk, but a running window
 * keeps the code it loaded. This compares the installed bundle's date to the
 * moment this window activated, and offers once to reload.
 *
 * Free of `vscode` so it runs under plain-Node vitest, unlike `Pipeline.ts`;
 * the Pipeline injects the notification and the reload command.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";

export const RELOAD_WINDOW_ACTION = "Recharger la fenêtre";

const NEWER_INSTALL_MESSAGE =
  "LLM Voice : une nouvelle version est installée, mais cette fenêtre utilise encore l'ancienne.";

export interface InstallFreshnessDeps {
  bundlePath: string;
  activatedAtMs: number;
  showWarning(message: string, action: string): PromiseLike<string | undefined>;
  reloadWindow(): PromiseLike<unknown>;
}

/** The file `package.json#main` names, under the extension's install directory. */
export function installedBundlePath(extensionPath: string): string {
  return join(extensionPath, "dist", "extension.js");
}

/**
 * The returned check runs before every reading. It warns at most once per
 * window, dismissed or not; a check that finds nothing newer, or no file at
 * all, leaves that one warning available for a later install.
 */
export function createInstallFreshnessCheck(deps: InstallFreshnessDeps): () => Promise<void> {
  let warned = false;
  return async () => {
    const modifiedAtMs = await stat(deps.bundlePath).then(
      (stats) => stats.mtimeMs,
      () => undefined
    );
    if (warned || modifiedAtMs === undefined || modifiedAtMs <= deps.activatedAtMs) {
      return;
    }
    warned = true;
    const choice = await deps.showWarning(NEWER_INSTALL_MESSAGE, RELOAD_WINDOW_ACTION);
    if (choice === RELOAD_WINDOW_ACTION) {
      await deps.reloadWindow();
    }
  };
}
