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

  assert.equal(
    existsSync(path.join(ROOT, ".claude")),
    false,
    "the Harness project must not project any Claude runtime assets",
  );
  assert.equal(
    existsSync(
      path.join(
        ROOT,
        ".agents",
        "skills",
        "trellis-spec-bootstarp",
        "SKILL.md",
      ),
    ),
    false,
    ".agents must not expose the misspelled duplicate skill",
  );

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

test("recommended third-party MCP tools are approval-gated and source-pinned", async () => {
  const setup = await text(
    ".agents/skills/trellis-spec-bootstrap/references/mcp-setup.md",
  );

  assert.match(setup, /do not execute.+until the\s+user explicitly approves/is);
  assert.match(setup, /gitnexus@1\.6\.9/);
  assert.match(setup, /github\.com\/cloudwego\/abcoder@v0\.3\.1/);
  assert.match(setup, /sha512-[A-Za-z0-9+/]+=*/);
  assert.match(setup, /module checksum\s+`h1:/);
  assert.doesNotMatch(setup, /@latest\b/);
  assert.doesNotMatch(setup, /\bnpx\s+(?:-y\s+)?gitnexus(?:\s|$)/);
});
