/**
 * The player webview's document and its CSP nonce (ADR-001, AC-SEC-02).
 *
 * Split out of `PlayerViewProvider` on purpose: that file imports `vscode`,
 * which cannot be loaded under plain-Node vitest, and the security property
 * proved here — that no untrusted string is ever interpolated into the HTML
 * — is exactly the one that deserves a unit test rather than an electron
 * round-trip.
 */

import { randomBytes } from "node:crypto";

/**
 * A fresh CSP nonce per render. `randomBytes`, not `Math.random()` (S6.1
 * audit F-10): `Math.random()` is a predictable PRNG whose internal state
 * can be recovered from a handful of outputs, and a *guessable* nonce is no
 * nonce at all — the whole point of `script-src 'nonce-…'` is that injected
 * markup cannot carry a valid one.
 */
export function getNonce(): string {
  return randomBytes(24).toString("base64url");
}

export interface PlayerHtmlInputs {
  nonce: string;
  cspSource: string;
  scriptUri: string;
  styleUri: string;
  /** The block "Dernière réponse". Without them the block stays hidden. */
  responsesScriptUri?: string;
  responsesStyleUri?: string;
}

/**
 * The player's whole document (AC-SEC-02). Extracted from the provider so it
 * can be asserted on without a live webview: the security property here is
 * that **no untrusted value is interpolated at all** — the inputs are a
 * nonce we generated and URIs VS Code produced. Titles, profile
 * names, inbox message text and Claude output never reach this string; they
 * arrive later over `postMessage` and are written with `textContent` by
 * `media/player/player.js`.
 *
 * CSP: `default-src 'none'` with an explicit nonce for scripts, and
 * `connect-src 'none'` so the webview has no network of its own (ADR-010:
 * the EgressGuard only has to cover the Extension Host).
 */
export function buildPlayerHtml(inputs: PlayerHtmlInputs): string {
  const { nonce, cspSource, scriptUri, styleUri, responsesScriptUri, responsesStyleUri } = inputs;
  const csp = [
    "default-src 'none'",
    `media-src ${cspSource} blob:`,
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `font-src ${cspSource}`,
    `img-src ${cspSource}`,
    "connect-src 'none'"
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />${responsesStyleUri !== undefined ? `
  <link href="${responsesStyleUri}" rel="stylesheet" />` : ""}
  <title>LLM Voice Player</title>
</head>
<body data-state="idle">
  <div id="welcome">
    <p id="welcome-text">Aucune lecture en cours&hellip;</p>
    <div id="welcome-actions" role="group" aria-label="Démarrer une lecture">
      <button id="btn-setup-voice" class="welcome-button" type="button">Choisir une voix</button>
    </div>
  </div>

  <div id="title-line" class="line">
    <span id="title"></span>
    <span id="profile-group">
      <span id="profile"></span>
      <span id="voice"></span>
    </span>
  </div>

  <div id="wait" hidden>
    <div id="wait-head" class="line">
      <span id="wait-label"></span>
      <span id="wait-elapsed"></span>
    </div>
    <div
      id="wait-bar"
      role="progressbar"
      aria-label="Attente avant la lecture"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow="0"
      aria-valuetext=""
    >
      <div id="wait-fill"></div>
    </div>
    <div id="wait-text" class="wait-line"></div>
    <div id="wait-typical" class="wait-line" hidden></div>
    <div id="wait-note" class="wait-line" hidden></div>
    <div class="actions">
      <button id="btn-wait-cancel" class="action-button" type="button">Annuler</button>
    </div>
  </div>

  <div id="progress-line" class="line">
    <div
      id="progress-track"
      role="slider"
      tabindex="0"
      aria-label="Progression de la lecture"
      aria-valuemin="0"
      aria-valuemax="0"
      aria-valuenow="0"
    >
      <div id="progress-fill"></div>
    </div>
    <span id="time">00:00</span>
  </div>

  <div id="reading-line" hidden>
    <div id="speaker" class="wait-line"></div>
    <div id="reading" class="wait-line"></div>
    <div id="ahead" class="wait-line"></div>
  </div>

  <div id="status-line" class="line">
    <span id="status" role="status" aria-live="polite"></span>
  </div>

  <div id="transport" class="line" role="toolbar" aria-label="Contrôles de lecture">
    <button id="btn-prev" class="transport-button" type="button" aria-label="Segment précédent">⏮</button>
    <button id="btn-play-pause" class="transport-button" type="button" aria-label="Lecture">▶</button>
    <button id="btn-next" class="transport-button" type="button" aria-label="Segment suivant">⏭</button>
    <button id="btn-stop" class="transport-button" type="button" aria-label="Arrêter">⏹</button>
  </div>

  <div id="response-code-line" class="line" hidden>
    <button id="btn-response-code" class="action-button" type="button" aria-pressed="false" title="Lire ou non les blocs de code de cette réponse"></button>
    <span id="response-code-note" class="wait-line" hidden></span>
  </div>

  <div id="notice" hidden>
    <p id="notice-title"></p>
    <p id="notice-body"></p>
    <div class="actions">
      <button id="btn-notice-system" class="action-button" type="button">Lire avec la voix système</button>
      <button id="btn-notice-retry" class="action-button" type="button">Réessayer</button>
    </div>
  </div>

  <section id="responses" aria-label="Dernière réponse" hidden>
    <div class="response-head">
      <h2 class="response-heading">Dernière réponse</h2>
      <span id="response-latest-source"></span>
    </div>
    <p id="response-latest-title" class="response-cut"></p>
    <p id="response-latest-where" class="response-cut"></p>
    <p id="response-latest-duration" class="response-cut"></p>
    <div class="response-actions">
      <button id="btn-response-read" class="response-button response-button-primary" type="button">Tout lire</button>
    </div>
    <h2 id="responses-others-heading" class="response-heading"></h2>
    <div id="responses-others" role="list" aria-label="Autres réponses"></div>
    <div class="response-actions">
      <button id="btn-responses-all" class="response-button" type="button"><span id="responses-all-long"></span><span id="responses-all-short"></span></button>
    </div>
  </section>

  <section id="document" aria-label="Document ouvert">
    <div id="document-open" hidden>
      <h2 id="document-heading">Document ouvert</h2>
      <p id="document-name"></p>
      <div class="actions" role="group" aria-label="Lire le document ouvert">
        <button id="btn-read-document" class="action-button" type="button">Lire le document</button>
        <button id="btn-read-selection" class="action-button" type="button" hidden>Lire la sélection</button>
        <button id="btn-read-from-here" class="action-button" type="button">Lire à partir d'ici</button>
      </div>
      <p id="document-passages" class="wait-line" hidden></p>
      <div id="document-script" hidden>
        <p id="document-script-text" class="wait-line"></p>
        <div id="document-script-actions" class="actions" role="group" aria-label="Lecture à plusieurs voix">
          <button id="btn-toggle-cast" class="action-button" type="button">Lire à plusieurs voix</button>
          <button id="btn-cast-voices" class="action-button" type="button" hidden>Distribution</button>
        </div>
      </div>
    </div>
    <div id="document-empty">
      <p id="document-empty-text">Ouvrez un fichier pour le lire</p>
      <div class="actions">
        <button id="btn-read-clipboard" class="action-button" type="button">Lire le presse-papiers</button>
      </div>
    </div>
    <p id="document-note" class="wait-line">La lecture ne démarre jamais toute seule.</p>
  </section>

  <audio id="audio"></audio>

  <script nonce="${nonce}" src="${scriptUri}"></script>${responsesScriptUri !== undefined ? `
  <script nonce="${nonce}" src="${responsesScriptUri}"></script>` : ""}
</body>
</html>`;
}
