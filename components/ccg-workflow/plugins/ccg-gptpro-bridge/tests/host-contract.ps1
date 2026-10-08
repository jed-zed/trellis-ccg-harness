# Real private PowerShell functions with synthetic files only. No browser/model invoked.
$ErrorActionPreference = 'Stop'
$pluginRoot = Split-Path -Parent $PSScriptRoot
$vendorRoot = Join-Path $pluginRoot 'scripts/vendor'
$session = '019fa981-725e-7f02-93a7-bb1e1b7aefd3'
$transport = '90c8c894-dfed-8ede-80bf-71429c903b26'
$testTemp = Join-Path ([IO.Path]::GetTempPath()) ('claude-host-test-'+[Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $testTemp
$count = 0
function Check([bool]$Value,[string]$Message) { if (-not $Value) { throw $Message }; $script:count++ }
function MustReject([scriptblock]$Action,[string]$Message) { $rejected=$false;try { & $Action | Out-Null } catch { $rejected=$true };Check $rejected $Message }
try {
    foreach ($file in (Get-ChildItem -LiteralPath $vendorRoot -Filter *.ps1)) {
        $tokens=$null;$errors=$null
        [Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)|Out-Null
        Check (@($errors).Count -eq 0) ('Parse failed: '+$file.Name)
    }
    . (Join-Path $vendorRoot 'chatgpt-pro-sidebar.ps1') -HostKind claude -HostSessionId $session -CodexThreadId $transport
    Initialize-BridgeHost -Kind claude -SessionId $session -LegacyTransportId $transport
    Check ((Get-BridgeTransportId -Kind claude -SessionId $session) -ceq $transport) 'Python/PowerShell transport derivation mismatch'
    MustReject { Initialize-BridgeHost -Kind claude -SessionId $session -LegacyTransportId $session } 'Claude UUID cannot impersonate a Codex UUID'
    Initialize-BridgeHost -Kind claude -SessionId $session -LegacyTransportId $transport
    $authority = Get-BridgeAuthority
    Check ($authority.claudeIsSoleWorkspaceWriter -and -not $authority.codexIsSoleWorkspaceWriter) 'Authority must be honest'
    $bad = @{hostKind='codex';hostSessionId=$session;transportThreadId=$transport}
    MustReject { Assert-BridgeHostRecord $bad } 'Another host record must be rejected'
    $directory = Join-Path $testTemp 'sidebar';$null=New-Item -ItemType Directory -Path $directory
    $prompt = 'Synthetic PowerShell fixture prompt'
    Write-Utf8NoBomAtomic -Path (Join-Path $directory 'prompt.md') -Text $prompt
    $url = 'https://chatgpt.com/c/019fa981-725e-7f02-93a7-bb1e1b7aefd5'
    $binding = @{browserId='fixture-browser';profileId='fixture-profile';tabId='fixture-tab';sessionKey='fixture-session';origin='https://chatgpt.com';url=$url}
    $state=[ordered]@{schemaVersion=1;tool=$Script:ToolName;phase='sent';live=$true;transport='agent-browser-cli-v2';codexThreadId=$transport;promptFile='prompt.md';promptSha256=(Get-Sha256Text $prompt);conversationUrlBound=$url;targetBinding=$binding;automaticResendAllowed=$false;submissionAcknowledged=$true;baselineResponseSha256=@()}
    Write-EvidenceState -Directory $directory -State $state
    $content='Offline PowerShell fixture response; no model called.'
    $response=@{Content=$content;ContentSha256=(Get-Sha256Text $content)}
    Complete-Evidence -EvidenceDirectory $directory -State $state -Response $response -ConversationUrl $url -TransientObservationCount 0 -StablePollCount 2 -CodexThreadIdValue $transport | Out-Null
    $raw=Get-Content -LiteralPath (Join-Path $directory 'evidence.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Check ($raw.authority.claudeIsSoleWorkspaceWriter -and -not $raw.authority.codexIsSoleWorkspaceWriter) 'Actual completion raw authority is wrong'
    Check ($raw.hostKind -ceq 'claude' -and $raw.hostSessionId -ceq $session -and $raw.transportThreadId -ceq $transport) 'Completion host identity is wrong'
    . (Join-Path $vendorRoot 'chatgpt-pro-sidebar-watch.ps1') -HostKind claude -HostSessionId $session -CodexThreadId $transport
    Initialize-BridgeHost -Kind claude -SessionId $session -LegacyTransportId $transport
    Check ((Get-WatchContinuationTransport @{rootWait=$true}) -ceq 'claude-root-wait') 'Claude RootWait must not claim Codex continuation'
    $watchState=@{watcherId='019fa981-725e-7f02-93a7-bb1e1b7aefd4';codexThreadId=$transport;hostKind='claude';hostSessionId=$session;transportThreadId=$transport;legacyTransportThreadField='codexThreadId';evidenceDirectory=$directory;transport='agent-browser-cli-v2';conversationUrl=$url;targetBinding=$binding;rootWait=$true;noWake=$true;agentMonitor=$false}
    $event=New-WatchEvent -WatchState $watchState -LoopResult @{Status='completed';Reason='offline-fixture'}
    Check ($event.requiresHostReview -and -not $event.requiresCodexReview) 'Watcher must require Claude host review'
    Check ($event.hostKind -ceq 'claude' -and $event.hostSessionId -ceq $session) 'Event host binding is wrong'
    $worker=New-WatchWorkerArgumentList -ScriptPath (Join-Path $vendorRoot 'chatgpt-pro-sidebar-watch.ps1') -EvidenceDirectory $directory -ThreadId $transport -Token 'offline-token' -ExpectedWatcherId $watchState.watcherId -RootWait
    Check ($worker[$worker.IndexOf('-HostKind')+1] -ceq 'claude') 'Worker lost HostKind'
    Check ($worker[$worker.IndexOf('-HostSessionId')+1] -ceq $session) 'Worker lost real host session'
    $spy=Join-Path $testTemp 'spy.ps1'
    @('param([string]$CodexThreadId,[string]$HostKind,[string]$HostSessionId)','@{ok=$true;hostKind=$HostKind;hostSessionId=$HostSessionId;codexThreadId=$CodexThreadId}|ConvertTo-Json -Compress') | Set-Content -LiteralPath $spy -Encoding UTF8
    $probe=Invoke-WatchAdapterProcess -Arguments @('-NoProfile','-File',$spy,'-CodexThreadId',$transport) -ProcessTimeoutSeconds 10
    Check ($probe.ExitCode -eq 0) 'Synthetic adapter process failed'
    Check ($probe.Payload.hostKind -ceq 'claude' -and $probe.Payload.hostSessionId -ceq $session -and $probe.Payload.codexThreadId -ceq $transport) 'Actual child process lost host/session/transport'
    Write-WatchJsonAtomic -Path (Join-Path $directory 'watch-state.json') -Value $watchState
    Write-WatchJsonAtomic -Path (Join-Path $directory 'watch-event.json') -Value $event
    $ack=Acknowledge-RootWait -EvidenceDirectory $directory -ThreadId $transport
    $ackJson=Read-WatchJson -Path (Join-Path $directory 'watch-continuation-ack.json') -Required
    Check ($ack.acknowledged -and $ackJson.transport -ceq 'claude-root-wait' -and $ackJson.acknowledgementType -ceq 'claude-root-wait-reviewed') 'Local review acknowledgement is wrong'
    Check ($ackJson.hostKind -ceq 'claude' -and $ackJson.hostSessionId -ceq $session) 'Acknowledgement host binding is wrong'
    $Command='acknowledge-monitor'
    MustReject { Invoke-WatchMain } 'Claude model-monitor/hook continuation must be unavailable'
    [ordered]@{passed=$count;failed=0;scope='offline private PowerShell functions and synthetic child process';browserCalls=0;modelCalls=0;globalChanges=0}|ConvertTo-Json -Compress
} finally {
    $resolved=[IO.Path]::GetFullPath($testTemp)
    $allowed=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolved.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolved).StartsWith('claude-host-test-')) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
