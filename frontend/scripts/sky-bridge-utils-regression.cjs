const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const utilsPath = path.join(__dirname, "..", "features", "sky-bridge", "utils.ts");
const source = fs.readFileSync(utilsPath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
});

const runtimeModule = { exports: {} };
const run = new Function("require", "module", "exports", transpiled.outputText);
run(require, runtimeModule, runtimeModule.exports);

const { deriveConnectionReasons } = runtimeModule.exports;

function makeResult(overrides = {}) {
  return {
    connection_id: 0,
    plot_a: "A",
    plot_b: "B",
    status: "fail",
    reasons: [],
    label_position: [0, 0, 0],
    corridors: [],
    ...overrides,
  };
}

const passWithMixedCorridors = makeResult({
  status: "pass",
  corridors: [
    { reasons: [], status: "pass" },
    { reasons: ["not_connecting"], status: "fail" },
  ],
});
assert.deepEqual(
  deriveConnectionReasons(passWithMixedCorridors),
  [],
  "通过的连接不应继续显示未跨越/尺寸不足等失败原因"
);

const failByMissing = makeResult({
  status: "fail",
  reasons: ["missing_corridor", "not_connecting"],
});
assert.deepEqual(
  deriveConnectionReasons(failByMissing),
  ["missing_corridor"],
  "缺少连廊应作为唯一高优先级原因"
);

const failByCorridors = makeResult({
  status: "fail",
  corridors: [{ reasons: ["not_connecting"], status: "fail" }],
});
assert.deepEqual(
  deriveConnectionReasons(failByCorridors),
  ["not_connecting"],
  "失败连接应从连廊明细聚合失败原因"
);

console.log("sky-bridge utils regression checks passed");
