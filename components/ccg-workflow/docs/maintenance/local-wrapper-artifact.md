# Fixed local wrapper input (unpublished research build)

This separate research build adds `ccg codex-mode install --wrapper-file <absolute-file>` for a fixed local distribution whose wrapper release has not been published. It does not modify the installed daily CLI.

The input must match the compiled SHA-256 for the running platform and x64/arm64 architecture. The CLI offers no caller-selected hash or URL. It rejects relative paths, Windows root-relative/network/device/alternate-stream paths, NUL, nonregular/empty/oversized files, symlinks and directory junctions. Checks do not constitute a filesystem sandbox or proof about every NTFS reparse tag.

The source is read into a verified buffer. Only after the fixed digest matches, a private snapshot becomes executable and runs a bounded native `--version` check. The same buffer enters the existing ownership, backup and rollback transaction. An explicitly invalid local input fails before creating the managed Codex home and does not fall through to download or an existing wrapper. Without the flag, the previous pinned-download behavior remains.

Raw `wrapperBytes` remains available only in NODE_ENV=test; setting VITEST=true in production does not enable it. Raw bytes and the production file input cannot be combined. `recover` and `uninstall` reject the install-only flag.

Actual isolated Windows production evidence covers install, eight managed-file digests, managed doctor checks and uninstall with the fixed native artifact. A provider-empty HOME correctly fails full readiness for three unavailable selected runtimes; those diagnostics were retained. The Linux build still requires its own real runtime installation test.
