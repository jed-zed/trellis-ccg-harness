package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
)

// KimiBackend targets MoonshotAI/kimi-code, not the archived Python kimi-cli.
// Its prompt mode uses native auto approval. The execution entry point must
// obtain the caller's explicit acknowledgement before launching this backend.
type KimiBackend struct{}

func (KimiBackend) Name() string    { return "kimi" }
func (KimiBackend) Command() string { return "kimi" }
func (KimiBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildKimiArgs(cfg, targetArg)
}

func buildKimiArgs(cfg *Config, targetArg string) []string {
	if cfg == nil {
		return nil
	}
	args := []string{"--output-format", "stream-json"}
	if model := strings.TrimSpace(cfg.KimiModel); model != "" {
		args = append(args, "-m", model)
	}
	if cfg.Mode == "resume" && cfg.SessionID != "" {
		args = append(args, "-S", cfg.SessionID)
	}
	// This CLI requires an actual prompt argument, including when the wrapper
	// read its task from stdin. It does not implement a stdin prompt marker.
	// --yolo/--auto/--plan are forbidden together with -p by the native CLI.
	return append(args, "-p", targetArg)
}

type OpencodeBackend struct{}

func (OpencodeBackend) Name() string    { return "opencode" }
func (OpencodeBackend) Command() string { return "opencode" }
func (OpencodeBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildOpencodeArgs(cfg, targetArg)
}

func buildOpencodeArgs(cfg *Config, targetArg string) []string {
	if cfg == nil {
		return nil
	}
	args := []string{"run"}
	if model := strings.TrimSpace(cfg.OpencodeModel); model != "" {
		args = append(args, "-m", model)
	}
	if cfg.Mode == "resume" && cfg.SessionID != "" {
		args = append(args, "-s", cfg.SessionID)
	}
	args = append(args, "--format", "json")
	// OpenCode reads redirected text from stdin. Only an actual positional
	// prompt may be forwarded; '-' is the wrapper's internal stdin sentinel.
	if targetArg != "" && targetArg != "-" {
		args = append(args, "--", targetArg)
	}
	return args
}

// The default Kimi command must identify the supported npm product before any
// prompt is sent. Explicit custom command names retain their caller contract.
// Verified npm entries run through Node without executing launcher text.
func resolveProviderCommandInvocation(backendName, commandName string, args []string) (string, []string, error) {
	if backendName == "kimi" && commandName == "kimi" {
		resolved, err := exec.LookPath(commandName)
		if err != nil {
			return "", nil, fmt.Errorf("kimi command not found in PATH: install @moonshot-ai/kimi-code@%s in a private prefix: %w", supportedKimiVersion, err)
		}
		if isWindows() {
			if !strings.EqualFold(filepath.Ext(resolved), ".cmd") {
				return "", nil, unsupportedKimiProduct(resolved)
			}
			return resolveOfficialProviderNpmShim("kimi", resolved, args)
		}
		return resolveOfficialKimiUnixLauncher(resolved, os.Getenv("CCG_KIMI_PREFIX"), args)
	}
	if !isWindows() || (backendName != "kimi" && backendName != "opencode") {
		return commandName, args, nil
	}
	resolved, err := exec.LookPath(commandName)
	if err != nil {
		return "", nil, fmt.Errorf("%s command not found in PATH: install its documented official CLI first: %w", backendName, err)
	}
	if !strings.EqualFold(filepath.Ext(resolved), ".cmd") {
		if strings.EqualFold(filepath.Ext(resolved), ".ps1") || strings.EqualFold(filepath.Ext(resolved), ".bat") {
			return "", nil, fmt.Errorf("unsupported %s wrapper %q: use the official npm .cmd shim or native executable", backendName, resolved)
		}
		return resolved, args, nil
	}
	return resolveOfficialProviderNpmShim(backendName, resolved, args)
}

const supportedKimiVersion = "2.1.1"
const kimiProviderReceipt = ".ccg-provider-tool.json"
const kimiReceiptMaxBytes = 8 * 1024 * 1024

func unsupportedKimiProduct(resolved string) error {
	return fmt.Errorf("unsupported or unverified Kimi product %q: archived Python kimi-cli and unverified native launchers are unsupported; use official @moonshot-ai/kimi-code@%s in a private prefix or a verified npm launcher; migration: https://moonshotai.github.io/kimi-code/en/guides/getting-started", resolved, supportedKimiVersion)
}

type providerNpmContract struct {
	packageName string
	entry       string
	repository  string
}

func providerNpmIdentity(backend string) (providerNpmContract, bool) {
	switch backend {
	case "kimi":
		return providerNpmContract{"@moonshot-ai/kimi-code", "dist/main.mjs", "https://github.com/MoonshotAI/kimi-code"}, true
	case "opencode":
		return providerNpmContract{"opencode-ai", "bin/opencode", "https://github.com/anomalyco/opencode"}, true
	default:
		return providerNpmContract{}, false
	}
}

func officialProviderNpmCmdTemplate(entry string) string {
	return "@ECHO off\nGOTO start\n:find_dp0\nSET dp0=%~dp0\nEXIT /b\n:start\nSETLOCAL\nCALL :find_dp0\n\nIF EXIST \"%dp0%\\node.exe\" (\n  SET \"_prog=%dp0%\\node.exe\"\n) ELSE (\n  SET \"_prog=node\"\n  SET PATHEXT=%PATHEXT:;.JS;=;%\n)\n\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \"%dp0%\\" + entry + "\" %*"
}

func normalizeProviderRepository(value string) string {
	value = strings.TrimPrefix(strings.TrimSpace(value), "git+")
	value = strings.TrimSuffix(value, ".git")
	return strings.TrimSuffix(value, "/")
}

func requireProviderRegularFile(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("expected regular file: %s", path)
	}
	return nil
}

// requireProviderNpmPath walks only the selected npm prefix. Rejecting every
// internal link/junction is stricter than following links and checking their
// destination, and does not require metadata access to unrelated ancestors.
func requireProviderNpmPath(prefix, target string) error {
	prefixAbs, err := filepath.Abs(prefix)
	if err != nil {
		return err
	}
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(prefixAbs, targetAbs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return fmt.Errorf("npm package path escapes the selected prefix")
	}
	parts := strings.Split(rel, string(os.PathSeparator))
	current := prefixAbs
	for index := -1; index < len(parts); index++ {
		if index >= 0 {
			current = filepath.Join(current, parts[index])
		}
		info, err := os.Lstat(current)
		if err != nil {
			return err
		}
		if info.Mode()&(os.ModeSymlink|os.ModeIrregular) != 0 {
			return fmt.Errorf("npm package path contains a link or junction: %s", current)
		}
		if index == len(parts)-1 {
			if !info.Mode().IsRegular() {
				return fmt.Errorf("expected regular npm package file: %s", current)
			}
		} else if !info.IsDir() {
			return fmt.Errorf("expected ordinary npm package directory: %s", current)
		}
	}
	return nil
}

func resolveOfficialProviderNpmShim(backend, shimPath string, args []string) (string, []string, error) {
	contract, ok := providerNpmIdentity(backend)
	if !ok {
		return "", nil, fmt.Errorf("unsupported npm backend %q", backend)
	}
	if err := requireProviderNpmPath(filepath.Dir(shimPath), shimPath); err != nil {
		return "", nil, fmt.Errorf("untrusted %s npm shim: %w", backend, err)
	}
	shimBytes, err := os.ReadFile(shimPath)
	if err != nil {
		return "", nil, err
	}
	relativeEntry := "node_modules\\" + strings.ReplaceAll(contract.packageName+"/"+contract.entry, "/", "\\")
	actualShim := strings.TrimSpace(strings.ReplaceAll(string(shimBytes), "\r\n", "\n"))
	if actualShim != officialProviderNpmCmdTemplate(relativeEntry) {
		return "", nil, fmt.Errorf("unrecognized %s npm shim: preserve it and use the documented official native executable or reinstall the official package", backend)
	}
	packageRoot := filepath.Join(filepath.Dir(shimPath), "node_modules", filepath.FromSlash(contract.packageName))
	entryPath, err := verifyProviderNpmPackage(backend, filepath.Dir(shimPath), packageRoot)
	if err != nil {
		return "", nil, err
	}
	return resolveProviderNodeInvocation(backend, filepath.Dir(shimPath), entryPath, args, true)
}

func verifyProviderNpmPackage(backend, prefix, packageRoot string) (string, error) {
	contract, ok := providerNpmIdentity(backend)
	if !ok {
		return "", fmt.Errorf("unsupported npm backend %q", backend)
	}
	metaPath := filepath.Join(packageRoot, "package.json")
	if err := requireProviderNpmPath(prefix, metaPath); err != nil {
		return "", fmt.Errorf("missing %s official package metadata: %w", backend, err)
	}
	metaBytes, err := os.ReadFile(metaPath)
	if err != nil {
		return "", err
	}
	var meta struct {
		Name       string            `json:"name"`
		Version    string            `json:"version"`
		Bin        map[string]string `json:"bin"`
		Repository json.RawMessage   `json:"repository"`
	}
	if err := json.Unmarshal(metaBytes, &meta); err != nil {
		return "", fmt.Errorf("invalid %s package metadata: %w", backend, err)
	}
	var repo string
	if json.Unmarshal(meta.Repository, &repo) != nil {
		var object struct {
			URL string `json:"url"`
		}
		if json.Unmarshal(meta.Repository, &object) == nil {
			repo = object.URL
		}
	}
	if meta.Name != contract.packageName || strings.TrimSpace(meta.Version) == "" ||
		(strings.TrimPrefix(meta.Bin[backend], "./") != contract.entry) ||
		!strings.EqualFold(normalizeProviderRepository(repo), contract.repository) {
		return "", fmt.Errorf("%s npm package identity mismatch: expected %s from %s", backend, contract.packageName, contract.repository)
	}
	if backend == "kimi" && meta.Version != supportedKimiVersion {
		return "", fmt.Errorf("unsupported Kimi npm version %q: this wrapper's stream contract requires @moonshot-ai/kimi-code@%s; migration: https://moonshotai.github.io/kimi-code/en/guides/getting-started", meta.Version, supportedKimiVersion)
	}
	entryPath := filepath.Join(packageRoot, filepath.FromSlash(contract.entry))
	if err := requireProviderNpmPath(prefix, entryPath); err != nil {
		return "", fmt.Errorf("missing %s official npm entry: %w", backend, err)
	}
	entryPath, err = filepath.Abs(entryPath)
	if err != nil {
		return "", err
	}
	return entryPath, nil
}

func resolveProviderNodeInvocation(backend, prefix, entryPath string, args []string, windows bool) (string, []string, error) {
	nodeFile := "node"
	if windows {
		nodeFile = "node.exe"
	}
	nodePath := filepath.Join(prefix, nodeFile)
	if err := requireProviderRegularFile(nodePath); err != nil {
		nodePath, err = exec.LookPath("node")
		if err != nil {
			return "", nil, fmt.Errorf("%s official npm launcher requires Node.js: %w", backend, err)
		}
	}
	if windows && !strings.EqualFold(filepath.Ext(nodePath), ".exe") {
		return "", nil, fmt.Errorf("%s npm launcher requires a native Node.js executable, not a shell wrapper", backend)
	}
	if !windows {
		var err error
		nodePath, err = resolveProviderFileLinks(nodePath, false)
		if err != nil {
			return "", nil, fmt.Errorf("invalid %s Node.js executable: %w", backend, err)
		}
	}
	if err := requireProviderRegularFile(nodePath); err != nil {
		return "", nil, fmt.Errorf("invalid %s Node.js executable: %w", backend, err)
	}
	return nodePath, append([]string{entryPath}, args...), nil
}

// Unix npm bin links are followed as filesystem links, never interpreted as
// shell code. Only the fixed package entry and verified identity are accepted.
func resolveOfficialKimiUnixLauncher(resolved, managedPrefix string, args []string) (string, []string, error) {
	if managedPrefix != "" {
		if !filepath.IsAbs(managedPrefix) || strings.IndexFunc(managedPrefix, func(r rune) bool { return r < 32 || r == 127 }) >= 0 {
			return "", nil, fmt.Errorf("CCG_KIMI_PREFIX must be an absolute single-line private prefix")
		}
		prefix := filepath.Clean(managedPrefix)
		resolvedAbs, err := filepath.Abs(resolved)
		if err != nil || resolvedAbs != filepath.Join(prefix, "kimi") {
			return "", nil, fmt.Errorf("Kimi PATH launcher does not match CCG_KIMI_PREFIX")
		}
		if err := verifyManagedKimiReceipt(prefix); err != nil {
			return "", nil, err
		}
		entry, err := verifyProviderNpmPackage("kimi", prefix, filepath.Join(prefix, "node_modules", "@moonshot-ai", "kimi-code"))
		if err != nil {
			return "", nil, err
		}
		if err := requireProviderNpmPath(prefix, resolvedAbs); err != nil {
			return "", nil, err
		}
		return resolveProviderNodeInvocation("kimi", prefix, entry, args, false)
	}
	entry, err := resolveProviderFileLinks(resolved, true)
	if err != nil {
		return "", nil, unsupportedKimiProduct(resolved)
	}
	packageRoot := filepath.Dir(filepath.Dir(entry))
	wantEntry, err := verifyProviderNpmPackage("kimi", packageRoot, packageRoot)
	if err != nil {
		return "", nil, fmt.Errorf("%w; identity check: %v", unsupportedKimiProduct(resolved), err)
	}
	if entry != wantEntry {
		return "", nil, unsupportedKimiProduct(resolved)
	}
	return resolveProviderNodeInvocation("kimi", filepath.Dir(resolved), entry, args, false)
}

func resolveProviderFileLinks(file string, requireLink bool) (string, error) {
	current, err := filepath.Abs(file)
	if err != nil {
		return "", err
	}
	for links := 0; links < 32; links++ {
		info, err := os.Lstat(current)
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink == 0 {
			if !info.Mode().IsRegular() || requireLink && links == 0 {
				return "", fmt.Errorf("expected a standard npm bin link ending at a regular entry")
			}
			return current, nil
		}
		target, err := os.Readlink(current)
		if err != nil {
			return "", err
		}
		if !filepath.IsAbs(target) {
			target = filepath.Join(filepath.Dir(current), target)
		}
		current = filepath.Clean(target)
	}
	return "", fmt.Errorf("provider executable contains a symlink loop")
}

func verifyManagedKimiReceipt(prefix string) error {
	receiptPath := filepath.Join(prefix, kimiProviderReceipt)
	if err := requireProviderNpmPath(prefix, receiptPath); err != nil {
		return fmt.Errorf("Kimi private receipt must be an ordinary contained file: %w", err)
	}
	receiptFile, err := os.Open(receiptPath)
	if err != nil {
		return err
	}
	defer receiptFile.Close()
	raw, err := io.ReadAll(io.LimitReader(receiptFile, kimiReceiptMaxBytes+1))
	if err != nil {
		return err
	}
	if len(raw) > kimiReceiptMaxBytes {
		return fmt.Errorf("Kimi private receipt exceeds %d bytes", kimiReceiptMaxBytes)
	}
	var receipt struct {
		Schema  int               `json:"schema"`
		Backend string            `json:"backend"`
		Version string            `json:"version"`
		Files   map[string]string `json:"files"`
	}
	if err := json.Unmarshal(raw, &receipt); err != nil {
		return fmt.Errorf("invalid Kimi private receipt: %w", err)
	}
	if receipt.Schema != 1 || receipt.Backend != "kimi" || receipt.Version != supportedKimiVersion || len(receipt.Files) == 0 {
		return fmt.Errorf("Kimi private receipt requires kimi@%s schema 1", supportedKimiVersion)
	}
	for key, digest := range receipt.Files {
		if key == kimiProviderReceipt || key == "." || path.IsAbs(key) || filepath.IsAbs(key) || strings.ContainsAny(key, "\\:\x00") || path.Clean(key) != key || key == ".." || strings.HasPrefix(key, "../") {
			return fmt.Errorf("unsafe Kimi private receipt path %q", key)
		}
		if strings.HasPrefix(digest, "link:") {
			continue
		}
		decoded, err := hex.DecodeString(digest)
		if err != nil || len(decoded) != sha256.Size {
			return fmt.Errorf("invalid Kimi private receipt hash for %q", key)
		}
	}
	seen := 0
	err = filepath.WalkDir(prefix, func(file string, item fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if item.IsDir() {
			if item.Type()&(os.ModeSymlink|os.ModeIrregular) != 0 {
				return fmt.Errorf("Kimi private tree contains a linked or special directory")
			}
			return nil
		}
		rel, err := filepath.Rel(prefix, file)
		if err != nil {
			return err
		}
		key := filepath.ToSlash(rel)
		if key == kimiProviderReceipt {
			return nil
		}
		expected, ok := receipt.Files[key]
		if !ok {
			return fmt.Errorf("Kimi private tree contains an unrecorded file %q", key)
		}
		seen++
		if item.Type()&os.ModeSymlink != 0 {
			target, err := os.Readlink(file)
			if err != nil {
				return err
			}
			if expected != "link:"+target {
				return fmt.Errorf("Kimi private link differs from receipt: %q", key)
			}
			absoluteTarget := target
			if !filepath.IsAbs(target) {
				absoluteTarget = filepath.Join(filepath.Dir(file), target)
			}
			contained, err := filepath.Rel(prefix, absoluteTarget)
			if err != nil || contained == ".." || strings.HasPrefix(contained, ".."+string(os.PathSeparator)) || filepath.IsAbs(contained) {
				return fmt.Errorf("Kimi private link escapes prefix: %q", key)
			}
			return nil
		}
		if err := requireProviderNpmPath(prefix, file); err != nil {
			return err
		}
		stream, err := os.Open(file)
		if err != nil {
			return err
		}
		hash := sha256.New()
		_, copyErr := io.Copy(hash, stream)
		closeErr := stream.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), expected) {
			return fmt.Errorf("Kimi private file differs from receipt: %q", key)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if seen != len(receipt.Files) {
		return fmt.Errorf("Kimi private receipt contains missing files")
	}
	for _, required := range []string{"kimi", "node_modules/@moonshot-ai/kimi-code/package.json", "node_modules/@moonshot-ai/kimi-code/dist/main.mjs"} {
		if _, ok := receipt.Files[required]; !ok {
			return fmt.Errorf("Kimi private receipt missing required entry %q", required)
		}
	}
	return nil
}
