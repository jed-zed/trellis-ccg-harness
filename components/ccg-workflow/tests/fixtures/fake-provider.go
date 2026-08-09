package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type invocation struct {
	Command string   `json:"command"`
	Args    []string `json:"args"`
	Stdin   string   `json:"stdin,omitempty"`
}

func appendInvocation(path string, value invocation) {
	if strings.TrimSpace(path) == "" {
		return
	}
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		panic(err)
	}
	defer file.Close()
	if _, err := file.Write(append(data, '\n')); err != nil {
		panic(err)
	}
}

func main() {
	name := strings.TrimSuffix(strings.ToLower(filepath.Base(os.Args[0])), ".exe")
	args := os.Args[1:]
	if name == "open" || name == "xdg-open" || name == "rundll32" {
		appendInvocation(os.Getenv("FAKE_BROWSER_LOG"), invocation{Command: name, Args: args})
		return
	}

	stdin, err := io.ReadAll(os.Stdin)
	if err != nil {
		panic(err)
	}
	appendInvocation(os.Getenv("FAKE_PROVIDER_LOG"), invocation{
		Command: name,
		Args:    args,
		Stdin:   string(stdin),
	})

	switch name {
	case "agy":
		fmt.Println(`{"event":"init","conversation_id":"antigravity-session","init":{"tools":[]}}`)
		fmt.Println(`{"event":"step_update","step_update":{"conversation_id":"antigravity-session","step_index":0,"state":"DONE","step_type":"agent_response","text_delta":"fake antigravity output"}}`)
		fmt.Println(`{"event":"result","result":{"conversation_id":"antigravity-session","status":"success","response":"fake antigravity output","num_turns":1}}`)
	case "grok":
		fmt.Println(`{"type":"text","data":"fake grok output"}`)
		fmt.Println(`{"type":"end","stopReason":"EndTurn","sessionId":"grok-session"}`)
	case "pi":
		fmt.Println(`{"type":"session","version":3,"id":"pi-session"}`)
		fmt.Println(`{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"fake pi output"}],"stopReason":"stop"}}`)
		fmt.Println(`{"type":"agent_end"}`)
	default:
		fmt.Fprintf(os.Stderr, "unsupported fake executable: %s\n", name)
		os.Exit(2)
	}
}
