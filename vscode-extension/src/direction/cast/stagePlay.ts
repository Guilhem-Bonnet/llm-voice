/**
 * Des états lus dans le texte aux consignes que joue la voix (amendement du 2026-11-07
 * d'ADR-018) : une table, pas des branches. La consigne est en anglais et en ASCII, comme le
 * modèle qui joue l'attend ; elle n'est jamais prononcée, et un code entre crochets n'en fait
 * jamais partie (une voix figée le dirait). Sans état connu : aucune consigne, voix figée.
 */

import type { StageState } from "../../core/source.js";

export interface StagePlayRow {
  /** L'identifiant que rend le metteur en scène local : jamais une consigne écrite par lui. */
  readonly id: string;
  /** Sur l'étiquette de l'état, en minuscules (`essoufflé`, `en toussant`, `à voix basse`). */
  readonly pattern: RegExp;
  readonly direction: string;
  /** L'état dure au-delà de la réplique : la suivante du même personnage le garde, une fois. */
  readonly lasting?: boolean;
}

/** Validées à l'écoute sur Qwen3 (essoufflé, toux, soupir, rire, chuchoté, voix intérieure, colère). */
export const STAGE_PLAY_TABLE: readonly StagePlayRow[] = [
  {
    id: "breathless", pattern: /essouffl|halet|suffoqu|hors d'haleine|à bout de souffle|soufflant/u,
    direction: "Completely out of breath after running: panting, audible gasps for air between the phrases",
    lasting: true
  },
  {
    id: "coughing", pattern: /tous(?:se|sant|sote)|toux|racle la gorge|éclaircit la voix|s'étrangle|enrou/u,
    direction: "Voice hoarse and strained from coughing, throat irritated",
    lasting: true
  },
  { id: "sigh", pattern: /soupir/u, direction: "With a long weary sigh before speaking, tired and resigned" },
  { id: "laughing", pattern: /\bri(?:t|ant|re|res)\b|rican|glouss|pouff|esclaff|amusé/u, direction: "Speaking French while laughing softly, amused, a smile and light chuckles in the voice" },
  { id: "whisper", pattern: /chuchot|murmur|voix basse|mi-voix|demi-voix|tout bas|^bas$|voix étouffée/u, direction: "Whispering very softly, almost inaudible, secretive" },
  { id: "inner", pattern: /à part|à (?:lui|elle)-même|en (?:lui|elle)-même|pensée/u, direction: "An inner thought spoken inside the head: very close to the microphone, intimate, soft, voice-over narration" },
  {
    id: "angry", pattern: /colère|furi|rage|irrit|exaspér|excédé|énerv|fâch|indign|outr|cri(?:e|ant)\b|hurl|tonn|violemment|menaç/u,
    direction: "Angry and furious, voice raised and tense, words bitten off"
  },
  { id: "crying", pattern: /pleur|sanglot|larmes|gémi/u, direction: "Crying, voice breaking with sobs, tearful" },
  { id: "afraid", pattern: /trembl|effray|terrifi|apeur|panique|angoiss|inquiet|anxieu/u, direction: "Frightened, voice trembling and unsteady, anxious" },
  { id: "tired", pattern: /épuisé|fatigué|^las(?:se)?$|lass/u, direction: "Exhausted, slow and heavy voice, drained of energy" },
  { id: "tender", pattern: /tendre|douce|doucement|tendrement|tendresse/u, direction: "Tender and gentle, warm soft voice" },
  { id: "ironic", pattern: /ironi|sarcast|moqu|narquois|raill/u, direction: "Ironic and mocking, a sneer in the voice" },
  { id: "hesitant", pattern: /bégai|balbuti|bafouill|bredouill|hésit/u, direction: "Hesitant and stammering, searching for words" },
  { id: "determined", pattern: /résolu|déterminé|ferme|fermement|décidé/u, direction: "Determined and resolute, a firm steady voice, ready to fight" },
  { id: "surprised", pattern: /surpris|étonn|stupéf|ébahi/u, direction: "Surprised and astonished, voice rising with disbelief" },
  { id: "joyful", pattern: /joyeu|ravi|radieu|enjou|gai/u, direction: "Joyful and delighted, bright smiling voice" },
  { id: "solemn", pattern: /solennel|grave|gravement/u, direction: "Solemn and grave, slow measured voice" }
];

/** Plus de deux consignes à la fois brouillent le jeu : les deux premières, dans l'ordre du texte. */
const MAX_DIRECTIONS = 2;
const ASCII = /^[\x20-\x7e]+$/u;

function rowFor(state: Pick<StageState, "label">, table: readonly StagePlayRow[]): StagePlayRow | undefined {
  const label = state.label.toLocaleLowerCase("fr");
  return table.find((row) => row.pattern.test(label));
}

export interface StagePlay {
  readonly direction: string;
  readonly lasting: boolean;
}

/** La consigne de ces états, ou `undefined` : aucun n'est dans la table. */
export function playOfStates(states: readonly Pick<StageState, "label">[] | undefined, table: readonly StagePlayRow[] = STAGE_PLAY_TABLE): StagePlay | undefined {
  const rows: StagePlayRow[] = [];
  for (const state of states ?? []) {
    const row = rowFor(state, table);
    if (row !== undefined && !rows.includes(row)) {
      rows.push(row);
    }
  }
  const kept = rows.slice(0, MAX_DIRECTIONS);
  if (kept.length === 0) {
    return undefined;
  }
  const direction = kept.map((row) => row.direction).join(". ");
  return isSendableDirection(direction) ? { direction, lasting: kept.some((row) => row.lasting === true) } : undefined;
}

/** Une consigne qu'on peut envoyer : ASCII, sans crochets, bornée. */
export function isSendableDirection(direction: string): boolean {
  return direction.length > 0 && direction.length <= 280 && ASCII.test(direction) && !/[[\]]/u.test(direction);
}

export interface PlayedLine {
  readonly speakerId: string;
  readonly states?: readonly Pick<StageState, "label">[] | undefined;
}

/**
 * Une consigne par passage, contexte compris : un état qui dure (souffle, toux) reste sur la
 * réplique suivante du même personnage quand elle n'en porte aucun, puis s'éteint. Une
 * réplique, c'est la suite des passages d'un même personnage sans autre ligne entre eux. La
 * narration (`narrator`) ne joue jamais.
 */
export function directionsOf(lines: readonly PlayedLine[], narrator: string, table: readonly StagePlayRow[] = STAGE_PLAY_TABLE): (string | undefined)[] {
  const pending = new Map<string, string>();
  let runSpeaker: string | undefined;
  let runCarry: string | undefined;
  return lines.map((line) => {
    if (line.speakerId !== runSpeaker) {
      runSpeaker = line.speakerId;
      runCarry = pending.get(line.speakerId);
      pending.delete(line.speakerId);
    }
    if (line.speakerId === narrator) {
      return undefined;
    }
    const play = playOfStates(line.states, table);
    if (play === undefined) {
      return runCarry;
    }
    runCarry = undefined;
    if (play.lasting) {
      pending.set(line.speakerId, play.direction);
    } else {
      pending.delete(line.speakerId);
    }
    return play.direction;
  });
}
