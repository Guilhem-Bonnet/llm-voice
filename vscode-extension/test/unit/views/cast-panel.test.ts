/** ADR-018 §6 : la ligne du panneau propose ; elle ne lit rien, et ne montre aucun nom. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const JS = readFileSync(resolve(__dirname, "../../../media/player/player.js"), "utf8");
const CSS = readFileSync(resolve(__dirname, "../../../media/player/player.css"), "utf8");
const HTML = readFileSync(resolve(__dirname, "../../../src/views/player/playerHtml.ts"), "utf8");

describe("le bloc « Document ouvert » et le jeu d'acteurs", () => {
  it("ses deux boutons ont la taille fixe des actions du panneau", () => {
    expect(HTML).toMatch(/id="btn-toggle-cast" class="action-button"/);
    expect(HTML).toMatch(/id="btn-cast-voices" class="action-button"/);
    expect(CSS).toMatch(/\.action-button \{[^}]*flex: none;[^}]*height: 26px;/s);
    expect(CSS).toMatch(/\.action-button \{[^}]*white-space: nowrap;/s);
  });

  it("ses boutons envoient un réglage et une liste, jamais une lecture", () => {
    expect(JS).toMatch(/toggleCast\.addEventListener\("click", \(\) => post\(\{ type: "userAction", action: "toggleCast" \}\)\)/);
    expect(JS).toMatch(/castVoices\.addEventListener\("click", \(\) => post\(\{ type: "userAction", action: "chooseCastVoices" \}\)\)/);
  });

  it("le texte passe par textContent, et `hidden` masque vraiment une ligne en flex", () => {
    expect(JS).toMatch(/scriptText\.textContent =/);
    expect(JS).toMatch(/speakerEl\.textContent =/);
    expect(JS).not.toMatch(/innerHTML/);
    expect(CSS).toMatch(/#document-script-actions\[hidden\]/);
  });
});
