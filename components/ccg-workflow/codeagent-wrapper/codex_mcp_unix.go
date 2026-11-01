//go:build !windows

package main

func codexMCPLongPath(path string) (string, error) {
	return path, nil
}

func defaultCodexMCPSystemConfigPath() (string, error) {
	return "/etc/codex/config.toml", nil
}
