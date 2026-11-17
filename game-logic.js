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
    newInnings, recordBall, inningsEnded, matchResult, chaseInfo, rollExtra, simulateInnings,
  };
  if (typeof module === "object" && module.exports) module.exports = logic;
  else root.SuperOverLogic = logic;
})(globalThis);
