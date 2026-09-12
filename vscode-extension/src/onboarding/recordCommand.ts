/**
 * Pure data behind `LLM Voice: Use My Own Voice`'s recording step (S8.2,
 * CdC §55): an extension cannot capture the microphone directly from the
 * Node Extension Host, so the command shows the right local recording
 * command for the platform instead and watches for the file it produces
 * (`UseOwnVoice.ts`, the `vscode`-wiring layer on top of this).
 *
 * No `vscode`/`node:os` import here on purpose (`platformRecordCommand`
 * takes `NodeJS.Platform` as a parameter): same testability discipline as
 * `onboarding/voiceTiers.ts`.
 */

export interface RecordCommandInfo {
  /** The command to run and copy to the clipboard. */
  command: string;
  /** A fallback shown alongside the primary command, when one exists. */
  fallback?: string;
  /** Extension the primary command is expected to produce. */
  extension: "wav";
}

const SAMPLE_RATE = 24000;
const CHANNELS = 1;

/**
 * One recording command per platform (CdC §55's own examples):
 * `pw-record`/`arecord` on Linux (PipeWire is the default on every distro
 * this project targets; `arecord`/ALSA is the universal fallback),
 * `ffmpeg -f avfoundation` on macOS, `ffmpeg -f dshow` on Windows (both
 * ship no native CLI recorder that writes a plain WAV without extra
 * setup).
 */
export function platformRecordCommand(platform: NodeJS.Platform, outputPath: string): RecordCommandInfo {
  switch (platform) {
    case "darwin":
      return {
        command: `ffmpeg -f avfoundation -i ":0" -ar ${SAMPLE_RATE} -ac ${CHANNELS} "${outputPath}"`,
        extension: "wav"
      };
    case "win32":
      return {
        command: `ffmpeg -f dshow -i audio="Microphone" -ar ${SAMPLE_RATE} -ac ${CHANNELS} "${outputPath}"`,
        extension: "wav"
      };
    default:
      return {
        command: `pw-record --rate ${SAMPLE_RATE} --channels ${CHANNELS} "${outputPath}"`,
        fallback: `arecord -f S16_LE -r ${SAMPLE_RATE} -c ${CHANNELS} "${outputPath}"`,
        extension: "wav"
      };
  }
}

/** How long `UseOwnVoice.ts` waits for the recording file to appear before giving up. */
export const RECORD_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
export const RECORD_POLL_INTERVAL_MS = 500;
