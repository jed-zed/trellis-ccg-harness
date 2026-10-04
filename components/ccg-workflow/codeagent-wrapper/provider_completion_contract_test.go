package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSelectedProviderTerminalCompletesBeforeEOF(t *testing.T) {
	fixtures := []struct {
		name  string
		parse selectedProviderParser
		text  string
	}{
		{"kimi", parseKimiStream, "{\"role\":\"assistant\",\"content\":\"done\"}\n{\"role\":\"meta\",\"type\":\"session.resume_hint\",\"session_id\":\"kimi-one\"}\n"},
		{"opencode", parseOpencodeStream, "{\"type\":\"text\",\"sessionID\":\"open-one\",\"part\":{\"type\":\"text\",\"id\":\"part-one\",\"text\":\"done\"}}\n{\"type\":\"step_finish\",\"sessionID\":\"open-one\",\"part\":{\"type\":\"step-finish\",\"reason\":\"stop\"}}\n"},
	}
	for _, fixture := range fixtures {
		t.Run(fixture.name, func(t *testing.T) {
			r, w := io.Pipe()
			defer r.Close()
			defer w.Close()
			completed := make(chan struct{}, 2)
			finished := make(chan parseResult, 1)
			var calls atomic.Int32
			go func() {
				message, session, err := fixture.parse(r, nil, nil, nil, func() { calls.Add(1); completed <- struct{}{} }, nil, nil, nil)
				finished <- parseResult{message: message, threadID: session, err: err}
			}()
			if _, err := io.WriteString(w, fixture.text); err != nil {
				t.Fatal(err)
			}
			select {
			case <-completed:
			case <-time.After(time.Second):
				t.Fatal("terminal event did not notify before EOF")
			}
			select {
			case <-finished:
				t.Fatal("parser stopped draining before EOF")
			default:
			}
			_ = r.Close()
			select {
			case result := <-finished:
				if result.message != "done" || result.err != "" || calls.Load() != 1 {
					t.Fatalf("terminal close changed result: %+v callbacks=%d", result, calls.Load())
				}
			case <-time.After(time.Second):
				t.Fatal("terminal parser failed to stop after owned pipe close")
			}
		})
	}
}

type completionContractBackend struct{ name, executable string }

func (b completionContractBackend) Name() string    { return b.name }
func (b completionContractBackend) Command() string { return b.executable }
func (b completionContractBackend) BuildArgs(cfg *Config, text string) []string {
	if b.name == "kimi" {
		return buildKimiArgs(cfg, text)
	}
	return buildOpencodeArgs(cfg, text)
}

func TestSelectedProviderTerminalBoundsLingeringExecutor(t *testing.T) {
	for _, fixture := range []struct{ name, text string }{
		{"kimi", "{\"role\":\"assistant\",\"content\":\"done\"}\n{\"role\":\"meta\",\"type\":\"session.resume_hint\",\"session_id\":\"one\"}\n"},
		{"opencode", "{\"type\":\"text\",\"sessionID\":\"one\",\"part\":{\"type\":\"text\",\"id\":\"a\",\"text\":\"done\"}}\n{\"type\":\"step_finish\",\"sessionID\":\"one\",\"part\":{\"type\":\"step-finish\",\"reason\":\"stop\"}}\n"},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			defer resetTestHooks()
			t.Setenv("CODEAGENT_POST_MESSAGE_DELAY", "0")
			previousLite := liteMode
			liteMode = false
			t.Cleanup(func() { liteMode = previousLite })
			fake := newFakeCmd(fakeCmdConfig{StdoutPlan: []fakeStdoutEvent{{Data: fixture.text}}, KeepStdoutOpen: true, BlockWait: true, ReleaseWaitOnSignal: true, ReleaseWaitOnKill: true, WaitErr: errors.New("owned backend terminated")})
			t.Cleanup(func() { _ = fake.process.Kill() })
			newCommandRunner = func(context.Context, string, ...string) commandRunner { return fake }
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			started := time.Now()
			result := runCodexTaskWithContext(context.Background(), TaskSpec{Task: "one\ntwo", WorkDir: t.TempDir(), AllowNativeAutoApproval: true}, completionContractBackend{name: fixture.name, executable: executable}, nil, false, true, 10)
			if result.ExitCode != 0 || result.Message != "done" || time.Since(started) >= 5*time.Second {
				t.Fatalf("lingering provider was not bounded: %+v elapsed=%v", result, time.Since(started))
			}
			if strings.Contains(result.Error, "timeout") || fake.process.KillCount() == 0 && fake.process.SignalCount() == 0 {
				t.Fatalf("expected terminal cleanup without timeout: %+v", result)
			}
		})
	}
}

// These optional contracts execute only --help against an explicitly selected
// installed CLI. They never build provider prompt arguments or call a model.
func TestSelectedProviderInstalledHelpContract(t *testing.T) {
	for _, fixture := range []struct {
		name, pathEnv string
		wantHelp      []string
	}{
		{"kimi", "CCG_CONTRACT_KIMI_SHIM", []string{"--prompt", "--output-format", "stream-json", "--session", "--model"}},
		{"opencode", "CCG_CONTRACT_OPENCODE_EXE", []string{"run", "--help", "--version"}},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			path := os.Getenv(fixture.pathEnv)
			if path == "" {
				t.Skip("set " + fixture.pathEnv + " to explicitly select an installed CLI for --help only")
			}
			var command string
			var args []string
			var err error
			if fixture.name == "kimi" {
				command, args, err = resolveOfficialProviderNpmShim(fixture.name, path, []string{"--help"})
				if err == nil && (len(args) != 2 || args[1] != "--help" || filepath.Base(args[0]) != "main.mjs") {
					t.Fatalf("unexpected direct Node help invocation: %s %v", command, args)
				}
			} else {
				command, args, err = resolveProviderCommandInvocation(fixture.name, path, []string{"--help"})
				if err == nil && (command != path || len(args) != 1 || args[0] != "--help") {
					t.Fatalf("unexpected native help invocation: %s %v", command, args)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, command, args...)
			isolatedHome := t.TempDir()
			cmd.Dir = isolatedHome
			cmd.Env = append(os.Environ(), "HOME="+isolatedHome, "USERPROFILE="+isolatedHome,
				"APPDATA="+filepath.Join(isolatedHome, "appdata"), "LOCALAPPDATA="+filepath.Join(isolatedHome, "localappdata"),
				"KIMI_CODE_HOME="+filepath.Join(isolatedHome, "kimi"), "XDG_CONFIG_HOME="+filepath.Join(isolatedHome, "config"),
				"XDG_DATA_HOME="+filepath.Join(isolatedHome, "data"), "XDG_STATE_HOME="+filepath.Join(isolatedHome, "state"),
				"XDG_CACHE_HOME="+filepath.Join(isolatedHome, "cache"), "OPENCODE_DISABLE_AUTOUPDATE=true")
			output, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatalf("official --help failed: %v\n%s", err, output)
			}
			for _, expected := range fixture.wantHelp {
				if !strings.Contains(string(output), expected) {
					t.Fatalf("official --help lacks %q:\n%s", expected, output)
				}
			}
			t.Logf("verified %s invocation: executable=%s args=%v; help contains %v", fixture.name, command, args, fixture.wantHelp)
		})
	}
}

func TestProviderJSONLinePreservesCompleteBufferedTailOnReadError(t *testing.T) {
	for _, finalError := range []error{io.EOF, io.ErrClosedPipe, os.ErrClosed} {
		t.Run(finalError.Error(), func(t *testing.T) {
			// The unfinished newline-free record is exactly two reader buffers.
			// Its JSON must be retained and consumed before considering EOF/close.
			raw := `{"value":"` + strings.Repeat("x", 2*jsonLineReaderSize-len(`{"value":""}`)) + `"}`
			if len(raw) != 2*jsonLineReaderSize {
				t.Fatalf("invalid fixture length=%d", len(raw))
			}
			reader := io.MultiReader(strings.NewReader(raw), completionReadFailure{finalError})
			consumed := 0
			err := walkProviderJSONLines(reader, "fixture", func() bool { return true }, func(event json.RawMessage) string {
				consumed++
				if string(event) != raw {
					return "buffered tail changed"
				}
				return ""
			})
			if err != "" || consumed != 1 {
				t.Fatalf("buffered tail lost: consumed=%d error=%q", consumed, err)
			}
		})
	}
}

type completionReadFailure struct{ err error }

func (r completionReadFailure) Read([]byte) (int, error) { return 0, r.err }

func TestSelectedProviderTerminalStillRejectsLateErrorsAndTruncatedData(t *testing.T) {
	fixtures := []struct {
		name            string
		parse           selectedProviderParser
		text, lateError string
	}{
		{"kimi", parseKimiStream, "{\"role\":\"assistant\",\"content\":\"done\"}\n{\"role\":\"meta\",\"type\":\"session.resume_hint\",\"session_id\":\"one\"}\n", `{"role":"assistant","content":"invalid late answer"}`},
		{"opencode", parseOpencodeStream, "{\"type\":\"text\",\"sessionID\":\"one\",\"part\":{\"type\":\"text\",\"id\":\"a\",\"text\":\"done\"}}\n{\"type\":\"step_finish\",\"sessionID\":\"one\",\"part\":{\"type\":\"step-finish\",\"reason\":\"stop\"}}\n", `{"type":"error","sessionID":"one","error":{"name":"APIError","data":{"message":"late backend failure"}}}`},
	}
	for _, fixture := range fixtures {
		for _, tc := range []struct {
			name, suffix, wantError string
			readError               error
		}{
			{"late-provider-error", fixture.lateError + "\n", "", io.EOF},
			{"late-invalid-json", "{broken}\n", "expected a JSON object", io.ErrClosedPipe},
			{"truncated-at-eof", `{\"unfinished`, "expected a JSON object", io.EOF},
			{"truncated-at-owned-close", `{\"unfinished`, "expected a JSON object", io.ErrClosedPipe},
			{"long-truncated-at-owned-close", `{"unfinished":"` + strings.Repeat("x", 2*jsonLineReaderSize), "expected a JSON object", io.ErrClosedPipe},
			{"long-truncated-at-file-close", `{"unfinished":"` + strings.Repeat("x", 2*jsonLineReaderSize), "expected a JSON object", os.ErrClosed},
			{"aligned-truncated-at-owned-close", strings.Repeat("x", 4*jsonLineReaderSize-len(fixture.text)), "expected a JSON object", io.ErrClosedPipe},
			{"aligned-truncated-at-eof", strings.Repeat("x", 4*jsonLineReaderSize-len(fixture.text)), "expected a JSON object", io.EOF},
			{"line-buffer-aligned-at-owned-close", strings.Repeat("x", 2*jsonLineReaderSize), "expected a JSON object", io.ErrClosedPipe},
			{"line-buffer-aligned-at-eof", strings.Repeat("x", 2*jsonLineReaderSize), "expected a JSON object", io.EOF},
			{"reader-failure-after-terminal", "", "unrelated read failure", errors.New("unrelated read failure")},
			{"oversize-before-owned-close", strings.Repeat("x", jsonLineMaxBytes+1), "exceeds", io.ErrClosedPipe},
		} {
			t.Run(fixture.name+"/"+tc.name, func(t *testing.T) {
				var completed int
				var progress []string
				r := io.MultiReader(strings.NewReader(fixture.text+tc.suffix), completionReadFailure{tc.readError})
				message, _, err := fixture.parse(r, nil, nil, nil, func() { completed++ }, nil, func(line string) { progress = append(progress, line) }, nil)
				if err == "" || tc.wantError != "" && !strings.Contains(err, tc.wantError) {
					t.Fatalf("late failure lost: message=%q error=%q want=%q", message, err, tc.wantError)
				}
				if message != "done" || completed != 1 || strings.Contains(strings.Join(progress, "\n"), "session_completed") {
					t.Fatalf("failure changed buffered answer or emitted success: message=%q callbacks=%d progress=%v", message, completed, progress)
				}
			})
		}
	}
}
