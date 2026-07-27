# Domain AI Rule

Use this rule for RAG, agents, LLM security, evals, prompt templates, and model helper workflows.

- Resolve the applicable frontend, backend, and search providers before
  delegating model-specific analysis or review.
- Routed external providers are bounded helpers and do not own the real
  workspace.
- When Gemini is selected, use the standard CCG Gemini templates and preview
  helper.
- Keep prompt, eval, and model behavior changes testable.
- Preserve Codex as final owner of edits and verification.
