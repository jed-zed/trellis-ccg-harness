# Design

Trace shared watcher JSON reads and their callers before editing. Keep existing atomic-write, exact identity, original deadline and durable-terminal release contracts. Bound retry at the common read layer only for a demonstrated transient failure; do not mask malformed JSON or accept missing evidence.

Correlate the captured Python PID and UTC interval with the original invocation evidence. Use native no-window process startup for proven background helpers, without focus restoration or simulated input. No new dependency or global configuration is needed. Preserve hypotheses and distinguish mechanism reproduction from historical attribution.
