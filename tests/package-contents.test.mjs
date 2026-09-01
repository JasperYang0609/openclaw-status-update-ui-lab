import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const pluginManifest = JSON.parse(
  readFileSync(resolve(repoRoot, "openclaw.plugin.json"), "utf8"),
);
assert.equal(
  pluginManifest.version,
  packageJson.version,
  "package and OpenClaw manifest versions must match",
);

const testFiles = readdirSync(resolve(repoRoot, "tests"))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort();

assert.ok(testFiles.length > 0, "expected at least one test file");

const packOutput = execFileSync("npm", ["pack", "--dry-run", "--json"], {
  cwd: repoRoot,
  encoding: "utf8",
});
const packReport = JSON.parse(packOutput);
assert.equal(packReport.length, 1, "expected one npm pack report");

const packedPaths = new Set(packReport[0].files.map((entry) => entry.path));
for (const testFile of testFiles) {
  assert.ok(
    packedPaths.has(`tests/${testFile}`),
    `release package must include tests/${testFile}`,
  );
}

console.log(`package contents tests passed (${testFiles.length} test files)`);
