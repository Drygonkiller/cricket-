const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EXTRA_CHANCE, EDGE_OUT_CHANCE, classifyTiming, scoreShot, oversToBalls, ballsToOvers, newInnings,
  recordBall, inningsEnded, matchResult, chaseInfo, rollExtra, simulateInnings,
} = require("../game-logic.js");

function shot(timing, line, direction, roll = 0.9, difficulty = "Normal") {
  return scoreShot({ timing, line, direction, difficulty, random: () => roll });
}

test("perfect timing rewards matching the delivery with six, otherwise four", () => {
  assert.equal(shot("perfect", "off", "off"), 6);
  assert.equal(shot("perfect", "off", "leg"), 4);
});

test("good timing scores two or three for a match and one otherwise", () => {
  assert.equal(shot("good", "leg", "leg", 0.49), 2);
  assert.equal(shot("good", "straight", "straight", 0.5), 3);
  assert.equal(shot("good", "leg", "off"), 1);
});

test("early and late shots score one or fall to a difficulty-specific edge", () => {
  for (const [difficulty, risk] of Object.entries(EDGE_OUT_CHANCE)) {
    for (const timing of ["early", "late"]) {
      assert.equal(shot(timing, "straight", "off", risk - 0.001, difficulty), "OUT");
      assert.equal(shot(timing, "off", "off", risk, difficulty), 1);
    }
  }
});

test("missed or unplayed deliveries can only bowl the striker on a straight line", () => {
  assert.equal(shot("missed", "off", "off"), 0);
  assert.equal(shot("missed", "leg", "leg"), 0);
  assert.equal(shot("missed", "straight", "straight"), "OUT");
  assert.equal(shot(undefined, "straight", "off"), "OUT");
});

test("timing windows support both sides of the crease and narrow on Hard", () => {
  assert.equal(classifyTiming(-100, "Normal"), "perfect");
  assert.equal(classifyTiming(100, "Hard"), "good");
  assert.equal(classifyTiming(-300, "Normal"), "early");
  assert.equal(classifyTiming(300, "Normal"), "late");
  assert.equal(classifyTiming(326, "Normal"), "missed");
});

test("overs notation rolls from 0.5 to 1.0 and maps 1.3 to nine balls", () => {
  assert.equal(oversToBalls(5), 30);
  assert.equal(oversToBalls(1.3), 9);
  assert.equal(ballsToOvers(5), "0.5");
  assert.equal(ballsToOvers(6), "1.0");
  assert.equal(ballsToOvers(9), "1.3");
});

test("wides and no-balls add a run each without using a delivery", () => {
  const wide = recordBall(newInnings(), "wide");
  const noBall = recordBall(wide, "no-ball");
  assert.deepEqual(wide, { runs: 1, wickets: 0, balls: 0 });
  assert.deepEqual(noBall, { runs: 2, wickets: 0, balls: 0 });
  assert.deepEqual(recordBall(noBall, "OUT"), { runs: 2, wickets: 1, balls: 1 });
  assert.equal(rollExtra(() => 0), "wide");
  assert.equal(rollExtra(() => EXTRA_CHANCE / 2), "no-ball");
  assert.equal(rollExtra(() => EXTRA_CHANCE), null);
});

test("an innings ends at the overs limit, at ten wickets, or at the target", () => {
  assert.equal(inningsEnded({ runs: 20, wickets: 9, balls: 5 }, 1, 21), false);
  assert.equal(inningsEnded({ runs: 20, wickets: 2, balls: 6 }, 1, 21), true);
  assert.equal(inningsEnded({ runs: 20, wickets: 10, balls: 11 }, 2, 21), true);
  assert.equal(inningsEnded({ runs: 21, wickets: 0, balls: 4 }, 1, 21), true);
  assert.equal(inningsEnded({ runs: 16, wickets: 1, balls: 5 }, 1, 17), false);
  assert.equal(inningsEnded(recordBall({ runs: 16, wickets: 1, balls: 5 }, "wide"), 1, 17), true);
});

test("result is Win at or above target, Tie one short, and Lose otherwise", () => {
  assert.equal(matchResult(21, 21), "Win");
  assert.equal(matchResult(22, 21), "Win");
  assert.equal(matchResult(20, 21), "Tie");
  assert.equal(matchResult(19, 21), "Lose");
});

test("chase requirements use legal balls and handle the end without division by zero", () => {
  assert.deepEqual(chaseInfo({ runs: 6, wickets: 1, balls: 3 }, 1, 15), {
    runsNeeded: 9, ballsLeft: 3, rate: 18,
  });
  assert.deepEqual(chaseInfo({ runs: 18, wickets: 1, balls: 4 }, 1, 15), {
    runsNeeded: 0, ballsLeft: 2, rate: 0,
  });
  assert.deepEqual(chaseInfo({ runs: 10, wickets: 1, balls: 6 }, 1, 15), {
    runsNeeded: 5, ballsLeft: 0, rate: null,
  });
});

test("AI ticker data includes extras and finishes at the requested legal-ball count", () => {
  const rolls = [0, 0.5, 0.95];
  const ai = simulateInnings(1, "Normal", () => rolls.shift() ?? 0.5);
  assert.equal(ai.deliveries.length, 7);
  assert.deepEqual(ai.deliveries[0], { outcome: "wide", innings: { runs: 1, wickets: 0, balls: 0 } });
  assert.equal(ai.innings.balls, 6);
  assert.equal(ai.innings.wickets, 1);
});
