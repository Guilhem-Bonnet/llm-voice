/**
 * Provider health, provider registry and network egress contracts.
 * See ADR-005 (contracts) and decision D10 ("nothing leaves" is proven, not promised).
 */

/** Closed set of health states; `unverified` is preferred over a false green. */
export type ProviderHealthStatus =
  | "ok"
  | "degraded"
  | "unreachable"
  | "unauthorized"
  | "unverified";

/** Result of a provider health probe (CdC §51). */
export interface ProviderHealth {
  providerId: string;
  status: ProviderHealthStatus;
  /** Epoch milliseconds at which the probe ran. */
  checkedAt: number;
  latencyMs?: number;
  /** Host and path only — never a body, never a header (D10). */
  endpoint?: string;
  detail?: string;
}

/** Anything addressable by a stable identifier and selectable from a profile. */
export interface Identified {
  readonly id: string;
}

/** Lookup of provider implementations by id, so profiles never name a class. */
export interface ProviderRegistry<T extends Identified> {
  register(provider: T): void;
  get(id: string): T | undefined;
  has(id: string): boolean;
  list(): readonly T[];
}

/** Network posture applied by the egress guard for a given call. */
export type EgressMode = "strict-local" | "local" | "trusted" | "consented";

/** Why a network call is being attempted, used for logging and consent prompts. */
export type EgressPurpose = "tts" | "narration" | "health" | "voices";

/** How an allowed destination was classified, driving the 🔒 / 🏢 / ☁ badge (D9). */
export type EgressClassification = "loopback" | "trusted-host" | "remote";

/** Reason an egress attempt was refused; every value is user-presentable. */
export type EgressDenialReason =
  | "not-loopback"
  | "strict-local-mode"
  | "untrusted-host"
  | "consent-missing"
  | "tls-required"
  | "dns-resolution-failed"
  | "cross-host-redirect";

/** A network call submitted to the guard before any socket is opened. */
export interface EgressRequest {
  url: string;
  providerId: string;
  purpose: EgressPurpose;
  mode?: EgressMode;
}

/** Discriminated verdict: a refusal is a value, not an exception to catch. */
export type EgressDecision =
  | {
      allowed: true;
      resolvedHost: string;
      resolvedAddresses: readonly string[];
      classification: EgressClassification;
    }
  | {
      allowed: false;
      resolvedHost: string;
      reason: EgressDenialReason;
    };

/** Request options accepted by the guard; redirects are always host-checked. */
export interface EgressFetchInit {
  method?: string;
  headers?: Readonly<Record<string, string>>;
  body?: string | Uint8Array;
  timeoutMs?: number;
}

/** Single choke point every outbound HTTP call must go through (D10). */
export interface EgressGuard {
  check(request: EgressRequest, signal?: AbortSignal): Promise<EgressDecision>;
  fetch(
    request: EgressRequest,
    init?: EgressFetchInit,
    signal?: AbortSignal
  ): Promise<Response>;
}
