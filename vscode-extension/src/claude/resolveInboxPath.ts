/**
 * Resolution order for the inbox directory (ADR-004): setting
 * `llmVoice.claude.inboxPath` > `LLM_VOICE_INBOX` env var > `~/.llm-voice/inbox/`.
 * Pure and vscode-free so it can be unit tested directly; the extension layer
 * only supplies the setting value and reads `process.env`/`os.homedir()`.
 */

import * as os from "node:os";
import * as path from "node:path";

export interface ResolveInboxPathInputs {
  /** `llmVoice.claude.inboxPath`; empty string is treated as "unset". */
  settingValue?: string | undefined;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
}

export function resolveInboxPath(inputs: ResolveInboxPathInputs = {}): string {
  const setting = inputs.settingValue?.trim();
  if (setting !== undefined && setting.length > 0) {
    return setting;
  }
  const env = inputs.env ?? process.env;
  const fromEnv = env.LLM_VOICE_INBOX?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  const home = (inputs.homedir ?? os.homedir)();
  return path.join(home, ".llm-voice", "inbox");
}
