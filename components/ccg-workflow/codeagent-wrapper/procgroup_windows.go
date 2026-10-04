//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

func recordCommandProcessGroupStart(cmd *exec.Cmd) {}

// Windows retains the existing taskkill /T path and CommandContext behavior.
func configureCommandProcessGroup(cmd *exec.Cmd) {}

func signalOwnedCommandProcessGroup(cmd commandRunner, sig syscall.Signal) bool {
	return false
}

func finishCommandProcessGroup(cmd commandRunner) {}

func commandProcessGroupNeedsCleanup(cmd commandRunner) bool { return false }
func releaseCommandProcessGroup(cmd commandRunner)           {}
func completeCommandProcessGroupWait(cmd *exec.Cmd)          {}
