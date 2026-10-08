# Optional DeepSeek Harness compatibility

This profile bundle registers only `ccg_dsh_review`, an explicitly routed,
one-shot opinion tool. Its child receives no tools and cannot delegate again.
It creates no team, project memory, knowledge store, skills, routing prompt,
triage prompt, settings watcher or background teammate. Codex/Trellis remain
the personal workflow's task authority and writer.

Installing a bundle does not start DeepSeek Harness or call a model. Invoking
the opinion tool later uses the profile's configured provider and may incur
that provider's normal charges. Provider credentials stay in the existing
Harness configuration; this bundle never installs or copies them.

An explicit provider/model pair and the Harness provider-catalog API are
required. Missing routes fail before the tool is registered. This is not an
approval mechanism or filesystem sandbox. Review the compatibility evidence
and the selected profile's own policy before enabling the optional tool.
