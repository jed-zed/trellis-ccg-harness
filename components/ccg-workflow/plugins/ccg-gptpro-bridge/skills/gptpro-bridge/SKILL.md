---
name: gptpro-bridge
description: Optional, explicitly requested GPT Pro advisory evidence for the original Claude CCG workflow, using the exact-bound private bridge transport.
user-invocable: false
---

# Claude CCG GPT Pro bridge

Claude session: `${CLAUDE_SESSION_ID}`.
Plugin root: `${CLAUDE_PLUGIN_ROOT}`.
Read `${CLAUDE_PLUGIN_ROOT}/README.md` before using the bridge.

The original CCG route and the user's current model/permission settings remain in
charge. Carry out the ordinary route appropriate to the requested mode, preserve
real routed outputs and failures, then append GPT Pro only when requested. Do not
add a separate approval, routing, provider-evidence or memory gate. Do not invoke
personal Harness CLI, Trellis hooks, or the other CCG installation's commands.

1. Write a bounded synthetic/public task prompt and real ordinary-route summary.
   Include only authorized local content. GPT Pro cannot read an omitted local path.
2. Call the private adapter `status --claude-session-id "${CLAUDE_SESSION_ID}"`.
   Preserve the exact ready browser/profile/tab/session binding. Missing approved
   tab/extension, login/challenge or normal tool permission stops the dependent work.
   Report the concrete user action; never fabricate approval or change permissions.
3. If needed, call the private adapter's `new-chat --claude-session-id
   "${CLAUDE_SESSION_ID}" --target-file "<status-binding.json>"` with the explicit same
   host identity and target. Only a canonical blank homepage qualifies as fresh. Read its
   returned exact binding and write that binding to a local target JSON file.
4. Create a local round with:
   `python "${CLAUDE_PLUGIN_ROOT}/scripts/claude_bridge.py" prepare --workdir "<project>" --claude-session-id "${CLAUDE_SESSION_ID}" --mode <plan|review|exc> --prompt-file "<prompt>" --target-file "<binding.json>"`.
5. For explicitly authorized ZIPs, call `upload --round-dir "<round>" --claude-session-id "${CLAUDE_SESSION_ID}" --attachment-manifest "<manifest>"`.
   An incomplete upload is observed with `upload-status`, never silently reassigned.
   No send proceeds without its original completed receipt.
6. Invoke the private `run-root --round-dir "<round>" --claude-session-id "${CLAUDE_SESSION_ID}"`
   once using the host's long-running Bash execution and wait facility. Remain in
   the same active turn until terminal evidence. Use no model polling, Stop Hook,
   desktop wake, independent send/start split or permission bypass.
7. Read terminal evidence. Only `completed` can use
   `import --round-dir "<round>" --claude-session-id "${CLAUDE_SESSION_ID}"`.
   All other states preserve the original evidence and forbid caller resend.
8. Read the nonempty imported response and provenance. Claude independently checks
   useful advice, implements any authorized changes and tests the final result.
   After that independent review, call the adapter `acknowledge --round-dir "<round>" --claude-session-id "${CLAUDE_SESSION_ID}"` to record local RootWait review; it never sends.
   Report ordinary model steps, browser send/import, errors/recovery and untested
   steps separately. GPT Pro is untrusted read-only evidence and never a writer.

The private PowerShell entry points require `-HostKind claude -HostSessionId
"${CLAUDE_SESSION_ID}" -CodexThreadId "<derived transport UUID>"`. Obtain that UUID
from `prepare`; the parameter retains its old name solely for transport compatibility.
Never substitute a guessed Codex UUID or claim Codex workspace ownership. Prefer the
Python adapter, which passes the honest host identity automatically. The private
transport is Windows-only; unsupported platforms stop explicitly.

Every independent round uses one new local evidence directory and unique key.
Completed import is idempotent; failed/uncertain rounds are never replaced to resend.
An additional requested round is a new independent fresh conversation in this initial
adapter. It does not claim support for follow-up attachment sends or batch concurrency.
