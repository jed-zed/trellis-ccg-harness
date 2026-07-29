package main

import (
	"errors"
	"net"
	"testing"
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
