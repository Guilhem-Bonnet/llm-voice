/**
 * Shared rig of the director tests (not a test file). Real timers with small
 * budgets: the fake model's latency honours the abort signal, and no test
 * waits on more than a few hundred milliseconds. No real model, no network.
 */
import { afterEach } from "vitest";

import { createEgressGuard, type EgressGuardHandle, type EgressLogEvent } from "../../../../src/net/EgressGuard.js";
import { BibleStore, documentScope, type DocumentScope, type BibleRejection, type BibleWarning } from "../../../../src/direction/bible/index.js";
import type { SourceBlock } from "../../../../src/direction/controller/index.js";
import {
  Analyst,
  DEFAULT_WINDOW_SIZE,
  DirectionPipeline,
  FakeDirectionLlm,
  PartitionCache,
  StageDirector,
  type DirectionPipelineOptions,
  type DirectionSession,
  type DirectionTraceEvent,
  type FakeDirectionLlmOptions,
  type GpuYieldProbe,
  type OpenParams
} from "../../../../src/direction/director/index.js";
import { tempDirs } from "../bible/helpers.js";

export const newDirectory = tempDirs();

const NOUNS = ["voyageur", "chat", "pilote", "marin", "forgeron", "poète", "archer", "berger", "tisserand", "meunier", "sculpteur", "cartographe", "horloger", "jardinier", "libraire", "luthier"];

/** `seg-1`, `seg-2`… each a short sentence without digits or negation. */
export function makeBlocks(count: number, edit: Record<number, string> = {}): SourceBlock[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `seg-${index + 1}`,
    rawText: edit[index] ?? `Le ${NOUNS[index % NOUNS.length]} traverse la place au matin.`,
    type: "paragraph" as const
  }));
}

export interface RigOptions {
  readonly llm?: FakeDirectionLlmOptions;
  readonly directory?: string;
  readonly rawKey?: string;
  readonly persist?: boolean;
  readonly gpuYield?: GpuYieldProbe;
  readonly pipeline?: Partial<DirectionPipelineOptions>;
  readonly analystTimeoutMs?: number;
  readonly directorTimeoutMs?: number;
  readonly egress?: { baseUrl: string; guard: EgressGuardHandle };
  readonly maxCacheBytes?: number;
}

export interface Rig {
  readonly directory: string;
  readonly rawKey: string;
  readonly document: DocumentScope;
  readonly store: BibleStore;
  readonly cache: PartitionCache;
  readonly llm: FakeDirectionLlm;
  readonly analyst: Analyst;
  readonly director: StageDirector;
  readonly pipeline: DirectionPipeline;
  readonly trace: DirectionTraceEvent[];
  readonly rejections: BibleRejection[];
  readonly warnings: BibleWarning[];
  open(params?: Partial<OpenParams> & { source: readonly SourceBlock[] }): DirectionSession;
}

const sessions: DirectionSession[] = [];
afterEach(() => {
  for (const session of sessions.splice(0)) {
    session.dispose();
  }
});

export async function makeRig(options: RigOptions = {}): Promise<Rig> {
  const directory = options.directory ?? (await newDirectory());
  const rawKey = options.rawKey ?? "file:///work/novel.md";
  const document = documentScope(rawKey, { persist: options.persist ?? true });
  const rejections: BibleRejection[] = [];
  const warnings: BibleWarning[] = [];
  const store = new BibleStore({ directory, onRejection: (r) => rejections.push(r), onWarning: (w) => warnings.push(w) });
  const cache = new PartitionCache({ directory, ...(options.maxCacheBytes !== undefined ? { maxBytes: options.maxCacheBytes } : {}) });
  const llm = new FakeDirectionLlm({ ...(options.egress !== undefined ? { egress: options.egress } : {}), ...options.llm });
  const analyst = new Analyst({ llm, store, timeoutMs: options.analystTimeoutMs ?? 2000 });
  const director = new StageDirector({ llm, store, timeoutMs: options.directorTimeoutMs ?? 2000 });
  const trace: DirectionTraceEvent[] = [];
  const pipeline = new DirectionPipeline({
    analyst,
    director,
    store,
    cache,
    llm,
    gpuYield: options.gpuYield ?? (() => false),
    // Historical layout by default (windows from the first segment, no preload): the start-up
    // behaviour (lead segment, short first window, warm-up) is opted into by `startup.test.ts`.
    leadSegments: 0,
    firstWindowSize: options.pipeline?.windowSize ?? DEFAULT_WINDOW_SIZE,
    warmup: false,
    firstSoundBudgetMs: 2000,
    steadyBudgetMs: 2000,
    trace: (event) => trace.push(event),
    ...options.pipeline
  });
  return {
    directory,
    rawKey,
    document,
    store,
    cache,
    llm,
    analyst,
    director,
    pipeline,
    trace,
    rejections,
    warnings,
    open: (params) => {
      const session = pipeline.open({ document, profileId: "profile-a", ...params, source: params?.source ?? makeBlocks(8) });
      sessions.push(session);
      return session;
    }
  };
}

/** A guard on `local` mode whose `fetch` is a recorder: nothing leaves the process. */
export function recordingGuard(options: { resolve?: (host: string) => Promise<string[]>; strictLocal?: boolean } = {}): {
  guard: EgressGuardHandle;
  fetched: string[];
  events: EgressLogEvent[];
} {
  const fetched: string[] = [];
  const events: EgressLogEvent[] = [];
  const guard = createEgressGuard({
    mode: "local",
    trustedHosts: [],
    strictLocal: options.strictLocal ?? false,
    resolve: options.resolve ?? (async () => ["127.0.0.1"]),
    logger: (event) => events.push(event),
    fetchImpl: (async (url: string | URL | Request) => {
      fetched.push(String(url));
      return new Response("{}", { status: 200 });
    }) as typeof fetch
  });
  return { guard, fetched, events };
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Wall time of an async step. */
export async function timed<T>(step: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  const value = await step();
  return { value, ms: Date.now() - started };
}
