# Private host contract. codexThreadId is a legacy protocol key, not a Claude identity.
function Get-BridgeTransportId {
    param([ValidateSet('codex','claude')][string]$Kind,[string]$SessionId)
    if ($SessionId -cnotmatch '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$') { throw 'HostSessionId must be one canonical lowercase UUID.' }
    if ($Kind -eq 'codex') { return $SessionId }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $hex = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes('ccg-gptpro-bridge/claude/' + $SessionId)))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
    return $hex.Substring(0,8)+'-'+$hex.Substring(8,4)+'-8'+$hex.Substring(13,3)+'-8'+$hex.Substring(17,3)+'-'+$hex.Substring(20,12)
}
function Initialize-BridgeHost {
    param([ValidateSet('codex','claude')][string]$Kind,[string]$SessionId,[string]$LegacyTransportId)
    if ($Kind -eq 'codex' -and [string]::IsNullOrWhiteSpace($SessionId)) { $SessionId = $LegacyTransportId }
    $expected = Get-BridgeTransportId -Kind $Kind -SessionId $SessionId
    if ($LegacyTransportId -cne $expected) { throw 'The legacy transport UUID does not match the explicit host/session binding.' }
    $Script:BridgeHostKind = $Kind
    $Script:BridgeHostSessionId = $SessionId
    $Script:BridgeTransportId = $expected
    $Script:BridgeRootWaitTransport = if ($Kind -eq 'claude') { 'claude-root-wait' } else { 'codex-root-wait' }
    $Script:BridgeRootWaitAcknowledgement = if ($Kind -eq 'claude') { 'claude-root-wait-reviewed' } else { 'codex-root-wait-reviewed' }
}
function Assert-BridgeHostRecord {
    param($Record)
    foreach ($pair in @(@('hostKind',$Script:BridgeHostKind),@('hostSessionId',$Script:BridgeHostSessionId),@('transportThreadId',$Script:BridgeTransportId))) {
        $value = if ($Record -is [System.Collections.IDictionary]) { $Record[$pair[0]] } else { $Record.($pair[0]) }
        if ([string]$value -cne [string]$pair[1]) { throw ('Bridge evidence host/session mismatch: '+$pair[0]) }
    }
}
function Get-BridgeAuthority {
    return [ordered]@{
        externalOutputIsUntrusted = $true
        workspaceOwnerHost = $Script:BridgeHostKind
        workspaceOwnerSessionId = $Script:BridgeHostSessionId
        codexIsSoleWorkspaceWriter = $Script:BridgeHostKind -eq 'codex'
        claudeIsSoleWorkspaceWriter = $Script:BridgeHostKind -eq 'claude'
    }
}
