import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const root = "http://127.0.0.1:8080";
const driverProcess = spawn("chromedriver", ["--port=9515"], { stdio: "ignore" });
const server = spawn("python3", ["-m", "http.server", "8080", "--bind", "127.0.0.1"], { stdio: "ignore" });
let session;

async function driver(path, body, method = body === undefined ? "GET" : "POST") {
  const res = await fetch("http://localhost:9515" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.value.message);
  return data.value;
}

async function waitFor(check, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(24);
  }
  throw new Error("Timed out: " + label);
}

try {
  await waitFor(() => driver("/status").catch(() => null), "ChromeDriver startup");
  const reply = await driver("/session", { capabilities: { alwaysMatch: {
    browserName: "chrome",
    "goog:chromeOptions": { args: ["--headless=new", "--no-sandbox", "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader", "--window-size=515,960", "--disable-dev-shm-usage"] },
  } } });
  session = "/session/" + reply.sessionId;
  const cmd = (path, body) => driver(session + path, body);
  const exec = (script, ...args) => cmd("/execute/sync", { script, args });
  const cdp = (cmdName, params) => cmd("/goog/cdp/execute", { cmd: cmdName, params });
  const navigate = path => cmd("/url", { url: root + path });
  const txt = id => exec("return document.getElementById(arguments[0])?.textContent", id);
  const formClick = async selector => {
    const element = await cmd("/element", { using: "css selector", value: selector });
    await cmd("/element/" + Object.values(element)[0] + "/click", {});
  };
  const rect = selector => exec(
    "const e=document.querySelector(arguments[0]); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width};",
    selector,
  );
  const click = async selector => {
    const { x, y } = await rect(selector);
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };
  const press = async (key, code, windowsVirtualKeyCode) => {
    await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", code, key, windowsVirtualKeyCode });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", code, key, windowsVirtualKeyCode });
  };
  const touch = async (selector, side = 0) => {
    const { x, y, w } = await rect(selector);
    await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x + side * w * .36, y }] });
    await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };

  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.qaRandom = [];
    Math.random = () => window.qaRandom.shift() ?? .6;
    window.qaErrors = [];
    window.addEventListener("error", event => window.qaErrors.push(event.message));
    window.addEventListener("unhandledrejection", event => window.qaErrors.push(String(event.reason)));
    window.qaAudio = { starts: [], firstGain: null };
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const node = createGain.call(this);
      window.qaAudio.firstGain ??= node.gain;
      return node;
    };
    const oscillator = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.qaAudio.starts.push("tone");
      return oscillator.apply(this, args);
    };
    const buffer = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.qaAudio.starts.push("crowd");
      return buffer.apply(this, args);
    };` });
  await navigate("/");
  // The home form link has to preserve the selected overs, difficulty and team.
  await formClick('label:has(input[name="overs"][value="1"])');
  await formClick('label:has(input[name="team"][value="Australia"])');
  assert.equal(await exec('return document.querySelector("input[name=team]:checked").value'), "Australia");
  const stadium = () => waitFor(() => exec(
    'const e=document.querySelector("#loading"); return e?.hidden || (document.querySelector("#load-title")?.textContent==="3D stadium unavailable" ? "failed" : false);'),
  "3D stadium", 35000).then(status => assert.notEqual(status, "failed"));
  await formClick('#setup button[type="submit"]');
  await stadium();
  assert.match(await exec('return location.search'), /mode=Chase&overs=1&difficulty=Normal&team=Australia&quick=1/);
  assert.equal(await txt("match-settings"), "Chase · Australia · 1 over · Normal");
  await waitFor(async () => await txt("ai-title") === "Target: 13", "AI target");
  await formClick("#start-chase");
  assert.equal(await exec('return document.querySelector("#batting").hidden'), false);

  const strike = () => waitFor(async () => await txt("shot-timing") === "Strike zone", "strike zone", 10000);
  const settled = () => waitFor(async () => await txt("shot-timing") === "Ball complete", "settled delivery");
  await click('[data-shot="off"]');
  await strike();
  await click("#hit");
  await settled();
  assert.match(await txt("commentary"), /FOUR|Perfect|Good/);
  await press("ArrowDown", "ArrowDown", 40);
  await strike();
  await press(" ", "Space", 32);
  await settled();
  assert.match(await txt("commentary"), /SIX|Perfect|Good/);

  await cdp("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await touch("#stadium", 1);
  assert.equal(await exec('return document.querySelector(arguments[0]).getAttribute("aria-pressed")',
    '[data-shot="leg"]'), "true");
  await strike();
  await touch("#hit");
  await settled();
  for (let i = 0; i < 3; i += 1) {
    const next = await waitFor(() => exec(
      'return !document.querySelector("#result").hidden ? "result" : document.querySelector("#shot-timing").textContent==="Strike zone" ? "strike" : null;'),
    "next delivery or result");
    if (next === "result") break;
    await touch("#hit");
    await settled();
  }
  await waitFor(() => exec('return !document.querySelector("#result").hidden'), "full match result");
  assert.match(await txt("result-title"), /^(Win|Tie|Lose)$/);
  assert.match(await txt("best-shot"), /Best shot: [1-6]/);
  assert.match(await txt("best-ball"), /No bowling innings/);
  console.log("BROWSER CHASE", await txt("result-title"), await txt("result-score"));
  await touch("#replay");
  assert.equal(await txt("score"), "0/0");
  console.log("BROWSER INPUTS mouse, keyboard and emulated touch; replay reset");

  await navigate("/");
  assert.match(await txt("match-history"), /Chase 3D/);
  await formClick('label:has(input[name="mode"][value="Defend"])');
  await formClick('label:has(input[name="overs"][value="1"])');
  await formClick("#quick");
  await formClick('#setup button[type="submit"]');
  await stadium();
  assert.match(await exec('return location.search'), /mode=Defend&overs=1&difficulty=Normal&team=Nepal&quick=0/);
  assert.equal(await txt("action-label"), "HIT");

  for (let ball = 0; ball < 6; ball++) {
    if (ball === 0) await click('[data-shot="off"]');
    else if (ball === 1) await press("ArrowDown", "ArrowDown", 40);
    else await touch("#stadium");
    await strike();
    if (ball === 0) await click("#hit");
    else if (ball === 1) await press(" ", "Space", 32);
    else await touch("#hit");
    await settled();
  }
  await waitFor(async () => (await txt("ai-title")).startsWith("Innings break"), "Defend innings break");
  assert.ok(Number(await txt("target")) > 1);
  await touch("#start-chase");
  assert.equal(await txt("action-label"), "BOWL");
  assert.equal(await txt("score-label"), "AI score");
  assert.equal(await txt("balls-left"), "6");
  assert.equal(await exec('return document.querySelector("#bowling-meter").hidden'), false);

  const sounds = () => exec("return window.qaAudio.starts.length");
  assert.ok(await sounds() > 0);
  assert.ok(await exec('return window.qaAudio.starts.includes("crowd")'));
  await touch("#sound-toggle");
  assert.equal(await txt("sound-toggle"), "Sound off");
  assert.equal(await exec("return window.qaAudio.firstGain.value"), 0);
  assert.equal(await exec('return localStorage.getItem("super-over-smash:muted")'), "true");
  const mutedCount = await sounds();
  const green = () => waitFor(() => exec(
    'const p=parseFloat(document.querySelector("#meter-marker").style.left); return document.querySelector("#shot-timing").textContent==="Time your release" && p>=44 && p<=56;'),
  "bowling green zone");
  await press("ArrowDown", "ArrowDown", 40);
  await green();
  await exec("window.qaRandom.push(.6,.6,.10,.10,.10)");
  await click("#hit");
  await settled();
  assert.match(await txt("commentary"), /AI drives through cover · bowled · Perfect release/);
  assert.equal(await sounds(), mutedCount);
  await touch("#sound-toggle");
  assert.equal(await txt("sound-toggle"), "Sound on");
  assert.equal(await exec("return window.qaAudio.firstGain.value"), 1);
  await press("ArrowLeft", "ArrowLeft", 37);
  await green();
  await press(" ", "Space", 32);
  await settled();
  assert.match(await txt("commentary"), /AI pulls to leg/);
  assert.ok(await sounds() > mutedCount);
  await touch("#stadium", 1);
  await green();
  await touch("#hit");
  await settled();
  await formClick("#sound-toggle");
  assert.equal(await txt("sound-toggle"), "Sound off");
  assert.equal(await exec('return localStorage.getItem("super-over-smash:muted")'), "true");
  for (let ball = 3; ball < 6; ball++) {
    await green();
    await touch("#hit");
    await settled();
  }
  await waitFor(() => exec('return !document.querySelector("#result").hidden'), "Defend result");
  assert.equal(await txt("result-title"), "Win");
  assert.match(await txt("best-shot"), /Best shot: [1-6]/);
  assert.match(await txt("best-ball"), /Best ball: WICKET — Perfect release, straight/);
  console.log("BROWSER DEFEND", await txt("result-title"), await txt("result-score"), await txt("best-ball"));
  console.log("BROWSER AUDIO click, bat and delivery events; mute and master gain verified");
  await formClick('#result a[href="./"]');
  await waitFor(() => exec('return Boolean(document.querySelector("#match-history"))'), "home history");
  assert.match(await txt("match-history"), /Defend 3D.*Chase 3D/s);
  assert.match(await txt("high-score"), /[1-9]\d* runs/);
  assert.equal(await exec('return document.querySelector("[data-sound]").textContent'), "Sound off");
  await formClick("[data-sound]");
  assert.equal(await exec('return localStorage.getItem("super-over-smash:muted")'), "false");
  console.log("BROWSER STORAGE 3D matches and high score visible at home; shared mute setting");

  await cdp("Network.enable", {});
  await cdp("Network.setBlockedURLs", { urls: ["*cricket_stadium.glb"] });
  await navigate("/game-3d.html?mode=Defend&overs=1&difficulty=Easy&team=India");
  await waitFor(async () => await txt("load-title") === "3D stadium unavailable", "GLB fallback", 35000);
  assert.equal(await exec('return document.querySelector("#loading a").textContent.trim()'), "Play 2D (light version)");
  await formClick("#loading a");
  await waitFor(() => exec('return document.querySelector("#match")?.hidden === false'), "2D fallback match");
  assert.match(await txt("match-label"), /India.*Easy/);
  console.log("BROWSER FALLBACK clear message and one-tap Defend 2D start");

  await navigate("/");
  await waitFor(() => exec("return Boolean(navigator.serviceWorker.controller)"), "2D service worker");
  await cdp("Network.emulateNetworkConditions", {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  });
  await cmd("/refresh", {});
  await waitFor(() => exec('return Boolean(window.SuperOverLogic && document.querySelector("#setup"))'), "cached 2D reload");
  assert.equal(await exec('return navigator.onLine'), false);
  await formClick("#play-2d");
  assert.equal(await exec('return document.querySelector("#match").hidden'), false);
  console.log("BROWSER OFFLINE 2D reloaded and started a match without network");
} catch (error) {
  if (session) {
    const ui = await driver(session + "/execute/sync", {
      script: 'return {url:location.href, errors:window.qaErrors, text:Object.fromEntries(["ai-title","shot-timing","commentary","score","action-label"].map(id=>[id,document.getElementById(id)?.textContent]))}',
      args: [],
    }).catch(() => null);
    console.log("BROWSER DIAGNOSTICS", JSON.stringify(ui));
  }
  throw error;
} finally {
  if (session) await driver(session, undefined, "DELETE").catch(() => {});
  driverProcess.kill();
  server.kill();
}
