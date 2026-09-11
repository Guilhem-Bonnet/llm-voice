import { describe, expect, it, vi } from "vitest";
import { runUseOwnVoiceFlow, type UseOwnVoiceActions } from "../../../src/onboarding/useOwnVoiceFlow.js";
import { makeSilentWav, makeToneWav } from "../../fakes/wav.js";

interface FakeFs {
  [path: string]: Uint8Array;
}

function baseActions(overrides: Partial<UseOwnVoiceActions> = {}): { actions: UseOwnVoiceActions; fs: FakeFs; applied: string[] } {
  const fs: FakeFs = {};
  const applied: string[] = [];
  const actions: UseOwnVoiceActions = {
    platform: "linux",
    confirmConsent: vi.fn(async () => true),
    chooseSource: vi.fn(async (): Promise<"file" | "record" | undefined> => "file"),
    pickExistingFile: vi.fn(async () => "/home/user/sample.wav"),
    showRecordInstructions: vi.fn(async () => true),
    writeClipboardText: vi.fn(async () => undefined),
    waitForRecordedFile: vi.fn(async () => true),
    readFile: vi.fn(async (path: string) => {
      const bytes = fs[path];
      if (bytes === undefined) {
        throw new Error(`no such fake file: ${path}`);
      }
      return bytes;
    }),
    extensionOf: (path: string) => (path.includes(".") ? `.${path.split(".").pop()}` : ""),
    ffmpegAvailable: vi.fn(async () => false),
    convertToWavMono24k: vi.fn(async () => false),
    copyFile: vi.fn(async (input: string, output: string) => {
      const bytes = fs[input];
      if (bytes !== undefined) {
        fs[output] = bytes;
      }
    }),
    reservedConvertedPath: (source: string) => `/converted/${source.split("/").pop()}.wav`,
    reservedOriginalCopyPath: (source: string) => `/voices/${source.split("/").pop()}`,
    reservedRecordingPath: () => "/tmp/recording.wav",
    applyReferenceAudio: vi.fn(async (path: string) => {
      applied.push(path);
    }),
    previewCurrentProfile: vi.fn(async () => undefined),
    showInfo: vi.fn(async () => undefined),
    showError: vi.fn(async () => undefined),
    confirmWarning: vi.fn(async () => true),
    ...overrides
  };
  return { actions, fs, applied };
}

const GOOD_WAV = makeToneWav(15_000, 300, 24000);

describe("runUseOwnVoiceFlow", () => {
  it("stops immediately when consent is declined", async () => {
    const { actions } = baseActions({ confirmConsent: vi.fn(async () => false) });
    await runUseOwnVoiceFlow(actions);
    expect(actions.chooseSource).not.toHaveBeenCalled();
  });

  it("stops when the user backs out of choosing a source", async () => {
    const { actions } = baseActions({ chooseSource: vi.fn(async () => undefined) });
    await runUseOwnVoiceFlow(actions);
    expect(actions.pickExistingFile).not.toHaveBeenCalled();
  });

  it("accepts a valid existing WAV file, copies it, applies it and previews it", async () => {
    const { actions, fs, applied } = baseActions();
    fs["/home/user/sample.wav"] = new Uint8Array(GOOD_WAV);

    await runUseOwnVoiceFlow(actions);

    expect(actions.copyFile).toHaveBeenCalledWith("/home/user/sample.wav", "/voices/sample.wav");
    expect(applied).toEqual(["/voices/sample.wav"]);
    expect(actions.previewCurrentProfile).toHaveBeenCalled();
    expect(actions.showError).not.toHaveBeenCalled();
  });

  it("rejects a silent file and never applies it", async () => {
    const { actions, fs, applied } = baseActions();
    fs["/home/user/sample.wav"] = new Uint8Array(makeSilentWav(15_000, 24000));

    await runUseOwnVoiceFlow(actions);

    expect(applied).toEqual([]);
    expect(actions.showError).toHaveBeenCalled();
    const [message] = (actions.showError as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(message).toMatch(/silencieux/);
  });

  it("rejects a too-short file", async () => {
    const { actions, applied, fs } = baseActions();
    fs["/home/user/sample.wav"] = new Uint8Array(makeToneWav(1_000, 300, 24000));

    await runUseOwnVoiceFlow(actions);

    expect(applied).toEqual([]);
    expect(actions.showError).toHaveBeenCalled();
  });

  it("surfaces recommended-duration warnings without rejecting", async () => {
    const { actions, fs, applied } = baseActions();
    fs["/home/user/sample.wav"] = new Uint8Array(makeToneWav(5_000, 300, 24000));

    await runUseOwnVoiceFlow(actions);

    expect(applied).toEqual(["/voices/sample.wav"]);
    expect(actions.showInfo).toHaveBeenCalled();
  });

  it("converts a non-WAV file with ffmpeg when available, then validates the WAV result", async () => {
    const { actions, fs, applied } = baseActions({
      pickExistingFile: vi.fn(async () => "/home/user/sample.mp3"),
      ffmpegAvailable: vi.fn(async () => true),
      convertToWavMono24k: vi.fn(async (_input: string, output: string) => {
        fs[output] = new Uint8Array(GOOD_WAV);
        return true;
      })
    });

    await runUseOwnVoiceFlow(actions);

    expect(actions.convertToWavMono24k).toHaveBeenCalledWith(
      "/home/user/sample.mp3",
      "/converted/sample.mp3.wav"
    );
    expect(applied).toEqual(["/converted/sample.mp3.wav"]);
  });

  it("without ffmpeg, asks for confirmation before accepting an unverified non-WAV file", async () => {
    const { actions, fs, applied } = baseActions({
      pickExistingFile: vi.fn(async () => "/home/user/sample.mp3"),
      confirmWarning: vi.fn(async () => true)
    });
    fs["/home/user/sample.mp3"] = new Uint8Array([1, 2, 3]);

    await runUseOwnVoiceFlow(actions);

    expect(actions.confirmWarning).toHaveBeenCalled();
    expect(actions.copyFile).toHaveBeenCalledWith("/home/user/sample.mp3", "/voices/sample.mp3");
    expect(applied).toEqual(["/voices/sample.mp3"]);
  });

  it("stops when the user declines the unverified-format warning", async () => {
    const { actions, applied } = baseActions({
      pickExistingFile: vi.fn(async () => "/home/user/sample.mp3"),
      confirmWarning: vi.fn(async () => false)
    });

    await runUseOwnVoiceFlow(actions);

    expect(applied).toEqual([]);
    expect(actions.copyFile).not.toHaveBeenCalled();
  });

  it("records via the platform command, copies the clipboard text and waits for the file", async () => {
    const { actions, fs, applied } = baseActions({
      chooseSource: vi.fn(async (): Promise<"file" | "record" | undefined> => "record")
    });
    fs["/tmp/recording.wav"] = new Uint8Array(GOOD_WAV);

    await runUseOwnVoiceFlow(actions);

    expect(actions.writeClipboardText).toHaveBeenCalled();
    expect(actions.waitForRecordedFile).toHaveBeenCalledWith("/tmp/recording.wav", expect.any(Number));
    expect(applied).toEqual(["/voices/recording.wav"]);
  });

  it("stops when the recording never appears", async () => {
    const { actions, applied } = baseActions({
      chooseSource: vi.fn(async (): Promise<"file" | "record" | undefined> => "record"),
      waitForRecordedFile: vi.fn(async () => false)
    });

    await runUseOwnVoiceFlow(actions);

    expect(applied).toEqual([]);
    expect(actions.showError).toHaveBeenCalled();
  });

  it("stops when the user cancels the record instructions dialog", async () => {
    const { actions, applied } = baseActions({
      chooseSource: vi.fn(async (): Promise<"file" | "record" | undefined> => "record"),
      showRecordInstructions: vi.fn(async () => false)
    });

    await runUseOwnVoiceFlow(actions);

    expect(applied).toEqual([]);
    expect(actions.writeClipboardText).not.toHaveBeenCalled();
  });
});
