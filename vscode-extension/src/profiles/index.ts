/**
 * Public surface of the profile-storage layer (ADR-004, CdC §18-19). Imports
 * `vscode` (globalStorageUri, globalState) — the pure schema lives in
 * `src/core/profile.schema.ts`.
 */

export * from "./defaults.js";
export * from "./ProfileRepository.js";
