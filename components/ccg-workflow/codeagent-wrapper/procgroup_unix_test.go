//go:build !windows

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// All process fixtures execute this Go test binary. They do not call a model,
// require a shell, use a browser, or depend on external CLI installations.
type unixFixtureProcess struct {
	PID  int `json:"pid"`
	PGID int `json:"pgid"`
}

func unixFixtureArgs(dir, role string) []string {
	return []string{"-test.run=^TestUnixProcessFixture$", "--", dir, role}
}

func unixFixtureEnv(dir string) []string {
	return []string{"HOME=" + dir, "TMPDIR=" + dir, "TMP=" + dir, "TEMP=" + dir}
}

func writeUnixFixtureFile(dir, name string, value any) {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	tmp := filepath.Join(dir, name+"."+strconv.Itoa(os.Getpid())+".tmp")
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		panic(err)
	}
	if err := os.Rename(tmp, filepath.Join(dir, name+".json")); err != nil {
		panic(err)
	}
}

func recordUnixFixtureProcess(dir, role string) {
	pgid, err := syscall.Getpgid(0)
	if err != nil {
		panic(err)
	}
	writeUnixFixtureFile(dir, role, unixFixtureProcess{PID: os.Getpid(), PGID: pgid})
}

// TestUnixProcessFixture is an explicitly selected subprocess entry point.
// Child PIDs are recorded before the parent test sends any signal. Failure
// cleanup kills only these test-created PIDs/groups, including nested groups.
func TestUnixProcessFixture(t *testing.T) {
	var args []string
	for i, arg := range os.Args {
		if arg == "--" {
			args = os.Args[i+1:]
			break
		}
	}
	if len(args) != 2 {
		return
	}
	dir, role := args[0], args[1]
	_ = os.Setenv("HOME", dir)
	if strings.HasSuffix(role, "-leaf") || role == "sibling" {
		if strings.Contains(role, "ignored") {
			signal.Ignore(syscall.SIGTERM, syscall.SIGINT)
			recordUnixFixtureProcess(dir, role)
			for {
				time.Sleep(20 * time.Millisecond)
			}
		}
		ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
		defer stop()
		recordUnixFixtureProcess(dir, role)
		<-ctx.Done()
		os.Exit(0)
	}
	if role == "completed-backend" {
		recordUnixFixtureProcess(dir, role)
		fmt.Fprintln(os.Stdout, `{"type":"thread.started","thread_id":"unix-completed"}`)
		fmt.Fprintln(os.Stdout, `{"type":"item.completed","item":{"type":"agent_message","text":"completed"}}`)
		os.Exit(0)
	}
	if role == "inner-wrapper" || role == "inner-ignoring-wrapper" || role == "outer-wrapper" {
		liteMode = true
		forceKillDelay.Store(1)
		recordUnixFixtureProcess(dir, role)
		backendRole := "inner-backend"
		if role == "outer-wrapper" {
			backendRole = "ordinary-backend"
		}
		if role == "inner-ignoring-wrapper" {
			backendRole = "inner-ignoring-backend"
		}
		executable, err := os.Executable()
		if err != nil {
			panic(err)
		}
		result := runCodexTaskWithContext(context.Background(),
			TaskSpec{Task: "local process fixture", WorkDir: dir},
			&testBackend{name: "codex", command: executable},
			unixFixtureArgs(dir, backendRole), true, true, 20)
		writeUnixFixtureFile(dir, role+"-result", result)
		os.Exit(0)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	recordUnixFixtureProcess(dir, role)
	childRole := "ordinary-leaf"
	switch role {
	case "ordinary-backend":
	case "inner-backend":
		childRole = "inner-leaf"
	case "inner-ignoring-backend":
		childRole = "inner-ignored-leaf"
		signal.Ignore(syscall.SIGTERM, syscall.SIGINT)
	case "leader-exits-backend":
		childRole = "ignored-leaf"
	case "nesting-backend":
		childRole = "inner-wrapper"
	case "nesting-ignoring-backend":
		childRole = "inner-ignoring-wrapper"
	default:
		panic("unexpected fixture role: " + role)
	}
	executable, err := os.Executable()
	if err != nil {
		panic(err)
	}
	child := exec.Command(executable, unixFixtureArgs(dir, childRole)...)
	child.Env = unixFixtureEnv(dir)
	child.Stdout, child.Stderr = os.Stdout, os.Stderr
	if err := child.Start(); err != nil {
		panic(err)
	}
	fmt.Fprintln(os.Stdout, `{"type":"thread.started","thread_id":"unix-`+role+`"}`)
	if role == "inner-ignoring-backend" {
		for {
			time.Sleep(20 * time.Millisecond)
		}
	}
	<-ctx.Done()
	if role == "leader-exits-backend" {
		// Intentionally leave an ordinary child which ignores TERM. Production
		// cleanup must still kill its group after this leader exits successfully.
		os.Exit(0)
	}
	_ = child.Wait()
	os.Exit(0)
}

func unixFixtureAlive(pid int) bool {
	if pid <= 0 || errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) {
		return false
	}
	// Minimal containers can leave already dead orphans as zombies because
	// PID 1 does not reap them. They are not running helpers holding stdout.
	return !commandProcessAlreadyExited(pid)
}

func cleanupUnixFixtureProcesses(dir string) {
	ourGroup, _ := syscall.Getpgid(0)
	// A fixture may have forked immediately before a failing readiness check.
	// Cancel the spawning parent first and rescan for its child's PID record.
	for pass := 0; pass < 6; pass++ {
		entries, _ := os.ReadDir(dir)
		for _, entry := range entries {
			if !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
			var state unixFixtureProcess
			if err != nil || json.Unmarshal(data, &state) != nil || state.PID <= 0 || state.PID == os.Getpid() {
				continue
			}
			if state.PGID == state.PID && state.PGID != ourGroup {
				_ = syscall.Kill(-state.PGID, syscall.SIGKILL)
			}
			_ = syscall.Kill(state.PID, syscall.SIGKILL)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func prepareUnixLifecycleTest(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	previousLiteMode := liteMode
	liteMode = true
	forceKillDelay.Store(1)
	t.Cleanup(func() {
		cleanupUnixFixtureProcesses(dir)
		resetTestHooks()
		liteMode = previousLiteMode
	})
	return dir
}

func readUnixFixtureState(t *testing.T, dir, role string) unixFixtureProcess {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(filepath.Join(dir, role+".json"))
		var state unixFixtureProcess
		if err == nil && json.Unmarshal(data, &state) == nil && state.PID > 0 && state.PGID > 0 {
			return state
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("fixture %s did not report readiness", role)
	return unixFixtureProcess{}
}

func assertUnixFixturesStopped(t *testing.T, states ...unixFixtureProcess) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		alive := false
		for _, state := range states {
			alive = alive || unixFixtureAlive(state.PID)
		}
		if !alive {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	for _, state := range states {
		if unixFixtureAlive(state.PID) {
			t.Errorf("test-created helper remains running: pid=%d pgid=%d", state.PID, state.PGID)
		}
	}
}

func startUnixFixture(t *testing.T, dir, role string, ctx context.Context) (*realCmd, <-chan struct{}, *error) {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := &realCmd{cmd: exec.CommandContext(ctx, executable, unixFixtureArgs(dir, role)...)}
	cmd.cmd.Env = unixFixtureEnv(dir)
	cmd.cmd.Stdout, cmd.cmd.Stderr = io.Discard, io.Discard
	done := make(chan struct{})
	var waitErr error
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	go func() { waitErr = cmd.Wait(); close(done) }()
	t.Cleanup(func() {
		_ = syscall.Kill(-cmd.cmd.Process.Pid, syscall.SIGKILL)
		_ = cmd.cmd.Process.Kill()
		select {
		case <-done:
		case <-time.After(4 * time.Second):
			t.Errorf("fixture %s did not reap its direct child", role)
		}
		releaseCommandProcessGroup(cmd)
	})
	return cmd, done, &waitErr
}

func startUnixExecutorFixture(t *testing.T, dir, role string, ctx context.Context) (<-chan struct{}, *TaskResult) {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
		cmd := exec.CommandContext(ctx, name, args...)
		cmd.Env = unixFixtureEnv(dir)
		return &realCmd{cmd: cmd}
	}
	done := make(chan struct{})
	var result TaskResult
	ctx, cancel := context.WithCancel(ctx)
	t.Cleanup(func() {
		cancel()
		cleanupUnixFixtureProcesses(dir)
		select {
		case <-done:
		case <-time.After(8 * time.Second):
			t.Errorf("executor fixture %s did not finish after failure cleanup", role)
		}
	})
	go func() {
		result = runCodexTaskWithContext(ctx,
			TaskSpec{Task: "local process fixture", WorkDir: dir},
			&testBackend{name: "codex", command: executable},
			unixFixtureArgs(dir, role), true, true, 20)
		close(done)
	}()
	return done, &result
}

func awaitUnixFixture(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(8 * time.Second):
		t.Fatal("bounded Unix process cleanup did not finish")
	}
}

func TestUnixLifecycle_ConfigurePreservesAttributes(t *testing.T) {
	cmd := exec.Command("not-executed")
	credentials := &syscall.Credential{Uid: uint32(os.Geteuid()), Gid: uint32(os.Getegid())}
	attributes := &syscall.SysProcAttr{Credential: credentials}
	cmd.SysProcAttr = attributes
	configureCommandProcessGroup(cmd)
	if cmd.SysProcAttr != attributes || attributes.Credential != credentials || !attributes.Setpgid || attributes.Pgid != 0 {
		t.Fatal("configuration must preserve attributes and create an independent child group")
	}
	configureCommandProcessGroup(nil)
	if !errors.Is(cancelCommandProcessGroup(nil), os.ErrProcessDone) ||
		!errors.Is(cancelCommandProcessGroup(&exec.Cmd{Process: &os.Process{Pid: 0}}), os.ErrProcessDone) {
		t.Fatal("invalid PIDs must not signal the controller's group")
	}
	if signalOwnedCommandProcessGroup(&execFakeRunner{process: &execFakeProcess{pid: 4242}}, syscall.SIGTERM) {
		t.Fatal("a fake runner must never send an actual process-group signal")
	}
}

func TestUnixLifecycle_ContextCancelStopsChildrenAndPreservesSibling(t *testing.T) {
	dir := prepareUnixLifecycleTest(t)
	_, _, _ = startUnixFixture(t, dir, "sibling", context.Background())
	sibling := readUnixFixtureState(t, dir, "sibling")
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	done, result := startUnixExecutorFixture(t, dir, "ordinary-backend", ctx)
	parent := readUnixFixtureState(t, dir, "ordinary-backend")
	child := readUnixFixtureState(t, dir, "ordinary-leaf")
	controllerGroup, _ := syscall.Getpgid(0)
	if parent.PGID != parent.PID || parent.PGID == controllerGroup || parent.PGID == sibling.PGID || child.PGID != parent.PGID {
		t.Fatal("backend/child scope must be separate from the controller and sibling")
	}
	cancel()
	awaitUnixFixture(t, done)
	if result.ExitCode != 130 {
		t.Fatalf("cancelled real process returned %+v, want exit 130", *result)
	}
	assertUnixFixturesStopped(t, parent, child)
	if !unixFixtureAlive(sibling.PID) {
		t.Fatal("cancelling the backend also stopped the unrelated sibling")
	}
}

func TestUnixLifecycle_NestedWrapperTermCascadesWithoutStoppingSibling(t *testing.T) {
	dir := prepareUnixLifecycleTest(t)
	_, _, _ = startUnixFixture(t, dir, "sibling", context.Background())
	sibling := readUnixFixtureState(t, dir, "sibling")
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	done, result := startUnixExecutorFixture(t, dir, "nesting-backend", ctx)
	outer := readUnixFixtureState(t, dir, "nesting-backend")
	innerWrapper := readUnixFixtureState(t, dir, "inner-wrapper")
	innerBackend := readUnixFixtureState(t, dir, "inner-backend")
	innerLeaf := readUnixFixtureState(t, dir, "inner-leaf")
	if innerWrapper.PGID != outer.PGID || innerBackend.PGID != innerBackend.PID ||
		innerBackend.PGID == outer.PGID || innerLeaf.PGID != innerBackend.PGID {
		t.Fatal("nested wrapper/backend did not establish the expected independent groups")
	}
	cancel()
	awaitUnixFixture(t, done)
	if result.ExitCode != 130 {
		t.Fatalf("outer cancellation returned %+v", *result)
	}
	assertUnixFixturesStopped(t, outer, innerWrapper, innerBackend, innerLeaf)
	if !unixFixtureAlive(sibling.PID) {
		t.Fatal("nested cancellation stopped an unrelated session")
	}
	data, err := os.ReadFile(filepath.Join(dir, "inner-wrapper-result.json"))
	var innerResult TaskResult
	if err != nil || json.Unmarshal(data, &innerResult) != nil || innerResult.ExitCode != 130 {
		t.Fatalf("nested wrapper did not finish normal TERM cancellation: data=%s error=%v", data, err)
	}
}

func TestUnixLifecycle_NestedIgnoringTermDoesNotOutliveOuterForceKill(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("detached descendant identity cleanup uses Linux /proc and pidfds")
	}
	dir := prepareUnixLifecycleTest(t)
	_, _, _ = startUnixFixture(t, dir, "sibling", context.Background())
	sibling := readUnixFixtureState(t, dir, "sibling")
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	done, result := startUnixExecutorFixture(t, dir, "nesting-ignoring-backend", ctx)
	outer := readUnixFixtureState(t, dir, "nesting-ignoring-backend")
	innerWrapper := readUnixFixtureState(t, dir, "inner-ignoring-wrapper")
	innerBackend := readUnixFixtureState(t, dir, "inner-ignoring-backend")
	innerLeaf := readUnixFixtureState(t, dir, "inner-ignored-leaf")
	if innerWrapper.PGID != outer.PGID || innerBackend.PGID == outer.PGID || innerLeaf.PGID != innerBackend.PGID {
		t.Fatal("TERM-ignoring test must actually create a separately isolated inner backend")
	}
	// Both the outer executor and real nested executor use the same 1s delay.
	// Increasing only the outer delay would hide the original orphan race.
	cancel()
	awaitUnixFixture(t, done)
	if result.ExitCode != 130 {
		t.Fatalf("nested force-kill cancellation returned %+v", *result)
	}
	assertUnixFixturesStopped(t, outer, innerWrapper, innerBackend, innerLeaf)
	if !unixFixtureAlive(sibling.PID) {
		t.Fatal("cleanup of escaped owned descendants killed an unrelated session")
	}
}

func TestUnixLifecycle_LeaderExitStillCleansTermIgnoringChild(t *testing.T) {
	dir := prepareUnixLifecycleTest(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	done, result := startUnixExecutorFixture(t, dir, "leader-exits-backend", ctx)
	parent := readUnixFixtureState(t, dir, "leader-exits-backend")
	child := readUnixFixtureState(t, dir, "ignored-leaf")
	cancel()
	awaitUnixFixture(t, done)
	if result.ExitCode != 130 {
		t.Fatalf("leader-exited cancellation returned %+v", *result)
	}
	assertUnixFixturesStopped(t, parent, child)
}

func TestUnixLifecycle_DeadlineStopsRealBackendTree(t *testing.T) {
	dir := prepareUnixLifecycleTest(t)
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	t.Cleanup(cancel)
	done, result := startUnixExecutorFixture(t, dir, "ordinary-backend", ctx)
	parent := readUnixFixtureState(t, dir, "ordinary-backend")
	child := readUnixFixtureState(t, dir, "ordinary-leaf")
	awaitUnixFixture(t, done)
	if result.ExitCode != 124 {
		t.Fatalf("real deadline returned %+v, want exit 124", *result)
	}
	assertUnixFixturesStopped(t, parent, child)
}

func TestUnixLifecycle_RealSigintAndSigtermUseWrapperCancellation(t *testing.T) {
	for _, sig := range []syscall.Signal{syscall.SIGINT, syscall.SIGTERM} {
		t.Run(sig.String(), func(t *testing.T) {
			dir := prepareUnixLifecycleTest(t)
			_, done, waitErr := startUnixFixture(t, dir, "outer-wrapper", context.Background())
			wrapper := readUnixFixtureState(t, dir, "outer-wrapper")
			parent := readUnixFixtureState(t, dir, "ordinary-backend")
			child := readUnixFixtureState(t, dir, "ordinary-leaf")
			if parent.PGID == wrapper.PGID || parent.PGID != parent.PID {
				t.Fatal("wrapper and backend must have separate signal scopes")
			}
			if err := syscall.Kill(wrapper.PID, sig); err != nil {
				t.Fatal(err)
			}
			awaitUnixFixture(t, done)
			if *waitErr != nil {
				t.Fatalf("wrapper fixture failed: %v", *waitErr)
			}
			data, err := os.ReadFile(filepath.Join(dir, "outer-wrapper-result.json"))
			var result TaskResult
			if err != nil || json.Unmarshal(data, &result) != nil || result.ExitCode != 130 {
				t.Fatalf("wrapper signal result: data=%s error=%v", data, err)
			}
			assertUnixFixturesStopped(t, wrapper, parent, child)
		})
	}
}

func TestUnixLifecycle_PreCancelledCommandDoesNotFork(t *testing.T) {
	dir := prepareUnixLifecycleTest(t)
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	cmd := &realCmd{cmd: exec.CommandContext(ctx, executable, unixFixtureArgs(dir, "ordinary-backend")...)}
	cmd.cmd.Env = unixFixtureEnv(dir)
	if err := cmd.Start(); !errors.Is(err, context.Canceled) || cmd.cmd.Process != nil {
		t.Fatalf("pre-cancelled command must not fork: process=%v error=%v", cmd.cmd.Process, err)
	}
}

func TestUnixLifecycle_CompletedLinuxProcessWinsLaterDeadline(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("the already-exited child state probe is Linux-specific")
	}
	dir := prepareUnixLifecycleTest(t)
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 600*time.Millisecond)
	defer cancel()
	cmd := &realCmd{cmd: exec.CommandContext(ctx, executable, unixFixtureArgs(dir, "completed-backend")...)}
	cmd.cmd.Env = unixFixtureEnv(dir)
	cmd.cmd.Stdout, cmd.cmd.Stderr = io.Discard, io.Discard
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.cmd.Process.Kill(); _ = cmd.Wait(); releaseCommandProcessGroup(cmd) })
	state := readUnixFixtureState(t, dir, "completed-backend")
	deadline := time.Now().Add(300 * time.Millisecond)
	for !commandProcessAlreadyExited(state.PID) && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if !commandProcessAlreadyExited(state.PID) {
		t.Fatal("completed fixture did not exit before its context deadline")
	}
	<-ctx.Done()
	if err := cmd.Wait(); err != nil {
		t.Fatalf("completed real child was reclassified by a later deadline: %v", err)
	}
}
