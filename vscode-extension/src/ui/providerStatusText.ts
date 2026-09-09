/**
 * Pure formatting for `LLM Voice: Provider Status` (CdC §51): "● Ready /
 * ● Loading / ● Offline / ● Error" rendered with Codicons (ADR-011 — never a
 * raw emoji/dot in native UI) instead of the CdC's ASCII bullet.
 */

import type { ProviderHealth, ProviderHealthStatus } from "../core/health.js";

const STATUS_ICON: Record<ProviderHealthStatus, string> = {
  ok: "$(pass)",
  degraded: "$(sync~spin)",
  unreachable: "$(circle-slash)",
  unauthorized: "$(error)",
  unverified: "$(question)"
};

const STATUS_LABEL: Record<ProviderHealthStatus, string> = {
  ok: "Ready",
  degraded: "Loading",
  unreachable: "Offline",
  unauthorized: "Error",
  unverified: "Unverified"
};

/** `chatterbox` → `Chatterbox`, `openai-compatible` → `Openai Compatible`. */
export function titleCaseProviderId(id: string): string {
  return id
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export interface ProviderHealthQuickPickItem {
  label: string;
  detail: string;
}

/** One provider health probe as a `showQuickPick` item. */
export function formatProviderHealthQuickPickItem(
  label: string,
  health: ProviderHealth
): ProviderHealthQuickPickItem {
  const detail = [
    health.endpoint,
    health.latencyMs !== undefined ? `${health.latencyMs} ms` : undefined,
    health.detail
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(" · ");
  return {
    label: `${STATUS_ICON[health.status]} ${STATUS_LABEL[health.status]} · ${label}`,
    detail
  };
}
