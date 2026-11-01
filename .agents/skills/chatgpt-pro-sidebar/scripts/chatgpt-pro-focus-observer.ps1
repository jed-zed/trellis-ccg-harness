#requires -Version 5.1
# Dot-source this helper, then invoke only against a previously authorized exact target.
. (Join-Path $PSScriptRoot 'chatgpt-pro-sidebar.ps1')
$Script:FocusObserverRoot = $PSScriptRoot

function Invoke-AgentBrowserFocusObserver {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateSet('start', 'read', 'stop')][string]$Operation,
        [Parameter(Mandatory = $true)]$TargetBinding,
        [AllowEmptyString()][string]$StartToken = ''
    )
    $null = Assert-AgentBrowserTargetBindingComplete -Binding $TargetBinding
    if (($Operation -eq 'start' -and $StartToken -cne '') -or
        ($Operation -ne 'start' -and $StartToken -cnotmatch '^[0-9a-f]{32}$')) {
        throw 'Start requires no token; read and stop require the original 32-character lowercase start token.'
    }
    $target = [pscustomobject]@{
        BrowserId = [string](Get-ObjectProperty $TargetBinding 'browserId' '')
        ProfileId = [string](Get-ObjectProperty $TargetBinding 'profileId' '')
        TabId = [string](Get-ObjectProperty $TargetBinding 'tabId' '')
        SessionKey = [string](Get-ObjectProperty $TargetBinding 'sessionKey' '')
    }
    $source = [IO.File]::ReadAllText((Join-Path $Script:FocusObserverRoot 'chatgpt-pro-focus-observer.js'))
    $actionMarker = 'const action = 0; // CCG_FOCUS_ACTION'
    $tokenMarker = "const expectedStartToken = ''; // CCG_FOCUS_TOKEN"
    foreach ($marker in @($actionMarker, $tokenMarker)) {
        if ($source.Split(@($marker), [StringSplitOptions]::None).Count -ne 2) { throw 'Fixed focus-observer template is invalid.' }
    }
    $action = switch ($Operation) { 'start' { 0 } 'read' { 1 } 'stop' { 2 } }
    $source = $source.Replace($actionMarker, ('const action = ' + $action + '; // CCG_FOCUS_ACTION'))
    $source = $source.Replace($tokenMarker, ("const expectedStartToken = '" + $StartToken + "'; // CCG_FOCUS_TOKEN"))
    $envelope = Invoke-AgentBrowserCliJson -Arguments @('exec', $source, '--tab', $target.TabId, '--browser', $target.BrowserId, '--profile', $target.ProfileId, '--timeout', '15')
    Assert-AgentBrowserCommandResultBinding -Envelope $envelope -Target $target
    $evidence = Get-ObjectProperty (Get-ObjectProperty $envelope 'result' $null) 'js_return' $null
    if ($null -eq $evidence -or [int](Get-ObjectProperty $evidence 'schemaVersion' 0) -ne 1 -or
        (Get-ObjectProperty $evidence 'focusRequested' $null) -ne $false) { throw 'Focus observer returned invalid evidence.' }
    if ([bool](Get-ObjectProperty $evidence 'ok' $false)) {
        if ([string](Get-ObjectProperty $evidence 'operation' '') -cne $Operation.ToLowerInvariant() -or
            [string](Get-ObjectProperty $evidence 'startToken' '') -cnotmatch '^[0-9a-f]{32}$' -or
            ($Operation -ne 'start' -and [string]$evidence.startToken -cne $StartToken)) { throw 'Focus observer returned mismatched evidence.' }
    }
    return $evidence
}
