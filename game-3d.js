import { connectMatchAudio } from "./match-audio-3d.js";

const LINES = ["off", "straight", "leg"];
const SIDE = { off: -1, straight: 0, leg: 1 };
const AIM = { off: "Cover", straight: "Straight", leg: "Leg" };
const ARROWS = { ArrowLeft: "off", ArrowDown: "straight", ArrowRight: "leg" };
const FLIGHT = { Easy: 1600, Normal: 1280, Hard: 1000 };
const GAP = { Easy: 1650, Normal: 1400, Hard: 1150 };
const METER_TIME = { Easy: 1800, Normal: 1500, Hard: 1250 };
const AI_ACTION = { off: "drives through cover", straight: "hits straight", leg: "pulls to leg" };
const LINE_NAME = { off: "off side", straight: "straight", leg: "leg side" };
const SHOT_PATH = { off: "through covers", straight: "down the ground", leg: "to leg" };
const TIMING_RANK = { missed: 0, early: 1, late: 1, good: 2, perfect: 3 };
const STORAGE_PREFIX = "super-over-smash:";
const TEAMS = {
  Nepal: "#ef5271", India: "#5a93ff", Pakistan: "#47c180",
  Bangladesh: "#20baa9", "Sri Lanka": "#9483ff", Australia: "#f7c750",
};
const CONTACT_Z = -8.73;
const RELEASE_Z = 10.66;
const byId = id => document.getElementById(id);

function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(STORAGE_PREFIX + key)) ?? fallback; }
  catch { return fallback; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch {}
}

function readHistory() {
  const history = readStorage("match-history", null);
  if (Array.isArray(history)) return history;
  const last = readStorage("last-result", null);
  if (!last || !Number.isFinite(last.runs)) return [];
  return [{ mode: "Chase", result: last.result, player: { runs: last.runs, wickets: last.wickets },
    ai: Number.isFinite(last.target) ? { runs: last.target - 1 } : null }];
}

function settingsFromUrl() {
  const query = new URLSearchParams(location.search);
  const overs = Number(query.get("overs"));
  const difficulty = query.get("difficulty");
  const team = query.get("team");
  return {
    mode: query.get("mode") === "Defend" ? "Defend" : "Chase",
    overs: [1, 2, 5].includes(overs) ? overs : 2,
    difficulty: Object.hasOwn(FLIGHT, difficulty) ? difficulty : "Normal",
    team: Object.hasOwn(TEAMS, team) ? team : "Nepal",
    quick: query.has("quick") ? query.get("quick") !== "0" : readStorage("quick", true) !== false,
  };
}

async function loadStadium(settings) {
  const [THREE, { GLTFLoader }] = await Promise.all([
    import("three"),
    import("three/addons/loaders/GLTFLoader.js"),
  ]);
  const canvas = byId("stadium");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio < 2, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#8eb3b8");
  scene.fog = new THREE.Fog("#8eb3b8", 52, 115);
  scene.add(new THREE.HemisphereLight("#e0f6ff", "#46594a", 1.85));
  const sun = new THREE.DirectionalLight("#ffe0b3", 2.25);
  sun.position.set(-15, 22, 14);
  scene.add(sun);
  const rim = new THREE.DirectionalLight("#bfeaff", .65);
  rim.position.set(13, 7, -20);
  scene.add(rim);
  const camera = new THREE.PerspectiveCamera(43, 1, .05, 140);
  camera.position.set(2.9, 4.4, 16.8);
  camera.lookAt(-.2, .6, -4.8);

  try {
    const response = await fetch("./assets/cricket_stadium.glb", { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("Stadium response " + response.status);
    const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), "");
    scene.add(gltf.scene);
    const bowler = gltf.scene.getObjectByName("Player_Bowler");
    const batter = gltf.scene.getObjectByName("Player_Batsman");
    const bat = gltf.scene.getObjectByName("Bat_Pivot");
    const ball = gltf.scene.getObjectByName("Cricket_Ball");
    const stumps = gltf.scene.getObjectByName("Stumps_Batsman");
    if (!bowler || !batter || !bat || !ball || !stumps) throw new Error("The stadium is missing animation parts");
    const jerseys = [[bowler, "Mint Jersey"], [batter, "Coral Jersey"]].map(([player, name]) => {
      const materials = new Map();
      player.traverse(child => {
        if (!child.isMesh) return;
        const localize = material => {
          if (material.name !== name) return material;
          if (!materials.has(material)) materials.set(material, material.clone());
          return materials.get(material);
        };
        child.material = Array.isArray(child.material) ? child.material.map(localize) : localize(child.material);
      });
      return [...materials.values()].map(material => ({ material, original: material.color.clone() }));
    });
    const setPlayerColors = bowling => {
      for (const [index, pieces] of jerseys.entries()) for (const { material, original } of pieces) {
        if (bowling === (index === 0)) material.color.set(TEAMS[settings.team]);
        else material.color.copy(original);
      }
    };
    const render = () => renderer.render(scene, camera);
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.fov = width / height < 1.15 ? 56 : 43;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      render();
    };
    new ResizeObserver(resize).observe(canvas);
    resize();
    return { bowler, batter, bat, ball, stumps, setPlayerColors, render };
  } catch (error) {
    renderer.dispose();
    throw error;
  }
}

export async function boot() {
  const logic = globalThis.SuperOverLogic;
  if (!logic) throw new Error("Cricket scoring did not load");
  const settings = settingsFromUrl();
  const controls = [...document.querySelectorAll("[data-shot]")];
  const canvas = byId("stadium");
  const hitButton = byId("hit");
  const result = byId("result");
  const panel = byId("ai-panel");
  const skip = byId("skip");
  const start = byId("start-chase");
  const stage = await loadStadium(settings);
  const soundToggle = byId("sound-toggle");
  const playSound = connectMatchAudio(soundToggle);
  const meter = byId("bowling-meter");
  const meterMarker = byId("meter-marker");
  const meterTime = METER_TIME[settings.difficulty];
  const timingWindow = logic.timingWindow(settings.difficulty);
  const bowlerHome = stage.bowler.position.clone();
  const batHome = stage.bat.quaternion.clone();
  const batterHome = stage.batter.rotation.y;
  const stumpsHome = stage.stumps.quaternion.clone();
  const pause = milliseconds => settings.quick ? milliseconds / 2 : milliseconds;
  const formatScore = score => score.runs + "/" + score.wickets;
  const capitalize = text => text[0].toUpperCase() + text.slice(1);
  let phase = "idle";
  let phaseStart = 0;
  let clock = 0;
  let previousFrame = null;
  let frameId = 0;
  let ai;
  let aiIndex;
  let innings;
  let target;
  let direction;
  let delivery;
  let shot;
  let bowling;
  let playerInnings;
  let bestShot;
  let bestBall;

  byId("match-settings").textContent = settings.mode + " · " + settings.team + " · " + settings.overs +
    (settings.overs === 1 ? " over · " : " overs · ") + settings.difficulty;
  byId("loading").hidden = true;
  for (const [id, halfWidth] of [["meter-good", timingWindow.good], ["meter-perfect", timingWindow.perfect]]) {
    const fraction = halfWidth * 100 / meterTime;
    byId(id).style.left = (50 - fraction) + "%";
    byId(id).style.width = fraction * 2 + "%";
  }

  function scoreboard(score, simulatedAi = false) {
    byId("score-label").textContent = simulatedAi || bowling ? "AI score" : "Your score";
    byId("score").textContent = formatScore(score);
    byId("overs").textContent = logic.ballsToOvers(score.balls);
    byId("target").textContent = target ?? "—";
    const chase = target && !simulatedAi && (settings.mode === "Chase" || bowling)
      ? logic.chaseInfo(score, settings.overs, target) : null;
    byId("needed").textContent = chase?.runsNeeded ?? "—";
    byId("balls-left").textContent = simulatedAi ? "—" :
      chase?.ballsLeft ?? Math.max(0, logic.oversToBalls(settings.overs) - score.balls);
  }

  function nextPhase(next) {
    phase = next;
    phaseStart = clock;
  }

  function choose(next) {
    direction = next;
    for (const button of controls) button.setAttribute("aria-pressed", String(next === button.dataset.shot));
  }

  function startMatch() {
    bowling = false;
    playerInnings = null;
    bestShot = null;
    bestBall = null;
    previousFrame = null;
    aiIndex = 0;
    innings = logic.newInnings();
    target = null;
    choose("straight");
    result.hidden = true;
    stage.setPlayerColors(false);
    if (settings.mode === "Defend") {
      startInnings();
      stage.render();
      return;
    }
    ai = logic.simulateInnings(settings.overs, settings.difficulty);
    panel.hidden = false;
    skip.hidden = false;
    start.hidden = true;
    start.textContent = "Start chase →";
    byId("batting").hidden = true;
    byId("impact").hidden = true;
    byId("ai-title").textContent = "AI innings";
    byId("ai-line").textContent = "The AI is setting your target.";
    stage.bowler.position.copy(bowlerHome);
    stage.bowler.rotation.y = 0;
    stage.batter.rotation.y = batterHome;
    stage.bat.quaternion.copy(batHome);
    stage.stumps.quaternion.copy(stumpsHome);
    stage.ball.visible = false;
    scoreboard(logic.newInnings(), true);
    nextPhase("ai");
    byId("ai-title").focus({ preventScroll: true });
    stage.render();
    requestFrame();
  }

  function startInnings() {
    panel.hidden = true;
    byId("batting").hidden = false;
    byId("action-label").textContent = bowling ? "BOWL" : "HIT";
    byId("off-label").textContent = bowling ? "Off" : "Cover";
    canvas.setAttribute("aria-label", bowling
      ? "Cricket pitch. Tap left for Off, middle for Straight, or right for Leg."
      : "Cricket pitch. Tap left for Cover, middle for Straight, or right for Leg.");
    controls[0].parentElement.setAttribute("aria-label", bowling ? "Bowling line" : "Shot direction");
    meter.hidden = !bowling;
    choose("straight");
    byId("commentary").textContent = bowling ? "Pick your line and bowl in the green zone."
      : "Tap HIT as the ball reaches the gold line.";
    scoreboard(innings);
    previousFrame = null;
    ready();
    controls[1].focus({ preventScroll: true });
    requestFrame();
  }

  function finishAi() {
    target = ai.innings.runs + 1;
    nextPhase("target");
    scoreboard(ai.innings, true);
    byId("ai-title").textContent = "Target: " + target;
    byId("ai-line").textContent = "Score " + target + " to win.";
    skip.hidden = true;
    start.hidden = false;
    start.focus({ preventScroll: true });
  }

  function finishBatting() {
    playerInnings = innings;
    target = playerInnings.runs + 1;
    nextPhase("target");
    scoreboard(playerInnings);
    byId("batting").hidden = true;
    byId("impact").hidden = true;
    panel.hidden = false;
    byId("ai-title").textContent = "Innings break · Target: " + target;
    byId("ai-line").textContent = "You scored " + formatScore(playerInnings) + ". Keep the AI below " + target + ".";
    skip.hidden = true;
    start.textContent = "Start bowling →";
    start.hidden = false;
    start.focus({ preventScroll: true });
  }

  function ready() {
    nextPhase("ready");
    stage.bowler.position.copy(bowlerHome);
    stage.bowler.position.z += 1.8;
    stage.bowler.rotation.y = 0;
    stage.batter.rotation.y = batterHome;
    stage.bat.quaternion.copy(batHome);
    stage.stumps.quaternion.copy(stumpsHome);
    meterMarker.style.left = "0%";
    stage.ball.visible = false;
    hitButton.disabled = true;
    byId("impact").hidden = true;
    byId("shot-timing").textContent = "Bowler running in";
  }

  function release(bowlTiming) {
    const line = bowling ? direction : LINES[Math.floor(Math.random() * LINES.length)];
    const extra = logic.rollExtra();
    delivery = { line, extra, bowlTiming, bounced: false, duration: FLIGHT[settings.difficulty] * (.9 + Math.random() * .2),
      aiShot: bowling && !extra ? logic.pickAiShot(settings.difficulty) : null,
      landingX: extra === "wide" ? (Math.random() < .5 ? -2.5 : 2.5) : SIDE[line] * .49 };
    stage.bowler.position.copy(bowlerHome);
    stage.bowler.rotation.y = -.24;
    stage.ball.visible = true;
    placeBall(0);
    hitButton.disabled = bowling || Boolean(extra);
    byId("shot-timing").textContent = extra ? "Extra delivery" : "Ball released";
    nextPhase("flight");
  }

  function placeBall(t) {
    const bounce = .69;
    const y = t <= bounce ? 1.5 - 1.37 * Math.pow(t / bounce, 1.25)
      : .16 + .56 * Math.sin(Math.min((t - bounce) / .53, 1) * Math.PI * .95);
    stage.ball.position.set(-.66 + (delivery.landingX + .66) * t, y, RELEASE_Z + (CONTACT_Z - RELEASE_Z) * t);
    stage.ball.rotation.x = t * 11;
  }

  function completeBall(timing, progress) {
    if (phase !== "flight") return;
    const { line, extra, aiShot } = delivery;
    const outcome = extra ?? (bowling
      ? logic.bowlDelivery({ timing, line, aiShot, difficulty: settings.difficulty })
      : logic.scoreShot({ timing, line, direction, difficulty: settings.difficulty }));
    const shotDirection = bowling ? aiShot?.direction ?? direction : direction;
    const bowled = outcome === "OUT" && line === "straight" && (bowling || timing === "missed");
    placeBall(Math.max(0, Math.min(1.15, progress)));
    shot = { outcome, timing, direction: shotDirection, origin: stage.ball.position.clone(), bowled, extra };
    if (!extra) {
      if (bowling) {
        const rank = outcome === "OUT" ? 7 : 6 - outcome;
        if (!bestBall || rank > bestBall.rank || (rank === bestBall.rank && TIMING_RANK[timing] > TIMING_RANK[bestBall.timing])) {
          bestBall = { outcome, timing, line, rank };
        }
      } else if (typeof outcome === "number" && timing !== "missed" &&
          (!bestShot || outcome > bestShot.outcome ||
            (outcome === bestShot.outcome && TIMING_RANK[timing] > TIMING_RANK[bestShot.timing]))) {
        bestShot = { outcome, timing, direction };
      }
    }
    innings = logic.recordBall(innings, outcome);
    scoreboard(innings);
    hitButton.disabled = true;
    const badge = extra ? "+1 extra" : outcome === "OUT" ? "OUT" : outcome === 6 ? "SIX!"
      : outcome === 4 ? "FOUR!" : outcome === 0 ? "DOT BALL" : String(outcome);
    byId("impact").textContent = badge;
    byId("impact").hidden = false;
    if (extra) {
      byId("commentary").textContent = (extra === "wide" ? "Wide" : "No-ball") + ". One run. Bowl again.";
    } else if (bowling) {
      const release = timing === "missed" ? "Loose ball" : capitalize(timing) + " release";
      const result = bowled ? "bowled" : outcome === "OUT" ? "wicket" :
        outcome === 0 ? "dot ball" : outcome + (outcome === 1 ? " run" : " runs");
      byId("commentary").textContent = "AI " + AI_ACTION[shotDirection] + " · " + result + " · " + release;
    } else {
      byId("commentary").textContent = badge + " · " +
        (timing === "missed" ? "Missed" : capitalize(timing) + " · " + AIM[direction]);
    }
    if (outcome === "OUT") playSound("wicket");
    if (outcome > 0) playSound("hit");
    if (outcome === 4 || outcome === 6) playSound("cheer");
    byId("shot-timing").textContent = "Ball complete";
    nextPhase("feedback");
  }

  function hit() {
    if (document.hidden || (phase !== "meter" && (phase !== "flight" || bowling || delivery.extra))) return;
    const time = clock + (previousFrame === null ? 0 : Math.min(64, Math.max(0, performance.now() - previousFrame)));
    const elapsed = time - phaseStart;
    if (phase === "meter") {
      const offset = elapsed - meterTime / 2;
      const timing = elapsed >= meterTime ? "missed" : Math.abs(offset) <= timingWindow.perfect ? "perfect"
        : Math.abs(offset) <= timingWindow.good ? "good" : offset < 0 ? "early" : "late";
      playSound("click");
      release(timing);
      return;
    }
    const timing = logic.classifyTiming(elapsed - delivery.duration, settings.difficulty);
    completeBall(timing, elapsed / delivery.duration);
  }

  function finish() {
    const player = bowling ? playerInnings : innings;
    const opponent = bowling ? innings : ai.innings;
    const outcome = bowling ? logic.defendResult(opponent.runs, target) : logic.matchResult(player.runs, target);
    const previous = readStorage("high-score", 0);
    writeStorage("high-score", Math.max(Number.isFinite(previous) ? previous : 0, player.runs));
    writeStorage("match-history", logic.addMatchToHistory(readHistory(), {
      mode: settings.mode + " 3D", result: outcome, player, ai: opponent, overs: settings.overs,
      difficulty: settings.difficulty, date: new Date().toISOString(),
    }));
    byId("result-title").textContent = outcome;
    byId("result-score").textContent = "You " + formatScore(player) + " · AI " + formatScore(opponent) + " · Target " + target;
    byId("best-shot").textContent = "Best shot: " + (bestShot
      ? bestShot.outcome + " — " + capitalize(bestShot.timing) + ", " + SHOT_PATH[bestShot.direction] : "No shot played");
    byId("best-ball").textContent = "Best ball: " + (bestBall
      ? (bestBall.outcome === "OUT" ? "WICKET" : bestBall.outcome === 0 ? "DOT BALL" :
        bestBall.outcome + (bestBall.outcome === 1 ? " run" : " runs")) +
        " — " + capitalize(bestBall.timing === "missed" ? "loose" : bestBall.timing) +
        " release, " + LINE_NAME[bestBall.line]
      : bowling ? "No legal delivery" : "No bowling innings in Chase");
    byId("batting").hidden = true;
    byId("impact").hidden = true;
    result.hidden = false;
    nextPhase("result");
    byId("result-title").focus({ preventScroll: true });
  }

  function animateFeedback(elapsed) {
    const p = Math.min(1, elapsed / 650);
    if (!shot.extra && (bowling || shot.timing !== "missed")) {
      const swing = Math.sin(p * Math.PI);
      stage.bat.quaternion.copy(batHome);
      stage.bat.rotateX(1.8 * swing);
      stage.bat.rotateZ(.5 * SIDE[shot.direction] * swing);
      stage.batter.rotation.y = batterHome + .9 * swing;
    }
    if (shot.bowled) {
      const through = Math.min(elapsed / 160, 1);
      stage.ball.position.z = shot.origin.z - 2.65 * through;
      stage.ball.position.x = shot.origin.x * (1 - through);
      stage.ball.position.y = shot.origin.y - .40 * through;
      if (through === 1) stage.ball.visible = false;
      stage.stumps.quaternion.copy(stumpsHome);
      stage.stumps.rotateX(.43 * Math.min(Math.max(0, elapsed - 75) / 250, 1));
      stage.stumps.rotateZ(-.31 * Math.min(Math.max(0, elapsed - 75) / 250, 1));
    } else if (typeof shot.outcome === "number" && shot.outcome > 0 && p < 1) {
      stage.ball.position.set(shot.origin.x + SIDE[shot.direction] * 18 * p,
        shot.origin.y + Math.sin(Math.PI * p) * (shot.outcome === 6 ? 7 : 2.3),
        shot.origin.z + (shot.direction === "straight" ? 27 : 17) * p);
      stage.ball.rotation.x += .22;
    } else if (shot.timing === "missed" && p < .38) {
      stage.ball.position.z = shot.origin.z - 3 * p;
    } else stage.ball.visible = false;
  }

  function tick(elapsed) {
    if (phase === "ai" && elapsed >= pause(600)) {
      const ball = ai.deliveries[aiIndex++];
      scoreboard(ball.innings, true);
      const outcome = ball.outcome;
      if (outcome === "OUT") playSound("wicket");
      if (outcome === 4 || outcome === 6) playSound("cheer");
      byId("ai-line").textContent = logic.ballsToOvers(ball.innings.balls) + " · " +
        (outcome === "OUT" ? "Wicket" : outcome === "wide" || outcome === "no-ball" ? outcome : outcome + " runs");
      if (aiIndex === ai.deliveries.length) finishAi();
      else phaseStart = clock;
    } else if (phase === "ready") {
      const gap = GAP[settings.difficulty];
      const p = Math.min(elapsed / gap, 1);
      stage.bowler.position.z = bowlerHome.z + 1.8 * (1 - p);
      stage.bowler.position.y = bowlerHome.y + .065 * Math.abs(Math.sin(p * Math.PI * 4));
      stage.bowler.rotation.y = .09 * Math.sin(p * Math.PI * 4);
      if (p === 1) {
        if (bowling) {
          nextPhase("meter");
          byId("shot-timing").textContent = "Time your release";
          hitButton.disabled = false;
        } else release();
      }
    } else if (phase === "meter") {
      const progress = Math.min(elapsed / meterTime, 1);
      meterMarker.style.left = progress * 100 + "%";
      stage.bowler.rotation.y = .11 * Math.sin(progress * Math.PI);
      if (progress === 1) release("missed");
    } else if (phase === "flight") {
      const progress = elapsed / delivery.duration;
      placeBall(Math.min(1.15, progress));
      if (!delivery.bounced && progress >= .69) {
        delivery.bounced = true;
        playSound("bounce");
      }
      if (bowling && progress >= 1) completeBall(delivery.bowlTiming, progress);
      else if (elapsed >= delivery.duration + (delivery.extra ? 100 : timingWindow.late)) completeBall("missed", progress);
      else if (!delivery.extra && Math.abs(elapsed - delivery.duration) <= timingWindow.perfect &&
          byId("shot-timing").textContent !== "Strike zone") byId("shot-timing").textContent = "Strike zone";
    } else if (phase === "feedback") {
      animateFeedback(elapsed);
      if (elapsed >= pause(1360)) {
        if (logic.inningsEnded(innings, settings.overs, target ?? Infinity)) {
          if (settings.mode === "Defend" && !bowling) finishBatting();
          else finish();
        }
        else ready();
      }
    }
  }

  function requestFrame() {
    if (!frameId && !document.hidden && ["ai", "ready", "meter", "flight", "feedback"].includes(phase)) {
      frameId = requestAnimationFrame(frame);
    }
  }

  function frame(time) {
    frameId = 0;
    if (previousFrame !== null) clock += Math.min(64, Math.max(0, time - previousFrame));
    previousFrame = time;
    const animate = phase !== "ai";
    tick(clock - phaseStart);
    if (animate) stage.render();
    requestFrame();
  }

  skip.addEventListener("click", () => { if (phase === "ai") finishAi(); });
  start.addEventListener("click", () => {
    if (phase !== "target") return;
    if (settings.mode === "Defend") {
      bowling = true;
      innings = logic.newInnings();
      stage.setPlayerColors(true);
    }
    startInnings();
  });
  byId("replay").addEventListener("click", startMatch);
  for (const button of controls) button.addEventListener("click", () => choose(button.dataset.shot));
  canvas.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const third = Math.max(0, Math.min(2, Math.floor(3 * (event.clientX - rect.left) / rect.width)));
    choose(LINES[third]);
  });
  hitButton.addEventListener("pointerdown", event => { if (event.isPrimary && event.button === 0) hit(); });
  hitButton.addEventListener("click", event => { if (!event.detail) hit(); });
  document.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (button && button !== hitButton && button !== soundToggle) playSound("click");
  });
  document.addEventListener("keydown", event => {
    if (byId("batting").hidden || event.target === soundToggle || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === "Space") {
      event.preventDefault();
      if (!event.repeat) hit();
    } else if (ARROWS[event.key]) {
      event.preventDefault();
      choose(ARROWS[event.key]);
    }
  });
  document.addEventListener("visibilitychange", () => {
    previousFrame = null;
    if (document.hidden && frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    } else requestFrame();
  });
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    nextPhase("error");
    panel.hidden = true;
    result.hidden = true;
    byId("batting").hidden = true;
    byId("loading").hidden = false;
    byId("load-title").textContent = "3D graphics interrupted";
    byId("load-message").textContent = "Reload this page to retry or switch to the 2D game.";
  });
  startMatch();
}
