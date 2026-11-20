import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  EventEmitter: class {
    event = (): void => undefined;
    fire(): void {}
    dispose(): void {}
  },
  TreeItem: class {},
  TreeItemCollapsibleState: { None: 0 },
  ThemeIcon: class {},
  MarkdownString: class {}
}));

function mode(id: string) {
  const effective = { id, label: id, mode: "faithful", language: "fr-FR", tts: {}, chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 }, playback: { rate: 1, volume: 1 } };
  return { mode: effective, effective, voiceOrigin: "global" };
}

describe("ProfilesTreeProvider.refresh", () => {
  it("keeps the newest state when an earlier refresh finishes last", async () => {
    const { ProfilesTreeProvider } = await import("../../../../src/views/profiles/ProfilesTreeProvider.js");
    const modes = [mode("a"), mode("b")] as never;
    const resolvers: Array<(id: string) => void> = [];
    const provider = new ProfilesTreeProvider(
      async () => modes,
      () => new Promise<string>((resolve) => resolvers.push(resolve))
    );

    const stale = provider.refresh();
    const fresh = provider.refresh();
    resolvers[1]?.("b");
    await fresh;
    resolvers[0]?.("a");
    await stale;

    expect(provider.currentItems.find((item) => item.isActive)?.id).toBe("b");
  });
});
