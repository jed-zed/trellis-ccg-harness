package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Backend defines the contract for invoking different AI CLI backends.
// Each backend is responsible for supplying the executable command and
// building the argument list based on the wrapper config.
type Backend interface {
	Name() string
	BuildArgs(cfg *Config, targetArg string) []string
	Command() string
}

type CodexBackend struct{}

func (CodexBackend) Name() string { return "codex" }
func (CodexBackend) Command() string {
	return "codex"
}
func (CodexBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildCodexArgs(cfg, targetArg)
}

type ClaudeBackend struct{}

func (ClaudeBackend) Name() string { return "claude" }
func (ClaudeBackend) Command() string {
	if executable := strings.TrimSpace(os.Getenv("CCG_CLAUDE_EXECUTABLE")); executable != "" {
		return executable
	}
	return "claude"
}
func (ClaudeBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildClaudeArgs(cfg, targetArg)
}

const (
	maxClaudeSettingsBytes = 1 << 20 // 1MB
	defaultClaudeModel     = "claude-opus-4-8"
)

// loadMinimalEnvSettings 从 ~/.claude/settings.json 只提取 env 配置。
// 只接受字符串类型的值；文件缺失/解析失败/超限都返回空。
func loadMinimalEnvSettings() map[string]string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return nil
	}

	settingPath := filepath.Join(home, ".claude", "settings.json")
	info, err := os.Stat(settingPath)
	if err != nil || info.Size() > maxClaudeSettingsBytes {
		return nil
	}

	data, err := os.ReadFile(settingPath)
	if err != nil {
		return nil
	}

	var cfg struct {
		Env map[string]any `json:"env"`
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil
	}
	if len(cfg.Env) == 0 {
		return nil
	}

	env := make(map[string]string, len(cfg.Env))
	for k, v := range cfg.Env {
		s, ok := v.(string)
		if !ok {
			continue
		}
		env[k] = s
	}
	if len(env) == 0 {
		return nil
	}
	return env
}

func buildBackendEnv(commandName string) map[string]string {
	env := loadMinimalEnvSettings()
	if env == nil {
		env = make(map[string]string)
	}

	if commandName == "claude" {
		if _, ok := env["ANTHROPIC_MODEL"]; !ok {
			if val, exists := os.LookupEnv("ANTHROPIC_MODEL"); !exists || strings.TrimSpace(val) == "" {
				env["ANTHROPIC_MODEL"] = defaultClaudeModel
			}
		}
	}

	return env
}

func buildClaudeArgs(cfg *Config, targetArg string) []string {
	if cfg == nil {
		return nil
	}
	args := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", ""}

	if cfg.Mode == "resume" {
		if cfg.SessionID != "" {
			// Claude CLI uses -r <session_id> for resume.
			args = append(args, "-r", cfg.SessionID)
		}
	}
	// Note: claude CLI doesn't support -C flag; workdir set via cmd.Dir

	args = append(args, "--output-format", "stream-json", "--verbose", "--include-partial-messages")
	if targetArg != "" {
		args = append(args, targetArg)
	}

	return args
}

type AntigravityBackend struct{}

func (AntigravityBackend) Name() string    { return "antigravity" }
func (AntigravityBackend) Command() string { return "agy" }
func (AntigravityBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildAntigravityArgs(cfg, targetArg)
}

func buildAntigravityArgs(cfg *Config, targetArg string) []string {
	if cfg == nil {
		return nil
	}

	var args []string

	if cfg.SkipPermissions {
		args = append(args, "--dangerously-skip-permissions")
	}
	args = append(args, "--output-format", "stream-json")
	if model := strings.TrimSpace(os.Getenv("ANTIGRAVITY_MODEL")); model != "" {
		args = append(args, "--model", model)
	}

	if cfg.Mode == "resume" && cfg.SessionID != "" {
		args = append(args, "--conversation", cfg.SessionID)
	}

	if cfg.Mode != "resume" && cfg.WorkDir != "" && cfg.WorkDir != "." {
		args = append(args, "--add-dir", cfg.WorkDir)
	}

	// -p must come right before the prompt text (last positional arg)
	args = append(args, "-p", targetArg)
	return args
}

type GrokBackend struct{}

func (GrokBackend) Name() string { return "grok" }

// Command resolves the grok binary. The official installer places it at
// ~/.grok/bin/grok (a symlink into ~/.grok/downloads/) and adds that dir to
// PATH via shell rc — which may not be sourced in non-interactive shells,
// so fall back to the well-known install location before giving up.
func (GrokBackend) Command() string {
	if _, err := exec.LookPath("grok"); err == nil {
		return "grok"
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return "grok"
	}
	fallback := filepath.Join(home, ".grok", "bin", "grok")
	if isWindows() {
		fallback += ".exe"
	}
	if _, err := os.Stat(fallback); err == nil {
		return fallback
	}
	return "grok"
}

func (GrokBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildGrokArgs(cfg, targetArg)
}

func buildGrokArgs(cfg *Config, targetArg string) []string {
	if cfg == nil {
		return nil
	}

	args := []string{"--always-approve", "--output-format", "streaming-json"}
	if len(cfg.GrokReviewTargets) > 0 {
		args = append(args,
			"--system-prompt-override", grokReviewSystemPrompt,
			"--verbatim",
		)
	}

	if model := strings.TrimSpace(cfg.GrokModel); model != "" {
		args = append(args, "-m", model)
	}

	if cfg.Mode == "resume" && cfg.SessionID != "" && len(cfg.GrokReviewTargets) == 0 {
		args = append(args, "-r", cfg.SessionID)
	}

	if len(cfg.GrokReviewTargets) > 0 {
		args = append(args, "--prompt-file", targetArg)
	} else {
		// Grok is a native binary, so multi-line prompt args survive on every platform.
		args = append(args, "-p", targetArg)
	}
	return args
}

type PiBackend struct{}

func (PiBackend) Name() string    { return "pi" }
func (PiBackend) Command() string { return "pi" }
func (PiBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildPiArgs(cfg, targetArg)
}

func buildPiArgs(cfg *Config, _ string) []string {
	if cfg == nil {
		return nil
	}

	args := []string{
		"--mode", "json",
		"--approve",
	}
	if cfg.Mode == "resume" && cfg.SessionID != "" {
		args = append(args, "--session", cfg.SessionID)
	}
	return args
}

type GeminiBackend struct{}

func (GeminiBackend) Name() string { return "gemini" }
func (GeminiBackend) Command() string {
	return "gemini"
}
func (GeminiBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildGeminiArgs(cfg, targetArg)
}

func buildGeminiArgs(cfg *Config, targetArg string) []string {
	if cfg == nil {
		return nil
	}

	args := []string{}

	// Add model parameter first (if specified)
	if model := strings.TrimSpace(cfg.GeminiModel); model != "" {
		args = append(args, "-m", model)
	}

	// Existing args
	args = append(args, "-o", "stream-json", "-y")

	if cfg.Mode == "resume" {
		if cfg.SessionID != "" {
			args = append(args, "-r", cfg.SessionID)
		}
	}

	// Gemini CLI loads .env from CWD and walks up to .git root / $HOME.
	// To avoid project-level .env overriding global API keys, we set cmd.Dir=$HOME
	// in executor.go and pass the project directory via --include-directories instead.
	// See: https://github.com/google-gemini/gemini-cli/issues/2493
	if cfg.Mode != "resume" && cfg.WorkDir != "" {
		args = append(args, "--include-directories", cfg.WorkDir)
	}

	// On Windows with stdin pipe mode, targetArg is "" — omit -p so Gemini reads from stdin.
	// On macOS/Linux, targetArg contains the actual prompt text for the -p flag.
	if targetArg != "" {
		args = append(args, "-p", targetArg)
	}

	return args
}
