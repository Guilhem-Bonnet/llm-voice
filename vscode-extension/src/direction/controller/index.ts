/**
 * Partition controller (ADR-015 §2, role 5). Pure: no `vscode`, no network.
 */
export {
  DEFAULT_LENGTH_SLACK_CHARS,
  DEFAULT_MAX_LENGTH_RATIO,
  DEFAULT_MAX_RESENDS,
  PartitionController,
  neutralPartitionForSource,
  type AcceptedOutcome,
  type AcceptedVerdict,
  type BibleIssue,
  type ControllerBibleState,
  type ControllerInput,
  type ControllerOptions,
  type ControllerOutcome,
  type ControllerVerdict,
  type DirectFn,
  type DirectRequest,
  type NeutralOutcome,
  type NeutralReason,
  type RejectedVerdict,
  type Resend,
  type SourceBlock,
  type VerdictTrace,
  type Violation,
  type ViolationCode
} from "./PartitionController.js";
export {
  extractIdentifiers,
  extractNumbers,
  findInventedNumbers,
  findLexicalDifferences,
  findLostContent,
  findLostIdentifiers,
  findLostNegations,
  findLostNumbers,
  identifierParts,
  negationSites,
  numberWords,
  tokenize,
  type FidelityFinding,
  type FidelityKind,
  type NegationSite
} from "./fidelity.js";
