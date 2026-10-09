//go:build linux

package main

import (
	"context"
	"errors"
	"os"
	"syscall"
	"testing"
)

func requireUnixLifecyclePIDFD(t *testing.T) {
	t.Helper()
	fd, err := ownedPIDFDOpen(os.Getpid())
	if err != nil {
		t.Fatalf("Linux nested forced cleanup requires accessible /proc and pidfd_open support (Linux 5.3+): %v", err)
	}
	defer syscall.Close(fd)
	if err := ownedPIDFDSignal(fd, 0); err != nil {
		t.Fatalf("pidfd_send_signal is unavailable: %v", err)
	}
}

func TestUnixLifecycle_PidfdRejectsBirthMismatch(t *testing.T) {
	requireUnixLifecyclePIDFD(t)
	dir := prepareUnixLifecycleTest(t)
	_, _, _ = startUnixFixture(t, dir, "sibling", context.Background())
	state := readUnixFixtureState(t, dir, "sibling")
	stat, err := readOwnedProcessStat(state.PID)
	if err != nil {
		t.Fatal(err)
	}
	stat.start++ // Simulate a stale observation before binding a numeric PID.
	identity, err := openVerifiedOwnedProcess(stat)
	if !errors.Is(err, syscall.ESRCH) {
		if err == nil {
			_ = syscall.Close(identity.pidfd)
		}
		t.Fatalf("a mismatched birth identity was adopted: %v", err)
	}
	if !unixFixtureAlive(state.PID) {
		t.Fatal("rejecting an unknown identity disturbed the unrelated fixture")
	}
}

func TestUnixLifecycle_ReleaseBeforeWaitBlocksLateCancellation(t *testing.T) {
	requireUnixLifecyclePIDFD(t)
	dir := prepareUnixLifecycleTest(t)
	cmd, done, _ := startUnixFixture(t, dir, "ordinary-backend", context.Background())
	parent := readUnixFixtureState(t, dir, "ordinary-backend")
	child := readUnixFixtureState(t, dir, "ordinary-leaf")
	rememberOwnedCommandDescendants(cmd.cmd)
	if !commandProcessGroupNeedsCleanup(cmd) {
		t.Fatal("the cancellation snapshot was not established")
	}
	// Model the bounded fallback exit: release can precede real Wait's return.
	// Keep a closed entry until Wait synchronizes with CommandContext.Cancel.
	releaseCommandProcessGroup(cmd)
	if _, ok := ownedCommandDescendants.Load(cmd.cmd); !ok {
		t.Fatal("release discarded the tombstone before Wait completed")
	}
	if err := cancelCommandProcessGroup(cmd.cmd); !errors.Is(err, os.ErrProcessDone) {
		t.Fatalf("late cancellation was not rejected: %v", err)
	}
	if !unixFixtureAlive(parent.PID) || !unixFixtureAlive(child.PID) {
		t.Fatal("a late callback signalled tasks after ownership was released")
	}
	// These are still live, test-created members of an isolated fixture group.
	if err := syscall.Kill(-parent.PGID, syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	awaitUnixFixture(t, done)
	if _, ok := ownedCommandDescendants.Load(cmd.cmd); ok {
		t.Fatal("Wait completion did not release the tombstone")
	}
	rememberOwnedCommandDescendants(cmd.cmd)
	if _, ok := ownedCommandDescendants.Load(cmd.cmd); ok {
		t.Fatal("an already-reaped command recreated an ownership snapshot")
	}
}

func TestUnixLifecycle_SuccessfulStartDoesNotRequestForcedCleanup(t *testing.T) {
	requireUnixLifecyclePIDFD(t)
	dir := prepareUnixLifecycleTest(t)
	cmd, _, _ := startUnixFixture(t, dir, "sibling", context.Background())
	_ = readUnixFixtureState(t, dir, "sibling")
	if _, ok := ownedCommandDescendants.Load(cmd.cmd); !ok {
		t.Fatal("Start did not bind its real child's identity before Wait")
	}
	if commandProcessGroupNeedsCleanup(cmd) {
		t.Fatal("normal successful Start should not request descendant termination")
	}
}
