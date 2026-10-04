package main

import (
	"context"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"
)

func isolateMCPLiteMode(t *testing.T) {
	t.Helper()
	previous := liteMode
	liteMode = true
	t.Cleanup(func() { liteMode = previous })
}

func TestMCPContractArgs(t *testing.T) {
	oldArgs := os.Args
	t.Cleanup(func() { os.Args = oldArgs })
	for _, tc := range []struct {
		name string
		args []string
		off  bool
		err  bool
	}{
		{"default", []string{"task"}, false, false},
		{"inherit", []string{"--with-mcp", "task"}, false, false},
		{"off", []string{"--backend", "gemini", "--without-mcp", "task"}, true, false},
		{"resume off", []string{"--without-mcp", "resume", "session", "task"}, true, false},
		{"conflict", []string{"--without-mcp", "--with-mcp", "task"}, false, true},
		{"reverse conflict", []string{"--with-mcp", "--without-mcp", "task"}, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			os.Args = append([]string{"wrapper"}, tc.args...)
			cfg, err := parseArgs()
			if (err != nil) != tc.err {
				t.Fatalf("error = %v", err)
			}
			if err == nil && cfg.DisableMCP != tc.off {
				t.Fatalf("DisableMCP = %v, want %v", cfg.DisableMCP, tc.off)
			}
		})
	}
}

func TestMCPContractGeminiNewResumeAndStdin(t *testing.T) {
	for _, mode := range []string{"new", "resume"} {
		for _, target := range []string{"task", ""} {
			cfg := &Config{Backend: "gemini", Mode: mode, SessionID: "session", WorkDir: "."}
			inherited := buildGeminiArgs(cfg, target)
			if slices.Contains(inherited, "--allowed-mcp-server-names") {
				t.Fatal("default must inherit existing MCP settings")
			}
			cfg.DisableMCP = true
			if err := prepareMCPMode(cfg); err != nil {
				t.Fatal(err)
			}
			limited := buildGeminiArgs(cfg, target)
			i := slices.Index(limited, "--allowed-mcp-server-names")
			if i < 0 || i+1 >= len(limited) || !strings.HasPrefix(limited[i+1], "__ccg_none_") || len(limited[i+1]) != 43 {
				t.Fatalf("missing child-only allowlist: %v", limited)
			}
			restored := append(append([]string{}, limited[:i]...), limited[i+2:]...)
			if !reflect.DeepEqual(restored, inherited) {
				t.Fatalf("other backend arguments changed: %v vs %v", restored, inherited)
			}
		}
	}
}

func TestMCPContractSingleInvocation(t *testing.T) {
	isolateMCPLiteMode(t)
	defer resetTestHooks()
	setTestTempDir(t, t.TempDir())
	oldArgs := os.Args
	t.Cleanup(func() { os.Args = oldArgs })
	stdinReader = strings.NewReader("payload")
	seen := false
	runTaskFn = func(task TaskSpec, silent bool, timeout int) TaskResult {
		seen = true
		if !task.DisableMCP || task.Backend != "gemini" || task.Task != "payload" || !task.UseStdin {
			t.Fatalf("MCP mode lost during single invocation: %+v", task)
		}
		return TaskResult{}
	}
	os.Args = []string{"wrapper", "--lite", "--backend", "gemini", "--without-mcp", "-", "."}
	if code := run(); code != 0 || !seen {
		t.Fatalf("single invocation failed: code=%d seen=%v", code, seen)
	}
}

func TestMCPContractParallelTaskOverrides(t *testing.T) {
	isolateMCPLiteMode(t)
	defer resetTestHooks()
	setTestTempDir(t, t.TempDir())
	oldArgs := os.Args
	t.Cleanup(func() { os.Args = oldArgs })
	os.Args = []string{"wrapper", "--lite", "--parallel", "--backend", "gemini", "--without-mcp"}
	stdinReader = strings.NewReader("---TASK---\nid: local\n---CONTENT---\nlocal review\n---TASK---\nid: tool\nbackend: codex\nmcp: inherit\ndependencies: local\n---CONTENT---\nMCP research")
	var seen []TaskSpec
	runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
		seen = append(seen, task) // Dependency layers guarantee sequential calls.
		return TaskResult{TaskID: task.ID}
	}
	if code := run(); code != 0 {
		t.Fatalf("parallel invocation failed: %d", code)
	}
	if len(seen) != 2 || !seen[0].DisableMCP || seen[1].DisableMCP || seen[1].MCPMode != "inherit" {
		t.Fatalf("per-task MCP override lost: %+v", seen)
	}
}

func TestMCPContractRejectsUnsupportedBeforeAnyChild(t *testing.T) {
	isolateMCPLiteMode(t)
	defer resetTestHooks()
	setTestTempDir(t, t.TempDir())
	oldArgs := os.Args
	t.Cleanup(func() { os.Args = oldArgs })
	runTaskFn = func(TaskSpec, bool, int) TaskResult {
		t.Fatal("unsupported opt-out started a child")
		return TaskResult{}
	}
	runCodexTaskFn = func(TaskSpec, int) TaskResult {
		t.Fatal("invalid batch started a child")
		return TaskResult{}
	}
	for _, backend := range []string{"claude", "grok", "antigravity", "pi", "kimi", "opencode"} {
		os.Args = []string{"wrapper", "--lite", "--backend", backend, "--without-mcp", "task"}
		stdinReader = strings.NewReader("")
		if code := run(); code == 0 {
			t.Fatalf("unsupported opt-out accepted for %s", backend)
		}
	}
	os.Args = []string{"wrapper", "--lite", "--parallel", "--backend", "gemini"}
	stdinReader = strings.NewReader("---TASK---\nid: valid\n---CONTENT---\nlocal\n---TASK---\nid: invalid\nbackend: claude\nmcp: off\n---CONTENT---\nresearch")
	if code := run(); code == 0 {
		t.Fatal("unsupported batch accepted")
	}
}

func TestMCPContractExecutorRefusesUnsupportedCustomArgs(t *testing.T) {
	isolateMCPLiteMode(t)
	defer resetTestHooks()
	newCommandRunner = func(context.Context, string, ...string) commandRunner {
		t.Fatal("unsupported MCP request reached process startup")
		return nil
	}
	for _, mode := range []string{"off", "invalid"} {
		result := runCodexTaskWithContext(context.Background(), TaskSpec{Backend: "codex", MCPMode: mode}, nil, []string{"e"}, true, true, 1)
		if result.ExitCode == 0 || result.Error == "" {
			t.Fatalf("executor ignored MCP mode: %+v", result)
		}
	}
	result := runCodexTaskWithContext(context.Background(), TaskSpec{MCPMode: "off"}, GeminiBackend{}, []string{"-o", "stream-json"}, true, true, 1)
	if result.ExitCode == 0 || !strings.Contains(result.Error, "custom provider arguments") {
		t.Fatalf("Gemini custom arguments bypassed the allowlist: %+v", result)
	}
}

func TestMCPContractParallelRejectsInvalidMode(t *testing.T) {
	_, err := parseParallelConfig([]byte("---TASK---\nid: bad\nmcp: offf\n---CONTENT---\nlocal"))
	if err == nil || !strings.Contains(err.Error(), "mcp must be inherit or off") {
		t.Fatalf("invalid MCP mode silently accepted: %v", err)
	}
	for _, headers := range []string{"mcp: off\nmcp: inherit", "mcp: inherit\nmcp: off"} {
		_, err := parseParallelConfig([]byte("---TASK---\nid: bad\n" + headers + "\n---CONTENT---\nlocal"))
		if err == nil || !strings.Contains(err.Error(), "conflicting mcp headers") {
			t.Fatalf("conflicting task headers silently accepted: %v", err)
		}
	}
}

func TestMCPContractParallelRejectsFlagConflicts(t *testing.T) {
	isolateMCPLiteMode(t)
	defer resetTestHooks()
	setTestTempDir(t, t.TempDir())
	oldArgs := os.Args
	t.Cleanup(func() { os.Args = oldArgs })
	runCodexTaskFn = func(TaskSpec, int) TaskResult {
		t.Fatal("conflicting flags started a child")
		return TaskResult{}
	}
	for _, flags := range [][]string{{"--with-mcp", "--without-mcp"}, {"--without-mcp", "--with-mcp"}} {
		os.Args = append([]string{"wrapper", "--lite", "--parallel", "--backend", "gemini"}, flags...)
		stdinReader = strings.NewReader("---TASK---\nid: task\n---CONTENT---\nlocal")
		if code := run(); code == 0 {
			t.Fatal("conflicting flags accepted in parallel mode")
		}
	}
}

func TestMCPContractUsesFreshAllowlistNames(t *testing.T) {
	a := &Config{Backend: "gemini", DisableMCP: true}
	b := &Config{Backend: "gemini", DisableMCP: true}
	if err := prepareMCPMode(a); err != nil {
		t.Fatal(err)
	}
	if err := prepareMCPMode(b); err != nil {
		t.Fatal(err)
	}
	if a.MCPAllowlistName == "" || a.MCPAllowlistName == b.MCPAllowlistName {
		t.Fatal("opt-out reused a fixed server name")
	}
}

func TestMCPContractExecutorForwardsAllowlist(t *testing.T) {
	isolateMCPLiteMode(t)
	defer resetTestHooks()
	setTestTempDir(t, t.TempDir())
	var seenArgs []string
	newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
		if name != "gemini" {
			t.Fatalf("unexpected child command %s", name)
		}
		seenArgs = args
		return &execFakeRunner{stdout: newReasonReadCloser(`{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}`), process: &execFakeProcess{pid: 1234}}
	}
	result := runCodexTaskWithContext(context.Background(), TaskSpec{Task: "payload", MCPMode: "off", WorkDir: "."}, GeminiBackend{}, nil, false, true, 1)
	if result.ExitCode != 0 || result.Error != "" {
		t.Fatalf("mock executor failed: %+v", result)
	}
	i := slices.Index(seenArgs, "--allowed-mcp-server-names")
	if i < 0 || i+1 >= len(seenArgs) || !strings.HasPrefix(seenArgs[i+1], "__ccg_none_") {
		t.Fatalf("executor lost the configured-server opt-out: %v", seenArgs)
	}
}
