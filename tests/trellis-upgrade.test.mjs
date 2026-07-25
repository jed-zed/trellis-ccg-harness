import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function text(relativePath) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

test("Trellis 0.6.9 keeps the Harness-owned inline and hook boundaries", async () => {
  const manifest = JSON.parse(await text("harness.sources.json"));
  assert.equal(manifest.trellis.version, "0.6.9");
  assert.equal((await text(".trellis/.version")).trim(), "0.6.9");

  const config = await text(".trellis/config.yaml");
  assert.match(config, /codex:\s*\r?\n\s+dispatch_mode:\s*inline/);
  assert.match(config, /context_injection:/);
  assert.match(config, /prompt_injection:/);
  assert.match(config, /skip_keyword:\s*"no-trellis"/);

  const hooks = JSON.parse(await text(".codex/hooks.json"));
  const commands = JSON.stringify(hooks);
  assert.match(commands, /scripts[\\/]python-hook-runner\.mjs/);
  assert.doesNotMatch(commands, /python -X utf8/);

  for (const platformRoot of [".agents", ".claude"]) {
    assert.equal(
      existsSync(
        path.join(
          ROOT,
          platformRoot,
          "skills",
          "trellis-spec-bootstarp",
          "SKILL.md",
        ),
      ),
      false,
      `${platformRoot} must not expose the misspelled duplicate skill`,
    );
  }

  assert.match(await text(".gitattributes"), /journal-\*\.md\s+merge=union/);
});

test("Trellis conflict copies are resolved instead of committed", () => {
  for (const relativePath of [
    ".trellis/config.yaml.new",
    ".trellis/.gitignore.new",
    ".codex/hooks.json.new",
    "AGENTS.md.new",
  ]) {
    assert.equal(existsSync(path.join(ROOT, relativePath)), false, relativePath);
  }
});
