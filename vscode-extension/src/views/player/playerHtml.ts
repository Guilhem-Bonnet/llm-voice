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
}

/**
 * The player's whole document (AC-SEC-02). Extracted from the provider so it
 * can be asserted on without a live webview: the security property here is
 * that **no untrusted value is interpolated at all** — the four inputs are
 * a nonce we generated and three URIs VS Code produced. Titles, profile
 * names, inbox message text and Claude output never reach this string; they
 * arrive later over `postMessage` and are written with `textContent` by
 * `media/player/player.js`.
 *
 * CSP: `default-src 'none'` with an explicit nonce for scripts, and
 * `connect-src 'none'` so the webview has no network of its own (ADR-010:
 * the EgressGuard only has to cover the Extension Host).
 */
export function buildPlayerHtml(inputs: PlayerHtmlInputs): string {
  const { nonce, cspSource, scriptUri, styleUri } = inputs;
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
  <link href="${styleUri}" rel="stylesheet" />
  <title>LLM Voice Player</title>
</head>
<body data-state="idle">
  <div id="welcome">
    <p id="welcome-text">Aucune lecture en cours&hellip;</p>
    <div id="welcome-actions" role="group" aria-label="Démarrer une lecture">
      <button id="btn-setup-voice" class="welcome-button" type="button">Choisir une voix</button>
      <button id="btn-speak-current" class="welcome-button" type="button">Lire le document actuel</button>
    </div>
  </div>

  <div id="title-line" class="line">
    <span id="title"></span>
    <span id="profile"></span>
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

  <div id="transport" class="line" role="toolbar" aria-label="Contrôles de lecture">
    <button id="btn-prev" class="transport-button" type="button" aria-label="Segment précédent">⏮</button>
    <button id="btn-play-pause" class="transport-button" type="button" aria-label="Lecture">▶</button>
    <button id="btn-next" class="transport-button" type="button" aria-label="Segment suivant">⏭</button>
    <button id="btn-stop" class="transport-button" type="button" aria-label="Arrêter">⏹</button>
  </div>

  <audio id="audio"></audio>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
