//go:build windows

package main

import (
	"fmt"
	"path/filepath"
	"syscall"
	"unsafe"
)

func defaultCodexMCPSystemConfigPath() (string, error) {
	// Match Codex 0.156.1: ProgramData is a Windows known folder, not an
	// environment variable. Do not let a child enumerate an alternate layer.
	folderID := syscall.GUID{Data1: 0x62ab5d82, Data2: 0xfdc1, Data3: 0x4dc3, Data4: [8]byte{0xa9, 0xdd, 0x07, 0x0d, 0x1d, 0x49, 0x5d, 0x97}}
	var path *uint16
	result, _, _ := syscall.NewLazyDLL("shell32.dll").NewProc("SHGetKnownFolderPath").Call(uintptr(unsafe.Pointer(&folderID)), 0, 0, uintptr(unsafe.Pointer(&path)))
	if result != 0 || path == nil {
		return "", fmt.Errorf("cannot resolve ProgramData known folder")
	}
	defer syscall.NewLazyDLL("ole32.dll").NewProc("CoTaskMemFree").Call(uintptr(unsafe.Pointer(path)))
	length := 0
	for length < 32768 {
		if *(*uint16)(unsafe.Add(unsafe.Pointer(path), length*2)) == 0 {
			break
		}
		length++
	}
	if length == 32768 {
		return "", fmt.Errorf("invalid ProgramData known folder path")
	}
	programData := syscall.UTF16ToString(unsafe.Slice(path, length))
	if !filepath.IsAbs(programData) {
		return "", fmt.Errorf("ProgramData known folder is not absolute")
	}
	return filepath.Join(programData, "OpenAI", "Codex", "config.toml"), nil
}
