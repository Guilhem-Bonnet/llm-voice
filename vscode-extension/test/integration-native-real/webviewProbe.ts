/**
 * Lire et cliquer dans une vraie webview de VS Code, par le protocole de débogage du navigateur.
 * Une webview est une cible à part de la fenêtre, et son document un cadre de cette cible.
 */
import * as assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

export interface CdpReply {
  id?: number;
  method?: string;
  params?: unknown;
  result?: { data?: string; result?: { value?: unknown }; exceptionDetails?: unknown };
}

interface Target {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export interface CdpClient {
  send(method: string, params?: Record<string, unknown>): Promise<CdpReply>;
  /** Everything the target said on its own, oldest first. */
  events: CdpReply[];
  close(): void;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function attach(url: string): Promise<CdpClient> {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });
  const events: CdpReply[] = [];
  const waiting = new Map<number, (reply: CdpReply) => void>();
  socket.addEventListener("message", (event) => {
    const reply = JSON.parse(String(event.data)) as CdpReply;
    const resolve = typeof reply.id === "number" ? waiting.get(reply.id) : undefined;
    if (typeof resolve === "function") {
      waiting.delete(reply.id as number);
      resolve(reply);
    } else {
      events.push(reply);
    }
  });
  let nextId = 0;
  return {
    events,
    close: () => socket.close(),
    send: (method, params = {}) =>
      new Promise((resolve) => {
        nextId += 1;
        waiting.set(nextId, resolve);
        socket.send(JSON.stringify({ id: nextId, method, params }));
      })
  };
}

async function targets(port: string): Promise<Target[]> {
  return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Target[];
}

export interface WebviewFrame {
  evaluate<T>(expression: string): Promise<T>;
  /** The status and tail of each file the page asked for: what explains a refused file. */
  responses(): string[];
  close(): void;
}

/** The frame holding `selector`, or `undefined` once `timeoutMs` has passed: the page may not exist. */
export async function findFrame(port: string, selector: string, timeoutMs: number): Promise<WebviewFrame | undefined> {
  const deadline = Date.now() + timeoutMs;
  do {
    for (const target of await targets(port)) {
      if (!target.url.startsWith("vscode-webview:")) {
        continue;
      }
      const client = await attach(target.webSocketDebuggerUrl);
      await client.send("Runtime.enable");
      await client.send("Network.enable");
      await sleep(200);
      const contexts = client.events
        .filter((event) => event.method === "Runtime.executionContextCreated")
        .map((event) => (event.params as { context: { id: number } }).context.id);
      for (const contextId of contexts) {
        const evaluate = async <T>(expression: string): Promise<T> => {
          const reply = await client.send("Runtime.evaluate", { expression, contextId, returnByValue: true });
          assert.equal(reply.result?.exceptionDetails, undefined, `${expression} : ${JSON.stringify(reply.result?.exceptionDetails)}`);
          return reply.result?.result?.value as T;
        };
        if ((await evaluate<number>(`document.querySelectorAll(${JSON.stringify(selector)}).length`)) > 0) {
          return {
            evaluate,
            close: client.close,
            responses: () =>
              client.events
                .filter((event) => event.method === "Network.responseReceived")
                .map((event) => (event.params as { response: { status: number; url: string } }).response)
                .map((response) => `${response.status} ${response.url.slice(-24)}`)
          };
        }
      }
      client.close();
    }
    await sleep(200);
  } while (Date.now() < deadline);
  return undefined;
}

async function withWindow<T>(port: string, use: (window: CdpClient) => Promise<T>): Promise<T> {
  const page = (await targets(port)).find((target) => target.type === "page" && target.url.includes("workbench"));
  assert.ok(page, "fenêtre de VS Code introuvable");
  const window = await attach(page.webSocketDebuggerUrl);
  try {
    return await use(window);
  } finally {
    window.close();
  }
}

/**
 * A real click, at the place the element has on screen. `element.click()` would give the page
 * none of the user activation a click gives, and `audio.play()` depends on it.
 */
export async function clickIn(port: string, frame: WebviewFrame, findElement: string): Promise<void> {
  const inFrame = await frame.evaluate<{ x: number; y: number; width: number; height: number } | null>(`(() => {
    const element = ${findElement};
    if (!element) { return null; }
    element.scrollIntoView({ block: "center" });
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x: x + width / 2, y: y + height / 2, width: innerWidth, height: innerHeight };
  })()`);
  assert.ok(inFrame, `rien à cliquer : ${findElement}`);
  await withWindow(port, async (window) => {
    // The webview shown at this size: another one of the window (a view, a tab) may be larger.
    const reply = await window.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const box = [...document.querySelectorAll("iframe.webview")]
          .map((candidate) => candidate.getBoundingClientRect())
          .find((candidate) => Math.round(candidate.width) === ${Math.round(inFrame.width)} && Math.round(candidate.height) === ${Math.round(inFrame.height)});
        return box ? { x: box.x, y: box.y } : null;
      })()`
    });
    const offset = reply.result?.result?.value as { x: number; y: number } | null;
    assert.ok(offset, `webview de ${inFrame.width} x ${inFrame.height} introuvable dans la fenêtre`);
    const at = { x: offset.x + inFrame.x, y: offset.y + inFrame.y, button: "left", clickCount: 1 };
    await window.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
    await window.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
  });
}

/** A picture of the real window, webviews included. */
export function photograph(port: string, path: string): Promise<void> {
  return withWindow(port, async (window) => {
    const shot = await window.send("Page.captureScreenshot", { format: "png" });
    assert.ok(shot.result?.data, "pas d'image");
    writeFileSync(path, Buffer.from(shot.result.data, "base64"));
  });
}
