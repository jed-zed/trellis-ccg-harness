package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/BurntSushi/toml"
)

func writeCodexMCPFixture(t *testing.T, file, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func isolatedCodexMCPFixture(t *testing.T) (home, workdir, systemFile string) {
	t.Helper()
	// TempDir may use a system alias (/var or a Windows 8.3 path). Use the
	// physical root so the fixture exercises configuration, not path aliases.
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	home, workdir = filepath.Join(root, "home"), filepath.Join(root, "project", "nested")
	systemRoot := filepath.Join(root, "program-data")
	systemFile = filepath.Join(systemRoot, "OpenAI", "Codex", "config.toml")
	for _, dir := range []string{home, workdir, filepath.Dir(systemFile)} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(filepath.Dir(workdir), ".git"), 0700); err != nil {
		t.Fatal(err)
	}
	writeCodexMCPFixture(t, systemFile, "[features]\nplugins=false\n")
	t.Setenv("CODEX_HOME", home)
	t.Setenv("ProgramData", systemRoot)
	oldVersionReader := codexMCPVersionReader
	oldSystemReader := codexMCPSystemConfigReader
	codexMCPVersionReader = func() (string, error) { return codexMCPCompatibleVersion, nil }
	codexMCPSystemConfigReader = func() (string, error) { return systemFile, nil }
	t.Cleanup(func() { codexMCPVersionReader = oldVersionReader; codexMCPSystemConfigReader = oldSystemReader })
	return
}

func requireCodexMCPOptOutPlatform(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "darwin" {
		t.Skip("macOS managed preferences cannot be enumerated; Codex MCP opt-out requires --with-mcp")
	}
}

func TestCodexMCPDarwinManagedPreferencesFailClosed(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS managed-preference boundary")
	}
	_, workdir, _ := isolatedCodexMCPFixture(t)
	cfg := &Config{Backend: "codex", WorkDir: workdir, DisableMCP: true}
	err := prepareMCPMode(cfg)
	if err == nil || !strings.Contains(err.Error(), "cannot enumerate macOS managed preferences; use --with-mcp") || cfg.CodexMCPPrepared || len(cfg.CodexMCPOverrides) != 0 {
		t.Fatalf("macOS MCP opt-out did not fail closed: %v", err)
	}
	cfg.DisableMCP = false
	if err := prepareMCPMode(cfg); err != nil {
		t.Fatalf("normal MCP inheritance was rejected: %v", err)
	}
}

func TestCodexMCPAncestorLinkFailsClosed(t *testing.T) {
	home, _, _ := isolatedCodexMCPFixture(t)
	writeCodexMCPFixture(t, filepath.Join(home, "config.toml"), "[mcp_servers.local]\ncommand='never-start'\n")
	alias := filepath.Join(filepath.Dir(home), "linked-home")
	if err := os.Symlink(home, alias); err != nil {
		t.Skip("OS does not permit fixture directory symlinks")
	}
	if _, _, err := readCodexMCPFile(filepath.Join(alias, "config.toml")); err == nil || !strings.Contains(err.Error(), "unsupported link") {
		t.Fatalf("ancestor link bypassed MCP configuration guard: %v", err)
	}
}

func decodedCodexMCPOverrides(t *testing.T, overrides []string) map[string]any {
	t.Helper()
	var table map[string]any
	if _, err := toml.Decode(strings.Join(overrides, "\n"), &table); err != nil {
		t.Fatal(err)
	}
	return table
}

func TestCodexMCPStaticLayersAndQuotedNames(t *testing.T) {
	home, workdir, systemFile := isolatedCodexMCPFixture(t)
	projectRoot := filepath.Dir(workdir)
	writeCodexMCPFixture(t, systemFile, "[features]\nplugins=false\n[mcp_servers.system]\ncommand='never-start-system'\n")
	user := "model='preserved-model'\nmodel_provider='preserved-provider'\n" +
		"[projects." + codexMCPQuote(projectRoot) + "]\ntrust_level='trusted'\n" +
		"[mcp_servers.\"quoted.dot and \\\"quote\\\"\"]\ncommand='never-start-user'\n" +
		"[mcp_servers.already_off]\ncommand='never-start-off'\nenabled=false\n"
	writeCodexMCPFixture(t, filepath.Join(home, "config.toml"), user)
	writeCodexMCPFixture(t, filepath.Join(projectRoot, ".codex", "config.toml"), "mcp_servers={ project={ command='never-start-project' } }\n")
	writeCodexMCPFixture(t, filepath.Join(workdir, "config.toml"), "[mcp_servers.cwd]\ncommand='never-start-cwd'\n")
	before, _ := os.ReadFile(filepath.Join(home, "config.toml"))
	overrides, err := collectCodexMCPOverrides(home, workdir, systemFile)
	if err != nil {
		t.Fatal(err)
	}
	table := decodedCodexMCPOverrides(t, overrides)
	servers, ok := codexMCPTable(table["mcp_servers"])
	if !ok || len(servers) != 5 {
		t.Fatalf("lost server layers: %v", table)
	}
	for _, name := range []string{"system", "quoted.dot and \"quote\"", "already_off", "project", "cwd"} {
		server, ok := codexMCPTable(servers[name])
		if !ok || server["enabled"] != false || len(server) != 1 {
			t.Fatalf("bad override for %q: %v", name, server)
		}
	}
	if _, exists := table["model"]; exists {
		t.Fatal("opt-out changed model configuration")
	}
	after, _ := os.ReadFile(filepath.Join(home, "config.toml"))
	if !reflect.DeepEqual(before, after) {
		t.Fatal("opt-out modified user config")
	}
}

func codexMCPPluginFixture(t *testing.T, home string) (marketplace, config string) {
	t.Helper()
	marketplace = filepath.Join(filepath.Dir(home), "marketplace")
	writeCodexMCPFixture(t, filepath.Join(marketplace, ".codex-plugin", "marketplace.json"), `{"name":"fixture","owner":{"name":"fixture"},"plugins":[{"name":"skill","source":"./plugins/skill"}]}`)
	manifest := `{"name":"skill","skills":"./skills","mcpServers":"./.mcp.json"}`
	for _, root := range []string{filepath.Join(marketplace, "plugins", "skill"), filepath.Join(home, "plugins", "cache", "fixture", "skill", "1.0.0")} {
		writeCodexMCPFixture(t, filepath.Join(root, ".codex-plugin", "plugin.json"), manifest)
		writeCodexMCPFixture(t, filepath.Join(root, ".mcp.json"), `{"mcpServers":{}}`)
		writeCodexMCPFixture(t, filepath.Join(root, "skills", "sample", "SKILL.md"), "sample skill remains available")
	}
	config = "[plugins.\"skill@fixture\"]\nenabled=true\n[marketplaces.fixture]\nsource_type='local'\nsource=" + codexMCPQuote(marketplace) + "\n"
	return
}

func TestCodexMCPRelativeHomeFailsClosed(t *testing.T) {
	_, workdir, _ := isolatedCodexMCPFixture(t)
	t.Setenv("CODEX_HOME", "relative-home")
	cfg := &Config{Backend: "codex", WorkDir: workdir, DisableMCP: true}
	if err := prepareMCPMode(cfg); err == nil || !strings.Contains(err.Error(), "absolute CODEX_HOME") {
		t.Fatalf("relative home was enumerated against wrapper cwd: %v", err)
	}
}

func TestCodexMCPResumePreparesInheritedWrapperDirectory(t *testing.T) {
	requireCodexMCPOptOutPlatform(t)
	home, workdir, _ := isolatedCodexMCPFixture(t)
	wrapperDir := filepath.Join(filepath.Dir(home), "wrapper-project")
	writeCodexMCPFixture(t, filepath.Join(wrapperDir, ".git", "HEAD"), "ref: refs/heads/fixture\n")
	writeCodexMCPFixture(t, filepath.Join(wrapperDir, ".codex", "config.toml"), "[mcp_servers.wrapper]\ncommand='never-start-wrapper'\n")
	writeCodexMCPFixture(t, filepath.Join(workdir, ".codex", "config.toml"), "malformed=[")
	writeCodexMCPFixture(t, filepath.Join(home, "config.toml"), "[projects."+codexMCPQuote(wrapperDir)+"]\ntrust_level='trusted'\n")
	original, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(wrapperDir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(original); err != nil {
			t.Error(err)
		}
	})
	cfg := &Config{Backend: "codex", Mode: "new", WorkDir: workdir, DisableMCP: true}
	if err := prepareMCPMode(cfg); err == nil {
		t.Fatal("new invocation ignored its task directory configuration")
	}
	cfg.Mode = "resume"
	if err := prepareMCPMode(cfg); err != nil {
		t.Fatalf("resume enumerated a task directory unused by its native invocation: %v", err)
	}
	table := decodedCodexMCPOverrides(t, cfg.CodexMCPOverrides)
	servers, _ := codexMCPTable(table["mcp_servers"])
	if len(servers) != 1 || servers["wrapper"] == nil {
		t.Fatal("resume did not enumerate the inherited wrapper directory")
	}
}

func TestCodexMCPPluginFeatureLayerPrecedence(t *testing.T) {
	for _, tc := range []struct {
		name, system, user, project string
		wantError                   bool
	}{
		{"native default is dynamic", "", "", "", true},
		{"user false overrides system true", "[features]\nplugins=true", "[features]\nplugins=false", "", false},
		{"user true overrides system false", "[features]\nplugins=false", "[features]\nplugins=true", "", true},
		{"project true needs acknowledgement", "[features]\nplugins=false", "", "[features]\nplugins=true", true},
		{"project false does not prove native disablement", "", "", "[features]\nplugins=false", true},
		{"invalid user plugin feature", "[features]\nplugins=false", "[features]\nplugins='false'", "", true},
		{"invalid project feature", "[features]\nplugins=false", "", "features='unknown'", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			home, workdir, systemFile := isolatedCodexMCPFixture(t)
			writeCodexMCPFixture(t, systemFile, tc.system)
			writeCodexMCPFixture(t, filepath.Join(home, "config.toml"), tc.user)
			if tc.project != "" {
				writeCodexMCPFixture(t, filepath.Join(workdir, ".codex", "config.toml"), tc.project)
			}
			_, err := collectCodexMCPOverrides(home, workdir, systemFile)
			if (err != nil) != tc.wantError {
				t.Fatalf("incorrect plugin startup gate: %v", err)
			}
		})
	}
}

func TestCodexMCPControlCharacterKeyUsesTOMLEscapes(t *testing.T) {
	home, workdir, systemFile := isolatedCodexMCPFixture(t)
	name := "control\x01\x1b quoted.\"name\""
	writeCodexMCPFixture(t, filepath.Join(home, "config.toml"), "[mcp_servers."+codexMCPQuote(name)+"]\ncommand='never-start-control'\n")
	overrides, err := collectCodexMCPOverrides(home, workdir, systemFile)
	if err != nil {
		t.Fatal(err)
	}
	table := decodedCodexMCPOverrides(t, overrides)
	servers, _ := codexMCPTable(table["mcp_servers"])
	server, _ := codexMCPTable(servers[name])
	if server["enabled"] != false {
		t.Fatal("control-character TOML key did not round-trip into the disabled overlay")
	}
}

func TestCodexMCPChildPluginAcknowledgementFlagAndHeaders(t *testing.T) {
	oldArgs := os.Args
	t.Cleanup(func() { os.Args = oldArgs })
	t.Setenv("ALLOW_CHILD_PLUGIN_DISABLE", "true")
	t.Setenv("CODEAGENT_ALLOW_CHILD_PLUGIN_DISABLE", "true")
	for _, supplied := range []bool{false, true} {
		os.Args = []string{"wrapper", "--backend", "codex", "--without-mcp"}
		if supplied {
			os.Args = append(os.Args, "--allow-child-plugin-disable")
		}
		os.Args = append(os.Args, "task")
		cfg, err := parseArgs()
		if err != nil || cfg.AllowChildPluginDisable != supplied {
			t.Fatalf("child plugin acknowledgement was inferred or lost: %v", err)
		}
	}
	for _, value := range []string{"true", "false", "TRUE", "yes", "true\nallow_child_plugin_disable: false"} {
		cfg, err := parseParallelConfig([]byte(fmt.Sprintf("---TASK---\nid: child\nbackend: codex\nmcp: off\nallow_child_plugin_disable: %s\n---CONTENT---\nlocal", value)))
		if (err == nil) != (value == "true" || value == "false") {
			t.Fatalf("child plugin header accepted invalid boolean for %q: %v", value, err)
		}
		if err == nil && (!cfg.Tasks[0].ChildPluginDisableSet || cfg.Tasks[0].AllowChildPluginDisable != (value == "true")) {
			t.Fatal("explicit child plugin header state was lost")
		}
	}
	for _, cfg := range []*Config{{Backend: "codex"}, {Backend: "gemini", DisableMCP: true}, {Backend: "kimi", DisableMCP: true}} {
		cfg.AllowChildPluginDisable = true
		if err := prepareMCPMode(cfg); err == nil {
			t.Fatal("child plugin acknowledgement was accepted outside Codex opt-out")
		}
	}
}

// Optional, strictly static local acceptance check. It never invokes Codex,
// copies credentials, writes configuration, or prints configuration values.
func TestCodexMCPPersonalStaticDryPreflight(t *testing.T) {
	requireCodexMCPOptOutPlatform(t)
	home := os.Getenv("CODEAGENT_TEST_PERSONAL_STATIC_HOME")
	if home == "" {
		t.Skip("explicit personal static acceptance input not supplied")
	}
	t.Setenv("CODEX_HOME", home)
	workdir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(home, "config.toml"))
	if err != nil {
		t.Fatal("cannot read authorized personal config for unchanged-content proof")
	}
	cfg := &Config{Backend: "codex", WorkDir: workdir, DisableMCP: true}
	if err := prepareMCPMode(cfg); err != nil {
		if !strings.Contains(err.Error(), "enabled Codex plugins") {
			t.Fatalf("personal static preflight refused for unsupported source: %v", err)
		}
		t.Log("personal static preflight without acknowledgement refused: dynamic plugin startup MCP sources are not fully enumerable")
	}
	cfg.AllowChildPluginDisable = true
	if err := prepareMCPMode(cfg); err != nil {
		t.Fatalf("personal acknowledged static preflight refused: %v", err)
	}
	table := decodedCodexMCPOverrides(t, cfg.CodexMCPOverrides)
	servers, _ := codexMCPTable(table["mcp_servers"])
	after, err := os.ReadFile(filepath.Join(home, "config.toml"))
	if err != nil || sha256.Sum256(before) != sha256.Sum256(after) {
		t.Fatal("personal configuration changed during static preparation")
	}
	t.Logf("personal acknowledged static preflight succeeded: configured servers=%d; child plugin startup/skills disabled by explicit acknowledgement; native invocations=0; config writes=0; original config SHA-256 unchanged", len(servers))
}

func TestCodexMCPPluginStartupRequiresExplicitAcknowledgement(t *testing.T) {
	requireCodexMCPOptOutPlatform(t)
	home, workdir, _ := isolatedCodexMCPFixture(t)
	_, user := codexMCPPluginFixture(t, home)
	user = "[features]\nplugins=true\n" + user
	writeCodexMCPFixture(t, filepath.Join(home, "config.toml"), user)
	cfg := &Config{Backend: "codex", WorkDir: workdir, DisableMCP: true}
	if err := prepareMCPMode(cfg); err == nil || !strings.Contains(err.Error(), "plugin skills") || cfg.CodexMCPPrepared {
		t.Fatalf("dynamic plugins were silently accepted: %v", err)
	}
	cfg.AllowChildPluginDisable = true
	if err := prepareMCPMode(cfg); err != nil {
		t.Fatal(err)
	}
	table := decodedCodexMCPOverrides(t, cfg.CodexMCPOverrides)
	features, _ := codexMCPTable(table["features"])
	if features["plugins"] != false {
		t.Fatal("acknowledged child did not disable plugin startup and plugin skills")
	}
	if _, exists := table["plugins"]; exists {
		t.Fatal("child opt-out rewrote individual plugin configuration")
	}
	cfg.DisableMCP, cfg.AllowChildPluginDisable = false, false
	if err := prepareMCPMode(cfg); err != nil || len(cfg.CodexMCPOverrides) != 0 || cfg.CodexMCPPrepared {
		t.Fatalf("inherit retained acknowledged opt-out state: %v", err)
	}
	after, _ := os.ReadFile(filepath.Join(home, "config.toml"))
	if string(after) != user {
		t.Fatal("acknowledgement changed user plugin config")
	}
}

func TestCodexMCPChildPluginAcknowledgementDoesNotEnumerateCaches(t *testing.T) {
	requireCodexMCPOptOutPlatform(t)
	home, workdir, _ := isolatedCodexMCPFixture(t)
	_, user := codexMCPPluginFixture(t, home)
	writeCodexMCPFixture(t, filepath.Join(home, "config.toml"), "[features]\nplugins=true\n"+user)
	writeCodexMCPFixture(t, filepath.Join(home, "plugins", "cache", "fixture", "skill", "1.0.0", ".codex-plugin", "plugin.json"), "deliberately unreadable as a manifest")
	cfg := &Config{Backend: "codex", WorkDir: workdir, DisableMCP: true, AllowChildPluginDisable: true}
	if err := prepareMCPMode(cfg); err != nil {
		t.Fatalf("disabled child tried to discover plugin capabilities: %v", err)
	}
}

func TestCodexMCPMalformedAndUnknownLayersFailClosed(t *testing.T) {
	for _, tc := range []struct{ name, content, extra string }{
		{"malformed", "secret_value='DO_NOT_ECHO'\n[invalid", ""},
		{"invalid server table", "mcp_servers=['bad']", ""},
		{"missing transport", "[mcp_servers.bad]\nenabled=true", ""},
		{"selected profile", "profile='other'", ""},
		{"runtime discovery", "[features]\nexecutor_capability_discovery=true", ""},
		{"unknown plugin", "[features]\nplugins=true\n[plugins.\"unknown@remote\"]\nenabled=true", ""},
		{"nonlocal marketplace", "[features]\nplugins=true\n[plugins.\"unknown@remote\"]\nenabled=true\n[marketplaces.remote]\nsource_type='git'\nsource='https://example.invalid/repo'", ""},
		{"cloud cache", "", "cloud-config-bundle-cache.json"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			home, workdir, systemFile := isolatedCodexMCPFixture(t)
			writeCodexMCPFixture(t, filepath.Join(home, "config.toml"), tc.content)
			if tc.extra != "" {
				writeCodexMCPFixture(t, filepath.Join(home, tc.extra), "{}")
			}
			overrides, err := collectCodexMCPOverrides(home, workdir, systemFile)
			if err == nil || overrides != nil {
				t.Fatalf("unsafe enumeration accepted: %v %v", overrides, err)
			}
			if strings.Contains(err.Error(), "DO_NOT_ECHO") {
				t.Fatal("parser error leaked config value")
			}
		})
	}
}

func TestCodexMCPUnavailableOrLinkedConfigFailsClosed(t *testing.T) {
	for _, mode := range []string{"directory", "oversized", "symlink", "untrusted project"} {
		t.Run(mode, func(t *testing.T) {
			home, workdir, systemFile := isolatedCodexMCPFixture(t)
			file := filepath.Join(home, "config.toml")
			switch mode {
			case "directory":
				if err := os.Mkdir(file, 0700); err != nil {
					t.Fatal(err)
				}
			case "oversized":
				writeCodexMCPFixture(t, file, strings.Repeat("#", maxCodexMCPConfigBytes+1))
			case "symlink":
				target := filepath.Join(home, "target.toml")
				writeCodexMCPFixture(t, target, "")
				if err := os.Symlink(target, file); err != nil {
					t.Skip("OS does not permit fixture symlinks")
				}
			case "untrusted project":
				writeCodexMCPFixture(t, filepath.Join(workdir, ".codex", "config.toml"), "[mcp_servers.project]\ncommand='never-start'\n")
			}
			if _, err := collectCodexMCPOverrides(home, workdir, systemFile); err == nil {
				t.Fatal("unavailable configuration treated as empty")
			}
		})
	}
}

func TestCodexMCPVersionAndPreparationContract(t *testing.T) {
	requireCodexMCPOptOutPlatform(t)
	home, workdir, _ := isolatedCodexMCPFixture(t)
	writeCodexMCPFixture(t, filepath.Join(home, "config.toml"), "[mcp_servers.a]\ncommand='never-start'\n")
	for _, version := range []string{"0.155.0", "0.999.0", ""} {
		codexMCPVersionReader = func() (string, error) { return version, nil }
		cfg := &Config{Backend: "codex", WorkDir: workdir, DisableMCP: true, CodexMCPPrepared: true, CodexMCPOverrides: []string{"stale"}}
		if err := prepareMCPMode(cfg); err == nil || cfg.CodexMCPPrepared || cfg.CodexMCPOverrides != nil {
			t.Fatal("unknown version used stale MCP proof")
		}
	}
	codexMCPVersionReader = func() (string, error) { return "", fmt.Errorf("package enumeration failed") }
	failed := &Config{Backend: "codex", WorkDir: workdir, DisableMCP: true, CodexMCPPrepared: true, CodexMCPOverrides: []string{"stale"}}
	if err := prepareMCPMode(failed); err == nil || failed.CodexMCPPrepared || len(failed.CodexMCPOverrides) != 0 {
		t.Fatal("enumeration error retained stale MCP proof")
	}
	codexMCPVersionReader = func() (string, error) { return codexMCPCompatibleVersion, nil }
	cfg := &Config{Backend: "codex", WorkDir: workdir, DisableMCP: true}
	if err := prepareMCPMode(cfg); err != nil {
		t.Fatal(err)
	}
	if !cfg.CodexMCPPrepared || len(cfg.CodexMCPOverrides) == 0 {
		t.Fatal("valid static config was not prepared")
	}
	for _, mode := range []string{"new", "resume"} {
		cfg.Mode, cfg.SessionID = mode, "session"
		for _, target := range []string{"prompt", "-"} {
			limited := buildCodexArgs(cfg, target)
			cfg.DisableMCP = false
			inherited := buildCodexArgs(cfg, target)
			cfg.DisableMCP = true
			prefix := appendCodexMCPArgs(cfg, []string{"e"})
			restored := append([]string{"e"}, limited[len(prefix):]...)
			if !reflect.DeepEqual(restored, inherited) {
				t.Fatalf("other Codex args changed: %v vs %v", restored, inherited)
			}
		}
	}
	cfg.DisableMCP = false
	codexMCPVersionReader = func() (string, error) { t.Fatal("inherit mode must not enumerate Codex"); return "", nil }
	if err := prepareMCPMode(cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.CodexMCPPrepared || cfg.CodexMCPOverrides != nil {
		t.Fatal("inherit mode retained opt-out overlays")
	}
}

func TestCodexMCPParallelPreflightRejectsBeforeAllChildren(t *testing.T) {
	requireCodexMCPOptOutPlatform(t)
	home, workdir, _ := isolatedCodexMCPFixture(t)
	writeCodexMCPFixture(t, filepath.Join(home, "config.toml"), "malformed = [")
	isolateMCPLiteMode(t)
	defer resetTestHooks()
	setTestTempDir(t, t.TempDir())
	oldArgs := os.Args
	t.Cleanup(func() { os.Args = oldArgs })
	os.Args = []string{"wrapper", "--lite", "--parallel", "--backend", "gemini"}
	stdinReader = strings.NewReader("---TASK---\nid: valid\nworkdir: " + workdir + "\n---CONTENT---\nlocal\n---TASK---\nid: invalid\nbackend: codex\nmcp: off\nworkdir: " + workdir + "\n---CONTENT---\nlocal")
	runCodexTaskFn = func(TaskSpec, int) TaskResult {
		t.Fatal("invalid Codex MCP batch started a provider")
		return TaskResult{}
	}
	if code := run(); code == 0 {
		t.Fatal("invalid batch accepted")
	}
}

func TestCodexMCPParallelPluginAcknowledgementAndInheritance(t *testing.T) {
	requireCodexMCPOptOutPlatform(t)
	_, workdir, _ := isolatedCodexMCPFixture(t)
	isolateMCPLiteMode(t)
	defer resetTestHooks()
	setTestTempDir(t, t.TempDir())
	oldArgs := os.Args
	t.Cleanup(func() { os.Args = oldArgs })
	for _, explicitFalse := range []bool{false, true} {
		os.Args = []string{"wrapper", "--lite", "--parallel", "--backend", "codex", "--without-mcp", "--allow-child-plugin-disable"}
		restore := ""
		if explicitFalse {
			restore = "allow_child_plugin_disable: false\n"
		}
		stdinReader = strings.NewReader("---TASK---\nid: local\nworkdir: " + workdir + "\n---CONTENT---\nlocal\n---TASK---\nid: tools\nmcp: inherit\n" + restore + "dependencies: local\nworkdir: " + workdir + "\n---CONTENT---\nMCP and plugin skills research")
		var seen []TaskSpec
		runCodexTaskFn = func(task TaskSpec, _ int) TaskResult {
			if !explicitFalse {
				t.Fatal("invalid inherited acknowledgement started part of a batch")
			}
			seen = append(seen, task)
			return TaskResult{TaskID: task.ID}
		}
		code := run()
		if !explicitFalse {
			if code == 0 || len(seen) != 0 {
				t.Fatal("inherited plugin acknowledgement bypassed whole-batch preflight")
			}
			continue
		}
		if code != 0 || len(seen) != 2 || !seen[0].AllowChildPluginDisable || !seen[0].DisableMCP || !seen[0].CodexMCPPrepared {
			t.Fatalf("acknowledged opt-out state was lost during batch propagation: code=%d children=%d", code, len(seen))
		}
		if seen[1].AllowChildPluginDisable || seen[1].DisableMCP || seen[1].CodexMCPPrepared || len(seen[1].CodexMCPOverrides) != 0 {
			t.Fatal("explicit inherit/false retained child plugin/MCP opt-out state")
		}
	}
}

func TestCodexMCPExecutorForwardsOnlyPreparedOverrides(t *testing.T) {
	requireCodexMCPOptOutPlatform(t)
	home, workdir, _ := isolatedCodexMCPFixture(t)
	writeCodexMCPFixture(t, filepath.Join(home, "config.toml"), "[mcp_servers.local]\ncommand='never-start'\n")
	isolateMCPLiteMode(t)
	defer resetTestHooks()
	setTestTempDir(t, t.TempDir())
	var seen []string
	newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
		if name != "codex" {
			t.Fatalf("unexpected command: %s", name)
		}
		seen = append([]string{}, args...)
		return &execFakeRunner{stdout: newReasonReadCloser(`{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}`), process: &execFakeProcess{pid: 1234}}
	}
	result := runCodexTaskWithContext(context.Background(), TaskSpec{Task: "payload", MCPMode: "off", WorkDir: workdir}, CodexBackend{}, nil, false, true, 1)
	if result.ExitCode != 0 || result.Error != "" {
		t.Fatalf("mock executor failed: %+v", result)
	}
	if !slices.Contains(seen, `mcp_servers={"local"={enabled=false}}`) {
		t.Fatalf("child MCP overlay lost: %v", seen)
	}
}

func TestCodexMCPExecutorForwardsChildPluginAcknowledgement(t *testing.T) {
	requireCodexMCPOptOutPlatform(t)
	home, workdir, _ := isolatedCodexMCPFixture(t)
	writeCodexMCPFixture(t, filepath.Join(home, "config.toml"), "[features]\nplugins=true\n[mcp_servers.local]\ncommand='never-start'\n")
	isolateMCPLiteMode(t)
	defer resetTestHooks()
	setTestTempDir(t, t.TempDir())
	var seen []string
	newCommandRunner = func(_ context.Context, _ string, args ...string) commandRunner {
		seen = append([]string{}, args...)
		return &execFakeRunner{stdout: newReasonReadCloser(`{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}`), process: &execFakeProcess{pid: 1234}}
	}
	result := runCodexTaskWithContext(context.Background(), TaskSpec{Task: "payload", MCPMode: "off", WorkDir: workdir, AllowChildPluginDisable: true}, CodexBackend{}, nil, false, true, 1)
	if result.ExitCode != 0 || result.Error != "" || !slices.Contains(seen, "features.plugins=false") {
		t.Fatalf("acknowledged child plugin disablement did not reach Codex argv: %+v", result)
	}
}

// Opt-in, real native CLI test. This runs only against synthetic directories
// with no user credentials. It never executes a model or an MCP transport.
func TestCodexMCPNativeListContract(t *testing.T) {
	requireCodexMCPOptOutPlatform(t)
	binary := os.Getenv("CODEAGENT_TEST_CODEX_MCP_BINARY")
	if binary == "" {
		t.Skip("set CODEAGENT_TEST_CODEX_MCP_BINARY to run isolated native Codex compatibility proof")
	}
	// Native Windows uses the OS known folder, rather than ProgramData env.
	// Refuse this probe when an actual system/managed layer could introduce
	// non-synthetic transports; never alter that system layer to isolate it.
	actualSystem, err := defaultCodexMCPSystemConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{actualSystem, filepath.Join(filepath.Dir(actualSystem), "requirements.toml"), filepath.Join(filepath.Dir(actualSystem), "managed_config.toml")} {
		if _, err := os.Lstat(file); err == nil {
			t.Skip("native isolation cannot redirect an existing OS system/managed config layer")
		} else if !os.IsNotExist(err) {
			t.Fatal("cannot confirm absence of OS system/managed configuration for the isolated native probe")
		}
	}
	home, workdir, systemFile := isolatedCodexMCPFixture(t)
	var requests atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1); w.WriteHeader(http.StatusNotFound) }))
	defer server.Close()
	projectRoot := filepath.Dir(workdir)
	config := "model='no-provider-call'\n[features]\nplugins=true\n[projects." + codexMCPQuote(projectRoot) + "]\ntrust_level='trusted'\n" +
		"[mcp_servers.\"quoted.dot name\"]\ncommand='ccg-test-mcp-must-never-execute'\nenabled=true\n" +
		"[mcp_servers.http]\nurl=" + codexMCPQuote(server.URL) + "\nenabled=true\n" +
		"[mcp_servers.system]\ncommand='ccg-system-declaration-serialized-in-isolated-user-layer'\n"
	writeCodexMCPFixture(t, filepath.Join(home, "config.toml"), config)
	writeCodexMCPFixture(t, filepath.Join(projectRoot, ".git", "HEAD"), "ref: refs/heads/fixture\n")
	writeCodexMCPFixture(t, filepath.Join(projectRoot, ".codex", "config.toml"), "[mcp_servers.project]\ncommand='ccg-project-mcp-must-never-execute'\n")
	writeCodexMCPFixture(t, systemFile, "[mcp_servers.system]\ncommand='ccg-system-mcp-must-never-execute'\n")
	marketplace, pluginConfig := codexMCPPluginFixture(t, home)
	writeCodexMCPFixture(t, filepath.Join(home, "config.toml"), config+pluginConfig)
	writeCodexMCPFixture(t, filepath.Join(marketplace, "plugins", "skill", ".mcp.json"), `{"mcpServers":{"plugin.dot":{"command":"ccg-plugin-mcp-must-never-execute"}}}`)
	writeCodexMCPFixture(t, filepath.Join(home, "plugins", "cache", "fixture", "skill", "1.0.0", ".mcp.json"), `{"mcpServers":{"plugin.dot":{"command":"ccg-plugin-mcp-must-never-execute"}}}`)
	before, _ := os.ReadFile(filepath.Join(home, "config.toml"))
	overrides, err := collectCodexMCPOverridesWithPluginAcknowledgement(home, workdir, systemFile, true)
	if err != nil {
		t.Fatal(err)
	}
	args := []string{}
	for _, override := range overrides {
		args = append(args, "-c", override)
	}
	args = append(args, "mcp", "list", "--json")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Dir = workdir
	cmd.Env = []string{"CODEX_HOME=" + home, "HOME=" + home, "USERPROFILE=" + home, "ProgramData=" + filepath.Dir(filepath.Dir(filepath.Dir(systemFile))), "PATH=" + os.Getenv("PATH"), "SystemRoot=" + os.Getenv("SystemRoot"), "TEMP=" + home, "TMP=" + home, "APPDATA=" + home, "LOCALAPPDATA=" + home}
	versionCommand := exec.CommandContext(ctx, binary, "--version")
	versionCommand.Dir, versionCommand.Env = cmd.Dir, cmd.Env
	version, err := versionCommand.Output()
	if err != nil || strings.TrimSpace(string(version)) != "codex-cli "+codexMCPCompatibleVersion {
		t.Fatal("isolated native binary does not match the fixed Codex MCP compatibility version")
	}
	output, err := cmd.Output()
	if err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			t.Fatalf("isolated native list failed: %v; synthetic fixture diagnostic: %s", err, exit.Stderr)
		}
		t.Fatalf("isolated native list failed: %v", err)
	}
	var entries []struct {
		Name    string
		Enabled bool
	}
	if err := json.Unmarshal(output, &entries); err != nil {
		t.Fatalf("invalid native MCP JSON: %v", err)
	}
	names := map[string]bool{}
	for _, entry := range entries {
		if entry.Enabled {
			t.Fatalf("native MCP opt-out left %q enabled", entry.Name)
		}
		names[entry.Name] = true
	}
	for _, name := range []string{"quoted.dot name", "http", "project", "system"} {
		if !names[name] {
			t.Fatalf("native list did not preserve configured server %q (%v)", name, names)
		}
	}
	if names["plugin.dot"] {
		t.Fatal("acknowledged child retained a plugin MCP server")
	}
	if requests.Load() != 0 {
		t.Fatalf("disabled native MCP list made %d HTTP discovery requests", requests.Load())
	}
	after, _ := os.ReadFile(filepath.Join(home, "config.toml"))
	if !reflect.DeepEqual(before, after) {
		t.Fatal("native list modified the synthetic user config")
	}
	t.Logf("Codex %s: %d configured server declarations remain present, all disabled; plugin MCP absent after explicit child plugin acknowledgement; HTTP discovery requests: 0; model invocations: 0", codexMCPCompatibleVersion, len(entries))
}

func TestNativeBackendConfigFlagsAndHeaders(t *testing.T) {
	oldArgs := os.Args
	t.Cleanup(func() { os.Args = oldArgs })
	t.Setenv("KIMI_MODEL", " env-kimi ")
	t.Setenv("OPENCODE_MODEL", " env/provider ")
	for _, args := range [][]string{{"--allow-native-auto-approval", "--kimi-model= cli-kimi ", "--opencode-model", " cli/provider ", "task"}, {"--kimi-model", "cli-kimi", "--opencode-model=cli/provider", "task"}} {
		os.Args = append([]string{"wrapper"}, args...)
		cfg, err := parseArgs()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.KimiModel != "cli-kimi" || cfg.OpencodeModel != "cli/provider" {
			t.Fatalf("native model precedence lost: %+v", cfg)
		}
		if cfg.AllowNativeAutoApproval != slices.Contains(args, "--allow-native-auto-approval") {
			t.Fatal("native permission acknowledgement was inferred")
		}
	}
	for _, flag := range []string{"--kimi-model", "--opencode-model"} {
		for _, args := range [][]string{{flag, " ", "task"}, {flag + "= ", "task"}, {flag, "--with-mcp", "task"}} {
			os.Args = append([]string{"wrapper"}, args...)
			if _, err := parseArgs(); err == nil {
				t.Fatalf("invalid model value accepted: %v", args)
			}
		}
	}
	for _, value := range []string{"true", "false", "TRUE", "yes", "true\nnative_auto_approval: false"} {
		_, err := parseParallelConfig([]byte(fmt.Sprintf("---TASK---\nid: native\nbackend: kimi\nnative_auto_approval: %s\n---CONTENT---\nlocal", value)))
		if (err == nil) != (value == "true" || value == "false") {
			t.Fatalf("native header contract lost for %q: %v", value, err)
		}
	}
}
