# Mode: High-Value Review Second Opinion

Review the plan, diff, changed files, or verification summary below.

The input should include the ordinary CCG review route, the current orchestrator's review
conclusion, and any routed helper findings. Compare the Base CCG Routing Evidence with the
review scope, call out disagreements, and help the current orchestrator decide what is actually
blocking.

Do not assume missing Codex, Claude, Gemini, or other model evidence exists. GPT Pro is fourth
evidence and must not replace routed models.

## Task For GPT Pro

Read the CCG Input, Project Access Context, Base CCG Routing Evidence, Gemini evidence if present,
and any diff or file excerpts. Your task is to review the submitted scope for concrete defects and
delivery risk: hidden bugs, security or compatibility issues, edge cases, test gaps, and places
where ordinary model findings may be false positives or may have missed something. Explain why each
finding matters, name the affected files or functions when evidence supports it, and state the
specific tests or verification needed before merge.

## Expected Output

Use exactly these sections:

## Critical

## Major

## Minor

## False Positives

## Required Tests

Review is the highest-value GPT Pro use case. Prioritize hidden bugs, security risks, compatibility risks, edge cases, test gaps, and likely false positives or misses in ordinary model evidence.

Do not invent files. Do not assume hidden state.
