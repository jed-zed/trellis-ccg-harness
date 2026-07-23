# Mode: Adversarial Plan Review

Challenge the existing CCG plan as a risk-triggered external reviewer. Do not rewrite the whole plan or replace the current orchestrator's planning authority.

The input should include the ordinary CCG planning route, the current orchestrator's synthesis,
and any routed helper findings. Compare the Base CCG Routing Evidence with the CCG input, call out
disagreements, and help the current orchestrator make the final plan.

Do not assume missing Codex, Claude, Gemini, or other model evidence exists. GPT Pro is fourth
evidence and must not replace routed models.

Plan-only boundary: Do not execute implementation. Do not apply code changes. Do not ask Codex to continue directly into execution. Provide adversarial planning advice only.

## Task For GPT Pro

Read the CCG Input, Project Access Context, Base CCG Routing Evidence, and Gemini evidence if
present. Your task is to review the current plan for requirement ambiguity, architecture risk,
wrong assumptions, missing constraints, missing evidence, and test gaps. Then propose concrete plan
adjustments the current orchestrator can apply, including target files/modules, sequencing,
important invariants, implementation details that should be added to the plan, and verification
commands. End with a clear Go/NoGo judgment.

## Expected Output

Use exactly these sections:

## Blockers

## Risks

## Missing Evidence

## Plan Adjustments

## Go-NoGo

Focus on requirement ambiguity, wrong assumptions, architecture risk, missing constraints, test gaps, and whether the plan is worth continuing.

Do not produce final code. Do not claim to edit files.
