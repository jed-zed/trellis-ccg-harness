package main

import (
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	originalFactory := newWebServerForExecution
	newWebServerForExecution = func(backend string) *WebServer {
		server := NewWebServer(backend)
		server.browserOpener = nil
		return server
	}

	exitCode := m.Run()
	newWebServerForExecution = originalFactory
	os.Exit(exitCode)
}
