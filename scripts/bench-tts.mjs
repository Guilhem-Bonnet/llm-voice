#!/usr/bin/env node
/**
 * S6.2 — TTS latency benchmark against a *real* server, plain Node, zero
 * npm dependency (only `node:*` built-ins), run from the repo root:
 *
 *   node scripts/bench-tts.mjs
 *   node scripts/bench-tts.mjs --base-url http://127.0.0.1:8004 --out /tmp/bench.json
 *
 * Measures, for chunk sizes of 1, 2, 3 sentences and a whole paragraph, on a
 * fixed extract from `vscode-extension/test/fixtures/markdown/
 * kubernetes-course.md` (CdC §33's "compromis taille de chunk"):
 *
 *   - TTFA: wall-clock time of the request that synthesises *that chunk
 *     alone* — since `POST /tts` is not streaming (ADR-005: no provider
 *     implements `synthesizeStream` yet), the first byte and the last byte
 *     of a chunk's audio arrive together, so "time until the first chunk is
 *     ready to play" *is* this request's total latency (CdC §63).
 *   - RTF (real-time factor): `elapsedMs / audioDurationMs`, the latter read
 *     from the returned WAV's own header (`node:fs`-free — pure byte
 *     parsing, no `wav`/`node-wav` dependency).
 *
 * Talks the same native `POST /tts` contract as
 * `src/tts/ChatterboxProvider.ts` (voice-cloning mode, CdC §55), with the
 * exact parameters `docs/e2e/report-2026-09-08.md` validated
 * (`exaggeration: 0.4, cfg_weight: 0.5, temperature: 0.6`) — this script
 * intentionally does not import any TypeScript source (no build step
 * required to run it, and it must keep working standalone even if the
 * extension's provider code changes shape).
 *
 * Output: a Markdown table on stdout, and (with `--out`) the same data as
 * JSON — both carry every raw sample, not just the mean, so a reviewer can
 * see the jitter directly (CdC §63 cares about worst case, not average).
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// -------------------------------------------------------------- CLI args

function parseArgs(argv) {
  const args = { baseUrl: "http://127.0.0.1:8004", out: undefined, runs: 1, voice: "fr-female-siwis.wav" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base-url") {
      args.baseUrl = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--runs") {
      args.runs = Number(argv[++i]);
    } else if (arg === "--voice") {
      args.voice = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }
  return args;
}

// -------------------------------------------------------- fixture extract

// Verbatim sentences from `test/fixtures/markdown/kubernetes-course.md`
// (§1 "Qu'est-ce que Kubernetes ?" and §2 "Le Pod, unité de base"),
// concatenated across their two source paragraphs into one flat list so
// "N sentences" and "the whole paragraph" are both well-defined against the
// exact same source text.
const EXTRACT_SENTENCES = [
  "Kubernetes est un orchestrateur de conteneurs open source.",
  "Il automatise le déploiement, la mise à l'échelle et la gestion des applications conteneurisées.",
  "Un Pod est la plus petite unité déployable de Kubernetes.",
  "Il encapsule un ou plusieurs conteneurs partageant le même réseau et le même stockage.",
  "Un Deployment gère un ReplicaSet, qui lui-même gère un ensemble de pods identiques.",
  "Un Service expose un ensemble de pods sous une adresse stable."
];

const CHUNK_SPECS = [
  { label: "1 phrase", sentenceCount: 1 },
  { label: "2 phrases", sentenceCount: 2 },
  { label: "3 phrases", sentenceCount: 3 },
  { label: `paragraphe (${EXTRACT_SENTENCES.length} phrases)`, sentenceCount: EXTRACT_SENTENCES.length }
];

function textFor(sentenceCount) {
  return EXTRACT_SENTENCES.slice(0, sentenceCount).join(" ");
}

// ------------------------------------------------------------- WAV parsing

/**
 * Minimal RIFF/WAVE PCM header reader: enough to recover `durationMs`
 * without a `wav`/`node-wav` dependency. Walks chunks rather than assuming a
 * fixed 44-byte header (Chatterbox sometimes emits extra chunks before
 * `data`).
 */
function wavDurationMs(buffer) {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE buffer");
  }
  let offset = 12;
  let sampleRate;
  let numChannels;
  let bitsPerSample;
  let dataBytes;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (chunkId === "fmt ") {
      numChannels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);
    } else if (chunkId === "data") {
      dataBytes = chunkSize;
    }
    offset = body + chunkSize + (chunkSize % 2); // chunks are word-aligned
  }
  if (sampleRate === undefined || numChannels === undefined || bitsPerSample === undefined || dataBytes === undefined) {
    throw new Error("incomplete WAV header (missing fmt or data chunk)");
  }
  const bytesPerFrame = numChannels * (bitsPerSample / 8);
  return (dataBytes / bytesPerFrame / sampleRate) * 1000;
}

// ------------------------------------------------------------------ bench

/**
 * One `POST /tts` call, in the same voice-cloning mode
 * `src/tts/ChatterboxProvider.ts` uses by default (CdC §55), with the
 * parameters `docs/e2e/report-2026-09-08.md` validated by ear.
 */
async function synthesizeOnce(baseUrl, text, voice) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/tts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      voice_mode: "clone",
      reference_audio_filename: voice,
      language: "fr",
      exaggeration: 0.4,
      cfg_weight: 0.5,
      temperature: 0.6,
      output_format: "wav"
    })
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${baseUrl}/tts`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const elapsedMs = performance.now() - startedAt;
  const durationMs = wavDurationMs(buffer);
  return { elapsedMs, durationMs, bytes: buffer.length };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function runBench(args) {
  console.error(`[bench-tts] target: ${args.baseUrl}, voice (clone): ${args.voice}, runs/chunk: ${args.runs}`);
  console.error("[bench-tts] warm-up call (absorbs cold start, not counted)...");
  const warmupStartedAt = performance.now();
  let coldStartMs;
  try {
    await synthesizeOnce(args.baseUrl, "Bonjour, ceci est un test de préchauffage.", args.voice);
    coldStartMs = performance.now() - warmupStartedAt;
    console.error(`[bench-tts] warm-up done in ${coldStartMs.toFixed(0)}ms`);
  } catch (error) {
    console.error(`[bench-tts] warm-up failed: ${error.message} — continuing anyway`);
  }

  const results = [];
  for (const spec of CHUNK_SPECS) {
    const text = textFor(spec.sentenceCount);
    const samples = [];
    for (let run = 0; run < args.runs; run++) {
      console.error(`[bench-tts] ${spec.label} — run ${run + 1}/${args.runs} (${text.length} chars)...`);
      const sample = await synthesizeOnce(args.baseUrl, text, args.voice);
      samples.push(sample);
      console.error(
        `[bench-tts]   TTFA=${sample.elapsedMs.toFixed(0)}ms, audio=${sample.durationMs.toFixed(0)}ms, ` +
          `RTF=${(sample.elapsedMs / sample.durationMs).toFixed(2)}`
      );
    }
    const ttfaMs = mean(samples.map((s) => s.elapsedMs));
    const audioMs = mean(samples.map((s) => s.durationMs));
    results.push({
      label: spec.label,
      sentenceCount: spec.sentenceCount,
      textChars: text.length,
      samples,
      ttfaMsMean: ttfaMs,
      audioMsMean: audioMs,
      rtfMean: ttfaMs / audioMs
    });
  }

  return { baseUrl: args.baseUrl, voice: args.voice, coldStartMs, measuredAt: new Date().toISOString(), results };
}

function toMarkdownTable(report) {
  const lines = [
    "| Taille de chunk | Caractères | TTFA moyen (ms) | Audio (ms) | RTF |",
    "|---|---|---|---|---|"
  ];
  for (const r of report.results) {
    lines.push(
      `| ${r.label} | ${r.textChars} | ${r.ttfaMsMean.toFixed(0)} | ${r.audioMsMean.toFixed(0)} | ${r.rtfMean.toFixed(2)} |`
    );
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/bench-tts.mjs [--base-url http://127.0.0.1:8004] [--voice fr-female-siwis.wav] [--runs 1] [--out path.json]"
    );
    return;
  }

  const report = await runBench(args);

  console.log(`\n## Résultats — ${report.measuredAt}\n`);
  console.log(`Serveur : \`${report.baseUrl}\` — voix (clone) : \`${report.voice}\``);
  if (report.coldStartMs !== undefined) {
    console.log(`Cold start (préchauffage, hors mesure) : ${report.coldStartMs.toFixed(0)} ms\n`);
  }
  console.log(toMarkdownTable(report));

  if (args.out !== undefined) {
    const outPath = path.isAbsolute(args.out) ? args.out : path.join(REPO_ROOT, args.out);
    await writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
    console.error(`\n[bench-tts] JSON written to ${outPath}`);
  }
}

main().catch((error) => {
  console.error(`[bench-tts] FAILED: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
