/**
 * Public surface of the network egress layer. Nothing here imports `vscode`
 * (ADR-010): the integration layer injects configuration instead. See
 * `EgressGuard.ts` and `verifyLocalMode.ts`.
 */

export * from "./EgressGuard.js";
export * from "./verifyLocalMode.js";
