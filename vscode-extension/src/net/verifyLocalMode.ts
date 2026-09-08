/**
 * The ten checks behind `LLM Voice: Verify Local Mode` (ADR-010). Pure and
 * synchronous: every fact it needs (provider URLs, settings, webview CSP,
 * production dependency names, static-analysis results...) is passed in by
 * the caller. Wiring this to real VS Code state (settings, webview options,
 * a dependency scan) is S3.5's job — this module only knows how to turn
 * those facts into a verdict, so it can be unit tested without `vscode`.
 */

const IPV4_LOOPBACK = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function isLoopbackUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (hostname === "localhost") {
    return true;
  }
  const stripped = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return IPV4_LOOPBACK.test(stripped) || stripped === "::1";
}

/** Result of one control. `unverifiable` is preferred over a guessed green
 *  whenever the caller could not supply the fact needed (D10: never a
 *  silent false positive). */
export interface LocalModeCheckResult {
  id: number;
  label: string;
  status: "ok" | "warn" | "fail" | "unverifiable";
  detail: string;
}

export interface VerifyLocalModeResult {
  checks: readonly LocalModeCheckResult[];
  /** "local" (🔒) only if every check in `BLOCKING_CHECK_IDS` is "ok";
   *  "unverified" (⚠️) otherwise — including when a blocking check is only
   *  "unverifiable", never a silent pass. */
  badge: "local" | "unverified";
}

/** Facts the ten checks are computed from. All optional facts default to
 *  "unverifiable" when omitted, never to "ok". */
export interface VerifyLocalModeInputs {
  /** Active profile's TTS endpoint. */
  ttsBaseUrl: string;
  /** Active profile's narrator endpoint; absent means no narrator is bound. */
  narratorBaseUrl?: string;
  /** Mode currently applied by the EgressGuard instance in use. */
  egressMode: "local" | "trusted" | "open";
  /** True when `LLM_VOICE_STRICT_LOCAL=1` was read from the environment. */
  strictLocalEnv: boolean;
  /** `llmVoice.network.trustedHosts` as currently configured. */
  trustedHosts: readonly string[];
  /** True when a non-empty `trustedHosts` was explicitly confirmed (ADR-009). */
  trustedHostsConfirmed: boolean;
  /** Effective `connect-src` of the webview CSP, if it was inspected. */
  webviewConnectSrc?: string | null;
  /** Effective webview `localResourceRoots`; `null` means "known to be
   *  unrestricted", `undefined` means "not inspected". */
  webviewLocalResourceRoots?: readonly string[] | null;
  /** Names of production dependencies, for a telemetry-package scan. */
  productionDependencies?: readonly string[];
  /** Result of a static scan for `fetch`/`http.request` outside EgressGuard;
   *  `true` means a bypass was found. */
  directNetworkCallDetected?: boolean | null;
  /** Whether `HF_HUB_OFFLINE`/`HF_HUB_DISABLE_TELEMETRY` are set (only
   *  meaningful after a first model download, CdC / ADR-010 honesty note). */
  huggingFaceOfflineEnv?: boolean | null;
}

const TELEMETRY_PACKAGE_PATTERN = /telemetry|analytics|sentry|segment|mixpanel|amplitude|posthog|datadog/i;

/** Checks whose "ok" status gates the 🔒 Local badge (ADR-010). */
const BLOCKING_CHECK_IDS: ReadonlySet<number> = new Set([1, 2, 3, 7, 8, 9]);

function checkTtsLoopback(inputs: VerifyLocalModeInputs): LocalModeCheckResult {
  const ok = isLoopbackUrl(inputs.ttsBaseUrl);
  return {
    id: 1,
    label: "L'hôte TTS de synthèse est en boucle locale",
    status: ok ? "ok" : "fail",
    detail: ok
      ? `${inputs.ttsBaseUrl} est en boucle locale.`
      : `${inputs.ttsBaseUrl} n'est pas une adresse en boucle locale.`
  };
}

function checkNarratorLoopback(inputs: VerifyLocalModeInputs): LocalModeCheckResult {
  if (inputs.narratorBaseUrl === undefined) {
    return {
      id: 2,
      label: "L'hôte du narrateur est en boucle locale",
      status: "ok",
      detail: "Aucun narrateur configuré (lecture fidèle uniquement)."
    };
  }
  const ok = isLoopbackUrl(inputs.narratorBaseUrl);
  return {
    id: 2,
    label: "L'hôte du narrateur est en boucle locale",
    status: ok ? "ok" : "fail",
    detail: ok
      ? `${inputs.narratorBaseUrl} est en boucle locale.`
      : `${inputs.narratorBaseUrl} n'est pas une adresse en boucle locale.`
  };
}

function checkEgressModeLocal(inputs: VerifyLocalModeInputs): LocalModeCheckResult {
  const ok = inputs.egressMode === "local";
  return {
    id: 3,
    label: "L'EgressGuard est en mode local",
    status: ok ? "ok" : "fail",
    detail: `Mode effectif : ${inputs.egressMode}.`
  };
}

function checkTrustedHosts(inputs: VerifyLocalModeInputs): LocalModeCheckResult {
  if (inputs.trustedHosts.length === 0) {
    return {
      id: 4,
      label: "trustedHosts est vide ou confirmé",
      status: "ok",
      detail: "Aucun hôte de confiance configuré."
    };
  }
  return {
    id: 4,
    label: "trustedHosts est vide ou confirmé",
    status: inputs.trustedHostsConfirmed ? "ok" : "warn",
    detail: inputs.trustedHostsConfirmed
      ? `${inputs.trustedHosts.length} hôte(s) de confiance, confirmé(s).`
      : `${inputs.trustedHosts.length} hôte(s) de confiance non confirmés explicitement.`
  };
}

function checkStrictLocalEnv(inputs: VerifyLocalModeInputs): LocalModeCheckResult {
  return {
    id: 5,
    label: "LLM_VOICE_STRICT_LOCAL est actif",
    status: inputs.strictLocalEnv ? "ok" : "warn",
    detail: inputs.strictLocalEnv
      ? "Mode bunker actif (variable d'environnement)."
      : "Mode bunker non activé : le mode local reste modifiable au runtime."
  };
}

function checkWebviewCsp(inputs: VerifyLocalModeInputs): LocalModeCheckResult {
  if (inputs.webviewConnectSrc === undefined) {
    return {
      id: 6,
      label: "La CSP de la Webview bloque le réseau",
      status: "unverifiable",
      detail: "CSP de la Webview non inspectée."
    };
  }
  const ok = inputs.webviewConnectSrc !== null && inputs.webviewConnectSrc.includes("'none'");
  return {
    id: 6,
    label: "La CSP de la Webview bloque le réseau",
    status: ok ? "ok" : "fail",
    detail: ok ? "connect-src 'none' effectif." : `connect-src effectif : ${String(inputs.webviewConnectSrc)}.`
  };
}

function checkLocalResourceRoots(inputs: VerifyLocalModeInputs): LocalModeCheckResult {
  if (inputs.webviewLocalResourceRoots === undefined) {
    return {
      id: 7,
      label: "localResourceRoots de la Webview est restreint",
      status: "unverifiable",
      detail: "localResourceRoots non inspecté."
    };
  }
  if (inputs.webviewLocalResourceRoots === null || inputs.webviewLocalResourceRoots.length === 0) {
    return {
      id: 7,
      label: "localResourceRoots de la Webview est restreint",
      status: "fail",
      detail: "Aucune restriction de localResourceRoots détectée."
    };
  }
  return {
    id: 7,
    label: "localResourceRoots de la Webview est restreint",
    status: "ok",
    detail: `${inputs.webviewLocalResourceRoots.length} racine(s) autorisée(s).`
  };
}

function checkNoTelemetryDependency(inputs: VerifyLocalModeInputs): LocalModeCheckResult {
  if (inputs.productionDependencies === undefined) {
    return {
      id: 8,
      label: "Aucune dépendance de télémétrie",
      status: "unverifiable",
      detail: "Dépendances de production non inspectées."
    };
  }
  const offenders = inputs.productionDependencies.filter((name) => TELEMETRY_PACKAGE_PATTERN.test(name));
  return {
    id: 8,
    label: "Aucune dépendance de télémétrie",
    status: offenders.length === 0 ? "ok" : "fail",
    detail: offenders.length === 0 ? "Aucune dépendance suspecte." : `Dépendance(s) suspecte(s) : ${offenders.join(", ")}.`
  };
}

function checkSingleChokepoint(inputs: VerifyLocalModeInputs): LocalModeCheckResult {
  if (inputs.directNetworkCallDetected === undefined || inputs.directNetworkCallDetected === null) {
    return {
      id: 9,
      label: "EgressGuard est l'unique point de sortie réseau",
      status: "unverifiable",
      detail: "Analyse statique non exécutée."
    };
  }
  return {
    id: 9,
    label: "EgressGuard est l'unique point de sortie réseau",
    status: inputs.directNetworkCallDetected ? "fail" : "ok",
    detail: inputs.directNetworkCallDetected
      ? "Un appel réseau direct hors EgressGuard a été détecté."
      : "Aucun appel réseau direct détecté hors EgressGuard."
  };
}

function checkHuggingFaceOffline(inputs: VerifyLocalModeInputs): LocalModeCheckResult {
  if (inputs.huggingFaceOfflineEnv === undefined || inputs.huggingFaceOfflineEnv === null) {
    return {
      id: 10,
      label: "Variables hors-ligne HuggingFace/Ollama actives",
      status: "unverifiable",
      detail: "Non inspecté (pertinent seulement après un premier téléchargement)."
    };
  }
  return {
    id: 10,
    label: "Variables hors-ligne HuggingFace/Ollama actives",
    status: inputs.huggingFaceOfflineEnv ? "ok" : "warn",
    detail: inputs.huggingFaceOfflineEnv
      ? "HF_HUB_OFFLINE / HF_HUB_DISABLE_TELEMETRY sont fixés."
      : "Non fixé — sans effet tant qu'aucun modèle n'a été téléchargé."
  };
}

/** Pure computation of the ten ADR-010 controls and the 🔒/⚠️ badge. */
export function verifyLocalMode(inputs: VerifyLocalModeInputs): VerifyLocalModeResult {
  const checks: LocalModeCheckResult[] = [
    checkTtsLoopback(inputs),
    checkNarratorLoopback(inputs),
    checkEgressModeLocal(inputs),
    checkTrustedHosts(inputs),
    checkStrictLocalEnv(inputs),
    checkWebviewCsp(inputs),
    checkLocalResourceRoots(inputs),
    checkNoTelemetryDependency(inputs),
    checkSingleChokepoint(inputs),
    checkHuggingFaceOffline(inputs)
  ];

  const badge: VerifyLocalModeResult["badge"] = checks.every(
    (check) => !BLOCKING_CHECK_IDS.has(check.id) || check.status === "ok"
  )
    ? "local"
    : "unverified";

  return { checks, badge };
}
