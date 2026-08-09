package main

import (
	"io"
	"os"
	"strings"
	"testing"
)

func TestParseAntigravityStreamPublishesStepsAndReturnsResult(t *testing.T) {
	stream := strings.Join([]string{
		`{"event":"init","conversation_id":"conversation-1","init":{"cwd":"/repo","tools":[]}}`,
		`{"event":"step_update","step_update":{"conversation_id":"conversation-1","step_index":0,"state":"ACTIVE","step_type":"agent_response","text_delta":"Hello"}}`,
		`{"event":"step_update","step_update":{"conversation_id":"conversation-1","step_index":1,"state":"DONE","step_type":"tool","text_delta":"read config","tool_name":"read_file"}}`,
		`{"event":"result","result":{"conversation_id":"conversation-1","status":"success","response":"Hello world","duration_seconds":1.2,"num_turns":1}}`,
	}, "\n")

	var content []string
	var progress []string
	var sessionID string
	messageCount := 0
	completeCount := 0
	var callbackOrder []string
	message, threadID, terminalError := parseAntigravityStream(
		strings.NewReader(stream), nil, nil,
		func() { messageCount++ },
		func() { completeCount++; callbackOrder = append(callbackOrder, "complete") },
		func(text, contentType string) {
			content = append(content, contentType+":"+text)
			callbackOrder = append(callbackOrder, "content:"+text)
		},
		func(line string) { progress = append(progress, line) },
		func(id string) { sessionID = id },
	)

	if terminalError != "" || message != "Hello world" || threadID != "conversation-1" || sessionID != "conversation-1" {
		t.Fatalf("parse result = (%q, %q, %q), callback session=%q", message, threadID, terminalError, sessionID)
	}
	if strings.Join(content, "|") != "message:Hello|command:read config|message: world" {
		t.Fatalf("content = %v", content)
	}
	if messageCount == 0 || completeCount != 1 || len(progress) == 0 {
		t.Fatalf("callbacks: messages=%d complete=%d progress=%v", messageCount, completeCount, progress)
	}
	if callbackOrder[len(callbackOrder)-1] != "complete" {
		t.Fatalf("completion preceded final content: %v", callbackOrder)
	}
}

func TestParseAntigravityStreamPublishesPublicToolMetadata(t *testing.T) {
	stream := strings.Join([]string{
		`{"event":"step_update","step_update":{"conversation_id":"c","step_index":1,"state":"ACTIVE","step_type":"tool","tool_name":"read_file","tool_info":{"parameters":{"path":"secret"}}}}`,
		`{"event":"result","result":{"conversation_id":"c","status":"SUCCESS","response":"done"}}`,
	}, "\n")
	var content []string
	message, _, terminalError := parseAntigravityStream(strings.NewReader(stream), nil, nil, nil, nil, func(text, contentType string) {
		content = append(content, contentType+":"+text)
	}, nil, nil)
	if terminalError != "" || message != "done" || strings.Join(content, "|") != "command:tool ACTIVE: read_file|message:done" {
		t.Fatalf("message=%q terminalError=%q content=%v", message, terminalError, content)
	}
	if strings.Contains(strings.Join(content, "|"), "secret") {
		t.Fatalf("tool parameters leaked into public content: %v", content)
	}
}

func TestParseAntigravityStreamReplacesDivergentTerminalText(t *testing.T) {
	stream := strings.Join([]string{
		`{"event":"step_update","step_update":{"conversation_id":"c","step_index":0,"state":"ACTIVE","step_type":"agent_response","text_delta":"draft"}}`,
		`{"event":"result","result":{"conversation_id":"c","status":"success","response":"authoritative"}}`,
	}, "\n")
	var content []string
	message, _, terminalError := parseAntigravityStream(strings.NewReader(stream), nil, nil, nil, nil, func(text, contentType string) {
		content = append(content, contentType+":"+text)
	}, nil, nil)
	if terminalError != "" || message != "authoritative" || strings.Join(content, "|") != "message:draft|replace_message:authoritative" {
		t.Fatalf("message=%q terminalError=%q content=%v", message, terminalError, content)
	}
}

func TestParseAntigravityStreamBoundsUnknownEventWarnings(t *testing.T) {
	stream := strings.Repeat("{\"event\":\"future_event\"}\n", 5) +
		`{"event":"result","result":{"conversation_id":"c","status":"SUCCESS","response":"done"}}`
	warnings := 0
	message, _, terminalError := parseAntigravityStream(strings.NewReader(stream), func(string) {
		warnings++
	}, nil, nil, nil, nil, nil, nil)
	if terminalError != "" || message != "done" || warnings != 3 {
		t.Fatalf("message=%q terminalError=%q warnings=%d", message, terminalError, warnings)
	}
}

func TestParseAntigravityStreamHandlesClosedPipeOnlyAfterResult(t *testing.T) {
	terminal := `{"event":"result","result":{"conversation_id":"c","status":"success","response":"done"}}` + "\n"
	message, threadID, terminalError := parseAntigravityStream(
		io.MultiReader(strings.NewReader(terminal), errReader{err: os.ErrClosed}),
		nil, nil, nil, nil, nil, nil, nil,
	)
	if terminalError != "" || message != "done" || threadID != "c" {
		t.Fatalf("message=%q threadID=%q terminalError=%q", message, threadID, terminalError)
	}

	message, _, terminalError = parseAntigravityStream(errReader{err: os.ErrClosed}, nil, nil, nil, nil, nil, nil, nil)
	if message != "" || !strings.Contains(terminalError, "read Antigravity stream") {
		t.Fatalf("message=%q terminalError=%q", message, terminalError)
	}
}

func TestParseAntigravityStreamFailsClosed(t *testing.T) {
	tests := map[string]struct {
		stream string
		want   string
	}{
		"missing result": {
			stream: `{"event":"step_update","step_update":{"conversation_id":"c","state":"DONE","step_type":"agent_response","text_delta":"partial"}}`,
			want:   "missing terminal result",
		},
		"failed result": {
			stream: `{"event":"result","result":{"conversation_id":"c","status":"error","response":"partial","error":"boom"}}`,
			want:   "status",
		},
		"duplicate result": {
			stream: strings.Join([]string{
				`{"event":"result","result":{"conversation_id":"c","status":"success","response":"done"}}`,
				`{"event":"result","result":{"conversation_id":"c","status":"success","response":"again"}}`,
			}, "\n"),
			want: "duplicate terminal result",
		},
		"malformed event": {
			stream: `{not-json}`,
			want:   "parse",
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			message, _, terminalError := parseAntigravityStream(strings.NewReader(test.stream), nil, nil, nil, nil, nil, nil, nil)
			if message != "" || !strings.Contains(strings.ToLower(terminalError), test.want) {
				t.Fatalf("message=%q terminalError=%q, want %q", message, terminalError, test.want)
			}
		})
	}
}
