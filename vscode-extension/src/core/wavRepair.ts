function chunkIdAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

/**
 * `pocket-tts serve` streams before knowing the length, so its header announces
 * 2 000 000 000 data bytes; the Core's `hound` decoder then refuses the file
 * ("Failed to read enough bytes"). Rewrites both sizes to the bytes received;
 * returns the same array when there is nothing to repair.
 */
export function repairStreamedWavSizes(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12 || chunkIdAt(bytes, 0) !== "RIFF" || chunkIdAt(bytes, 8) !== "WAVE") {
    return bytes;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const size = view.getUint32(offset + 4, true);
    if (chunkIdAt(bytes, offset) === "data") {
      const available = bytes.length - (offset + 8);
      if (size <= available) {
        return bytes;
      }
      // A stream cut mid-sample would still be refused: keep whole 16-bit samples.
      const kept = available - (available % 2);
      const repaired = bytes.slice(0, offset + 8 + kept);
      const repairedView = new DataView(repaired.buffer);
      repairedView.setUint32(4, repaired.length - 8, true);
      repairedView.setUint32(offset + 4, kept, true);
      return repaired;
    }
    offset += 8 + size + (size % 2);
  }
  return bytes;
}
