import { describe, expect, it } from "vitest";
import { platformRecordCommand } from "../../../src/onboarding/recordCommand.js";

describe("platformRecordCommand", () => {
  it("uses pw-record with an arecord fallback on Linux", () => {
    const info = platformRecordCommand("linux", "/tmp/out.wav");
    expect(info.command).toContain("pw-record");
    expect(info.command).toContain("--rate 24000");
    expect(info.command).toContain("--channels 1");
    expect(info.command).toContain("/tmp/out.wav");
    expect(info.fallback).toContain("arecord");
    expect(info.extension).toBe("wav");
  });

  it("uses ffmpeg avfoundation on macOS", () => {
    const info = platformRecordCommand("darwin", "/tmp/out.wav");
    expect(info.command).toContain("ffmpeg");
    expect(info.command).toContain("avfoundation");
    expect(info.fallback).toBeUndefined();
  });

  it("uses ffmpeg dshow on Windows", () => {
    const info = platformRecordCommand("win32", "C:\\tmp\\out.wav");
    expect(info.command).toContain("ffmpeg");
    expect(info.command).toContain("dshow");
  });

  it("always targets 24kHz mono regardless of platform", () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      const info = platformRecordCommand(platform, "/tmp/out.wav");
      expect(info.command).toMatch(/24000/);
    }
  });
});
