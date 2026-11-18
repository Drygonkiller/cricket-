(function (root) {
  "use strict";

  const BALLS_PER_OVER = 6;
  const MAX_WICKETS = 10;
  const EXTRA_CHANCE = 0.05;
  const EDGE_OUT_CHANCE = { Easy: 0.04, Normal: 0.07, Hard: 0.10 };
  const TIMING_WINDOWS = {
    Easy: { perfect: 145, good: 285, early: 510, late: 395 },
    Normal: { perfect: 100, good: 220, early: 435, late: 325 },
    Hard: { perfect: 68, good: 160, early: 340, late: 245 },
  };
  const AI_SHOTS = {
    Easy: [0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 4, 6, "OUT"],
    Normal: [0, 0, 1, 1, 1, 1, 2, 2, 3, 4, 4, 6, "OUT"],
    Hard: [0, 1, 1, 2, 2, 2, 3, 3, 4, 4, 6, 6, "OUT"],
  };

  function timingWindow(difficulty) {
    return TIMING_WINDOWS[difficulty] ?? TIMING_WINDOWS.Normal;
  }

  function classifyTiming(millisecondsFromCrease, difficulty) {
    const window = timingWindow(difficulty);
    const distance = Math.abs(millisecondsFromCrease);
    if (distance <= window.perfect) return "perfect";
    if (distance <= window.good) return "good";
    if (millisecondsFromCrease >= -window.early && millisecondsFromCrease <= window.late) {
      return millisecondsFromCrease < 0 ? "early" : "late";
    }
    return "missed";
  }

  function scoreShot({ timing, line, direction, difficulty, random = Math.random }) {
    const matchesLine = line === direction;
    switch (timing) {
      case "perfect":
        return matchesLine ? 6 : 4;
      case "good":
        return matchesLine ? (random() < 0.5 ? 2 : 3) : 1;
      case "early":
      case "late":
        return random() < (EDGE_OUT_CHANCE[difficulty] ?? EDGE_OUT_CHANCE.Normal) ? "OUT" : 1;
      default:
        return line === "straight" ? "OUT" : 0;
    }
  }

  const AI_BATTING = {
    Easy: { directions: ["off", "straight", "straight", "leg"], mistime: .52, perfect: .12 },
    Normal: { directions: ["off", "off", "straight", "leg", "leg"], mistime: .38, perfect: .20 },
    Hard: { directions: ["off", "off", "off", "straight", "leg", "leg", "leg"], mistime: .26, perfect: .30 },
  };

  function pickAiShot(difficulty, random = Math.random) {
    const { directions, mistime, perfect } = AI_BATTING[difficulty] ?? AI_BATTING.Normal;
    const direction = directions[Math.floor(random() * directions.length)];
    const roll = random();
    return { direction, timing: roll < mistime ? "mistimed" : roll >= 1 - perfect ? "perfect" : "good" };
  }

  function bowlDelivery({ timing, line, aiShot, difficulty, random = Math.random }) {
    const matched = line === aiShot.direction;
    const mistimed = aiShot.timing === "mistimed";
    const edge = EDGE_OUT_CHANCE[difficulty] ?? EDGE_OUT_CHANCE.Normal;
    const roll = random();
    switch (timing) {
      case "perfect":
        if (mistimed) return roll < (line === "straight" ? .43 : .32) - edge ? "OUT" : 0;
        return matched ? (aiShot.timing === "perfect" ? 2 : 1) : 0;
      case "good":
        return mistimed ? 0 : matched ? 2 : (roll < .5 ? 0 : 1);
      case "early":
      case "late":
        if (mistimed && roll < edge) return "OUT";
        if (roll < (matched ? .16 : .08) + edge) return aiShot.timing === "perfect" ? 6 : 4;
        return mistimed ? 1 : matched ? 3 : 2;
      default:
        if (aiShot.timing === "perfect" && matched) return 6;
        return roll < (matched ? .60 : .40) + edge ? 4 : mistimed ? 2 : 3;
    }
  }

  function oversToBalls(overs) {
    const [wholeOvers, balls = "0"] = String(overs).split(".");
    return Number(wholeOvers) * BALLS_PER_OVER + Number(balls);
  }

  function ballsToOvers(balls) {
    return Math.floor(balls / BALLS_PER_OVER) + "." + (balls % BALLS_PER_OVER);
  }

  function newInnings() {
    return { runs: 0, wickets: 0, balls: 0 };
  }

  function recordBall(innings, outcome) {
    const extra = outcome === "wide" || outcome === "no-ball";
    return {
      runs: innings.runs + (extra ? 1 : outcome === "OUT" ? 0 : outcome),
      wickets: innings.wickets + (outcome === "OUT" ? 1 : 0),
      balls: innings.balls + (extra ? 0 : 1),
    };
  }

  function inningsEnded(innings, overs, target = Infinity) {
    return innings.balls >= oversToBalls(overs) || innings.wickets >= MAX_WICKETS || innings.runs >= target;
  }

  function matchResult(runs, target) {
    if (runs >= target) return "Win";
    return runs === target - 1 ? "Tie" : "Lose";
  }

  function defendResult(aiRuns, target) {
    const aiResult = matchResult(aiRuns, target);
    return { Win: "Lose", Tie: "Tie", Lose: "Win" }[aiResult];
  }

  function addMatchToHistory(history, summary) {
    return [summary, ...(Array.isArray(history) ? history : [])].slice(0, 5);
  }

  function chaseInfo(innings, overs, target) {
    const runsNeeded = Math.max(0, target - innings.runs);
    const ballsLeft = Math.max(0, oversToBalls(overs) - innings.balls);
    return { runsNeeded, ballsLeft, rate: ballsLeft ? runsNeeded * BALLS_PER_OVER / ballsLeft : null };
  }

  function rollExtra(random = Math.random) {
    const roll = random();
    if (roll >= EXTRA_CHANCE) return null;
    return roll < EXTRA_CHANCE / 2 ? "wide" : "no-ball";
  }

  function simulateInnings(overs, difficulty, random = Math.random) {
    const outcomes = AI_SHOTS[difficulty] ?? AI_SHOTS.Normal;
    const deliveries = [];
    let innings = newInnings();
    while (!inningsEnded(innings, overs)) {
      const outcome = rollExtra(random) ?? outcomes[Math.floor(random() * outcomes.length)];
      innings = recordBall(innings, outcome);
      deliveries.push({ outcome, innings });
    }
    return { deliveries, innings };
  }

  const logic = {
    EDGE_OUT_CHANCE, EXTRA_CHANCE, timingWindow, classifyTiming, scoreShot, oversToBalls, ballsToOvers,
    newInnings, recordBall, inningsEnded, matchResult, defendResult, chaseInfo, rollExtra, simulateInnings,
    pickAiShot, bowlDelivery, addMatchToHistory,
  };
  if (typeof module === "object" && module.exports) module.exports = logic;
  else root.SuperOverLogic = logic;
})(globalThis);
