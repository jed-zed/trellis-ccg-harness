//go:build windows

package main

import (
	"context"
	"os/exec"
	"reflect"
	"syscall"
	"testing"
)

func TestWindowsProcessGroupHooksPreserveNativeBehavior(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cmd := exec.CommandContext(ctx, "not-executed")
	attributes := &syscall.SysProcAttr{HideWindow: true}
	cmd.SysProcAttr = attributes
	cancelPointer := reflect.ValueOf(cmd.Cancel).Pointer()
	configureCommandProcessGroup(cmd)
	if cmd.SysProcAttr != attributes || !attributes.HideWindow || reflect.ValueOf(cmd.Cancel).Pointer() != cancelPointer {
		t.Fatal("Windows hook changed existing process attributes or cancellation")
	}
	if signalOwnedCommandProcessGroup(&realCmd{cmd: cmd}, syscall.SIGTERM) {
		t.Fatal("Windows must retain its original taskkill tree path")
	}
	finishCommandProcessGroup(&realCmd{cmd: cmd})
	configureCommandProcessGroup(nil)
}
