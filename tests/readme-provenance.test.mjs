import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("README provenance matches the source manifest", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(ROOT, "harness.sources.json"), "utf8"),
  );
  const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
  const shortCommit = manifest.ccg.commit.slice(0, 7);

  assert.match(
    readme,
    new RegExp(`@mindfoldhq/trellis@${manifest.trellis.version.replaceAll(".", "\\.")}`),
  );
  assert.match(readme, new RegExp(`ccg-gptpro-worflow@${shortCommit}`));
  assert.match(
    readme,
    new RegExp(`${manifest.ccg.personalOnlyCommitsAtCapture} 个个人独有提交`),
  );
  assert.doesNotMatch(readme, /ff425b1/);
});
