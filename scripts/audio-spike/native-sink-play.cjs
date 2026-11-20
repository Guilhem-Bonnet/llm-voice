// Preuve de bout en bout de l'étape B (GAO-core-rust-mi-001) : le vrai
// NativeAudioSink compilé de l'extension joue un WAV via le vrai Core Rust,
// lancé par le vrai CoreProcess. Usage : via native-sink-play.sh (routage
// PipeWire) avec LLM_VOICE_AUDIO_PROOF_WAV défini par le banc.
const path = require("node:path");
const os = require("node:os");
const root = path.resolve(__dirname, "../..");
const { CoreProcess } = require(path.join(root, "vscode-extension/out/src/playback/CoreProcess.js"));
const { NativeAudioSink } = require(path.join(root, "vscode-extension/out/src/playback/NativeAudioSink.js"));

async function main() {
  const wav = process.env.LLM_VOICE_AUDIO_PROOF_WAV;
  if (!wav) throw new Error("LLM_VOICE_AUDIO_PROOF_WAV manquant");
  const core = new CoreProcess({
    cacheDir: path.dirname(wav),
    extensionPath: path.join(root, "vscode-extension"),
    corePathOverride: path.join(root, "target/release/llm-voice-core"),
  });
  const sink = new NativeAudioSink({ connect: () => core.ensureRunning() });
  const done = new Promise((resolve, reject) => {
    sink.on("ended", resolve);
    sink.on("error", (e) => reject(new Error(JSON.stringify(e))));
    setTimeout(() => reject(new Error("timeout 60 s sans ended")), 60000);
  });
  await sink.load({ chunkId: process.env.LLM_VOICE_PROOF_CHUNK_ID || "session-1:0", src: wav, format: "wav" });
  sink.play();
  await done;
  sink.dispose();
  await (core.dispose ? core.dispose() : undefined);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
