# Unix wrapper cancellation

Real Unix child commands start in their own process group. Cancellation first
sends TERM to that owned group so a nested wrapper can forward cancellation
and finish its normal cleanup. After the bounded grace period, remaining owned
processes receive KILL. A wrapper does not signal its parent's process group or
an unrelated sibling command.

On Linux, the wrapper captures a kernel PID handle for the child at Start and
records verified descendant identities while the child is running. These
handles let cancellation reach nested wrappers and their children even when
those wrappers created separate process groups. An exited outer leader does
not make a surviving, captured child disappear from cleanup. Identity checks,
closed-state markers and joining the force-cleanup callback prevent later
cancellation from targeting a reused PID.

Linux kernels without the required PID-handle support, or environments without
the required proc information, report a diagnostic and retain group cleanup.
That fallback cannot promise cleanup of a separately grouped descendant.
Darwin also provides group isolation and normal TERM propagation; its fallback
does not provide the Linux PID-handle guarantee. A deliberately detached process
outside the captured ancestry is outside this lifecycle contract. This feature
is cancellation handling rather than a filesystem or permission sandbox.

Windows retains the existing `taskkill /T /F` cleanup. The new Unix helpers are
no-ops there. No WSL or Docker startup is needed for Windows use.

The source includes real-process Linux regression fixtures for cancellation,
nested groups, an exited leader, ignored TERM, timeout, sibling survival,
pre-cancellation, completed-task priority and stale process identity. Run in a
real Linux checkout with the vendored handoff:

```sh
go test -mod=vendor -count=1 -run '^TestUnixLifecycle_' -v .
```

The Windows task has passed native Windows regressions and Unix
cross-compilation. A real Linux run remains pending and must be recorded before
claiming the Linux lifecycle acceptance requirement is met.
