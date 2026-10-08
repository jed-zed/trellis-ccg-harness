//go:build !linux && !windows

package main

import "os/exec"

func recordCommandProcessGroupStart(cmd *exec.Cmd) {}

// Other Unix targets retain group isolation and cooperative TERM propagation.
// Force-cleaning descendants which established another PGID is Linux-specific.
func rememberOwnedCommandDescendants(cmd *exec.Cmd)           {}
func killOwnedCommandDescendants(cmd *exec.Cmd) bool          { return false }
func ownedCommandGroupIdentityChanged(cmd *exec.Cmd) bool     { return false }
func commandProcessGroupNeedsCleanup(cmd commandRunner) bool  { return false }
func releaseCommandProcessGroup(cmd commandRunner)            {}
func signalOwnedRootGroupHandles(cmd *exec.Cmd) (bool, error) { return false, nil }
func ownedCommandGroupClosed(cmd *exec.Cmd) bool              { return false }
func completeCommandProcessGroupWait(cmd *exec.Cmd)           {}
