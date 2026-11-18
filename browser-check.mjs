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
