//go:build linux

package main

import (
	"errors"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type ownedProcessStat struct {
	pid, ppid, pgid int
	start           uint64
	state           byte
}

type ownedProcessIdentity struct {
	stat  ownedProcessStat
	pidfd int
}

type ownedDescendantSnapshot struct {
	mu              sync.Mutex
	rootPID         int
	rootStart       uint64
	processes       map[int]ownedProcessIdentity
	finished        bool
	released        bool
	waitCompleted   bool
	cancelRequested bool
}

var ownedCommandDescendants sync.Map // *exec.Cmd -> *ownedDescendantSnapshot

func readOwnedProcessStat(pid int) (ownedProcessStat, error) {
	var stat ownedProcessStat
	if pid <= 0 {
		return stat, syscall.ESRCH
	}
	data, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return stat, err
	}
	end := strings.LastIndexByte(string(data), ')')
	if end < 0 {
		return stat, syscall.EINVAL
	}
	fields := strings.Fields(string(data[end+1:]))
	if len(fields) < 20 || len(fields[0]) != 1 {
		return stat, syscall.EINVAL
	}
	ppid, err := strconv.Atoi(fields[1])
	if err != nil {
		return stat, err
	}
	pgid, err := strconv.Atoi(fields[2])
	if err != nil {
		return stat, err
	}
	start, err := strconv.ParseUint(fields[19], 10, 64)
	if err != nil || start == 0 {
		return stat, syscall.EINVAL
	}
	return ownedProcessStat{pid: pid, ppid: ppid, pgid: pgid, start: start, state: fields[0][0]}, nil
}

func ownedProcessIsLive(stat ownedProcessStat) bool {
	return stat.state != 'Z' && stat.state != 'X'
}

// Linux syscall numbers match Go's internal/syscall/unix/sysnum_linux_*.go.
// A pidfd binds subsequent signals to the verified task, so PID reuse after
// checking stat cannot redirect STOP/KILL to an unrelated replacement process.
func ownedPIDFDOpen(pid int) (int, error) {
	trap := uintptr(434)
	switch runtime.GOARCH {
	case "amd64", "arm64", "386", "arm", "riscv64", "ppc64", "ppc64le", "s390x", "loong64":
	case "mips", "mipsle":
		trap = 4434
	case "mips64", "mips64le":
		trap = 5434
	default:
		return -1, syscall.EOPNOTSUPP
	}
	fd, _, errno := syscall.Syscall(trap, uintptr(pid), 0, 0)
	if errno != 0 {
		return -1, errno
	}
	return int(fd), nil
}

func ownedPIDFDSignal(fd int, sig syscall.Signal) error {
	trap := uintptr(424)
	switch runtime.GOARCH {
	case "mips", "mipsle":
		trap = 4424
	case "mips64", "mips64le":
		trap = 5424
	}
	_, _, errno := syscall.Syscall(trap, uintptr(fd), uintptr(sig), 0)
	if errno != 0 {
		return errno
	}
	return nil
}

func openVerifiedOwnedProcess(stat ownedProcessStat) (ownedProcessIdentity, error) {
	fd, err := ownedPIDFDOpen(stat.pid)
	if err != nil {
		return ownedProcessIdentity{}, err
	}
	current, err := readOwnedProcessStat(stat.pid)
	if err != nil || current.start != stat.start || current.ppid != stat.ppid ||
		!ownedProcessIsLive(current) || ownedPIDFDSignal(fd, 0) != nil {
		_ = syscall.Close(fd)
		return ownedProcessIdentity{}, syscall.ESRCH
	}
	return ownedProcessIdentity{stat: current, pidfd: fd}, nil
}

func readOwnedProcessTable() map[int]ownedProcessStat {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil
	}
	table := make(map[int]ownedProcessStat)
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid <= 0 || pid == os.Getpid() {
			continue
		}
		stat, err := readOwnedProcessStat(pid)
		if err == nil && ownedProcessIsLive(stat) {
			table[pid] = stat
		}
	}
	return table
}

// refresh follows only kernel PPID edges from already owned, still matching
// tasks. Names and user IDs are never used to authorize signalling a task.
// Previously captured survivors remain roots after an ancestor is killed and
// they are reparented, allowing cleanup of their new ordinary children too.
func (snapshot *ownedDescendantSnapshot) refresh() int {
	table := readOwnedProcessTable()
	children := make(map[int][]ownedProcessStat)
	for _, stat := range table {
		children[stat.ppid] = append(children[stat.ppid], stat)
	}
	var queue []ownedProcessStat
	for pid, identity := range snapshot.processes {
		stat, ok := table[pid]
		if ok && stat.start == identity.stat.start && ownedPIDFDSignal(identity.pidfd, 0) == nil {
			queue = append(queue, stat)
		}
	}
	added := 0
	for i := 0; i < len(queue); i++ {
		parent := queue[i]
		for _, stat := range children[parent.pid] {
			if stat.pid == snapshot.rootPID || stat.start < parent.start {
				continue
			}
			if existing, ok := snapshot.processes[stat.pid]; ok && existing.stat.start == stat.start && ownedPIDFDSignal(existing.pidfd, 0) == nil {
				continue
			}
			identity, err := openVerifiedOwnedProcess(stat)
			if err != nil {
				continue // No identity proof: never fall back to a numeric PID.
			}
			parentIdentity := snapshot.processes[parent.pid]
			if ownedPIDFDSignal(parentIdentity.pidfd, 0) != nil {
				_ = syscall.Close(identity.pidfd)
				continue // Original parent died while the child was being bound.
			}
			if previous, ok := snapshot.processes[stat.pid]; ok {
				_ = syscall.Close(previous.pidfd)
			}
			snapshot.processes[stat.pid] = identity
			queue = append(queue, stat)
			added++
		}
	}
	return added
}

// Bind the unreaped direct child after Start succeeds and before launching Wait.
func recordCommandProcessGroupStart(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil || cmd.Process.Pid <= 0 {
		return
	}
	if _, ok := ownedCommandDescendants.Load(cmd); ok {
		return
	}
	// The unreaped direct child retains its PID; os.Process also rejects a
	// process already reaped by Wait. Never adopt a replacement numeric PID.
	if cmd.Process.Signal(syscall.Signal(0)) != nil {
		return
	}
	root, err := readOwnedProcessStat(cmd.Process.Pid)
	if err != nil {
		logWarn("Linux descendant cleanup unavailable; cannot read owned child identity: " + err.Error())
		return
	}
	fd, err := ownedPIDFDOpen(root.pid)
	if err != nil {
		if !errors.Is(err, syscall.ESRCH) {
			logWarn("Linux descendant cleanup unavailable; retaining isolated-group cleanup: " + err.Error())
		}
		return
	}
	current, err := readOwnedProcessStat(root.pid)
	if err != nil || current.start != root.start || cmd.Process.Signal(syscall.Signal(0)) != nil {
		_ = syscall.Close(fd)
		return
	}
	identity := ownedProcessIdentity{stat: current, pidfd: fd}
	snapshot := &ownedDescendantSnapshot{rootPID: root.pid, rootStart: root.start,
		processes: map[int]ownedProcessIdentity{root.pid: identity}}
	_, loaded := ownedCommandDescendants.LoadOrStore(cmd, snapshot)
	if loaded {
		_ = syscall.Close(identity.pidfd)
	}
}

func rememberOwnedCommandDescendants(cmd *exec.Cmd) {
	value, ok := ownedCommandDescendants.Load(cmd)
	if !ok {
		return // Unsupported /proc or pidfds: never adopt a guessed task.
	}
	snapshot := value.(*ownedDescendantSnapshot)
	snapshot.mu.Lock()
	if !snapshot.finished {
		snapshot.cancelRequested = true
		snapshot.refresh()
	}
	snapshot.mu.Unlock()
}

func killOwnedCommandDescendants(cmd *exec.Cmd) bool {
	value, ok := ownedCommandDescendants.Load(cmd)
	if !ok {
		return false
	}
	snapshot := value.(*ownedDescendantSnapshot)
	snapshot.mu.Lock()
	defer snapshot.mu.Unlock()
	if snapshot.finished {
		return true
	}
	// Stop only proven owned tasks before the final refresh. This prevents a
	// live nested wrapper from spawning a new detached backend between capture
	// and killing its parent. New children are stopped on the following pass.
	for pass := 0; pass < 8; pass++ {
		added := snapshot.refresh()
		allStopped := true
		for _, identity := range snapshot.processes {
			if ownedPIDFDSignal(identity.pidfd, syscall.SIGSTOP) != nil {
				continue
			}
			stat, err := readOwnedProcessStat(identity.stat.pid)
			if err == nil && stat.start == identity.stat.start && ownedProcessIsLive(stat) && stat.state != 'T' && stat.state != 't' {
				allStopped = false
			}
		}
		if added == 0 && allStopped {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}
	for _, identity := range snapshot.processes {
		_ = ownedPIDFDSignal(identity.pidfd, syscall.SIGKILL)
	}
	snapshot.finished = true
	return true
}

func signalOwnedRootGroupHandles(cmd *exec.Cmd) (bool, error) {
	value, ok := ownedCommandDescendants.Load(cmd)
	if !ok {
		return false, nil
	}
	snapshot := value.(*ownedDescendantSnapshot)
	snapshot.mu.Lock()
	defer snapshot.mu.Unlock()
	if snapshot.finished || snapshot.released {
		return true, os.ErrProcessDone
	}
	sent := false
	var firstErr error
	for _, identity := range snapshot.processes {
		if identity.stat.pgid != snapshot.rootPID {
			continue // Let the nested wrapper TERM its own isolated backend.
		}
		err := ownedPIDFDSignal(identity.pidfd, syscall.SIGTERM)
		if err == nil {
			sent = true
		} else if !errors.Is(err, syscall.ESRCH) && firstErr == nil {
			firstErr = err
		}
	}
	if firstErr != nil {
		return true, firstErr
	}
	if !sent {
		return true, os.ErrProcessDone
	}
	return true, nil
}

func ownedCommandGroupClosed(cmd *exec.Cmd) bool {
	value, ok := ownedCommandDescendants.Load(cmd)
	if !ok {
		return false
	}
	snapshot := value.(*ownedDescendantSnapshot)
	snapshot.mu.Lock()
	defer snapshot.mu.Unlock()
	return snapshot.finished || snapshot.released
}

func ownedCommandGroupIdentityChanged(cmd *exec.Cmd) bool {
	value, ok := ownedCommandDescendants.Load(cmd)
	if !ok {
		return false
	}
	snapshot := value.(*ownedDescendantSnapshot)
	current, err := readOwnedProcessStat(snapshot.rootPID)
	return err == nil && current.start != snapshot.rootStart
}

func commandProcessGroupNeedsCleanup(cmd commandRunner) bool {
	real, ok := cmd.(*realCmd)
	if !ok || real == nil || real.cmd == nil {
		return false
	}
	value, ok := ownedCommandDescendants.Load(real.cmd)
	if !ok {
		return false
	}
	snapshot := value.(*ownedDescendantSnapshot)
	snapshot.mu.Lock()
	defer snapshot.mu.Unlock()
	return snapshot.cancelRequested && !snapshot.released
}

// Join the force-kill timer first. A rare fallback exit may precede Cmd.Wait:
// retain a closed tombstone then so deferred Cancel cannot recreate handles.
func releaseCommandProcessGroup(cmd commandRunner) {
	real, ok := cmd.(*realCmd)
	if !ok || real == nil || real.cmd == nil {
		return
	}
	value, ok := ownedCommandDescendants.Load(real.cmd)
	if !ok {
		return
	}
	snapshot := value.(*ownedDescendantSnapshot)
	snapshot.mu.Lock()
	defer snapshot.mu.Unlock()
	if snapshot.released {
		if snapshot.waitCompleted {
			ownedCommandDescendants.CompareAndDelete(real.cmd, snapshot)
		}
		return
	}
	snapshot.finished = true
	snapshot.released = true
	for _, identity := range snapshot.processes {
		_ = syscall.Close(identity.pidfd)
	}
	if snapshot.waitCompleted {
		ownedCommandDescendants.CompareAndDelete(real.cmd, snapshot)
	}
}

func completeCommandProcessGroupWait(cmd *exec.Cmd) {
	value, ok := ownedCommandDescendants.Load(cmd)
	if !ok {
		return
	}
	snapshot := value.(*ownedDescendantSnapshot)
	snapshot.mu.Lock()
	defer snapshot.mu.Unlock()
	snapshot.waitCompleted = true
	if snapshot.released {
		ownedCommandDescendants.CompareAndDelete(cmd, snapshot)
	}
}
