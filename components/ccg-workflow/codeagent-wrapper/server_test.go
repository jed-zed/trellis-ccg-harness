package main

import (
	"errors"
	"net"
	"strings"
	"testing"
	"time"
)

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
