import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("README keeps mutable CCG provenance in the source manifest only", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(ROOT, "harness.sources.json"), "utf8"),
  );
  const readme = await readFile(path.join(ROOT, "README.md"), "utf8");

  assert.match(
    readme,
    new RegExp(`@mindfoldhq/trellis@${manifest.trellis.version.replaceAll(".", "\\.")}`),
  );
  assert.match(readme, /jed-zed\/ccg-gptpro-worflow/);
  assert.match(readme, /harness\.sources\.json/);
  assert.doesNotMatch(readme, /ccg-gptpro-worflow@[0-9a-f]{7,40}/i);
  assert.doesNotMatch(readme, /\d+ 个个人独有提交和 \d+ 个差异文件/);
  assert.doesNotMatch(readme, /94e9b90|ff425b1/);
});
