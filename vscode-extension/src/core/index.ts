/**
 * Public surface of the LLM Voice core contracts.
 *
 * Nothing in `src/core` imports `vscode`: these types are the boundary between
 * the VS Code integration layer and the parts that can be unit tested in plain
 * Node. See ADR-001 to ADR-005.
 */

export * from "./source.js";
export * from "./narration.js";
export * from "./tts.js";
export * from "./playback.js";
export * from "./profile.js";
export * from "./profile.schema.js";
export * from "./health.js";
export * from "./inbox.js";
export * from "./inbox.schema.js";
