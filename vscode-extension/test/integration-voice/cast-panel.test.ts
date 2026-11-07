/**
 * GAO-studio-distr-001 : le panneau Distribution sur `docs/essais-voix/07-theatre-noms-seuls.md`
 * (personnages en lignes de noms seuls), avec la voix Qwen3 servie par `MockTtsServer`, à
 * travers la vraie chaîne `ttsFor`/`createTtsProvider`/`KyutaiPocketProvider`. Aucun son : le
 * panneau reçoit l'adresse du fichier, la page n'est pas pilotée ici.
 */
import * as assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as vscode from "vscode";
import { MockTtsServer } from "../fakes/mockTtsServer.js";

interface PanelRow {
  roleId: string;
  name: string;
  lines: number;
  firstLine: string;
  voiceId?: string;
  byUser: boolean;
}

interface PanelState {
  rows: PanelRow[];
  voices: { id: string; label: string; created: boolean }[];
  notice?: string;
  canCreateVoice: boolean;
}

interface TestPipeline {
  openCastPanel(): Promise<void>;
  castPanelStateForTest(): PanelState | undefined;
  dispatchCastPanelForTest(message: unknown): Promise<void>;
  observeCastPanelForTest(observer: ((message: unknown) => void) | undefined): void;
  closeCastPanelForTest(): void;
  resetAutoTtsCacheForTest(): void;
}

const QWEN3_VOICE = "fr-essais-21-22";

function fieldOf(body: string, name: string): string | undefined {
  return new RegExp(`name="${name}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`).exec(body)?.[1];
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor: ${what}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
}

suite("voice-chain: panneau Distribution (GAO-studio-distr-001)", () => {
  let pipeline: TestPipeline;
  let server: MockTtsServer;
  const posted: { type: string; [key: string]: unknown }[] = [];

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    assert.ok(extension);
    const api = (await extension.activate()) as { pipeline: unknown };
    pipeline = api.pipeline as TestPipeline;
    server = new MockTtsServer({
      healthBody: { status: "healthy", model_loaded: true },
      msPerChar: 2,
      kyutaiVoices: { voices: [{ id: QWEN3_VOICE, name: "Voix des essais 21 et 22", available: true, origin: "catalogue" }] }
    });
    const url = await server.listen();
    const storage = process.env.LLM_VOICE_TEST_STORAGE_DIR;
    assert.ok(storage);
    writeFileSync(join(storage, "global-voice.json"), JSON.stringify({ schemaVersion: 1, voice: { speed: 1, providerId: "qwen3", baseUrl: url, voice: QWEN3_VOICE } }));
    pipeline.resetAutoTtsCacheForTest();
    pipeline.observeCastPanelForTest((message) => posted.push(message as { type: string }));
  });

  suiteTeardown(async () => {
    pipeline.observeCastPanelForTest(undefined);
    pipeline.closeCastPanelForTest();
    await server.close();
  });

  test("liste ISAURE et LE COMTE, enregistre un choix, crée une voix par le contrat", async () => {
    const source = resolve(__dirname, "../../../../docs/essais-voix/07-theatre-noms-seuls.md");
    const file = join(mkdtempSync(join(tmpdir(), "cast-panel-")), "07-theatre-noms-seuls.md");
    copyFileSync(source, file);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file)));
    await pipeline.openCastPanel();
    await pipeline.dispatchCastPanelForTest({ type: "ready" });
    const state = pipeline.castPanelStateForTest();
    assert.ok(state);
    const names = state.rows.map((row) => row.name.toUpperCase());
    assert.ok(names.includes("ISAURE"), names.join(", "));
    assert.ok(names.includes("LE COMTE"), names.join(", "));
    assert.equal(state.canCreateVoice, true);
    // Une seule voix, celle du narrateur : le panneau s'ouvre quand même et dit quoi faire.
    assert.ok(state.notice?.includes("Créez une voix"), state.notice);
    const isaure = state.rows.find((row) => row.name.toUpperCase() === "ISAURE");
    assert.ok(isaure);
    assert.ok(isaure.firstLine.startsWith("Quel vent sur les remparts"), isaure.firstLine);

    // Créer une voix : `POST /voices/create`, formulaire, consigne anglaise, attribuée à Isaure.
    await pipeline.dispatchCastPanelForTest({
      type: "createVoice",
      name: "Isaure jeune",
      recipe: { gender: "woman", age: "young", timbre: "high", character: "proud, worried" },
      forRoleId: isaure.roleId,
      requestId: 1
    });
    const create = server.requests.find((request) => request.method === "POST" && request.url === "/voices/create");
    assert.ok(create, "POST /voices/create attendu");
    const form = new URLSearchParams(create.body);
    assert.equal(form.get("name"), "Isaure jeune");
    assert.match(form.get("description") ?? "", /^A young woman with a high-pitched/);
    assert.ok((form.get("sample_text") ?? "").startsWith("Quel vent"));
    assert.ok(posted.some((message) => message.type === "created" && message.requestId === 1));
    const afterCreate = pipeline.castPanelStateForTest();
    const created = afterCreate?.voices.find((voice) => voice.label === "Isaure jeune");
    assert.ok(created?.created, JSON.stringify(afterCreate?.voices));
    const isaureNow = afterCreate?.rows.find((row) => row.roleId === isaure.roleId);
    assert.equal(isaureNow?.voiceId, created.id);
    assert.equal(isaureNow?.byUser, true);

    // Changer : Le Comte prend la voix créée, choix enregistré `by: user`.
    const comte = afterCreate?.rows.find((row) => row.name.toUpperCase() === "LE COMTE");
    assert.ok(comte);
    await pipeline.dispatchCastPanelForTest({ type: "assign", roleId: comte.roleId, voiceId: created.id });
    const afterAssign = pipeline.castPanelStateForTest();
    assert.equal(afterAssign?.rows.find((row) => row.roleId === comte.roleId)?.voiceId, created.id);
    assert.equal(afterAssign?.rows.find((row) => row.roleId === comte.roleId)?.byUser, true);

    // Écouter : la voix candidate dit une vraie réplique ; l'extrait passe par `/voices/<id>/sample`.
    await pipeline.dispatchCastPanelForTest({ type: "listen", roleId: comte.roleId, voiceId: created.id, requestId: 2 });
    await waitFor(() => posted.some((message) => message.requestId === 2 && (message.type === "audio" || message.type === "failed")), "écoute");
    assert.ok(posted.some((message) => message.requestId === 2 && message.type === "audio"), JSON.stringify(posted.filter((message) => message.requestId === 2)));
    const tts = server.requests.filter((request) => request.method === "POST" && request.url === "/tts");
    assert.ok(tts.some((request) => fieldOf(request.body, "voice_url") === created.id && (fieldOf(request.body, "text") ?? "").startsWith("Madame, on a trouvé")));
    await pipeline.dispatchCastPanelForTest({ type: "sampleVoice", voiceId: created.id, requestId: 3 });
    assert.ok(posted.some((message) => message.requestId === 3 && message.type === "audio"));
    assert.ok(server.requests.some((request) => request.method === "GET" && request.url === `/voices/${created.id}/sample`));

    // Refaire la distribution : les choix de l'utilisateur restent.
    await pipeline.dispatchCastPanelForTest({ type: "recast" });
    assert.equal(pipeline.castPanelStateForTest()?.rows.find((row) => row.roleId === comte.roleId)?.byUser, true);
  });
});
