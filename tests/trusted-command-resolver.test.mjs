import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  resolveTrustedCommand,
} from "../.agents/skills/harness-init/scripts/trusted-command-resolver.mjs";

test("trusted command resolver binds CCG to an exact Node package entrypoint", async () => {
  const packageRoot = await mkdtemp(
    path.join(tmpdir(), "harness-trusted-ccg-"),
  );
  try {
    const ccgRoot = path.join(packageRoot, "ccg-workflow");
    const entrypoint = path.join(ccgRoot, "bin", "ccg.mjs");
    await mkdir(path.dirname(entrypoint), { recursive: true });
    await writeFile(
      path.join(ccgRoot, "package.json"),
      `${JSON.stringify({
        name: "ccg-workflow",
        version: "3.4.1",
        bin: { ccg: "bin/ccg.mjs" },
      })}\n`,
    );
    await writeFile(entrypoint, "process.stdout.write('3.4.1\\n')\n");

    const binding = await resolveTrustedCommand("ccg", {
      env: {},
      nodePath: process.execPath,
      approvedPackageRoots: [packageRoot],
      approvedCommandRoots: [],
    });

    assert.equal(binding.logicalName, "ccg");
    assert.equal(path.isAbsolute(binding.command), true);
    assert.deepEqual(binding.argsPrefix, [entrypoint]);
    assert.equal(binding.identity.kind, "node-package-bin");
    assert.equal(
      binding.identity.packageVersion,
      "3.4.1",
    );
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});
