//go:build !windows

package main

func defaultCodexMCPSystemConfigPath() (string, error) {
	return "/etc/codex/config.toml", nil
}
