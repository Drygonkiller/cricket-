const LINES = ["off", "straight", "leg"];
const SIDE = { off: -1, straight: 0, leg: 1 };
const AIM = { off: "Cover", straight: "Straight", leg: "Leg" };
const ARROWS = { ArrowLeft: "off", ArrowDown: "straight", ArrowRight: "leg" };
const FLIGHT = { Easy: 1600, Normal: 1280, Hard: 1000 };
const GAP = { Easy: 1650, Normal: 1400, Hard: 1150 };
const TEAMS = {
  Nepal: "#ef5271", India: "#5a93ff", Pakistan: "#47c180",
  Bangladesh: "#20baa9", "Sri Lanka": "#9483ff", Australia: "#f7c750",
};
const CONTACT_Z = -8.73;
const RELEASE_Z = 10.66;
const byId = id => document.getElementById(id);

function settingsFromUrl() {
  const query = new URLSearchParams(location.search);
  const overs = Number(query.get("overs"));
  const difficulty = query.get("difficulty");
  const team = query.get("team");
  return {
    overs: [1, 2, 5].includes(overs) ? overs : 2,
    difficulty: Object.hasOwn(FLIGHT, difficulty) ? difficulty : "Normal",
    team: Object.hasOwn(TEAMS, team) ? team : "Nepal",
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
    if (!bowler || !batter || !bat || !ball) throw new Error("The stadium is missing animation parts");
    batter.traverse(child => {
      if (!child.isMesh) return;
      const tint = material => {
        if (material.name !== "Coral Jersey") return material;
        const next = material.clone();
        next.color.set(TEAMS[settings.team]);
        return next;
      };
      child.material = Array.isArray(child.material) ? child.material.map(tint) : tint(child.material);
    });
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
    return { bowler, batter, bat, ball, render };
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
  const bowlerHome = stage.bowler.position.clone();
  const batHome = stage.bat.quaternion.clone();
  const batterHome = stage.batter.rotation.y;
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

  byId("match-settings").textContent = settings.team + " · " + settings.overs +
    (settings.overs === 1 ? " over · " : " overs · ") + settings.difficulty;
  byId("loading").hidden = true;

  function scoreboard(score, aiBatting = false) {
    byId("score-label").textContent = aiBatting ? "AI score" : "Your score";
    byId("score").textContent = score.runs + "/" + score.wickets;
    byId("overs").textContent = logic.ballsToOvers(score.balls);
    byId("target").textContent = target ?? "—";
    const chase = target && !aiBatting ? logic.chaseInfo(score, settings.overs, target) : null;
    byId("needed").textContent = chase?.runsNeeded ?? "—";
    byId("balls-left").textContent = chase?.ballsLeft ?? "—";
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
    ai = logic.simulateInnings(settings.overs, settings.difficulty);
    aiIndex = 0;
    innings = logic.newInnings();
    target = null;
    choose("straight");
    result.hidden = true;
    panel.hidden = false;
    skip.hidden = false;
    start.hidden = true;
    byId("batting").hidden = true;
    byId("impact").hidden = true;
    byId("ai-title").textContent = "AI innings";
    byId("ai-line").textContent = "The AI is setting your target.";
    stage.bowler.position.copy(bowlerHome);
    stage.bowler.rotation.y = 0;
    stage.batter.rotation.y = batterHome;
    stage.bat.quaternion.copy(batHome);
    stage.ball.visible = false;
    scoreboard(logic.newInnings(), true);
    nextPhase("ai");
    byId("ai-title").focus({ preventScroll: true });
    stage.render();
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

  function ready() {
    nextPhase("ready");
    stage.bowler.position.copy(bowlerHome);
    stage.bowler.position.z += 1.8;
    stage.bowler.rotation.y = 0;
    stage.batter.rotation.y = batterHome;
    stage.bat.quaternion.copy(batHome);
    stage.ball.visible = false;
    hitButton.disabled = true;
    byId("impact").hidden = true;
    byId("shot-timing").textContent = "Bowler running in";
  }

  function release() {
    const line = LINES[Math.floor(Math.random() * LINES.length)];
    const extra = logic.rollExtra();
    delivery = { line, extra, duration: FLIGHT[settings.difficulty] * (.9 + Math.random() * .2),
      landingX: extra === "wide" ? (Math.random() < .5 ? -2.5 : 2.5) : SIDE[line] * .49 };
    stage.bowler.position.copy(bowlerHome);
    stage.bowler.rotation.y = -.24;
    stage.ball.visible = true;
    placeBall(0);
    hitButton.disabled = Boolean(extra);
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
    const outcome = delivery.extra ?? logic.scoreShot({ timing, line: delivery.line, direction, difficulty: settings.difficulty });
    placeBall(Math.max(0, Math.min(1.15, progress)));
    shot = { outcome, timing, direction, origin: stage.ball.position.clone() };
    innings = logic.recordBall(innings, outcome);
    scoreboard(innings);
    hitButton.disabled = true;
    const extra = outcome === "wide" || outcome === "no-ball";
    const badge = extra ? "+1 extra" : outcome === "OUT" ? "OUT" : outcome === 6 ? "SIX!"
      : outcome === 4 ? "FOUR!" : outcome === 0 ? "DOT BALL" : String(outcome);
    byId("impact").textContent = badge;
    byId("impact").hidden = false;
    byId("commentary").textContent = extra ? (outcome === "wide" ? "Wide" : "No-ball") + ". One run. Bowl again."
      : badge + " · " + (timing === "missed" ? "Missed" : timing[0].toUpperCase() + timing.slice(1) + " · " + AIM[direction]);
    byId("shot-timing").textContent = "Ball complete";
    nextPhase("feedback");
  }

  function hit() {
    if (phase !== "flight" || delivery.extra || document.hidden) return;
    const time = clock + (previousFrame === null ? 0 : Math.min(64, Math.max(0, performance.now() - previousFrame)));
    const elapsed = time - phaseStart;
    const timing = logic.classifyTiming(elapsed - delivery.duration, settings.difficulty);
    completeBall(timing, elapsed / delivery.duration);
  }

  function finish() {
    const outcome = logic.matchResult(innings.runs, target);
    byId("result-title").textContent = outcome;
    byId("result-score").textContent = "You " + innings.runs + "/" + innings.wickets +
      " · AI " + ai.innings.runs + "/" + ai.innings.wickets + " · Target " + target;
    byId("batting").hidden = true;
    byId("impact").hidden = true;
    result.hidden = false;
    nextPhase("result");
    byId("result-title").focus({ preventScroll: true });
  }

  function animateFeedback(elapsed) {
    const p = Math.min(1, elapsed / 650);
    if (shot.timing !== "missed") {
      const swing = Math.sin(p * Math.PI);
      stage.bat.quaternion.copy(batHome);
      stage.bat.rotateX(1.8 * swing);
      stage.bat.rotateZ(.5 * SIDE[shot.direction] * swing);
      stage.batter.rotation.y = batterHome + .9 * swing;
    }
    if (typeof shot.outcome === "number" && shot.outcome > 0 && p < 1) {
      stage.ball.position.set(shot.origin.x + SIDE[shot.direction] * 18 * p,
        shot.origin.y + Math.sin(Math.PI * p) * (shot.outcome === 6 ? 7 : 2.3),
        shot.origin.z + (shot.direction === "straight" ? 27 : 17) * p);
      stage.ball.rotation.x += .22;
    } else if (shot.timing === "missed" && p < .38) {
      stage.ball.position.z = shot.origin.z - 3 * p;
    } else stage.ball.visible = false;
  }

  function tick(elapsed) {
    if (phase === "ai" && elapsed >= 600) {
      const ball = ai.deliveries[aiIndex++];
      scoreboard(ball.innings, true);
      const outcome = ball.outcome;
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
      if (p === 1) release();
    } else if (phase === "flight") {
      const window = logic.timingWindow(settings.difficulty);
      placeBall(Math.min(1.15, elapsed / delivery.duration));
      if (elapsed >= delivery.duration + (delivery.extra ? 100 : window.late)) completeBall("missed", elapsed / delivery.duration);
      else if (!delivery.extra && Math.abs(elapsed - delivery.duration) <= window.perfect &&
          byId("shot-timing").textContent !== "Strike zone") byId("shot-timing").textContent = "Strike zone";
    } else if (phase === "feedback") {
      animateFeedback(elapsed);
      if (elapsed >= 1360) {
        if (logic.inningsEnded(innings, settings.overs, target)) finish();
        else ready();
      }
    }
  }

  function requestFrame() {
    if (!frameId && !document.hidden && ["ai", "ready", "flight", "feedback"].includes(phase)) {
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
    panel.hidden = true;
    byId("batting").hidden = false;
    byId("commentary").textContent = "Tap HIT as the ball reaches the gold line.";
    scoreboard(innings);
    previousFrame = null;
    ready();
    controls[1].focus({ preventScroll: true });
    requestFrame();
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
  document.addEventListener("keydown", event => {
    if (byId("batting").hidden || event.altKey || event.ctrlKey || event.metaKey) return;
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
