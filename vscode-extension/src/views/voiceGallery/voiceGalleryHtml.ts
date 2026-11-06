/**
 * The voice gallery's document and its CSP, split from the panel so both can be
 * asserted on without a live webview (same reason as `playerHtml.ts`). No voice,
 * label or phrase reaches this string: the four inputs are a nonce we generated and
 * three values VS Code produced; the rest arrives over `postMessage` and is written
 * with `textContent` by `media/voiceGallery/voiceGallery.js`.
 */

export interface VoiceGalleryHtmlInputs {
  nonce: string;
  cspSource: string;
  scriptUri: string;
  styleUri: string;
}

/**
 * `media-src` is `cspSource` alone: no `blob:`, no remote host. Samples and trial
 * phrases are files on this machine, and `connect-src 'none'` leaves the page no
 * network of its own (ADR-010).
 */
export function voiceGalleryCsp(nonce: string, cspSource: string): string {
  return [
    "default-src 'none'",
    `media-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource}`,
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join("; ");
}

export function buildVoiceGalleryHtml(inputs: VoiceGalleryHtmlInputs): string {
  const { nonce, cspSource, scriptUri, styleUri } = inputs;
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${voiceGalleryCsp(nonce, cspSource)}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Galerie de voix</title>
</head>
<body>
  <main id="gallery-view" class="page">
    <header class="page-header">
      <div class="page-title">
        <h1>Choisir une voix</h1>
        <p class="muted">Écoutez, puis choisissez. La voix sert à toutes vos lectures, quel que soit le mode de lecture.</p>
      </div>
      <div class="current-voice">
        <span class="muted">Voix actuelle</span>
        <strong id="current-voice"></strong>
      </div>
    </header>

    <div class="toolbar">
      <input id="search" class="field" type="search" placeholder="Rechercher une voix" aria-label="Rechercher une voix" />
      <div class="button-group" role="group" aria-label="Filtrer les voix">
        <button id="filter-all" class="button" type="button" aria-pressed="true">Toutes</button>
        <button id="filter-ready" class="button" type="button" aria-pressed="false">Prêtes</button>
        <button id="filter-favorites" class="button" type="button" aria-pressed="false">Favorites</button>
      </div>
    </div>

    <div id="phrase-row" class="toolbar">
      <label class="muted small" for="phrase">Phrase d'essai</label>
      <input id="phrase" class="field" type="text" maxlength="300" placeholder="Votre phrase, envoyée au moteur au clic. Sinon, l'échantillon inclus ou une phrase par défaut." />
      <button id="phrase-reset" class="button" type="button">Rétablir</button>
    </div>

    <div id="server-banner" class="banner" role="status" hidden>
      <div class="banner-text">
        <strong id="banner-title"></strong>
        <span id="banner-detail" class="muted small"></span>
        <code id="banner-command" class="command"></code>
      </div>
      <button id="banner-copy" class="button" type="button">Copier la commande</button>
      <button id="banner-check" class="button" type="button">Vérifier</button>
    </div>

    <p id="notice" class="notice small" role="status" aria-live="polite" hidden></p>

    <section id="section-local" class="section">
      <h2>Prêtes sur cette machine</h2>
      <div id="cards-local" class="cards"></div>
    </section>

    <section id="section-kyutai16" class="section">
      <div class="section-head">
        <h2>Kyutai narration · 36 voix en français</h2>
        <span id="kyutai16-status" class="small"></span>
        <button id="kyutai16-credits" class="button" type="button">Crédits et licences</button>
      </div>
      <p id="kyutai16-note" class="muted small"></p>
      <div id="kyutai16-server" class="banner" hidden>
        <div class="banner-text">
          <strong>Serveur à démarrer depuis le dépôt</strong>
          <span class="muted small">Il utilise la carte graphique et ne fonctionne que sur votre machine. Rien ne démarre sans vous.</span>
          <code id="kyutai16-command" class="command"></code>
        </div>
        <button id="kyutai16-copy" class="button" type="button">Copier la commande</button>
        <button id="kyutai16-check" class="button" type="button">Vérifier</button>
      </div>
      <div id="cards-kyutai16" class="cards"></div>
    </section>

    <section id="section-kyutai" class="section">
      <div class="section-head">
        <h2>Kyutai Pocket TTS · 20 voix en français</h2>
        <span id="kyutai-status" class="small"></span>
        <button id="open-credits" class="button" type="button">Crédits et licences</button>
      </div>
      <div id="cards-kyutai" class="cards"></div>
    </section>

    <section id="section-prepare" class="section">
      <h2>À préparer</h2>
      <div id="cards-prepare" class="cards cards-wide"></div>
    </section>

    <p id="empty" class="muted" hidden>Aucune voix ne correspond.</p>
  </main>

  <main id="credits-view" class="page page-credits" hidden>
    <header class="page-title">
      <h1>Crédits des voix</h1>
      <p id="credits-subtitle" class="muted"></p>
    </header>
    <div id="credits-groups" class="credits"></div>
    <p id="credits-clause" class="muted small"></p>
    <div id="credits-links" class="button-group"></div>
    <div class="button-group">
      <button id="credits-back" class="button" type="button">Retour à la galerie</button>
    </div>
  </main>

  <audio id="audio" preload="none"></audio>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
