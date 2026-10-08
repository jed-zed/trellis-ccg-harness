//go:build !windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// configureCommandProcessGroup isolates the backend, while leaving the wrapper
// and unrelated sessions outside the backend's signal and cleanup scope.
// A process group is a lifecycle boundary, not a filesystem or network sandbox.
func configureCommandProcessGroup(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
	cmd.SysProcAttr.Pgid = 0
	if cmd.Cancel != nil {
		// CommandContext's default Cancel kills only the parent, which can make
		// Wait finish before terminateCommand cleans up its children. TERM lets
		// a nested wrapper cancel its own separately isolated backend normally;
		// terminateCommand/finishCommandProcessGroup enforce the bounded KILL.
		cmd.Cancel = func() error { return cancelCommandProcessGroup(cmd) }
	}
}

func ownedCommandProcessGroup(cmd commandRunner) (*exec.Cmd, int, bool) {
	real, ok := cmd.(*realCmd)
	if !ok || real == nil || real.cmd == nil {
		return nil, 0, false
	}
	c := real.cmd
	if c.Process == nil || c.Process.Pid <= 0 || c.SysProcAttr == nil ||
		!c.SysProcAttr.Setpgid || c.SysProcAttr.Pgid != 0 {
		return nil, 0, false
	}
	return c, c.Process.Pid, true
}

// signalOwnedCommandProcessGroup never turns a test runner's arbitrary PID into
// a real process-group signal. false asks the caller to use its original
// single-process fallback; ESRCH counts as handled because the group is gone.
func signalOwnedCommandProcessGroup(cmd commandRunner, sig syscall.Signal) bool {
	c, pid, ok := ownedCommandProcessGroup(cmd)
	if !ok {
		return false
	}
	if ownedCommandGroupClosed(c) {
		return true
	}
	if sig == syscall.SIGTERM {
		rememberOwnedCommandDescendants(c)
		if handled, _ := signalOwnedRootGroupHandles(c); handled {
			return true
		}
	}
	if sig == syscall.SIGKILL {
		if killOwnedCommandDescendants(c) {
			return true // Verified pidfds, including escaped groups, cover cleanup.
		}
	}
	if ownedCommandGroupIdentityChanged(c) {
		return true // The original group leader PID was reused: refuse a signal.
	}
	if runtime.GOOS == "linux" && c.Process.Signal(syscall.Signal(0)) != nil {
		return true // Original child reaped and no pidfd: refuse guessing.
	}
	err := syscall.Kill(-pid, sig)
	return err == nil || errors.Is(err, syscall.ESRCH)
}

func cancelCommandProcessGroup(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil || cmd.Process.Pid <= 0 {
		return os.ErrProcessDone
	}
	pid := cmd.Process.Pid
	if ownedCommandGroupClosed(cmd) {
		return os.ErrProcessDone
	}
	// A context can fire inside native Start, before realCmd.Start's post-start
	// hook. Go Wait cannot finish before this Cancel returns, so binding here
	// also precedes its completion notification.
	recordCommandProcessGroupStart(cmd)
	rememberOwnedCommandDescendants(cmd)
	// An already completed, unreaped Linux child still has a PGID. Returning
	// nil after signalling that zombie would let os/exec change a successful
	// completion into ctx.Err(). Still TERM any ordinary remaining children.
	exited := commandProcessAlreadyExited(pid) || cmd.Process.Signal(syscall.Signal(0)) != nil
	if handled, err := signalOwnedRootGroupHandles(cmd); handled {
		if exited {
			return os.ErrProcessDone
		}
		return err
	}
	if exited {
		return os.ErrProcessDone
	}
	if ownedCommandGroupIdentityChanged(cmd) {
		return os.ErrProcessDone
	}
	err := syscall.Kill(-pid, syscall.SIGTERM)
	if errors.Is(err, syscall.ESRCH) || (err == nil && exited) {
		return os.ErrProcessDone
	}
	if err != nil {
		return cmd.Process.Signal(syscall.SIGTERM)
	}
	return nil
}

func commandProcessAlreadyExited(pid int) bool {
	if runtime.GOOS != "linux" {
		return false
	}
	// Read only the child we created. stat's comm can contain ')' and spaces.
	data, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return false
	}
	end := strings.LastIndexByte(string(data), ')')
	if end < 0 {
		return false
	}
	fields := strings.Fields(string(data[end+1:]))
	return len(fields) > 0 && (fields[0] == "Z" || fields[0] == "X")
}

// finishCommandProcessGroup closes the leader-exited race: Wait can finish
// while a child that ignored TERM remains alive, so stopping the force-kill
// timer alone is insufficient. Call only for cancelled/terminated commands,
// before stopping that timer. A separately isolated nested backend is cleaned
// by its wrapper's normal TERM handling, not by the outer group's SIGKILL.
func finishCommandProcessGroup(cmd commandRunner) {
	c, pid, ok := ownedCommandProcessGroup(cmd)
	if !ok {
		return
	}
	if ownedCommandGroupIdentityChanged(c) {
		killOwnedCommandDescendants(c)
		return
	}
	handled, _ := signalOwnedRootGroupHandles(c)
	if !handled && runtime.GOOS == "linux" && c.Process.Signal(syscall.Signal(0)) != nil {
		return
	}
	if !handled {
		if err := syscall.Kill(-pid, syscall.SIGTERM); err != nil {
			killOwnedCommandDescendants(c)
			return
		}
	}
	delay := time.Duration(forceKillDelay.Load()) * time.Second
	if delay < 0 {
		delay = 0
	}
	if delay > 5*time.Second {
		delay = 5 * time.Second
	}
	deadline := time.Now().Add(delay)
	for time.Now().Before(deadline) {
		if err := syscall.Kill(-pid, 0); errors.Is(err, syscall.ESRCH) {
			killOwnedCommandDescendants(c)
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	if killOwnedCommandDescendants(c) {
		return
	}
	if !ownedCommandGroupIdentityChanged(c) && (runtime.GOOS != "linux" || c.Process.Signal(syscall.Signal(0)) == nil) {
		_ = syscall.Kill(-pid, syscall.SIGKILL)
	}
}
