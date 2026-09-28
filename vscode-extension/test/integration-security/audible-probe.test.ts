import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

/** 10 s de sinus 440 Hz, PCM 16 bits mono 22050 Hz — audible, pas du silence. */
function tone(seconds: number): Buffer {
  const rate = 22050;
  const n = rate * seconds;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

suite("sonde audible — le webview produit-il vraiment du son ?", () => {
  test("joue 10 s de sinus dans un webview réel", async function () {
    this.timeout(60000);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llmv-probe-"));
    const wav = path.join(dir, "tone.wav");
    await fs.writeFile(wav, tone(10));

    const panel = vscode.window.createWebviewPanel("llmVoice.probe", "Sonde", vscode.ViewColumn.One, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(dir)],
      retainContextWhenHidden: true
    });
    const src = panel.webview.asWebviewUri(vscode.Uri.file(wav)).toString();
    const events: string[] = [];
    panel.webview.onDidReceiveMessage((m: { t: string; v?: unknown }) => {
      events.push(`${m.t}:${JSON.stringify(m.v ?? null)}`);
    });
    panel.webview.html = `<!DOCTYPE html><html><body>
<audio id="a" src="${src}"></audio>
<script>
const vs = acquireVsCodeApi(); const a = document.getElementById("a");
a.addEventListener("playing", () => vs.postMessage({ t: "playing" }));
a.addEventListener("timeupdate", () => vs.postMessage({ t: "time", v: a.currentTime }));
a.addEventListener("error", () => vs.postMessage({ t: "error", v: a.error && a.error.code }));
a.muted = true; a.play().then(() => vs.postMessage({ t: "playCalled" })).catch(e => vs.postMessage({ t: "playRejected", v: String(e) }));
</script></body></html>`;

    await new Promise((r) => setTimeout(r, 12000));
    panel.dispose();
    console.log("SONDE_EVENEMENTS " + JSON.stringify(events.slice(0, 6)));
    console.log("SONDE_DERNIER " + JSON.stringify(events[events.length - 1] ?? "aucun"));
    assert.ok(events.length > 0, "aucun événement reçu du webview");
  });
});
