// Windows-only, owned session entry. No shell, settings, auth, PATH or permission edits.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"unsafe"
)

type pin struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}
type contract struct {
	SchemaVersion  int      `json:"schemaVersion"`
	Command        []string `json:"command"`
	CommandFiles   []pin    `json:"commandFiles"`
	Shell          bool     `json:"shell"`
	PluginArgument string   `json:"pluginArgument"`
}
type receipt struct {
	SchemaVersion int               `json:"schemaVersion"`
	Owner         string            `json:"owner"`
	Target        string            `json:"target"`
	Files         map[string]string `json:"files"`
	Launcher      contract          `json:"launcher"`
}

var getFinalPath = syscall.NewLazyDLL("kernel32.dll").NewProc("GetFinalPathNameByHandleW")

const fileReadAttributes = 0x80

func physicalPath(path string) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	name, err := syscall.UTF16PtrFromString(abs)
	if err != nil {
		return err
	}
	// Query the exact permitted path by handle; avoid enumerating unrelated parents.
	handle, err := syscall.CreateFile(name, fileReadAttributes, syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE|syscall.FILE_SHARE_DELETE, nil, syscall.OPEN_EXISTING, syscall.FILE_FLAG_BACKUP_SEMANTICS|syscall.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return err
	}
	defer syscall.CloseHandle(handle)
	var details syscall.ByHandleFileInformation
	if err := syscall.GetFileInformationByHandle(handle, &details); err != nil {
		return err
	}
	if details.FileAttributes&syscall.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return fmt.Errorf("reparse path rejected")
	}
	buffer := make([]uint16, 32768)
	length, _, last := getFinalPath.Call(uintptr(handle), uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)), 0)
	if length == 0 {
		return last
	}
	if length >= uintptr(len(buffer)) {
		return fmt.Errorf("physical path exceeds supported size")
	}
	actual := syscall.UTF16ToString(buffer[:length])
	if strings.HasPrefix(actual, `\\?\UNC\`) {
		actual = `\\` + strings.TrimPrefix(actual, `\\?\UNC\`)
	} else {
		actual = strings.TrimPrefix(actual, `\\?\`)
	}
	if !strings.EqualFold(filepath.Clean(abs), filepath.Clean(actual)) {
		return fmt.Errorf("physical path differs from the owned path")
	}
	return nil
}

func ordinary(path string) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	if err := physicalPath(abs); err != nil {
		return err
	}
	info, err := os.Lstat(abs)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("ordinary file required")
	}
	name, err := syscall.UTF16PtrFromString(abs)
	if err != nil {
		return err
	}
	handle, err := syscall.CreateFile(name, syscall.GENERIC_READ, syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE|syscall.FILE_SHARE_DELETE, nil, syscall.OPEN_EXISTING, 0, 0)
	if err != nil {
		return err
	}
	defer syscall.CloseHandle(handle)
	var details syscall.ByHandleFileInformation
	if err := syscall.GetFileInformationByHandle(handle, &details); err != nil {
		return err
	}
	if details.NumberOfLinks != 1 || details.FileAttributes&syscall.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return fmt.Errorf("hard link/reparse file rejected")
	}
	return nil
}

func digest(path string) (string, error) {
	if err := ordinary(path); err != nil {
		return "", err
	}
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func run() error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	root := filepath.Dir(executable)
	if err := physicalPath(root); err != nil {
		return fmt.Errorf("cannot verify physical plugin root: %w", err)
	}
	// All sessions may hold shared read handles; lifecycle requires exclusive write.
	lockPath := filepath.Join(filepath.Dir(root), ".ccg-gptpro-bridge-runtime.lock")
	if err := ordinary(lockPath); err != nil {
		return fmt.Errorf("owned runtime lock required: %w", err)
	}
	lockInfo, err := os.Stat(lockPath)
	if err != nil || lockInfo.Size() != 0 {
		return fmt.Errorf("invalid owned runtime lock")
	}
	lockName, err := syscall.UTF16PtrFromString(lockPath)
	if err != nil {
		return err
	}
	lockHandle, err := syscall.CreateFile(lockName, syscall.GENERIC_READ, syscall.FILE_SHARE_READ, nil, syscall.OPEN_EXISTING, 0, 0)
	if err != nil {
		return fmt.Errorf("lifecycle operation holds this install: %w", err)
	}
	defer syscall.CloseHandle(lockHandle)
	ownership := filepath.Join(root, ".bridge-ownership.json")
	if err := ordinary(ownership); err != nil {
		return err
	}
	file, err := os.Open(ownership)
	if err != nil {
		return err
	}
	var owned receipt
	err = json.NewDecoder(io.LimitReader(file, 2*1024*1024)).Decode(&owned)
	file.Close()
	if err != nil {
		return err
	}
	if owned.SchemaVersion != 2 || owned.Owner != "ccg-gptpro-bridge" || owned.Target != root || owned.Launcher.SchemaVersion != 1 || owned.Launcher.Shell || owned.Launcher.PluginArgument != "--plugin-dir" {
		return fmt.Errorf("matching owned launcher receipt required")
	}
	actual := map[string]string{}
	err = filepath.WalkDir(root, func(path string, info os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := physicalPath(path); err != nil {
			return fmt.Errorf("plugin physical path verification failed: %w", err)
		}
		if info.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if rel == ".bridge-ownership.json" {
			return nil
		}
		hash, err := digest(path)
		if err != nil {
			return err
		}
		actual[rel] = hash
		return nil
	})
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(actual, owned.Files) {
		return fmt.Errorf("owned plugin drift detected; user edits preserved")
	}
	command := owned.Launcher.Command
	if len(command) < 1 || len(command) > 2 || len(command) != len(owned.Launcher.CommandFiles) {
		return fmt.Errorf("invalid owned command provenance")
	}
	for index, pinned := range owned.Launcher.CommandFiles {
		if command[index] != pinned.Path || !filepath.IsAbs(pinned.Path) {
			return fmt.Errorf("command differs from its provenance")
		}
		hash, err := digest(pinned.Path)
		if err != nil {
			return err
		}
		if hash != pinned.SHA256 {
			return fmt.Errorf("Claude executable changed; review and reinstall to update provenance")
		}
	}
	args := append(append([]string{}, command[1:]...), "--plugin-dir", root)
	args = append(args, os.Args[1:]...)
	child := exec.Command(command[0], args...)
	child.Stdin, child.Stdout, child.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := child.Run(); err != nil {
		if status, ok := err.(*exec.ExitError); ok {
			os.Exit(status.ExitCode())
		}
		return err
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "CCG GPTPro Claude launcher:", err)
		os.Exit(1)
	}
}
