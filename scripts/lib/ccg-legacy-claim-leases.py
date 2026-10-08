"""Windows-only held-file CAS and exclusive metadata publisher.

Invoked by the fixed-root retirement module over a bounded JSON-line protocol.
This does not authenticate a caller or sandbox other programs with equal access.
"""
import base64
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

MAX = 32 * 1024 * 1024


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def absolute(value):
    require(isinstance(value, str) and value and "\0" not in value,
            "Absolute plain path required")
    path = Path(value)
    require(path.is_absolute() and ".." not in path.parts,
            "Absolute traversal-free path required")
    return path


def plain(path, directory=False):
    info = path.lstat()
    require(not stat.S_ISLNK(info.st_mode) and not
            getattr(info, "st_file_attributes", 0) & 0x400,
            "Link/reparse path refused: " + str(path))
    require(stat.S_ISDIR(info.st_mode) if directory else
            stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
            "Plain directory or single-link file required: " + str(path))
    return info


def digest(data):
    return hashlib.sha256(data).hexdigest()


require(os.name == "nt", "Legacy retirement leases require native Windows")
kernel = ctypes.WinDLL("kernel32", use_last_error=True)
kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                              ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD,
                              wintypes.HANDLE]
kernel.CreateFileW.restype = wintypes.HANDLE
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
kernel.ReadFile.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
                           ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
kernel.WriteFile.argtypes = kernel.ReadFile.argtypes
kernel.SetFilePointerEx.argtypes = [wintypes.HANDLE, ctypes.c_longlong,
                                  ctypes.POINTER(ctypes.c_longlong), wintypes.DWORD]
kernel.SetEndOfFile.argtypes = [wintypes.HANDLE]
kernel.FlushFileBuffers.argtypes = [wintypes.HANDLE]


class Lease:
    def __init__(self, path, directory=False, create=False):
        self.path = absolute(str(path))
        before = None if create else plain(path, directory)
        access = 0 if directory else 0x80000000 | (0x40000000 if create else 0)
        sharing = 3 if directory else 1  # directories deny DELETE; files deny WRITE/DELETE
        flags = 0x00200000 | (0x02000000 if directory else 0)
        self.handle = kernel.CreateFileW(str(path), access, sharing, None,
                                         1 if create else 3, flags, None)
        if self.handle == ctypes.c_void_p(-1).value:
            self.handle = None
            error = ctypes.WinError(ctypes.get_last_error())
            error.filename = str(path)
            raise error
        try:
            after = plain(path, directory)
            require(before is None or (before.st_dev, before.st_ino) ==
                    (after.st_dev, after.st_ino), "Path changed during lease acquisition")
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.handle is not None:
            kernel.CloseHandle(self.handle)
            self.handle = None

    def data(self):
        require(kernel.SetFilePointerEx(self.handle, 0, None, 0), "Cannot rewind held file")
        chunks = []
        size = 0
        while True:
            buffer = ctypes.create_string_buffer(1024 * 1024)
            count = wintypes.DWORD()
            if not kernel.ReadFile(self.handle, buffer, len(buffer), ctypes.byref(count), None):
                raise ctypes.WinError(ctypes.get_last_error())
            if not count.value:
                return b"".join(chunks)
            size += count.value
            require(size <= MAX, "Held file exceeds bounded size")
            chunks.append(buffer.raw[:count.value])

    def put(self, data):
        require(kernel.SetFilePointerEx(self.handle, 0, None, 0), "Cannot rewind publication")
        for offset in range(0, len(data), 1024 * 1024):
            chunk = data[offset:offset + 1024 * 1024]
            count = wintypes.DWORD()
            buffer = ctypes.create_string_buffer(chunk)
            if not kernel.WriteFile(self.handle, buffer, len(chunk), ctypes.byref(count), None):
                raise ctypes.WinError(ctypes.get_last_error())
            require(count.value == len(chunk), "Incomplete metadata publication retained")
        if not kernel.SetEndOfFile(self.handle) or not kernel.FlushFileBuffers(self.handle):
            raise ctypes.WinError(ctypes.get_last_error())
        require(self.data() == data, "Metadata post-publication mismatch retained")


class Session:
    def __init__(self, job):
        self.handles = {}
        self.directories = {}
        self.allowed = set()
        self.runtime = set()
        root = absolute(job["codeRoot"])
        pin = job["planSha256"]
        require(re.fullmatch("[a-f0-9]{64}", pin), "Invalid plan SHA256")
        txn = root / ".harness-cache" / "legacy-ccg-claims" / pin
        self.allowed.update(str(p).casefold() for p in [
            root / ".harness-cache" / "legacy-ccg-claim-authority.json",
            txn / "plan.json", txn / "journal.json", txn / "COMMITTED.json",
            txn / "STOCK-HANDOFF-PENDING.json", txn / "STOCK-HANDOFF.json"])
        require(len(job["owners"]) == 2, "Exactly two selected owners required")
        for owner in job["owners"]:
            self.allowed.add(str(absolute(owner) / ".harness-cache" /
                                 "legacy-ccg-claim-retirement.json").casefold())
        create = {str(p).casefold() for p in [root / ".harness-cache",
                   root / ".harness-cache" / "legacy-ccg-claims", txn]}
        parents = set()
        for value in [*job["directories"], *[str(absolute(x["path"]).parent)
                      for x in job["files"]], str(txn),
                      *[str(absolute(x).parent) for x in job["targets"]]]:
            item = absolute(value)
            parents.update([item, *item.parents])
        try:
            for item in sorted(parents, key=lambda p: (len(p.parts), str(p).casefold())):
                try:
                    plain(item, True)
                except FileNotFoundError:
                    require(str(item).casefold() in create,
                            "Unapproved directory creation refused: " + str(item))
                    item.mkdir()
                self.directories[str(item).casefold()] = Lease(item, directory=True)
            for row in sorted(job["files"], key=lambda r: r["path"].casefold()):
                target = absolute(row["path"])
                key = str(target).casefold()
                if key not in self.handles:
                    self.handles[key] = Lease(target)
                data = self.handles[key].data()
                require(digest(data) == row["sha256"] and len(data) == row["bytes"],
                        "Held input CAS mismatch: " + str(target))
                if row.get("runtime"):
                    self.runtime.add(key)
            for value in job["targets"]:
                target = absolute(value)
                key = str(target).casefold()
                require(key in self.allowed, "Publication target is outside fixed metadata set")
                if target.exists() or target.is_symlink():
                    if key not in self.handles:
                        self.handles[key] = Lease(target)
            for value in job["absent"]:
                target = absolute(value)
                require(not target.exists() and not target.is_symlink(),
                        "Pending foreign transaction appeared: " + str(target))
        except BaseException:
            self.close()
            raise

    def publish(self, request):
        target = absolute(request["path"])
        key = str(target).casefold()
        require(key in self.allowed and str(target.parent).casefold() in self.directories,
                "Publication target is outside held metadata parents")
        data = base64.b64decode(request["base64"], validate=True)
        require(len(data) <= MAX and digest(data) == request["sha256"],
                "Publication bytes differ from requested pin")
        if key in self.handles:
            require(self.handles[key].data() == data,
                    "Occupied/torn metadata retained; no replacement permitted")
            return {"created": False, "sha256": digest(data)}
        lease = Lease(target, create=True)
        self.handles[key] = lease  # keep an incomplete file held and preserved on failure
        lease.put(data)
        return {"created": True, "sha256": digest(data)}

    def release_runtime(self):
        for key in self.runtime:
            self.handles.pop(key).close()
        self.runtime.clear()

    def close(self):
        for lease in [*reversed(list(self.handles.values())),
                      *reversed(list(self.directories.values()))]:
            lease.close()
        self.handles.clear()
        self.directories.clear()


session = None
try:
    for line in sys.stdin.buffer:
        require(len(line) <= MAX, "Protocol request exceeds bounded size")
        try:
            request = json.loads(line)
            op = request["op"]
            if op == "init":
                require(session is None, "Lease session already initialized")
                session = Session(request)
                result = {"heldFiles": len(session.handles),
                          "heldDirectories": len(session.directories),
                          "capability": "windows-files-deny-write-delete-directories-deny-delete"}
            elif op == "publish":
                require(session is not None, "No initialized lease session")
                result = session.publish(request)
            elif op == "release-runtime":
                require(session is not None, "No initialized lease session")
                session.release_runtime()
                result = {"runtimeReadLeasesReleasedForStockCas": True}
            elif op == "close":
                if session:
                    session.close()
                result = {"closed": True}
            else:
                raise RuntimeError("Unknown protocol operation")
            print(json.dumps({"ok": True, "result": result}), flush=True)
            if op == "close":
                break
        except Exception as error:
            print(json.dumps({"ok": False, "error": str(error)}), flush=True)
finally:
    if session:
        session.close()
