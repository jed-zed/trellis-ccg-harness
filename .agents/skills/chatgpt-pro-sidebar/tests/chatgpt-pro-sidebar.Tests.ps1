#requires -Version 5.1
#requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
# Source encoding: UTF-8 with BOM (required for localized UIA fixture names in Windows PowerShell 5.1).

BeforeAll {
    $scriptPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/chatgpt-pro-sidebar.ps1'
    . $scriptPath

    function New-TestRecord {
        param(
            [string]$Name = '',
            [bool]$IsVisible = $true,
            [bool]$IsEnabled = $true,
            [double]$X = 0,
            [double]$Y = 0,
            [double]$Width = 100,
            [double]$Height = 30,
            [string]$ControlType = '',
            [string]$RuntimeId = ([guid]::NewGuid().ToString('N')),
            [int]$CodexDocumentCount = 0,
            [int]$EmbeddedDocumentCount = 0,
            [int]$ComposerCount = 0,
            [bool]$GeometryMatch = $false,
            $Element = $null
        )

        [pscustomobject]@{
            Name = $Name
            IsVisible = $IsVisible
            IsEnabled = $IsEnabled
            X = $X
            Y = $Y
            Width = $Width
            Height = $Height
            ControlType = $ControlType
            Area = $Width * $Height
            RuntimeId = $RuntimeId
            CodexDocumentCount = $CodexDocumentCount
            EmbeddedDocumentCount = $EmbeddedDocumentCount
            ComposerCount = $ComposerCount
            GeometryMatch = $GeometryMatch
            Element = $Element
        }
    }

    function Assert-ThrowsCategory {
        param(
            [Parameter(Mandatory = $true)][scriptblock]$Action,
            [Parameter(Mandatory = $true)][string]$Category,
            [int]$ExitCode = -1
        )

        $caught = $null
        try {
            & $Action
        }
        catch {
            $caught = $_.Exception
        }

        $caught | Should -Not -BeNullOrEmpty
        (Get-ExceptionCategory -Exception $caught) | Should -Be $Category
        if ($ExitCode -ge 0) {
            (Get-ExceptionExitCode -Exception $caught) | Should -Be $ExitCode
        }
    }

    function New-TestResponse {
        param(
            [Parameter(Mandatory = $true)][string]$Text,
            [int]$Ordinal = 0
        )

        [pscustomobject]@{
            Ordinal = $Ordinal
            Content = $Text
            ContentSha256 = Get-Sha256Text -Text $Text
        }
    }
}

Describe 'Codex top-level window selection' {
    It 'fails closed when no Codex window exists' {
        Assert-ThrowsCategory -Category 'CodexWindowMissing' -ExitCode 20 -Action {
            Select-CodexWindowRecord -Records @()
        }
    }

    It 'fails closed when multiple Codex windows exist' {
        $records = @(
            (New-TestRecord -CodexDocumentCount 1)
            (New-TestRecord -CodexDocumentCount 1)
        )
        Assert-ThrowsCategory -Category 'CodexWindowAmbiguous' -ExitCode 20 -Action {
            Select-CodexWindowRecord -Records $records
        }
    }

    It 'selects the focused Codex window when multiple candidates exist' {
        $selected = Select-CodexWindowRecord -Records @(
            (New-TestRecord -CodexDocumentCount 1 -RuntimeId '42.100')
            (New-TestRecord -CodexDocumentCount 1 -RuntimeId '42.200')
        ) -FocusedTopLevelRuntimeId '42.200'
        $selected.RuntimeId | Should -Be '42.200'
    }

    It 'selects the only Codex window exposing an embedded browser document' {
        $selected = Select-CodexWindowRecord -Records @(
            (New-TestRecord -CodexDocumentCount 1 -EmbeddedDocumentCount 0 -RuntimeId '42.100')
            (New-TestRecord -CodexDocumentCount 1 -EmbeddedDocumentCount 2 -RuntimeId '42.200')
        ) -FocusedTopLevelRuntimeId '42.100'
        $selected.RuntimeId | Should -Be '42.200'
    }

    It 'uses focus only among multiple browser-bearing Codex windows' {
        $selected = Select-CodexWindowRecord -Records @(
            (New-TestRecord -CodexDocumentCount 1 -EmbeddedDocumentCount 0 -RuntimeId '42.100')
            (New-TestRecord -CodexDocumentCount 1 -EmbeddedDocumentCount 2 -RuntimeId '42.200')
            (New-TestRecord -CodexDocumentCount 1 -EmbeddedDocumentCount 1 -RuntimeId '42.300')
        ) -FocusedTopLevelRuntimeId '42.300'
        $selected.RuntimeId | Should -Be '42.300'
    }

    It 'selects only an explicitly bound Codex window' {
        $selected = Select-CodexWindowRecord -Records @(
            (New-TestRecord -CodexDocumentCount 1 -RuntimeId '42.100')
            (New-TestRecord -CodexDocumentCount 1 -RuntimeId '42.200')
        ) -TargetRuntimeId '42.100' -FocusedTopLevelRuntimeId '42.200'
        $selected.RuntimeId | Should -Be '42.100'
    }

    It 'fails closed when an explicitly bound Codex window disappeared' {
        Assert-ThrowsCategory -Category 'CodexWindowTargetMissing' -ExitCode 20 -Action {
            Select-CodexWindowRecord -Records @(
                (New-TestRecord -CodexDocumentCount 1 -RuntimeId '42.100')
            ) -TargetRuntimeId '42.999'
        }
    }

    It 'selects only the window containing exactly one Codex document' {
        $expected = New-TestRecord -CodexDocumentCount 1 -RuntimeId 'expected'
        $selected = Select-CodexWindowRecord -Records @(
            (New-TestRecord -CodexDocumentCount 0)
            $expected
            (New-TestRecord -CodexDocumentCount 0)
        )
        $selected.RuntimeId | Should -Be 'expected'
    }

    It 'ignores hidden candidates and does not depend on a process name' {
        $expected = New-TestRecord -CodexDocumentCount 1 -RuntimeId 'arbitrary-process'
        $expected | Add-Member -NotePropertyName ProcessName -NotePropertyValue 'Anything.exe'
        $selected = Select-CodexWindowRecord -Records @(
            (New-TestRecord -CodexDocumentCount 1 -IsVisible:$false -RuntimeId 'hidden')
            $expected
        )
        $selected.RuntimeId | Should -Be 'arbitrary-process'
    }
}

Describe 'Dynamic embedded document scoping' {
    It 'does not depend on the embedded document title' {
        $selected = Select-EmbeddedDocumentRecord -Records @(
            [pscustomobject]@{ Name = '任意动态会话标题'; IsVisible = $true; ComposerCount = 1; GeometryMatch = $true; RuntimeId = 'dynamic' },
            [pscustomobject]@{ Name = 'Other document'; IsVisible = $true; ComposerCount = 0; GeometryMatch = $false; RuntimeId = 'other' }
        )
        $selected.RuntimeId | Should -Be 'dynamic'
    }

    It 'uses bounded address geometry when the login page has no composer' {
        $selected = Select-EmbeddedDocumentRecord -Records @(
            [pscustomobject]@{ Name = 'Login'; IsVisible = $true; ComposerCount = 0; GeometryMatch = $true; RuntimeId = 'login-doc' }
        )
        $selected.RuntimeId | Should -Be 'login-doc'
    }

    It 'fails when the embedded document is missing' {
        Assert-ThrowsCategory -Category 'EmbeddedDocumentMissing' -ExitCode 21 -Action {
            Select-EmbeddedDocumentRecord -Records @(
                [pscustomobject]@{ Name = 'Hidden'; IsVisible = $false; ComposerCount = 1; GeometryMatch = $false }
            )
        }
    }

    It 'fails when multiple semantic documents contain composers' {
        Assert-ThrowsCategory -Category 'EmbeddedDocumentAmbiguous' -ExitCode 21 -Action {
            Select-EmbeddedDocumentRecord -Records @(
                [pscustomobject]@{ Name = 'A'; IsVisible = $true; ComposerCount = 1; GeometryMatch = $true },
                [pscustomobject]@{ Name = 'B'; IsVisible = $true; ComposerCount = 1; GeometryMatch = $true }
            )
        }
    }

    It 'fails when geometry matches more than one composer-less document' {
        Assert-ThrowsCategory -Category 'EmbeddedDocumentAmbiguous' -ExitCode 21 -Action {
            Select-EmbeddedDocumentRecord -Records @(
                [pscustomobject]@{ Name = 'Login A'; IsVisible = $true; ComposerCount = 0; GeometryMatch = $true },
                [pscustomobject]@{ Name = 'Login B'; IsVisible = $true; ComposerCount = 0; GeometryMatch = $true }
            )
        }
    }
}

Describe 'Localized control names and geometry' {
    It 'treats the current composer placeholder as an empty editor' {
        (Test-ComposerValueEmpty -Value '问问 ChatGPT') | Should -BeTrue
        (Test-ComposerValueEmpty -Value '') | Should -BeTrue
        (Test-ComposerValueEmpty -Value 'actual prompt') | Should -BeFalse
    }

    It 'fails when localized composer fallbacks match two different controls' {
        $records = @(
            (New-TestRecord -Name '与 ChatGPT 聊天' -RuntimeId 'zh')
            (New-TestRecord -Name 'Message ChatGPT' -RuntimeId 'en')
        )
        Assert-ThrowsCategory -Category 'ComposerAmbiguous' -ExitCode 23 -Action {
            Select-UniqueControlRecord -Records $records -Label 'Composer'
        }
    }

    It 'distinguishes a missing localized control from ambiguity' {
        Assert-ThrowsCategory -Category 'SendMissing' -ExitCode 23 -Action {
            Select-UniqueControlRecord -Records @() -Label 'Send'
        }
    }

    It 'selects the wide New chat link over the compact duplicate' {
        $wide = New-TestRecord -Name '新聊天' -Width 233 -Height 36 -RuntimeId 'wide'
        $compact = New-TestRecord -Name '新聊天' -Width 34 -Height 34 -RuntimeId 'compact'
        (Select-NewChatRecord -Records @($compact, $wide)).RuntimeId | Should -Be 'wide'
    }

    It 'fails when duplicate New chat controls have indistinguishable geometry' {
        Assert-ThrowsCategory -Category 'NewChatAmbiguous' -ExitCode 23 -Action {
            Select-NewChatRecord -Records @(
                (New-TestRecord -Name '新聊天' -Width 100 -Height 30 -RuntimeId 'a')
                (New-TestRecord -Name '新聊天' -Width 100 -Height 30 -RuntimeId 'b')
            )
        }
    }

    It 'requires a unique composer and send control' {
        Assert-ThrowsCategory -Category 'ComposerOrSendAmbiguous' -ExitCode 23 -Action {
            Assert-SendPreconditions -Snapshot ([pscustomobject]@{
                Generating = $false
                ComposerCount = 1
                SendCount = 2
                ComposerSha256 = 'abc'
            }) -ExpectedPromptSha256 'abc'
        }
    }
}

Describe 'Sidebar hidden recovery orchestration' {
    BeforeEach {
        Mock Start-Sleep {}
        $script:addressCall = 0
        $script:panelActions = @()

        Mock Get-LiveCodexWindow { [pscustomobject]@{ Element = 'window' } }
        Mock Get-LiveAddressRecords {
            $script:addressCall++
            if ($script:addressCall -ge 4) {
                return @(New-TestRecord -Name '输入 URL')
            }
            return @()
        }
        Mock Find-LiveElementsByNames {
            param($Root, $ControlTypes, $Names, $Scope)
            if ($Names -contains '显示/隐藏侧边栏') {
                return @(New-TestRecord -Name '显示/隐藏侧边栏' -Element 'sidebar')
            }
            if ($Names -contains '展开面板') {
                return @(New-TestRecord -Name '展开面板' -Element 'expand')
            }
            if ($Names -contains '浏览器 Ctrl+T') {
                return @(New-TestRecord -Name '浏览器 Ctrl+T' -Element 'browser')
            }
            return @()
        }
        Mock Invoke-PanelControlPreservingFocus {
            param($Record, $Mode, $WindowElement)
            $script:panelActions += [pscustomobject]@{ Element = $Record.Element; Mode = $Mode }
        }
    }

    It 'toggles the sidebar, expands the panel, selects Browser, and then re-queries' {
        # The function is Windows-only because its production body references UIA control types.
        if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
            Set-ItResult -Skipped -Because 'The Skill runtime and panel controls are Windows-only.'
            return
        }
        $null = Add-Type -AssemblyName UIAutomationClient
        $null = Add-Type -AssemblyName UIAutomationTypes

        (Ensure-LiveBrowserPanel) | Should -BeTrue
        $script:panelActions.Count | Should -Be 3
        $script:panelActions[0].Mode | Should -Be 'toggle-on'
        $script:panelActions[1].Element | Should -Be 'expand'
        $script:panelActions[2].Element | Should -Be 'browser'
        ($script:addressCall -ge 4) | Should -BeTrue
    }
}

Describe 'Authentication and protective barriers' {
    It 'accepts the Pro button inside a tall composer rectangle' {
        $composer = New-TestRecord -X 1150 -Y 518 -Width 504 -Height 303 -ControlType 'ControlType.Edit'
        $proButton = New-TestRecord -Name 'Pro' -X 1520 -Y 776 -Width 70 -Height 37 -ControlType 'ControlType.Button'
        $document = New-TestRecord -X 856 -Y 122 -Width 857 -Height 910 -ControlType 'ControlType.Document'

        (Test-LiveProIndicatorRecord -Record $proButton -ComposerAnchor $composer -DocumentRectangle $document) | Should -BeTrue
    }

    It 'rejects a Pro button outside the composer rectangle' {
        $composer = New-TestRecord -X 1150 -Y 518 -Width 504 -Height 303 -ControlType 'ControlType.Edit'
        $proButton = New-TestRecord -Name 'Pro' -X 900 -Y 900 -Width 70 -Height 37 -ControlType 'ControlType.Button'
        $document = New-TestRecord -X 856 -Y 122 -Width 857 -Height 910 -ControlType 'ControlType.Document'

        (Test-LiveProIndicatorRecord -Record $proButton -ComposerAnchor $composer -DocumentRectangle $document) | Should -BeFalse
    }

    It 'rejects lower-page Pro text that is not a model-state indicator' {
        $composer = New-TestRecord -X 1150 -Y 518 -Width 504 -Height 303 -ControlType 'ControlType.Edit'
        $proText = New-TestRecord -Name 'Pro' -X 904 -Y 1000 -Width 20 -Height 16 -ControlType 'ControlType.Text'
        $document = New-TestRecord -X 856 -Y 122 -Width 857 -Height 910 -ControlType 'ControlType.Document'

        (Test-LiveProIndicatorRecord -Record $proText -ComposerAnchor $composer -DocumentRectangle $document) | Should -BeFalse
    }

    It 'stops at a visible login action' {
        Assert-ThrowsCategory -Category 'AuthenticationOrSecurityChallenge' -ExitCode 22 -Action {
            Assert-AuthReadySnapshot -Snapshot ([pscustomobject]@{
                LoginCount = 1; ProCount = 0; SecurityChallengeCount = 0; ComposerCount = 0
            })
        }
    }

    It 'stops at a security challenge without inspecting its secret value' {
        Assert-ThrowsCategory -Category 'AuthenticationOrSecurityChallenge' -ExitCode 22 -Action {
            Assert-AuthReadySnapshot -Snapshot ([pscustomobject]@{
                LoginCount = 0; ProCount = 1; SecurityChallengeCount = 1; ComposerCount = 1
            })
        }
    }

    It 'fails when Pro state is not visible' {
        Assert-ThrowsCategory -Category 'ProStateMissing' -ExitCode 22 -Action {
            Assert-AuthReadySnapshot -Snapshot ([pscustomobject]@{
                LoginCount = 0; ProCount = 0; SecurityChallengeCount = 0; ComposerCount = 1
            })
        }
    }

    It 'fails closed when the composer is missing after authentication checks' {
        Assert-ThrowsCategory -Category 'ComposerMissing' -ExitCode 23 -Action {
            Assert-AuthReadySnapshot -Snapshot ([pscustomobject]@{
                LoginCount = 0; ProCount = 1; SecurityChallengeCount = 0; ComposerCount = 0
            })
        }
    }

    It 'fails closed when more than one composer is visible' {
        Assert-ThrowsCategory -Category 'ComposerAmbiguous' -ExitCode 23 -Action {
            Assert-AuthReadySnapshot -Snapshot ([pscustomobject]@{
                LoginCount = 0; ProCount = 1; SecurityChallengeCount = 0; ComposerCount = 2
            })
        }
    }

    It 'recognizes bounded security barrier names without reading secret values' {
        (Test-SecurityAccessibleName -Name 'Verify you are human') | Should -BeTrue
        (Test-SecurityAccessibleName -Name '请输入验证码') | Should -BeTrue
        (Test-SecurityAccessibleName -Name 'ordinary engineering discussion') | Should -BeFalse
    }

}

Describe 'Exactly-once and active-generation guards' {
    It 'blocks send while generation is active' {
        Assert-ThrowsCategory -Category 'GenerationAlreadyActive' -ExitCode 24 -Action {
            Assert-SendPreconditions -Snapshot ([pscustomobject]@{
                Generating = $true
                ComposerCount = 1
                SendCount = 1
                ComposerSha256 = 'abc'
            }) -ExpectedPromptSha256 'abc'
        }
    }

    It 'blocks a mismatched composer hash before send intent' {
        Assert-ThrowsCategory -Category 'ComposerVerificationFailed' -ExitCode 23 -Action {
            Assert-SendPreconditions -Snapshot ([pscustomobject]@{
                Generating = $false
                ComposerCount = 1
                SendCount = 1
                ComposerSha256 = 'wrong'
            }) -ExpectedPromptSha256 'expected'
        }
    }

    It 'persists a send-intent phase that blocks automatic retry' {
        $state = New-SendIntentState -PromptSha256 ('a' * 64) -IdempotencyKeyValue 'task-round-1' -BaselineHashes @('old')
        $state.phase | Should -Be 'send-intent'
        Assert-ThrowsCategory -Category 'DuplicateSubmissionBlocked' -ExitCode 25 -Action {
            Assert-IdempotencyAvailable -ExistingState $state -IdempotencyKey 'task-round-1'
        }
    }

    It 'binds a direct follow-up send to its exact pre-send conversation URL' {
        $url = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        $state = New-SendIntentState -PromptSha256 ('c' * 64) -IdempotencyKeyValue 'follow-up' -BaselineHashes @() -ConversationUrlBeforeSend $url
        (Get-BoundConversationUrlFromState -State $state) | Should -Be $url
    }

    It 'prohibits response extraction from an unbound fresh send state' {
        $state = New-SendIntentState -PromptSha256 ('d' * 64) -IdempotencyKeyValue 'fresh-unbound' -BaselineHashes @()
        Assert-ThrowsCategory -Category 'ConversationUrlUnbound' -ExitCode 29 -Action {
            Get-BoundConversationUrlFromState -State $state
        }
    }

    It 'recovers a durably persisted exact URL while phase remains send-intent' {
        $directory = Join-Path $TestDrive 'bound-send-intent'
        $null = New-Item -ItemType Directory -Path $directory
        $url = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        $state = New-SendIntentState -PromptSha256 ('e' * 64) -IdempotencyKeyValue 'bound-intent' -BaselineHashes @()
        Set-ObjectProperty -InputObject $state -Name 'conversationUrlBound' -Value $url
        Set-ObjectProperty -InputObject $state -Name 'conversationUrlBoundAtUtc' -Value '2026-07-28T00:00:00.0000000Z'
        Write-EvidenceState -Directory $directory -State $state

        $loaded = Read-EvidenceState -Directory $directory
        $loaded.phase | Should -Be 'send-intent'
        (Get-BoundConversationUrlFromState -State $loaded) | Should -Be $url
    }

    It 'can bind an exact URL for read-only recovery after an uncertain fresh attempt' {
        $state = New-SendIntentState -PromptSha256 ('e' * 64) -IdempotencyKeyValue 'uncertain-fresh' -BaselineHashes @()
        Mock Resolve-LiveContext { [pscustomobject]@{} }
        Mock Get-LiveAuthSnapshot {
            [pscustomobject]@{ LoginCount = 0; ProCount = 1; SecurityChallengeCount = 0; ComposerCount = 1 }
        }
        Mock Get-LiveUrlState {
            [pscustomobject]@{ Url = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'; Exact = $true }
        }

        (Try-BindLiveConversationUrl -State $state -TimeoutSecondsValue 1) | Should -Be 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        $state.conversationUrlBound | Should -Be 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
    }

    It 'rejects reuse of one evidence directory with a different key' {
        $state = New-SendIntentState -PromptSha256 ('b' * 64) -IdempotencyKeyValue 'task-round-1' -BaselineHashes @()
        Assert-ThrowsCategory -Category 'EvidenceDirectoryConflict' -ExitCode 30 -Action {
            Assert-IdempotencyAvailable -ExistingState $state -IdempotencyKey 'task-round-2'
        }
    }

    It 'does not observationally wait after a definite pre-invoke failure' {
        $directory = Join-Path $TestDrive 'pre-invoke-failed'
        $null = New-Item -ItemType Directory -Path $directory
        $state = New-SendIntentState -PromptSha256 ('f' * 64) -IdempotencyKeyValue 'pre-invoke-failed' -BaselineHashes @() -ConversationUrlBeforeSend 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'pre-invoke-failed'
        Set-ObjectProperty -InputObject $state -Name 'invokeAttempted' -Value $false
        Write-EvidenceState -Directory $directory -State $state

        Assert-ThrowsCategory -Category 'SendStateNotWaitable' -ExitCode 26 -Action {
            Invoke-LiveWait -EvidenceDirectory $directory -TimeoutSecondsValue 5 -PollMillisecondsValue 250
        }
    }

    It 'classifies only bounded ordinary rerender failures as transient' {
        (Test-TransientUiCategory -Category 'EmbeddedDocumentMissing') | Should -BeTrue
        (Test-TransientUiCategory -Category 'ComposerMissing') | Should -BeTrue
        (Test-TransientUiCategory -Category 'ComposerAmbiguous') | Should -BeFalse
        (Test-TransientUiCategory -Category 'AuthenticationOrSecurityChallenge') | Should -BeFalse
    }
}

Describe 'Idempotency key admission' {
    It 'canonicalizes terminal file newlines to the value exposed by UIA' {
        $promptPath = Join-Path $TestDrive 'prompt-with-terminal-newline.md'
        [System.IO.File]::WriteAllText($promptPath, "line one`nline two`n", $Script:Utf8NoBom)
        (Read-PromptInput -PromptPathValue $promptPath -PromptValue '') | Should -Be "line one`nline two"
    }

    It 'requires an explicit idempotency key' {
        Assert-ThrowsCategory -Category 'IdempotencyKeyRequired' -ExitCode 31 -Action {
            Resolve-IdempotencyKey -Value ''
        }
    }

    It 'accepts only bounded opaque key characters' {
        (Resolve-IdempotencyKey -Value 'trellis-task-42:round-1') | Should -Be 'trellis-task-42:round-1'
        Assert-ThrowsCategory -Category 'IdempotencyKeyInvalid' -ExitCode 31 -Action {
            Resolve-IdempotencyKey -Value 'contains secret whitespace'
        }
    }
}

Describe 'Global durable idempotency' {
    BeforeEach {
        $script:IdempotencyRootOverride = Join-Path $TestDrive 'global-idempotency'
        if ([System.IO.Directory]::Exists($script:IdempotencyRootOverride)) {
            [System.IO.Directory]::Delete($script:IdempotencyRootOverride, $true)
        }
        $null = [System.IO.Directory]::CreateDirectory($script:IdempotencyRootOverride)
    }

    AfterEach {
        $script:IdempotencyRootOverride = $null
    }

    It 'blocks the same key across otherwise independent evidence directories' {
        $first = Reserve-GlobalIdempotencyKey -IdempotencyKeyValue 'task-42-round-1' -PromptSha256 ('a' * 64)
        $first.KeySha256 | Should -Be (Get-Sha256Text -Text 'task-42-round-1')

        Assert-ThrowsCategory -Category 'GlobalDuplicateSubmissionBlocked' -ExitCode 25 -Action {
            Reserve-GlobalIdempotencyKey -IdempotencyKeyValue 'task-42-round-1' -PromptSha256 ('a' * 64)
        }
    }

    It 'detects an existing reservation without mutating UI state' {
        $null = Reserve-GlobalIdempotencyKey -IdempotencyKeyValue 'task-43-round-1' -PromptSha256 ('c' * 64)
        Assert-ThrowsCategory -Category 'GlobalDuplicateSubmissionBlocked' -ExitCode 25 -Action {
            Assert-GlobalIdempotencyKeyAvailable -IdempotencyKeyValue 'task-43-round-1'
        }
    }

    It 'reports a new key as available without creating a reservation file' {
        (Assert-GlobalIdempotencyKeyAvailable -IdempotencyKeyValue 'task-44-round-1') | Should -Be (Get-Sha256Text -Text 'task-44-round-1')
        if ([System.IO.Directory]::Exists($script:IdempotencyRootOverride)) {
            @([System.IO.Directory]::GetFiles($script:IdempotencyRootOverride, '*.json')).Count | Should -Be 0
        }
    }

    It 'stores only hashes and timestamps, not the plaintext idempotency key or prompt' {
        $null = Reserve-GlobalIdempotencyKey -IdempotencyKeyValue 'opaque-private-task-key' -PromptSha256 ('b' * 64)
        $files = @([System.IO.Directory]::GetFiles($script:IdempotencyRootOverride, '*.json'))
        $files.Count | Should -Be 1
        $text = [System.IO.File]::ReadAllText($files[0], $Script:Utf8NoBom)
        $text | Should -Not -Match 'opaque-private-task-key'
        $text | Should -Not -Match 'actual prompt text'
        $text | Should -Match 'idempotencyKeySha256'
        $text | Should -Match 'promptSha256'
    }
}

Describe 'Bounded waiting and stale UI recovery' {
    It 'does not busy-loop and times out with a categorized error' {
        $script:clock = [DateTime]'2026-07-28T00:00:00Z'
        $script:sleeps = 0
        Assert-ThrowsCategory -Category 'ResponseTimeout' -ExitCode 27 -Action {
            $waitArguments = @{
                BaselineHashes = @()
                ObservationProvider = { [pscustomobject]@{ Transient = $false; Generating = $false; Responses = @() } }
                SleepAction = { param($milliseconds) $script:sleeps++; $script:clock = $script:clock.AddMilliseconds($milliseconds) }
                UtcNowProvider = { $script:clock }
                TimeoutSeconds = 1
                PollMilliseconds = 250
            }
            Invoke-PollUntilCompleted @waitArguments
        }
        ($script:sleeps -gt 0) | Should -BeTrue
        ($script:sleeps -le 4) | Should -BeTrue
    }

    It 'recovers from a stale/rerendered observation and requires 1.5 seconds of stable idle output' {
        $response = New-TestResponse -Text 'done'
        $script:observations = 0
        $script:clock = [DateTime]'2026-07-28T00:00:00Z'
        $waitArguments = @{
            BaselineHashes = @()
            ObservationProvider = {
                $script:observations++
                if ($script:observations -eq 1) {
                    return [pscustomobject]@{ Transient = $true; Generating = $false; Responses = @() }
                }
                return [pscustomobject]@{ Transient = $false; Generating = $false; Responses = @($response) }
            }
            SleepAction = { param($milliseconds) $script:clock = $script:clock.AddMilliseconds($milliseconds) }
            UtcNowProvider = { $script:clock }
            TimeoutSeconds = 5
            PollMilliseconds = 250
        }
        $result = Invoke-PollUntilCompleted @waitArguments

        $result.Response.Content | Should -Be 'done'
        $result.TransientObservationCount | Should -Be 1
        $script:observations | Should -Be 8
        $result.StablePollCount | Should -Be 7
    }
}

Describe 'Latest assistant response isolation' {
    It 'matches agent-turn as an exact class-name token only' {
        (Test-ClassNameToken -ClassName '[--thread-content-max-width:40rem] agent-turn relative' -Token 'agent-turn') | Should -BeTrue
        (Test-ClassNameToken -ClassName 'agent-turnish relative' -Token 'agent-turn') | Should -BeFalse
        (Test-ClassNameToken -ClassName '' -Token 'agent-turn') | Should -BeFalse
    }

    It 'returns only one response appended after the ordered baseline' {
        $oldA = New-TestResponse -Text 'old-a' -Ordinal 0
        $oldB = New-TestResponse -Text 'old-b' -Ordinal 1
        $new = New-TestResponse -Text 'new-only' -Ordinal 2
        $comparisonArguments = @{
            BaselineHashes = @($oldA.ContentSha256, $oldB.ContentSha256)
            CurrentResponses = @($oldA, $oldB, $new)
        }
        $comparison = Compare-ResponseBaseline @comparisonArguments
        $comparison.Status | Should -Be 'one'
        $comparison.NewResponse.Content | Should -Be 'new-only'
    }

    It 'rejects a changed prior response list' {
        $old = New-TestResponse -Text 'old'
        $changed = New-TestResponse -Text 'changed'
        Assert-ThrowsCategory -Category 'ResponseBaselineMismatch' -ExitCode 28 -Action {
            Compare-ResponseBaseline -BaselineHashes @($old.ContentSha256) -CurrentResponses @($changed)
        }
    }

    It 'rejects more than one new assistant response after one send' {
        Assert-ThrowsCategory -Category 'MultipleNewResponses' -ExitCode 28 -Action {
            Compare-ResponseBaseline -BaselineHashes @() -CurrentResponses @(
                (New-TestResponse -Text 'one' -Ordinal 0)
                (New-TestResponse -Text 'two' -Ordinal 1)
            )
        }
    }
}

Describe 'Bounded assistant text assembly' {
    It 'preserves identical response lines at different geometry while removing duplicate UIA records' {
        $records = @(
            (New-TestRecord -Name 'same line' -X 10 -Y 100 -Width 80 -Height 20 -RuntimeId 'a')
            (New-TestRecord -Name 'same line' -X 10 -Y 100 -Width 80 -Height 20 -RuntimeId 'duplicate-a')
            (New-TestRecord -Name 'same line' -X 10 -Y 130 -Width 80 -Height 20 -RuntimeId 'b')
            (New-TestRecord -Name '复制回复' -X 10 -Y 160 -Width 80 -Height 20 -RuntimeId 'action')
        )

        (Join-ResponseTextRecords -Records $records -CopyAnchorY 180) | Should -Be ("same line{0}same line" -f [Environment]::NewLine)
    }

    It 'preserves UIA tree order for semantic response records' {
        $records = @(
            (New-TestRecord -Name 'first' -Y 200 -RuntimeId '1')
            (New-TestRecord -Name 'second' -Y 100 -RuntimeId '2')
        )
        (Join-ResponseTextRecords -Records $records -CopyAnchorY 0 -PreserveInputOrder) | Should -Be ("first{0}second" -f [Environment]::NewLine)
    }

    It 'rejects response text above the bounded character limit' {
        Assert-ThrowsCategory -Category 'ResponseTextLimitExceeded' -ExitCode 28 -Action {
            Join-ResponseTextRecords -Records @(
                (New-TestRecord -Name '12345' -X 10 -Y 100 -Width 80 -Height 20)
                (New-TestRecord -Name '67890' -X 10 -Y 130 -Width 80 -Height 20)
            ) -CopyAnchorY 180 -MaximumCharacters 8
        }
    }
}

Describe 'Exact URL fallback and sanitization' {
    It 're-reads the address after focus before considering keyboard fallback' {
        $script:urlReadCount = 0
        $addressElement = [pscustomobject]@{}
        $addressElement | Add-Member -MemberType ScriptMethod -Name SetFocus -Value { }
        $context = [pscustomobject]@{
            Address = [pscustomobject]@{ Element = $addressElement }
            Window = [pscustomobject]@{ Element = 'window' }
        }

        Mock Get-LiveFocusState { [pscustomobject]@{ Element = $null; TopLevelRuntimeId = 'original' } }
        Mock Get-AutomationRuntimeIdText { 'codex' }
        Mock Resolve-LiveContext { $context }
        Mock Restore-FocusState { $true }
        Mock Start-Sleep { }
        Mock Read-LiveElementText {
            $script:urlReadCount++
            if ($script:urlReadCount -eq 1) {
                return 'https://chatgpt.com/'
            }
            return 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        }

        $result = Get-LiveUrlState -Context $context
        $result.Exact | Should -BeTrue
        $result.Url | Should -Be 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        $script:urlReadCount | Should -Be 2
        Should -Invoke Restore-FocusState -Times 1 -Exactly
    }

    It 'uses the focused exact conversation URL after an origin-only value' {
        $resolved = Resolve-SanitizedUrlFromCandidates -Candidates @(
            'https://chatgpt.com/',
            'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc?utm_source=secret#fragment'
        )
        $resolved.Exact | Should -BeTrue
        $resolved.Url | Should -Be 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
    }

    It 'rejects non-ChatGPT hosts rather than logging them' {
        (ConvertTo-SanitizedChatGptUrl -Candidate 'https://example.com/c/secret') | Should -BeNullOrEmpty
        (ConvertTo-SanitizedChatGptUrl -Candidate 'https://evil.chatgpt.com/c/secret') | Should -BeNullOrEmpty
    }


    It 'rejects non-default ports and non-conversation path lookalikes' {
        (ConvertTo-SanitizedChatGptUrl -Candidate 'https://chatgpt.com:444/c/12345678-1234-1234-1234-123456789abc') | Should -BeNullOrEmpty
        $short = ConvertTo-SanitizedChatGptUrl -Candidate 'https://chatgpt.com/c/abc'
        $short.Exact | Should -BeFalse
        $short.AllowedForChat | Should -BeFalse
    }

    It 'requires a canonical ChatGPT origin before any action' {
        Assert-ThrowsCategory -Category 'ChatGptOriginUnproved' -ExitCode 29 -Action {
            Assert-ChatGptUrlState -UrlState ([pscustomobject]@{ Url = $null; Exact = $false })
        }
    }

    It 'rejects an existing exact URL when a fresh conversation is required' {
        Assert-ThrowsCategory -Category 'FreshConversationUnproved' -ExitCode 28 -Action {
            Assert-ChatGptUrlState -UrlState ([pscustomobject]@{
                Url = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
                Exact = $true
            }) -RequireFreshConversation
        }
    }

    It 'requires an exact existing conversation URL for a follow-up send' {
        Assert-ThrowsCategory -Category 'ExistingConversationUnproved' -ExitCode 29 -Action {
            Assert-ChatGptUrlState -UrlState ([pscustomobject]@{
                Url = 'https://chatgpt.com/'
                Exact = $false
            }) -RequireExistingConversation
        }
    }

    It 'accepts a fresh root only for an explicitly fresh send mode' {
        { Assert-ChatGptUrlState -UrlState ([pscustomobject]@{
            Url = 'https://chatgpt.com/'
            Exact = $false
        }) -RequireFreshConversation } | Should -Not -Throw

        $source = [System.IO.File]::ReadAllText($scriptPath)
        $source | Should -Match '\[switch\]\$FreshConversation'
        $source | Should -Match '-RequireFreshConversation:\$FreshConversation'
        $source | Should -Match '-RequireExistingConversation:\(-not \$FreshConversation\)'
    }

    It 'accepts one canonical exact conversation URL for a follow-up send' {
        {
            Assert-ChatGptUrlState -UrlState ([pscustomobject]@{
                Url = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
                Exact = $true
            }) -RequireExistingConversation
        } | Should -Not -Throw
    }

    It 'rejects a pre-send URL change before invoking Send' {
        Assert-ThrowsCategory -Category 'PreSendConversationChanged' -ExitCode 28 -Action {
            Assert-PreSendUrlInvariant -InitialUrlState ([pscustomobject]@{
                Url = 'https://chatgpt.com/'
                Exact = $false
            }) -CurrentUrlState ([pscustomobject]@{
                Url = 'https://chatgpt.com/g/g-other'
                Exact = $false
            }) -RequireFreshConversation
        }
    }

    It 'binds later rounds to the same exact conversation URL' {
        Assert-ThrowsCategory -Category 'ConversationUrlChanged' -ExitCode 28 -Action {
            Assert-ConversationUrlMatch -ExpectedUrl 'https://chatgpt.com/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' -ActualUrl 'https://chatgpt.com/c/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
        }
    }
}

Describe 'Focus and clipboard safety' {
    It 'restores focus only while automation still owns the UIA top-level focus' {
        (Test-FocusRestoreAllowed -OriginalTopLevelRuntimeId 'original' -CurrentTopLevelRuntimeId 'codex' -ExpectedAutomationTopLevelRuntimeId 'codex') | Should -BeTrue
        (Test-FocusRestoreAllowed -OriginalTopLevelRuntimeId 'original' -CurrentTopLevelRuntimeId 'third-app' -ExpectedAutomationTopLevelRuntimeId 'codex') | Should -BeFalse
    }

    It 'allows restoration when focus never left the original top-level UIA element' {
        (Test-FocusRestoreAllowed -OriginalTopLevelRuntimeId 'original' -CurrentTopLevelRuntimeId 'original' -ExpectedAutomationTopLevelRuntimeId 'codex') | Should -BeTrue
    }

    It 'does not restore when any required UIA runtime identity is unknown' {
        (Test-FocusRestoreAllowed -OriginalTopLevelRuntimeId '' -CurrentTopLevelRuntimeId 'codex' -ExpectedAutomationTopLevelRuntimeId 'codex') | Should -BeFalse
        (Test-FocusRestoreAllowed -OriginalTopLevelRuntimeId 'original' -CurrentTopLevelRuntimeId '' -ExpectedAutomationTopLevelRuntimeId 'codex') | Should -BeFalse
        (Test-FocusRestoreAllowed -OriginalTopLevelRuntimeId 'original' -CurrentTopLevelRuntimeId 'original' -ExpectedAutomationTopLevelRuntimeId '') | Should -BeFalse
    }
}

Describe 'Bounded and redacted status output' {
    It 'omits dynamic titles, full UI trees, prompts, and URL query data' {
        $safeUrl = Resolve-SanitizedUrlFromCandidates -Candidates @('https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc?token=do-not-log')
        $payload = New-BoundedStatusPayload -Snapshot ([pscustomobject]@{
            CodexWindowCount = 1
            EmbeddedDocumentCount = 1
            AddressCount = 1
            ComposerCount = 1
            LoginCount = 0
            ProCount = 1
            SecurityChallengeCount = 0
            Generating = $false
            PanelRecovered = $false
            Url = $safeUrl.Url
            UrlExact = $safeUrl.Exact
            DynamicTitle = 'unrelated private conversation title'
            UiTree = 'password and unrelated task text'
            Prompt = 'secret prompt'
        })
        $json = $payload | ConvertTo-Json -Depth 8 -Compress
        $json | Should -Not -Match 'unrelated private conversation title'
        $json | Should -Not -Match 'password and unrelated task text'
        $json | Should -Not -Match 'secret prompt'
        $json | Should -Not -Match 'token='
        $payload.clipboardUsed | Should -BeFalse
        $payload.ready | Should -BeTrue
    }

    It 'does not report ready unless the window, document, and address counts are each exactly one' {
        $payload = New-BoundedStatusPayload -Snapshot ([pscustomobject]@{
            CodexWindowCount = 0
            EmbeddedDocumentCount = 1
            AddressCount = 1
            ComposerCount = 1
            LoginCount = 0
            ProCount = 1
            SecurityChallengeCount = 0
            Generating = $false
            PanelRecovered = $false
            Url = 'https://chatgpt.com/'
            UrlExact = $false
        })
        $payload.ready | Should -BeFalse
    }

    It 'does not report ready when the canonical ChatGPT URL is unknown' {
        $payload = New-BoundedStatusPayload -Snapshot ([pscustomobject]@{
            CodexWindowCount = 1
            EmbeddedDocumentCount = 1
            AddressCount = 1
            ComposerCount = 1
            LoginCount = 0
            ProCount = 1
            SecurityChallengeCount = 0
            Generating = $false
            PanelRecovered = $false
            Url = $null
            UrlExact = $false
        })
        $payload.ready | Should -BeFalse
    }

    It 'reports generating and never reports ready while a response is active' {
        $payload = New-BoundedStatusPayload -Snapshot ([pscustomobject]@{
            CodexWindowCount = 1
            EmbeddedDocumentCount = 1
            AddressCount = 1
            ComposerCount = 1
            LoginCount = 0
            ProCount = 1
            SecurityChallengeCount = 0
            Generating = $true
            PanelRecovered = $false
            Url = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
            UrlExact = $true
        })
        $payload.generating | Should -BeTrue
        $payload.ready | Should -BeFalse
    }

    It 'suppresses raw unexpected exception text in JSON error payloads' {
        $payload = New-SafeErrorPayload -Exception ([System.Exception]::new('C:\private\token.txt and unrelated UI text')) -CommandName 'status'
        $json = $payload | ConvertTo-Json -Depth 8 -Compress
        $payload.code | Should -Be 99
        $payload.category | Should -Be 'InternalError'
        $json | Should -Not -Match 'private'
        $json | Should -Not -Match 'token.txt'
        $json | Should -Not -Match 'unrelated UI text'
    }
}

Describe 'Forbidden transport and clipboard surface' {
    It 'contains no clipboard API, browser-driver, CDP, cookie, token, or internal-network implementation' {
        $source = [System.IO.File]::ReadAllText($scriptPath)
        $source | Should -Not -Match '\[System\.Windows\.Forms\.Clipboard\]'
        $source | Should -Not -Match '(?im)^\s*(Get-Clipboard|Set-Clipboard|clip\.exe)\b'
        $source | Should -Not -Match '(?i)SendKeys|System\.Windows\.Forms|user32|DllImport|SetForegroundWindow|GetForegroundWindow'
        $source | Should -Not -Match '(?i)Playwright|Puppeteer|Selenium|ChromeDriver|DevToolsProtocol|--remote-debugging-port'
        $source | Should -Not -Match '(?i)Invoke-WebRequest|Invoke-RestMethod|System\.Net\.Http|WebClient'
        $source | Should -Not -Match '(?i)CookieContainer|document\.cookie|access[_-]?token|refresh[_-]?token'
        $source | Should -Not -Match '(?i)Get-Process|MainWindowHandle|ChatGPT\.exe'
    }

    It 'recognizes the current Chinese generation stop signal and structural assistant turns' {
        $source = [System.IO.File]::ReadAllText($scriptPath)
        $source | Should -Match ([regex]::Escape('停止回答'))
        $source | Should -Match ([regex]::Escape('agent-turn'))
        $source | Should -Match 'WindowRuntimeId'
    }
}

Describe 'Evidence directory admission' {
    It 'allows only the adapter lock in a fresh evidence directory' {
        $directory = Join-Path $TestDrive 'pristine'
        $null = New-Item -ItemType Directory -Path $directory
        Write-Utf8NoBomAtomic -Path (Join-Path $directory '.chatgpt-pro-sidebar.lock') -Text ''
        { Assert-EvidenceDirectoryPristine -Directory $directory } | Should -Not -Throw
    }

    It 'refuses pre-existing residue before any new submission' {
        $directory = Join-Path $TestDrive 'residue'
        $null = New-Item -ItemType Directory -Path $directory
        Write-Utf8NoBomAtomic -Path (Join-Path $directory 'unrelated.txt') -Text 'do not overwrite'
        Assert-ThrowsCategory -Category 'EvidenceDirectoryNotPristine' -ExitCode 30 -Action {
            Assert-EvidenceDirectoryPristine -Directory $directory
        }
    }
}

Describe 'Evidence hashes and durable idempotency' {
    It 'writes UTF-8 evidence, verifies hashes, and refuses directory reuse' {
        $directory = Join-Path $TestDrive 'round-1'
        $null = New-Item -ItemType Directory -Path $directory
        $prompt = "line one`nline two"
        $promptSha = Get-Sha256Text -Text $prompt
        Write-Utf8NoBomAtomic -Path (Join-Path $directory 'prompt.md') -Text $prompt

        $state = New-SendIntentState -PromptSha256 $promptSha -IdempotencyKeyValue 'task-round-1' -BaselineHashes @() -ConversationUrlBeforeSend 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        Set-ObjectProperty -InputObject $state -Name 'windowRuntimeId' -Value '42.100'
        Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'sent'
        Set-ObjectProperty -InputObject $state -Name 'sentAtUtc' -Value '2026-07-28T00:00:01.0000000Z'
        Write-EvidenceState -Directory $directory -State $state

        (Get-Sha256File -Path (Join-Path $directory 'prompt.md')) | Should -Be $promptSha
        $loaded = Read-EvidenceState -Directory $directory
        Assert-ThrowsCategory -Category 'DuplicateSubmissionBlocked' -ExitCode 25 -Action {
            Assert-IdempotencyAvailable -ExistingState $loaded -IdempotencyKey 'task-round-1'
        }

        $response = New-TestResponse -Text 'harmless live answer'
        $evidenceArguments = @{
            EvidenceDirectory = $directory
            State = $loaded
            Response = $response
            ConversationUrl = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
            TransientObservationCount = 1
        }
        $evidence = Complete-Evidence @evidenceArguments

        $evidence.response.sha256 | Should -Be (Get-Sha256File -Path (Join-Path $directory 'response.md'))
        $evidence.extractor.version | Should -Be $Script:ExtractorVersion
        $evidence.extractor.windowRuntimeId | Should -Be '42.100'
        $evidence.extractor.stabilityScope | Should -Be 'same-extractor-same-visible-ui-state'
        $evidence.conversation.exact | Should -BeTrue
        $evidence.conversation.boundAtSend | Should -Be 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        $evidence.conversation.matchedBoundUrl | Should -BeTrue
        $evidence.authority.codexIsSoleWorkspaceWriter | Should -BeTrue
        $completedState = Read-EvidenceState -Directory $directory
        $completedState.phase | Should -Be 'completed'
        $completedState.evidenceSha256 | Should -Be (Get-Sha256File -Path (Join-Path $directory 'evidence.json'))

        $result = Get-CompletedResponseResult -EvidenceDirectory $directory
        $result.response | Should -Be 'harmless live answer'
        $result.evidenceSha256 | Should -Be $completedState.evidenceSha256
    }

    It 'rejects a tampered evidence manifest' {
        $directory = Join-Path $TestDrive 'tampered-evidence'
        $null = New-Item -ItemType Directory -Path $directory
        $prompt = 'safe prompt'
        $promptSha = Get-Sha256Text -Text $prompt
        Write-Utf8NoBomAtomic -Path (Join-Path $directory 'prompt.md') -Text $prompt
        $state = New-SendIntentState -PromptSha256 $promptSha -IdempotencyKeyValue 'tamper-test' -BaselineHashes @() -ConversationUrlBeforeSend 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'sent'
        Complete-Evidence -EvidenceDirectory $directory -State $state -Response (New-TestResponse -Text 'answer') -ConversationUrl 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc' -TransientObservationCount 0 | Out-Null
        Add-Content -LiteralPath (Join-Path $directory 'evidence.json') -Value 'tampered'

        Assert-ThrowsCategory -Category 'EvidenceManifestHashMismatch' -ExitCode 30 -Action {
            Get-CompletedResponseResult -EvidenceDirectory $directory
        }
    }

    It 'marks completion from an uncertain send as observational, not acknowledged' {
        $directory = Join-Path $TestDrive 'uncertain-completion'
        $null = New-Item -ItemType Directory -Path $directory
        $prompt = 'safe prompt'
        $promptSha = Get-Sha256Text -Text $prompt
        Write-Utf8NoBomAtomic -Path (Join-Path $directory 'prompt.md') -Text $prompt
        $state = New-SendIntentState -PromptSha256 $promptSha -IdempotencyKeyValue 'uncertain-test' -BaselineHashes @() -ConversationUrlBeforeSend 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'send-uncertain'
        Set-ObjectProperty -InputObject $state -Name 'invokeAttempted' -Value $true
        Set-ObjectProperty -InputObject $state -Name 'invokeReturned' -Value $false
        $evidence = Complete-Evidence -EvidenceDirectory $directory -State $state -Response (New-TestResponse -Text 'observed answer') -ConversationUrl 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc' -TransientObservationCount 0

        $evidence.submission.acknowledged | Should -BeFalse
        $evidence.submission.observationalRecovery | Should -BeTrue
        (Get-CompletedResponseResult -EvidenceDirectory $directory).observationalRecovery | Should -BeTrue
    }

    It 'rejects state-controlled evidence path traversal' {
        $directory = Join-Path $TestDrive 'path-traversal'
        $null = New-Item -ItemType Directory -Path $directory
        $prompt = 'safe prompt'
        Write-Utf8NoBomAtomic -Path (Join-Path $directory 'prompt.md') -Text $prompt
        $state = New-SendIntentState -PromptSha256 (Get-Sha256Text -Text $prompt) -IdempotencyKeyValue 'path-test' -BaselineHashes @() -ConversationUrlBeforeSend 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        Set-ObjectProperty -InputObject $state -Name 'promptFile' -Value '..\outside.txt'

        Assert-ThrowsCategory -Category 'PromptEvidencePathInvalid' -ExitCode 30 -Action {
            Complete-Evidence -EvidenceDirectory $directory -State $state -Response (New-TestResponse -Text 'answer') -ConversationUrl 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc' -TransientObservationCount 0
        }
    }
}
