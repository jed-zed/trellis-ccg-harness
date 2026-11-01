# Window discovery and binding contracts

## Microsoft UI Automation

Primary sources:

- [Obtaining UI Automation Elements](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-obtainingelements)
- [AutomationElement.GetRuntimeId](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.getruntimeid?view=windowsdesktop-10.0)
- [Using UI Automation for Automated Testing](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-usefortesting)
- [UI Automation Control Patterns for Clients](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-control-patterns-for-clients)
- [UI Automation Events Overview](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-events-overview)
- [ElementNotAvailableException](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.elementnotavailableexception?view=windowsdesktop-10.0)
- [UI Automation Tree Overview](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-treeoverview)
- [IUIAutomation::CompareElements](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomation-compareelements)

Planning conclusions:

- Begin discovery from a known application/window container and use combined property, control-type, containment, and actual-pattern evidence. Do not make a desktop-wide descendant scan or a localized `Name` the sole identity contract.
- RuntimeId is opaque, unique only inside the generating desktop UI, reusable over time, and not a cross-session persistent key. Use it for current-operation comparison/binding only; never parse its numeric structure.
- AutomationId is optional and generally container-scoped. Name may be localized. ControlType does not prove a supported action pattern; acquire the required current pattern at the point of use.
- Structure/focus events are invalidation hints, not complete truth. Critical actions still require current verification.
- On `ElementNotAvailable`, discard the stale element/pattern and restart discovery from the proven window anchor. Do not retry an uncertain action against a newly discovered replacement.
- `CompareElements` is a stronger live same-element comparison where available; the MVP may retain RuntimeId equality plus full semantic proof if introducing COM comparison would expand the change beyond the accepted minimal root-cause fix.

## OpenAI Codex app

Primary sources:

- [Using built-in browser](https://help.openai.com/en/articles/20001277-using-the-built-in-browser-in-the-chatgpt-desktop-app)
- [Codex app browser](https://developers.openai.com/codex/app/browser)
- [Computer Use](https://learn.chatgpt.com/docs/computer-use)
- [Codex App Server](https://developers.openai.com/codex/app-server)

Planning conclusions:

- OpenAI documents the desktop built-in browser and Computer Use, including visible foreground interaction and optional browser developer/CDP capabilities.
- No official source was found that promises a stable Windows UIA tree, stable browser control IDs, a Codex top-level-window enumeration API, or a tab enumeration API. This is an explicit absence of documented evidence, not proof that no internal capability exists.
- The project Skill prohibits CDP, screenshots/OCR, synthesized input, cookies/tokens, profile access, and alternate browser transports. Therefore those documented product capabilities cannot be substituted for the approved UIA bridge.
- Codex may nominate or focus a candidate window as orchestration context. The adapter must still independently prove the window and ChatGPT surface; ambient browser URL/context is never sufficient trust evidence.

## Resulting architecture decision

Use a two-layer contract:

1. Codex candidate nomination/focus hint.
2. Adapter-owned UIA enumeration, proof, operation-scoped lock, action, observation, and fail-closed invalidation.

This improves upgrade tolerance without promising arbitrary future compatibility or weakening the exact URL/composer/action contracts.
