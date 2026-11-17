(function () {
  "use strict";

  const logic = globalThis.SuperOverLogic;
  const byId = (id) => document.getElementById(id);
  const ui = {
    home: byId("home"), setup: byId("setup"), match: byId("match"), help: byId("help-link"),
    label: byId("match-label"), ai: byId("ai-screen"), bat: byId("bat-screen"), result: byId("result-screen"),
    scoreLabel: byId("score-label"), score: byId("score"), wickets: byId("wickets"),
    overs: byId("overs"), target: byId("target"), needed: byId("needed"), rate: byId("rate"),
    aiTitle: byId("ai-title"), aiStatus: byId("ai-status"), indicator: byId("ai-indicator"),
    ticker: byId("ai-ticker"), skip: byId("skip"), startChase: byId("start-chase"),
    chaseLine: byId("chase-line"), aim: byId("aim-tag"), tag: byId("delivery-tag"),
    impact: byId("impact"), impactValue: byId("impact-value"), impactLabel: byId("impact-label"),
    hit: byId("hit"), commentary: byId("commentary"), resultTitle: byId("result-title"),
    resultSummary: byId("result-summary"), resultMark: byId("result-mark"),
    resultScore: byId("result-score"), resultTarget: byId("result-target"),
    high: byId("high-score"), last: byId("last-result"), pitch: byId("pitch"), hero: byId("hero-art"),
    directions: [...document.querySelectorAll("[data-direction]")],
  };
  const TEAMS = {
    Nepal: "#ef5271", India: "#5a93ff", Pakistan: "#47c180",
    Bangladesh: "#20baa9", "Sri Lanka": "#9483ff", Australia: "#f7c750",
  };
  const DIRECTIONS = ["off", "straight", "leg"];
  const DIRECTION_NAME = { off: "Cover", straight: "Straight", leg: "Leg" };
  const LINE_NAME = { off: "off side", straight: "straight", leg: "leg side" };
  const SIDE = { off: -1, straight: 0, leg: 1 };
  const ARROWS = { ArrowLeft: "off", ArrowDown: "straight", ArrowRight: "leg" };
  const FLIGHT = { Easy: 1600, Normal: 1280, Hard: 1000 };
  const DELIVERY_GAP = { 1: 1100, 2: 2200, 5: 1000 };
  const FEEDBACK_TIME = { 1: 2450, 2: 4350, 5: 2150 };
  const AI_INTERVAL = 600;
  const STORAGE_PREFIX = "super-over-smash:";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const pitchCtx = ui.pitch.getContext("2d", { alpha: false });
  const heroCtx = ui.hero.getContext("2d", { alpha: false });
  const backdrop = document.createElement("canvas");
  const backdropCtx = backdrop.getContext("2d", { alpha: false });

  let screen = "home";
  let settings;
  let ai;
  let aiIndex;
  let nextAiBall;
  let chase;
  let target;
  let direction = "straight";
  let delivery;
  let phase;
  let phaseStart;
  let feedback;
  let frameId = 0;
  let lastFrame = null;
  let clock = 0;
  let pitch;

  function readStorage(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_PREFIX + key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    } catch {
      // The match can still be played when browser storage is unavailable.
    }
  }

  function showRecords() {
    const high = readStorage("high-score", null);
    const last = readStorage("last-result", null);
    ui.high.textContent = Number.isFinite(high) ? high + " runs" : "—";
    ui.last.textContent = last ? last.result + " · " + last.runs + "/" + last.wickets : "—";
  }

  function showScreen(next) {
    const enteringMatch = screen === "home" && next !== "home";
    screen = next;
    ui.home.hidden = next !== "home";
    ui.match.hidden = next === "home";
    ui.ai.hidden = next !== "ai" && next !== "target";
    ui.bat.hidden = next !== "bat";
    ui.result.hidden = next !== "result";
    ui.help.hidden = next !== "home";
    ui.label.hidden = next === "home";
    document.body.classList.toggle("in-match", next !== "home");
    if (enteringMatch || next === "home" || next === "result") window.scrollTo(0, 0);
  }

  function updateScoreboard(innings, isAi = false, isFinished = false) {
    ui.scoreLabel.textContent = isAi ? "AI score" : "Score";
    ui.score.textContent = innings.runs;
    ui.wickets.textContent = innings.wickets;
    ui.overs.textContent = logic.ballsToOvers(innings.balls);
    ui.target.textContent = target ?? "—";
    if (isAi) {
      ui.needed.textContent = target ?? "—";
      return;
    }
    const { runsNeeded, ballsLeft, rate } = logic.chaseInfo(innings, settings.overs, target);
    ui.needed.textContent = runsNeeded;
    const balls = ballsLeft + (ballsLeft === 1 ? " ball" : " balls");
    ui.chaseLine.textContent = runsNeeded ? runsNeeded + " needed off " + balls : "Target reached";
    ui.rate.textContent = rate === null || isFinished ? "—" : rate.toFixed(2);
  }

  function startMatch(newSettings) {
    settings = newSettings;
    ai = logic.simulateInnings(settings.overs, settings.difficulty);
    aiIndex = 0;
    target = null;
    chase = logic.newInnings();
    direction = "straight";
    delivery = null;
    phase = null;
    feedback = null;
    clock = 0;
    lastFrame = null;
    nextAiBall = AI_INTERVAL;
    const overs = settings.overs === 1 ? "1 over" : settings.overs + " overs";
    ui.label.textContent = settings.team + " · " + overs + " · " + settings.difficulty;
    ui.aiTitle.textContent = "AI innings";
    ui.indicator.textContent = "Live";
    ui.aiStatus.textContent = "The AI is setting your target.";
    ui.ticker.replaceChildren();
    ui.skip.hidden = false;
    ui.startChase.hidden = true;
    updateScoreboard(logic.newInnings(), true);
    showScreen("ai");
    ui.aiTitle.focus({ preventScroll: true });
    requestFrame();
  }

  function describeAi(outcome) {
    if (outcome === "wide") return ["WD", "Wide. One extra run."];
    if (outcome === "no-ball") return ["NB", "No-ball. One extra run."];
    if (outcome === "OUT") return ["OUT", "Wicket for the bowling side."];
    if (outcome === 6) return ["6", "Over the rope for six."];
    if (outcome === 4) return ["4", "Four to the boundary."];
    if (outcome === 0) return ["•", "Dot ball."];
    return [String(outcome), outcome === 1 ? "A quick single." : outcome + " runs."];
  }

  function addTickerRow({ outcome, innings }) {
    const [badge, description] = describeAi(outcome);
    const row = document.createElement("li");
    const ball = document.createElement("time");
    const marker = document.createElement("b");
    const copy = document.createElement("span");
    ball.textContent = logic.ballsToOvers(innings.balls);
    marker.textContent = badge;
    if (outcome === 6 || outcome === 4) marker.className = "boundary";
    if (outcome === "OUT") marker.className = "wicket";
    copy.textContent = description;
    row.append(ball, marker, copy);
    ui.ticker.prepend(row);
    if (ui.ticker.childElementCount > 6) ui.ticker.lastElementChild.remove();
  }

  function finishAi(focusButton = false) {
    const moveFocus = focusButton || document.activeElement === ui.skip || document.activeElement === ui.aiTitle;
    target = ai.innings.runs + 1;
    showScreen("target");
    updateScoreboard(ai.innings, true);
    ui.aiTitle.textContent = "Target: " + target;
    ui.indicator.textContent = "Complete";
    ui.aiStatus.textContent = "Target: " + target + " — You need " + target + " in " +
      settings.overs + (settings.overs === 1 ? " over." : " overs.");
    ui.skip.hidden = true;
    ui.startChase.hidden = false;
    if (moveFocus) ui.startChase.focus({ preventScroll: true });
  }

  function skipAi() {
    if (screen !== "ai") return;
    for (; aiIndex < ai.deliveries.length; aiIndex += 1) addTickerRow(ai.deliveries[aiIndex]);
    finishAi(true);
  }

  function tickAi() {
    if (clock < nextAiBall) return;
    nextAiBall = clock + AI_INTERVAL;
    const ball = ai.deliveries[aiIndex++];
    addTickerRow(ball);
    updateScoreboard(ball.innings, true);
    if (aiIndex === ai.deliveries.length) finishAi();
  }

  function aim(next) {
    direction = next;
    ui.aim.textContent = DIRECTION_NAME[next];
    for (const button of ui.directions) button.setAttribute("aria-pressed", String(button.dataset.direction === next));
  }

  function startChase() {
    if (screen !== "target") return;
    showScreen("bat");
    aim("straight");
    updateScoreboard(chase);
    ui.commentary.textContent = "Watch the ball. Hit as it reaches the gold line.";
    ui.directions[1].focus({ preventScroll: true });
    sizePitch();
    readyDelivery();
    drawPitch();
    requestFrame();
  }

  function readyDelivery() {
    phase = "ready";
    phaseStart = clock;
    ui.impact.hidden = true;
    ui.tag.textContent = "Bowler ready";
    ui.hit.disabled = true;
    delivery = null;
    feedback = null;
  }

  function bowl() {
    const line = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
    const extra = logic.rollExtra();
    const swing = !extra && Math.random() < .19;
    const startSide = swing ? SIDE[line] - (SIDE[line] || (Math.random() < .5 ? -1 : 1)) : SIDE[line];
    delivery = {
      line, extra, startSide, swing,
      landingSide: extra === "wide" ? (Math.random() < .5 ? -2.7 : 2.7) : SIDE[line],
      duration: FLIGHT[settings.difficulty] * (.89 + Math.random() * .22),
    };
    phase = "ball";
    phaseStart = clock;
    ui.hit.disabled = Boolean(extra);
    ui.tag.textContent = extra === "wide" ? "Wide" : extra === "no-ball" ? "No-ball" : "Ball released";
  }

  function ballProgress(time = clock) {
    return (time - phaseStart) / delivery.duration;
  }

  function settleBall(timing, time = clock) {
    const { line, extra } = delivery;
    const outcome = extra ?? logic.scoreShot({ timing, line, direction, difficulty: settings.difficulty });
    const playedDirection = direction;
    const launchProgress = Math.min(1.12, ballProgress(time));
    chase = logic.recordBall(chase, outcome);
    phase = "feedback";
    phaseStart = clock;
    feedback = { outcome, timing, direction: playedDirection, launchProgress };
    ui.hit.disabled = true;
    ui.tag.textContent = extra ? "Extra delivery" : "Ball complete";
    const [value, label, message] = playerCommentary(outcome, timing, line, playedDirection);
    ui.impactValue.textContent = value;
    ui.impactLabel.textContent = label;
    ui.impact.hidden = false;
    const over = logic.ballsToOvers(chase.balls);
    ui.commentary.textContent = (extra ? "Extra" : over) + " · " + message;
    updateScoreboard(chase);
  }

  function playerCommentary(outcome, timing, line, playedDirection) {
    if (outcome === "wide") return ["+1", "Wide", "Wide ball. One extra and the delivery is rebowled."];
    if (outcome === "no-ball") return ["+1", "No-ball", "No-ball. One extra and the delivery is rebowled."];
    if (outcome === "OUT") {
      return timing === "missed"
        ? ["OUT", "Bowled", "Bowled. The ball hit the stumps."]
        : ["OUT", "Edged", "An edge takes your wicket."];
    }
    if (outcome === 0) return ["0", "Dot ball", "Missed on the " + LINE_NAME[line] + ". No run."];
    const shot = DIRECTION_NAME[playedDirection];
    if (outcome === 6) return ["SIX!", "Perfect timing", "Perfect " + shot.toLowerCase() + " shot. Six runs!"];
    if (outcome === 4) return ["FOUR!", "Boundary", "Perfect timing sends it to the " + shot.toLowerCase() + " boundary."];
    if (timing === "early" || timing === "late") return ["1", timing, "A " + timing + " swing for a single."];
    return [String(outcome), "Good timing", shot + " shot for " + outcome + (outcome === 1 ? " run." : " runs.")];
  }

  function hit() {
    if (screen !== "bat" || document.hidden || phase !== "ball" || delivery.extra) return;
    const sinceFrame = lastFrame === null ? 0 : Math.min(64, Math.max(0, performance.now() - lastFrame));
    const time = clock + sinceFrame;
    const timing = logic.classifyTiming(time - phaseStart - delivery.duration, settings.difficulty);
    settleBall(timing, time);
  }

  function tickChase() {
    const elapsed = clock - phaseStart;
    if (phase === "ready") {
      if (elapsed >= DELIVERY_GAP[settings.overs]) bowl();
    } else if (phase === "ball") {
      const timeout = delivery.extra ? 100 : logic.timingWindow(settings.difficulty).late;
      if (elapsed > delivery.duration + timeout) settleBall("missed");
      else if (!delivery.extra && ui.tag.textContent === "Ball released" &&
          Math.abs(elapsed - delivery.duration) <= logic.timingWindow(settings.difficulty).perfect) {
        ui.tag.textContent = "Strike zone";
      }
    } else if (phase === "feedback") {
      const finished = logic.inningsEnded(chase, settings.overs, target);
      const extra = feedback.outcome === "wide" || feedback.outcome === "no-ball";
      const delay = finished ? 1450 : extra ? 1200 : FEEDBACK_TIME[settings.overs];
      if (elapsed < delay) return;
      if (finished) finishChase();
      else readyDelivery();
    }
  }

  function finishChase() {
    const result = logic.matchResult(chase.runs, target);
    const previous = readStorage("high-score", 0);
    writeStorage("high-score", Math.max(Number.isFinite(previous) ? previous : 0, chase.runs));
    writeStorage("last-result", { result, runs: chase.runs, wickets: chase.wickets, target });
    ui.result.dataset.outcome = result;
    ui.resultTitle.textContent = result;
    ui.resultMark.textContent = result === "Win" ? "✓" : result === "Tie" ? "=" : "×";
    ui.resultScore.textContent = chase.runs + "/" + chase.wickets;
    ui.resultTarget.textContent = target;
    const short = target - 1 - chase.runs;
    ui.resultSummary.textContent = result === "Win" ? settings.team + " chased down the target."
      : result === "Tie" ? "Both sides scored " + chase.runs + "."
      : "The AI won by " + short + (short === 1 ? " run." : " runs.");
    updateScoreboard(chase, false, true);
    showScreen("result");
    ui.resultTitle.focus({ preventScroll: true });
  }

  function active() {
    return screen === "ai" || screen === "bat";
  }

  function frame(timestamp) {
    frameId = 0;
    if (document.hidden || !active()) return;
    if (lastFrame !== null) clock += Math.min(64, Math.max(0, timestamp - lastFrame));
    lastFrame = timestamp;
    if (screen === "ai") tickAi();
    else {
      tickChase();
      if (screen === "bat") drawPitch();
    }
    requestFrame();
  }

  function requestFrame() {
    if (!frameId && active() && !document.hidden) frameId = requestAnimationFrame(frame);
  }

  function sizeCanvas(canvas, ctx) {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return null;
    const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
    const pixelsWide = Math.round(width * ratio);
    const pixelsHigh = Math.round(height * ratio);
    canvas.width = pixelsWide;
    canvas.height = pixelsHigh;
    ctx.setTransform(pixelsWide / width, 0, 0, pixelsHigh / height, 0, 0);
    return { width, height };
  }

  function polygon(ctx, fill, points) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fill();
  }

  function oval(ctx, fill, x, y, radiusX, radiusY = radiusX) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function stroke(ctx, fill, width, x1, y1, x2, y2) {
    ctx.strokeStyle = fill;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function crowd(ctx, width, top, depth, step) {
    const colors = ["#6b9377", "#5c7668", "#98a378", "#2d5048", "#d49e76", "#4b756f"];
    for (let row = 0; row < 5; row += 1) {
      for (let x = 3; x < width; x += step) {
        const offset = (x * 13 + row * 17) % 9;
        oval(ctx, colors[(Math.floor(x / step) * 11 + row * 3 + offset) % colors.length],
          x + offset / 2, top + (row + .5) * depth / 5, .9 + offset / 12, .85);
      }
    }
  }

  function lamp(ctx, x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    const glow = ctx.createRadialGradient(0, 0, 3, 0, 0, 50);
    glow.addColorStop(0, "#e8fc98a8");
    glow.addColorStop(1, "#c9f36e00");
    oval(ctx, glow, 0, 0, 50);
    stroke(ctx, "#56756a", 2.5, 0, 3, 0, 62);
    ctx.fillStyle = "#33594b";
    ctx.fillRect(-17, -8, 34, 16);
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        ctx.fillStyle = "#edf9b6";
        ctx.fillRect(-14 + col * 6, -5 + row * 6, 4, 4);
      }
    }
    ctx.restore();
  }

  function drawHero() {
    const size = sizeCanvas(ui.hero, heroCtx);
    if (!size) return;
    const { width: w, height: h } = size;
    const ctx = heroCtx;
    const sky = ctx.createLinearGradient(0, 0, w, h);
    sky.addColorStop(0, "#122c27");
    sky.addColorStop(.67, "#27745d");
    sky.addColorStop(1, "#92a575");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    const horizon = h * .61;
    for (let i = 0; i < 8; i += 1) {
      stroke(ctx, "#d3ed9822", 1, w * (.69 + i * .035), h * (.01 + i * .025), w * (.36 + i * .05), horizon);
    }
    lamp(ctx, w * .84, h * .21, Math.max(.53, h / 340));
    lamp(ctx, w * .97, h * .38, .67);
    polygon(ctx, "#345c4f", [[0, horizon - 26], [w * .47, horizon - 11], [w, horizon - 54], [w, horizon + 23], [0, horizon + 23]]);
    crowd(ctx, w, horizon - 11, 28, 7);
    ctx.fillStyle = "#83a870";
    ctx.fillRect(0, horizon + 15, w, 3);
    ctx.fillStyle = "#245b36";
    ctx.fillRect(0, horizon + 19, w, h - horizon);
    for (let i = 0; i < 6; i += 1) {
      const x = w * .57 + (i - 2) * w / 14;
      const bottom = w * .56 + (i - 2) * w / 4;
      polygon(ctx, i % 2 ? "#347544" : "#2a653b", [[x, horizon + 19], [x + w / 14, horizon + 19],
        [bottom + w / 4, h], [bottom, h]]);
    }
    polygon(ctx, "#ad8b50", [[w * .7, horizon + 43], [w * .8, horizon + 43], [w * .97, h], [w * .62, h]]);
    stroke(ctx, "#fff8c8aa", 2, w * .66, h * .95, w * .92, h * .95);
    heroPlayer(ctx, w * .77, h * .96, Math.min(h / 300, w / 340));
    drawHeroBall(ctx, w * .87, h * .52, Math.max(11, h * .045));
  }

  function heroPlayer(ctx, x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.lineCap = "round";
    oval(ctx, "#132d20ad", 0, 2, 73, 9);
    for (let i = 0; i < 3; i += 1) stroke(ctx, "#efe5b7", 2.5, 48 + i * 7, 0, 48 + i * 7, -49);
    stroke(ctx, "#efe5b7", 3, 46, -49, 65, -49);
    polygon(ctx, "#9a5547", [[-22, -87], [18, -89], [33, -36], [19, -6], [5, -6], [11, -42], [-4, -57],
      [-39, -20], [-59, -5], [-70, -9], [-56, -31]]);
    polygon(ctx, "#ead9ae", [[-46, -35], [-31, -25], [-57, 0], [-75, -2], [-73, -10]]);
    polygon(ctx, "#f4e0b4", [[13, -47], [28, -45], [32, -31], [23, -1], [2, -1], [4, -9]]);
    polygon(ctx, "#e66d54", [[-30, -136], [-10, -155], [19, -151], [33, -129], [22, -102],
      [18, -75], [-19, -74], [-38, -101]]);
    polygon(ctx, "#ff9b6f", [[-29, -135], [-10, -152], [14, -149], [-3, -95], [-20, -76], [-37, -101]]);
    polygon(ctx, "#aa493b", [[7, -150], [22, -145], [30, -128], [20, -101], [18, -75], [7, -76]]);
    stroke(ctx, "#ba6950", 12, -27, -126, -11, -104);
    stroke(ctx, "#d4805d", 10, -11, -104, 28, -119);
    stroke(ctx, "#df8b64", 11, 22, -132, 34, -118);
    ctx.save();
    ctx.translate(41, -128);
    ctx.rotate(.53);
    ctx.fillStyle = "#f7d38a";
    ctx.fillRect(-7, -79, 15, 62);
    ctx.fillStyle = "#ce9f5f";
    ctx.fillRect(4, -78, 4, 61);
    stroke(ctx, "#f3edbc", 5, 0, -16, 0, 8);
    ctx.restore();
    oval(ctx, "#e9e6be", 32, -121, 9, 6);
    oval(ctx, "#df935f", 1, -162, 13, 13);
    oval(ctx, "#252f2a", -4, -170, 17, 14);
    polygon(ctx, "#344b3f", [[-17, -171], [11, -172], [20, -163], [-12, -161]]);
    stroke(ctx, "#dce3a3", 1.1, 15, -163, 13, -151);
    stroke(ctx, "#dce3a3", 1.1, 13, -151, -1, -152);
    ctx.restore();
  }

  function drawHeroBall(ctx, x, y, r) {
    const red = ctx.createRadialGradient(x - r * .35, y - r * .32, 1, x, y, r);
    red.addColorStop(0, "#ffb185");
    red.addColorStop(.58, "#f56652");
    red.addColorStop(1, "#8f282d");
    stroke(ctx, "#ffd598a3", r * .18, x - r * 4.5, y + r * 2.7, x - r * .65, y + r * .55);
    stroke(ctx, "#fff0aa66", r * .07, x - r * 5.5, y + r * 2.7, x - r, y + r * .24);
    oval(ctx, red, x, y, r);
    ctx.strokeStyle = "#ffe8b4";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y, r * .94, r * .42, -.6, 0, Math.PI * 2);
    ctx.stroke();
  }

  function sizePitch() {
    const size = sizeCanvas(ui.pitch, pitchCtx);
    if (!size) return;
    const { width: w, height: h } = size;
    backdrop.width = ui.pitch.width;
    backdrop.height = ui.pitch.height;
    backdropCtx.setTransform(backdrop.width / w, 0, 0, backdrop.height / h, 0, 0);
    pitch = {
      w, h, cx: w / 2, top: h * .275, crease: h * .81,
      half: Math.min(w * .172, h * .225, 111),
      scale: Math.min(h / 345, 1.34),
    };
    drawStadium();
  }

  function drawStadium() {
    const { w, h, cx, top, crease, half, scale } = pitch;
    const ctx = backdropCtx;
    const horizon = h * .2;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#0c252b");
    sky.addColorStop(1, "#2c5551");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    lamp(ctx, w * .15, h * .095, .7 * scale);
    lamp(ctx, w * .85, h * .095, .7 * scale);
    polygon(ctx, "#36544e", [[0, horizon - 22], [cx, horizon - 8], [w, horizon - 22], [w, horizon + 12], [0, horizon + 12]]);
    crowd(ctx, w, horizon - 9, 23, 7);
    ctx.fillStyle = "#466a51";
    ctx.fillRect(0, horizon + 15, w, 3);
    ctx.fillStyle = "#205435";
    ctx.fillRect(0, horizon + 18, w, h);
    for (let i = -3; i <= 3; i += 1) {
      const offset = i * w * .19;
      polygon(ctx, i % 2 ? "#316c44" : "#2a633e", [
        [cx + offset * .48, horizon + 18], [cx + (offset + w * .19) * .48, horizon + 18],
        [cx + (offset + w * .19) * 1.43, h], [cx + offset * 1.43, h],
      ]);
    }
    ctx.strokeStyle = "#cadb7c95";
    ctx.lineWidth = 1.45;
    ctx.beginPath();
    ctx.ellipse(cx, horizon + h * .36, w * .52, h * .315, 0, Math.PI * 2, 0, true);
    ctx.stroke();
    const pitchTop = top - h * .005;
    const pitchBottom = h * .939;
    polygon(ctx, "#263f28aa", [[cx - half * .44, pitchTop], [cx + half * .47, pitchTop],
      [cx + half * 1.14, pitchBottom + 4], [cx - half * 1.14, pitchBottom + 4]]);
    polygon(ctx, "#b99561", [[cx - half * .43, pitchTop], [cx + half * .43, pitchTop],
      [cx + half, pitchBottom], [cx - half, pitchBottom]]);
    polygon(ctx, "#d7b178", [[cx - half * .34, pitchTop], [cx + half * .34, pitchTop],
      [cx + half * .78, pitchBottom], [cx - half * .78, pitchBottom]]);
    for (let i = 0; i < 30; i += 1) {
      const y = pitchTop + 7 + (i * 73 % Math.floor(pitchBottom - pitchTop - 10));
      const x = cx + ((i * 47 % 37) - 18) / 22 * half * (.42 + (y - pitchTop) / h * .8);
      stroke(ctx, i % 2 ? "#f6d69965" : "#8d69404d", 1, x, y, x + 3 + i % 6, y);
    }
    const farCrease = top + h * .054;
    stroke(ctx, "#fff5db", 1.5, cx - half * .52, farCrease, cx + half * .52, farCrease);
    stroke(ctx, "#fff5db", 2, cx - half * .92, crease + h * .075, cx + half * .92, crease + h * .075);
    stroke(ctx, "#fff5db", 1.5, cx - half * .68, crease + h * .075, cx - half * .57, crease - h * .026);
    stroke(ctx, "#fff5db", 1.5, cx + half * .68, crease + h * .075, cx + half * .57, crease - h * .026);
    ctx.fillStyle = "#fff08434";
    ctx.fillRect(cx - half * .84, crease - 8 * scale, half * 1.68, 16 * scale);
    stroke(ctx, "#734f29", 4 * scale, cx - half * .9, crease + 1, cx + half * .9, crease + 1);
    stroke(ctx, "#ffde72", 2.5 * scale, cx - half * .9, crease, cx + half * .9, crease);
    for (const side of [-1, 0, 1]) oval(ctx, "#fff3ad", cx + side * half * .42, crease, 2.2 * scale);

    for (const [x, y] of [[.16, .58], [.81, .54], [.26, .37], [.72, .32], [.53, .24]]) {
      player(ctx, w * x, h * y, scale * .53, "#b0d4b5", 0);
    }
  }

  function player(ctx, x, y, scale, color, stride) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.lineCap = "round";
    oval(ctx, "#122b225e", 2, 0, 13, 4);
    stroke(ctx, "#25423c", 5.5, -4, -12, -5 - stride, -2);
    stroke(ctx, "#25423c", 5.5, 4, -12, 6 + stride, -3);
    stroke(ctx, "#e9e5cf", 3, -7 - stride, -1, -3 - stride, -1);
    stroke(ctx, "#e9e5cf", 3, 4 + stride, -1, 8 + stride, -1);
    polygon(ctx, color, [[-8, -29], [8, -29], [7, -13], [-7, -13]]);
    stroke(ctx, "#ad785e", 3.6, -7, -25, -10, -16 - stride);
    stroke(ctx, "#ad785e", 3.6, 7, -25, 10, -18 - stride * 2);
    oval(ctx, "#c6946d", 0, -33, 5.2);
    oval(ctx, "#263a36", -1, -35, 5.8, 3.8);
    ctx.restore();
  }

  function drawBatter(ctx, swing, out) {
    const { cx, h, crease, half, scale: s } = pitch;
    const base = crease + h * .083;
    for (let i = -1; i <= 1; i += 1) {
      const x = cx + i * 6 * s;
      const y = out ? base + (i === 0 ? -5 : 0) : base;
      stroke(ctx, "#755f3e", 4 * s, x + 1, y, x + 1, y - 26 * s);
      stroke(ctx, "#f4edd0", 2.6 * s, x, y, x + (out ? i * 10 * s : 0), y - 26 * s);
    }
    if (!out) stroke(ctx, "#fff5d3", 2.5 * s, cx - 7 * s, base - 26 * s, cx + 7 * s, base - 26 * s);
    const batterX = cx - half * .36 - 10 * s;
    player(ctx, batterX, base + 4 * s, s * 1.42, TEAMS[settings.team], swing * 3);
    ctx.save();
    ctx.translate(batterX + 12 * s, base - 24 * s);
    ctx.rotate(.54 - swing * 2.3);
    stroke(ctx, "#e8deb8", 2.5 * s, 0, -6 * s, 0, 7 * s);
    ctx.fillStyle = "#f3d18a";
    ctx.fillRect(-3.6 * s, 4 * s, 7.2 * s, 23 * s);
    ctx.restore();
  }

  function drawAim(ctx) {
    const { cx, crease, half, scale: s } = pitch;
    const x = cx + SIDE[direction] * half * .42;
    ctx.strokeStyle = "#fff3b2d9";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, crease, 6 * s, 0, Math.PI * 2);
    ctx.stroke();
    const tip = x + SIDE[direction] * s * 5;
    polygon(ctx, "#fff3b2", [[tip, crease - 15 * s], [x - 3.5 * s, crease - 9 * s], [x + 3.5 * s, crease - 9 * s]]);
  }

  function deliveryPoint(progress) {
    const { cx, top, crease, half, scale } = pitch;
    const p = Math.max(0, progress);
    const curve = delivery.swing ? Math.pow(Math.min(p, 1), 4.3) : Math.min(p, 1);
    const line = delivery.startSide + (delivery.landingSide - delivery.startSide) * curve;
    return {
      x: cx + line * half * .42 * (.38 + .62 * Math.min(p, 1)),
      y: top - 14 * scale + (crease - top + 14 * scale) * p,
      radius: (2.3 + Math.min(p, 1.18) * 5.4) * scale,
    };
  }

  function drawBall(ctx, point, alpha = 1) {
    const { x, y, radius } = point;
    ctx.globalAlpha = alpha;
    oval(ctx, "#f76d54", x, y, radius);
    oval(ctx, "#ffd3a1", x - radius * .24, y - radius * .22, radius * .34, radius * .26);
    ctx.globalAlpha = 1;
  }

  function shotPoint(progress) {
    const { w, h, cx, scale } = pitch;
    const { launchProgress, outcome } = feedback;
    const launch = deliveryPoint(launchProgress);
    const boundary = outcome === 4 || outcome === 6;
    const shotSide = SIDE[feedback.direction];
    const endX = cx + shotSide * w * (boundary ? .51 : .31);
    const endY = h * (boundary ? (shotSide ? .43 : .17) : .48);
    const arc = Math.sin(progress * Math.PI) * h * (outcome === 6 ? .33 : .075);
    return {
      x: launch.x + (endX - launch.x) * progress,
      y: launch.y + (endY - launch.y) * progress - arc,
      radius: (7.3 - 5 * progress) * scale,
    };
  }

  function drawFeedback(ctx, elapsed) {
    const { outcome, timing } = feedback;
    if (typeof outcome === "number" && outcome > 0) {
      const p = Math.min(elapsed / 740, 1);
      if (p < 1) {
        for (let i = 3; i > 0; i -= 1) drawBall(ctx, shotPoint(Math.max(0, p - i * .047)), .36 - i * .06);
        drawBall(ctx, shotPoint(p));
      }
      if ((outcome === 4 || outcome === 6) && elapsed > 500 && elapsed < 1330) {
        const t = (elapsed - 500) / 830;
        const end = shotPoint(1);
        const x = Math.min(pitch.w - 16, Math.max(16, end.x));
        ctx.globalAlpha = (1 - t) * .95;
        ctx.strokeStyle = "#f4ff9e";
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(x, end.y, 5 + t * 31, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    } else if (elapsed < 310 && timing === "missed") {
      const launch = deliveryPoint(feedback.launchProgress);
      drawBall(ctx, { ...launch, y: launch.y + elapsed / 10 }, 1 - elapsed / 310);
    }
  }

  function drawPitch() {
    if (!pitch) return;
    const { w, h, cx, top, scale } = pitch;
    const ctx = pitchCtx;
    const elapsed = clock - phaseStart;
    const striking = phase === "feedback";
    const six = striking && feedback.outcome === 6 && elapsed < 280 && !reducedMotion.matches;
    ctx.drawImage(backdrop, 0, 0, w, h);
    ctx.save();
    if (six) ctx.translate(Math.sin(elapsed * .11) * 4 * (1 - elapsed / 280), Math.cos(elapsed * .14) * 2);
    const approach = phase === "ready" ? Math.max(0, 1 - (DELIVERY_GAP[settings.overs] - elapsed) / 470) : 0;
    player(ctx, cx - 4 * scale, top + (approach - 1) * 11 * scale, scale * .95, "#a1d4bc", Math.sin(approach * 9) * 3);
    drawAim(ctx);
    const swing = striking && feedback.timing !== "missed" ? Math.max(0, 1 - elapsed / 410) : 0;
    drawBatter(ctx, swing, striking && feedback.outcome === "OUT" && feedback.timing === "missed");
    if (phase === "ball") {
      const progress = Math.min(1.21, ballProgress());
      for (let i = 4; i > 0; i -= 1) {
        if (progress > i * .022) drawBall(ctx, deliveryPoint(progress - i * .022), .38 - i * .069);
      }
      const ball = deliveryPoint(progress);
      oval(ctx, "#402f2480", ball.x + 1, ball.y + ball.radius * 1.35, ball.radius, ball.radius * .36);
      drawBall(ctx, ball);
    }
    if (striking) drawFeedback(ctx, elapsed);
    ctx.restore();
    if (six) {
      ctx.fillStyle = "rgba(228,255,146," + ((1 - elapsed / 280) * .22) + ")";
      ctx.fillRect(0, 0, w, h);
    }
  }

  ui.setup.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(ui.setup);
    startMatch({ overs: Number(values.get("overs")), difficulty: values.get("difficulty"), team: values.get("team") });
  });
  ui.skip.addEventListener("click", skipAi);
  ui.startChase.addEventListener("click", startChase);
  byId("play-again").addEventListener("click", () => startMatch(settings));
  byId("change-settings").addEventListener("click", () => {
    showRecords();
    showScreen("home");
    ui.setup.querySelector("button[type=submit]").focus({ preventScroll: true });
  });
  for (const button of ui.directions) button.addEventListener("click", () => aim(button.dataset.direction));
  ui.pitch.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    const rect = ui.pitch.getBoundingClientRect();
    const third = Math.max(0, Math.min(2, Math.floor(3 * (event.clientX - rect.left) / rect.width)));
    aim(DIRECTIONS[third]);
  });
  ui.hit.addEventListener("pointerdown", (event) => {
    if (event.isPrimary && event.button === 0) hit();
  });
  ui.hit.addEventListener("click", (event) => {
    if (event.detail === 0) hit();
  });
  document.addEventListener("keydown", (event) => {
    if (screen !== "bat" || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === "Space" || event.key === " ") {
      event.preventDefault();
      if (!event.repeat) hit();
    } else if (ARROWS[event.key]) {
      event.preventDefault();
      aim(ARROWS[event.key]);
    }
  });
  document.addEventListener("visibilitychange", () => {
    lastFrame = null;
    if (document.hidden) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    } else requestFrame();
  });

  function resize() {
    if (screen === "home") drawHero();
    if (screen === "bat") {
      sizePitch();
      drawPitch();
    }
  }
  const observer = new ResizeObserver(resize);
  observer.observe(ui.hero);
  observer.observe(ui.pitch);
  window.addEventListener("resize", resize);
  drawHero();
  showRecords();

  if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch((error) => {
      console.warn("Offline setup failed.", error);
    });
  }
})();
