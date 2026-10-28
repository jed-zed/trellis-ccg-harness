package main

import (
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestCodexMCPReadFileWindowsShortPath(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "long configuration directory", "config.toml")
	writeCodexMCPFixture(t, file, "[features]\nplugins=false\n")
	path, err := syscall.UTF16PtrFromString(file)
	if err != nil {
		t.Fatal(err)
	}
	buf := make([]uint16, 32768)
	n, err := syscall.GetShortPathName(path, &buf[0], uint32(len(buf)))
	if err != nil || n == 0 || n >= uint32(len(buf)) {
		t.Fatalf("cannot obtain short fixture path: %v", err)
	}
	short := syscall.UTF16ToString(buf[:n])
	if sameCodexMCPPath(short, file) {
		t.Skip("fixture volume does not generate Windows short names")
	}
	data, exists, err := readCodexMCPFile(short)
	if err != nil || !exists || string(data) != "[features]\nplugins=false\n" {
		t.Fatalf("short path to a regular configuration rejected: exists=%v err=%v", exists, err)
	}
}

func TestCodexMCPReadFileRejectsWindowsJunction(t *testing.T) {
	root := t.TempDir()
	target, link := filepath.Join(root, "target"), filepath.Join(root, "junction")
	writeCodexMCPFixture(t, filepath.Join(target, "config.toml"), "")
	if output, err := exec.Command("cmd", "/c", "mklink", "/J", link, target).CombinedOutput(); err != nil {
		t.Fatalf("cannot create isolated junction fixture: %v: %s", err, output)
	}
	if _, _, err := readCodexMCPFile(filepath.Join(link, "config.toml")); err == nil || !strings.Contains(err.Error(), "unsupported link") {
		t.Fatalf("junction traversal was not rejected: %v", err)
	}
}
