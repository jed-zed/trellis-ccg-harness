package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestKimiBuildArgsOfficialPromptContract(t *testing.T) {
	cases := []struct {
		name   string
		cfg    *Config
		prompt string
		want   []string
	}{
		{"native-default", &Config{Mode: "new"}, "task", []string{"--output-format", "stream-json", "-p", "task"}},
		{"blank-model", &Config{KimiModel: " \t "}, "task", []string{"--output-format", "stream-json", "-p", "task"}},
		{"explicit-model", &Config{KimiModel: " custom/model "}, "task", []string{"--output-format", "stream-json", "-m", "custom/model", "-p", "task"}},
		{"resume", &Config{Mode: "resume", SessionID: "kimi-session", KimiModel: "model"}, "next", []string{"--output-format", "stream-json", "-m", "model", "-S", "kimi-session", "-p", "next"}},
		{"stdin-resolved-multiline", &Config{ExplicitStdin: true}, "first\nsecond \"quoted\" $literal", []string{"--output-format", "stream-json", "-p", "first\nsecond \"quoted\" $literal"}},
		{"native-permissions-not-overridden", &Config{SkipPermissions: true, ReadOnly: true}, "task", []string{"--output-format", "stream-json", "-p", "task"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := (KimiBackend{}).BuildArgs(tc.cfg, tc.prompt)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
			for _, arg := range got {
				if arg == "--print" || arg == "--yolo" || arg == "--auto" || arg == "--plan" {
					t.Fatalf("unexpected native permission/UI flag: %s", arg)
				}
			}
		})
	}
	if (KimiBackend{}).BuildArgs(nil, "task") != nil {
		t.Fatal("nil config must return nil")
	}
	if (KimiBackend{}).Name() != "kimi" || (KimiBackend{}).Command() != "kimi" {
		t.Fatal("incorrect Kimi identity")
	}
}

func TestKimiDefaultCommandRejectsArchivedWindowsProductBeforeChildStarts(t *testing.T) {
	if !isWindows() {
		t.Skip("Windows archived kimi.exe PATH regression")
	}
	defer resetTestHooks()
	prefix := t.TempDir()
	legacy := filepath.Join(prefix, "kimi.exe")
	if err := os.WriteFile(legacy, []byte("archived Python launcher; must never execute"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", prefix)
	t.Setenv("PATHEXT", ".EXE;.CMD")
	started := false
	newCommandRunner = func(context.Context, string, ...string) commandRunner { started = true; return nil }
	result := runCodexTaskWithContext(context.Background(), TaskSpec{Task: "must not reach legacy CLI", WorkDir: t.TempDir(), AllowNativeAutoApproval: true}, KimiBackend{}, nil, false, true, 5)
	if result.ExitCode != 1 || !strings.Contains(result.Error, "archived Python") || !strings.Contains(result.Error, "@moonshot-ai/kimi-code@2.1.1") || started {
		t.Fatalf("unverified product started or lacks migration: %+v started=%v", result, started)
	}
	command, args, err := resolveProviderCommandInvocation("kimi", legacy, []string{"explicit fixture"})
	if err != nil || command != legacy || !reflect.DeepEqual(args, []string{"explicit fixture"}) {
		t.Fatalf("explicit custom command changed: %s %v %v", command, args, err)
	}
}

func TestKimiDefaultWindowsCommandAcceptsOnlySupportedNpmProduct(t *testing.T) {
	if !isWindows() {
		t.Skip("Windows canonical npm PATH contract")
	}
	shim, entry, _ := createProviderNpmShimFixture(t, "kimi")
	t.Setenv("PATH", filepath.Dir(shim))
	t.Setenv("PATHEXT", ".EXE;.CMD")
	command, args, err := resolveProviderCommandInvocation("kimi", "kimi", []string{"-p", "one\ntwo"})
	if err != nil || command != filepath.Join(filepath.Dir(shim), "node.exe") || !reflect.DeepEqual(args, []string{entry, "-p", "one\ntwo"}) {
		t.Fatalf("official default resolution=%s %v %v", command, args, err)
	}
}

func writeKimiManagedFixtureReceipt(t *testing.T, prefix string) {
	t.Helper()
	files := map[string]string{}
	err := filepath.WalkDir(prefix, func(file string, item fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if item.IsDir() || filepath.Base(file) == kimiProviderReceipt {
			return nil
		}
		rel, err := filepath.Rel(prefix, file)
		if err != nil {
			return err
		}
		if item.Type()&os.ModeSymlink != 0 {
			target, err := os.Readlink(file)
			if err != nil {
				return err
			}
			files[filepath.ToSlash(rel)] = "link:" + target
		} else {
			data, err := os.ReadFile(file)
			if err != nil {
				return err
			}
			digest := sha256.Sum256(data)
			files[filepath.ToSlash(rel)] = hex.EncodeToString(digest[:])
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(map[string]any{"schema": 1, "backend": "kimi", "version": "2.1.1", "files": files})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(prefix, kimiProviderReceipt), raw, 0644); err != nil {
		t.Fatal(err)
	}
}

func createKimiManagedUnixFixture(t *testing.T) (prefix, launcher, entry string) {
	t.Helper()
	shim, entry, _ := createProviderNpmShimFixture(t, "kimi")
	prefix = filepath.Dir(shim)
	launcher = filepath.Join(prefix, "kimi")
	if err := os.WriteFile(launcher, []byte("#!/bin/sh\nexec node \"$(dirname \"$0\")/node_modules/@moonshot-ai/kimi-code/dist/main.mjs\" \"$@\"\n"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(prefix, "node"), []byte("fixture Node; never executed"), 0755); err != nil {
		t.Fatal(err)
	}
	writeKimiManagedFixtureReceipt(t, prefix)
	return prefix, launcher, entry
}

func TestKimiUnixProductIdentityUsesBoundEntryWithoutExecutingLauncher(t *testing.T) {
	prefix, launcher, entry := createKimiManagedUnixFixture(t)
	command, args, err := resolveOfficialKimiUnixLauncher(launcher, prefix, []string{"-p", "one\ntwo \"$literal\""})
	if err != nil || command != filepath.Join(prefix, "node") || !reflect.DeepEqual(args, []string{entry, "-p", "one\ntwo \"$literal\""}) {
		t.Fatalf("private identity=%s %v %v", command, args, err)
	}
	if _, _, err := resolveOfficialKimiUnixLauncher(launcher, "", []string{"-p", "must not run"}); err == nil || !strings.Contains(err.Error(), "unverified") {
		t.Fatalf("unmanaged shell accepted: %v", err)
	}
	if _, _, err := resolveOfficialKimiUnixLauncher(launcher, t.TempDir(), nil); err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("unbound prefix accepted: %v", err)
	}
	if _, _, err := resolveOfficialKimiUnixLauncher(launcher, "relative-prefix", nil); err == nil || !strings.Contains(err.Error(), "absolute") {
		t.Fatalf("relative prefix accepted: %v", err)
	}
}

func TestKimiUnixStandardNpmLinksValidateProductVersionAndEntry(t *testing.T) {
	for _, layout := range []string{"global", "local"} {
		t.Run(layout, func(t *testing.T) {
			prefix := t.TempDir()
			modules := filepath.Join(prefix, "node_modules")
			bin := filepath.Join(modules, ".bin")
			if layout == "global" {
				modules = filepath.Join(prefix, "lib", "node_modules")
				bin = filepath.Join(prefix, "bin")
			}
			packageRoot := filepath.Join(modules, "@moonshot-ai", "kimi-code")
			entry := filepath.Join(packageRoot, "dist", "main.mjs")
			if err := os.MkdirAll(filepath.Dir(entry), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(bin, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(entry, []byte("fixture official entry; never executed"), 0644); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(bin, "node"), []byte("fixture Node; never executed"), 0755); err != nil {
				t.Fatal(err)
			}
			meta := filepath.Join(packageRoot, "package.json")
			validMeta := `{"name":"@moonshot-ai/kimi-code","version":"2.1.1","bin":{"kimi":"dist/main.mjs"},"repository":"git+https://github.com/MoonshotAI/kimi-code.git"}`
			if err := os.WriteFile(meta, []byte(validMeta), 0644); err != nil {
				t.Fatal(err)
			}
			launcher := filepath.Join(bin, "kimi")
			rel, err := filepath.Rel(bin, entry)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(rel, launcher); err != nil {
				t.Skipf("OS does not permit npm link fixture: %v", err)
			}
			command, args, err := resolveOfficialKimiUnixLauncher(launcher, "", []string{"-p", "preserved"})
			if err != nil || command != filepath.Join(bin, "node") || !reflect.DeepEqual(args, []string{entry, "-p", "preserved"}) {
				t.Fatalf("npm link identity=%s %v %v", command, args, err)
			}
			if err := os.WriteFile(meta, []byte(strings.Replace(validMeta, "2.1.1", "2.1.2", 1)), 0644); err != nil {
				t.Fatal(err)
			}
			if _, _, err := resolveOfficialKimiUnixLauncher(launcher, "", nil); err == nil || !strings.Contains(err.Error(), "unsupported Kimi npm version") {
				t.Fatalf("unverified version accepted: %v", err)
			}
			if err := os.WriteFile(meta, []byte(strings.Replace(validMeta, "@moonshot-ai/kimi-code", "kimi-cli", 1)), 0644); err != nil {
				t.Fatal(err)
			}
			if _, _, err := resolveOfficialKimiUnixLauncher(launcher, "", nil); err == nil || !strings.Contains(err.Error(), "identity mismatch") {
				t.Fatalf("old product identity accepted: %v", err)
			}
		})
	}
}

func TestKimiUnixManagedReceiptFailsClosedBeforeInvocation(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(t *testing.T, prefix, launcher, entry string)
		want   string
	}{
		{"missing", func(t *testing.T, p, l, e string) { os.Remove(filepath.Join(p, kimiProviderReceipt)) }, "ordinary contained"},
		{"oversize", func(t *testing.T, p, l, e string) {
			os.WriteFile(filepath.Join(p, kimiProviderReceipt), []byte(strings.Repeat(" ", kimiReceiptMaxBytes+1)), 0644)
		}, "exceeds"},
		{"wrong-schema", func(t *testing.T, p, l, e string) {
			os.WriteFile(filepath.Join(p, kimiProviderReceipt), []byte(`{"schema":2,"backend":"kimi","version":"2.1.1","files":{"kimi":"fake"}}`), 0644)
		}, "schema 1"},
		{"unsafe-path", func(t *testing.T, p, l, e string) {
			os.WriteFile(filepath.Join(p, kimiProviderReceipt), []byte(`{"schema":1,"backend":"kimi","version":"2.1.1","files":{"../escape":"fake"}}`), 0644)
		}, "unsafe"},
		{"invalid-hash", func(t *testing.T, p, l, e string) {
			os.WriteFile(filepath.Join(p, kimiProviderReceipt), []byte(`{"schema":1,"backend":"kimi","version":"2.1.1","files":{"kimi":"fake"}}`), 0644)
		}, "invalid"},
		{"changed-entry", func(t *testing.T, p, l, e string) { os.WriteFile(e, []byte("changed payload"), 0644) }, "differs"},
		{"changed-launcher", func(t *testing.T, p, l, e string) { os.WriteFile(l, []byte("echo changed"), 0755) }, "differs"},
		{"unrecorded-file", func(t *testing.T, p, l, e string) { os.WriteFile(filepath.Join(p, "other.js"), []byte("new"), 0644) }, "unrecorded"},
		{"missing-recorded-file", func(t *testing.T, p, l, e string) { os.Remove(e) }, "missing files"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			prefix, launcher, entry := createKimiManagedUnixFixture(t)
			tc.mutate(t, prefix, launcher, entry)
			if _, _, err := resolveOfficialKimiUnixLauncher(launcher, prefix, []string{"-p", "must not reach payload"}); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("receipt failure=%v want=%q", err, tc.want)
			}
		})
	}
}

func TestKimiUnixManagedReceiptRejectsExternalLinksAndLinkedIdentityFiles(t *testing.T) {
	for _, targetKind := range []string{"internal-bin", "external-bin", "receipt", "entry"} {
		t.Run(targetKind, func(t *testing.T) {
			prefix, launcher, entry := createKimiManagedUnixFixture(t)
			link := filepath.Join(prefix, "linked-bin")
			target := entry
			if targetKind == "external-bin" {
				target = filepath.Join(t.TempDir(), "external.mjs")
				if err := os.WriteFile(target, []byte("external"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			if targetKind == "receipt" || targetKind == "entry" {
				link = filepath.Join(prefix, kimiProviderReceipt)
				if targetKind == "entry" {
					link = entry
				}
				data, err := os.ReadFile(link)
				if err != nil {
					t.Fatal(err)
				}
				target = filepath.Join(t.TempDir(), "linked-original")
				if err := os.WriteFile(target, data, 0644); err != nil {
					t.Fatal(err)
				}
				if err := os.Remove(link); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.Symlink(target, link); err != nil {
				t.Skipf("OS does not permit link fixture: %v", err)
			}
			if targetKind != "receipt" {
				writeKimiManagedFixtureReceipt(t, prefix)
			}
			_, _, err := resolveOfficialKimiUnixLauncher(launcher, prefix, nil)
			if targetKind == "internal-bin" {
				if err != nil {
					t.Fatalf("contained receipted link rejected: %v", err)
				}
			} else if err == nil {
				t.Fatalf("unsafe %s link accepted", targetKind)
			}
		})
	}
}

func TestKimiUnixUnknownNpmLinkAndLinkedPackageIdentityFailClosed(t *testing.T) {
	for _, fixture := range []string{"wrong-entry", "linked-metadata", "link-loop"} {
		t.Run(fixture, func(t *testing.T) {
			shim, entry, meta := createProviderNpmShimFixture(t, "kimi")
			prefix := filepath.Dir(shim)
			launcher := filepath.Join(prefix, "kimi-link")
			target := entry
			if fixture == "wrong-entry" {
				target = filepath.Join(filepath.Dir(entry), "other.mjs")
				if err := os.WriteFile(target, []byte("unverified payload"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			if fixture == "linked-metadata" {
				data, err := os.ReadFile(meta)
				if err != nil {
					t.Fatal(err)
				}
				external := filepath.Join(t.TempDir(), "package.json")
				if err := os.WriteFile(external, data, 0644); err != nil {
					t.Fatal(err)
				}
				if err := os.Remove(meta); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(external, meta); err != nil {
					t.Skipf("OS does not permit metadata link: %v", err)
				}
			}
			if fixture == "link-loop" {
				target = launcher
			}
			if err := os.Symlink(target, launcher); err != nil {
				t.Skipf("OS does not permit npm link: %v", err)
			}
			if _, _, err := resolveOfficialKimiUnixLauncher(launcher, "", []string{"-p", "must not reach payload"}); err == nil || !strings.Contains(err.Error(), "migration:") {
				t.Fatalf("unknown linked product accepted or lacks migration: %v", err)
			}
		})
	}
}

func TestOpencodeBuildArgsOfficialRunContract(t *testing.T) {
	cases := []struct {
		name   string
		cfg    *Config
		prompt string
		want   []string
	}{
		{"native-default", &Config{}, "task", []string{"run", "--format", "json", "--", "task"}},
		{"stdin-empty", &Config{ExplicitStdin: true}, "", []string{"run", "--format", "json"}},
		{"internal-stdin-marker", &Config{}, "-", []string{"run", "--format", "json"}},
		{"explicit-model", &Config{OpencodeModel: " vendor/model "}, "task", []string{"run", "-m", "vendor/model", "--format", "json", "--", "task"}},
		{"blank-model", &Config{OpencodeModel: " \n "}, "", []string{"run", "--format", "json"}},
		{"resume-stdin", &Config{Mode: "resume", SessionID: "ses_123"}, "", []string{"run", "-s", "ses_123", "--format", "json"}},
		{"literal-flag-prompt", &Config{}, "--model literal task", []string{"run", "--format", "json", "--", "--model literal task"}},
		{"permissions-preserved", &Config{SkipPermissions: true, ReadOnly: true}, "", []string{"run", "--format", "json"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := (OpencodeBackend{}).BuildArgs(tc.cfg, tc.prompt)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
	if (OpencodeBackend{}).BuildArgs(nil, "task") != nil {
		t.Fatal("nil config must return nil")
	}
	if (OpencodeBackend{}).Name() != "opencode" || (OpencodeBackend{}).Command() != "opencode" {
		t.Fatal("incorrect OpenCode identity")
	}
}

func createProviderNpmShimFixture(t *testing.T, backend string) (shimPath, entryPath, metaPath string) {
	t.Helper()
	contract, ok := providerNpmIdentity(backend)
	if !ok {
		t.Fatal("unknown fixture backend")
	}
	prefix := t.TempDir()
	shimPath = filepath.Join(prefix, backend+".cmd")
	packageRoot := filepath.Join(prefix, "node_modules", filepath.FromSlash(contract.packageName))
	entryPath = filepath.Join(packageRoot, filepath.FromSlash(contract.entry))
	metaPath = filepath.Join(packageRoot, "package.json")
	if err := os.MkdirAll(filepath.Dir(entryPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(entryPath, []byte("// fixture; never executed\n"), 0644); err != nil {
		t.Fatal(err)
	}
	meta, _ := json.Marshal(map[string]any{"name": contract.packageName, "version": "2.1.1", "bin": map[string]string{backend: contract.entry}, "repository": map[string]string{"url": "git+" + contract.repository + ".git"}})
	if err := os.WriteFile(metaPath, meta, 0644); err != nil {
		t.Fatal(err)
	}
	template := officialProviderNpmCmdTemplate("node_modules\\" + strings.ReplaceAll(contract.packageName+"/"+contract.entry, "/", "\\"))
	if err := os.WriteFile(shimPath, []byte(strings.ReplaceAll(template, "\n", "\r\n")+"\r\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(prefix, "node.exe"), []byte("fixture; never executed"), 0644); err != nil {
		t.Fatal(err)
	}
	return
}

func TestProviderNpmShimInvocationPreservesArgumentsWithoutShell(t *testing.T) {
	for _, backend := range []string{"kimi", "opencode"} {
		t.Run(backend, func(t *testing.T) {
			shimPath, entryPath, _ := createProviderNpmShimFixture(t, backend)
			args := []string{"-p", "first\nsecond \"quotes\" & $(literal)"}
			node, resolvedArgs, err := resolveOfficialProviderNpmShim(backend, shimPath, args)
			if err != nil {
				t.Fatal(err)
			}
			if node != filepath.Join(filepath.Dir(shimPath), "node.exe") {
				t.Fatalf("unexpected Node: %s", node)
			}
			want := append([]string{entryPath}, args...)
			if !reflect.DeepEqual(resolvedArgs, want) {
				t.Fatalf("got %q, want %q", resolvedArgs, want)
			}
			if !reflect.DeepEqual(args, []string{"-p", "first\nsecond \"quotes\" & $(literal)"}) {
				t.Fatal("mutated caller args")
			}
		})
	}
}

func TestProviderNpmShimRejectsUntrustedOrBrokenIdentity(t *testing.T) {
	cases := []struct {
		name string
		edit func(t *testing.T, shim, entry, meta string)
		want string
	}{
		{"comment-only-spoof", func(t *testing.T, shim, _, _ string) {
			os.WriteFile(shim, []byte("@echo off\nrem node_modules\\@moonshot-ai\\kimi-code\\dist\\main.mjs\necho untrusted\n"), 0644)
		}, "unrecognized"},
		{"extra-command", func(t *testing.T, shim, _, _ string) {
			b, _ := os.ReadFile(shim)
			os.WriteFile(shim, append(b, []byte("echo untrusted\n")...), 0644)
		}, "unrecognized"},
		{"wrong-package", func(t *testing.T, _, _, meta string) {
			os.WriteFile(meta, []byte(`{"name":"kimi-cli","version":"2.1.1","bin":{"kimi":"dist/main.mjs"},"repository":"https://github.com/MoonshotAI/kimi-code"}`), 0644)
		}, "identity mismatch"},
		{"wrong-repository", func(t *testing.T, _, _, meta string) {
			os.WriteFile(meta, []byte(`{"name":"@moonshot-ai/kimi-code","version":"2.1.1","bin":{"kimi":"dist/main.mjs"},"repository":"https://github.com/unrelated/kimi"}`), 0644)
		}, "identity mismatch"},
		{"wrong-bin", func(t *testing.T, _, _, meta string) {
			os.WriteFile(meta, []byte(`{"name":"@moonshot-ai/kimi-code","version":"2.1.1","bin":{"kimi":"../../other.js"},"repository":"https://github.com/MoonshotAI/kimi-code"}`), 0644)
		}, "identity mismatch"},
		{"invalid-metadata", func(t *testing.T, _, _, meta string) { os.WriteFile(meta, []byte(`{broken`), 0644) }, "invalid"},
		{"missing-entry", func(t *testing.T, _, entry, _ string) { os.Remove(entry) }, "missing"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			shim, entry, meta := createProviderNpmShimFixture(t, "kimi")
			tc.edit(t, shim, entry, meta)
			_, _, err := resolveOfficialProviderNpmShim("kimi", shim, []string{"-p", "task"})
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error=%v, want %q", err, tc.want)
			}
		})
	}
}

func TestProviderResolverDoesNotChangeExistingBackendCommand(t *testing.T) {
	args := []string{"unchanged"}
	for _, backend := range []string{"codex", "gemini", "grok", "claude", "antigravity", "pi"} {
		name, resolved, err := resolveProviderCommandInvocation(backend, "arbitrary-existing-command", args)
		if err != nil || name != "arbitrary-existing-command" || !reflect.DeepEqual(args, resolved) {
			t.Fatalf("%s invocation changed: %s %q %v", backend, name, resolved, err)
		}
	}
}

func TestProviderNpmPathRejectsEscapeAndLinks(t *testing.T) {
	prefix := t.TempDir()
	out := t.TempDir()
	entry := filepath.Join(out, "entry.mjs")
	if err := os.WriteFile(entry, []byte("fixture"), 0644); err != nil {
		t.Fatal(err)
	}
	t.Run("path-escape", func(t *testing.T) {
		if err := requireProviderNpmPath(prefix, entry); err == nil || !strings.Contains(err.Error(), "escapes") {
			t.Fatalf("escape error=%v", err)
		}
	})
	t.Run("linked-directory", func(t *testing.T) {
		linked := filepath.Join(prefix, "linked")
		if err := os.Symlink(out, linked); err != nil {
			t.Skipf("OS does not permit symlink fixture: %v", err)
		}
		if err := requireProviderNpmPath(prefix, filepath.Join(linked, "entry.mjs")); err == nil {
			t.Fatal("linked directory was accepted")
		}
	})
}

func TestProviderNpmShimWindowsRealNodePreservesMultilineTask(t *testing.T) {
	if !isWindows() {
		t.Skip("Windows npm shim execution regression")
	}
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("Node.js is not installed")
	}
	shim, entry, _ := createProviderNpmShimFixture(t, "kimi")
	if err := os.Remove(filepath.Join(filepath.Dir(shim), "node.exe")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(entry, []byte("process.stdout.write(JSON.stringify(process.argv.slice(2)));\n"), 0644); err != nil {
		t.Fatal(err)
	}
	want := []string{"--output-format", "stream-json", "-p", "first line\nsecond \"quotes\" & $literal\nthird line"}
	node, args, err := resolveOfficialProviderNpmShim("kimi", shim, want)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, node, args...).Output()
	if err != nil {
		t.Fatalf("fixture Node launcher failed: %v", err)
	}
	var got []string
	if err := json.Unmarshal(output, &got); err != nil {
		t.Fatalf("fixture argv JSON: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Node argv=%q, want %q", got, want)
	}
}
