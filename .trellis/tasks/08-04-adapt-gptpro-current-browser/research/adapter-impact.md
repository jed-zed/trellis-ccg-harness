# Adapter impact map

## Existing selection boundary

- `Select-CodexWindowRecord` selects only visible top-level records containing exactly one Codex document and refuses ambiguity.
- `Get-LiveCodexWindow` enumerates top-level UIA elements and derives Codex/embedded document counts.
- `Select-EmbeddedDocumentRecord` requires one visible document containing exactly one known ChatGPT composer, or a unique address/document geometry match.
- `Ensure-LiveBrowserPanel` activates the legacy sidebar using supported UIA patterns and expects one address control afterward.
- `Resolve-LiveContext` requires exactly one address control and one embedded ChatGPT document.

## Action and evidence boundary

- Composer input uses `ValuePattern.SetValue`.
- `new-chat` and `send` use one `InvokePattern.Invoke` after re-resolution and precondition checks.
- `Get-LivePreparedSend` requires the exact prompt hash and exactly one eligible send button.
- Assistant extraction is bounded to semantic UIA leaves under `agent-turn`/`text-message` containers and excludes interactive descendants.
- URL capture and exact conversation binding are prerequisites for watcher observation and response import.

## Current incompatibility

The current bottom browser does not expose the old independent document/address shape. Adding another localized panel label alone cannot satisfy surface identity, composer identity, or exact URL binding.

## Separate finding

`Test-LiveDesktopStopRecord` and `Test-LiveDesktopSubmitRecord` reference `$Script:Names.DesktopStop`, but the names table does not define it. The official watcher/Stop Hook contract explicitly avoids desktop-composer wakeup, so this is deferred unless implementation proves it is on the accepted path.
