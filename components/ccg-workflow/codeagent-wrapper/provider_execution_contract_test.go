package main

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestOptionalProviderExecutionRequiresExplicitNativePermissionAcknowledgement(t *testing.T) {
	defer resetTestHooks()
	for _, backend := range []Backend{KimiBackend{}, OpencodeBackend{}} {
		started := false
		newCommandRunner = func(context.Context, string, ...string) commandRunner {
			started = true
			return nil
		}
		result := runCodexTaskWithContext(context.Background(), TaskSpec{Task: "review", Backend: backend.Name()}, backend, nil, false, true, 5)
		if result.ExitCode != 1 || !strings.Contains(result.Error, "--allow-native-auto-approval") || started {
			t.Fatalf("%s started without explicit permission acknowledgement: %+v started=%v", backend.Name(), result, started)
		}
	}
}

func TestOptionalProviderParallelPermissionPreflightStartsNoTasks(t *testing.T) {
	isolateMCPLiteMode(t)
	defer resetTestHooks()
	setTestTempDir(t, t.TempDir())
	previous := os.Args
	t.Cleanup(func() { os.Args = previous })
	os.Args = []string{"wrapper", "--lite", "--parallel", "--allow-native-auto-approval"}
	stdinReader = strings.NewReader("---TASK---\nid: first\nbackend: codex\n---CONTENT---\nreview\n---TASK---\nid: denied\nbackend: kimi\nnative_auto_approval: false\n---CONTENT---\nreview")
	started := false
	runTaskFn = func(TaskSpec, bool, int) TaskResult {
		started = true
		return TaskResult{}
	}
	if code := run(); code != 1 || started {
		t.Fatalf("a rejected task started part of the batch: code=%d started=%v", code, started)
	}
}

func TestOptionalProviderDoesNotSilentlyAcceptReadOnlyExecution(t *testing.T) {
	defer resetTestHooks()
	for _, backend := range []Backend{KimiBackend{}, OpencodeBackend{}} {
		started := false
		newCommandRunner = func(context.Context, string, ...string) commandRunner { started = true; return nil }
		result := runCodexTaskWithContext(context.Background(), TaskSpec{Task: "review", ReadOnly: true, AllowNativeAutoApproval: true}, backend, nil, false, true, 5)
		if result.ExitCode != 1 || !strings.Contains(result.Error, "read-only execution contract") || started {
			t.Fatalf("%s silently accepted unenforced read-only mode: %+v started=%v", backend.Name(), result, started)
		}
	}
}
