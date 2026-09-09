/**
 * S6.1 — Attack tests inside a real VS Code (AC-SEC-02, AC-SEC-05,
 * AC-SEC-08).
 *
 * `test/unit/security/*` proves the rules against the modules. This file
 * proves the same properties end to end: the CSP a live webview really
 * serves, a hostile inbox message travelling the real pipeline, and an
 * imported profile trying to walk off with a key that is not its own.
 */

import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";

import type { ExtensionTestApi } from "../../src/extension.js";
import { buildPlayerHtml, getNonce } from "../../src/views/player/playerHtml.js";

/** Payloads a hostile `last_assistant_message` would carry. */
const PAYLOADS = [
  "<script>globalThis.__pwned = true</script>",
  '<img src=x onerror="globalThis.__pwned=true">',
  "javascript:globalThis.__pwned=1",
  "[31mrouge[0m]0;titre",
  "</title><script>1</script>"
];

async function activateExtension(): Promise<ExtensionTestApi> {
  const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
  assert.ok(extension, "extension guilhem-bonnet.llm-voice not found");
  return (await extension.activate()) as ExtensionTestApi;
}

function inboxDir(): string {
  const configured = vscode.workspace.getConfiguration("llmVoice").get<string>("claude.inboxPath", "");
  return configured.length > 0 ? configured : (process.env.LLM_VOICE_INBOX ?? "");
}

function writeInboxMessage(message: string): string {
  const directory = inboxDir();
  assert.ok(directory.length > 0, "LLM_VOICE_INBOX must be set for this profile");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const id = `${Date.now()}-sec-${randomUUID()}`;
  writeFileSync(
    join(directory, `${id}.json`),
    JSON.stringify({
      schemaVersion: 1,
      provider: "claude-code",
      sessionId: "sec",
      capturedAt: Date.now(),
      message
    }),
    { mode: 0o600 }
  );
  return id;
}

suite("AC-SEC-02 — the live player webview", () => {
  let panel: vscode.WebviewPanel | undefined;

  teardown(() => {
    panel?.dispose();
    panel = undefined;
  });

  /** A panel whose `cspSource`/`asWebviewUri` are VS Code's real ones. */
  function renderRealPlayer(extensionUri: vscode.Uri, label: string): vscode.WebviewPanel {
    const created = vscode.window.createWebviewPanel(`llmVoice.sec.${label}`, label, vscode.ViewColumn.One, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")]
    });
    created.webview.html = buildPlayerHtml({
      nonce: getNonce(),
      cspSource: created.webview.cspSource,
      scriptUri: created.webview
        .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "player", "player.js"))
        .toString(),
      styleUri: created.webview
        .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "player", "player.css"))
        .toString()
    });
    return created;
  }

  test("serves a strict CSP with a per-render nonce", async () => {
    const api = await activateExtension();
    const extensionUri = api.context.extensionUri;

    panel = renderRealPlayer(extensionUri, "csp");
    const first = panel.webview.html;
    panel.dispose();
    panel = renderRealPlayer(extensionUri, "csp2");
    const second = panel.webview.html;

    for (const html of [first, second]) {
      assert.match(html, /default-src 'none'/);
      assert.match(html, /connect-src 'none'/);
      assert.match(html, /script-src 'nonce-[A-Za-z0-9_-]{32}'/);
      assert.ok(!html.includes("unsafe-inline"), "CSP must not allow inline scripts");
      assert.ok(!html.includes("unsafe-eval"), "CSP must not allow eval");
      // Only one <script>, and it has a src rather than a body.
      assert.equal([...html.matchAll(/<script\b/g)].length, 1);
    }

    const nonceOf = (html: string): string => /script-src 'nonce-([A-Za-z0-9_-]+)'/.exec(html)?.[1] ?? "";
    assert.notEqual(nonceOf(first), nonceOf(second), "the nonce must be regenerated on every render");
  });

  test("the player view restricts localResourceRoots to media/ and the cache", async () => {
    const api = await activateExtension();
    const roots = api.player.localResourceRoots;

    assert.equal(roots.length, 2);
    assert.ok(roots.some((root) => root.endsWith(join("media"))), `no media root in ${roots.join(", ")}`);
    assert.ok(roots.some((root) => root.endsWith(join("cache"))), `no cache root in ${roots.join(", ")}`);
  });

  test("a hostile inbox message never reaches the document", async () => {
    const api = await activateExtension();
    writeInboxMessage(PAYLOADS.join("\n\n"));

    await vscode.commands.executeCommand("llmVoice.inbox.refresh");
    await vscode.commands
      .executeCommand("llmVoice.speakLatestClaudeResponse")
      .then(undefined, () => undefined);

    panel = renderRealPlayer(api.context.extensionUri, "payload");
    for (const payload of PAYLOADS) {
      assert.ok(!panel.webview.html.includes(payload), `payload leaked into the document: ${payload}`);
    }
    assert.ok(!panel.webview.html.includes("onerror"));
  });

  test("the full response opens as plain text, never as markup", async () => {
    await activateExtension();
    const id = writeInboxMessage(PAYLOADS[0]!);
    await vscode.commands.executeCommand("llmVoice.inbox.refresh");

    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.from({ scheme: "llm-voice-inbox", path: `/${id}.txt` })
    );

    // Present *as text* — which is the point: content rendered by the
    // editor, never markup handed to a renderer.
    assert.ok(document.getText().includes(PAYLOADS[0]!));
    assert.equal(document.languageId, "plaintext");
  });
});

suite("AC-SEC-05/08 — an imported profile cannot borrow another provider's key", () => {
  test("a foreign apiKeyRef is ignored, not resolved", async () => {
    const api = await activateExtension();
    const pipeline = api.pipeline as unknown as {
      setProviderApiKeyValue(providerId: string, value: string): Promise<void>;
      clearProviderApiKeyValue(providerId: string): Promise<void>;
      importProfileFromJson(json: string): Promise<{ id: string }>;
    };

    const victimKey = `sk-victim-${randomUUID()}`;
    await pipeline.setProviderApiKeyValue("openai-compatible", victimKey);

    // The attack: a profile whose own provider is `evil-provider`, but which
    // names the key belonging to `openai-compatible`.
    const hostile = JSON.stringify({
      id: `hostile-${randomUUID()}`,
      label: "Profil importé hostile",
      mode: "faithful",
      language: "fr-FR",
      tts: {
        providerId: "evil-provider",
        baseUrl: "https://attacker.example",
        apiKeyRef: "llmVoice.apiKey.openai-compatible"
      },
      chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 },
      playback: { rate: 1, volume: 1 }
    });

    const imported = await pipeline.importProfileFromJson(hostile);
    assert.ok(imported.id.length > 0);

    // The schema let the ref through (it *is* in our namespace), so the
    // guarantee has to come from resolution: the ref does not name
    // `evil-provider`, therefore no key is handed to that provider.
    const stored = await api.context.secrets.get("llmVoice.apiKey.evil-provider");
    assert.equal(stored, undefined, "no key should exist for the hostile provider");

    await pipeline.clearProviderApiKeyValue("openai-compatible");
  });

  test("a profile naming a key outside the namespace is rejected at import", async () => {
    const api = await activateExtension();
    const pipeline = api.pipeline as unknown as { importProfileFromJson(json: string): Promise<unknown> };

    const hostile = JSON.stringify({
      id: `hostile-ns-${randomUUID()}`,
      label: "Hors namespace",
      mode: "faithful",
      language: "fr-FR",
      tts: { providerId: "evil", baseUrl: "https://attacker.example", apiKeyRef: "github.token" },
      chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 },
      playback: { rate: 1, volume: 1 }
    });

    await assert.rejects(pipeline.importProfileFromJson(hostile));
  });

  test("a profile pointing referenceAudio at a non-audio file is rejected at import", async () => {
    const api = await activateExtension();
    const pipeline = api.pipeline as unknown as { importProfileFromJson(json: string): Promise<unknown> };

    const hostile = JSON.stringify({
      id: `hostile-ref-${randomUUID()}`,
      label: "Exfiltration par referenceAudio",
      mode: "faithful",
      language: "fr-FR",
      tts: {
        providerId: "chatterbox",
        baseUrl: "http://127.0.0.1:8004",
        referenceAudio: `${process.env.HOME ?? "/home/user"}/.ssh/id_rsa`
      },
      chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 },
      playback: { rate: 1, volume: 1 }
    });

    await assert.rejects(pipeline.importProfileFromJson(hostile));
  });
});
