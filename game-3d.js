import { connectMatchAudio } from "./match-audio-3d.js";
import { addCrowd, createBallTrail, lightStadium, pivotBowlerArm } from "./stadium-3d-effects.js";

const LINES = ["off", "straight", "leg"];
const SIDE = { off: -1, straight: 0, leg: 1 };
const AIM = { off: "Cover", straight: "Straight", leg: "Leg" };
const ARROWS = { ArrowLeft: "off", ArrowDown: "straight", ArrowRight: "leg" };
const FLIGHT = { Easy: 1600, Normal: 1280, Hard: 910 };
const GAP = { Easy: 1650, Normal: 1400, Hard: 1150 };
const METER_TIME = { Easy: 1800, Normal: 1500, Hard: 1250 };
const AI_ACTION = { off: "drives through cover", straight: "hits straight", leg: "pulls to leg" };
const LINE_NAME = { off: "off side", straight: "straight", leg: "leg side" };
const SHOT_PATH = { off: "through covers", straight: "down the ground", leg: "to leg" };
const SWINGS = {
  off: { back: [-.52, -.42, -.20], contact: [1.05, -.66, -.51], follow: [1.9, -1.06, -.80], turn: -.48 },
  straight: { back: [-.68, .05, .08], contact: [1.36, .10, -.02], follow: [2.46, .21, .18], turn: .16 },
  leg: { back: [-.36, -.65, .63], contact: [.72, .88, 1.08], follow: [1.27, 1.91, 1.11], turn: 1.12 },
};
const TIMING_RANK = { missed: 0, early: 1, late: 1, good: 2, perfect: 3 };
const STORAGE_PREFIX = "super-over-smash:";
const TEAMS = {
  Nepal: "#ef5271", India: "#5a93ff", Pakistan: "#47c180",
  Bangladesh: "#20baa9", "Sri Lanka": "#9483ff", Australia: "#f7c750",
};
const CONTACT_Z = -8.73;
const HANDOVER = 300;
const SLOW_TIME = 600;
const SLOW_SCALE = .35;
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
    lighting: (query.get("lighting") ?? readStorage("lighting-3d", "Day")) === "Dusk" ? "Dusk" : "Day",
  };
}

async function loadStadium(settings) {
  const [THREE, { GLTFLoader }] = await Promise.all([
    import("three"),
    import("three/addons/loaders/GLTFLoader.js"),
  ]);
  const canvas = byId("stadium");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio < 2, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  const scene = new THREE.Scene();
  const setLighting = lightStadium(THREE, renderer, scene);
  const camera = new THREE.PerspectiveCamera(43, 1, .05, 140);
  const cameraHome = new THREE.Vector3();
  const cameraAim = new THREE.Vector3(0, .92, -7.6);

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
    let lensMaterial;
    gltf.scene.traverse(mesh => {
      if (!mesh.isMesh) return;
      if (mesh.material.name === "Lamp Ivory") lensMaterial = mesh.material;
      if (/^(Turf|Pitch)/.test(mesh.parent.name) || /^(Turf|Pitch)/.test(mesh.name)) mesh.receiveShadow = true;
    });
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
    const { arm, handPosition } = pivotBowlerArm(THREE, bowler);
    for (const object of [bowler, batter, stumps, gltf.scene.getObjectByName("Stumps_Bowler")]) {
      object?.traverse(mesh => { if (mesh.isMesh) mesh.castShadow = true; });
    }
    const moveFlags = addCrowd(THREE, scene);
    const trail = createBallTrail(THREE, scene, camera);
    setLighting(settings.lighting, lensMaterial);
    const render = () => renderer.render(scene, camera);
    const setShake = (x, y) => {
      camera.position.copy(cameraHome);
      camera.position.x += x;
      camera.position.y += y;
    };
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      const portrait = camera.aspect < 1.15;
      camera.fov = portrait ? 56 : 45;
      cameraHome.set(portrait ? 2.65 : 3.8, 5.4, portrait ? 20.8 : 18.3);
      camera.position.copy(cameraHome);
      camera.lookAt(cameraAim);
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2, Math.sqrt(1150000 / (width * height))));
      renderer.setSize(width, height, false);
      render();
    };
    new ResizeObserver(resize).observe(canvas);
    resize();
    return { bowler, batter, bat, ball, stumps, arm, handPosition, moveFlags, trail, setShake, setPlayerColors, render,
      changeLighting: look => { setLighting(look, lensMaterial); render(); } };
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
  const battingMeter = byId("batting-timing");
  const battingMarker = battingMeter.querySelector(".timing-marker");
  const timingValue = byId("timing-value");
  const lighting = byId("lighting");
  const impact = byId("impact");
  const confetti = byId("win-confetti");
  const frameRate = byId("frame-rate");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const showFrameRate = new URLSearchParams(location.search).get("fps") === "1";
  frameRate.hidden = !showFrameRate;
  const meterTime = METER_TIME[settings.difficulty];
  const timingWindow = logic.timingWindow(settings.difficulty);
  const bowlerHome = stage.bowler.position.clone();
  const ballRelease = stage.ball.position.clone();
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
  let confettiTimer;
  let fpsTime = 0;
  let fpsFrames = 0;

  byId("match-settings").textContent = settings.mode + " · " + settings.team + " · " + settings.overs +
    (settings.overs === 1 ? " over · " : " overs · ") + settings.difficulty;
  byId("loading").hidden = true;
  lighting.value = settings.lighting;
  lighting.addEventListener("change", () => {
    writeStorage("lighting-3d", lighting.value);
    stage.changeLighting(lighting.value);
  });
  for (const [id, halfWidth] of [["meter-good", timingWindow.good], ["meter-perfect", timingWindow.perfect]]) {
    const fraction = halfWidth * 100 / meterTime;
    byId(id).style.left = (50 - fraction) + "%";
    byId(id).style.width = fraction * 2 + "%";
  }
  for (const label of ["good", "perfect"]) {
    const zone = battingMeter.querySelector(".timing-" + label);
    const fraction = 38 * timingWindow[label] / timingWindow.early;
    zone.style.left = (50 - fraction) + "%";
    zone.style.width = fraction * 2 + "%";
  }

  function showTiming(offset, label, timing = "") {
    const position = offset < -timingWindow.early
      ? 12 * (offset + delivery.duration) / (delivery.duration - timingWindow.early)
      : 50 + 38 * offset / timingWindow.early;
    battingMarker.style.left = Math.max(0, Math.min(100, position)) + "%";
    if (timingValue.textContent !== label) timingValue.textContent = label;
    timingValue.dataset.timing = timing;
  }

  function celebrateWin() {
    if (reducedMotion.matches) return;
    const colors = ["#c7f047", "#f8c15a", "#79dbff", "#ff8099", "#fdf3c9"];
    const burst = document.createDocumentFragment();
    for (let i = 0; i < 32; i++) {
      const piece = document.createElement("i");
      const angle = i * 2.4;
      const reach = 70 + i % 6 * 22;
      const dx = Math.cos(angle) * reach;
      const dy = Math.sin(angle) * reach;
      piece.style.setProperty("--color", colors[i % colors.length]);
      piece.style.setProperty("--x-mid", dx + "px");
      piece.style.setProperty("--y-mid", (dy - 70) + "px");
      piece.style.setProperty("--x-end", (dx * 1.46) + "px");
      piece.style.setProperty("--y-end", (dy * .46 + 120) + "px");
      piece.style.setProperty("--turn-mid", (i * 42) + "deg");
      piece.style.setProperty("--turn-end", (i * 79) + "deg");
      piece.style.setProperty("--duration", (930 + i % 7 * 46) + "ms");
      burst.append(piece);
    }
    confetti.replaceChildren(burst);
    confetti.hidden = false;
    confettiTimer = setTimeout(() => { confetti.hidden = true; confetti.replaceChildren(); }, 1250);
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
    clearTimeout(confettiTimer);
    confetti.hidden = true;
    confetti.replaceChildren();
    stage.arm.rotation.set(0, 0, 0);
    stage.setShake(0, 0);
    stage.trail.clear();
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
    impact.hidden = true;
    battingMeter.hidden = true;
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
    battingMeter.hidden = bowling;
    choose("straight");
    byId("commentary").textContent = bowling ? "Pick your line and bowl in the green zone."
      : "Tap HIT in the green zone or as the ball reaches the gold line.";
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
    impact.hidden = true;
    battingMeter.hidden = true;
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
    stage.arm.rotation.set(0, 0, 0);
    stage.setShake(0, 0);
    stage.trail.clear();
    stage.batter.rotation.y = batterHome;
    stage.bat.quaternion.copy(batHome);
    stage.stumps.quaternion.copy(stumpsHome);
    meterMarker.style.left = "0%";
    battingMarker.style.left = "0%";
    timingValue.textContent = "Ready";
    timingValue.dataset.timing = "";
    stage.ball.visible = false;
    hitButton.disabled = true;
    impact.hidden = true;
    byId("shot-timing").textContent = "Bowler running in";
  }

  function beginDelivery(bowlTiming) {
    const line = bowling ? direction : LINES[Math.floor(Math.random() * LINES.length)];
    const extra = logic.rollExtra();
    delivery = { line, extra, bowlTiming, bounced: false, duration: FLIGHT[settings.difficulty] * (.9 + Math.random() * .2),
      aiShot: bowling && !extra ? logic.pickAiShot(settings.difficulty) : null,
      landingX: extra === "wide" ? (Math.random() < .5 ? -2.5 : 2.5) : SIDE[line] * .49 };
    stage.bowler.position.copy(bowlerHome);
    hitButton.disabled = true;
    byId("shot-timing").textContent = "Arm coming over";
    nextPhase("release");
  }

  function release() {
    stage.handPosition(ballRelease);
    stage.ball.visible = true;
    placeBall(0);
    hitButton.disabled = bowling || Boolean(delivery.extra);
    byId("shot-timing").textContent = delivery.extra ? "Extra delivery" : "Ball released";
    nextPhase("flight");
  }

  function placeBall(t) {
    const bounce = .69;
    const y = t <= bounce ? ballRelease.y - (ballRelease.y - .13) * Math.pow(t / bounce, 1.25)
      : .16 + .56 * Math.sin(Math.min((t - bounce) / .53, 1) * Math.PI * .95);
    stage.ball.position.set(ballRelease.x + (delivery.landingX - ballRelease.x) * t, y,
      ballRelease.z + (CONTACT_Z - ballRelease.z) * t);
    stage.ball.rotation.x = t * 11;
  }

  function completeBall(timing, progress, pressed = false) {
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
    const winningShot = !bowling && settings.mode === "Chase" && !extra && outcome > 0 && innings.runs >= target;
    shot.slow = outcome === "OUT" || winningShot;
    shot.shake = !reducedMotion.matches && (outcome === 6 || outcome === "OUT");
    scoreboard(innings);
    hitButton.disabled = true;
    const badge = extra ? "+1 extra" : outcome === "OUT" ? "OUT" : outcome === 6 ? "SIX!"
      : outcome === 4 ? "FOUR!" : outcome === 0 ? "DOT BALL" : String(outcome);
    impact.dataset.outcome = outcome;
    impact.textContent = badge;
    impact.hidden = false;
    if (!bowling) {
      const offset = (progress - 1) * delivery.duration;
      const label = extra ? "Extra"
        : pressed && timing === "missed" ? (offset < 0 ? "Too early" : "Too late")
        : capitalize(timing);
      showTiming(offset, label, extra ? "" : timing);
    }
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
      meterMarker.style.left = Math.min(100, elapsed * 100 / meterTime) + "%";
      beginDelivery(timing);
      return;
    }
    const timing = logic.classifyTiming(elapsed - delivery.duration, settings.difficulty);
    completeBall(timing, elapsed / delivery.duration, true);
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
    battingMeter.hidden = true;
    impact.hidden = true;
    result.hidden = false;
    if (outcome === "Win") celebrateWin();
    nextPhase("result");
    byId("result-title").focus({ preventScroll: true });
  }

  function animateFeedback(elapsed) {
    const slowElapsed = shot.slow ? Math.min(elapsed, SLOW_TIME) * (1 - SLOW_SCALE) : 0;
    if (shot.shake && elapsed < 350) {
      const amount = .14 * (1 - elapsed / 350);
      stage.setShake(amount * Math.sin(elapsed * .058), amount * .45 * Math.sin(elapsed * .082));
    } else stage.setShake(0, 0);
    elapsed -= slowElapsed;
    const p = Math.min(1, elapsed / 650);
    if (!shot.extra && (bowling || shot.timing !== "missed")) {
      const swing = SWINGS[shot.direction];
      const start = p < .14 ? swing.back : p < .54 ? swing.contact : swing.follow;
      const end = p < .14 ? swing.contact : p < .54 ? swing.follow : [0, 0, 0];
      const t = p < .14 ? p / .14 : p < .54 ? (p - .14) / .40 : (p - .54) / .46;
      const ease = t * t * (3 - 2 * t);
      const x = start[0] + (end[0] - start[0]) * ease;
      const y = start[1] + (end[1] - start[1]) * ease;
      const z = start[2] + (end[2] - start[2]) * ease;
      stage.bat.quaternion.copy(batHome);
      stage.bat.rotateY(y);
      stage.bat.rotateX(x);
      stage.bat.rotateZ(z);
      stage.batter.rotation.y = batterHome + swing.turn * Math.sin(p * Math.PI);
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
      stage.arm.rotation.x = .27 * Math.sin(p * Math.PI * 4);
      if (p === 1) {
        if (bowling) {
          nextPhase("meter");
          byId("shot-timing").textContent = "Time your release";
          hitButton.disabled = false;
        } else beginDelivery();
      }
    } else if (phase === "meter") {
      const progress = Math.min(elapsed / meterTime, 1);
      meterMarker.style.left = progress * 100 + "%";
      stage.bowler.rotation.y = .11 * Math.sin(progress * Math.PI);
      stage.arm.rotation.x = .44 * progress;
      if (progress === 1) beginDelivery("missed");
    } else if (phase === "release") {
      const p = Math.min(elapsed / HANDOVER, 1);
      stage.bowler.rotation.y = -.23 * p;
      stage.arm.rotation.x = p < .28 ? .44 + p * 10.93 : 3.5 - (p - .28) * 3.4;
      stage.arm.rotation.z = .64 * Math.sin(p * Math.PI * .65);
      if (p === 1) release();
    } else if (phase === "flight") {
      const progress = elapsed / delivery.duration;
      const follow = Math.min(elapsed / 240, 1);
      stage.arm.rotation.x = 1.052 - 2.85 * follow * (2 - follow);
      stage.arm.rotation.z = .57 * (1 - follow);
      stage.bowler.rotation.y = -.23 + .36 * follow;
      placeBall(Math.min(1.15, progress));
      if (!delivery.bounced && progress >= .69) {
        delivery.bounced = true;
        playSound("bounce");
      }
      if (bowling && progress >= 1) completeBall(delivery.bowlTiming, progress);
      else if (elapsed >= delivery.duration + (delivery.extra ? 100 : timingWindow.late)) completeBall("missed", progress);
      else if (!bowling) {
        const offset = elapsed - delivery.duration;
        const timing = logic.classifyTiming(offset, settings.difficulty);
        if (timing === "perfect" && !delivery.extra && byId("shot-timing").textContent !== "Strike zone") {
          byId("shot-timing").textContent = "Strike zone";
        }
        showTiming(offset, delivery.extra ? "Extra" : timing === "missed" ? "Approaching" : capitalize(timing), timing);
      }
    } else if (phase === "feedback") {
      animateFeedback(elapsed);
      const minimum = shot.slow ? 650 + SLOW_TIME * (1 - SLOW_SCALE) : 650;
      if (elapsed >= Math.max(minimum, pause(1360))) {
        if (logic.inningsEnded(innings, settings.overs, target ?? Infinity)) {
          if (settings.mode === "Defend" && !bowling) finishBatting();
          else finish();
        }
        else ready();
      }
    }
  }

  function requestFrame() {
    if (!frameId && !document.hidden && ["ai", "ready", "meter", "release", "flight", "feedback"].includes(phase)) {
      frameId = requestAnimationFrame(frame);
    }
  }

  function frame(time) {
    frameId = 0;
    if (previousFrame !== null) {
      const elapsed = Math.max(0, time - previousFrame);
      clock += Math.min(64, elapsed);
      if (showFrameRate && phase !== "ai") {
        fpsTime += elapsed;
        fpsFrames++;
        if (fpsTime >= 1000) {
          frameRate.value = Math.round(1000 * fpsFrames / fpsTime) + " fps";
          fpsTime = 0;
          fpsFrames = 0;
        }
      }
    }
    previousFrame = time;
    tick(clock - phaseStart);
    if (!reducedMotion.matches) stage.moveFlags(clock);
    stage.trail.update(stage.ball, clock);
    stage.render();
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
    if (byId("batting").hidden || event.target === soundToggle || event.target === lighting ||
        event.altKey || event.ctrlKey || event.metaKey) return;
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
    fpsTime = 0;
    fpsFrames = 0;
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
    battingMeter.hidden = true;
    byId("loading").hidden = false;
    byId("load-title").textContent = "3D graphics interrupted";
    byId("load-message").textContent = "Reload this page to retry or switch to the 2D game.";
  });
  startMatch();
}
