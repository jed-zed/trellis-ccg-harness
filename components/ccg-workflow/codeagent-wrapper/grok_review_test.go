package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNormalizeGrokReviewTargets(t *testing.T) {
	workDir := t.TempDir()
	if err := os.Mkdir(filepath.Join(workDir, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"a.go", filepath.Join("nested", "b.go")} {
		if err := os.WriteFile(filepath.Join(workDir, name), []byte("package test\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	got, err := normalizeGrokReviewTargets(workDir, []string{"a.go", filepath.Join("nested", "b.go")})
	if err != nil {
		t.Fatalf("normalize targets: %v", err)
	}
	if strings.Join(got, ",") != "a.go,nested/b.go" {
		t.Fatalf("targets = %v", got)
	}

	for name, target := range map[string]string{
		"absolute": filepath.Join(workDir, "a.go"),
		"escape":   filepath.Join("..", "outside.go"),
		"missing":  "missing.go",
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := normalizeGrokReviewTargets(workDir, []string{target}); err == nil {
				t.Fatalf("target %q should fail", target)
			}
		})
	}

	link := filepath.Join(workDir, "link.go")
	if err := os.Symlink(filepath.Join(workDir, "a.go"), link); err == nil {
		if _, err := normalizeGrokReviewTargets(workDir, []string{"link.go"}); err == nil {
			t.Fatal("symlink target should fail")
		}
	}
}

func TestParseArgsGrokReviewTargets(t *testing.T) {
	originalArgs := os.Args
	os.Args = []string{
		"codeagent-wrapper",
		"--backend", "grok",
		"--grok-review-target", "a.go",
		"--grok-review-target=nested/b.go",
		"review",
	}
	t.Cleanup(func() { os.Args = originalArgs })

	cfg, err := parseArgs()
	if err != nil {
		t.Fatalf("parse args: %v", err)
	}
	if strings.Join(cfg.GrokReviewTargets, ",") != "a.go,nested/b.go" {
		t.Fatalf("review targets = %v", cfg.GrokReviewTargets)
	}
}

func TestGrokBuildArgs_ReviewModeKeepsSnapshotAndNativePermissions(t *testing.T) {
	args := buildGrokArgs(&Config{
		Mode:              "new",
		Backend:           "grok",
		GrokReviewTargets: []string{"a.go"},
	}, "review-prompt.md")

	for _, pair := range [][2]string{
		{"--system-prompt-override", grokReviewSystemPrompt},
		{"--output-format", "streaming-json"},
		{"--prompt-file", "review-prompt.md"},
	} {
		if !hasArgPair(args, pair[0], pair[1]) {
			t.Fatalf("review args missing %q %q: %v", pair[0], pair[1], args)
		}
	}
	for _, flag := range []string{"--always-approve", "--verbatim", "--no-auto-update"} {
		if !hasArg(args, flag) {
			t.Fatalf("review args missing %q: %v", flag, args)
		}
	}
	for _, forbidden := range []string{"--tools", "--disallowed-tools", "--disable-web-search", "--no-memory", "--no-plan", "--no-subagents", "--permission-mode", "--deny", "--sandbox", "-p", "-r"} {
		if hasArg(args, forbidden) {
			t.Fatalf("review args must not contain %q: %v", forbidden, args)
		}
	}
}

func TestPrepareGrokReviewSnapshot(t *testing.T) {
	workDir := t.TempDir()
	if err := os.Mkdir(filepath.Join(workDir, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{
		"a.go":                          "package a\n",
		filepath.Join("nested", "b.go"): "package b\n",
		"unbound-secret.txt":            "MUST_NOT_APPEAR\n",
	} {
		if err := os.WriteFile(filepath.Join(workDir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	snapshot, err := prepareGrokReviewSnapshot(workDir, "find bugs", []string{"a.go", "nested/b.go"})
	if err != nil {
		t.Fatalf("prepare snapshot: %v", err)
	}
	promptPath := snapshot.promptFile
	t.Cleanup(snapshot.cleanup)

	prompt, err := os.ReadFile(promptPath)
	if err != nil {
		t.Fatal(err)
	}
	text := string(prompt)
	for _, want := range []string{"find bugs", "package a", "package b", `path="a.go"`, `path="nested/b.go"`} {
		if !strings.Contains(text, want) {
			t.Fatalf("prompt missing %q: %s", want, text)
		}
	}
	if strings.Contains(text, "MUST_NOT_APPEAR") {
		t.Fatalf("prompt disclosed unbound file: %s", text)
	}
	if strings.Join(snapshot.targets, ",") != "a.go,nested/b.go" {
		t.Fatalf("targets = %v", snapshot.targets)
	}
	if filepath.Clean(snapshot.root) == filepath.Clean(workDir) || filepath.Dir(promptPath) != snapshot.root {
		t.Fatalf("snapshot not isolated: root=%q prompt=%q workdir=%q", snapshot.root, promptPath, workDir)
	}
	if !isWindows() {
		rootInfo, err := os.Stat(snapshot.root)
		if err != nil {
			t.Fatal(err)
		}
		promptInfo, err := os.Stat(promptPath)
		if err != nil {
			t.Fatal(err)
		}
		if rootInfo.Mode().Perm() != 0o700 || promptInfo.Mode().Perm() != 0o600 {
			t.Fatalf("snapshot permissions = %o/%o", rootInfo.Mode().Perm(), promptInfo.Mode().Perm())
		}
	}

	snapshot.cleanup()
	if _, err := os.Stat(promptPath); !os.IsNotExist(err) {
		t.Fatalf("snapshot prompt still exists after cleanup: %v", err)
	}
}

func TestPrepareGrokReviewSnapshotFailsClosed(t *testing.T) {
	t.Run("non UTF-8", func(t *testing.T) {
		workDir := t.TempDir()
		if err := os.WriteFile(filepath.Join(workDir, "bad.txt"), []byte{0xff}, 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := prepareGrokReviewSnapshot(workDir, "review", []string{"bad.txt"}); err == nil || !strings.Contains(err.Error(), "not UTF-8") {
			t.Fatalf("error = %v", err)
		}
	})

	t.Run("identity change", func(t *testing.T) {
		workDir := t.TempDir()
		target := filepath.Join(workDir, "a.go")
		if err := os.WriteFile(target, []byte("old\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		originalOpen := openGrokReviewTarget
		openGrokReviewTarget = func(name string) (*os.File, error) {
			if err := os.Remove(name); err != nil {
				return nil, err
			}
			if err := os.WriteFile(name, []byte("replacement\n"), 0o600); err != nil {
				return nil, err
			}
			return os.Open(name)
		}
		t.Cleanup(func() { openGrokReviewTarget = originalOpen })

		if _, err := prepareGrokReviewSnapshot(workDir, "review", []string{"a.go"}); err == nil || !strings.Contains(err.Error(), "changed while snapshotting") {
			t.Fatalf("error = %v", err)
		}
	})
}

func TestFinalizeGrokReview(t *testing.T) {
	complete := func() *grokReviewEvidence {
		evidence := newGrokReviewEvidence()
		evidence.observeStopReason("end_turn")
		return evidence
	}

	got, err := finalizeGrokReview("review complete", []string{"a.go", "b.go"}, complete())
	if err != nil {
		t.Fatalf("finalize review: %v", err)
	}
	wantSuffix := `CCG_GROK_REVIEW_JSON:{"schemaVersion":1,"reviewedFiles":["a.go","b.go"],"findings":[]}`
	if !strings.HasSuffix(got, wantSuffix) || strings.Count(got, grokReviewMarker) != 1 {
		t.Fatalf("message = %q", got)
	}

	if _, err := finalizeGrokReview("review complete\n"+grokReviewMarker+`{}`, []string{"a.go"}, complete()); err == nil || !strings.Contains(err.Error(), "must not contain") {
		t.Fatalf("model-envelope error = %v", err)
	}
	if _, err := finalizeGrokReview("review complete", []string{"a.go"}, newGrokReviewEvidence()); err == nil || !strings.Contains(err.Error(), "terminal stop reason") {
		t.Fatalf("missing-stop error = %v", err)
	}
	errorStop := complete()
	errorStop.observeStopReason("error")
	if _, err := finalizeGrokReview("review complete", []string{"a.go"}, errorStop); err == nil || !strings.Contains(err.Error(), "stop reason") {
		t.Fatalf("error-stop error = %v", err)
	}
}

func TestParseGrokReviewAcceptsToolEvents(t *testing.T) {
	for name, stream := range map[string]string{
		"ACP": strings.Join([]string{
			`{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"call-1","rawInput":{"variant":"ReadFile","target_file":"a.go"}}}}`,
			`{"method":"_x.ai/session/update","params":{"update":{"sessionUpdate":"turn_completed","stop_reason":"end_turn"}}}`,
			`{"type":"text","data":"done"}`,
			`{"type":"end","stopReason":"EndTurn","sessionId":"session-1"}`,
		}, "\n"),
		"streaming JSON": strings.Join([]string{
			`{"type":"tool_call","toolCallId":"call-read","title":"read_file","toolName":"read_file","rawInput":{"target_file":"a.go"},"content":[]}`,
			`{"type":"text","data":"done"}`,
			`{"type":"end","stopReason":"end_turn","sessionId":"session-1"}`,
		}, "\n"),
	} {
		t.Run(name, func(t *testing.T) {
			evidence := newGrokReviewEvidence()
			message, threadID, terminalError := parseJSONStreamInternalWithReview(
				strings.NewReader(stream), nil, nil, nil, nil, nil, nil, nil, evidence,
			)
			if message != "done" || threadID != "session-1" || terminalError != "" {
				t.Fatalf("parse result = (%q, %q, %q)", message, threadID, terminalError)
			}
			if !evidence.stopReasonSeen {
				t.Fatalf("evidence = %+v", evidence)
			}
		})
	}
}

func TestRunGrokReviewUsesIsolatedPromptSnapshot(t *testing.T) {
	workDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(workDir, "a.go"), []byte("package allowed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "secret.txt"), []byte("MUST_NOT_APPEAR\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	fake := newFakeCmd(fakeCmdConfig{StdoutPlan: []fakeStdoutEvent{{Data: strings.Join([]string{
		`{"type":"text","data":"review complete"}`,
		`{"type":"end","stopReason":"EndTurn","sessionId":"session-1"}`,
	}, "\n") + "\n"}}})
	originalRunner := newCommandRunner
	originalLite := liteMode
	var capturedArgs []string
	var capturedPromptPath string
	var capturedPrompt string
	newCommandRunner = func(_ context.Context, _ string, args ...string) commandRunner {
		capturedArgs = append([]string(nil), args...)
		capturedPromptPath = argValue(args, "--prompt-file")
		data, err := os.ReadFile(capturedPromptPath)
		if err != nil {
			t.Fatalf("read prompt before launch: %v", err)
		}
		capturedPrompt = string(data)
		return fake
	}
	liteMode = true
	t.Cleanup(func() {
		newCommandRunner = originalRunner
		liteMode = originalLite
	})

	result := runCodexTaskWithContext(context.Background(), TaskSpec{
		Task:              "review this file",
		WorkDir:           workDir,
		Backend:           "grok",
		UseStdin:          true,
		GrokReviewTargets: []string{"a.go"},
	}, GrokBackend{}, nil, false, true, 2)
	if result.ExitCode != 0 {
		t.Fatalf("result = %+v", result)
	}
	if !strings.Contains(result.Message, "review complete\n"+grokReviewMarker) {
		t.Fatalf("message = %q", result.Message)
	}
	if !strings.Contains(capturedPrompt, "package allowed") || strings.Contains(capturedPrompt, "MUST_NOT_APPEAR") {
		t.Fatalf("prompt = %q", capturedPrompt)
	}
	if capturedPromptPath == "" || filepath.Dir(capturedPromptPath) != fake.Dir() || filepath.Clean(fake.Dir()) == filepath.Clean(workDir) {
		t.Fatalf("args=%v prompt=%q dir=%q workdir=%q", capturedArgs, capturedPromptPath, fake.Dir(), workDir)
	}
	if fake.stdinClaim {
		t.Fatal("snapshot review must not pipe the prompt through stdin")
	}
	if _, err := os.Stat(capturedPromptPath); !os.IsNotExist(err) {
		t.Fatalf("prompt snapshot still exists after run: %v", err)
	}
}

func TestRunGrokReviewRejectsResumeBeforeLaunch(t *testing.T) {
	workDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(workDir, "a.go"), []byte("package test\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runnerCalled := false
	originalRunner := newCommandRunner
	newCommandRunner = func(context.Context, string, ...string) commandRunner {
		runnerCalled = true
		return newFakeCmd(fakeCmdConfig{})
	}
	t.Cleanup(func() { newCommandRunner = originalRunner })

	result := runCodexTaskWithContext(context.Background(), TaskSpec{
		Task:              "review",
		WorkDir:           workDir,
		Backend:           "grok",
		Mode:              "resume",
		SessionID:         "session-1",
		GrokReviewTargets: []string{"a.go"},
	}, GrokBackend{}, nil, false, true, 2)
	if result.ExitCode == 0 || !strings.Contains(result.Error, "fresh session") || runnerCalled {
		t.Fatalf("result=%+v runnerCalled=%v", result, runnerCalled)
	}
}

func hasArg(args []string, want string) bool {
	for _, arg := range args {
		if arg == want {
			return true
		}
	}
	return false
}

func hasArgPair(args []string, flag, value string) bool {
	return argValue(args, flag) == value && hasArg(args, flag)
}

func argValue(args []string, flag string) string {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == flag {
			return args[i+1]
		}
	}
	return ""
}
