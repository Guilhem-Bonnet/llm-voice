/**
 * Public surface of the narrator provider integration layer (ADR-005, CdC
 * §20-22). Like `src/tts`, nothing here imports `vscode`: all real network
 * access goes through the injected `EgressGuardHandle` (ADR-010).
 */

export * from "./NoNarrator.js";
export * from "./OllamaNarrator.js";
export * from "./OpenAICompatibleNarrator.js";
export * from "./createNarratorProvider.js";
export * from "./narrationContract.js";
export * from "./parseNarration.js";
