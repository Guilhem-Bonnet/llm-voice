/**
 * The profile editor webview's static document (S8.2, CdC §49, AC-SEC-02) —
 * same posture as `views/player/playerHtml.ts`: this file takes only a
 * nonce and three URIs VS Code produced, and interpolates nothing else.
 * Every profile field (name, description, voice id, narration prompt…)
 * arrives later over `postMessage` and is written by
 * `media/profileEditor/profileEditor.js` with `textContent`/`.value`,
 * never `innerHTML` — the property this file's own unit test
 * (`test/unit/views/profileEditorHtml.test.ts`) checks by construction:
 * there is no template slot for profile data to begin with.
 *
 * CSP: identical shape to the player's (`default-src 'none'`, nonced
 * script/style, `connect-src 'none'` — this webview has no network of its
 * own either, ADR-010).
 */

import { getNonce } from "../player/playerHtml.js";

export { getNonce };

export interface ProfileEditorHtmlInputs {
  nonce: string;
  cspSource: string;
  scriptUri: string;
  styleUri: string;
}

export function buildProfileEditorHtml(inputs: ProfileEditorHtmlInputs): string {
  const { nonce, cspSource, scriptUri, styleUri } = inputs;
  const csp = [
    "default-src 'none'",
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
  <title>LLM Voice — Profile Editor</title>
</head>
<body>
  <form id="profile-form" aria-label="Éditeur de profil">
    <div id="validation-errors" role="alert" aria-live="polite"></div>

    <fieldset>
      <legend>Général</legend>
      <label for="field-label">Nom</label>
      <input id="field-label" name="label" type="text" required />

      <label for="field-language">Langue (BCP-47)</label>
      <input id="field-language" name="language" type="text" required placeholder="fr-FR" />

      <label for="field-description">Description</label>
      <textarea id="field-description" name="description" rows="2"></textarea>
    </fieldset>

    <fieldset>
      <legend>Narration</legend>
      <label for="field-mode">Mode</label>
      <select id="field-mode" name="mode">
        <option value="faithful">Lecture fidèle</option>
        <option value="narrated">Narré</option>
      </select>

      <div id="narrator-fields">
        <label for="field-narrator-provider">Narrateur</label>
        <select id="field-narrator-provider" name="narratorProvider">
          <option value="">Aucun</option>
          <option value="ollama">Ollama (local)</option>
          <option value="openai-compatible">Compatible OpenAI</option>
        </select>

        <label for="field-narrator-model">Modèle</label>
        <input id="field-narrator-model" name="narratorModel" type="text" />

        <label for="field-style">Consigne de narration</label>
        <textarea id="field-style" name="style" rows="3"></textarea>
      </div>
    </fieldset>

    <fieldset>
      <legend>Voix (TTS)</legend>
      <label for="field-tts-provider">Provider</label>
      <select id="field-tts-provider" name="ttsProvider">
        <option value="chatterbox">Chatterbox (local)</option>
        <option value="kokoro">Kokoro (local)</option>
        <option value="system">Voix système</option>
        <option value="openai-compatible">Compatible OpenAI</option>
      </select>

      <label for="field-tts-base-url">Base URL</label>
      <input id="field-tts-base-url" name="ttsBaseUrl" type="text" />

      <label for="field-tts-voice">Voix</label>
      <div id="voice-row">
        <input id="field-tts-voice" name="ttsVoice" type="text" />
        <button id="btn-browse-voices" type="button">Parcourir les voix</button>
      </div>
      <p id="voice-warning" role="alert" hidden></p>

      <label for="field-speed">Vitesse</label>
      <input id="field-speed" name="speed" type="number" min="0.5" max="3" step="0.05" />

      <div id="tts-parameters" aria-label="Réglages avancés du provider"></div>
    </fieldset>

    <fieldset>
      <legend>Markdown</legend>
      <label for="field-md-code">Code</label>
      <select id="field-md-code" name="markdownCode">
        <option value="skip">Ignorer</option>
        <option value="read">Lire</option>
        <option value="explain">Expliquer</option>
        <option value="summarize">Résumer</option>
      </select>

      <label for="field-md-links">Liens</label>
      <select id="field-md-links" name="markdownLinks">
        <option value="labelOnly">Texte du lien seulement</option>
      </select>

      <label for="field-md-images">Images</label>
      <select id="field-md-images" name="markdownImages">
        <option value="skip">Ignorer</option>
        <option value="altText">Texte alternatif</option>
      </select>

      <label for="field-md-tables">Tableaux</label>
      <select id="field-md-tables" name="markdownTables">
        <option value="skip">Ignorer</option>
        <option value="read">Lire</option>
        <option value="summarize">Résumer</option>
      </select>
    </fieldset>

    <fieldset>
      <legend>Synchronisation</legend>
      <label for="field-sync-mode">Surlignage éditeur</label>
      <select id="field-sync-mode" name="syncMode">
        <option value="highlight-scroll">Surligner et faire défiler</option>
        <option value="highlight">Surligner seulement</option>
        <option value="off">Désactivé</option>
      </select>
    </fieldset>

    <div id="actions" role="toolbar" aria-label="Actions du profil">
      <button id="btn-test" type="button">Tester</button>
      <button id="btn-save" type="submit">Enregistrer</button>
      <button id="btn-duplicate" type="button">Dupliquer</button>
      <button id="btn-delete" type="button">Supprimer</button>
    </div>
    <p id="test-status" role="status" aria-live="polite"></p>
  </form>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
