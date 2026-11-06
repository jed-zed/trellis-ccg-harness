#requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
BeforeAll {
    . (Join-Path $PSScriptRoot '../scripts/chatgpt-pro-sidebar.ps1')
    # Execute the real detached-DOM traversal, then feed its records through
    # the production converter, wait and reextract paths. No live browser.
    $fixtureSource = @'
const fs = require('node:fs');
const source = fs.readFileSync(process.argv[1], 'utf8');
const helpers = source.slice(source.indexOf('  const MAX_TURNS'), source.indexOf('  let turnExtractionIssue'));
const {boundedText} = new Function('document', helpers + '; return {boundedText};')({});
const t = nodeValue => ({nodeType:3,nodeValue});
const e = (tagName,...childNodes) => ({nodeType:1,tagName,childNodes,cloneNode(){return this;},querySelectorAll(){return [];}});
const paragraph = boundedText(e('DIV',e('P',t('first')),e('P',t('second'))),false,true);
const list = boundedText(e('UL',e('LI',t('one')),e('LI',t('two'))),false,true);
console.log(JSON.stringify({paragraph,list}));
'@
    $script:baselineDom = (& node -e $fixtureSource (Join-Path $PSScriptRoot '../scripts/chatgpt-pro-agent-browser-v2.js') | Out-String | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0) { throw 'Production DOM fixture failed.' }


    $script:budgetScripts = Join-Path $PSScriptRoot '../../../../components/ccg-workflow/plugins/ccg/skills/ccg-gptpro-bridge/scripts'
    $script:verifyReceipt = @'
import json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import gptpro_budget as budget
folder, receipt = map(Path, sys.argv[2:4])
state = budget.read_json(folder/'state.json')
url = (folder/'url.txt').read_text(encoding='utf-8').strip()
names = ('state.json','evidence.json','watch-event.json','prompt.md','response.md','url.txt')
original = {'directory':folder.resolve(), 'state':state, 'url':url,
    'response':(folder/'response.md').read_text(encoding='utf-8'),
    'hashes':{name:budget.bridge.sha256_path(folder/name) if (folder/name).exists() else None for name in names},
    'binding':budget.bridge.validate_agent_browser_target_binding(state['targetBinding'],label='regression',conversation_url=url)}
text, _ = budget.reextracted_response(receipt, original)
assert text == 'new\n\nreply'
raw = receipt.read_bytes()
try:
    for field in ('observedUserTurnSha256','observedResponseSha256'):
        changed = json.loads(raw)
        changed[field][0] = 'wrong'
        receipt.write_text(json.dumps(changed), encoding='utf-8')
        try:
            budget.reextracted_response(receipt, original)
        except ValueError:
            pass
        else:
            raise AssertionError('Importer accepted changed ' + field)
finally:
    receipt.write_bytes(raw)
print('Independent importer accepted the receipt and rejected changed hashes.')
'@

    function New-BaselineRound {
        param([string]$Version='dom-agent-turn-v1', [ValidateSet('legacy','structural','fresh')][string]$Kind='legacy')
        $oldText = if ($Kind -eq 'legacy') { @('firstsecond','onetwo') } elseif ($Kind -eq 'structural') { @("first`n`nsecond","one`ntwo") } else { @() }
        $hashes = @($oldText | ForEach-Object { Get-Sha256Text -Text $_ })
        $binding = ConvertTo-AgentBrowserTargetBinding -Target $script:baselineTarget
        $claim = Reserve-AgentBrowserTargetClaim -CodexThreadIdValue $script:baselineThread -EvidenceDirectory $script:baselineDirectory -IdempotencyKeySha256Value (Get-Sha256Text -Text 'baseline-key') -Binding $binding
        $state = New-SendIntentState -PromptSha256 (Get-Sha256Text -Text 'original prompt') -IdempotencyKeyValue 'baseline-key' -BaselineHashes $hashes -ConversationUrlBeforeSend $binding.url -Transport $Script:AgentBrowserTransport -TargetBinding $binding -CodexThreadIdValue $script:baselineThread -TargetClaimKeySha256 $claim.KeySha256
        $state.extractorVersion = $Version
        $state.phase = 'sent'
        $state['baselineUserTurnSha256'] = $hashes
        $state['submissionAcknowledged'] = $false
        $state['invokeAttempted'] = $true
        $state['invokeReturned'] = $true
        $state.firstClickAtUtc = [DateTime]::UtcNow.ToString('o')
        $state.responseDeadlineAtUtc = [DateTime]::UtcNow.AddMinutes(5).ToString('o')
        $state.attemptCount = 1
        Write-Utf8NoBomAtomic -Path (Join-Path $script:baselineDirectory 'prompt.md') -Text 'original prompt'
        Write-EvidenceState -Directory $script:baselineDirectory -State $state
        $turns = @()
        if ($Kind -ne 'fresh') {
            foreach ($body in @($script:baselineDom.paragraph,$script:baselineDom.list)) {
                $turns += [pscustomobject]@{content=$body.text;truncated=$body.truncated;legacyContent=(Get-ObjectProperty $body 'legacyText' $null);legacyTruncated=$false}
            }
        }
        $records = @(ConvertTo-AgentBrowserTurnRecords -Turns $turns -Role 'assistant')
        $script:baselineSnapshot = [pscustomobject]@{
            Url=$binding.url;UrlExact=$true;Generating=$false
            UserTurns=@(ConvertTo-AgentBrowserTurnRecords -Role 'user' -Turns $turns)+@(ConvertTo-AgentBrowserTurnRecords -Role 'user' -Turns @([pscustomobject]@{content='original prompt';truncated=$false}))
            Responses=@($records)+@(ConvertTo-AgentBrowserTurnRecords -Role 'assistant' -Turns @([pscustomobject]@{content="new`n`nreply";truncated=$false}))
        }
        return $state
    }
}

Describe 'Versioned transcript baseline recovery' {
    BeforeEach {
        $script:baselineThread = '12345678-1234-1234-1234-123456789abc'
        $testRoot = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $script:baselineDirectory = Join-Path $testRoot 'round'
        [IO.Directory]::CreateDirectory($script:baselineDirectory) | Out-Null
        $script:TargetClaimRootOverride = Join-Path $testRoot 'claims'
        $script:baselineTarget = [pscustomobject]@{BrowserId='baseline-browser';ProfileId='baseline-profile';TabId='123';SessionKey='baseline-browser:baseline-profile:123';Origin='https://chatgpt.com';Url='https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc';UrlExact=$true}
        Mock Start-Sleep {}
        Mock Invoke-AgentBrowserCliJson { throw 'No browser action is allowed in baseline recovery tests.' }
        Mock Get-AgentBrowserWaitObservation {
            [pscustomobject]@{Transient=$false;Generating=$false;Target=$script:baselineTarget;Snapshot=$script:baselineSnapshot;Responses=$script:baselineSnapshot.Responses}
        }
    }
    AfterEach { $script:TargetClaimRootOverride = $null }

    It 'waits using <Version>/<Kind> without changing saved hashes or resending' -ForEach @(
        @{Version='dom-agent-turn-v1';Kind='legacy'},
        @{Version='dom-agent-turn-v1';Kind='structural'},
        @{Version='dom-agent-turn-v2';Kind='structural'},
        @{Version='dom-agent-turn-v2';Kind='fresh'}
    ) {
        $state = New-BaselineRound -Version $Version -Kind $Kind
        $saved = $state.baselineResponseSha256 | ConvertTo-Json -Compress
        $deadline = $state.responseDeadlineAtUtc
        $result = Invoke-AgentBrowserWait -EvidenceDirectory $script:baselineDirectory -CodexThreadIdValue $script:baselineThread -TimeoutSecondsValue 10 -PollMillisecondsValue 1000
        $result.completed | Should -BeTrue
        $after = Read-EvidenceState -Directory $script:baselineDirectory
        ($after.baselineResponseSha256 | ConvertTo-Json -Compress) | Should -BeExactly $saved
        ($after.baselineUserTurnSha256 | ConvertTo-Json -Compress) | Should -BeExactly $saved
        $after.extractorVersion | Should -BeExactly $Version
        ([DateTimeOffset]$after.responseDeadlineAtUtc).UtcDateTime.Ticks | Should -Be ([DateTimeOffset]$deadline).UtcDateTime.Ticks
        $after.submissionAcknowledged | Should -BeTrue
        $after.automaticResendAllowed | Should -BeFalse
        [IO.File]::ReadAllText((Join-Path $script:baselineDirectory 'response.md')) | Should -BeExactly "new`n`nreply"
        Should -Invoke Invoke-AgentBrowserCliJson -Times 0 -Exactly
    }

    It 'reextracts <Version>/<Kind> while preserving every original artifact' -ForEach @(
        @{Version='dom-agent-turn-v1';Kind='legacy'},
        @{Version='dom-agent-turn-v1';Kind='structural'},
        @{Version='dom-agent-turn-v2';Kind='structural'},
        @{Version='dom-agent-turn-v2';Kind='fresh'}
    ) {
        $state = New-BaselineRound -Version $Version -Kind $Kind
        $state.submissionAcknowledged = $true
        $oldResponse = [pscustomobject]@{Content='newreply';ContentSha256=(Get-Sha256Text -Text 'newreply');ExtractorVersion=$Version}
        $null = Complete-Evidence -EvidenceDirectory $script:baselineDirectory -State $state -Response $oldResponse -ConversationUrl $script:baselineTarget.Url -TransientObservationCount 0 -CodexThreadIdValue $script:baselineThread
        $before = @{}
        foreach ($file in Get-ChildItem -LiteralPath $script:baselineDirectory -File) { $before[$file.Name] = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName)) }
        $result = Invoke-AgentBrowserReextract -EvidenceDirectory $script:baselineDirectory -ThreadId $script:baselineThread
        $result.newWebRequests | Should -Be 0
        $validation = & python -B -X utf8 -c $script:verifyReceipt $script:budgetScripts $script:baselineDirectory $result.receiptFile 2>&1
        $LASTEXITCODE | Should -Be 0 -Because ($validation | Out-String)
        [IO.File]::ReadAllText($result.receiptFile) | Should -Match 'automaticResendAllowed'
        [IO.File]::ReadAllText((Join-Path (Split-Path -Parent $result.receiptFile) 'response.md')) | Should -BeExactly "new`n`nreply"
        foreach ($name in $before.Keys) { [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $script:baselineDirectory $name))) | Should -BeExactly $before[$name] }
        Should -Invoke Invoke-AgentBrowserCliJson -Times 0 -Exactly
    }

    It 'labels newly created browser states as v2' {
        $binding = ConvertTo-AgentBrowserTargetBinding -Target $script:baselineTarget
        $state = New-SendIntentState -PromptSha256 ('a'*64) -IdempotencyKeyValue 'new-round' -BaselineHashes @() -Transport $Script:AgentBrowserTransport -TargetBinding $binding -CodexThreadIdValue $script:baselineThread
        $state.extractorVersion | Should -BeExactly 'dom-agent-turn-v2'
    }

    It 'rejects <Mutation> instead of repairing historical evidence' -ForEach @(
        @{Mutation='changed'},@{Mutation='reordered'},@{Mutation='missing'},@{Mutation='mixed'},@{Mutation='v2-legacy'},@{Mutation='unknown-version'}
    ) {
        $state = New-BaselineRound
        switch ($Mutation) {
            'changed' { $script:baselineSnapshot.Responses[0] = [pscustomobject]@{ContentSha256='changed';LegacyContentSha256='changed'} }
            'reordered' { $script:baselineSnapshot.Responses = @($script:baselineSnapshot.Responses[1],$script:baselineSnapshot.Responses[0],$script:baselineSnapshot.Responses[2]) }
            'missing' { $script:baselineSnapshot.Responses = @($script:baselineSnapshot.Responses[2]) }
            'mixed' { $state.baselineResponseSha256[1] = $script:baselineSnapshot.Responses[1].ContentSha256 }
            'v2-legacy' { $state.extractorVersion = 'dom-agent-turn-v2' }
            'unknown-version' { $state.extractorVersion = 'dom-agent-turn-v99' }
        }
        $reextractError = if ($Mutation -eq 'missing') { '*transcript is incomplete*' } else { '*baseline*' }
        $waitError = if ($Mutation -eq 'reordered') { '*More than one new assistant response*' } else { '*baseline*' }
        { Select-ReextractionReply -State $state -Snapshot $script:baselineSnapshot } | Should -Throw $reextractError
        Write-EvidenceState -Directory $script:baselineDirectory -State $state
        { Invoke-AgentBrowserWait -EvidenceDirectory $script:baselineDirectory -CodexThreadIdValue $script:baselineThread -TimeoutSecondsValue 10 -PollMillisecondsValue 1000 } | Should -Throw $waitError
        Test-Path (Join-Path $script:baselineDirectory 'response.md') | Should -BeFalse
        Should -Invoke Invoke-AgentBrowserCliJson -Times 0 -Exactly
    }

    It 'retains suffix recovery but never accepts per-turn mixtures or extra appended replies' {
        $state = New-BaselineRound
        $responses = $script:baselineSnapshot.Responses
        (Compare-ResponseBaseline -BaselineHashes $state.baselineResponseSha256 -CurrentResponses @($responses[1],$responses[2]) -AllowLegacyContentHash).Status | Should -BeExactly 'one'
        { Compare-ResponseBaseline -BaselineHashes $state.baselineResponseSha256 -CurrentResponses @($responses[0],$responses[1],$responses[2],$responses[2]) -AllowLegacyContentHash } | Should -Throw '*More than one*'
        { Assert-AgentBrowserUserTurnAcknowledgement -BaselineHashes $state.baselineUserTurnSha256 -CurrentTurns @($responses[0],$responses[1],$responses[2],$responses[2]) -AllowLegacyContentHash } | Should -Throw '*at most one*'
    }

    It 'cannot use a missing or oversized legacy value to validate a v1 baseline' -ForEach @(@{Oversized=$false},@{Oversized=$true}) {
        $state = New-BaselineRound
        $badTurn = [pscustomobject]@{content=$script:baselineDom.paragraph.text;truncated=$false;legacyTruncated=$Oversized}
        if ($Oversized) { $badTurn | Add-Member legacyContent ('x'*200001) }
        $converted = @(ConvertTo-AgentBrowserTurnRecords -Role 'assistant' -Turns @($badTurn))
        { Compare-ResponseBaseline -BaselineHashes @($state.baselineResponseSha256[0]) -CurrentResponses $converted -AllowLegacyContentHash } | Should -Throw '*baseline*'
    }

    It 'does not let a matching legacy hash hide changed structure in a v2 round' {
        $state = New-BaselineRound -Version 'dom-agent-turn-v2' -Kind 'structural'
        foreach ($turn in $script:baselineSnapshot.Responses[0..1]) { $turn.LegacyContentSha256 = $turn.ContentSha256 }
        $script:baselineSnapshot.Responses[0].ContentSha256 = Get-Sha256Text -Text 'firstsecond'
        { Select-ReextractionReply -State $state -Snapshot $script:baselineSnapshot } | Should -Throw '*assistant baseline changed*'
        { Invoke-AgentBrowserWait -EvidenceDirectory $script:baselineDirectory -CodexThreadIdValue $script:baselineThread -TimeoutSecondsValue 10 -PollMillisecondsValue 1000 } | Should -Throw '*baseline*'
        Test-Path (Join-Path $script:baselineDirectory 'response.md') | Should -BeFalse
    }

    It 'prefers the longest unchanged baseline over a shorter match in another format' {
        $turns = @(
            [pscustomobject]@{ContentSha256='second';LegacyContentSha256='first'},
            [pscustomobject]@{ContentSha256='formatted';LegacyContentSha256='second'},
            [pscustomobject]@{ContentSha256='reply'}
        )
        (Compare-ResponseBaseline -BaselineHashes @('first','second') -CurrentResponses $turns -AllowLegacyContentHash).Status | Should -BeExactly 'one'
    }

    It 'still rejects a different prompt or conversation during legacy reextraction' -ForEach @(@{Different='prompt'},@{Different='url'}) {
        $state = New-BaselineRound
        if ($Different -eq 'prompt') { $state.promptSha256 = Get-Sha256Text -Text 'different prompt' }
        else { $script:baselineSnapshot.Url = 'https://chatgpt.com/c/87654321-1234-1234-1234-123456789abc' }
        { Select-ReextractionReply -State $state -Snapshot $script:baselineSnapshot } | Should -Throw
        Should -Invoke Invoke-AgentBrowserCliJson -Times 0 -Exactly
    }
}
