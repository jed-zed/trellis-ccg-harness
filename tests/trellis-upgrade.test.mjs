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

test("recorded Trellis version keeps the Harness-owned inline and hook boundaries", async () => {
  const manifest = JSON.parse(await text("harness.sources.json"));
  assert.match(manifest.trellis.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(
    (await text(".trellis/.version")).trim(),
    manifest.trellis.version,
  );

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

test("Harness exact-byte projections are pinned to LF", async () => {
  const attributes = await text(".gitattributes");
  for (const relativePath of [
    "AGENTS.md",
    ".agents/skills/harness-init/assets/collaboration-policy.md",
    ".agents/skills/harness-init/assets/project-contract.schema.json",
    ".harness/ownership.json",
    ".harness/policies/collaboration-policy.md",
    ".harness/project.json",
    ".harness/project.schema.json",
  ]) {
    assert.match(
      attributes,
      new RegExp(
        `^${relativePath.replaceAll(".", "\\.")} text eol=lf$`,
        "m",
      ),
    );
  }
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
