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

  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "Math.random = () => .6;" });
  await navigate("/");
  // The home form link has to preserve the selected overs, difficulty and team.
  await click('label:has(input[name="overs"][value="1"])');
  await click('label:has(input[name="team"][value="Australia"])');
  assert.match(await exec('return document.querySelector("#play-3d").search'), /overs=1&difficulty=Normal&team=Australia/);
  await click("#play-3d");
  await waitFor(async () => await exec('return document.querySelector("#load-title").textContent==="3D stadium unavailable" ? "failed" : document.querySelector("#loading").hidden'),
    "3D stadium", 35000).then(status => assert.notEqual(status, "failed"));
  assert.equal(await txt("match-settings"), "Australia · 1 over · Normal");
  await waitFor(async () => await txt("ai-title") === "Target: 13", "AI target");
  await click("#start-chase");

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
  console.log("BROWSER MATCH", await txt("result-title"), await txt("result-score"));
  await touch("#replay");
  assert.equal(await txt("score"), "0/0");
  console.log("BROWSER INPUTS mouse, keyboard and emulated touch; replay reset");

  await cdp("Network.enable", {});
  await cdp("Network.setBlockedURLs", { urls: ["*cricket_stadium.glb"] });
  await navigate("/game-3d.html");
  await waitFor(async () => await txt("load-title") === "3D stadium unavailable", "GLB fallback", 35000);
  assert.equal(await exec('return document.querySelector("#loading a").textContent.trim()'), "Play in 2D");
  console.log("BROWSER FALLBACK clear message and 2D link");

  await navigate("/");
  await waitFor(() => exec("return Boolean(navigator.serviceWorker.controller)"), "2D service worker");
  await cdp("Network.emulateNetworkConditions", {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  });
  await cmd("/refresh", {});
  await waitFor(() => exec('return Boolean(window.SuperOverLogic && document.querySelector("#setup"))'), "cached 2D reload");
  assert.equal(await exec('return navigator.onLine'), false);
  console.log("BROWSER OFFLINE 2D app reloaded with network disabled");
} finally {
  if (session) await driver(session, undefined, "DELETE").catch(() => {});
  driverProcess.kill();
  server.kill();
}
