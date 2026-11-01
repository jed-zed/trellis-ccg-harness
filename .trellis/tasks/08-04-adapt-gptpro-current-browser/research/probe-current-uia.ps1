#requires -Version 5.1
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$allowedNames = @(
    'ChatGPT',
    'Codex',
    '切换底部面板显示',
    'Toggle bottom panel',
    '在外部浏览器中打开',
    'Open in external browser',
    '浏览器',
    'Browser',
    '输入 URL',
    'Enter URL',
    'Address and search bar',
    '随心输入',
    'Do anything',
    '问问 ChatGPT',
    'Ask ChatGPT',
    '与 ChatGPT 聊天',
    'Message ChatGPT',
    'Chat with ChatGPT',
    '发送提示',
    'Send prompt',
    'Send message',
    '停止回答',
    'Stop generating',
    '新聊天',
    'New chat'
)
$processes = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Sort-Object Id)
$windows = @($processes | Where-Object { $_.MainWindowHandle -ne 0 })

$result = [ordered]@{
    processCount = $processes.Count
    mainWindowCount = $windows.Count
    windows = @()
}

foreach ($process in $windows) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
    if ($null -eq $root) { continue }

    $all = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    $counts = @{}
    $candidates = [System.Collections.Generic.List[object]]::new()

    foreach ($element in $all) {
        try {
            $type = [string]$element.Current.ControlType.ProgrammaticName
            if (-not $counts.ContainsKey($type)) { $counts[$type] = 0 }
            $counts[$type]++

            $name = [string]$element.Current.Name
            $automationId = [string]$element.Current.AutomationId
            $className = [string]$element.Current.ClassName
            $include = $type -in @('ControlType.Document', 'ControlType.Edit', 'ControlType.Tab', 'ControlType.TabItem') -or $allowedNames -contains $name

            $value = ''
            $valuePattern = $null
            if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
                $candidateValue = [string]$valuePattern.Current.Value
                if ($candidateValue -match '^https://(?:www\.)?chatgpt\.com(?:/|$)') { $value = $candidateValue }
            }
            if (-not $include -and [string]::IsNullOrWhiteSpace($value)) { continue }

            $invokePattern = $null
            $togglePattern = $null
            $selectionPattern = $null
            $supportsToggle = $element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$togglePattern)
            $supportsSelection = $element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionPattern)
            $candidates.Add([ordered]@{
                controlType = $type
                name = $name
                automationId = $automationId
                className = $className
                runtimeId = (($element.GetRuntimeId() | ForEach-Object { [string]$_ }) -join '.')
                isEnabled = [bool]$element.Current.IsEnabled
                isOffscreen = [bool]$element.Current.IsOffscreen
                urlValue = $value
                supportsValue = $null -ne $valuePattern
                supportsInvoke = $element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)
                supportsToggle = $supportsToggle
                toggleState = if ($supportsToggle) { [string]$togglePattern.Current.ToggleState } else { '' }
                supportsSelectionItem = $supportsSelection
                isSelected = if ($supportsSelection) { [bool]$selectionPattern.Current.IsSelected } else { $false }
            })
        }
        catch [System.Windows.Automation.ElementNotAvailableException] { }
        catch { }
    }

    $result.windows += [ordered]@{
        processId = $process.Id
        mainWindowHandle = [long]$process.MainWindowHandle
        topLevelName = [string]$root.Current.Name
        topLevelClass = [string]$root.Current.ClassName
        topLevelIsOffscreen = [bool]$root.Current.IsOffscreen
        topLevelWidth = [double]$root.Current.BoundingRectangle.Width
        topLevelHeight = [double]$root.Current.BoundingRectangle.Height
        descendantCount = $all.Count
        counts = $counts
        candidates = $candidates.ToArray()
    }
}

$result | ConvertTo-Json -Depth 8
