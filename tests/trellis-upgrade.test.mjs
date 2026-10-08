import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

test("Harness owned projections use LF while CCG preserves authoritative bytes", async () => {
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
  assert.match(
    attributes,
    /^components\/ccg-workflow\/\*\* -text$/m,
  );
  assert.match(
    attributes,
    /^\.agents\/skills\/harness-init\/\*\* text=auto eol=lf$/m,
  );
  for (const skill of ["codebase-design", "writing-great-skills"]) {
    assert.match(
      attributes,
      new RegExp(`^\\.agents/skills/${skill}/\\*\\* text=auto eol=lf$`, "m"),
    );
  }
  assert.match(
    attributes,
    /^\.harness\/\*\* text=auto eol=lf$/m,
  );
});

test("CCG component preserves both CRLF and LF blobs with Git autocrlf enabled", async () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-attributes-"));
  const component = path.join(fixtureRoot, "components", "ccg-workflow");
  const git = (...args) => {
    const result = spawnSync("git", ["-C", fixtureRoot, "-c", "core.autocrlf=true", ...args]);
    assert.equal(result.status, 0, result.stderr?.toString());
    return result.stdout;
  };
  try {
    mkdirSync(component, { recursive: true });
    writeFileSync(path.join(fixtureRoot, ".gitattributes"), await text(".gitattributes"));
    const samples = new Map([
      ["crlf.txt", Buffer.from("authoritative\r\nsource\r\n")],
      ["lf.txt", Buffer.from("authoritative\nsource\n")],
    ]);
    for (const [name, bytes] of samples) writeFileSync(path.join(component, name), bytes);
    git("init", "--quiet");
    git("add", "--", ".gitattributes", "components/ccg-workflow");
    for (const [name, bytes] of samples) {
      assert.deepEqual(git("show", `:components/ccg-workflow/${name}`), bytes, name);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
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

test("third-party MCP examples retain the restored official Trellis commands", async () => {
  const setup = await text(
    ".agents/skills/trellis-spec-bootstrap/references/mcp-setup.md",
  );

  assert.match(setup, /\bnpx gitnexus analyze\b/);
  assert.match(setup, /\bnpx -y gitnexus mcp\b/);
  assert.match(setup, /\bgo install github\.com\/cloudwego\/abcoder@latest\b/);
  assert.doesNotMatch(setup, /gitnexus@|abcoder@v/);
});
