const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

test("the stadium is a non-empty glTF 2.0 binary", () => {
  const asset = readFileSync(join(__dirname, "../assets/cricket_stadium.glb"));
  assert.ok(asset.length > 12);
  assert.equal(asset.toString("ascii", 0, 4), "glTF");
  assert.equal(asset.readUInt32LE(4), 2);
  assert.equal(asset.readUInt32LE(8), asset.length);
});
