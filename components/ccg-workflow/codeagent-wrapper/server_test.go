package main

import (
	"context"
	"errors"
	"net"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type flushRecorder struct {
	*httptest.ResponseRecorder
	flushed chan struct{}
}

type blockingFlushRecorder struct {
	*httptest.ResponseRecorder
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (r *blockingFlushRecorder) Write(data []byte) (int, error) {
	r.once.Do(func() { close(r.started) })
	<-r.release
	return r.ResponseRecorder.Write(data)
}

func (r *blockingFlushRecorder) Flush() {}

func (r *flushRecorder) Flush() {
	r.ResponseRecorder.Flush()
	select {
	case r.flushed <- struct{}{}:
	default:
	}
}

func TestWebServerStartBindsIPv4LoopbackOnly(t *testing.T) {
	sentinel := errors.New("stop after capturing listen address")
	originalListen := listenWebServer
	t.Cleanup(func() {
		listenWebServer = originalListen
	})

	var network, address string
	listenWebServer = func(gotNetwork, gotAddress string) (net.Listener, error) {
		network = gotNetwork
		address = gotAddress
		return nil, sentinel
	}

	err := NewWebServer("test").Start()
	if !errors.Is(err, sentinel) {
		t.Fatalf("Start() error = %v, want %v", err, sentinel)
	}
	if network != "tcp" {
		t.Fatalf("listen network = %q, want %q", network, "tcp")
	}
	if address != "127.0.0.1:0" {
		t.Fatalf("listen address = %q, want IPv4 loopback", address)
	}
}

func TestNewWebServerKeepsProductionBrowserOpener(t *testing.T) {
	if NewWebServer("test").browserOpener == nil {
		t.Fatal("NewWebServer() browser opener = nil, want production opener")
	}
}

func TestWebServerStartInvokesConfiguredBrowserOpener(t *testing.T) {
	opened := make(chan string, 1)
	server := NewWebServer("test")
	server.browserOpener = func(url string) {
		opened <- url
	}
	t.Cleanup(func() {
		_ = server.Stop()
	})

	if err := server.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	select {
	case url := <-opened:
		if !strings.HasPrefix(url, "http://127.0.0.1:") {
			t.Fatalf("browser URL = %q, want IPv4 loopback URL", url)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("configured browser opener was not called")
	}
}

func TestWebServerStartAllowsDisabledBrowserOpener(t *testing.T) {
	server := NewWebServer("test")
	server.browserOpener = nil
	t.Cleanup(func() {
		_ = server.Stop()
	})

	if err := server.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
}

func TestExecutorTestFactoryDisablesBrowserOpener(t *testing.T) {
	if newWebServerForExecution("test").browserOpener != nil {
		t.Fatal("test WebServer factory retained the production browser opener")
	}
}

func TestWebServerReplaysHistoryToLateSubscribers(t *testing.T) {
	for _, completed := range []bool{false, true} {
		name := "running"
		if completed {
			name = "completed"
		}
		t.Run(name, func(t *testing.T) {
			server := NewWebServer("antigravity")
			server.StartSession("session-1", "antigravity", "task")
			server.SendContentWithType("session-1", "antigravity", "early output", "reasoning")
			server.SendContentWithType("session-1", "antigravity", "tool status", "command")
			if completed {
				server.EndSession("session-1", "antigravity")
			}

			ctx, cancel := context.WithCancel(context.Background())
			recorder := &flushRecorder{ResponseRecorder: httptest.NewRecorder(), flushed: make(chan struct{}, 2)}
			request := httptest.NewRequest("GET", "/api/stream/session-1", nil).WithContext(ctx)
			done := make(chan struct{})
			go func() {
				server.handleStream(recorder, request)
				close(done)
			}()

			if !completed {
				select {
				case <-recorder.flushed:
				case <-time.After(time.Second):
					t.Fatal("history was not flushed")
				}
				server.SendContentWithType("session-1", "antigravity", " live output", "message")
				select {
				case <-recorder.flushed:
				case <-time.After(time.Second):
					t.Fatal("live output was not flushed")
				}
				cancel()
			}
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("stream handler did not stop")
			}
			cancel()

			body := recorder.Body.String()
			if !strings.Contains(body, `"content":"early output"`) || !strings.Contains(body, `"content_type":"reasoning"`) ||
				!strings.Contains(body, `"content":"tool status"`) || !strings.Contains(body, `"content_type":"command"`) {
				t.Fatalf("history replay missing from %q", body)
			}
			if strings.Count(body, `"content":"early output"`) != 1 {
				t.Fatalf("history replayed more than once: %q", body)
			}
			if completed {
				contentAt, doneAt := strings.Index(body, `"content":"early output"`), strings.Index(body, `"done":true`)
				toolAt := strings.Index(body, `"content":"tool status"`)
				if doneAt < 0 || contentAt > toolAt || toolAt > doneAt {
					t.Fatalf("completed replay did not send history before done: %q", body)
				}
			} else if liveAt := strings.Index(body, `"content":" live output"`); liveAt < 0 || strings.Index(body, `"content":"early output"`) > liveAt {
				t.Fatalf("running replay did not send history before live output: %q", body)
			}
		})
	}
}

func TestWebServerReplaysEmptyCompletedSession(t *testing.T) {
	server := NewWebServer("antigravity")
	server.StartSession("session-1", "antigravity", "task")
	server.EndSession("session-1", "antigravity")
	recorder := &flushRecorder{ResponseRecorder: httptest.NewRecorder(), flushed: make(chan struct{}, 1)}
	server.handleStream(recorder, httptest.NewRequest("GET", "/api/stream/session-1", nil))
	body := recorder.Body.String()
	if !strings.Contains(body, `"done":true`) || strings.Contains(body, `"content":`) {
		t.Fatalf("empty completed replay = %q", body)
	}
}

func TestWebServerDoesNotDropLiveBurstOrDoneWhileClientIsBlocked(t *testing.T) {
	server := NewWebServer("antigravity")
	server.StartSession("session-1", "antigravity", "task")
	server.SendContent("session-1", "antigravity", "initial")

	recorder := &blockingFlushRecorder{
		ResponseRecorder: httptest.NewRecorder(),
		started:          make(chan struct{}),
		release:          make(chan struct{}),
	}
	done := make(chan struct{})
	go func() {
		server.handleStream(recorder, httptest.NewRequest("GET", "/api/stream/session-1", nil))
		close(done)
	}()

	select {
	case <-recorder.started:
	case <-time.After(time.Second):
		t.Fatal("stream did not begin replay")
	}
	for index := 0; index < 110; index++ {
		server.SendContent("session-1", "antigravity", "live")
	}
	server.EndSession("session-1", "antigravity")
	close(recorder.release)

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("stream handler did not deliver terminal event")
	}
	body := recorder.Body.String()
	if got := strings.Count(body, `"content":`); got != 111 {
		t.Fatalf("content events = %d, want 111", got)
	}
	if got := strings.Count(body, `"done":true`); got != 1 {
		t.Fatalf("done events = %d, want 1", got)
	}
}

func TestWebServerResumesAfterLastEventIDWithoutDuplicates(t *testing.T) {
	server := NewWebServer("claude")
	server.StartSession("session-1", "claude", "task")
	server.SendContent("session-1", "claude", "first")
	server.SendContent("session-1", "claude", "second")
	server.SendContent("session-1", "claude", "third")
	server.EndSession("session-1", "claude")

	request := httptest.NewRequest("GET", "/api/stream/session-1", nil)
	request.Header.Set("Last-Event-ID", "2")
	recorder := &flushRecorder{ResponseRecorder: httptest.NewRecorder(), flushed: make(chan struct{}, 2)}
	server.handleStream(recorder, request)
	body := recorder.Body.String()
	if strings.Contains(body, `"content":"first"`) || strings.Contains(body, `"content":"second"`) {
		t.Fatalf("reconnect duplicated acknowledged history: %q", body)
	}
	if !strings.Contains(body, "id: 3\n") || !strings.Contains(body, `"content":"third"`) || !strings.Contains(body, "id: 4\n") || !strings.Contains(body, `"done":true`) {
		t.Fatalf("reconnect omitted missing history or terminal event: %q", body)
	}
}

func TestWebServerFailureTerminalAndAuthoritativeReplacementUI(t *testing.T) {
	server := NewWebServer("pi")
	server.StartSession("session-1", "pi", "task")
	server.EndSessionWithStatus("session-1", "pi", 7, "failed")
	recorder := &flushRecorder{ResponseRecorder: httptest.NewRecorder(), flushed: make(chan struct{}, 1)}
	server.handleStream(recorder, httptest.NewRequest("GET", "/api/stream/session-1", nil))
	body := recorder.Body.String()
	if !strings.Contains(body, `"exit_code":7`) || !strings.Contains(body, `"status":"failed"`) {
		t.Fatalf("failure terminal omitted authoritative status: %q", body)
	}

	html := server.generateIndexHTML()
	for _, want := range []string{"case 'replace_message':", "querySelectorAll('.assistant-output')", "'✗ 失败 (exit code ' + exitCode + ')'", "if (ok) {"} {
		if !strings.Contains(html, want) {
			t.Fatalf("preview HTML missing %q", want)
		}
	}
}
