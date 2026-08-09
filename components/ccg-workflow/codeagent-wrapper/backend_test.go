package main

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
)

func TestClaudeBuildArgs_ModesAndPermissions(t *testing.T) {
	backend := ClaudeBackend{}

	t.Run("new mode always bypasses permissions (autonomous orchestration)", func(t *testing.T) {
		cfg := &Config{Mode: "new", WorkDir: "/repo"}
		got := backend.BuildArgs(cfg, "todo")
		want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "todo"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("read-only mode uses native safety controls and stdin", func(t *testing.T) {
		cfg := &Config{Mode: "new", WorkDir: "/repo", ReadOnly: true}
		got := backend.BuildArgs(cfg, "")
		want := []string{
			"-p",
			"--safe-mode",
			"--disable-slash-commands",
			"--tools", "Read,Glob,Grep",
			"--strict-mcp-config",
			"--mcp-config", `{"mcpServers":{}}`,
			"--setting-sources", "",
			"--settings", "{}",
			"--no-session-persistence",
			"--no-chrome",
			"--permission-mode", "plan",
			"--input-format", "text",
			"--output-format", "stream-json",
			"--verbose",
			"--include-partial-messages",
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
		if slices.Contains(got, "--dangerously-skip-permissions") {
			t.Fatalf("read-only args must not bypass permissions: %v", got)
		}
	})

	t.Run("new mode can opt-in skip-permissions", func(t *testing.T) {
		cfg := &Config{Mode: "new", SkipPermissions: true}
		got := backend.BuildArgs(cfg, "-")
		want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "-"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("resume mode includes session id", func(t *testing.T) {
		cfg := &Config{Mode: "resume", SessionID: "sid-123", WorkDir: "/ignored"}
		got := backend.BuildArgs(cfg, "resume-task")
		want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "-r", "sid-123", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "resume-task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("resume mode without session still returns base flags", func(t *testing.T) {
		cfg := &Config{Mode: "resume", WorkDir: "/ignored"}
		got := backend.BuildArgs(cfg, "follow-up")
		want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "follow-up"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("resume mode can opt-in skip permissions", func(t *testing.T) {
		cfg := &Config{Mode: "resume", SessionID: "sid-123", SkipPermissions: true}
		got := backend.BuildArgs(cfg, "resume-task")
		want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "-r", "sid-123", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "resume-task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("nil config returns nil", func(t *testing.T) {
		if backend.BuildArgs(nil, "ignored") != nil {
			t.Fatalf("nil config should return nil args")
		}
	})
}

func TestClaudeBuildArgs_GeminiAndCodexModes(t *testing.T) {
	t.Run("gemini new mode passes workdir via include-directories", func(t *testing.T) {
		backend := GeminiBackend{}
		cfg := &Config{Mode: "new", WorkDir: "/workspace"}
		got := backend.BuildArgs(cfg, "task")
		want := []string{"-o", "stream-json", "-y", "--include-directories", "/workspace", "-p", "task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("gemini new mode without workdir omits include-directories", func(t *testing.T) {
		backend := GeminiBackend{}
		cfg := &Config{Mode: "new"}
		got := backend.BuildArgs(cfg, "task")
		want := []string{"-o", "stream-json", "-y", "-p", "task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("gemini resume mode uses session id without include-directories", func(t *testing.T) {
		backend := GeminiBackend{}
		cfg := &Config{Mode: "resume", SessionID: "sid-999", WorkDir: "/workspace"}
		got := backend.BuildArgs(cfg, "resume")
		want := []string{"-o", "stream-json", "-y", "-r", "sid-999", "-p", "resume"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("gemini resume mode without session omits identifier", func(t *testing.T) {
		backend := GeminiBackend{}
		cfg := &Config{Mode: "resume"}
		got := backend.BuildArgs(cfg, "resume")
		want := []string{"-o", "stream-json", "-y", "-p", "resume"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("gemini nil config returns nil", func(t *testing.T) {
		backend := GeminiBackend{}
		if backend.BuildArgs(nil, "ignored") != nil {
			t.Fatalf("nil config should return nil args")
		}
	})

	t.Run("codex build args includes bypass by default (CODEX_REQUIRE_APPROVAL unset)", func(t *testing.T) {
		t.Setenv("CODEX_REQUIRE_APPROVAL", "")

		backend := CodexBackend{}
		cfg := &Config{Mode: "new", WorkDir: "/tmp"}
		got := backend.BuildArgs(cfg, "task")
		want := []string{"e", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-C", "/tmp", "--json", "task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("codex build args omits bypass when CODEX_REQUIRE_APPROVAL=true", func(t *testing.T) {
		t.Setenv("CODEX_REQUIRE_APPROVAL", "true")

		backend := CodexBackend{}
		cfg := &Config{Mode: "new", WorkDir: "/tmp"}
		got := backend.BuildArgs(cfg, "task")
		want := []string{"e", "--skip-git-repo-check", "-C", "/tmp", "--json", "task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("progress flag does not affect backend args", func(t *testing.T) {
		backend := CodexBackend{}
		cfg := &Config{Mode: "new", WorkDir: "/tmp", Progress: true}
		got := backend.BuildArgs(cfg, "task")
		want := []string{"e", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-C", "/tmp", "--json", "task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})
}

func TestGeminiBuildArgs_NeverReceivesDashAsPrompt(t *testing.T) {
	// Gemini CLI does not support "-" as stdin marker for -p flag.
	// Verify that BuildArgs never produces "-p -" — the actual task text
	// must be passed directly via -p.
	backend := GeminiBackend{}
	cfg := &Config{Mode: "new", WorkDir: "/workspace"}

	// When called with actual task text (geminiDirect path in executor)
	got := backend.BuildArgs(cfg, "Analyze the authentication module")
	want := []string{"-o", "stream-json", "-y", "--include-directories", "/workspace", "-p", "Analyze the authentication module"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}

	// Ensure "-" as targetArg would produce the broken "-p -" (this is what we prevent in executor)
	gotBroken := backend.BuildArgs(cfg, "-")
	for i, arg := range gotBroken {
		if arg == "-p" && i+1 < len(gotBroken) && gotBroken[i+1] == "-" {
			// This confirms the bug path — executor must never call BuildArgs with "-" for Gemini
			return
		}
	}
	t.Fatal("expected BuildArgs with '-' to produce '-p -' (the known broken path)")
}

func TestGeminiBuildArgs_OmitsPFlagWhenTargetEmpty(t *testing.T) {
	// On Windows, executor passes targetArg="" to signal stdin pipe mode.
	// buildGeminiArgs should omit -p entirely when targetArg is empty.
	backend := GeminiBackend{}
	cfg := &Config{Mode: "new", WorkDir: "/workspace"}

	got := backend.BuildArgs(cfg, "")
	// Should NOT contain -p at all
	for i, arg := range got {
		if arg == "-p" {
			t.Fatalf("expected no -p flag when targetArg is empty, but found -p at index %d: %v", i, got)
		}
	}
	// Should still contain other flags
	want := []string{"-o", "stream-json", "-y", "--include-directories", "/workspace"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestGeminiBuildArgs_WithModel_OmitsPFlagWhenTargetEmpty(t *testing.T) {
	backend := GeminiBackend{}
	cfg := &Config{Mode: "new", WorkDir: "/workspace", GeminiModel: "gemini-3.1-pro-preview"}

	got := backend.BuildArgs(cfg, "")
	for i, arg := range got {
		if arg == "-p" {
			t.Fatalf("expected no -p flag when targetArg is empty, but found -p at index %d: %v", i, got)
		}
	}
	want := []string{"-m", "gemini-3.1-pro-preview", "-o", "stream-json", "-y", "--include-directories", "/workspace"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestClaudeBuildArgs_BackendMetadata(t *testing.T) {
	t.Setenv("CCG_CLAUDE_EXECUTABLE", "")
	tests := []struct {
		backend Backend
		name    string
		command string
	}{
		{backend: CodexBackend{}, name: "codex", command: "codex"},
		{backend: ClaudeBackend{}, name: "claude", command: "claude"},
		{backend: GeminiBackend{}, name: "gemini", command: "gemini"},
	}

	for _, tt := range tests {
		if got := tt.backend.Name(); got != tt.name {
			t.Fatalf("Name() = %s, want %s", got, tt.name)
		}
		if got := tt.backend.Command(); got != tt.command {
			t.Fatalf("Command() = %s, want %s", got, tt.command)
		}
	}
}

func TestClaudeBackend_CommandUsesValidatedOverride(t *testing.T) {
	t.Setenv("CCG_CLAUDE_EXECUTABLE", "/trusted/claude")
	if got := (ClaudeBackend{}).Command(); got != "/trusted/claude" {
		t.Fatalf("Command() = %q, want validated override", got)
	}
}

func TestBuildBackendEnv_ClaudeDefaultModel(t *testing.T) {
	setHome := func(t *testing.T) string {
		home := t.TempDir()
		t.Setenv("HOME", home)
		t.Setenv("USERPROFILE", home)
		return home
	}

	t.Run("claude defaults to opus through env", func(t *testing.T) {
		setHome(t)
		t.Setenv("ANTHROPIC_MODEL", "")
		got := buildBackendEnv("claude")
		if got["ANTHROPIC_MODEL"] != "claude-opus-4-8" {
			t.Fatalf("ANTHROPIC_MODEL=%q, want claude-opus-4-8", got["ANTHROPIC_MODEL"])
		}
	})

	t.Run("process env can override", func(t *testing.T) {
		setHome(t)
		t.Setenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
		got := buildBackendEnv("claude")
		if _, ok := got["ANTHROPIC_MODEL"]; ok {
			t.Fatalf("wrapper env should not override process ANTHROPIC_MODEL: %v", got)
		}
	})

	t.Run("settings env can override", func(t *testing.T) {
		home := setHome(t)
		t.Setenv("ANTHROPIC_MODEL", "")
		dir := filepath.Join(home, ".claude")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("MkdirAll: %v", err)
		}
		path := filepath.Join(dir, "settings.json")
		data := []byte(`{"env":{"ANTHROPIC_MODEL":"claude-sonnet-4-6"}}`)
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}

		got := buildBackendEnv("claude")
		if got["ANTHROPIC_MODEL"] != "claude-sonnet-4-6" {
			t.Fatalf("ANTHROPIC_MODEL=%q, want settings value", got["ANTHROPIC_MODEL"])
		}
	})

	t.Run("non-claude backend does not receive claude model", func(t *testing.T) {
		setHome(t)
		t.Setenv("ANTHROPIC_MODEL", "")
		got := buildBackendEnv("gemini")
		if _, ok := got["ANTHROPIC_MODEL"]; ok {
			t.Fatalf("non-claude env should not set ANTHROPIC_MODEL: %v", got)
		}
	})
}

func TestLoadMinimalEnvSettings(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	t.Run("missing file returns empty", func(t *testing.T) {
		if got := loadMinimalEnvSettings(); len(got) != 0 {
			t.Fatalf("got %v, want empty", got)
		}
	})

	t.Run("valid env returns string map", func(t *testing.T) {
		dir := filepath.Join(home, ".claude")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("MkdirAll: %v", err)
		}
		path := filepath.Join(dir, "settings.json")
		data := []byte(`{"env":{"ANTHROPIC_API_KEY":"secret","FOO":"bar"}}`)
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}

		got := loadMinimalEnvSettings()
		if got["ANTHROPIC_API_KEY"] != "secret" || got["FOO"] != "bar" {
			t.Fatalf("got %v, want keys present", got)
		}
	})

	t.Run("non-string values are ignored", func(t *testing.T) {
		dir := filepath.Join(home, ".claude")
		path := filepath.Join(dir, "settings.json")
		data := []byte(`{"env":{"GOOD":"ok","BAD":123,"ALSO_BAD":true}}`)
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}

		got := loadMinimalEnvSettings()
		if got["GOOD"] != "ok" {
			t.Fatalf("got %v, want GOOD=ok", got)
		}
		if _, ok := got["BAD"]; ok {
			t.Fatalf("got %v, want BAD omitted", got)
		}
		if _, ok := got["ALSO_BAD"]; ok {
			t.Fatalf("got %v, want ALSO_BAD omitted", got)
		}
	})

	t.Run("oversized file returns empty", func(t *testing.T) {
		dir := filepath.Join(home, ".claude")
		path := filepath.Join(dir, "settings.json")
		data := bytes.Repeat([]byte("a"), maxClaudeSettingsBytes+1)
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
		if got := loadMinimalEnvSettings(); len(got) != 0 {
			t.Fatalf("got %v, want empty", got)
		}
	})
}

func TestGrokBuildArgs_NewMode(t *testing.T) {
	cfg := &Config{Mode: "new", WorkDir: "/tmp/project", Backend: "grok"}
	args := buildGrokArgs(cfg, "do the task")

	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "--always-approve") {
		t.Fatalf("args missing --always-approve: %v", args)
	}
	if !strings.Contains(joined, "--output-format streaming-json") {
		t.Fatalf("args missing streaming-json output format: %v", args)
	}
	if strings.Contains(joined, "--cwd") {
		t.Fatalf("args must not contain --cwd (workdir comes from cmd.Dir): %v", args)
	}
	// -p must be followed by the task text
	for i, a := range args {
		if a == "-p" {
			if i+1 >= len(args) || args[i+1] != "do the task" {
				t.Fatalf("-p not followed by task text: %v", args)
			}
			return
		}
	}
	t.Fatalf("args missing -p: %v", args)
}

func TestAntigravityBuildArgs_ReviewModeIsSandboxedPlan(t *testing.T) {
	cfg := &Config{
		Mode:              "new",
		WorkDir:           "/tmp/project",
		Backend:           "antigravity",
		AntigravityReview: true,
	}
	want := []string{
		"--sandbox",
		"--mode", "plan",
		"--dangerously-skip-permissions",
		"--disable-slash-commands",
		"--output-format", "stream-json",
		"--add-dir", "/tmp/project",
		"-p", "review the task",
	}
	if got := buildAntigravityArgs(cfg, "review the task"); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestAntigravityBuildArgs_ReadOnlyStreamsSandboxedPlanEvents(t *testing.T) {
	cfg := &Config{Mode: "new", WorkDir: "/tmp/project", Backend: "antigravity", ReadOnly: true}
	want := []string{
		"--sandbox",
		"--mode", "plan",
		"--dangerously-skip-permissions",
		"--disable-slash-commands",
		"--output-format", "stream-json",
		"--add-dir", "/tmp/project",
		"-p", "analyze the task",
	}
	if got := buildAntigravityArgs(cfg, "analyze the task"); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestAntigravityBuildArgs_DefaultStillUsesStreamJSON(t *testing.T) {
	args := buildAntigravityArgs(&Config{Mode: "new", Backend: "antigravity"}, "task")
	if !hasArgPair(args, "--output-format", "stream-json") {
		t.Fatalf("args missing stream-json output: %v", args)
	}
}

func TestGrokBuildArgs_ResumeMode(t *testing.T) {
	cfg := &Config{Mode: "resume", SessionID: "sess-123", WorkDir: "/tmp/project", Backend: "grok"}
	args := buildGrokArgs(cfg, "continue")

	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-r sess-123") {
		t.Fatalf("resume args missing -r <session>: %v", args)
	}
	if !strings.Contains(joined, "-p continue") {
		t.Fatalf("resume args missing -p prompt: %v", args)
	}
}

func TestGrokBuildArgs_ReadOnlyIsToolless(t *testing.T) {
	args := buildGrokArgs(&Config{Mode: "new", Backend: "grok", ReadOnly: true}, "inspect")
	for _, pair := range [][2]string{
		{"--tools", ""},
		{"--disallowed-tools", "read_file,grep,list_dir,search_tool,use_tool,search_replace"},
		{"--permission-mode", "dontAsk"},
		{"--deny", "mcp__*"},
		{"--output-format", "streaming-json"},
		{"-p", "inspect"},
	} {
		if !hasArgPair(args, pair[0], pair[1]) {
			t.Fatalf("read-only args missing %q %q: %v", pair[0], pair[1], args)
		}
	}
	for _, flag := range []string{"--disable-web-search", "--no-memory", "--no-plan", "--no-subagents"} {
		if !hasArg(args, flag) {
			t.Fatalf("read-only args missing %q: %v", flag, args)
		}
	}
	for _, forbidden := range []string{"--always-approve", "--max-turns", "--system-prompt-override", "--prompt-file"} {
		if hasArg(args, forbidden) {
			t.Fatalf("read-only args must not contain %q: %v", forbidden, args)
		}
	}
}

func TestGrokBuildArgs_WithModel(t *testing.T) {
	cfg := &Config{Mode: "new", WorkDir: ".", Backend: "grok", GrokModel: "grok-4.5"}
	args := buildGrokArgs(cfg, "task")

	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-m grok-4.5") {
		t.Fatalf("args missing -m grok-4.5: %v", args)
	}
}

func TestGrokBuildArgs_NilConfig(t *testing.T) {
	if args := buildGrokArgs(nil, "x"); args != nil {
		t.Fatalf("nil config should return nil args, got %v", args)
	}
}

func TestGrokBackend_Metadata(t *testing.T) {
	b := GrokBackend{}
	if b.Name() != "grok" {
		t.Fatalf("name = %s, want grok", b.Name())
	}
	if b.Command() == "" {
		t.Fatalf("command must not be empty")
	}
}

func TestParseJSONStream_GrokEvents(t *testing.T) {
	stream := `{"type":"thought","data":"thinking"}
{"type":"thought","data":" more"}
{"type":"text","data":"Hello"}
{"type":"text","data":" world"}
{"type":"end","stopReason":"EndTurn","sessionId":"019f-abc","requestId":"req-1"}
`
	var sessionFromCallback string
	message, threadID, terminalError := parseJSONStreamInternalWithContent(
		strings.NewReader(stream), nil, nil, nil, nil, nil, nil,
		func(id string) { sessionFromCallback = id },
	)

	if message != "Hello world" {
		t.Fatalf("message = %q, want %q", message, "Hello world")
	}
	if threadID != "019f-abc" {
		t.Fatalf("threadID = %q, want %q", threadID, "019f-abc")
	}
	if sessionFromCallback != "019f-abc" {
		t.Fatalf("onSessionStarted got %q, want %q", sessionFromCallback, "019f-abc")
	}
	if terminalError != "" {
		t.Fatalf("terminalError = %q, want empty", terminalError)
	}
}

func TestParseJSONStream_GrokThoughtsExcludedFromMessage(t *testing.T) {
	stream := `{"type":"thought","data":"secret reasoning"}
{"type":"text","data":"answer"}
{"type":"end","stopReason":"EndTurn","sessionId":"s1","requestId":"r1"}
`
	message, _ := parseJSONStreamInternal(strings.NewReader(stream), nil, nil, nil, nil)
	if message != "answer" {
		t.Fatalf("message = %q, want %q (thoughts must not leak)", message, "answer")
	}
}

func TestParseJSONStream_GrokStreamsSafeIntermediateEvents(t *testing.T) {
	stream := `{"type":"thought","data":"hidden reasoning"}
{"type":"tool_call","toolCallId":"tool-1","toolName":"read_file","title":"Read file","status":"in_progress","rawInput":{"path":"secret.txt"}}
{"type":"tool_call_update","toolCallId":"tool-1","toolName":"read_file","title":"Read file","status":"completed","rawOutput":"secret output"}
{"type":"plan","entries":[{"title":"Inspect parser","status":"in_progress"}]}
{"type":"text","data":"Hello"}
{"type":"text","data":" world"}
{"type":"end","stopReason":"EndTurn","sessionId":"grok-session"}
`
	var content []string
	complete := 0
	message, _, terminalError := parseJSONStreamInternalWithContent(
		strings.NewReader(stream), nil, nil, nil, func() { complete++ },
		func(text, kind string) { content = append(content, kind+":"+text) }, nil, nil,
	)
	joined := strings.Join(content, "\n")
	if message != "Hello world" || terminalError != "" || complete != 1 {
		t.Fatalf("got message=%q error=%q complete=%d", message, terminalError, complete)
	}
	for _, want := range []string{"command:tool started: read_file (Read file)", "command:tool completed: read_file (Read file)", "reasoning:plan: Inspect parser [in_progress]", "message:Hello", "message: world"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("content missing %q: %q", want, joined)
		}
	}
	for _, secret := range []string{"hidden reasoning", "secret.txt", "secret output"} {
		if strings.Contains(joined, secret) {
			t.Fatalf("content leaked %q: %q", secret, joined)
		}
	}
}

func TestParseJSONStream_GrokTerminalFailureIsNotSuccess(t *testing.T) {
	stream := `{"type":"text","data":"partial"}
{"type":"end","stopReason":"cancelled","sessionId":"grok-session"}`
	message, _, terminalError := parseJSONStreamInternalWithContent(strings.NewReader(stream), nil, nil, nil, nil, nil, nil, nil)
	if message != "partial" || !strings.Contains(terminalError, "cancelled") {
		t.Fatalf("got message=%q terminalError=%q", message, terminalError)
	}
}

func TestPiBuildArgs_ReadOnlyJSONMode(t *testing.T) {
	cfg := &Config{Mode: "new", WorkDir: "/tmp/project", Backend: "pi"}
	want := []string{
		"--mode", "json",
		"--no-approve",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--no-context-files",
		"--tools", "read,grep,find,ls",
	}
	if got := buildPiArgs(cfg, ""); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestPiBuildArgs_ResumeOmitsPrompt(t *testing.T) {
	cfg := &Config{Mode: "resume", SessionID: "pi-session", Backend: "pi"}
	prompt := "--approve @secrets.txt"
	args := buildPiArgs(cfg, prompt)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "--session pi-session") {
		t.Fatalf("resume args missing --session: %v", args)
	}
	if slices.Contains(args, prompt) {
		t.Fatalf("Pi prompt must not be passed in argv: %v", args)
	}
}

func TestPiBuildArgs_NilConfig(t *testing.T) {
	if args := buildPiArgs(nil, "x"); args != nil {
		t.Fatalf("nil config should return nil args, got %v", args)
	}
}

func TestPiBackend_Metadata(t *testing.T) {
	b := PiBackend{}
	if b.Name() != "pi" || b.Command() != "pi" {
		t.Fatalf("metadata = (%q, %q), want (pi, pi)", b.Name(), b.Command())
	}
}

func TestParseJSONStream_PiEvents(t *testing.T) {
	stream := `{"type":"session","version":3,"id":"pi-session"}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Hello"},{"type":"text","text":" world"}]}}
{"type":"agent_end"}
`
	var sessionFromCallback string
	message, threadID, terminalError := parseJSONStreamInternalWithContent(
		strings.NewReader(stream), nil, nil, nil, nil, nil, nil,
		func(id string) { sessionFromCallback = id },
	)

	if message != "Hello world" {
		t.Fatalf("message = %q, want %q", message, "Hello world")
	}
	if threadID != "pi-session" || sessionFromCallback != "pi-session" {
		t.Fatalf("session IDs = (%q, %q), want pi-session", threadID, sessionFromCallback)
	}
	if terminalError != "" {
		t.Fatalf("terminalError = %q, want empty", terminalError)
	}
}

func TestParseJSONStream_PiStreamsSafeIntermediateEventsWithoutDuplicatingFinal(t *testing.T) {
	stream := `{"type":"session","version":3,"id":"pi-session"}
{"type":"message_start","message":{"role":"assistant"}}
{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"Hel"}}
{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","contentIndex":1,"delta":"hidden reasoning"}}
{"type":"tool_execution_start","toolCallId":"tool-1","toolName":"read","args":{"path":"secret.txt"}}
{"type":"tool_execution_update","toolCallId":"tool-1","toolName":"read","partialResult":"secret output"}
{"type":"tool_execution_end","toolCallId":"tool-1","toolName":"read","result":"secret output","isError":false}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Hello"}],"stopReason":"stop"}}
{"type":"agent_end"}
`
	var content []string
	complete := 0
	message, _, terminalError := parseJSONStreamInternalWithContent(
		strings.NewReader(stream), nil, nil, nil, func() { complete++ },
		func(text, kind string) { content = append(content, kind+":"+text) }, nil, nil,
	)
	joined := strings.Join(content, "\n")
	if message != "Hello" || terminalError != "" || complete != 1 {
		t.Fatalf("got message=%q error=%q complete=%d", message, terminalError, complete)
	}
	for _, want := range []string{"message:Hel", "message:lo", "command:tool started: read", "command:tool running: read", "command:tool completed: read"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("content missing %q: %q", want, joined)
		}
	}
	if strings.Count(joined, "Hel") != 1 || strings.Count(joined, "lo") != 1 {
		t.Fatalf("final text was duplicated: %q", joined)
	}
	for _, secret := range []string{"hidden reasoning", "secret.txt", "secret output"} {
		if strings.Contains(joined, secret) {
			t.Fatalf("content leaked %q: %q", secret, joined)
		}
	}
}

func TestParseJSONStream_ProviderMissingTerminalFails(t *testing.T) {
	tests := map[string]string{
		"pi": `{"type":"session","id":"pi-session"}
{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"partial"}}`,
		"grok": `{"type":"text","data":"partial"}`,
		"gemini": `{"type":"init","session_id":"gemini-session"}
{"type":"message","role":"assistant","content":"partial","delta":true}`,
	}
	for name, stream := range tests {
		t.Run(name, func(t *testing.T) {
			_, _, terminalError := parseJSONStreamInternalWithContent(strings.NewReader(stream), nil, nil, nil, nil, nil, nil, nil)
			if !strings.Contains(strings.ToLower(terminalError), "missing terminal") {
				t.Fatalf("terminalError = %q, want missing terminal", terminalError)
			}
		})
	}
}

func TestParseJSONStream_PiTerminalFailureClearsPartialMessage(t *testing.T) {
	for _, stopReason := range []string{"error", "aborted"} {
		t.Run(stopReason, func(t *testing.T) {
			stream := `{"type":"session","version":3,"id":"pi-session"}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"stale partial"}],"stopReason":"stop"}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"must not escape"}],"stopReason":"` + stopReason + `","errorMessage":"provider failed"}}
{"type":"agent_end"}
`
			message, threadID, terminalError := parseJSONStreamInternalWithContent(
				strings.NewReader(stream), nil, nil, nil, nil, nil, nil, nil,
			)
			if message != "" {
				t.Fatalf("message = %q, want empty after terminal failure", message)
			}
			if threadID != "pi-session" {
				t.Fatalf("threadID = %q, want pi-session", threadID)
			}
			if !strings.Contains(terminalError, stopReason) || !strings.Contains(terminalError, "provider failed") {
				t.Fatalf("terminalError = %q, want stop reason and provider error", terminalError)
			}
		})
	}
}

func TestParseJSONStream_PiIgnoresUnknownAndNonTextEvents(t *testing.T) {
	stream := `{"type":"session","version":3,"id":"pi-session"}
{"type":"future_event","payload":{"value":1}}
{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"not the answer"}]}}
{"type":"turn_end","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hidden"},{"type":"text","text":"answer"}]}}
{"type":"agent_end"}
`
	message, threadID := parseJSONStream(strings.NewReader(stream))
	if message != "answer" || threadID != "pi-session" {
		t.Fatalf("got (%q, %q), want (answer, pi-session)", message, threadID)
	}
}
