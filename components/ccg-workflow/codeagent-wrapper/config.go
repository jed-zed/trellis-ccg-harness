package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Config holds CLI configuration
type Config struct {
	Mode               string // "new" or "resume"
	Task               string
	SessionID          string
	WorkDir            string
	ExplicitStdin      bool
	Timeout            int
	Backend            string
	SkipPermissions    bool
	MaxParallelWorkers int
	GeminiModel        string // Gemini model name (empty = use default)
	GrokModel          string // Grok model name (empty = use default)
	GrokReviewTargets  []string
	Progress           bool // Emit compact progress lines to stderr
}

// ParallelConfig defines the JSON schema for parallel execution
type ParallelConfig struct {
	Tasks         []TaskSpec `json:"tasks"`
	GlobalBackend string     `json:"backend,omitempty"`
}

// TaskSpec describes an individual task entry in the parallel config
type TaskSpec struct {
	ID                string          `json:"id"`
	Task              string          `json:"task"`
	WorkDir           string          `json:"workdir,omitempty"`
	Dependencies      []string        `json:"dependencies,omitempty"`
	SessionID         string          `json:"session_id,omitempty"`
	Backend           string          `json:"backend,omitempty"`
	Progress          bool            `json:"-"`
	Mode              string          `json:"-"`
	UseStdin          bool            `json:"-"`
	GeminiModel       string          `json:"-"`
	GrokModel         string          `json:"-"`
	GrokReviewTargets []string        `json:"-"`
	Context           context.Context `json:"-"`
}

// TaskResult captures the execution outcome of a task
type TaskResult struct {
	TaskID    string `json:"task_id"`
	ExitCode  int    `json:"exit_code"`
	Message   string `json:"message"`
	SessionID string `json:"session_id"`
	Error     string `json:"error"`
	LogPath   string `json:"log_path"`
	// Structured report fields
	Coverage       string   `json:"coverage,omitempty"`        // extracted coverage percentage (e.g., "92%")
	CoverageNum    float64  `json:"coverage_num,omitempty"`    // numeric coverage for comparison
	CoverageTarget float64  `json:"coverage_target,omitempty"` // target coverage (default 90)
	FilesChanged   []string `json:"files_changed,omitempty"`   // list of changed files
	KeyOutput      string   `json:"key_output,omitempty"`      // brief summary of what was done
	TestsPassed    int      `json:"tests_passed,omitempty"`    // number of tests passed
	TestsFailed    int      `json:"tests_failed,omitempty"`    // number of tests failed
	sharedLog      bool
}

var backendRegistry = map[string]Backend{
	"codex":       CodexBackend{},
	"claude":      ClaudeBackend{},
	"gemini":      GeminiBackend{},
	"antigravity": AntigravityBackend{},
	"agy":         AntigravityBackend{},
	"grok":        GrokBackend{},
	"pi":          PiBackend{},
}

func selectBackend(name string) (Backend, error) {
	key := strings.ToLower(strings.TrimSpace(name))
	if key == "" {
		key = defaultBackendName
	}
	if backend, ok := backendRegistry[key]; ok {
		return backend, nil
	}
	return nil, fmt.Errorf("unsupported backend %q", name)
}

func envFlagEnabled(key string) bool {
	val, ok := os.LookupEnv(key)
	if !ok {
		return false
	}
	val = strings.TrimSpace(strings.ToLower(val))
	switch val {
	case "", "0", "false", "no", "off":
		return false
	default:
		return true
	}
}

func parseBoolFlag(val string, defaultValue bool) bool {
	val = strings.TrimSpace(strings.ToLower(val))
	switch val {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return defaultValue
	}
}

func parseParallelConfig(data []byte) (*ParallelConfig, error) {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return nil, fmt.Errorf("parallel config is empty")
	}

	tasks := strings.Split(string(trimmed), "---TASK---")
	var cfg ParallelConfig
	seen := make(map[string]struct{})

	taskIndex := 0
	for _, taskBlock := range tasks {
		taskBlock = strings.TrimSpace(taskBlock)
		if taskBlock == "" {
			continue
		}
		taskIndex++

		parts := strings.SplitN(taskBlock, "---CONTENT---", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("task block #%d missing ---CONTENT--- separator", taskIndex)
		}

		meta := strings.TrimSpace(parts[0])
		content := strings.TrimSpace(parts[1])

		task := TaskSpec{WorkDir: defaultWorkdir}
		for _, line := range strings.Split(meta, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			kv := strings.SplitN(line, ":", 2)
			if len(kv) != 2 {
				continue
			}
			key := strings.TrimSpace(kv[0])
			value := strings.TrimSpace(kv[1])

			switch key {
			case "id":
				task.ID = value
			case "workdir":
				task.WorkDir = value
			case "session_id":
				task.SessionID = value
				task.Mode = "resume"
			case "backend":
				task.Backend = value
			case "dependencies":
				for _, dep := range strings.Split(value, ",") {
					dep = strings.TrimSpace(dep)
					if dep != "" {
						task.Dependencies = append(task.Dependencies, dep)
					}
				}
			}
		}

		if task.Mode == "" {
			task.Mode = "new"
		}

		if task.ID == "" {
			return nil, fmt.Errorf("task block #%d missing id field", taskIndex)
		}
		if content == "" {
			return nil, fmt.Errorf("task block #%d (%q) missing content", taskIndex, task.ID)
		}
		if task.Mode == "resume" && strings.TrimSpace(task.SessionID) == "" {
			return nil, fmt.Errorf("task block #%d (%q) has empty session_id", taskIndex, task.ID)
		}
		if _, exists := seen[task.ID]; exists {
			return nil, fmt.Errorf("task block #%d has duplicate id: %s", taskIndex, task.ID)
		}

		task.Task = content
		cfg.Tasks = append(cfg.Tasks, task)
		seen[task.ID] = struct{}{}
	}

	if len(cfg.Tasks) == 0 {
		return nil, fmt.Errorf("no tasks found")
	}

	return &cfg, nil
}

func parseArgs() (*Config, error) {
	args := os.Args[1:]
	if len(args) == 0 {
		return nil, fmt.Errorf("task required")
	}

	// Read environment variables (lowest precedence)
	geminiModel := strings.TrimSpace(os.Getenv("GEMINI_MODEL"))
	grokModel := strings.TrimSpace(os.Getenv("GROK_MODEL"))
	var grokReviewTargets []string

	backendName := defaultBackendName
	skipPermissions := envFlagEnabled("CODEAGENT_SKIP_PERMISSIONS")
	progress := false
	filtered := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--lite", arg == "-L":
			liteMode = true
			continue
		case arg == "--backend":
			if i+1 >= len(args) {
				return nil, fmt.Errorf("--backend flag requires a value")
			}
			backendName = args[i+1]
			i++
			continue
		case strings.HasPrefix(arg, "--backend="):
			value := strings.TrimPrefix(arg, "--backend=")
			if value == "" {
				return nil, fmt.Errorf("--backend flag requires a value")
			}
			backendName = value
			continue
		case arg == "--gemini-model":
			if i+1 >= len(args) {
				return nil, fmt.Errorf("--gemini-model flag requires a non-empty model name")
			}
			value := strings.TrimSpace(args[i+1])
			if value == "" {
				return nil, fmt.Errorf("--gemini-model flag requires a non-empty model name")
			}
			geminiModel = value
			i++
			continue
		case strings.HasPrefix(arg, "--gemini-model="):
			value := strings.TrimSpace(strings.TrimPrefix(arg, "--gemini-model="))
			if value == "" {
				return nil, fmt.Errorf("--gemini-model flag requires a non-empty model name")
			}
			geminiModel = value
			continue
		case arg == "--grok-model":
			if i+1 >= len(args) {
				return nil, fmt.Errorf("--grok-model flag requires a non-empty model name")
			}
			value := strings.TrimSpace(args[i+1])
			if value == "" {
				return nil, fmt.Errorf("--grok-model flag requires a non-empty model name")
			}
			grokModel = value
			i++
			continue
		case strings.HasPrefix(arg, "--grok-model="):
			value := strings.TrimSpace(strings.TrimPrefix(arg, "--grok-model="))
			if value == "" {
				return nil, fmt.Errorf("--grok-model flag requires a non-empty model name")
			}
			grokModel = value
			continue
		case arg == "--grok-review-target":
			if i+1 >= len(args) || strings.TrimSpace(args[i+1]) == "" || strings.HasPrefix(args[i+1], "--") {
				return nil, fmt.Errorf("--grok-review-target flag requires a workspace-relative file")
			}
			grokReviewTargets = append(grokReviewTargets, strings.TrimSpace(args[i+1]))
			i++
			continue
		case strings.HasPrefix(arg, "--grok-review-target="):
			value := strings.TrimSpace(strings.TrimPrefix(arg, "--grok-review-target="))
			if value == "" {
				return nil, fmt.Errorf("--grok-review-target flag requires a workspace-relative file")
			}
			grokReviewTargets = append(grokReviewTargets, value)
			continue
		case arg == "--skip-permissions", arg == "--dangerously-skip-permissions":
			skipPermissions = true
			continue
		case arg == "--progress":
			progress = true
			continue
		case strings.HasPrefix(arg, "--skip-permissions="):
			skipPermissions = parseBoolFlag(strings.TrimPrefix(arg, "--skip-permissions="), skipPermissions)
			continue
		case strings.HasPrefix(arg, "--dangerously-skip-permissions="):
			skipPermissions = parseBoolFlag(strings.TrimPrefix(arg, "--dangerously-skip-permissions="), skipPermissions)
			continue
		}
		filtered = append(filtered, arg)
	}

	if len(filtered) == 0 {
		return nil, fmt.Errorf("task required")
	}
	args = filtered

	cfg := &Config{WorkDir: defaultWorkdir, Backend: backendName, SkipPermissions: skipPermissions, GeminiModel: geminiModel, GrokModel: grokModel, GrokReviewTargets: grokReviewTargets, Progress: progress}
	cfg.MaxParallelWorkers = resolveMaxParallelWorkers()

	if args[0] == "resume" {
		if len(args) < 3 {
			return nil, fmt.Errorf("resume mode requires: resume <session_id> <task>")
		}
		cfg.Mode = "resume"
		cfg.SessionID = strings.TrimSpace(args[1])
		if cfg.SessionID == "" {
			return nil, fmt.Errorf("resume mode requires non-empty session_id")
		}
		cfg.Task = args[2]
		cfg.ExplicitStdin = (args[2] == "-")
		if len(args) > 3 {
			cfg.WorkDir = args[3]
		}
	} else {
		cfg.Mode = "new"
		cfg.Task = args[0]
		cfg.ExplicitStdin = (args[0] == "-")
		if len(args) > 1 {
			cfg.WorkDir = args[1]
		}
	}

	return cfg, nil
}

func normalizeGrokReviewTargets(workDir string, targets []string) ([]string, error) {
	if len(targets) == 0 {
		return nil, nil
	}

	root, err := resolveGrokReviewRoot(workDir)
	if err != nil {
		return nil, err
	}

	normalized := make([]string, 0, len(targets))
	seen := make(map[string]struct{}, len(targets))
	for _, raw := range targets {
		rel, _, _, err := resolveGrokReviewTarget(root, raw)
		if err != nil {
			return nil, err
		}
		key := rel
		if isWindows() {
			key = strings.ToLower(key)
		}
		if _, exists := seen[key]; exists {
			return nil, fmt.Errorf("duplicate Grok review target: %q", raw)
		}
		seen[key] = struct{}{}
		normalized = append(normalized, rel)
	}
	return normalized, nil
}

func resolveGrokReviewRoot(workDir string) (string, error) {
	root, err := filepath.Abs(workDir)
	if err != nil {
		return "", fmt.Errorf("resolve Grok review workdir: %w", err)
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("resolve Grok review workdir: %w", err)
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("Grok review workdir is not a directory: %s", workDir)
	}
	return root, nil
}

func resolveGrokReviewTarget(root, raw string) (string, string, os.FileInfo, error) {
	target := strings.TrimSpace(raw)
	if target == "" || filepath.IsAbs(target) || filepath.VolumeName(target) != "" {
		return "", "", nil, fmt.Errorf("Grok review target must be workspace-relative: %q", raw)
	}
	target = filepath.Clean(filepath.FromSlash(target))
	if target == "." || target == ".." || strings.HasPrefix(target, ".."+string(filepath.Separator)) {
		return "", "", nil, fmt.Errorf("Grok review target escapes workdir: %q", raw)
	}

	full := filepath.Join(root, target)
	entry, err := os.Lstat(full)
	if err != nil {
		return "", "", nil, fmt.Errorf("Grok review target is unavailable: %q", raw)
	}
	if entry.Mode()&os.ModeSymlink != 0 || !entry.Mode().IsRegular() {
		return "", "", nil, fmt.Errorf("Grok review target must be a regular non-link file: %q", raw)
	}
	resolved, err := filepath.EvalSymlinks(full)
	if err != nil || !sameGrokReviewPath(full, resolved) {
		return "", "", nil, fmt.Errorf("Grok review target contains a link or reparse point: %q", raw)
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil || rel == ".." || filepath.IsAbs(rel) || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", "", nil, fmt.Errorf("Grok review target escapes workdir: %q", raw)
	}
	return filepath.ToSlash(filepath.Clean(rel)), resolved, entry, nil
}

func sameGrokReviewPath(a, b string) bool {
	a = filepath.Clean(a)
	b = filepath.Clean(b)
	if isWindows() {
		return strings.EqualFold(a, b)
	}
	return a == b
}

const maxParallelWorkersLimit = 100

func resolveMaxParallelWorkers() int {
	raw := strings.TrimSpace(os.Getenv("CODEAGENT_MAX_PARALLEL_WORKERS"))
	if raw == "" {
		return 0
	}

	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		logWarn(fmt.Sprintf("Invalid CODEAGENT_MAX_PARALLEL_WORKERS=%q, falling back to unlimited", raw))
		return 0
	}

	if value > maxParallelWorkersLimit {
		logWarn(fmt.Sprintf("CODEAGENT_MAX_PARALLEL_WORKERS=%d exceeds limit, capping at %d", value, maxParallelWorkersLimit))
		return maxParallelWorkersLimit
	}

	return value
}
