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

Include both scorecards below as mandatory parts of this section in the same response; keep all existing output sections.

### Requirement Completeness

需求完整性评分（0-10）
- 目标明确性（0-3）：X/3 - <reason>
- 预期结果（0-3）：X/3 - <reason>
- 边界范围（0-2）：X/2 - <reason>
- 约束条件（0-2）：X/2 - <reason>
- 总分：X/10
- 判定：>=7 继续；<7 停止并提出补充问题

### Planning Readiness Scorecard

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Requirement clarity | XX/20 | <evidence> |
| Scope boundaries | XX/20 | <evidence> |
| Implementation sequencing | XX/20 | <evidence> |
| Risk handling | XX/20 | <evidence> |
| Verification strategy | XX/20 | <evidence> |
| **TOTAL SCORE** | **XX/100** | <Ready / Needs Follow-up / Blocked> |

Score only from visible task context and actual routed evidence. Missing evidence lowers scores; disagreements use the more conservative score and blocker judgment. A completeness score below 7 requires missing details before creating or revising a plan. A score of 7 or above continues planning only; readiness scores do not authorize execution or Provider calls.

Focus on requirement ambiguity, wrong assumptions, architecture risk, missing constraints, test gaps, and whether the plan is worth continuing.

Do not produce final code. Do not claim to edit files.
