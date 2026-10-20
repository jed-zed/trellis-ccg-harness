#requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
BeforeAll {
    $candidate = Split-Path -Parent $PSScriptRoot
    . (Join-Path $candidate 'scripts/chatgpt-pro-sidebar.ps1')
    function New-RegressionPage {
        [pscustomobject]@{
            schemaVersion=1; origin='https://chatgpt.com'; url=$script:testUrl
            composer=[pscustomobject]@{count=$script:composerCount; selector=$script:composerSelector; selectorMatchCount=$script:selectorCount; value='draft'}
            send=[pscustomobject]@{count=0; selector=''; selectorMatchCount=0; formScope=''}
            auth=[pscustomobject]@{loginCount=0;challengeCount=0;proIndicatorCount=1}
            model=[pscustomobject]@{controlCount=0;selectedLabel='';proSelected=$false}
            generating=$false;turnExtractionIssue='';turnLimitExceeded=$false
            userTurns=@([pscustomobject]@{ordinal=0;key='u';content='request';truncated=$false})
            assistantTurns=@([pscustomobject]@{ordinal=0;key='a';content='complete reply';truncated=$false})
        }
    }
}
Describe 'Completed response reextraction isolation' {
    BeforeEach {
        $script:reUrl='https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        $script:reState=[pscustomobject]@{conversationUrlBound=$script:reUrl;baselineUserTurnSha256=@('old-user');baselineResponseSha256=@('old-response');promptSha256='sent-prompt'}
        $script:reSnapshot=[pscustomobject]@{Url=$script:reUrl;Generating=$false;UserTurns=@([pscustomobject]@{ContentSha256='old-user'},[pscustomobject]@{ContentSha256='sent-prompt'},[pscustomobject]@{ContentSha256='later-confirmation'});Responses=@([pscustomobject]@{ContentSha256='old-response'},[pscustomobject]@{Content='complete source';ContentSha256='complete';Truncated=$false},[pscustomobject]@{Content='later reply';ContentSha256='later';Truncated=$false})}
    }
    It 'selects the original reply even when a later confirmation exists' { (Select-ReextractionReply -State $script:reState -Snapshot $script:reSnapshot).Content | Should -Be 'complete source' }
    It 'rejects a changed sent prompt' { $script:reSnapshot.UserTurns[1].ContentSha256='other'; {Select-ReextractionReply -State $script:reState -Snapshot $script:reSnapshot} | Should -Throw '*prompt*' }
    It 'rejects a changed user baseline' { $script:reSnapshot.UserTurns[0].ContentSha256='other'; {Select-ReextractionReply -State $script:reState -Snapshot $script:reSnapshot} | Should -Throw '*baseline*' }
    It 'rejects a changed assistant baseline' { $script:reSnapshot.Responses[0].ContentSha256='other'; {Select-ReextractionReply -State $script:reState -Snapshot $script:reSnapshot} | Should -Throw '*baseline*' }
    It 'rejects generation in progress' { $script:reSnapshot.Generating=$true; {Select-ReextractionReply -State $script:reState -Snapshot $script:reSnapshot} | Should -Throw '*stopped*' }
    It 'rejects truncated code instead of accepting visible lines' { $script:reSnapshot.Responses[1].Truncated=$true; {Select-ReextractionReply -State $script:reState -Snapshot $script:reSnapshot} | Should -Throw '*truncated*' }
    It 'rejects URL drift' { $script:reSnapshot.Url='https://chatgpt.com/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; {Select-ReextractionReply -State $script:reState -Snapshot $script:reSnapshot} | Should -Throw }
    It 'writes separate immutable reextraction receipts and preserves original evidence' {
        $directory=Join-Path $TestDrive 'completed/sidebar'
        [IO.Directory]::CreateDirectory($directory) | Out-Null
        $thread='12345678-1234-1234-1234-123456789abc'
        $target=[pscustomobject]@{BrowserId='browser-test';ProfileId='profile-test';TabId='123';SessionKey='browser-test:profile-test:123';Url=$script:reUrl;UrlExact=$true}
        $script:reState | Add-Member -NotePropertyMembers @{codexThreadId=$thread;transport=$Script:AgentBrowserTransport;targetBinding=(ConvertTo-AgentBrowserTargetBinding -Target $target)}
        $script:reState | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $directory 'state.json') -Encoding utf8
        $stateText=[IO.File]::ReadAllText((Join-Path $directory 'state.json')).TrimEnd()
        [IO.File]::WriteAllText((Join-Path $directory 'state.json'),$stateText.Substring(0,$stateText.Length-1)+',"completedAtUtc":"2026-10-20T14:15:09.1412604Z"}')
        foreach($name in @('evidence.json','watch-event.json','prompt.md','response.md','url.txt')) {[IO.File]::WriteAllText((Join-Path $directory $name),'original '+$name)}
        $original=@{}
        foreach($file in Get-ChildItem -LiteralPath $directory -File) {$original[$file.Name]=Get-Sha256File -Path $file.FullName}
        Mock Read-EvidenceState {$script:reState}
        Mock Get-CompletedResponseResult {@{completed=$true}}
        Mock Get-AgentBrowserWaitObservation {[pscustomobject]@{Transient=$false;Target=$target;Snapshot=$script:reSnapshot}}
        Mock Invoke-AgentBrowserCliJson {throw 'Reextraction must not fill or click.'}
        $first=Invoke-AgentBrowserReextract -EvidenceDirectory $directory -ThreadId $thread
        $second=Invoke-AgentBrowserReextract -EvidenceDirectory $directory -ThreadId $thread
        $first.receiptFile | Should -Not -Be $second.receiptFile
        $receipt=[IO.File]::ReadAllText($first.receiptFile) | ConvertFrom-Json
        $receipt.originalCompletedAtUtc.ToString() | Should -Not -BeNullOrEmpty
        [IO.File]::ReadAllText($first.receiptFile) | Should -Match '2026-10-20T14:15:09.1412604Z'
        $receipt.thinkingMode | Should -BeExactly 'Pro'
        $receipt.readOnly | Should -BeTrue
        $receipt.newWebRequests | Should -Be 0
        foreach($file in Get-ChildItem -LiteralPath $directory -File) {(Get-Sha256File -Path $file.FullName) | Should -BeExactly $original[$file.Name]}
        [IO.File]::ReadAllText((Join-Path (Split-Path -Parent $first.receiptFile) 'response.md')) | Should -BeExactly 'complete source'
        Should -Invoke Get-CompletedResponseResult -Times 2 -Exactly -ParameterFilter {$CodexThreadIdValue -eq $thread}
        Should -Invoke Invoke-AgentBrowserCliJson -Times 0 -Exactly
    }
    It 'preserves the exact original completion timestamp without locale conversion' {
        $directory=Join-Path $TestDrive 'time';[IO.Directory]::CreateDirectory($directory) | Out-Null
        [IO.File]::WriteAllText((Join-Path $directory 'state.json'),'{"completedAtUtc":"2026-10-20T14:15:09.1412604Z"}')
        Get-ReextractionOriginalTimestamp -EvidenceDirectory $directory | Should -BeExactly '2026-10-20T14:15:09.1412604Z'
    }
}

Describe 'Composer selection and read-only response regression' {
    BeforeEach {
        $script:testUrl='https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        $script:composerCount=1;$script:selectorCount=2;$script:composerSelector='#prompt-textarea'
        $script:target=[pscustomobject]@{BrowserId='browser-test';ProfileId='profile-test';TabId='123';SessionKey='browser-test:profile-test:123';Url=$script:testUrl;UrlExact=$true}
        Mock Invoke-AgentBrowserCliJson {
            param($Arguments)
            if ($Arguments[0] -ne 'exec') { throw 'Only read-only DOM observation is allowed in this regression.' }
            [pscustomobject]@{ok=$true;result=[pscustomobject]@{status='success';tab_id='123';session_key='browser-test:profile-test:123';js_return=(New-RegressionPage)}}
        }
        Mock Resolve-AgentBrowserTarget { $script:target }
    }
    It 'reads a reply despite a hidden duplicate raw selector' {
        $snapshot=Get-AgentBrowserPageSnapshot -Target $script:target -ReadOnly
        Assert-AgentBrowserAuthBarrierAbsent -Snapshot $snapshot -ReadOnly
        $snapshot.Responses[0].Content | Should -Be 'complete reply'
        {Get-AgentBrowserPageSnapshot -Target $script:target} | Should -Throw '*exactly one DOM node*'
    }
    It 'reads a reply without any composer' {
        $script:composerCount=0;$script:selectorCount=0;$script:composerSelector=''
        $snapshot=Get-AgentBrowserPageSnapshot -Target $script:target -ReadOnly
        Assert-AgentBrowserAuthBarrierAbsent -Snapshot $snapshot -ReadOnly
        $snapshot.Responses[0].Content | Should -Be 'complete reply'
        $binding=ConvertTo-AgentBrowserTargetBinding -Target $script:target
        $observation=Get-AgentBrowserWaitObservation -Binding $binding -ExpectedConversationUrl $script:testUrl
        $observation.Responses[0].Content | Should -Be 'complete reply'
        {Assert-AgentBrowserAuthBarrierAbsent -Snapshot $snapshot} | Should -Throw '*No visible*'
    }
    It 'rejects two visible editable composers for sending' {
        $script:composerCount=2;$script:selectorCount=0;$script:composerSelector=''
        $snapshot=Get-AgentBrowserPageSnapshot -Target $script:target
        {Assert-AgentBrowserBaseReady -Snapshot $snapshot} | Should -Throw '*Multiple visible*'
        Should -Invoke Invoke-AgentBrowserCliJson -Times 1 -Exactly -ParameterFilter {$Arguments[0] -eq 'exec'}
    }
    It 'retains exact URL checks on read-only observation' {
        $binding=ConvertTo-AgentBrowserTargetBinding -Target $script:target
        $wrong='https://chatgpt.com/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        {Get-AgentBrowserWaitObservation -Binding $binding -ExpectedConversationUrl $wrong} | Should -Throw
        Should -Invoke Invoke-AgentBrowserCliJson -Times 0 -Exactly -ParameterFilter {$Arguments[0] -in @('fill','click')}
    }
    It 'rejects URL drift after fill before the actual send entrypoint can click' {
        $script:IdempotencyRootOverride=Join-Path $TestDrive 'idempotency'
        $script:TargetClaimRootOverride=Join-Path $TestDrive 'claims'
        $directory=Join-Path $TestDrive 'url-drift'
        [IO.Directory]::CreateDirectory($directory) | Out-Null
        $script:pageCalls=0
        Mock Get-AgentBrowserPageSnapshot {
            $script:pageCalls++
            [pscustomobject]@{
                Url=if($script:pageCalls -eq 1){$script:testUrl}else{'https://chatgpt.com/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}
                UrlExact=$true;ComposerCount=1;ComposerValue=if($script:pageCalls -eq 1){''}else{'draft'};SendCount=if($script:pageCalls -eq 1){0}else{1}
                LoginCount=0;ProCount=1;SelectedModeControlCount=1;SelectedModeLabel='Pro';SelectedModeIsPro=$true
                SecurityChallengeCount=0;Generating=$false;UserTurns=@();Responses=@();Target=$script:target
            }
        }
        Mock Invoke-AgentBrowserCliJson {
            param($Arguments)
            [pscustomobject]@{ok=$true;result=[pscustomobject]@{status='success';tab_id='123';session_key='browser-test:profile-test:123'}}
        }
        try {
            {Invoke-AgentBrowserSend -PromptText 'draft' -EvidenceDirectory $directory -IdempotencyKeyValue 'url-drift-before-click' -CodexThreadIdValue '12345678-1234-1234-1234-123456789abc' -RequireExistingConversation -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $script:target)} | Should -Throw '*address changed*'
            Should -Invoke Invoke-AgentBrowserCliJson -Times 1 -Exactly -ParameterFilter {$Arguments[0] -eq 'fill'}
            Should -Invoke Invoke-AgentBrowserCliJson -Times 0 -Exactly -ParameterFilter {$Arguments[0] -eq 'click'}
        }
        finally {$script:IdempotencyRootOverride=$null;$script:TargetClaimRootOverride=$null}
    }
    It 'accepts bounded structural suffixes and rejects arbitrary selector extensions' {
        $selector=$Script:AgentBrowserComposerFallbackSelector+':is(:root > :nth-child(2) > :nth-child(1))'
        Test-AgentBrowserComposerSelector $selector | Should -BeTrue
        $scope=':is(main, [role="main"]) form:has('+$selector.Replace(':is(main, [role="main"]) form ','')+')'
        $send=$scope+' > button[data-testid="send-button"]:nth-child(1):not(:disabled, [aria-disabled="true"], [hidden], [aria-hidden="true"])'
        Test-AgentBrowserSendSelector -Selector $send -FormScope $scope -ComposerSelector $selector | Should -BeTrue
        foreach($bad in @('#prompt-textarea, textarea','#prompt-textarea:is(:root > :nth-child(0))','#prompt-textarea:is(:root > aside)','#prompt-textarea:focus')) {
            Test-AgentBrowserComposerSelector $bad | Should -BeFalse
        }
    }
    It 'keeps auth barriers on read-only replies' {
        Mock New-RegressionPage {
            [pscustomobject]@{schemaVersion=1;origin='https://chatgpt.com';url=$script:testUrl;composer=[pscustomobject]@{count=0;selector='';selectorMatchCount=0;value=''};send=[pscustomobject]@{count=0;selector='';selectorMatchCount=0;formScope=''};auth=[pscustomobject]@{loginCount=1;challengeCount=0;proIndicatorCount=0};model=[pscustomobject]@{controlCount=0;selectedLabel='';proSelected=$false};generating=$false;userTurns=@();assistantTurns=@()}
        }
        $snapshot=Get-AgentBrowserPageSnapshot -Target $script:target -ReadOnly
        {Assert-AgentBrowserAuthBarrierAbsent -Snapshot $snapshot -ReadOnly} | Should -Throw '*protective security challenge*'
    }
}
