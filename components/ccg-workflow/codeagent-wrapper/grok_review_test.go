package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
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

func TestGrokBuildArgs_ReviewModeIsReadOnly(t *testing.T) {
	args := buildGrokArgs(&Config{
		Mode:              "new",
		Backend:           "grok",
		GrokReviewTargets: []string{"a.go"},
	}, "review")
	joined := strings.Join(args, " ")
	if strings.Contains(joined, "--always-approve") {
		t.Fatalf("review args must not contain --always-approve: %v", args)
	}
	for _, want := range []string{
		"--tools read_file,grep,list_dir",
		"--disable-web-search",
		"--no-memory",
		"--no-plan",
		"--no-subagents",
		"--permission-mode dontAsk",
		"--deny mcp__*",
		"--output-format streaming-json",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("review args missing %q: %v", want, args)
		}
	}
}

func TestValidateGrokReview(t *testing.T) {
	workDir := t.TempDir()
	for _, name := range []string{"a.go", "b.go", "other.go"} {
		if err := os.WriteFile(filepath.Join(workDir, name), []byte("package test\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	targets, err := normalizeGrokReviewTargets(workDir, []string{"a.go", "b.go"})
	if err != nil {
		t.Fatal(err)
	}

	completed := func(variant, path string) *grokReviewEvidence {
		evidence := newGrokReviewEvidence()
		evidence.observeACP(json.RawMessage(`{"sessionUpdate":"tool_call_update","toolCallId":"call-1","kind":"read","rawInput":{"variant":"` + variant + `","target_file":"` + path + `","path":"` + path + `"}}`))
		evidence.observeACP(json.RawMessage(`{"sessionUpdate":"tool_call_update","toolCallId":"call-1","status":"completed"}`))
		evidence.observeStopReason("end_turn")
		return evidence
	}
	validMessage := func(files ...string) string {
		payload, err := json.Marshal(map[string]any{
			"schemaVersion": 1,
			"reviewedFiles": files,
			"findings":      []any{},
		})
		if err != nil {
			t.Fatal(err)
		}
		return "review complete\n" + grokReviewMarker + string(payload)
	}

	tests := []struct {
		name     string
		message  string
		evidence *grokReviewEvidence
		wantErr  string
	}{
		{
			name:     "generic prose without reads",
			message:  validMessage("a.go", "b.go"),
			evidence: func() *grokReviewEvidence { e := newGrokReviewEvidence(); e.observeStopReason("end_turn"); return e }(),
			wantErr:  "missing completed read evidence",
		},
		{
			name:     "unrelated read",
			message:  validMessage("a.go", "b.go"),
			evidence: completed("ReadFile", "other.go"),
			wantErr:  "missing completed read evidence",
		},
		{
			name:     "only one of two targets",
			message:  validMessage("a.go", "b.go"),
			evidence: completed("ReadFile", "a.go"),
			wantErr:  "b.go",
		},
		{
			name:    "valid read and exact grep",
			message: validMessage("b.go", "a.go"),
			evidence: func() *grokReviewEvidence {
				e := completed("ReadFile", "a.go")
				e.observeACP(json.RawMessage(`{"sessionUpdate":"tool_call_update","toolCallId":"call-2","kind":"search","rawInput":{"variant":"Grep","path":"b.go"}}`))
				e.observeACP(json.RawMessage(`{"sessionUpdate":"tool_call_update","toolCallId":"call-2","status":"completed"}`))
				return e
			}(),
		},
		{
			name:    "error stop reason",
			message: validMessage("a.go", "b.go"),
			evidence: func() *grokReviewEvidence {
				e := completed("ReadFile", "a.go")
				e.observeStopReason("error")
				return e
			}(),
			wantErr: "stop reason",
		},
		{
			name:     "mismatched envelope",
			message:  validMessage("a.go"),
			evidence: completed("ReadFile", "a.go"),
			wantErr:  "reviewedFiles",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateGrokReview(workDir, tt.message, targets, tt.evidence)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("validate review: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error = %v, want substring %q", err, tt.wantErr)
			}
		})
	}
}

func TestParseGrokReviewACP(t *testing.T) {
	evidence := newGrokReviewEvidence()
	stream := strings.Join([]string{
		`{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"call-1","rawInput":{"target_file":"a.go"}}}}`,
		`{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"call-1","kind":"read","rawInput":{"variant":"ReadFile","target_file":"a.go"}}}}`,
		`{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"call-1","status":"completed"}}}`,
		`{"method":"_x.ai/session/update","params":{"update":{"sessionUpdate":"turn_completed","stop_reason":"end_turn"}}}`,
		`{"type":"text","data":"done"}`,
		`{"type":"end","stopReason":"EndTurn","sessionId":"session-1"}`,
	}, "\n")

	message, threadID, terminalError := parseJSONStreamInternalWithReview(
		strings.NewReader(stream), nil, nil, nil, nil, nil, nil, nil, evidence,
	)
	if message != "done" || threadID != "session-1" || terminalError != "" {
		t.Fatalf("parse result = (%q, %q, %q)", message, threadID, terminalError)
	}
	call := evidence.calls["call-1"]
	if call == nil || call.variant != "ReadFile" || call.path != "a.go" || !call.completed {
		t.Fatalf("evidence call = %+v", call)
	}
}

func TestParseGrokReviewStreamingJSON(t *testing.T) {
	evidence := newGrokReviewEvidence()
	var warnings []string
	stream := strings.Join([]string{
		`{"type":"tool_call","toolCallId":"call-read","title":"read_file","toolName":"read_file","rawInput":{"target_file":"a.go"},"content":[]}`,
		`{"type":"tool_call_update","toolCallId":"call-read","status":null,"content":[],"rawOutput":null}`,
		`{"type":"tool_call_update","toolCallId":"call-read","status":"completed","content":[{"type":"content","content":{"type":"text","text":"package test"}}]}`,
		`{"type":"tool_call","toolCallId":"call-grep","title":"grep","toolName":"grep","rawInput":{"pattern":"package","path":"b.go"},"content":[]}`,
		`{"type":"tool_call_update","toolCallId":"call-grep","status":"completed","content":[{"type":"content","content":{"type":"text","text":"found 1 matches"}}]}`,
		`{"type":"text","data":"done"}`,
		`{"type":"end","stopReason":"end_turn","sessionId":"session-1"}`,
	}, "\n")

	message, threadID, terminalError := parseJSONStreamInternalWithReview(
		strings.NewReader(stream), func(message string) { warnings = append(warnings, message) }, nil, nil, nil, nil, nil, nil, evidence,
	)
	if message != "done" || threadID != "session-1" || terminalError != "" || len(warnings) != 0 {
		t.Fatalf("parse result = (%q, %q, %q), warnings = %v", message, threadID, terminalError, warnings)
	}
	for id, want := range map[string]grokToolCall{
		"call-read": {variant: "ReadFile", path: "a.go", completed: true},
		"call-grep": {variant: "Grep", path: "b.go", completed: true},
	} {
		call := evidence.calls[id]
		if call == nil || *call != want {
			t.Fatalf("%s = %+v, want %+v", id, call, want)
		}
	}
}

func TestRunGrokReviewFailsClosedWithoutReadEvidence(t *testing.T) {
	workDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(workDir, "a.go"), []byte("package test\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(map[string]any{
		"schemaVersion": 1,
		"reviewedFiles": []string{"a.go"},
		"findings":      []any{},
	})
	if err != nil {
		t.Fatal(err)
	}
	fake := newFakeCmd(fakeCmdConfig{StdoutPlan: []fakeStdoutEvent{{Data: strings.Join([]string{
		`{"type":"text","data":` + strconv.Quote("review complete\n"+grokReviewMarker+string(payload)) + `}`,
		`{"type":"end","stopReason":"EndTurn","sessionId":"session-1"}`,
	}, "\n") + "\n"}}})
	originalRunner := newCommandRunner
	originalLite := liteMode
	newCommandRunner = func(context.Context, string, ...string) commandRunner { return fake }
	liteMode = true
	t.Cleanup(func() {
		newCommandRunner = originalRunner
		liteMode = originalLite
	})

	result := runCodexTaskWithContext(context.Background(), TaskSpec{
		Task:              "review",
		WorkDir:           workDir,
		Backend:           "grok",
		GrokReviewTargets: []string{"a.go"},
	}, GrokBackend{}, nil, false, true, 2)
	if result.ExitCode == 0 || !strings.Contains(result.Error, "missing completed read evidence") {
		t.Fatalf("result = %+v", result)
	}
}
