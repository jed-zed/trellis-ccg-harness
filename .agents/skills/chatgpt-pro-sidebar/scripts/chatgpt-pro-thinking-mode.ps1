$Script:ThinkingModeRoot = $PSScriptRoot
$Script:ThinkingModeManualRootOverride = $null

function ConvertTo-CanonicalThinkingMode {
    param([AllowNull()][AllowEmptyString()][string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return 'Pro' }
    $value = $Value.Trim()
    if ($value.Length -gt 64 -or $value -match '[\x00-\x1f\x7f]') { throw 'ThinkingMode must be one bounded webpage mode label.' }
    $contract = [IO.File]::ReadAllText((Join-Path $Script:ThinkingModeRoot 'thinking-modes.json')) | ConvertFrom-Json
    foreach ($mode in $contract.modes.PSObject.Properties) {
        if ($value -ieq $mode.Name -or @($mode.Value | Where-Object { $_ -ieq $value }).Count) { return [string]$mode.Name }
    }
    return $value
}

function Restore-ThinkingModeFromState {
    param([Parameter(Mandatory=$true)]$State)
    $saved = ConvertTo-CanonicalThinkingMode -Value ([string](Get-ObjectProperty $State 'thinkingMode' 'Pro'))
    if ($Script:ThinkingModeExplicit -and (ConvertTo-CanonicalThinkingMode -Value $Script:RequestedThinkingMode) -cne $saved) {
        Throw-SidebarError -ExitCode 28 -Category 'ThinkingModeEvidenceMismatch' -Message 'The explicit thinking mode differs from this original request; recovery cannot change it.'
    }
    $Script:RequestedThinkingMode = $saved
    return $saved
}

function Test-AgentBrowserThinkingMode {
    param($Snapshot)
    $expected = ConvertTo-CanonicalThinkingMode -Value $Script:RequestedThinkingMode
    $actual = ConvertTo-CanonicalThinkingMode -Value ([string](Get-ObjectProperty $Snapshot 'SelectedModeLabel' ''))
    return [int](Get-ObjectProperty $Snapshot 'SelectedModeControlCount' 0) -eq 1 -and
        -not [string]::IsNullOrWhiteSpace([string](Get-ObjectProperty $Snapshot 'SelectedModeLabel' '')) -and $actual -ceq $expected -and
        ($expected -cne 'Pro' -or [bool](Get-ObjectProperty $Snapshot 'SelectedModeIsPro' $false))
}

function Get-AgentBrowserThinkingAction {
    param([Parameter(Mandatory=$true)]$Target, [ValidateSet(-1,0,1,2)][int]$Step=0)
    $path=Join-Path $Script:ThinkingModeRoot 'chatgpt-pro-thinking-mode.js'
    $source=[IO.File]::ReadAllText($path)
    $marker='const step = 0; // CCG_MODE_STEP'
    if($source.Split(@($marker),[StringSplitOptions]::None).Count -ne 2){throw 'Fixed thinking-mode template is invalid.'}
    $source=$source.Replace($marker,('const step = '+$Step+'; // CCG_MODE_STEP'))
    $envelope=Invoke-AgentBrowserCliJson -Arguments @('exec',$source,'--tab',[string]$Target.TabId,'--browser',[string]$Target.BrowserId,'--profile',[string]$Target.ProfileId,'--timeout','15')
    Assert-AgentBrowserCommandResultBinding -Envelope $envelope -Target $Target
    $action=Get-ObjectProperty (Get-ObjectProperty $envelope 'result' $null) 'js_return' $null
    if($null -eq $action -or [int](Get-ObjectProperty $action 'schemaVersion' 0) -ne 1){throw 'Thinking-mode action returned invalid evidence.'}
    return $action
}

function Assert-ThinkingAction {
    param($Action)
    if (-not [bool](Get-ObjectProperty $Action 'ok' $false)) {
        Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeUnavailable' -Message 'The bound webpage thinking control could not be proved.' -Details @{reason=[string](Get-ObjectProperty $Action 'reason' 'unknown')}
    }
}

function Invoke-ThinkingSliderStep {
    param($Target, $Before, [ValidateSet(-1,1)][int]$Step)
    if ([int]$Before.count -lt 1 -or [int]$Before.count -gt 16 -or [int]$Before.index+$Step -lt 1 -or [int]$Before.index+$Step -gt [int]$Before.count) { Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeSwitchUnproved' -Message 'Thinking slider bounds are invalid.' }
    $issued = Get-AgentBrowserThinkingAction -Target $Target -Step $Step
    Assert-ThinkingAction -Action $issued
    Start-Sleep -Milliseconds 200
    $after = Get-AgentBrowserThinkingAction -Target $Target
    Assert-ThinkingAction -Action $after
    if ($after.phase -cne 'slider' -or [int]$after.index -ne [int]$Before.index+$Step -or [int]$after.count -ne [int]$Before.count -or
        (@((Get-ObjectProperty $after 'selectedModelLabels' @())) -join '|') -cne (@((Get-ObjectProperty $Before 'selectedModelLabels' @())) -join '|')) {
        Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeSwitchUnproved' -Message 'The thinking strength step or unchanged model was not independently confirmed.'
    }
    return $after
}

function Get-AgentBrowserThinkingInventory {
    param($Target, $InitialAction)
    $action = $InitialAction
    $originalIndex = [int]$action.index
    $seen = @{}
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    try {
        for ($i=0; $i -lt 34; $i++) {
            Assert-ThinkingAction -Action $action
            if ([DateTime]::UtcNow -ge $deadline) { Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeSwitchUnproved' -Message 'Thinking-mode discovery deadline expired.' }
            if ($action.phase -cne 'slider') { Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeSwitchUnproved' -Message 'This webpage did not expose a proved thinking-strength slider.' }
            $key = [string]$action.index
            if ($seen.ContainsKey($key) -and $seen[$key].label -cne [string]$action.currentLabel) { Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeSwitchUnproved' -Message 'Thinking slider labels changed during discovery.' }
            $seen[$key] = [pscustomobject]@{index=[int]$action.index; label=[string]$action.currentLabel; canonical=(ConvertTo-CanonicalThinkingMode -Value ([string]$action.currentLabel))}
            if ($action.index -eq 1) { break }
            $action = Invoke-ThinkingSliderStep -Target $Target -Before $action -Step -1
        }
        for ($i=0; $i -lt 17 -and $action.index -lt $action.count; $i++) {
            if ([DateTime]::UtcNow -ge $deadline) { Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeSwitchUnproved' -Message 'Thinking-mode discovery deadline expired.' }
            $action = Invoke-ThinkingSliderStep -Target $Target -Before $action -Step 1
            $key = [string]$action.index
            if ($seen.ContainsKey($key) -and $seen[$key].label -cne [string]$action.currentLabel) { Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeSwitchUnproved' -Message 'Thinking slider labels changed during discovery.' }
            $seen[$key] = [pscustomobject]@{index=[int]$action.index; label=[string]$action.currentLabel; canonical=(ConvertTo-CanonicalThinkingMode -Value ([string]$action.currentLabel))}
        }
        if ($seen.Count -ne [int]$action.count) { Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeSwitchUnproved' -Message 'Not all advertised thinking strengths were proved.' }
        return [pscustomobject]@{options=@($seen.Values|Sort-Object index); originalIndex=$originalIndex; current=$action}
    } finally {
        # Discovery changes only the intensity, then restores it before selection.
        for ($j=0; $j -lt 16 -and [int]$action.index -ne $originalIndex; $j++) {
            if ([DateTime]::UtcNow -ge $deadline) { Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeSwitchUnproved' -Message 'Thinking-mode restoration deadline expired; no prompt was sent.' }
            $direction = if ([int]$action.index -gt $originalIndex) { -1 } else { 1 }
            $action = Invoke-ThinkingSliderStep -Target $Target -Before $action -Step $direction
        }
    }
}

function Ensure-AgentBrowserThinkingMode {
    param([Parameter(Mandatory=$true)]$Target,[Parameter(Mandatory=$true)]$Snapshot)
    Assert-AgentBrowserBaseReady -Snapshot $Snapshot
    if (Test-AgentBrowserThinkingMode -Snapshot $Snapshot) { return $Snapshot }
    if ([int](Get-ObjectProperty $Snapshot 'SelectedModeControlCount' 0) -ne 1) { Assert-AgentBrowserSelectedPro -Snapshot $Snapshot }
    $wanted = ConvertTo-CanonicalThinkingMode -Value $Script:RequestedThinkingMode
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    $selectionAttempted = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        $action = if ($wanted -ceq 'Pro') { Get-AgentBrowserProSelectionAction -Target $Target } else { Get-AgentBrowserThinkingAction -Target $Target }
        Assert-ThinkingAction -Action $action
        switch ([string]$action.phase) {
            'open-menu' { Invoke-AgentBrowserBoundMouseClick -Target $Target -Selector 'button[data-codex-gptpro-mode-control="true"]' }
            'open-submenu' { }
            'select-pro' { Invoke-AgentBrowserBoundMouseClick -Target $Target -Selector '[data-codex-gptpro-pro-option="true"]'; $selectionAttempted = $true }
            'already-pro' { }
            'slider' {
                $inventory = Get-AgentBrowserThinkingInventory -Target $Target -InitialAction $action
                $matches = @($inventory.options|Where-Object { $_.canonical -ceq $wanted })
                if ($matches.Count -ne 1) {
                    Close-AgentBrowserThinkingMenu -Target $Target
                    Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeUnavailable' -Message 'The requested webpage thinking strength is unavailable or ambiguous; no prompt was sent.' -Details @{requestedThinkingMode=$wanted;available=@($inventory.options.label);matchCount=$matches.Count}
                }
                $current = Get-AgentBrowserThinkingAction -Target $Target
                Assert-ThinkingAction -Action $current
                for ($i=0; $i -lt 16 -and [int]$current.index -ne [int]$matches[0].index; $i++) {
                    $direction = if ([int]$current.index -gt [int]$matches[0].index) { -1 } else { 1 }
                    $current = Invoke-ThinkingSliderStep -Target $Target -Before $current -Step $direction
                }
                if ((ConvertTo-CanonicalThinkingMode -Value ([string]$current.currentLabel)) -cne $wanted) { Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeSwitchUnproved' -Message 'Selected thinking strength was not confirmed.' }
                Close-AgentBrowserThinkingMenu -Target $Target
                $selectionAttempted = $true
            }
            default { Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeUnavailable' -Message 'The webpage did not expose a supported, unambiguous thinking-strength control.' }
        }
        Start-Sleep -Milliseconds 250
        $Snapshot = Get-AgentBrowserPageSnapshot -Target $Target
        Assert-AgentBrowserBaseReady -Snapshot $Snapshot
        if (Test-AgentBrowserThinkingMode -Snapshot $Snapshot) { return $Snapshot }
        if ($selectionAttempted) { Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeSwitchUnproved' -Message 'One automatic selection did not confirm the requested strength; do not repeat clicks.' }
    }
    Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeSwitchUnproved' -Message 'The requested thinking strength was not confirmed within its bounded selection window.'
}
function Close-AgentBrowserThinkingMenu {
    param($Target)
    $closed = Get-AgentBrowserThinkingAction -Target $Target -Step 2
    Assert-ThinkingAction -Action $closed
    Start-Sleep -Milliseconds 200
    $proof = Get-AgentBrowserThinkingAction -Target $Target
    Assert-ThinkingAction -Action $proof
    if ($proof.phase -cne 'open-menu') { Throw-SidebarError -ExitCode 23 -Category 'ThinkingMenuCloseUnproved' -Message 'The bound thinking popup did not confirm closing; no prompt was sent.' }
}

function Get-AgentBrowserManualThinkingPath {
    param($Target)
    $binding = ConvertTo-AgentBrowserTargetBinding -Target $Target
    $key = Get-Sha256Text -Text ((@($binding.browserId,$binding.profileId,$binding.tabId,$binding.sessionKey,$binding.origin,$binding.url,$Script:RequestedThinkingMode)) -join [char]31)
    $root = if ($Script:ThinkingModeManualRootOverride) { $Script:ThinkingModeManualRootOverride } else { Join-Path $env:LOCALAPPDATA 'ChatGptProSidebar/thinking-mode-v1' }
    return Join-Path $root ($key+'.json')
}

function Read-AgentBrowserManualThinkingGate {
    param($Target)
    $path = Get-AgentBrowserManualThinkingPath -Target $Target
    if ([IO.File]::Exists($path)) { return (Read-BridgeText -Path $path | ConvertFrom-Json) }
    return $null
}

function Request-AgentBrowserManualThinkingMode {
    param($Target,[string]$Reason)
    $path = Get-AgentBrowserManualThinkingPath -Target $Target
    $gate = Read-AgentBrowserManualThinkingGate -Target $Target
    $notify = $null -eq $gate -or [string](Get-ObjectProperty $gate 'status' '') -cne 'waiting-for-user'
    if ($notify) {
        $gate = [ordered]@{schemaVersion=1;status='waiting-for-user';thinkingMode=$Script:RequestedThinkingMode;targetBinding=(ConvertTo-AgentBrowserTargetBinding -Target $Target);reason=$Reason;requestedAtUtc=[DateTime]::UtcNow.ToString('o');automaticSelectionAllowed=$false}
        $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $path))
        Write-Utf8NoBomAtomic -Path $path -Text ($gate|ConvertTo-Json -Depth 8)
    }
    $binding = Get-ObjectProperty $gate 'targetBinding' $null
    Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeManualSelectionRequired' -Message ('Please select webpage thinking strength '+$Script:RequestedThinkingMode+' manually in '+[string]$binding.url+' (tab '+[string]$binding.tabId+'), then continue this original request. The bridge will independently verify it before sending.') -Details @{waitingForUser=$true;requestedThinkingMode=$Script:RequestedThinkingMode;targetBinding=$binding;manualSelectionStateFile=$path;userNotificationNeeded=$notify;reason=[string](Get-ObjectProperty $gate 'reason' $Reason);automaticResendAllowed=$false}
}

function Test-AgentBrowserManualBeforeFillResume {
    param($State,[string]$PromptText,[string]$Key,[string]$ThreadId,$Binding,[string]$Directory)
    if ($null -eq $State -or [string](Get-ObjectProperty $State 'preInvokeFailureCategory' '') -cne 'ThinkingModeManualSelectionRequired') { return $false }
    if ([string](Get-ObjectProperty $State 'phase' '') -cne 'pre-invoke-failed' -or [bool](Get-ObjectProperty $State 'invokeAttempted' $true) -or [int](Get-ObjectProperty $State 'attemptCount' -1) -ne 0 -or [bool](Get-ObjectProperty $State 'submissionAcknowledged' $true) -or
        -not [string]::IsNullOrWhiteSpace([string](Get-ObjectProperty $State 'globalReservationAtUtc' '')) -or -not [string]::IsNullOrWhiteSpace([string](Get-ObjectProperty $State 'targetClaimKeySha256' ''))) { return $false }
    $null = Assert-StateCodexThreadId -State $State -ExpectedCodexThreadId $ThreadId
    if ([string](Get-ObjectProperty $State 'idempotencyKey' '') -cne $Key -or [string](Get-ObjectProperty $State 'promptSha256' '') -cne (Get-Sha256Text $PromptText) -or (Get-Sha256File (Join-Path $Directory 'prompt.md')) -cne (Get-Sha256Text $PromptText)) { throw 'Manual recovery must preserve the original prompt and request identity.' }
    $saved = Get-ObjectProperty $State 'targetBinding' $null
    foreach ($field in @('browserId','profileId','tabId','sessionKey','origin','url')) { if ([string](Get-ObjectProperty $saved $field '') -cne [string](Get-ObjectProperty $Binding $field '')) { throw 'Manual recovery cannot change its original browser binding.' } }
    return $true
}
