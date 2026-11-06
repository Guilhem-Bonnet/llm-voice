/**
 * The document of the view "Réponses" (`llmVoice.inboxView`). No `vscode` import so it
 * can be asserted on directly, and no reply in it: only a nonce and URIs are
 * interpolated, the rows arrive by `postMessage` and are written with `textContent`.
 */

export interface ResponsesHtmlInputs {
  nonce: string;
  cspSource: string;
  scriptUri: string;
  styleUri: string;
}

export function buildResponsesHtml(inputs: ResponsesHtmlInputs): string {
  const { nonce, cspSource, scriptUri, styleUri } = inputs;
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource}`,
    `img-src ${cspSource}`,
    "connect-src 'none'"
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Réponses</title>
</head>
<body class="responses-page">
  <div id="responses-empty" hidden>
    <p class="responses-empty-title">Aucune réponse pour l'instant</p>
    <p>Copiez une réponse depuis n'importe quel outil, puis lisez-la d'un raccourci.</p>
    <div class="response-actions">
      <button id="btn-responses-clipboard" class="response-button response-button-primary" type="button">Lire le presse-papiers</button>
    </div>
    <p class="response-note">Ctrl+Alt+V puis C</p>
    <hr class="responses-rule" />
    <p>Certains outils peuvent aussi déposer leurs réponses ici.</p>
    <div class="response-actions">
      <button id="btn-responses-connect" class="response-button" type="button">Connecter un outil</button>
    </div>
    <p class="response-note">Tout reste sur votre machine. Rien ne se lit tout seul.</p>
  </div>

  <div id="responses-list" role="list" aria-label="Réponses"></div>

  <div class="response-actions">
    <button id="btn-responses-older" class="response-button" type="button" hidden>Afficher les plus anciennes</button>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
