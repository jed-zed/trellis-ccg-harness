package main

import (
	"fmt"
	"io"
	"strings"
	"testing"
)

type providerParserCallbacks struct {
	content   []string
	progress  []string
	sessions  []string
	warnings  []string
	messages  int
	completed int
}

type selectedProviderParser func(io.Reader, func(string), func(string), func(), func(), func(string, string), func(string), func(string)) (string, string, string)

func runSelectedProviderFixture(input string, parser selectedProviderParser) (message, session, terminalError string, calls providerParserCallbacks) {
	message, session, terminalError = parser(strings.NewReader(input),
		func(w string) { calls.warnings = append(calls.warnings, w) }, nil,
		func() { calls.messages++ }, func() { calls.completed++ },
		func(text, kind string) { calls.content = append(calls.content, kind+":"+text) },
		func(line string) { calls.progress = append(calls.progress, line) },
		func(id string) { calls.sessions = append(calls.sessions, id) })
	return
}

func TestKimiStreamOfficialFixtureSessionProgressAndToolIsolation(t *testing.T) {
	// Event field contract: MoonshotAI/kimi-code 21406fb4c805cc8c715e6d1f16ad3fb5f25f4fe3
	// apps/kimi-code/src/cli/prompt-render.ts; official npm @moonshot-ai/kimi-code 2.1.1.
	input := strings.Join([]string{
		`{"role":"meta","type":"system.version","version":"2.1.1"}`,
		`{"role":"assistant","content":"Checking. ","tool_calls":[{"type":"function","id":"tool1","function":{"name":"ReadFile","arguments":"{\"path\":\"file\"}"}}]}`,
		`{"role":"tool","tool_call_id":"tool1","content":"this tool result is not the answer"}`,
		`{"role":"meta","type":"turn.step.retrying","failed_attempt":1,"next_attempt":2,"max_attempts":3,"delay_ms":100,"error_name":"APIError","error_message":"transient"}`,
		`{"role":"assistant","content":"Finished."}`,
		`{"role":"meta","type":"session.resume_hint","session_id":"kimi-session","command":"kimi -r kimi-session","content":"To resume this session"}`,
	}, "\n")
	message, session, err, calls := runSelectedProviderFixture(input, parseKimiStream)
	if message != "Checking. Finished." || session != "kimi-session" || err != "" {
		t.Fatalf("result=%q %q %q", message, session, err)
	}
	if calls.messages != 2 || calls.completed != 1 || len(calls.sessions) != 1 {
		t.Fatalf("callbacks=%+v", calls)
	}
	for _, value := range []string{"tool_started", "tool_done", "api_retry", "session_started id=kimi-session", "session_completed"} {
		if !strings.Contains(strings.Join(calls.progress, "\n"), value) {
			t.Fatalf("missing progress %q in %q", value, calls.progress)
		}
	}
	if strings.Contains(strings.Join(calls.content, "\n"), "this tool result") || strings.Contains(message, "resume") || strings.Contains(message, "transient") {
		t.Fatalf("non-answer content leaked: %+v", calls)
	}
}

func TestKimiStreamFailureAndPartialOutputContracts(t *testing.T) {
	cases := []struct{ name, input, wantError string }{
		{"missing-success-tail", `{"role":"assistant","content":"partial"}`, "missing terminal resume hint"},
		{"missing-response", `{"role":"meta","type":"session.resume_hint","session_id":"sid"}`, "missing assistant response"},
		{"empty-session", `{"role":"meta","type":"session.resume_hint","session_id":" "}`, "missing session_id"},
		{"legacy-python-array", `{"role":"assistant","content":[{"type":"text","text":"legacy"}]}`, "must be a string"},
		{"invalid-json", "provider error text\n", "expected a JSON object"},
		{"json-array", `[{"role":"assistant","content":"no"}]`, "expected a JSON object"},
		{"invalid-tool-calls", `{"role":"assistant","tool_calls":"broken"}`, "parse Kimi event"},
		{"duplicate-tail", `{"role":"meta","type":"session.resume_hint","session_id":"sid"}` + "\n" + `{"role":"meta","type":"session.resume_hint","session_id":"sid"}`, "duplicate terminal"},
		{"assistant-after-tail", `{"role":"meta","type":"session.resume_hint","session_id":"sid"}` + "\n" + `{"role":"assistant","content":"late"}`, "followed terminal"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err, calls := runSelectedProviderFixture(tc.input, parseKimiStream)
			if !strings.Contains(err, tc.wantError) {
				t.Fatalf("error=%q, want %q", err, tc.wantError)
			}
			if calls.completed != 1 || strings.Contains(strings.Join(calls.progress, "\n"), "session_completed") {
				t.Fatalf("failure completion incorrectly successful: %+v", calls)
			}
		})
	}
}

func TestKimiStreamDoesNotConsumeOtherProviderMessagesOrSessions(t *testing.T) {
	input := strings.Join([]string{
		`{"type":"init","sessionId":"gemini-session"}`,
		`{"type":"message","role":"assistant","content":"Gemini should not appear","delta":true}`,
		`{"type":"text","sessionID":"open-session","part":{"type":"text","text":"OpenCode should not appear"}}`,
		`{"type":"text","data":"Grok should not appear","sessionId":"grok-session"}`,
		`{"role":"assistant","content":"Kimi answer"}`,
		`{"role":"meta","type":"session.resume_hint","session_id":"kimi-session"}`,
	}, "\n")
	message, session, err, calls := runSelectedProviderFixture(input, parseKimiStream)
	if message != "Kimi answer" || session != "kimi-session" || err != "" || len(calls.sessions) != 1 {
		t.Fatalf("result=%q %q %q %+v", message, session, err, calls)
	}
}

func TestOpencodeStreamOfficialFixtureSessionProgressAndTools(t *testing.T) {
	// Official run JSONL emit contract: anomalyco/opencode packages/opencode/src/cli/cmd/run.ts.
	input := strings.Join([]string{
		`{"type":"step_start","timestamp":1,"sessionID":"ses_1","part":{"id":"s1","sessionID":"ses_1","type":"step-start"}}`,
		`{"type":"text","timestamp":2,"sessionID":"ses_1","part":{"id":"text1","sessionID":"ses_1","type":"text","text":"Checking. "}}`,
		`{"type":"tool_use","sessionID":"ses_1","part":{"type":"tool","tool":"read","state":{"status":"completed","output":"tool output"}}}`,
		`{"type":"step_finish","sessionID":"ses_1","part":{"type":"step-finish","reason":"tool-calls"}}`,
		`{"type":"step_start","sessionID":"ses_1","part":{"type":"step-start"}}`,
		`{"type":"reasoning","sessionID":"ses_1","part":{"type":"reasoning","text":"private reasoning"}}`,
		`{"type":"text","sessionID":"ses_1","part":{"id":"text2","type":"text","text":"Done."}}`,
		`{"type":"text","sessionID":"ses_1","part":{"id":"text2","type":"text","text":"Done."}}`,
		`{"type":"step_finish","sessionID":"ses_1","part":{"type":"step-finish","reason":"stop"}}`,
	}, "\n")
	message, session, err, calls := runSelectedProviderFixture(input, parseOpencodeStream)
	if message != "Checking. Done." || session != "ses_1" || err != "" {
		t.Fatalf("result=%q %q %q", message, session, err)
	}
	if calls.messages != 2 || calls.completed != 1 || len(calls.sessions) != 1 {
		t.Fatalf("callbacks=%+v", calls)
	}
	for _, value := range []string{"session_started id=ses_1", "turn_started", "tool_done", "session_completed"} {
		if !strings.Contains(strings.Join(calls.progress, "\n"), value) {
			t.Fatalf("missing progress %q in %q", value, calls.progress)
		}
	}
	if strings.Contains(message, "reasoning") || strings.Contains(message, "tool output") {
		t.Fatal("non-answer content leaked")
	}
	if !strings.Contains(strings.Join(calls.content, "\n"), "reasoning:private reasoning") {
		t.Fatal("reasoning callback lost")
	}
}

func TestOpencodeStreamFailureAndPartialOutputContracts(t *testing.T) {
	text := `{"type":"text","sessionID":"ses_1","part":{"id":"text1","type":"text","text":"partial"}}`
	cases := []struct{ name, suffix, wantError string }{
		{"partial-no-terminal", "", "missing terminal stop"},
		{"toolcalls-only-terminal", `{"type":"step_finish","sessionID":"ses_1","part":{"type":"step-finish","reason":"tool-calls"}}`, "missing terminal stop"},
		{"length-stop", `{"type":"step_finish","sessionID":"ses_1","part":{"type":"step-finish","reason":"length"}}`, "stopped with reason"},
		{"provider-error", `{"type":"error","sessionID":"ses_1","error":{"name":"APIError","data":{"message":"provider denied"}}}`, "provider denied"},
		{"plain-error", `{"type":"error","sessionID":"ses_1","error":"plain failure"}`, "plain failure"},
		{"empty-error", `{"type":"error","sessionID":"ses_1"}`, "reported an error"},
		{"changed-session", `{"type":"step_finish","sessionID":"ses_other","part":{"type":"step-finish","reason":"stop"}}`, "changed sessionID"},
		{"part-session-mismatch", `{"type":"step_finish","sessionID":"ses_1","part":{"sessionID":"ses_other","type":"step-finish","reason":"stop"}}`, "part sessionID mismatch"},
		{"null-part", `{"type":"step_finish","sessionID":"ses_1","part":null}`, "missing part"},
		{"part-shape-error", `{"type":"text","sessionID":"ses_1","part":{"type":"reasoning","text":"must not be answer"}}`, "part type mismatch"},
		{"changed-completed-part", `{"type":"text","sessionID":"ses_1","part":{"id":"text1","type":"text","text":"changed"}}`, "completed text part changed"},
		{"invalid-json", `{broken}`, "expected a JSON object"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err, calls := runSelectedProviderFixture(text+"\n"+tc.suffix, parseOpencodeStream)
			if !strings.Contains(err, tc.wantError) {
				t.Fatalf("error=%q, want %q", err, tc.wantError)
			}
			if calls.completed != 1 || strings.Contains(strings.Join(calls.progress, "\n"), "session_completed") {
				t.Fatalf("failure completion incorrectly successful: %+v", calls)
			}
		})
	}
}

func TestOpencodeStreamDoesNotConsumeOtherProviderMessagesOrSessions(t *testing.T) {
	input := strings.Join([]string{
		`{"type":"text","data":"Grok should not appear","sessionId":"grok-session"}`,
		`{"type":"message","role":"assistant","content":"Gemini should not appear","sessionId":"gemini-session"}`,
		`{"role":"assistant","content":"Kimi should not appear"}`,
		`{"role":"meta","type":"session.resume_hint","session_id":"kimi-session"}`,
		`{"type":"text","sessionID":"ses_open","part":{"type":"text","text":"OpenCode answer"}}`,
		`{"type":"step_finish","sessionID":"ses_open","part":{"type":"step-finish","reason":"stop"}}`,
	}, "\n")
	message, session, err, calls := runSelectedProviderFixture(input, parseOpencodeStream)
	if message != "OpenCode answer" || session != "ses_open" || err != "" || len(calls.sessions) != 1 {
		t.Fatalf("result=%q %q %q %+v", message, session, err, calls)
	}
}

type providerFixtureReadFailure struct{}

func (providerFixtureReadFailure) Read([]byte) (int, error) {
	return 0, fmt.Errorf("fixture read failed")
}

func TestSelectedProviderParsersRejectOversizeAndReaderFailure(t *testing.T) {
	for name, parser := range map[string]selectedProviderParser{"kimi": parseKimiStream, "opencode": parseOpencodeStream} {
		t.Run(name, func(t *testing.T) {
			_, _, err, calls := runSelectedProviderFixture(strings.Repeat("x", jsonLineMaxBytes+1), parser)
			if !strings.Contains(err, "exceeds") || calls.completed != 1 {
				t.Fatalf("oversize=%q %+v", err, calls)
			}
			_, _, err = parser(providerFixtureReadFailure{}, nil, nil, nil, nil, nil, nil, nil)
			if !strings.Contains(err, "read failed") {
				t.Fatalf("read error=%q", err)
			}
		})
	}
}
