import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runCcgGates } from "../scripts/lib/harness-gates.mjs";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "..");

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

test("Go build output stays outside the managed CCG tree and is removed", () => {
  const checkout = mkdtempSync(path.join(tmpdir(), "harness-gates-checkout-"));
  mkdirSync(path.join(checkout, "codeagent-wrapper"), { recursive: true });
  let outputRoot;

  try {
    const commands = runCcgGates(checkout, (command, args) => {
      if (command !== "go" || args[0] !== "build") return;
      assert.deepEqual(args.slice(0, 2), ["build", "-o"]);
      assert.equal(args.at(-1), "./...");
      outputRoot = args[2];
      assert.equal(isWithin(outputRoot, checkout), false);
      assert.equal(existsSync(outputRoot), true);
      writeFileSync(path.join(outputRoot, "codeagent-wrapper.exe"), "fixture");
    });

    assert.equal(existsSync(outputRoot), false);
    assert.equal(
      existsSync(path.join(checkout, "codeagent-wrapper", "codeagent-wrapper.exe")),
      false,
    );
    assert.ok(
      commands.includes("go build -o <temporary-directory> ./..."),
    );
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});

test("Go build output is removed when the build command fails", () => {
  const checkout = mkdtempSync(path.join(tmpdir(), "harness-gates-failure-"));
  mkdirSync(path.join(checkout, "codeagent-wrapper"), { recursive: true });
  let outputRoot;

  try {
    assert.throws(
      () => runCcgGates(checkout, (command, args) => {
        if (command !== "go" || args[0] !== "build") return;
        outputRoot = args[2];
        writeFileSync(path.join(outputRoot, "partial.exe"), "fixture");
        throw new Error("simulated build failure");
      }),
      /simulated build failure/,
    );
    assert.equal(existsSync(outputRoot), false);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});

test("Harness gate module remains loadable from the repository", () => {
  assert.equal(
    existsSync(path.join(repoRoot, "scripts", "lib", "harness-gates.mjs")),
    true,
  );
});
