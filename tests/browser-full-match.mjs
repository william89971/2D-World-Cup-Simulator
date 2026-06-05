import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = 9225;
const BASE_URL = "http://127.0.0.1:5180";
const PROFILE_DIR = "/private/tmp/futbol-browser-full-match-profile";
const SCREENSHOT_PATH = new URL("../output/playwright/browser-full-match.png", import.meta.url);
const FULL_MATCH_TIMEOUT_MS = 120000;

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function waitForChrome() {
  for (let i = 0; i < 60; i += 1) {
    try {
      await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const pageTarget = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (pageTarget) return pageTarget;
    } catch {
      await delay(250);
    }
  }
  throw new Error("Chrome DevTools endpoint did not start");
}

class CdpSession {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.ws = new WebSocket(url);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      const listeners = this.events.get(message.method) ?? [];
      for (const listener of listeners) listener(message.params);
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  once(method) {
    return new Promise((resolve) => {
      const listener = (params) => {
        this.events.set(
          method,
          (this.events.get(method) ?? []).filter((item) => item !== listener)
        );
        resolve(params);
      };
      this.events.set(method, [...(this.events.get(method) ?? []), listener]);
    });
  }

  close() {
    this.ws.close();
  }
}

async function evaluate(cdp, expression, returnByValue = true) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitForSelector(cdp, selector, timeoutMs = 8000) {
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(selector)})`, timeoutMs);
}

async function waitForExpression(cdp, expression, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, `Boolean(${expression})`)) return;
    await delay(150);
  }
  throw new Error(`Expression not satisfied within ${timeoutMs}ms: ${expression}`);
}

await mkdir(new URL("../output/playwright/", import.meta.url), { recursive: true });
await rm(PROFILE_DIR, { recursive: true, force: true });

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-extensions",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--no-first-run",
  "--use-gl=swiftshader",
  `--user-data-dir=${PROFILE_DIR}`,
  `--remote-debugging-port=${DEBUG_PORT}`,
  "--window-size=1440,980",
  "about:blank"
]);

try {
  const target = await waitForChrome();
  const cdp = new CdpSession(target.webSocketDebuggerUrl);
  await cdp.open();
  const pageErrors = [];
  cdp.events.set("Runtime.exceptionThrown", [(params) => pageErrors.push(params.exceptionDetails.text)]);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 980,
    deviceScaleFactor: 1,
    mobile: false
  });

  const load = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url: BASE_URL });
  await load;

  await waitForExpression(cdp, "document.fonts && document.fonts.status === 'loaded'");
  assert.equal(await evaluate(cdp, `document.fonts.check('12px "Press Start 2P Local"')`), true, "local pixel font loaded");
  assert.equal(await evaluate(cdp, "document.scrollingElement.scrollHeight <= window.innerHeight + 2"), true, "selection has no browser scroll");

  await evaluate(cdp, "document.querySelector('[data-select-team=\"ARG\"]').click()");
  await waitForSelector(cdp, ".setup-screen");
  assert.equal(await evaluate(cdp, "document.querySelectorAll('[data-setup-player][data-starter=\"true\"]').length"), 11, "setup starts with 11 starters");
  await evaluate(cdp, "document.querySelector('[data-action=\"setup-save\"]').click()");
  await waitForSelector(cdp, ".hub-screen");
  await evaluate(cdp, "document.querySelector('[data-action=\"sim-to-user\"]').click()");
  await waitForExpression(cdp, "!document.querySelector('[data-action=\"play-user\"]')?.disabled");
  await evaluate(cdp, "document.querySelector('[data-action=\"play-user\"]').click()");
  await waitForSelector(cdp, "#pitchCanvas");
  await evaluate(cdp, "document.querySelector('[data-action=\"speed\"]').click(); document.querySelector('[data-action=\"speed\"]').click();");

  await waitForExpression(cdp, "document.querySelector('#newspaperModal:not(.hidden)')", FULL_MATCH_TIMEOUT_MS);
  const result = await evaluate(
    cdp,
    `(() => {
      const canvas = document.querySelector('#pitchCanvas');
      const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
      return {
        modalText: document.querySelector('#newspaperModal')?.textContent ?? '',
        continueVisible: !document.querySelector('#continueButton')?.classList.contains('hidden'),
        noScroll: document.scrollingElement.scrollHeight <= window.innerHeight + 2,
        hasWebgl: Boolean(gl),
        liveCards: document.querySelectorAll('.trait-card').length
      };
    })()`
  );

  assert.match(result.modalText, /Full-Time Report/, "newspaper modal appears after full time");
  assert.equal(result.continueVisible, true, "continue button visible after full time");
  assert.equal(result.noScroll, true, "match completion has no browser scroll");
  assert.equal(result.hasWebgl, true, "WebGL context remains available");
  assert.ok(result.liveCards > 0, "live AI cards remain rendered");
  assert.deepEqual(pageErrors, []);

  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  assert.ok(screenshot.data.length > 50000, "full-match screenshot contains rendered scene data");
  await writeFile(SCREENSHOT_PATH, Buffer.from(screenshot.data, "base64"));
  cdp.close();

  console.log(
    JSON.stringify(
      {
        timeoutMs: FULL_MATCH_TIMEOUT_MS,
        modal: "Full-Time Report",
        hasWebgl: result.hasWebgl,
        noScroll: result.noScroll,
        screenshot: SCREENSHOT_PATH.pathname
      },
      null,
      2
    )
  );
} finally {
  chrome.kill("SIGTERM");
}
