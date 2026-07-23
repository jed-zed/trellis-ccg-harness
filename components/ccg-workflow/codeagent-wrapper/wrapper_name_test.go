package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestCurrentWrapperNameFallsBackToExecutable(t *testing.T) {
	defer resetTestHooks()

	tempDir := t.TempDir()
	execPath := filepath.Join(tempDir, "codeagent-wrapper")
	if err := os.WriteFile(execPath, []byte("#!/bin/true\n"), 0o755); err != nil {
		t.Fatalf("failed to write fake binary: %v", err)
	}

	os.Args = []string{filepath.Join(tempDir, "custom-name")}
	executablePathFn = func() (string, error) {
		return execPath, nil
	}

	if got := currentWrapperName(); got != defaultWrapperName {
		t.Fatalf("currentWrapperName() = %q, want %q", got, defaultWrapperName)
	}
}

func TestCurrentWrapperNameDetectsLegacyAliasSymlink(t *testing.T) {
	defer resetTestHooks()

	tempDir := t.TempDir()
	execPath := filepath.Join(tempDir, "wrapper")
	aliasPath := filepath.Join(tempDir, legacyWrapperName)

	if err := os.WriteFile(execPath, []byte("#!/bin/true\n"), 0o755); err != nil {
		t.Fatalf("failed to write fake binary: %v", err)
	}
	if err := os.Symlink(execPath, aliasPath); err != nil {
		if runtime.GOOS == "windows" {
			t.Skipf("symlink privilege unavailable: %v", err)
		}
		t.Fatalf("failed to create alias: %v", err)
	}

	os.Args = []string{filepath.Join(tempDir, "unknown-runner")}
	executablePathFn = func() (string, error) {
		return execPath, nil
	}

	if got := currentWrapperName(); got != legacyWrapperName {
		t.Fatalf("currentWrapperName() = %q, want %q", got, legacyWrapperName)
	}
}
