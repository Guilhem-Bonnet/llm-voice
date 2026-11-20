/**
 * The host side of the voice gallery, free of `vscode`: it validates every message,
 * decides what each one may do, and posts back what the page shows. The page never
 * holds the state: favorites live in `globalState`, the voice in `global-voice.json`.
 *
 * The only network it starts by itself is a health check of a server on this machine
 * (`isLoopbackUrl`); a synthesis happens on a `trial` message, which the page only
 * sends on a click. No process is started here: a stopped server is said, with the
 * command to run (starting it is card 0-006).
 */

import type { GlobalVoice, TtsBinding } from "../../core/profile.js";
import type { ProviderHealthStatus } from "../../core/health.js";
import { KYUTAI16_VOICE_CAVEAT } from "../../tts/kyutai16VoiceCatalog.js";
import { QWEN3_VOICE_CAVEAT } from "../../tts/qwen3VoiceCatalog.js";
import {
  activeEntryId,
  activeLabel,
  bindingForEntry,
  buildCards,
  DEFAULT_TRIAL_PHRASE,
  engineProviderId,
  engineUrl,
  galleryEntry,
  GALLERY_CREDITS,
  GALLERY_LINKS,
  isLoopbackUrl,
  knownGalleryIds,
  parseGalleryMessage,
  startCommand,
  type EngineStatus,
  type GalleryEntry,
  type GalleryMessage,
  type PrepareTarget,
  type ServerEngine
} from "./galleryModel.js";

const SERVER_ENGINES: readonly ServerEngine[] = ["kyutai", "kyutai16", "qwen3", "kokoro", "chatterbox"];
const HEALTH_TIMEOUT_MS = 2000;

export interface VoiceGalleryDeps {
  getGlobalVoice(): Promise<GlobalVoice>;
  /** `setGlobalVoice` and its visible effects: this is the only write of the gallery. */
  applyBinding(binding: TtsBinding & { providerId: string }): Promise<void>;
  checkHealth(target: { providerId: string; baseUrl: string }, signal: AbortSignal): Promise<ProviderHealthStatus>;
  isPiperInstalled(): Promise<boolean>;
  /** Returns the address the page plays; a file on this machine, served by VS Code. */
  synthesize(
    binding: TtsBinding & { providerId: string },
    text: string,
    signal: AbortSignal
  ): Promise<{ uri: string }>;
  getFavorites(): readonly string[];
  setFavorites(ids: readonly string[]): Promise<void>;
  sampleUri(path: string): string;
  writeClipboard(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  prepare(target: PrepareTarget): Promise<void>;
  log(message: string): void;
}

export type GalleryPost = (message: { type: string; [key: string]: unknown }) => void;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export class VoiceGalleryController {
  private status: Record<ServerEngine, EngineStatus> = {
    kyutai: "unknown",
    kyutai16: "unknown",
    qwen3: "unknown",
    kokoro: "unknown",
    chatterbox: "unknown"
  };
  private trial: { requestId: number; controller: AbortController } | undefined;
  private disposed = false;

  constructor(
    private readonly deps: VoiceGalleryDeps,
    private readonly post: GalleryPost
  ) {}

  async handle(raw: unknown): Promise<void> {
    const message = parseGalleryMessage(raw, knownGalleryIds());
    if (message === undefined) {
      this.deps.log(`galerie de voix : message refusé (${describeRefused(raw)})`);
      return;
    }
    try {
      await this.dispatch(message);
    } catch (error) {
      this.deps.log(`galerie de voix : ${messageOf(error)}`);
      this.post({ type: "notice", message: messageOf(error) });
    }
  }

  private async dispatch(message: GalleryMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.sendState();
        await this.refreshHealth();
        return;
      case "refreshHealth":
        await this.refreshHealth();
        return;
      case "choose":
        await this.choose(message.voiceId);
        return;
      case "trial":
        await this.runTrial(message.voiceId, message.text, message.requestId);
        return;
      case "cancelTrial":
        if (this.trial?.requestId === message.requestId) {
          this.trial.controller.abort();
        }
        return;
      case "favorite":
        await this.setFavorite(message.voiceId, message.favorite);
        return;
      case "copyCommand": {
        const voice = await this.deps.getGlobalVoice();
        await this.deps.writeClipboard(startCommand(message.engine, engineUrl(message.engine, voice)));
        this.post({ type: "notice", message: "Commande copiée dans le presse-papiers." });
        return;
      }
      case "openLink":
        if (!GALLERY_LINKS.includes(message.url)) {
          this.deps.log("galerie de voix : lien refusé, absent de la liste");
          return;
        }
        await this.deps.openExternal(message.url);
        return;
      case "prepare":
        await this.deps.prepare(message.target);
        await this.sendState();
        await this.refreshHealth();
        return;
    }
  }

  private async choose(id: string): Promise<void> {
    const entry = galleryEntry(id) as GalleryEntry;
    if (entry.engine === "own-voice") {
      this.post({ type: "notice", message: "Préparez d'abord votre voix à partir d'un fichier." });
      return;
    }
    if (id === "piper" && !(await this.deps.isPiperInstalled())) {
      this.post({ type: "notice", message: "Installez d'abord la voix française autonome." });
      return;
    }
    await this.deps.applyBinding(bindingForEntry(entry, await this.deps.getGlobalVoice()));
    await this.sendState();
  }

  private async runTrial(id: string, text: string, requestId: number): Promise<void> {
    this.trial?.controller.abort();
    const entry = galleryEntry(id) as GalleryEntry;
    const current = await this.deps.getGlobalVoice();
    if (entry.engine === "own-voice" || entry.engine === "chatterbox") {
      this.post({ type: "trialError", requestId, voiceId: id, message: "Cette voix ne s'écoute pas d'ici." });
      return;
    }
    if (id === "piper" && !(await this.deps.isPiperInstalled())) {
      this.post({ type: "trialError", requestId, voiceId: id, message: "Voix non installée." });
      return;
    }
    const controller = new AbortController();
    this.trial = { requestId, controller };
    const server: ServerEngine | undefined = entry.engine === "system" ? undefined : entry.engine;
    try {
      if (server !== undefined) {
        // Asked again now: what was shown may be minutes old.
        this.status[server] = await this.probe(server, current);
        if (controller.signal.aborted) {
          return;
        }
        if (this.status[server] === "stopped") {
          this.post({ type: "trialStopped", requestId, voiceId: id, engine: server });
          await this.sendState();
          return;
        }
      }
      const phrase = text.length > 0 ? text : DEFAULT_TRIAL_PHRASE;
      const { uri } = await this.deps.synthesize(bindingForEntry(entry, current), phrase, controller.signal);
      if (!controller.signal.aborted) {
        this.post({ type: "trialAudio", requestId, voiceId: id, uri });
      }
    } catch (error) {
      if (!isAbort(error) && !controller.signal.aborted) {
        this.deps.log(`galerie de voix : essai impossible (${messageOf(error)})`);
        this.post({ type: "trialError", requestId, voiceId: id, message: messageOf(error) });
      }
    } finally {
      if (this.trial?.controller === controller) {
        this.trial = undefined;
      }
    }
  }

  private async setFavorite(id: string, favorite: boolean): Promise<void> {
    const others = this.favorites().filter((candidate) => candidate !== id);
    await this.deps.setFavorites(favorite ? [...others, id] : others);
    await this.sendState();
  }

  /** What is stored, minus what the gallery no longer has. */
  private favorites(): string[] {
    const known = knownGalleryIds();
    return this.deps.getFavorites().filter((id) => known.has(id));
  }

  /** Checks the servers on this machine and tells the page. Public: the tab also asks when it comes back into view. */
  async refreshHealth(): Promise<void> {
    const voice = await this.deps.getGlobalVoice();
    await Promise.all(
      SERVER_ENGINES.map(async (engine) => {
        this.status[engine] = await this.probe(engine, voice);
      })
    );
    await this.sendState();
  }

  private async probe(engine: ServerEngine, voice: GlobalVoice): Promise<EngineStatus> {
    const baseUrl = engineUrl(engine, voice);
    if (!isLoopbackUrl(baseUrl)) {
      return "unknown";
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const health = await this.deps.checkHealth({ providerId: engineProviderId(engine), baseUrl }, controller.signal);
      switch (health) {
        case "ok":
        case "degraded":
          return "started";
        case "unverified":
          return "unknown";
        default:
          return "stopped";
      }
    } catch {
      return "stopped";
    } finally {
      clearTimeout(timer);
    }
  }

  private async sendState(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const voice = await this.deps.getGlobalVoice();
    const piperInstalled = await this.deps.isPiperInstalled();
    const engines = Object.fromEntries(
      SERVER_ENGINES.map((engine) => [
        engine,
        { status: this.status[engine], command: startCommand(engine, engineUrl(engine, voice)) }
      ])
    );
    this.post({
      type: "state",
      cards: buildCards({ status: this.status, piperInstalled, sampleUri: (path) => this.deps.sampleUri(path) }),
      activeId: activeEntryId(voice),
      activeLabel: activeLabel(voice),
      favorites: this.favorites(),
      engines,
      kyutai16Note: KYUTAI16_VOICE_CAVEAT,
      qwen3Note: QWEN3_VOICE_CAVEAT,
      credits: {
        subtitle: GALLERY_CREDITS.subtitle,
        groups: [...GALLERY_CREDITS.groups, GALLERY_CREDITS.engine, ...GALLERY_CREDITS.narration],
        clause: GALLERY_CREDITS.clause,
        links: GALLERY_CREDITS.links
      }
    });
  }

  /** The voice changed elsewhere (a Quick Pick, a tier): the page follows without a reload. */
  async voiceChanged(): Promise<void> {
    await this.sendState();
  }

  dispose(): void {
    this.disposed = true;
    this.trial?.controller.abort();
    this.trial = undefined;
  }
}

/** The kind of what was refused, never its content: it comes from a page and reaches a log. */
function describeRefused(raw: unknown): string {
  if (typeof raw === "object" && raw !== null && "type" in raw && typeof (raw as { type: unknown }).type === "string") {
    return (raw as { type: string }).type.replace(/[^a-zA-Z]/g, "").slice(0, 24);
  }
  return typeof raw;
}
