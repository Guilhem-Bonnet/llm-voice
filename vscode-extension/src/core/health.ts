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

/**
 * The egress-guard contract sketched in ADR-005 (`check`/`EgressDecision` as
 * a discriminated return value) was superseded by the implementation landed
 * for ADR-010: `createEgressGuard` in `../net/EgressGuard.js`, which throws
 * `EgressDeniedError` instead of returning a verdict object. Nothing in this
 * codebase consumed the ADR-005 sketch, so it was removed here rather than
 * kept as a second, incompatible shape — import egress types from
 * `../net/EgressGuard.js` (`EgressMode`, `EgressClassification`,
 * `EgressDenialReason`, `EgressGuardHandle`, etc.).
 */
