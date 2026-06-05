import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = 9224;
const BASE_URL = "http://127.0.0.1:5180";
const PROFILE_DIR = "/private/tmp/futbol-browser-smoke-profile";
const SCREENSHOT_PATH = new URL("../output/playwright/browser-smoke-match.png", import.meta.url);

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

async function waitForSelector(cdp, selector) {
  for (let i = 0; i < 80; i += 1) {
    const found = await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    if (found) return;
    await delay(100);
  }
  throw new Error(`Selector not found: ${selector}`);
}

async function waitForExpression(cdp, expression, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, `Boolean(${expression})`)) return;
    await delay(100);
  }
  throw new Error(`Expression not satisfied: ${expression}`);
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

const stderr = [];
chrome.stderr.on("data", (chunk) => stderr.push(String(chunk)));

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

  const heading = await evaluate(cdp, "document.querySelector('h1')?.textContent");
  const teamCount = await evaluate(cdp, "document.querySelectorAll('[data-select-team]').length");
  const flagCount = await evaluate(cdp, "document.querySelectorAll('.flag-pixel').length");
  const selectionNoScroll = await evaluate(cdp, "document.scrollingElement.scrollHeight <= window.innerHeight + 2");
  await waitForExpression(cdp, "document.fonts && document.fonts.status === 'loaded'");
  const fontStatus = await evaluate(
    cdp,
    `(() => ({
      localLoaded: document.fonts.check('12px "Press Start 2P Local"'),
      bodyFamily: getComputedStyle(document.body).fontFamily
    }))()`
  );
  assert.equal(heading, "World Cup 2D Futbol");
  assert.equal(teamCount, 32);
  assert.equal(flagCount, 32);
  assert.equal(selectionNoScroll, true, "selection screen does not create browser scroll");
  assert.equal(fontStatus.localLoaded, true, "local Press Start 2P font loaded");
  assert.match(fontStatus.bodyFamily, /Press Start 2P Local/, "body prefers local pixel font");

  for (const viewport of [
    { width: 1440, height: 980, mobile: false },
    { width: 1366, height: 768, mobile: false },
    { width: 1024, height: 768, mobile: false },
    { width: 390, height: 844, mobile: true }
  ]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile
    });
    await delay(120);
    const shellMetrics = await evaluate(
      cdp,
      `(() => {
        const shell = document.querySelector('.arcade-shell');
        const rect = shell.getBoundingClientRect();
        return {
          noScroll: document.scrollingElement.scrollHeight <= window.innerHeight + 2,
          centeredX: Math.abs((rect.left + rect.width / 2) - window.innerWidth / 2) <= 2,
          withinHeight: rect.height <= window.innerHeight,
          withinWidth: rect.width <= window.innerWidth
        };
      })()`
    );
    assert.equal(shellMetrics.noScroll, true, `no browser scroll at ${viewport.width}x${viewport.height}`);
    assert.equal(shellMetrics.centeredX, true, `arcade shell centered at ${viewport.width}x${viewport.height}`);
    assert.equal(shellMetrics.withinHeight, true, `arcade shell fits height at ${viewport.width}x${viewport.height}`);
    assert.equal(shellMetrics.withinWidth, true, `arcade shell fits width at ${viewport.width}x${viewport.height}`);
  }

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 980,
    deviceScaleFactor: 1,
    mobile: false
  });

  await evaluate(cdp, "document.querySelector('[data-select-team=\"SLV\"]').click()");
  await waitForSelector(cdp, ".setup-screen");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1024,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false
  });
  await delay(120);
  const setupHeading = await evaluate(cdp, "document.querySelector('.setup-header h1')?.textContent?.trim()");
  assert.match(setupHeading, /El Salvador Match Plan/);
  const setupStarters = await evaluate(cdp, "document.querySelectorAll('[data-setup-player][data-starter=\"true\"]').length");
  const setupSubs = await evaluate(cdp, "document.querySelectorAll('[data-setup-player][data-starter=\"false\"]').length");
  const formationOptions = await evaluate(cdp, "document.querySelectorAll('[data-setup-field=\"formation\"] option').length");
  const setupCoach = await evaluate(cdp, "document.querySelector('.coach-card strong')?.textContent?.trim()");
  const rosterOverallVisible = await evaluate(cdp, "document.querySelector('[data-setup-player] small')?.textContent?.includes('OVR')");
  assert.equal(setupStarters, 11, "setup renders starting XI");
  assert.equal(setupSubs, 12, "setup renders substitutes");
  assert.ok(setupCoach.length > 3, "setup renders JSON coach name");
  assert.ok(formationOptions >= 3, "setup renders formation choices");
  assert.equal(rosterOverallVisible, true, "setup roster rows show overall rating");
  const setupLayout = await evaluate(
    cdp,
    `(() => {
      const rect = (selector) => {
        const el = document.querySelector(selector);
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          x: box.x,
          width: box.width,
          height: box.height,
          bottom: box.bottom,
          columns: style.gridTemplateColumns.split(' ').filter(Boolean).length,
          overflow: style.overflow,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight
        };
      };
      return {
        noScroll: document.scrollingElement.scrollHeight <= window.innerHeight + 2,
        grid: rect('.team-setup-grid'),
        roster: rect('.roster-panel'),
        side: rect('.setup-side-stack'),
        tactics: rect('.tactics-panel'),
        pitch: rect('.pitch-panel'),
        clippedPitchDots: (() => {
          const pitch = document.querySelector('.mini-pitch').getBoundingClientRect();
          return Array.from(document.querySelectorAll('.mini-player-dot')).filter((dot) => {
            const box = dot.getBoundingClientRect();
            return box.left < pitch.left || box.right > pitch.right || box.top < pitch.top || box.bottom > pitch.bottom;
          }).length;
        })(),
        startersList: rect('.starters-list'),
        subsList: rect('.subs-list'),
        rosterCountText: document.querySelector('.setup-list-heading small')?.textContent?.trim(),
        pitchDots: document.querySelectorAll('.mini-player-dot').length,
        rangeCount: document.querySelectorAll('.tactics-panel input[type="range"]').length
      };
    })()`
  );
  assert.equal(setupLayout.noScroll, true, "setup keeps browser-level no-scroll");
  assert.equal(setupLayout.grid.columns, 2, "setup uses roster plus side-stack columns on desktop");
  assert.equal(setupLayout.side.columns, 2, "setup side-stack shows coach board and shape side by side");
  assert.ok(setupLayout.roster.width > 260, "setup roster slab is visible");
  assert.ok(setupLayout.tactics.width > 240, "setup tactics slab is visible");
  assert.ok(setupLayout.pitch.width > 220, "setup shape slab is visible");
  assert.ok(setupLayout.startersList.height > 90, "starter list has usable height");
  assert.ok(setupLayout.subsList.height > 70, "substitute list has usable height");
  assert.equal(setupLayout.startersList.overflow, "auto", "starter list scrolls internally");
  assert.equal(setupLayout.subsList.overflow, "auto", "substitute list scrolls internally");
  assert.equal(setupLayout.pitchDots, 11, "mini pitch renders 11 dots");
  assert.equal(setupLayout.clippedPitchDots, 0, "mini pitch dots stay inside pitch bounds");
  assert.equal(setupLayout.rangeCount, 3, "coach board renders three sliders");
  const swapResult = await evaluate(
    cdp,
    `(() => {
      const starter = document.querySelector('[data-setup-player][data-starter="true"]');
      const sub = document.querySelector('[data-setup-player][data-starter="false"]');
      const starterId = starter.dataset.setupPlayer;
      const subId = sub.dataset.setupPlayer;
      starter.click();
      document.querySelector('[data-setup-player="' + subId + '"]').click();
      return {
        starterId,
        subId,
        starters: document.querySelectorAll('[data-setup-player][data-starter="true"]').length,
        subs: document.querySelectorAll('[data-setup-player][data-starter="false"]').length,
        subPromoted: document.querySelector('[data-setup-player="' + subId + '"]')?.dataset.starter === 'true'
      };
    })()`
  );
  assert.equal(swapResult.starters, 11, "swap preserves 11 starters");
  assert.equal(swapResult.subs, 12, "swap preserves 12 substitutes");
  assert.equal(swapResult.subPromoted, true, "clicked substitute becomes a starter");
  const setupControls = await evaluate(
    cdp,
    `(() => {
      const beforeShape = Array.from(document.querySelectorAll('.mini-player-dot')).map((dot) => dot.getAttribute('style')).join('|');
      for (const [key, value] of [['pressingIntensity', '91'], ['defensiveLineHeight', '27'], ['passingStyle', '84']]) {
        const input = document.querySelector('[data-setup-field="' + key + '"]');
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const formation = document.querySelector('[data-setup-field="formation"]');
      const targetFormation = formation.value === '3-5-2' ? '4-4-2' : '3-5-2';
      formation.value = targetFormation;
      formation.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        beforeShape,
        targetFormation,
        pressing: document.querySelector('[data-range-value="pressingIntensity"]')?.textContent,
        line: document.querySelector('[data-range-value="defensiveLineHeight"]')?.textContent,
        passing: document.querySelector('[data-range-value="passingStyle"]')?.textContent
      };
    })()`
  );
  await waitForSelector(cdp, ".setup-screen");
  const afterShape = await evaluate(cdp, "Array.from(document.querySelectorAll('.mini-player-dot')).map((dot) => dot.getAttribute('style')).join('|')");
  const selectedFormation = await evaluate(cdp, "document.querySelector('[data-setup-field=\"formation\"]')?.value");
  assert.equal(setupControls.pressing, "91", "pressing slider updates displayed value");
  assert.equal(setupControls.line, "27", "defensive line slider updates displayed value");
  assert.equal(setupControls.passing, "84", "passing slider updates displayed value");
  assert.equal(selectedFormation, setupControls.targetFormation, "formation dropdown updates selected value");
  assert.notEqual(afterShape, setupControls.beforeShape, "mini pitch shape updates when formation changes");
  await evaluate(cdp, "document.querySelector('[data-action=\"setup-save\"]').click()");
  await waitForSelector(cdp, ".hub-screen");
  const hubHeading = await evaluate(cdp, "document.querySelector('.hub-team-anchor h1')?.textContent?.trim()");
  assert.equal(hubHeading, "El Salvador Campaign");
  const hubStructure = await evaluate(
    cdp,
    `(() => ({
      banner: Boolean(document.querySelector('.hub-score-banner')),
      layout: Boolean(document.querySelector('.hub-layout')),
      slabs: document.querySelectorAll('.retro-slab').length,
      noScroll: document.scrollingElement.scrollHeight <= window.innerHeight + 2,
      scheduleOverflow: getComputedStyle(document.querySelector('.schedule-team')).textOverflow,
      scheduleWhiteSpace: getComputedStyle(document.querySelector('.schedule-team')).whiteSpace
    }))()`
  );
  assert.equal(hubStructure.banner, true, "hub renders score banner");
  assert.equal(hubStructure.layout, true, "hub renders grid layout");
  assert.ok(hubStructure.slabs >= 2, "hub renders retro slabs");
  assert.equal(hubStructure.noScroll, true, "hub does not create browser scroll");
  assert.equal(hubStructure.scheduleOverflow, "ellipsis", "schedule team names truncate");
  assert.equal(hubStructure.scheduleWhiteSpace, "nowrap", "schedule team names stay aligned");
  const bracketCards = await evaluate(cdp, "document.querySelectorAll('.bracket-round-card').length");
  const bracketMatches = await evaluate(cdp, "document.querySelectorAll('.bracket-match').length");
  const scheduleRows = await evaluate(cdp, "document.querySelectorAll('.schedule-row').length");
  assert.ok(bracketCards >= 1, "bracket cards render");
  assert.equal(bracketMatches, 16, "round of 32 bracket matches render");
  assert.ok(scheduleRows > 0, "schedule rows render");

  await evaluate(cdp, "document.querySelector('[data-action=\"sim-to-user\"]').click()");
  await waitForSelector(cdp, ".recent-stack p");
  const recentText = await evaluate(cdp, "document.querySelector('.recent-stack p')?.textContent");
  assert.match(recentText, /\d-\d/);
  const playEnabled = await evaluate(cdp, "!document.querySelector('[data-action=\"play-user\"]')?.disabled");
  const highlightedUserRows = await evaluate(cdp, "document.querySelectorAll('.schedule-list .user-schedule-row').length");
  assert.equal(playEnabled, true);
  assert.equal(highlightedUserRows, 1, "user match is highlighted once");

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 980,
    deviceScaleFactor: 1,
    mobile: false
  });
  await delay(120);
  await evaluate(cdp, "document.querySelector('[data-action=\"play-user\"]').click()");
  await waitForSelector(cdp, "#pitchCanvas");
  await delay(1300);

  const canvas = await evaluate(
    cdp,
    `(() => {
      const canvas = document.querySelector('#pitchCanvas');
      const rect = canvas.getBoundingClientRect();
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const data = new Uint8Array(4);
      if (gl) {
        gl.readPixels(
          Math.floor(gl.drawingBufferWidth / 2),
          Math.floor(gl.drawingBufferHeight / 2),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          data
        );
      }
      const scoreboard = document.querySelector('#scoreboard')?.textContent ?? '';
      const liveCards = document.querySelectorAll('.trait-card').length;
      const renderer = canvas.__threeJsRenderer;
      const playerRecords = renderer ? Array.from(renderer.players.values()) : [];
      const firstRecord = playerRecords[0];
      const firstTexture = firstRecord?.sprite?.material?.map;
      const nearest = renderer?.nearestFilter;
      return {
        width: rect.width,
        height: rect.height,
        data: Array.from(data),
        hasWebgl: Boolean(gl),
        bufferWidth: gl?.drawingBufferWidth ?? 0,
        bufferHeight: gl?.drawingBufferHeight ?? 0,
        scoreboard,
        liveCards,
        renderer: renderer
          ? {
              playerRecords: playerRecords.length,
              playerSprites: playerRecords.filter((record) => record.sprite?.isSprite).length,
              playerShadows: playerRecords.filter((record) => record.shadow?.isMesh).length,
              firstTextureWidth: firstTexture?.image?.width ?? 0,
              firstTextureHeight: firstTexture?.image?.height ?? 0,
              playerTextureNearest: firstTexture?.minFilter === nearest && firstTexture?.magFilter === nearest,
              pitchTextureNearest: renderer.pitchTexture?.minFilter === nearest && renderer.pitchTexture?.magFilter === nearest,
              crowdTextureNearest: renderer.crowdTexture?.minFilter === nearest && renderer.crowdTexture?.magFilter === nearest,
              crowdMipmapsDisabled: renderer.crowdTexture?.generateMipmaps === false,
              crowdRepeatX: renderer.crowdTexture?.repeat?.x ?? 0,
              ballShadowIsFlatMesh: renderer.ballShadow?.isMesh === true,
              cameraFov: renderer.camera?.fov ?? 0,
              lineWidth: renderer.lineWidth ?? 0
            }
          : null
      };
    })()`
  );

  assert.ok(canvas.width > 600, "canvas width");
  assert.ok(canvas.height > 350, "canvas height");
  assert.equal(canvas.hasWebgl, true, "canvas uses WebGL");
  assert.ok(canvas.bufferWidth > 600, "webgl drawing buffer width");
  assert.ok(canvas.bufferHeight > 350, "webgl drawing buffer height");
  assert.match(canvas.scoreboard, /El Salvador/);
  assert.ok(canvas.liveCards > 0, "live AI cards render");
  assert.ok(canvas.renderer, "ThreeJsRenderer is attached to canvas");
  assert.equal(canvas.renderer.playerRecords, 22, "renderer tracks 22 player records");
  assert.equal(canvas.renderer.playerSprites, 22, "renderer uses sprite billboards for players");
  assert.equal(canvas.renderer.playerShadows, 22, "renderer creates player drop shadows");
  assert.equal(canvas.renderer.firstTextureWidth, 48, "player sprite texture width");
  assert.equal(canvas.renderer.firstTextureHeight, 64, "player sprite texture height");
  assert.equal(canvas.renderer.playerTextureNearest, true, "player sprite texture uses nearest filtering");
  assert.equal(canvas.renderer.pitchTextureNearest, true, "pitch texture uses nearest filtering");
  assert.equal(canvas.renderer.crowdTextureNearest, true, "crowd texture uses nearest filtering");
  assert.equal(canvas.renderer.crowdMipmapsDisabled, true, "crowd mipmaps disabled");
  assert.ok(canvas.renderer.crowdRepeatX <= 3, "crowd texture uses low repeat count");
  assert.equal(canvas.renderer.ballShadowIsFlatMesh, true, "ball shadow is a flat mesh");
  assert.ok(canvas.renderer.cameraFov <= 48, "camera uses closer broadcast FOV");
  assert.ok(canvas.renderer.lineWidth >= 12, "field lines are chunky");
  assert.deepEqual(pageErrors, []);

  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  assert.ok(screenshot.data.length > 50000, "screenshot contains rendered scene data");
  await writeFile(SCREENSHOT_PATH, Buffer.from(screenshot.data, "base64"));
  cdp.close();

  console.log(
    JSON.stringify(
      {
        heading,
        teamCount,
        hubHeading,
        recentText,
        flagCount,
        bracketCards,
        bracketMatches,
        scheduleRows,
        canvas: { width: canvas.width, height: canvas.height, pixel: canvas.data, liveCards: canvas.liveCards, renderer: canvas.renderer },
        screenshot: SCREENSHOT_PATH.pathname
      },
      null,
      2
    )
  );
} finally {
  chrome.kill("SIGTERM");
}
