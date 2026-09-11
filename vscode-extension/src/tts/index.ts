/**
 * Public surface of the TTS provider integration layer (ADR-005, D9).
 *
 * There is deliberately no `FakeLocalTtsProvider` here: the fake used by
 * integration tests (`test/fakes/FakeTtsProvider.ts`) is only ever injected
 * by `Pipeline` when `context.extensionMode !== vscode.ExtensionMode.Production`
 * *and* `LLM_VOICE_TEST_FAKE_TTS=1` is set — see `src/pipeline/Pipeline.ts`.
 */

export * from "./OpenAICompatibleTtsProvider.js";
export * from "./ChatterboxProvider.js";
export * from "./KokoroProvider.js";
export * from "./SystemTtsProvider.js";
export * from "./PiperSetup.js";
export * from "./AutoVoiceInstall.js";
export * from "./presets.js";
export * from "./ProviderRegistry.js";
export * from "./warmup.js";
