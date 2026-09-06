import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readWindowsProcessIdentity } from "../.agents/skills/harness-init/scripts/windows-process-identity.mjs";

test("native identity transport preserves precision, isolation and unknown-owner safety", async () => {
  const moduleUrl = new URL("../.agents/skills/harness-init/scripts/windows-process-identity.mjs", import.meta.url).href;
  await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    import { promisify } from "node:util";
    let probes = 0;
    let queries = 0;
    let response = { stdout: "639242626757950407\\n" };
    const checkBounds = options => {
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      assert.equal(options.maxBuffer, 4096);
      assert.ok(options.timeout > 0 && options.timeout <= 5000);
    };
    childProcess.spawnSync = (file, args, options) => {
      probes++;
      checkBounds(options);
      return { status: 0, stdout: args.includes("--version") ? "Python 3.12.4" : "python" };
    };
    const execute = () => { throw new Error("Expected promise transport"); };
    execute[promisify.custom] = async (file, args, options) => {
      queries++;
      checkBounds(options);
      assert.deepEqual(args.slice(-5, -1), ["-I", "-S", "-c", args.at(-2)]);
      assert.match(args.at(-2), /GetProcessTimes/);
      assert.equal(args.at(-1), "123");
      if (response instanceof Error) throw response;
      return response;
    };
    childProcess.execFile = execute;
    syncBuiltinESMExports();
    const { readWindowsProcessIdentity: read } = await import(${JSON.stringify(moduleUrl)});
    for (const pid of [0, -1, 1.5, "123", NaN, 0x100000000]) assert.equal(await read(pid), null);
    assert.equal(probes + queries, 0);
    assert.equal(await read(123), "win32:123:639242626757950407");
    for (const stdout of ["", "not-ticks", "123\\n456"]) {
      response = { stdout };
      assert.equal(await read(123), undefined);
    }
    for (const code of ["ENOENT", "ESRCH", "ETIMEDOUT", 1, 5]) {
      response = Object.assign(new Error("query unavailable"), { code });
      assert.equal(await read(123), undefined);
    }
    assert.equal(probes, 2, "successful interpreter resolution is reused");
    assert.equal(queries, 9);
  `], { windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 });
});

test("native Windows creation ticks retain the existing epoch and process identity", {
  skip: process.platform !== "win32",
}, async () => {
  const identity = await readWindowsProcessIdentity(process.pid);
  assert.match(identity ?? "", new RegExp(`^win32:${process.pid}:\\d+$`));
  assert.equal(await readWindowsProcessIdentity(process.pid), identity);
  const createdMs = Number((BigInt(identity.split(":")[2]) - 621355968000000000n) / 10000n);
  const expectedMs = Date.now() - process.uptime() * 1000;
  assert.ok(Math.abs(createdMs - expectedMs) < 2000, "creation ticks use the .NET UTC epoch");
});

test("Windows initializer identities use native creation time without PowerShell", {
  skip: process.platform !== "win32",
}, async () => {
  const preload = `
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    import { promisify } from "node:util";
    const original = childProcess.execFile;
    const originalAsync = promisify(original);
    function inspect(file, args) {
      if (args.some(value => String(value).includes(".StartTime.ToUniversalTime().Ticks"))) {
        console.error("PROCESS_IDENTITY_POWERSHELL_HOST");
        throw new Error("PowerShell identity queries are unavailable in this regression");
      }
      if (!args.some(value => String(value).includes("GetProcessTimes"))) return null;
      if (!args.includes("-I") || !args.includes("-S")) throw new Error("Python must be isolated");
      const stack = new Error().stack.split("\\n").filter(line => !line.includes("data:")).join("\\n");
      if (stack.includes("third-party-approval.mjs")) return "approval";
      if (stack.includes("harness-init-core.mjs")) return "initializer";
      throw new Error("Unexpected native identity caller");
    }
    function guarded(file, args, ...rest) {
      inspect(file, args);
      return original(file, args, ...rest);
    }
    guarded[promisify.custom] = async (file, args, ...rest) => {
      const kind = inspect(file, args);
      let result;
      try {
        result = await originalAsync(file, args, ...rest);
      } catch (error) {
        if (kind) console.error("IDENTITY_NATIVE_FAILURE:" + kind + ":" + error.code);
        throw error;
      }
      if (kind && /^\\d+$/.test(result.stdout.trim())) {
        console.error("PROCESS_IDENTITY_NATIVE_SUCCESS:" + kind);
      }
      return result;
    };
    childProcess.execFile = guarded;
    syncBuiltinESMExports();
  `;
  const env = { ...process.env };
  // This child owns a separate test runner, not the parent's test-worker role.
  delete env.NODE_TEST_CONTEXT;
  let output;
  let failure;
  try {
    const result = await promisify(execFile)(process.execPath, [
      "--import", `data:text/javascript,${encodeURIComponent(preload)}`,
      "--test", "--test-concurrency=1", "--test-reporter=spec",
      "--test-name-pattern=^(approved contracts are atomically promoted to ready|non-interactive Global Init requires explicit reject-all selections and records them)$",
      fileURLToPath(new URL("./harness-init-cli.test.mjs", import.meta.url)),
      fileURLToPath(new URL("./harness-third-party-cli.test.mjs", import.meta.url)),
    ], { env, windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
    output = result.stdout + result.stderr;
  } catch (error) {
    output = String(error.stdout ?? "") + String(error.stderr ?? "");
    failure = error;
  }
  assert.doesNotMatch(output, /PROCESS_IDENTITY_POWERSHELL_HOST/);
  assert.equal(failure === undefined, true, output || String(failure));
  assert.match(output, /PROCESS_IDENTITY_NATIVE_SUCCESS:initializer/);
  assert.match(output, /PROCESS_IDENTITY_NATIVE_SUCCESS:approval/);
});
