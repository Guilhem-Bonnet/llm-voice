/**
 * Le côté hôte du panneau Distribution, sans `vscode` : chaque message de la page est validé
 * (`parseCastPanelMessage`), puis confié à `deps`. La page ne tient aucun état : elle montre
 * ce que l'hôte lui envoie. Aucune synthèse sans clic.
 */

import {
  composeVoiceDescription,
  estimatedAudioSeconds,
  parseCastPanelMessage,
  type CastPanelMessage,
  type CastPanelState
} from "./castPanelModel.js";

export interface CastPanelDeps {
  loadState(): Promise<CastPanelState>;
  /** Une vraie réplique du personnage, dite par la voix candidate (ou la sienne). */
  listen(roleId: string, voiceId: string | undefined, signal: AbortSignal): Promise<{ uri: string }>;
  sample(voiceId: string, signal: AbortSignal): Promise<{ uri: string }>;
  /** `recordUserVoice` : le seul chemin de `by: user`. */
  assign(roleId: string, voiceId: string): Promise<void>;
  createVoice(input: { name: string; description: string; forRoleId?: string }, signal: AbortSignal): Promise<{ id: string; name: string }>;
  read(): Promise<void>;
  recast(): Promise<void>;
  log(message: string): void;
}

export type CastPanelPost = (message: { type: string; [key: string]: unknown }) => void;

const CREATE_ESTIMATE_SECONDS = 30;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CastPanelController {
  private state: CastPanelState | undefined;
  private readonly running = new Map<number, AbortController>();
  private disposed = false;

  constructor(
    private readonly deps: CastPanelDeps,
    private readonly post: CastPanelPost
  ) {}

  get lastState(): CastPanelState | undefined {
    return this.state;
  }

  async handle(raw: unknown): Promise<void> {
    const message = parseCastPanelMessage(raw);
    if (message === undefined) {
      this.deps.log("distribution : message refusé");
      return;
    }
    try {
      await this.dispatch(message);
    } catch (error) {
      this.deps.log(`distribution : ${messageOf(error)}`);
      this.post({ type: "notice", message: messageOf(error) });
    }
  }

  async refresh(): Promise<void> {
    this.state = await this.deps.loadState();
    if (!this.disposed) {
      this.post({ type: "state", state: this.state });
    }
  }

  private async dispatch(message: CastPanelMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.refresh();
        return;
      case "listen": {
        const row = this.state?.rows.find((item) => item.roleId === message.roleId);
        const text = row?.firstLine ?? this.state?.narrator.firstLine ?? "";
        await this.audio(message.requestId, this.estimate(text), (signal) => this.deps.listen(message.roleId, message.voiceId, signal));
        return;
      }
      case "sampleVoice":
        await this.audio(message.requestId, undefined, (signal) => this.deps.sample(message.voiceId, signal));
        return;
      case "cancel":
        this.running.get(message.requestId)?.abort();
        return;
      case "assign":
        await this.deps.assign(message.roleId, message.voiceId);
        await this.refresh();
        this.post({ type: "notice", message: "Voix enregistrée : elle servira à la prochaine lecture." });
        return;
      case "createVoice": {
        const controller = new AbortController();
        this.running.set(message.requestId, controller);
        this.post({ type: "busy", requestId: message.requestId, estimateSeconds: CREATE_ESTIMATE_SECONDS });
        try {
          const created = await this.deps.createVoice(
            {
              name: message.name,
              description: composeVoiceDescription(message.recipe),
              ...(message.forRoleId !== undefined ? { forRoleId: message.forRoleId } : {})
            },
            controller.signal
          );
          this.post({ type: "created", requestId: message.requestId, id: created.id, name: created.name });
          await this.refresh();
        } catch (error) {
          this.post({ type: "failed", requestId: message.requestId, message: messageOf(error) });
        } finally {
          this.running.delete(message.requestId);
        }
        return;
      }
      case "read":
        await this.deps.read();
        return;
      case "recast":
        await this.deps.recast();
        await this.refresh();
        this.post({ type: "notice", message: "Distribution refaite avec les voix disponibles. Vos choix sont gardés." });
        return;
    }
  }

  private estimate(text: string): number | undefined {
    const factor = this.state?.slowFactor;
    return factor === undefined ? undefined : Math.ceil(estimatedAudioSeconds(text) * factor);
  }

  private async audio(requestId: number, estimateSeconds: number | undefined, run: (signal: AbortSignal) => Promise<{ uri: string }>): Promise<void> {
    const controller = new AbortController();
    this.running.set(requestId, controller);
    this.post({ type: "busy", requestId, ...(estimateSeconds !== undefined ? { estimateSeconds } : {}) });
    try {
      const { uri } = await run(controller.signal);
      this.post({ type: "audio", requestId, uri });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      this.post({ type: "failed", requestId, message: aborted ? "Écoute annulée." : messageOf(error) });
    } finally {
      this.running.delete(requestId);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.running.values()) {
      controller.abort();
    }
    this.running.clear();
  }
}
