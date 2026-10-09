package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/BurntSushi/toml"
)

const codexMCPCompatibleVersion = "0.156.1"
const maxCodexMCPConfigBytes = 1 << 20

// Static preparation deliberately never executes Codex against the user's home:
// native mcp list may discover HTTP authentication and maintain plugin caches.
var codexMCPVersionReader = readCodexMCPPackageVersion
var codexMCPSystemConfigReader = defaultCodexMCPSystemConfigPath

func readCodexMCPPackageVersion() (string, error) {
	command, err := exec.LookPath(CodexBackend{}.Command())
	if err != nil {
		return "", fmt.Errorf("cannot locate Codex for MCP opt-out")
	}
	resolved, err := filepath.EvalSymlinks(command)
	if err != nil {
		return "", fmt.Errorf("cannot resolve Codex for MCP opt-out")
	}
	candidates := []string{filepath.Join(filepath.Dir(command), "node_modules", "@openai", "codex", "package.json")}
	for dir, n := filepath.Dir(resolved), 0; n < 9; n++ {
		candidates = append(candidates, filepath.Join(dir, "package.json"))
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	for _, file := range candidates {
		data, exists, err := readCodexMCPFile(file)
		if err != nil {
			return "", err
		}
		if !exists {
			continue
		}
		var metadata struct{ Name, Version string }
		if json.Unmarshal(data, &metadata) == nil && metadata.Name == "@openai/codex" {
			return metadata.Version, nil
		}
	}
	return "", fmt.Errorf("cannot verify Codex package version for MCP opt-out; use --with-mcp")
}

func prepareCodexMCP(cfg *Config) error {
	cfg.CodexMCPPrepared = false
	cfg.CodexMCPOverrides = nil
	version, err := codexMCPVersionReader()
	if err != nil {
		return err
	}
	if version != codexMCPCompatibleVersion {
		return fmt.Errorf("Codex MCP opt-out is verified only for %s (found %s); use --with-mcp", codexMCPCompatibleVersion, version)
	}
	home := strings.TrimSpace(os.Getenv("CODEX_HOME"))
	if home != "" && !filepath.IsAbs(home) {
		return fmt.Errorf("Codex MCP opt-out requires absolute CODEX_HOME because task and wrapper directories may differ; use --with-mcp")
	}
	if home == "" {
		userHome, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("cannot resolve Codex home for MCP opt-out")
		}
		home = filepath.Join(userHome, ".codex")
	}
	workdir := cfg.WorkDir
	// Existing Codex resume invocations omit -C and do not set cmd.Dir.
	// Enumerate that inherited cwd, rather than a task workdir that is unused.
	if cfg.Mode == "resume" {
		workdir, err = os.Getwd()
		if err != nil {
			return fmt.Errorf("cannot resolve Codex resume workdir for MCP opt-out")
		}
	}
	if workdir == "" {
		workdir = defaultWorkdir
	}
	systemFile, err := codexMCPSystemConfigReader()
	if err != nil {
		return fmt.Errorf("cannot resolve Codex system configuration for MCP opt-out")
	}
	if runtime.GOOS == "darwin" {
		return fmt.Errorf("Codex MCP opt-out cannot enumerate macOS managed preferences; use --with-mcp")
	}
	overrides, err := collectCodexMCPOverridesWithPluginAcknowledgement(home, workdir, systemFile, cfg.AllowChildPluginDisable)
	if err != nil {
		return fmt.Errorf("cannot prepare Codex child MCP opt-out: %w", err)
	}
	cfg.CodexMCPOverrides = overrides
	cfg.CodexMCPPrepared = true
	return nil
}

// Root table values handle quoted/dotted server names. Codex's -c path parser
// splits on every dot and does not parse TOML quoting on the left of '='.
func appendCodexMCPArgs(cfg *Config, args []string) []string {
	if !cfg.DisableMCP {
		return args
	}
	if !cfg.CodexMCPPrepared || len(cfg.CodexMCPOverrides) == 0 {
		panic("Codex MCP opt-out requires successful preparation before argument construction")
	}
	for _, override := range cfg.CodexMCPOverrides {
		args = append(args, "-c", override)
	}
	return args
}

func readCodexMCPFile(file string) ([]byte, bool, error) {
	info, err := os.Lstat(file)
	if os.IsNotExist(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("cannot inspect MCP configuration file %s", file)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() > maxCodexMCPConfigBytes {
		return nil, false, fmt.Errorf("MCP configuration must be a regular file of at most 1 MiB: %s", file)
	}
	resolved, err := filepath.EvalSymlinks(file)
	abs, absErr := filepath.Abs(file)
	if err != nil || absErr != nil || !sameCodexMCPPath(abs, resolved) {
		return nil, false, fmt.Errorf("MCP configuration contains an unsupported link: %s", file)
	}
	data, err := os.ReadFile(file)
	if err != nil || len(data) > maxCodexMCPConfigBytes || !utf8.Valid(data) {
		return nil, false, fmt.Errorf("cannot read MCP configuration file %s", file)
	}
	return data, true, nil
}

func sameCodexMCPPath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func codexMCPTable(value any) (map[string]any, bool) {
	table, ok := value.(map[string]any)
	return table, ok
}

func collectCodexMCPOverrides(home, workdir, systemFile string) ([]string, error) {
	return collectCodexMCPOverridesWithPluginAcknowledgement(home, workdir, systemFile, false)
}

func collectCodexMCPOverridesWithPluginAcknowledgement(home, workdir, systemFile string, allowPluginDisable bool) ([]string, error) {
	if !filepath.IsAbs(home) {
		return nil, fmt.Errorf("Codex MCP opt-out requires absolute CODEX_HOME; use --with-mcp")
	}
	home, err := filepath.Abs(home)
	if err != nil {
		return nil, fmt.Errorf("invalid Codex home")
	}
	workdir, err = filepath.Abs(workdir)
	if err != nil {
		return nil, fmt.Errorf("invalid task workdir")
	}
	info, err := os.Stat(workdir)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("task workdir is unavailable")
	}
	// Known managed/cloud sources cannot be reproduced safely by this local
	// static contract. Never assume an unreadable or unknown layer is empty.
	for _, file := range []string{
		filepath.Join(home, "cloud-config-bundle-cache.json"),
		filepath.Join(filepath.Dir(systemFile), "managed_config.toml"),
		filepath.Join(filepath.Dir(systemFile), "requirements.toml"),
	} {
		if _, err := os.Lstat(file); err == nil {
			return nil, fmt.Errorf("managed/cloud MCP configuration is unsupported (%s); use --with-mcp", filepath.Base(file))
		} else if !os.IsNotExist(err) {
			return nil, fmt.Errorf("cannot inspect managed/cloud configuration")
		}
	}
	files := []string{systemFile, filepath.Join(home, "config.toml")}
	for _, file := range files {
		data, exists, err := readCodexMCPFile(file)
		if err != nil {
			return nil, err
		}
		if !exists {
			continue
		}
		var table map[string]any
		if _, err := toml.Decode(string(data), &table); err != nil {
			return nil, fmt.Errorf("invalid TOML MCP configuration in %s", file)
		}
		if _, exists := table["project_root_markers"]; exists {
			return nil, fmt.Errorf("custom project root markers require a separate MCP contract; use --with-mcp")
		}
	}
	projectRoot := workdir
	for dir := workdir; ; dir = filepath.Dir(dir) {
		if _, err := os.Lstat(filepath.Join(dir, ".git")); err == nil {
			projectRoot = dir
			break
		} else if !os.IsNotExist(err) {
			return nil, fmt.Errorf("cannot determine project root for MCP opt-out")
		}
		if filepath.Dir(dir) == dir {
			break
		}
	}
	projectFiles := map[string]bool{}
	for dir := workdir; ; dir = filepath.Dir(dir) {
		file := filepath.Join(dir, ".codex", "config.toml")
		files = append(files, file)
		projectFiles[file] = true
		if sameCodexMCPPath(dir, projectRoot) {
			break
		}
	}
	cwdFile := filepath.Join(workdir, "config.toml")
	files = append(files, cwdFile)
	projectFiles[cwdFile] = true
	servers := map[string]bool{}
	pluginsEnabled := true // Codex 0.156.1 native default.
	projectMayEnablePlugins := false
	projectServers := false
	trusted := false
	untrusted := false
	seen := map[string]bool{}
	for _, file := range files {
		if seen[file] {
			continue
		}
		seen[file] = true
		data, exists, err := readCodexMCPFile(file)
		if err != nil {
			return nil, err
		}
		if !exists {
			continue
		}
		var table map[string]any
		if _, err := toml.Decode(string(data), &table); err != nil {
			// Do not echo parser errors: they may include config values/secrets.
			return nil, fmt.Errorf("invalid TOML MCP configuration in %s", file)
		}
		if profile, exists := table["profile"]; exists && profile != "" {
			return nil, fmt.Errorf("selected Codex profiles require a separate MCP contract; use --with-mcp")
		}
		if featureValue, exists := table["features"]; exists {
			features, ok := codexMCPTable(featureValue)
			if !ok {
				return nil, fmt.Errorf("invalid Codex feature configuration")
			}
			if value, exists := features["plugins"]; exists {
				enabled, ok := value.(bool)
				if !ok {
					return nil, fmt.Errorf("invalid Codex plugin feature enablement")
				}
				if projectFiles[file] {
					// Project trust/layer precedence may suppress this file. Do
					// not infer that a project-only false disables the native
					// startup synchronizers; an explicit true needs the ack.
					projectMayEnablePlugins = projectMayEnablePlugins || enabled
				} else {
					pluginsEnabled = enabled
				}
			}
			if value, exists := features["executor_capability_discovery"]; exists {
				active, ok := value.(bool)
				if !ok || active {
					return nil, fmt.Errorf("runtime capability MCP sources are unsupported; use --with-mcp")
				}
			}
		}
		localNames := map[string]bool{}
		if err := collectCodexMCPTableNames(table, localNames); err != nil {
			return nil, fmt.Errorf("invalid MCP server table in %s", file)
		}
		if err := collectCodexMCPTableNames(table, servers); err != nil {
			return nil, fmt.Errorf("invalid MCP server table in %s", file)
		}
		if projectFiles[file] && len(localNames) > 0 {
			projectServers = true
		}
		if !projectFiles[file] {
			if projects, ok := codexMCPTable(table["projects"]); ok {
				for root, value := range projects {
					if project, ok := codexMCPTable(value); ok {
						rootPath, err := filepath.Abs(root)
						if err == nil && codexMCPPathWithin(rootPath, workdir) {
							trusted = trusted || project["trust_level"] == "trusted"
							untrusted = untrusted || project["trust_level"] == "untrusted"
						}
					}
				}
			}
		}
	}
	if projectServers && (!trusted || untrusted) {
		return nil, fmt.Errorf("project MCP configuration needs a recorded trusted project for static opt-out; use --with-mcp")
	}
	if (pluginsEnabled || projectMayEnablePlugins) && !allowPluginDisable {
		return nil, fmt.Errorf("enabled Codex plugins can add unknown MCP servers during exec startup; use --with-mcp or explicitly acknowledge losing this child's plugin skills with --allow-child-plugin-disable")
	}
	// Built-in Apps MCP and skill-triggered MCP installation are also scoped
	// to this child. Plugin startup sync is disabled only after explicit ack;
	// the wrapper never silently discards a child's plugin skills.
	overrides := []string{"features.apps=false", "features.skill_mcp_dependency_install=false"}
	if allowPluginDisable {
		overrides = append(overrides, "features.plugins=false")
	}
	if len(servers) > 0 {
		overrides = append(overrides, "mcp_servers="+codexMCPDisabledTable(servers))
	}
	return overrides, nil
}

func codexMCPPathWithin(root, path string) bool {
	if runtime.GOOS == "windows" {
		root, path = strings.ToLower(root), strings.ToLower(path)
	}
	rel, err := filepath.Rel(root, path)
	return err == nil && !filepath.IsAbs(rel) && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func collectCodexMCPTableNames(table map[string]any, names map[string]bool) error {
	if value, exists := table["mcp_servers"]; exists {
		servers, ok := codexMCPTable(value)
		if !ok {
			return fmt.Errorf("mcp_servers must be a table")
		}
		for name, value := range servers {
			server, ok := codexMCPTable(value)
			if !ok || strings.TrimSpace(name) == "" {
				return fmt.Errorf("invalid server declaration")
			}
			if _, command := server["command"].(string); !command {
				if _, url := server["url"].(string); !url {
					return fmt.Errorf("server transport is missing")
				}
			}
			names[name] = true
		}
	}
	return nil
}

func codexMCPDisabledTable(names map[string]bool) string {
	keys := make([]string, 0, len(names))
	for name := range names {
		keys = append(keys, name)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, name := range keys {
		parts = append(parts, codexMCPQuote(name)+"={enabled=false}")
	}
	return "{" + strings.Join(parts, ",") + "}"
}

func codexMCPQuote(value string) string {
	// JSON string escapes are valid TOML basic-string escapes. strconv.Quote
	// may emit Go-only \\x escapes for control characters.
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
