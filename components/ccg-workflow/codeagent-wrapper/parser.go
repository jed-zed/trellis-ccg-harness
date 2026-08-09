package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
)

// JSONEvent represents a Codex JSON output event
type JSONEvent struct {
	Type     string     `json:"type"`
	ThreadID string     `json:"thread_id,omitempty"`
	Item     *EventItem `json:"item,omitempty"`
}

// EventItem represents the item field in a JSON event
type EventItem struct {
	Type string      `json:"type"`
	Text interface{} `json:"text"`
}

// ClaudeEvent for Claude stream-json format
type ClaudeEvent struct {
	Type      string `json:"type"`
	Subtype   string `json:"subtype,omitempty"`
	SessionID string `json:"session_id,omitempty"`
	Result    string `json:"result,omitempty"`
}

// GeminiEvent for Gemini stream-json format
type GeminiEvent struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id,omitempty"`
	Role      string `json:"role,omitempty"`
	Content   string `json:"content,omitempty"`
	Delta     bool   `json:"delta,omitempty"`
	Status    string `json:"status,omitempty"`
}

func parseJSONStream(r io.Reader) (message, threadID string) {
	return parseJSONStreamWithLog(r, logWarn, logInfo)
}

func parseJSONStreamWithWarn(r io.Reader, warnFn func(string)) (message, threadID string) {
	return parseJSONStreamWithLog(r, warnFn, logInfo)
}

func parseJSONStreamWithLog(r io.Reader, warnFn func(string), infoFn func(string)) (message, threadID string) {
	return parseJSONStreamInternal(r, warnFn, infoFn, nil, nil)
}

const (
	jsonLineReaderSize   = 64 * 1024
	jsonLineMaxBytes     = 10 * 1024 * 1024
	jsonLinePreviewBytes = 256
)

type codexHeader struct {
	Type     string `json:"type"`
	ThreadID string `json:"thread_id,omitempty"`
	Item     *struct {
		Type string `json:"type"`
	} `json:"item,omitempty"`
}

// UnifiedEvent combines all backend event formats into a single structure
// to avoid multiple JSON unmarshal operations per event
type UnifiedEvent struct {
	// Common fields
	Type   string `json:"type"`
	ID     string `json:"id,omitempty"`
	Method string `json:"method,omitempty"`
	Params struct {
		Update json.RawMessage `json:"update,omitempty"`
	} `json:"params,omitempty"`

	// Codex-specific fields
	ThreadID string          `json:"thread_id,omitempty"`
	Item     json.RawMessage `json:"item,omitempty"` // Lazy parse

	// Claude-specific fields
	Subtype            string          `json:"subtype,omitempty"`
	SessionID          string          `json:"session_id,omitempty"`
	Result             string          `json:"result,omitempty"`
	Event              json.RawMessage `json:"event,omitempty"`
	IsError            bool            `json:"is_error,omitempty"`
	IsErrorCamel       bool            `json:"isError,omitempty"`
	Attempt            int             `json:"attempt,omitempty"`
	MaxRetries         int             `json:"max_retries,omitempty"`
	RetryDelayMS       int             `json:"retry_delay_ms,omitempty"`
	ToolName           string          `json:"tool_name,omitempty"`
	ElapsedTimeSeconds float64         `json:"elapsed_time_seconds,omitempty"`

	// Gemini-specific fields
	// Gemini CLI uses camelCase "sessionId" instead of snake_case "session_id"
	SessionIDCamel string `json:"sessionId,omitempty"`
	Role           string `json:"role,omitempty"`
	Content        string `json:"content,omitempty"`
	Delta          *bool  `json:"delta,omitempty"`
	Status         string `json:"status,omitempty"`

	// Grok-specific fields (grok --output-format streaming-json):
	//   {"type":"thought","data":"..."}  — reasoning token deltas
	//   {"type":"text","data":"..."}     — response token deltas
	//   {"type":"end","stopReason":"EndTurn","sessionId":"...","requestId":"..."}
	Data          string          `json:"data,omitempty"`
	StopReason    string          `json:"stopReason,omitempty"`
	ToolNameCamel string          `json:"toolName,omitempty"`
	Title         string          `json:"title,omitempty"`
	Entries       json.RawMessage `json:"entries,omitempty"`

	// Pi-specific fields (pi --mode json)
	Message               json.RawMessage `json:"message,omitempty"`
	AssistantMessageEvent *struct {
		Type  string `json:"type,omitempty"`
		Delta string `json:"delta,omitempty"`
	} `json:"assistantMessageEvent,omitempty"`
}

type grokReviewEvidence struct {
	stopReasonSeen bool
	terminalError  string
	forbiddenTool  string
}

func newGrokReviewEvidence() *grokReviewEvidence {
	return &grokReviewEvidence{}
}

func (e *grokReviewEvidence) observeACP(raw json.RawMessage) {
	if e == nil || len(raw) == 0 {
		return
	}
	var update struct {
		SessionUpdate string `json:"sessionUpdate"`
		StopReason    string `json:"stop_reason"`
		RawInput      struct {
			Variant string `json:"variant"`
		} `json:"rawInput"`
	}
	if json.Unmarshal(raw, &update) != nil {
		return
	}
	if update.SessionUpdate == "turn_completed" {
		e.observeStopReason(update.StopReason)
		return
	}
	if update.SessionUpdate != "tool_call" && update.SessionUpdate != "tool_call_update" {
		return
	}
	e.observeToolCall(update.RawInput.Variant)
}

func (e *grokReviewEvidence) observeStreamingJSON(raw json.RawMessage) bool {
	if e == nil || len(raw) == 0 {
		return false
	}
	var update struct {
		Type     string `json:"type"`
		ToolName string `json:"toolName"`
	}
	if json.Unmarshal(raw, &update) != nil || (update.Type != "tool_call" && update.Type != "tool_call_update") {
		return false
	}
	e.observeToolCall(update.ToolName)
	return true
}

func (e *grokReviewEvidence) observeToolCall(tool string) {
	if e == nil || e.forbiddenTool != "" {
		return
	}
	tool = strings.TrimSpace(tool)
	if tool == "" {
		tool = "unknown"
	}
	e.forbiddenTool = tool
}

func (e *grokReviewEvidence) observeStopReason(reason string) {
	if e == nil || strings.TrimSpace(reason) == "" {
		return
	}
	e.stopReasonSeen = true
	normalized := strings.NewReplacer("_", "", "-", "").Replace(strings.ToLower(strings.TrimSpace(reason)))
	if normalized != "endturn" && e.terminalError == "" {
		e.terminalError = reason
	}
}

// GetSessionID returns the session ID from either snake_case or camelCase field.
// Gemini CLI uses "sessionId" (camelCase), Claude/Codex use "session_id" (snake_case).
func (e *UnifiedEvent) GetSessionID() string {
	if e.SessionID != "" {
		return e.SessionID
	}
	return e.SessionIDCamel
}

// ItemContent represents the parsed item.text field for Codex events
type ItemContent struct {
	Type string      `json:"type"`
	Text interface{} `json:"text"`
}

func parseJSONStreamInternal(r io.Reader, warnFn func(string), infoFn func(string), onMessage func(), onComplete func()) (message, threadID string) {
	message, threadID, _ = parseJSONStreamInternalWithContent(r, warnFn, infoFn, onMessage, onComplete, nil, nil, nil)
	return message, threadID
}

func parseJSONStreamInternalWithContent(r io.Reader, warnFn func(string), infoFn func(string), onMessage func(), onComplete func(), onContent func(content, contentType string), onProgress func(line string), onSessionStarted func(id string)) (message, threadID, terminalError string) {
	return parseJSONStreamInternalWithReview(r, warnFn, infoFn, onMessage, onComplete, onContent, onProgress, onSessionStarted, nil)
}

func parseJSONStreamInternalWithReview(r io.Reader, warnFn func(string), infoFn func(string), onMessage func(), onComplete func(), onContent func(content, contentType string), onProgress func(line string), onSessionStarted func(id string), grokReview *grokReviewEvidence) (message, threadID, terminalError string) {
	reader := bufio.NewReaderSize(r, jsonLineReaderSize)

	if warnFn == nil {
		warnFn = func(string) {}
	}
	if infoFn == nil {
		infoFn = func(string) {}
	}

	notifyMessage := func() {
		if onMessage != nil {
			onMessage()
		}
	}

	completeNotified := false
	notifyComplete := func() {
		if completeNotified {
			return
		}
		completeNotified = true
		if onComplete != nil {
			onComplete()
		}
	}

	emitProgress := func(line string) {
		if onProgress == nil || strings.TrimSpace(line) == "" {
			return
		}
		onProgress("[PROGRESS] " + line)
	}

	totalEvents := 0

	var (
		codexMessage     string
		claudeMessage    string
		geminiBuffer     strings.Builder
		grokBuffer       strings.Builder
		piMessage        string
		piError          string
		claudeStreamed   strings.Builder
		piStreamed       strings.Builder
		claudeActiveTool string
		provider         string
		claudeResultSeen bool
		geminiResultSeen bool
		grokEndSeen      bool
		piAgentEndSeen   bool
		unknownWarnings  int
	)
	emitTerminalText := func(final string, streamed *strings.Builder, backend string) {
		partial := streamed.String()
		switch {
		case partial == "":
			if onContent != nil {
				onContent(final, "message")
			}
		case strings.HasPrefix(final, partial):
			if suffix := final[len(partial):]; suffix != "" && onContent != nil {
				onContent(suffix, "message")
			}
		case final != partial:
			warnFn(backend + " terminal response did not match streamed assistant text; using terminal response")
			if onContent != nil {
				onContent(final, "replace_message")
			}
		}
	}

	for {
		line, tooLong, err := readLineWithLimit(reader, jsonLineMaxBytes, jsonLinePreviewBytes)
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			warnFn("Read stdout error: " + err.Error())
			break
		}

		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		totalEvents++

		if tooLong {
			warnFn(fmt.Sprintf("Skipped overlong JSON line (> %d bytes): %s", jsonLineMaxBytes, truncateBytes(line, 100)))
			continue
		}
		grokReview.observeStreamingJSON(line)

		// Single unmarshal for all backend types
		var event UnifiedEvent
		if err := json.Unmarshal(line, &event); err != nil {
			// Gemini CLI sometimes prepends non-JSON text to the init event line
			// e.g. "MCP issues detected. Run /mcp list for status.{"type":"init",...}"
			// Try to extract JSON from the first '{' character
			if idx := bytes.IndexByte(line, '{'); idx > 0 {
				if err2 := json.Unmarshal(line[idx:], &event); err2 == nil {
					goto parsed
				}
			}
			warnFn(fmt.Sprintf("Failed to parse event: %s", truncateBytes(line, 100)))
			continue
		}
	parsed:
		if (event.Method == "session/update" || event.Method == "_x.ai/session/update") && len(event.Params.Update) > 0 {
			grokReview.observeACP(event.Params.Update)
			continue
		}

		// Extract session_id early (works for all backends)
		if event.GetSessionID() != "" && threadID == "" {
			threadID = event.GetSessionID()
			if onSessionStarted != nil {
				onSessionStarted(threadID)
			}
		}

		// Detect backend type by field presence
		isCodex := event.ThreadID != "" || event.Type == "turn.completed" || event.Type == "turn.started"
		if !isCodex && len(event.Item) > 0 {
			var itemHeader struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(event.Item, &itemHeader) == nil && itemHeader.Type != "" {
				isCodex = true
			}
		}
		isPiType := event.Type == "session" || event.Type == "message_start" || event.Type == "message_update" ||
			event.Type == "message_end" || event.Type == "turn_end" || event.Type == "agent_end" ||
			event.Type == "tool_execution_start" || event.Type == "tool_execution_update" || event.Type == "tool_execution_end"
		isGrokType := event.Type == "thought" || event.Type == "text" || event.Type == "tool_call" ||
			event.Type == "tool_call_update" || event.Type == "plan" || event.Type == "usage" || event.Type == "end"
		isClaude := !isPiType && !isGrokType && (event.Subtype != "" || event.Result != "" ||
			event.Type == "stream_event" || event.Type == "tool_progress")
		if !isClaude && event.Type == "result" && event.GetSessionID() != "" && event.Status == "" {
			isClaude = true
		}
		isGemini := !isPiType && !isGrokType && !isClaude && (event.Role != "" || event.Delta != nil || event.Status != "" ||
			(event.Type == "init" && event.GetSessionID() != ""))
		// Grok streaming-json: token deltas carry "data"; the terminal "end"
		// event carries stopReason + camelCase sessionId (no role/status).
		isGrok := !isCodex && !isClaude && !isGemini && isGrokType
		isPi := !isCodex && !isClaude && !isGemini && !isGrok && isPiType

		if isPi {
			provider = "pi"
			switch event.Type {
			case "session":
				threadID = event.ID
				if onSessionStarted != nil {
					onSessionStarted(threadID)
				}
				emitProgress(formatProgressLine("session_started", map[string]string{"id": threadID}))
			case "message_start":
				piStreamed.Reset()
			case "message_update":
				if update := event.AssistantMessageEvent; update != nil && update.Type == "text_delta" && update.Delta != "" {
					piStreamed.WriteString(update.Delta)
					if onContent != nil {
						onContent(update.Delta, "message")
					}
					notifyMessage()
				}
			case "tool_execution_start", "tool_execution_update", "tool_execution_end":
				name := strings.TrimSpace(event.ToolNameCamel)
				if name == "" {
					name = "tool"
				}
				status := "running"
				if event.Type == "tool_execution_start" {
					status = "started"
				} else if event.Type == "tool_execution_end" {
					status = "completed"
					if event.IsErrorCamel {
						status = "failed"
					}
				}
				if onContent != nil {
					onContent(fmt.Sprintf("tool %s: %s", status, safeProgressSnippet(name, 80)), "command")
				}
			case "message_end", "turn_end":
				text, stopReason, errorMessage := extractPiAssistantMessage(event.Message)
				switch strings.ToLower(stopReason) {
				case "error", "aborted":
					piMessage = ""
					piError = fmt.Sprintf("pi assistant stopped with %s", stopReason)
					if errorMessage != "" {
						piError += ": " + errorMessage
					}
					notifyComplete()
					continue
				case "tooluse":
					continue
				}
				if piError != "" {
					continue
				}
				if text != "" && text != piMessage {
					piMessage = text
					notifyMessage()
					emitTerminalText(text, &piStreamed, "Pi")
					emitProgress(formatProgressLine("message", map[string]string{"text": strconv.Quote(safeProgressSnippet(text, 120))}))
				}
			case "agent_end":
				piAgentEndSeen = true
				emitProgress(formatProgressLine("session_completed", map[string]string{"total_events": strconv.Itoa(totalEvents)}))
				notifyComplete()
			}
			continue
		}

		// Handle Codex events
		if isCodex {
			var details []string
			if event.ThreadID != "" {
				details = append(details, fmt.Sprintf("thread_id=%s", event.ThreadID))
			}

			if len(details) > 0 {
				infoFn(fmt.Sprintf("Parsed event #%d type=%s (%s)", totalEvents, event.Type, strings.Join(details, ", ")))
			} else {
				infoFn(fmt.Sprintf("Parsed event #%d type=%s", totalEvents, event.Type))
			}

			switch event.Type {
			case "thread.started":
				threadID = event.ThreadID
				infoFn(fmt.Sprintf("thread.started event thread_id=%s", threadID))
				emitProgress(formatProgressLine("session_started", map[string]string{"id": threadID}))
				if onSessionStarted != nil {
					onSessionStarted(threadID)
				}

			case "turn.started":
				emitProgress(formatProgressLine("turn_started", nil))

			case "thread.completed", "turn.completed":
				if event.ThreadID != "" && threadID == "" {
					threadID = event.ThreadID
				}
				infoFn(fmt.Sprintf("%s event thread_id=%s", event.Type, event.ThreadID))
				eventName := "turn_completed"
				if event.Type == "thread.completed" {
					eventName = "session_completed"
				}
				emitProgress(formatProgressLine(eventName, map[string]string{"total_events": strconv.Itoa(totalEvents)}))
				notifyComplete()

			case "item.completed":
				var itemType string
				if len(event.Item) > 0 {
					var itemHeader struct {
						Type string `json:"type"`
					}
					if err := json.Unmarshal(event.Item, &itemHeader); err == nil {
						itemType = itemHeader.Type
					}
				}

				switch itemType {
				case "agent_message", "reasoning":
					// Parse text content
					var item ItemContent
					if err := json.Unmarshal(event.Item, &item); err == nil {
						normalized := normalizeText(item.Text)
						infoFn(fmt.Sprintf("item.completed event item_type=%s message_len=%d", itemType, len(normalized)))
						if normalized != "" {
							if itemType == "agent_message" {
								codexMessage = normalized
								notifyMessage()
								emitProgress(formatProgressLine("message", map[string]string{"text": strconv.Quote(safeProgressSnippet(normalized, 120))}))
							} else {
								emitProgress(formatProgressLine("reasoning", map[string]string{"text": strconv.Quote(safeProgressSnippet(normalized, 120))}))
							}
							// Send content (Codex outputs complete blocks, not streaming deltas)
							if onContent != nil {
								onContent(normalized, itemType)
							}
						}
					} else {
						warnFn(fmt.Sprintf("Failed to parse item content: %s", err.Error()))
					}

				case "command_execution":
					// Parse command execution
					var cmdItem struct {
						Command          string `json:"command"`
						AggregatedOutput string `json:"aggregated_output"`
						ExitCode         *int   `json:"exit_code"`
						Status           string `json:"status"`
					}
					if err := json.Unmarshal(event.Item, &cmdItem); err == nil {
						// Format command execution info
						var content strings.Builder
						content.WriteString(fmt.Sprintf("$ %s\n", cmdItem.Command))
						if cmdItem.AggregatedOutput != "" {
							content.WriteString(cmdItem.AggregatedOutput)
						}
						infoFn(fmt.Sprintf("item.completed event item_type=command_execution cmd=%s exit=%v", cmdItem.Command, cmdItem.ExitCode))
						fields := map[string]string{"cmd": strconv.Quote(safeProgressSnippet(cmdItem.Command, 120))}
						if cmdItem.ExitCode != nil {
							fields["exit"] = strconv.Itoa(*cmdItem.ExitCode)
						}
						emitProgress(formatProgressLine("cmd_done", fields))
						if onContent != nil && content.Len() > 0 {
							onContent(content.String(), "command")
						}
					}

				default:
					infoFn(fmt.Sprintf("item.completed event item_type=%s", itemType))
					if itemType == "mcp_tool_call" {
						emitProgress(formatProgressLine("mcp_call", nil))
					}
				}
			}
			continue
		}

		// Handle Claude events
		if isClaude {
			provider = "claude"
			if event.GetSessionID() != "" && threadID == "" {
				threadID = event.GetSessionID()
			}

			infoFn(fmt.Sprintf("Parsed Claude event #%d type=%s subtype=%s result_len=%d", totalEvents, event.Type, event.Subtype, len(event.Result)))

			if event.Type == "stream_event" && len(event.Event) > 0 {
				var partial struct {
					Type  string `json:"type"`
					Delta struct {
						Type string `json:"type"`
						Text string `json:"text"`
					} `json:"delta"`
					ContentBlock struct {
						Type string `json:"type"`
						Name string `json:"name"`
					} `json:"content_block"`
				}
				if json.Unmarshal(event.Event, &partial) == nil {
					switch {
					case partial.Type == "message_start":
						claudeStreamed.Reset()
					case partial.Type == "content_block_delta" && partial.Delta.Type == "text_delta" && partial.Delta.Text != "":
						claudeStreamed.WriteString(partial.Delta.Text)
						if onContent != nil {
							onContent(partial.Delta.Text, "message")
						}
						notifyMessage()
					case partial.Type == "content_block_start" && partial.ContentBlock.Type == "tool_use" && strings.TrimSpace(partial.ContentBlock.Name) != "":
						claudeActiveTool = safeProgressSnippet(partial.ContentBlock.Name, 80)
						if onContent != nil {
							onContent("tool started: "+claudeActiveTool, "command")
						}
					case partial.Type == "content_block_stop" && claudeActiveTool != "":
						if onContent != nil {
							onContent("tool request ready: "+claudeActiveTool, "command")
						}
						claudeActiveTool = ""
					}
				}
			}
			if event.Type == "tool_progress" && strings.TrimSpace(event.ToolName) != "" && onContent != nil {
				onContent(fmt.Sprintf("tool running: %s (%.1fs)", safeProgressSnippet(event.ToolName, 80), event.ElapsedTimeSeconds), "command")
			}
			if event.Subtype == "api_retry" && onContent != nil {
				onContent(fmt.Sprintf("API retry %d/%d in %dms", event.Attempt, event.MaxRetries, event.RetryDelayMS), "reasoning")
			}

			if event.Type == "result" {
				claudeResultSeen = true
				if event.IsError || strings.HasPrefix(strings.ToLower(event.Subtype), "error") {
					terminalError = fmt.Sprintf("Claude result status %q", event.Subtype)
				} else if strings.TrimSpace(event.Result) == "" {
					terminalError = "Claude result missing response"
				} else {
					claudeMessage = event.Result
					emitTerminalText(event.Result, &claudeStreamed, "Claude")
					notifyMessage()
				}
			}
			continue
		}

		// Handle Gemini events
		if isGemini {
			provider = "gemini"
			if event.GetSessionID() != "" && threadID == "" {
				threadID = event.GetSessionID()
			}

			if event.Content != "" {
				geminiBuffer.WriteString(event.Content)
				// Stream content to callback
				if onContent != nil {
					onContent(event.Content, "message")
				}
			}

			if event.Status != "" {
				notifyMessage()

				if event.Type == "result" && (event.Status == "success" || event.Status == "error" || event.Status == "complete" || event.Status == "failed") {
					geminiResultSeen = true
					if event.Status == "error" || event.Status == "failed" {
						terminalError = fmt.Sprintf("Gemini result status %q", event.Status)
					}
					notifyComplete()
				}
			}

			delta := false
			if event.Delta != nil {
				delta = *event.Delta
			}

			infoFn(fmt.Sprintf("Parsed Gemini event #%d type=%s role=%s delta=%t status=%s content_len=%d", totalEvents, event.Type, event.Role, delta, event.Status, len(event.Content)))
			continue
		}

		// Handle Grok events
		if isGrok {
			provider = "grok"
			switch event.Type {
			case "text":
				grokBuffer.WriteString(event.Data)
				if onContent != nil {
					onContent(event.Data, "message")
				}
			case "thought":
				// Reasoning token deltas — not part of the final message.
				// Skip per-token logging: a single turn can emit thousands of
				// thought events and flood the log line limit.
			case "tool_call", "tool_call_update":
				name := strings.TrimSpace(event.ToolNameCamel)
				if name == "" {
					name = "tool"
				}
				status := "started"
				if event.Type == "tool_call_update" {
					status = strings.TrimSpace(event.Status)
					if status == "" {
						status = "updated"
					}
				}
				summary := fmt.Sprintf("tool %s: %s", safeProgressSnippet(status, 40), safeProgressSnippet(name, 80))
				if title := strings.TrimSpace(event.Title); title != "" {
					summary += " (" + safeProgressSnippet(title, 100) + ")"
				}
				if onContent != nil {
					onContent(summary, "command")
				}
			case "plan":
				var entries []struct {
					Title  string `json:"title"`
					Status string `json:"status"`
				}
				if json.Unmarshal(event.Entries, &entries) == nil && onContent != nil {
					var summaries []string
					// ponytail: cap UI-only plan summaries; the provider protocol remains authoritative.
					for index, entry := range entries {
						if index == 8 {
							break
						}
						title := safeProgressSnippet(entry.Title, 100)
						status := safeProgressSnippet(entry.Status, 40)
						if title == "" {
							continue
						}
						if status != "" {
							title += " [" + status + "]"
						}
						summaries = append(summaries, title)
					}
					if len(summaries) > 0 {
						onContent("plan: "+strings.Join(summaries, "; "), "reasoning")
					} else {
						label := "entries"
						if len(entries) == 1 {
							label = "entry"
						}
						onContent(fmt.Sprintf("plan updated: %d %s", len(entries), label), "reasoning")
					}
				}
			case "usage":
				emitProgress("usage")
			case "end":
				grokEndSeen = true
				grokReview.observeStopReason(event.StopReason)
				normalized := strings.NewReplacer("_", "", "-", "").Replace(strings.ToLower(strings.TrimSpace(event.StopReason)))
				if normalized != "endturn" {
					terminalError = fmt.Sprintf("Grok stop reason %q", event.StopReason)
				}
				infoFn(fmt.Sprintf("Parsed Grok end event #%d stop_reason=%s session_id=%s message_len=%d", totalEvents, event.StopReason, event.SessionIDCamel, grokBuffer.Len()))
				if grokBuffer.Len() > 0 {
					notifyMessage()
					emitProgress(formatProgressLine("message", map[string]string{"text": strconv.Quote(safeProgressSnippet(grokBuffer.String(), 120))}))
				}
				emitProgress(formatProgressLine("session_completed", map[string]string{"total_events": strconv.Itoa(totalEvents)}))
				notifyComplete()
			}
			continue
		}

		// Unknown event format from other backends (turn.started/assistant/user); ignore.
		if provider != "" && unknownWarnings < 3 {
			warnFn(fmt.Sprintf("Ignored unknown %s event: %s", provider, safeProgressSnippet(event.Type, 80)))
			unknownWarnings++
		}
		continue
	}

	if piError != "" {
		terminalError = piError
	}
	if terminalError == "" {
		switch {
		case provider == "claude" && !claudeResultSeen:
			terminalError = "Claude stream missing terminal result"
		case provider == "gemini" && !geminiResultSeen:
			terminalError = "Gemini stream missing terminal result"
		case provider == "gemini" && geminiBuffer.Len() == 0:
			terminalError = "Gemini result missing response"
		case provider == "grok" && !grokEndSeen:
			terminalError = "Grok stream missing terminal end"
		case provider == "pi" && !piAgentEndSeen:
			terminalError = "Pi stream missing terminal agent_end"
		case provider == "pi" && piMessage == "":
			terminalError = "Pi stream missing assistant response"
		}
	}
	if provider != "" {
		notifyComplete()
	}

	switch {
	case piMessage != "":
		message = piMessage
	case grokBuffer.Len() > 0:
		message = grokBuffer.String()
	case geminiBuffer.Len() > 0:
		message = geminiBuffer.String()
	case claudeMessage != "":
		message = claudeMessage
	default:
		message = codexMessage
	}

	infoFn(fmt.Sprintf("parseJSONStream completed: events=%d, message_len=%d, thread_id_found=%t", totalEvents, len(message), threadID != ""))
	return message, threadID, terminalError
}

type antigravityStreamEvent struct {
	Event          string                     `json:"event"`
	ConversationID string                     `json:"conversation_id,omitempty"`
	Init           *antigravityInit           `json:"init,omitempty"`
	StepUpdate     *antigravityStepUpdate     `json:"step_update,omitempty"`
	Result         *antigravityTerminalResult `json:"result,omitempty"`
}

type antigravityInit struct {
	ConversationID string `json:"conversation_id,omitempty"`
}

type antigravityStepUpdate struct {
	ConversationID string          `json:"conversation_id"`
	StepIndex      int             `json:"step_index"`
	State          string          `json:"state"`
	StepType       string          `json:"step_type"`
	TextDelta      string          `json:"text_delta"`
	ToolName       string          `json:"tool_name,omitempty"`
	ToolInfo       json.RawMessage `json:"tool_info,omitempty"`
	SubagentInfo   json.RawMessage `json:"subagent_info,omitempty"`
}

type antigravityTerminalResult struct {
	ConversationID string          `json:"conversation_id"`
	Status         string          `json:"status"`
	Response       string          `json:"response"`
	Error          json.RawMessage `json:"error,omitempty"`
}

func parseAntigravityStream(r io.Reader, warnFn func(string), infoFn func(string), onMessage func(), onComplete func(), onContent func(content, contentType string), onProgress func(line string), onSessionStarted func(id string)) (message, threadID, terminalError string) {
	reader := bufio.NewReaderSize(r, jsonLineReaderSize)
	if warnFn == nil {
		warnFn = func(string) {}
	}
	if infoFn == nil {
		infoFn = func(string) {}
	}

	recordSession := func(id string) {
		if threadID != "" || strings.TrimSpace(id) == "" {
			return
		}
		threadID = id
		if onSessionStarted != nil {
			onSessionStarted(id)
		}
	}
	emitProgress := func(step *antigravityStepUpdate) {
		if onProgress == nil || step == nil {
			return
		}
		onProgress(fmt.Sprintf("[PROGRESS] step_update type=%s state=%s index=%d",
			strconv.Quote(safeProgressSnippet(step.StepType, 40)),
			strconv.Quote(safeProgressSnippet(step.State, 40)), step.StepIndex))
	}

	var streamed strings.Builder
	resultSeen := 0
	unknownWarnings := 0
	for {
		line, tooLong, err := readLineWithLimit(reader, jsonLineMaxBytes, jsonLinePreviewBytes)
		if err != nil {
			if errors.Is(err, io.EOF) || (resultSeen > 0 && errors.Is(err, os.ErrClosed)) {
				break
			}
			return "", threadID, "read Antigravity stream: " + err.Error()
		}
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		if tooLong {
			return "", threadID, fmt.Sprintf("Antigravity event exceeds %d bytes", jsonLineMaxBytes)
		}

		var event antigravityStreamEvent
		if err := json.Unmarshal(line, &event); err != nil {
			return "", threadID, fmt.Sprintf("parse Antigravity event: %v", err)
		}
		switch event.Event {
		case "init":
			if event.Init == nil {
				return "", threadID, "parse Antigravity init: missing init payload"
			}
			recordSession(event.ConversationID)
		case "step_update":
			if event.StepUpdate == nil {
				return "", threadID, "parse Antigravity step_update: missing payload"
			}
			step := event.StepUpdate
			recordSession(step.ConversationID)
			emitProgress(step)
			if step.TextDelta == "" {
				if onContent != nil {
					switch {
					case step.StepType == "tool" && strings.TrimSpace(step.ToolName) != "":
						onContent(fmt.Sprintf("tool %s: %s", safeProgressSnippet(step.State, 40), safeProgressSnippet(step.ToolName, 80)), "command")
					case step.StepType == "checkpoint":
						onContent("checkpoint: "+safeProgressSnippet(step.State, 40), "reasoning")
					case len(step.SubagentInfo) > 0:
						onContent("subagent: "+safeProgressSnippet(step.State, 40), "reasoning")
					}
				}
				continue
			}
			switch step.StepType {
			case "agent_response":
				streamed.WriteString(step.TextDelta)
				if onContent != nil {
					onContent(step.TextDelta, "message")
				}
				if onMessage != nil {
					onMessage()
				}
			case "tool":
				if onContent != nil {
					onContent(step.TextDelta, "command")
				}
			case "checkpoint", "subagent":
				if onContent != nil {
					onContent(step.TextDelta, "reasoning")
				}
			}
		case "result":
			resultSeen++
			if resultSeen > 1 {
				return "", threadID, "duplicate terminal result in Antigravity stream"
			}
			if event.Result == nil {
				return "", threadID, "parse Antigravity result: missing payload"
			}
			recordSession(event.Result.ConversationID)
			if !strings.EqualFold(strings.TrimSpace(event.Result.Status), "success") {
				if onComplete != nil {
					onComplete()
				}
				detail := strings.TrimSpace(strings.Trim(string(event.Result.Error), `"`))
				if detail != "" && detail != "null" {
					return "", threadID, fmt.Sprintf("Antigravity result status %q: %s", event.Result.Status, safeProgressSnippet(detail, 240))
				}
				return "", threadID, fmt.Sprintf("Antigravity result status %q", event.Result.Status)
			}
			if strings.TrimSpace(event.Result.Response) == "" {
				if onComplete != nil {
					onComplete()
				}
				return "", threadID, "Antigravity result missing response"
			}
			message = event.Result.Response
			partial := streamed.String()
			if partial == "" {
				if onContent != nil {
					onContent(message, "message")
				}
				if onMessage != nil {
					onMessage()
				}
			} else if strings.HasPrefix(message, partial) {
				if suffix := message[len(partial):]; suffix != "" && onContent != nil {
					onContent(suffix, "message")
				}
			} else if message != partial {
				warnFn("Antigravity result did not match streamed agent_response; using terminal result")
				if onContent != nil {
					onContent(message, "replace_message")
				}
			}
			if onComplete != nil {
				onComplete()
			}
		default:
			if unknownWarnings < 3 {
				warnFn("Ignored unknown Antigravity event: " + safeProgressSnippet(event.Event, 80))
				unknownWarnings++
			}
		}
	}

	if resultSeen == 0 {
		return "", threadID, "Antigravity stream missing terminal result"
	}
	infoFn(fmt.Sprintf("parseAntigravityStream completed: message_len=%d, conversation_id_found=%t", len(message), threadID != ""))
	return message, threadID, ""
}

func extractPiAssistantMessage(raw json.RawMessage) (text, stopReason, errorMessage string) {
	var message struct {
		Role         string `json:"role"`
		StopReason   string `json:"stopReason"`
		ErrorMessage string `json:"errorMessage"`
		Content      []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if json.Unmarshal(raw, &message) != nil || message.Role != "assistant" {
		return "", "", ""
	}

	var content strings.Builder
	for _, block := range message.Content {
		if block.Type == "text" {
			content.WriteString(block.Text)
		}
	}
	return content.String(), message.StopReason, message.ErrorMessage
}

func formatProgressLine(event string, fields map[string]string) string {
	parts := []string{event}
	if fields == nil {
		return strings.Join(parts, " ")
	}
	for _, key := range []string{"id", "text", "cmd", "exit", "total_events"} {
		if value, ok := fields[key]; ok && strings.TrimSpace(value) != "" {
			parts = append(parts, key+"="+value)
		}
	}
	return strings.Join(parts, " ")
}

func safeProgressSnippet(s string, maxLen int) string {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\n", " "))
	s = strings.Join(strings.Fields(s), " ")
	runes := []rune(s)
	if maxLen <= 0 || len(runes) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return string(runes[:maxLen])
	}
	return string(runes[:maxLen-3]) + "..."
}

func hasKey(m map[string]json.RawMessage, key string) bool {
	_, ok := m[key]
	return ok
}

func discardInvalidJSON(decoder *json.Decoder, reader *bufio.Reader) (*bufio.Reader, error) {
	var buffered bytes.Buffer

	if decoder != nil {
		if buf := decoder.Buffered(); buf != nil {
			_, _ = buffered.ReadFrom(buf)
		}
	}

	line, err := reader.ReadBytes('\n')
	buffered.Write(line)

	data := buffered.Bytes()
	newline := bytes.IndexByte(data, '\n')
	if newline == -1 {
		return reader, err
	}

	remaining := data[newline+1:]
	if len(remaining) == 0 {
		return reader, err
	}

	return bufio.NewReader(io.MultiReader(bytes.NewReader(remaining), reader)), err
}

func readLineWithLimit(r *bufio.Reader, maxBytes int, previewBytes int) (line []byte, tooLong bool, err error) {
	if r == nil {
		return nil, false, errors.New("reader is nil")
	}
	if maxBytes <= 0 {
		return nil, false, errors.New("maxBytes must be > 0")
	}
	if previewBytes < 0 {
		previewBytes = 0
	}

	part, isPrefix, err := r.ReadLine()
	if err != nil {
		return nil, false, err
	}

	if !isPrefix {
		if len(part) > maxBytes {
			return part[:min(len(part), previewBytes)], true, nil
		}
		return part, false, nil
	}

	preview := make([]byte, 0, min(previewBytes, len(part)))
	if previewBytes > 0 {
		preview = append(preview, part[:min(previewBytes, len(part))]...)
	}

	buf := make([]byte, 0, min(maxBytes, len(part)*2))
	total := 0
	if len(part) > maxBytes {
		tooLong = true
	} else {
		buf = append(buf, part...)
		total = len(part)
	}

	for isPrefix {
		part, isPrefix, err = r.ReadLine()
		if err != nil {
			return nil, tooLong, err
		}

		if previewBytes > 0 && len(preview) < previewBytes {
			preview = append(preview, part[:min(previewBytes-len(preview), len(part))]...)
		}

		if !tooLong {
			if total+len(part) > maxBytes {
				tooLong = true
				continue
			}
			buf = append(buf, part...)
			total += len(part)
		}
	}

	if tooLong {
		return preview, true, nil
	}
	return buf, false, nil
}

func truncateBytes(b []byte, maxLen int) string {
	if len(b) <= maxLen {
		return string(b)
	}
	if maxLen < 0 {
		return ""
	}
	return string(b[:maxLen]) + "..."
}

func normalizeText(text interface{}) string {
	switch v := text.(type) {
	case string:
		return v
	case []interface{}:
		var sb strings.Builder
		for _, item := range v {
			if s, ok := item.(string); ok {
				sb.WriteString(s)
			}
		}
		return sb.String()
	default:
		return ""
	}
}
