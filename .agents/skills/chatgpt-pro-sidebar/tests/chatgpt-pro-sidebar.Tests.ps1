#requires -Version 5.1
#requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
# Source encoding: UTF-8 with BOM (required for localized UIA fixture names in Windows PowerShell 5.1).

BeforeAll {
    $scriptPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/chatgpt-pro-sidebar.ps1'
    . $scriptPath
    if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
        $null = Add-Type -AssemblyName UIAutomationClient
        $null = Add-Type -AssemblyName UIAutomationTypes
    }

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
            [bool]$CanonicalUrlMatch = $false,
            [string]$ToggleState = '',
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
            CanonicalUrlMatch = $CanonicalUrlMatch
            ToggleState = $ToggleState
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

    function New-TestTreeNode {
        param(
            [Parameter(Mandatory = $true)][string]$Id,
            [int]$ProcessId = 1,
            [bool]$Match = $true,
            [string]$RuntimeId = ([guid]::NewGuid().ToString('N'))
        )

        [pscustomobject]@{
            Id = $Id
            Match = $Match
            RuntimeId = $RuntimeId
            Current = [pscustomobject]@{ ProcessId = $ProcessId }
        }
    }

    function New-TestTreeWalker {
        param(
            [hashtable]$FirstChildById = @{},
            [hashtable]$NextSiblingById = @{}
        )

        $walker = [pscustomobject]@{
            FirstChildById = $FirstChildById
            NextSiblingById = $NextSiblingById
            FirstChildCallCount = 0
            NextSiblingCallCount = 0
        }
        $walker | Add-Member -MemberType ScriptMethod -Name GetFirstChild -Value {
            param($element)
            $this.FirstChildCallCount++
            return $this.FirstChildById[[string]$element.Id]
        }
        $walker | Add-Member -MemberType ScriptMethod -Name GetNextSibling -Value {
            param($element)
            $this.NextSiblingCallCount++
            return $this.NextSiblingById[[string]$element.Id]
        }
        return $walker
    }
}

Describe 'Codex top-level window selection' {
    It 'fails closed when no Codex window exists' {
        Assert-ThrowsCategory -Category 'CodexWindowMissing' -ExitCode 20 -Action {
            Select-CodexWindowRecord -Records @()
        }
    }

    It 'fails closed when an eligible Codex window has no RuntimeId' {
        Assert-ThrowsCategory -Category 'CodexWindowRuntimeIdMissing' -ExitCode 20 -Action {
            Select-CodexWindowRecord -Records @(
                (New-TestRecord -CodexDocumentCount 1 -RuntimeId '')
            )
        }
    }

    It 'fails closed when eligible Codex windows share one RuntimeId' {
        Assert-ThrowsCategory -Category 'CodexWindowRuntimeIdAmbiguous' -ExitCode 20 -Action {
            Select-CodexWindowRecord -Records @(
                (New-TestRecord -CodexDocumentCount 1 -RuntimeId '42.same')
                (New-TestRecord -CodexDocumentCount 1 -RuntimeId '42.same')
            )
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

    It 'selects only the window containing one or more Codex documents' {
        $expected = New-TestRecord -CodexDocumentCount 1 -RuntimeId 'expected'
        $selected = Select-CodexWindowRecord -Records @(
            (New-TestRecord -CodexDocumentCount 0)
            $expected
            (New-TestRecord -CodexDocumentCount 0)
        )
        $selected.RuntimeId | Should -Be 'expected'
    }

    It 'accepts the verified current window shape with two Codex documents' {
        $selected = Select-CodexWindowRecord -Records @(
            (New-TestRecord -CodexDocumentCount 0 -EmbeddedDocumentCount 1 -RuntimeId 'external-browser')
            (New-TestRecord -CodexDocumentCount 2 -EmbeddedDocumentCount 12 -RuntimeId 'current-codex')
        )
        $selected.RuntimeId | Should -Be 'current-codex'
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

Describe 'Per-operation Codex window binding' {
    BeforeEach {
        $script:previousTargetWindowRuntimeId = $Script:TargetWindowRuntimeId
        $Script:TargetWindowRuntimeId = ''
    }

    AfterEach {
        $Script:TargetWindowRuntimeId = $script:previousTargetWindowRuntimeId
    }

    It 'binds the first proved window and rejects a later replacement' {
        $first = New-TestRecord -CodexDocumentCount 1 -RuntimeId '42.first'
        $replacement = New-TestRecord -CodexDocumentCount 1 -RuntimeId '42.replacement'

        (Set-LiveOperationWindowBinding -WindowRecord $first).RuntimeId | Should -Be '42.first'
        $Script:TargetWindowRuntimeId | Should -Be '42.first'
        Assert-ThrowsCategory -Category 'CodexWindowBindingMismatch' -ExitCode 20 -Action {
            Set-LiveOperationWindowBinding -WindowRecord $replacement
        }
        $Script:TargetWindowRuntimeId | Should -Be '42.first'
    }

    It 'freezes the selected window before any panel recovery action' {
        $window = New-TestRecord -CodexDocumentCount 1 -RuntimeId '42.before-action' -Element 'window'
        Mock Get-LiveCodexWindow { $window }
        Mock Get-LiveAddressRecords { @() }
        Mock Get-LiveEmbeddedDocumentRecords { @() }
        Mock Ensure-LiveBrowserPanel {
            $Script:TargetWindowRuntimeId | Should -Be '42.before-action'
            throw 'bounded panel recovery stop'
        }

        { Resolve-LiveContext -RecoverPanel } | Should -Throw '*bounded panel recovery stop*'
        Should -Invoke Ensure-LiveBrowserPanel -Times 1 -Exactly
        $Script:TargetWindowRuntimeId | Should -Be '42.before-action'
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

Describe 'Current right-side browser raw UIA compatibility' {
    It 'uses a Raw View direct-child walk before filtering top-level windows by process ID' {
        $source = [System.IO.File]::ReadAllText($scriptPath)
        $discoverySource = [regex]::Match(
            $source,
            '(?s)function Get-LiveCodexWindow\s*\{.*?(?=\r?\nfunction Get-LiveAddressRecords)'
        ).Value
        $topLevelSource = [regex]::Match(
            $source,
            '(?s)function Find-LiveTopLevelElementsByProcessId\s*\{.*?(?=\r?\nfunction Get-LiveCodexWindow)'
        ).Value
        $sourceOutsideDiscovery = $source.Replace($discoverySource, '')

        $discoverySource | Should -Not -BeNullOrEmpty
        $topLevelSource | Should -Not -BeNullOrEmpty
        $source | Should -Match "CodexWindow\s*=\s*@\('ChatGPT', 'Codex'\)"
        $discoverySource | Should -Match 'Get-Process -ErrorAction Stop'
        $discoverySource | Should -Match '\$Script:Names\.CodexWindow -contains \$_\.ProcessName'
        $discoverySource | Should -Not -Match 'MainWindowHandle|FromHandle'
        $discoverySource | Should -Match 'Find-LiveTopLevelElementsByProcessId'
        $topLevelSource | Should -Match '\[System\.Windows\.Automation\.TreeWalker\]::RawViewWalker'
        $topLevelSource | Should -Match '\$element\.Current\.ProcessId'
        $topLevelSource | Should -Match 'TreeScope\]::Children'
        $topLevelSource | Should -Not -Match 'PropertyCondition|TreeWalker\]::new'
        $discoverySource | Should -Match 'TopLevelWindowEnumerationFailed'
        $discoverySource | Should -Match 'TopLevelWindowLimitExceeded'
        $discoverySource | Should -Not -Match 'AutomationElement\]::RootElement.*?\.FindAll\('
        $discoverySource | Should -Match '(?s)Get-Process.*?Find-LiveTopLevelElementsByProcessId.*?Find-LiveElementsByControlTypes.*?CodexDocument'
        $sourceOutsideDiscovery | Should -Not -Match '(?i)\bGet-Process\b|MainWindowHandle'
    }

    It 'uses a shallow product-name hint before any descendant scan' {
        $source = [System.IO.File]::ReadAllText($scriptPath)
        $source | Should -Match "CodexWindow\s*=\s*@\('ChatGPT', 'Codex'\)"
        $source | Should -Match '(?s)function Get-LiveCodexWindow.*?\$Script:Names\.CodexWindow -notcontains \$record\.Name.*?Find-LiveElementsByControlTypes'
    }

    It 'uses incremental RawViewWalker discovery with hard element and deadline bounds' {
        $source = [System.IO.File]::ReadAllText($scriptPath)
        $source | Should -Match 'function Find-LiveRawElementsByCondition'
        $source | Should -Not -Match '\$Root\.FindAll\('
        $source | Should -Match '\[System\.Windows\.Automation\.TreeWalker\]::RawViewWalker'
        $source | Should -Match 'RawViewElementLimitExceeded'
        $source | Should -Match 'RawViewTraversalTimeout'
        $source | Should -Match '(?s)ElementNotAvailableException.*?TransientUiRerender'
    }

    It 'walks Raw View incrementally and preserves duplicate RuntimeIds for later ambiguity checks' {
        $root = New-TestTreeNode -Id 'root' -Match:$false
        $a = New-TestTreeNode -Id 'a' -RuntimeId '42.same'
        $b = New-TestTreeNode -Id 'b' -RuntimeId '42.same'
        $c = New-TestTreeNode -Id 'c' -Match:$false
        $walker = New-TestTreeWalker -FirstChildById @{ root = $a; a = $c } -NextSiblingById @{ a = $b }

        $found = @(Find-LiveRawElementsByCondition `
            -Root $root `
            -Condition { param($element) [bool]$element.Match } `
            -Walker $walker `
            -UtcNowProvider { [DateTime]'2026-08-05T00:00:00Z' })

        $found.Count | Should -Be 2
        @($found | ForEach-Object { $_.Id }) | Should -Be @('a', 'b')
        @($found | ForEach-Object { $_.RuntimeId }) | Should -Be @('42.same', '42.same')
    }

    It 'reuses one bounded Raw View snapshot for selectors rooted at the same element' {
        $Script:RawTraversalCache = @{}
        $root = New-TestTreeNode -Id 'root' -Match:$false
        $match = New-TestTreeNode -Id 'match' -Match:$true
        $other = New-TestTreeNode -Id 'other' -Match:$false
        $walker = New-TestTreeWalker -FirstChildById @{ root = $match } -NextSiblingById @{ match = $other }

        @(Find-LiveRawElementsByCondition `
            -Root $root `
            -Condition { param($element) [bool]$element.Match } `
            -Walker $walker `
            -UtcNowProvider { [DateTime]'2026-08-05T00:00:00Z' }).Id | Should -Be @('match')
        $firstChildCalls = $walker.FirstChildCallCount
        $nextSiblingCalls = $walker.NextSiblingCallCount

        @(Find-LiveRawElementsByCondition `
            -Root $root `
            -Condition { param($element) -not [bool]$element.Match } `
            -Walker $walker `
            -UtcNowProvider { [DateTime]'2026-08-05T00:00:00Z' }).Id | Should -Be @('other')
        $walker.FirstChildCallCount | Should -Be $firstChildCalls
        $walker.NextSiblingCallCount | Should -Be $nextSiblingCalls
    }

    It 'fails closed when a Raw View sibling cycle exceeds the visited-element bound' {
        $root = New-TestTreeNode -Id 'root' -Match:$false
        $a = New-TestTreeNode -Id 'a'
        $walker = New-TestTreeWalker -FirstChildById @{ root = $a } -NextSiblingById @{ a = $a }

        Assert-ThrowsCategory -Category 'RawViewElementLimitExceeded' -ExitCode 23 -Action {
            Find-LiveRawElementsByCondition `
                -Root $root `
                -Condition { param($element) [bool]$element.Match } `
                -Walker $walker `
                -MaximumVisitedElements 3 `
                -UtcNowProvider { [DateTime]'2026-08-05T00:00:00Z' }
        }
    }

    It 'fails closed when the Raw View traversal deadline expires' {
        $root = New-TestTreeNode -Id 'root'
        $a = New-TestTreeNode -Id 'a'
        $walker = New-TestTreeWalker -FirstChildById @{ root = $a }
        $script:treeWalkTimes = [System.Collections.Generic.Queue[DateTime]]::new()
        @(
            [DateTime]'2026-08-05T00:00:00Z',
            [DateTime]'2026-08-05T00:00:00Z',
            [DateTime]'2026-08-05T00:00:02Z'
        ) | ForEach-Object { $script:treeWalkTimes.Enqueue($_) }

        Assert-ThrowsCategory -Category 'RawViewTraversalTimeout' -ExitCode 23 -Action {
            Find-LiveRawElementsByCondition `
                -Root $root `
                -Condition { param($element) $true } `
                -Walker $walker `
                -TimeoutMilliseconds 1000 `
                -UtcNowProvider {
                    if ($script:treeWalkTimes.Count -gt 1) { return $script:treeWalkTimes.Dequeue() }
                    return $script:treeWalkTimes.Peek()
                }
        }
    }

    It 'keeps both top-level windows owned by one candidate process' {
        $root = New-TestTreeNode -Id 'desktop' -ProcessId 0
        $first = New-TestTreeNode -Id 'first' -ProcessId 4242
        $second = New-TestTreeNode -Id 'second' -ProcessId 4242
        $other = New-TestTreeNode -Id 'other' -ProcessId 9000
        $walker = New-TestTreeWalker `
            -FirstChildById @{ desktop = $first } `
            -NextSiblingById @{ first = $second; second = $other }

        $elements = @(Find-LiveTopLevelElementsByProcessId `
            -ProcessIds @(4242) `
            -Root $root `
            -Walker $walker `
            -UtcNowProvider { [DateTime]'2026-08-05T00:00:00Z' })

        @($elements | ForEach-Object { $_.Id }) | Should -Be @('first', 'second')
        Assert-ThrowsCategory -Category 'CodexWindowAmbiguous' -ExitCode 20 -Action {
            Select-CodexWindowRecord -Records @(
                (New-TestRecord -CodexDocumentCount 1 -RuntimeId '42.first')
                (New-TestRecord -CodexDocumentCount 1 -RuntimeId '42.second')
            )
        }
        (Select-CodexWindowRecord -Records @(
            (New-TestRecord -CodexDocumentCount 1 -RuntimeId '42.first')
            (New-TestRecord -CodexDocumentCount 1 -RuntimeId '42.second')
        ) -TargetRuntimeId '42.second').RuntimeId | Should -Be '42.second'
    }

    It 'fails closed when process-filtered top-level enumeration exceeds its bound' {
        $root = New-TestTreeNode -Id 'desktop' -ProcessId 0
        $first = New-TestTreeNode -Id 'first' -ProcessId 4242
        $walker = New-TestTreeWalker -FirstChildById @{ desktop = $first } -NextSiblingById @{ first = $first }

        Assert-ThrowsCategory -Category 'TopLevelWindowLimitExceeded' -ExitCode 20 -Action {
            Find-LiveTopLevelElementsByProcessId `
                -ProcessIds @(4242) `
                -Root $root `
                -Walker $walker `
                -MaximumVisitedElements 2 `
                -UtcNowProvider { [DateTime]'2026-08-05T00:00:00Z' }
        }
    }

    It 'fails closed when the top-level direct-child traversal deadline expires' {
        $root = New-TestTreeNode -Id 'desktop' -ProcessId 0
        $first = New-TestTreeNode -Id 'first' -ProcessId 4242
        $walker = New-TestTreeWalker -FirstChildById @{ desktop = $first }
        $script:topLevelWalkTimes = [System.Collections.Generic.Queue[DateTime]]::new()
        @(
            [DateTime]'2026-08-05T00:00:00Z',
            [DateTime]'2026-08-05T00:00:00Z',
            [DateTime]'2026-08-05T00:00:02Z'
        ) | ForEach-Object { $script:topLevelWalkTimes.Enqueue($_) }

        Assert-ThrowsCategory -Category 'TopLevelWindowTraversalTimeout' -ExitCode 20 -Action {
            Find-LiveTopLevelElementsByProcessId `
                -ProcessIds @(4242) `
                -Root $root `
                -Walker $walker `
                -TimeoutMilliseconds 1000 `
                -UtcNowProvider {
                    if ($script:topLevelWalkTimes.Count -gt 1) { return $script:topLevelWalkTimes.Dequeue() }
                    return $script:topLevelWalkTimes.Peek()
                }
        }
    }

    It 'uses raw-view ancestry when excluding interactive response descendants' {
        $source = [System.IO.File]::ReadAllText($scriptPath)
        $source | Should -Not -Match '\[System\.Windows\.Automation\.TreeWalker\]::ControlViewWalker'
    }

    It 'selects the verified current ChatGPT document shape without accepting the Codex document' {
        $selected = Select-EmbeddedDocumentRecord -Records @(
            [pscustomobject]@{ Name = 'Codex'; IsVisible = $true; ComposerCount = 0; CanonicalUrlMatch = $false; GeometryMatch = $false; RuntimeId = 'codex-root' },
            [pscustomobject]@{ Name = 'ChatGPT'; IsVisible = $true; ComposerCount = 0; CanonicalUrlMatch = $true; GeometryMatch = $false; RuntimeId = 'chatgpt-root' }
        )
        $selected.RuntimeId | Should -Be 'chatgpt-root'
    }

    It 'fails closed when more than one raw document exposes a canonical ChatGPT URL' {
        Assert-ThrowsCategory -Category 'EmbeddedDocumentAmbiguous' -ExitCode 21 -Action {
            Select-EmbeddedDocumentRecord -Records @(
                [pscustomobject]@{ IsVisible = $true; ComposerCount = 0; CanonicalUrlMatch = $true; GeometryMatch = $false },
                [pscustomobject]@{ IsVisible = $true; ComposerCount = 0; CanonicalUrlMatch = $true; GeometryMatch = $false }
            )
        }
    }

    It 'keeps only the unique canonical ChatGPT address when two tabs expose address controls' {
        $selected = @(Select-CanonicalAddressRecords -Records @(
            (New-TestRecord -Name '输入 URL' -CanonicalUrlMatch:$false -RuntimeId 'other-tab')
            (New-TestRecord -Name '输入 URL' -CanonicalUrlMatch:$true -RuntimeId 'chatgpt-tab')
        ))
        $selected.Count | Should -Be 1
        $selected[0].RuntimeId | Should -Be 'chatgpt-tab'
    }

    It 'fails closed when two address controls both claim a canonical ChatGPT URL' {
        Assert-ThrowsCategory -Category 'AddressControlAmbiguous' -ExitCode 21 -Action {
            Select-CanonicalAddressRecords -Records @(
                (New-TestRecord -CanonicalUrlMatch:$true -RuntimeId 'chatgpt-a')
                (New-TestRecord -CanonicalUrlMatch:$true -RuntimeId 'chatgpt-b')
            )
        }
    }

    It 'rejects non-finite raw-view geometry instead of throwing' {
        $document = New-TestRecord -X ([double]::NaN) -Y 100 -Width 600 -Height 500
        $address = New-TestRecord -X 100 -Y 50 -Width 600 -Height 30
        (Test-DocumentGeometryMatch -DocumentRecord $document -AddressRecord $address) | Should -BeFalse
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

    It 'selects the structurally related sidebar toggle regardless of ToggleState orientation' -TestCases @(
        @{ UnrelatedState = 'Off'; BrowserState = 'On' }
        @{ UnrelatedState = 'On'; BrowserState = 'Off' }
    ) {
        param($UnrelatedState, $BrowserState)
        $selected = Select-SidebarToggleRecord -Records @(
            (New-TestRecord -Name '显示/隐藏侧边栏' -X 1000 -Y 80 -Width 28 -Height 28 -ToggleState $UnrelatedState -RuntimeId 'unrelated-sidebar')
            (New-TestRecord -Name '显示/隐藏侧边栏' -X 1000 -Y 480 -Width 28 -Height 28 -ToggleState $BrowserState -RuntimeId 'browser-sidebar')
        ) -RelatedRecords @(
            (New-TestRecord -X 930 -Y 480 -Width 28 -Height 28 -RuntimeId 'browser-expand')
        )
        $selected.RuntimeId | Should -Be 'browser-sidebar'
    }

    It 'selects the sole exact sidebar toggle while a closed panel exposes no expand control' {
        $selected = Select-SidebarToggleRecord -Records @(
            (New-TestRecord -Name '显示/隐藏侧边栏' -X 1000 -Y 80 -Width 28 -Height 28 -ToggleState 'Off' -RuntimeId 'closed-panel-toggle')
        ) -RelatedRecords @()
        $selected.RuntimeId | Should -Be 'closed-panel-toggle'
    }

    It 'fails closed for multiple sidebar toggles while no expand control is exposed' {
        Assert-ThrowsCategory -Category 'SidebarToggleAmbiguous' -ExitCode 23 -Action {
            Select-SidebarToggleRecord -Records @(
                (New-TestRecord -X 1000 -Y 80 -Width 28 -Height 28 -ToggleState 'Off' -RuntimeId 'a')
                (New-TestRecord -X 1000 -Y 480 -Width 28 -Height 28 -ToggleState 'Off' -RuntimeId 'b')
            ) -RelatedRecords @()
        }
    }

    It 'fails closed when more than one sidebar toggle has an equally valid structural relation' {
        Assert-ThrowsCategory -Category 'SidebarToggleAmbiguous' -ExitCode 23 -Action {
            Select-SidebarToggleRecord -Records @(
                (New-TestRecord -X 1000 -Y 80 -Width 28 -Height 28 -ToggleState 'On' -RuntimeId 'a')
                (New-TestRecord -X 1000 -Y 480 -Width 28 -Height 28 -ToggleState 'Off' -RuntimeId 'b')
            ) -RelatedRecords @(
                (New-TestRecord -X 930 -Y 80 -Width 28 -Height 28 -RuntimeId 'a-expand')
                (New-TestRecord -X 930 -Y 480 -Width 28 -Height 28 -RuntimeId 'b-expand')
            )
        }
    }

    It 'selects the expand control on the same row as the chosen sidebar toggle' {
        $anchor = New-TestRecord -X 1000 -Y 480 -Width 28 -Height 28 -RuntimeId 'sidebar-toggle'
        $selected = Select-RelatedPanelControlRecord -Records @(
            (New-TestRecord -X 930 -Y 45 -Width 28 -Height 28 -RuntimeId 'unrelated-expand')
            (New-TestRecord -X 930 -Y 480 -Width 28 -Height 28 -RuntimeId 'sidebar-expand')
        ) -AnchorRecord $anchor -Label 'ExpandPanel'
        $selected.RuntimeId | Should -Be 'sidebar-expand'
    }

    It 'fails closed when two panel controls are equally related to the anchor' {
        $anchor = New-TestRecord -X 1000 -Y 480 -Width 28 -Height 28
        Assert-ThrowsCategory -Category 'ExpandPanelAmbiguous' -ExitCode 23 -Action {
            Select-RelatedPanelControlRecord -Records @(
                (New-TestRecord -X 930 -Y 480 -Width 28 -Height 28 -RuntimeId 'a')
                (New-TestRecord -X 900 -Y 480 -Width 28 -Height 28 -RuntimeId 'b')
            ) -AnchorRecord $anchor -Label 'ExpandPanel'
        }
    }

    It 'fails closed for one panel control with non-finite geometry' {
        $anchor = New-TestRecord -X 1000 -Y 480 -Width 28 -Height 28
        Assert-ThrowsCategory -Category 'ExpandPanelAmbiguous' -ExitCode 23 -Action {
            Select-RelatedPanelControlRecord -Records @(
                (New-TestRecord -X ([double]::NaN) -Y 480 -Width 28 -Height 28 -RuntimeId 'invalid')
            ) -AnchorRecord $anchor -Label 'ExpandPanel'
        }
    }
}

Describe 'Sidebar hidden recovery orchestration' {
    BeforeEach {
        Mock Start-Sleep {}
        $script:addressCall = 0
        $script:panelActions = @()
        $script:browserPanelVisible = $false

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
                return @(New-TestRecord -Name '显示/隐藏侧边栏' -X 1000 -Y 480 -Width 28 -Height 28 -Element 'sidebar')
            }
            if ($Names -contains '展开面板') {
                return @(New-TestRecord -Name '展开面板' -X 930 -Y 480 -Width 28 -Height 28 -Element 'expand')
            }
            if ($Names -contains '浏览器 Ctrl+T') {
                if ($script:browserPanelVisible) {
                    return @(New-TestRecord -Name '浏览器 Ctrl+T' -Element 'browser')
                }
                return @()
            }
            return @()
        }
        Mock Invoke-PanelControlPreservingFocus {
            param($Record, $Mode, $WindowElement)
            $script:panelActions += [pscustomobject]@{ Element = $Record.Element; Mode = $Mode }
            if ($Record.Element -eq 'expand') {
                $script:browserPanelVisible = $true
            }
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

    It 'selects an already visible Browser panel before touching sidebar controls' {
        if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
            Set-ItResult -Skipped -Because 'The Skill runtime and panel controls are Windows-only.'
            return
        }
        $null = Add-Type -AssemblyName UIAutomationClient
        $null = Add-Type -AssemblyName UIAutomationTypes
        $script:browserPanelVisible = $true

        (Ensure-LiveBrowserPanel) | Should -BeTrue
        $script:panelActions.Count | Should -Be 1
        $script:panelActions[0].Element | Should -Be 'browser'
    }

    It 'performs no UIA action when panel geometry is not finite' {
        if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
            Set-ItResult -Skipped -Because 'The Skill runtime and panel controls are Windows-only.'
            return
        }
        Mock Find-LiveElementsByNames {
            param($Root, $ControlTypes, $Names, $Scope)
            if ($Names -contains '显示/隐藏侧边栏') {
                return @(New-TestRecord -Name '显示/隐藏侧边栏' -X 1000 -Y 480 -Width 28 -Height 28 -Element 'sidebar')
            }
            if ($Names -contains '展开面板') {
                return @(New-TestRecord -Name '展开面板' -X ([double]::NaN) -Y 480 -Width 28 -Height 28 -Element 'expand')
            }
            return @()
        }

        Assert-ThrowsCategory -Category 'SidebarToggleAmbiguous' -ExitCode 23 -Action {
            Ensure-LiveBrowserPanel
        }
        Should -Invoke Invoke-PanelControlPreservingFocus -Times 0 -Exactly
    }
}

Describe 'New chat transition proof' {
    BeforeEach {
        $script:newChatContext = [pscustomobject]@{
            Document = [pscustomobject]@{ Element = 'document' }
            Window = [pscustomobject]@{ Element = 'window'; RuntimeId = '42.target' }
        }
        $script:newChatAuth = [pscustomobject]@{
            ComposerRecords = @([pscustomobject]@{ Element = 'composer' })
        }
        $script:freshStateCallCount = 0

        Mock Resolve-LiveContext { $script:newChatContext }
        Mock Get-LiveAuthSnapshot { $script:newChatAuth }
        Mock Assert-AuthReadySnapshot {}
        Mock Get-LiveUrlState { [pscustomobject]@{ Url = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'; Exact = $true } }
        Mock Get-LiveGenerationState { [pscustomobject]@{ Generating = $false } }
        Mock Get-LiveFreshConversationUrlState {
            $script:freshStateCallCount++
            if ($script:freshStateCallCount -eq 1) {
                return $null
            }
            return [pscustomobject]@{ Url = 'https://chatgpt.com/'; Exact = $false }
        }
        Mock Find-LiveElementsByNames { @([pscustomobject]@{ Element = 'new-chat' }) }
        Mock Select-NewChatRecord { [pscustomobject]@{ Element = 'new-chat' } }
        Mock Assert-LiveInvokePatternAvailable {}
        Mock Get-LiveFocusState { [pscustomobject]@{ Element = $null; TopLevelRuntimeId = 'original' } }
        Mock Get-AutomationRuntimeIdText { '42.target' }
        Mock Restore-FocusState { $false }
        Mock Invoke-LiveInvokePatternOnce {}
        Mock Start-Sleep {}
    }

    It 'does not invoke New chat when the current surface is already proved fresh' {
        Mock Get-LiveFreshConversationUrlState { [pscustomobject]@{ Url = 'https://chatgpt.com/'; Exact = $false } }
        Mock Get-LiveUrlState { [pscustomobject]@{ Url = 'https://chatgpt.com/'; Exact = $false } }

        $result = Invoke-LiveNewChat

        $result.ok | Should -BeTrue
        $result.url | Should -Be 'https://chatgpt.com/'
        Should -Invoke Find-LiveElementsByNames -Times 0 -Exactly
        Should -Invoke Invoke-LiveInvokePatternOnce -Times 0 -Exactly
    }

    It 'retries one transient action-preparation failure and invokes New chat at most once' {
        $script:resolveCallCount = 0
        $previousTarget = $Script:TargetWindowRuntimeId
        $Script:TargetWindowRuntimeId = '42.target'
        Mock Resolve-LiveContext {
            $script:resolveCallCount++
            if ($script:resolveCallCount -eq 1) {
                throw (New-SidebarException -ExitCode 20 -Category 'CodexWindowMissing' -Message 'transient test gap')
            }
            return $script:newChatContext
        }

        try {
            $result = Invoke-LiveNewChat

            $result.ok | Should -BeTrue
            $Script:TargetWindowRuntimeId | Should -Be '42.target'
            Should -Invoke Invoke-LiveInvokePatternOnce -Times 1 -Exactly
            Should -Invoke Start-Sleep -Times 2 -Exactly
        }
        finally {
            $Script:TargetWindowRuntimeId = $previousTarget
        }
    }

    It 'retries a bounded Raw View timeout before invoking New chat' {
        $script:resolveCallCount = 0
        Mock Resolve-LiveContext {
            $script:resolveCallCount++
            if ($script:resolveCallCount -eq 1) {
                throw (New-SidebarException -ExitCode 23 -Category 'RawViewTraversalTimeout' -Message 'live traversal timeout')
            }
            return $script:newChatContext
        }

        $result = Invoke-LiveNewChat

        $result.ok | Should -BeTrue
        Should -Invoke Resolve-LiveContext -Times 3 -Exactly
        Should -Invoke Invoke-LiveInvokePatternOnce -Times 1 -Exactly
    }

    It 'returns the precise persistent transient category without invoking New chat' {
        Mock Resolve-LiveContext {
            throw (New-SidebarException -ExitCode 23 -Category 'ComposerMissing' -Message 'persistent test gap')
        }

        Assert-ThrowsCategory -Category 'ComposerMissing' -ExitCode 23 -Action {
            Invoke-LiveNewChat -PreActionTimeoutSecondsValue 0
        }
        Should -Invoke Resolve-LiveContext -Times 1 -Exactly
        Should -Invoke Invoke-LiveInvokePatternOnce -Times 0 -Exactly
    }

    It 'fails immediately for a replacement-only target without invoking New chat' {
        Mock Resolve-LiveContext {
            throw (New-SidebarException -ExitCode 20 -Category 'CodexWindowTargetMissing' -Message 'replacement target')
        }

        Assert-ThrowsCategory -Category 'CodexWindowTargetMissing' -ExitCode 20 -Action {
            Invoke-LiveNewChat
        }
        Should -Invoke Resolve-LiveContext -Times 1 -Exactly
        Should -Invoke Invoke-LiveInvokePatternOnce -Times 0 -Exactly
    }

    It 'maps one throwing New chat Invoke to NewChatUncertain without retrying it' {
        Mock Invoke-LiveInvokePatternOnce { throw 'invoke failed' }

        Assert-ThrowsCategory -Category 'NewChatUncertain' -ExitCode 26 -Action {
            Invoke-LiveNewChat
        }
        Should -Invoke Invoke-LiveInvokePatternOnce -Times 1 -Exactly
    }

    It 'does not retry hard Pro, authentication, or generation barriers' -TestCases @(
        @{ Barrier = 'pro'; Category = 'ProStateMissing'; ExitCode = 22 }
        @{ Barrier = 'auth'; Category = 'AuthenticationOrSecurityChallenge'; ExitCode = 22 }
        @{ Barrier = 'generation'; Category = 'GenerationAlreadyActive'; ExitCode = 24 }
    ) {
        param($Barrier, $Category, $ExitCode)

        $script:newChatBarrier = $Barrier
        Mock Assert-AuthReadySnapshot {
            if ($script:newChatBarrier -eq 'pro') {
                throw (New-SidebarException -ExitCode 22 -Category 'ProStateMissing' -Message 'Pro missing')
            }
            if ($script:newChatBarrier -eq 'auth') {
                throw (New-SidebarException -ExitCode 22 -Category 'AuthenticationOrSecurityChallenge' -Message 'auth barrier')
            }
        }
        Mock Get-LiveGenerationState {
            [pscustomobject]@{ Generating = $script:newChatBarrier -eq 'generation' }
        }

        Assert-ThrowsCategory -Category $Category -ExitCode $ExitCode -Action {
            Invoke-LiveNewChat
        }
        Should -Invoke Resolve-LiveContext -Times 1 -Exactly
        Should -Invoke Invoke-LiveInvokePatternOnce -Times 0 -Exactly
    }

    It 'keeps a bounded fifteen-second proof horizon for the current panel transition' {
        $source = [System.IO.File]::ReadAllText($scriptPath)
        $source | Should -Match '(?s)function Invoke-LiveNewChat.*?AddSeconds\(15\)'
    }

    It 'keeps a bounded fifteen-second pre-action recovery horizon' {
        $source = [System.IO.File]::ReadAllText($scriptPath)
        $source | Should -Match '(?s)function Invoke-LiveNewChat.*?PreActionTimeoutSecondsValue = 15'
    }
}

Describe 'Send preparation traversal recovery' {
    BeforeEach {
        $script:preparedPrompt = 'prepared prompt'
        $script:preparedResolveCalls = 0
        $script:preparedContext = [pscustomobject]@{
            Document = [pscustomobject]@{ Element = 'document' }
        }
        $script:preparedAuth = [pscustomobject]@{
            ComposerRecords = @([pscustomobject]@{ Element = 'composer' })
            ComposerCount = 1
        }

        Mock Resolve-LiveContext {
            $script:preparedResolveCalls++
            if ($script:preparedResolveCalls -eq 1) {
                throw (New-SidebarException -ExitCode 23 -Category 'RawViewTraversalTimeout' -Message 'live traversal timeout')
            }
            return $script:preparedContext
        }
        Mock Get-LiveAuthSnapshot { $script:preparedAuth }
        Mock Assert-AuthReadySnapshot {}
        Mock Get-LiveGenerationState { [pscustomobject]@{ Generating = $false } }
        Mock Select-UniqueControlRecord { param($Records) $Records[0] }
        Mock Read-LiveElementText { $script:preparedPrompt }
        Mock Find-LiveElementsByNames {
            @([pscustomobject]@{ Element = 'send'; IsVisible = $true; IsEnabled = $true })
        }
        Mock Assert-SendPreconditions {}
        Mock Assert-LiveInvokePatternAvailable {}
        Mock Start-Sleep {}
    }

    It 'retries one bounded Raw View timeout before the Send Invoke boundary' {
        $result = Get-LivePreparedSend -ExpectedPromptSha256 (Get-Sha256Text -Text $script:preparedPrompt)

        $result.Send.Element | Should -Be 'send'
        Should -Invoke Resolve-LiveContext -Times 2 -Exactly
        Should -Invoke Start-Sleep -Times 1 -Exactly
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
        $state.conversationUrlBindingPending | Should -BeTrue
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

    It 'marks only an acknowledged fresh send as eligible for pending URL observation' {
        $state = New-SendIntentState `
            -PromptSha256 ('e' * 64) `
            -IdempotencyKeyValue 'fresh-pending-url' `
            -BaselineHashes @() `
            -WindowRuntimeIdValue '42.pending'
        Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'sent'
        Set-ObjectProperty -InputObject $state -Name 'invokeAttempted' -Value $true
        Set-ObjectProperty -InputObject $state -Name 'invokeReturned' -Value $true
        Set-ObjectProperty -InputObject $state -Name 'submissionAcknowledged' -Value $true
        Set-ObjectProperty -InputObject $state -Name 'conversationUrlBindingPending' -Value $true

        (Test-PendingFreshConversationBinding -State $state) | Should -BeTrue
        Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'send-uncertain'
        (Test-PendingFreshConversationBinding -State $state) | Should -BeFalse
        Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'sent'
        Set-ObjectProperty -InputObject $state -Name 'conversationUrlBeforeSend' -Value 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        (Test-PendingFreshConversationBinding -State $state) | Should -BeFalse
    }

    It 'observes an acknowledged fresh send while URL is pending and binds before completion' {
        $directory = Join-Path $TestDrive 'pending-url-wait'
        $null = New-Item -ItemType Directory -Path $directory
        $state = New-SendIntentState `
            -PromptSha256 ('f' * 64) `
            -IdempotencyKeyValue 'pending-url-wait' `
            -BaselineHashes @() `
            -WindowRuntimeIdValue '42.pending'
        Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'sent'
        Set-ObjectProperty -InputObject $state -Name 'invokeAttempted' -Value $true
        Set-ObjectProperty -InputObject $state -Name 'invokeReturned' -Value $true
        Set-ObjectProperty -InputObject $state -Name 'submissionAcknowledged' -Value $true
        Set-ObjectProperty -InputObject $state -Name 'conversationUrlBindingPending' -Value $true
        Write-EvidenceState -Directory $directory -State $state
        $url = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'

        Mock Invoke-PollUntilCompleted {
            [pscustomobject]@{
                Response = New-TestResponse -Text 'completed answer'
                TransientObservationCount = 0
                StablePollCount = 2
            }
        }
        Mock Resolve-LiveContext { [pscustomobject]@{} }
        Mock Get-LiveUrlState { [pscustomobject]@{ Url = $url; Exact = $true } }
        Mock Complete-Evidence {
            [pscustomobject]@{
                response = [pscustomobject]@{ sha256 = ('1' * 64); characters = 16; bytes = 16 }
                conversation = [pscustomobject]@{ url = $url }
                submission = [pscustomobject]@{ acknowledged = $true }
                transientObservationCount = 0
                stablePollCount = 2
            }
        }

        $result = Invoke-LiveWait -EvidenceDirectory $directory -TimeoutSecondsValue 5 -PollMillisecondsValue 250
        $persisted = Read-EvidenceState -Directory $directory
        $result.completed | Should -BeTrue
        $persisted.conversationUrlBound | Should -Be $url
        $persisted.conversationUrlBindingPending | Should -BeFalse
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

    It 'does not rediscover a window for incomplete evidence without a RuntimeId binding' {
        $directory = Join-Path $TestDrive 'missing-window-binding'
        $null = New-Item -ItemType Directory -Path $directory
        $state = New-SendIntentState `
            -PromptSha256 ('f' * 64) `
            -IdempotencyKeyValue 'missing-window-binding' `
            -BaselineHashes @() `
            -ConversationUrlBeforeSend 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'sent'
        Write-EvidenceState -Directory $directory -State $state
        Mock Invoke-PollUntilCompleted { throw 'must not observe another window' }

        Assert-ThrowsCategory -Category 'CodexWindowRuntimeIdMissing' -ExitCode 20 -Action {
            Invoke-LiveWait -EvidenceDirectory $directory -TimeoutSecondsValue 5 -PollMillisecondsValue 250
        }
        Should -Invoke Invoke-PollUntilCompleted -Times 0 -Exactly
    }

    It 'never invokes or reserves again for an unbound send-intent observation' {
        $Script:TargetWindowRuntimeId = ''
        $directory = Join-Path $TestDrive 'unbound-send-intent'
        $null = New-Item -ItemType Directory -Path $directory
        $state = New-SendIntentState `
            -PromptSha256 ('f' * 64) `
            -IdempotencyKeyValue 'unbound-send-intent' `
            -BaselineHashes @() `
            -WindowRuntimeIdValue '42.bound'
        Write-EvidenceState -Directory $directory -State $state
        Mock Invoke-PollUntilCompleted { throw 'observation must not begin without an exact URL' }
        Mock Invoke-LiveInvokePatternOnce { throw 'send must never be retried' }
        Mock Reserve-GlobalIdempotencyKey { throw 'a second reservation must never be created' }

        Assert-ThrowsCategory -Category 'ConversationUrlUnbound' -ExitCode 29 -Action {
            Invoke-LiveWait -EvidenceDirectory $directory -TimeoutSecondsValue 5 -PollMillisecondsValue 250
        }
        (Read-EvidenceState -Directory $directory).automaticResendAllowed | Should -BeFalse
        Should -Invoke Invoke-PollUntilCompleted -Times 0 -Exactly
        Should -Invoke Invoke-LiveInvokePatternOnce -Times 0 -Exactly
        Should -Invoke Reserve-GlobalIdempotencyKey -Times 0 -Exactly
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

Describe 'Per-target concurrency and thread ownership' {
    BeforeEach {
        $script:TargetClaimRootOverride = Join-Path $TestDrive 'target-claims'
        $null = [System.IO.Directory]::CreateDirectory($script:TargetClaimRootOverride)
        $script:threadA = '019fd9c5-9497-7301-a315-6e17d0704869'
        $script:threadB = '019fa981-725e-7f02-93a7-bb1e1b7aefd3'
        $script:bindingA = [ordered]@{
            browserId = 'browser-1'; profileId = 'profile-1'; profileLabel = 'work'
            tabId = '101'; sessionKey = 'browser-1:profile-1:101'
            origin = 'https://chatgpt.com'; url = 'https://chatgpt.com/'
        }
        $script:bindingB = [ordered]@{
            browserId = 'browser-1'; profileId = 'profile-1'; profileLabel = 'work'
            tabId = '102'; sessionKey = 'browser-1:profile-1:102'
            origin = 'https://chatgpt.com'; url = 'https://chatgpt.com/'
        }
    }

    AfterEach {
        $script:TargetClaimRootOverride = $null
    }

    It 'allows distinct complete targets to hold independent UI mutexes' {
        (Get-AgentBrowserTargetMutexName -Binding $script:bindingA) |
            Should -Not -Be (Get-AgentBrowserTargetMutexName -Binding $script:bindingB)
        $first = Enter-UiMutex -TargetBinding $script:bindingA
        $second = $null
        try {
            $second = Enter-UiMutex -TargetBinding $script:bindingB
            $second.Acquired | Should -BeTrue
        }
        finally {
            Exit-UiMutex -Lease $second
            Exit-UiMutex -Lease $first
        }
    }

    It 'serializes one stable conversation claim across different runtime tabs' {
        $conversationUrl = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        $bindingA = [ordered]@{} + $script:bindingA
        $bindingB = [ordered]@{} + $script:bindingB
        $bindingA.url = $conversationUrl
        $bindingB.url = $conversationUrl
        $descriptorA = Get-AgentBrowserTargetClaimDescriptor -Binding $bindingA
        $descriptorB = Get-AgentBrowserTargetClaimDescriptor -Binding $bindingB
        $descriptorA.KeySha256 | Should -Be $descriptorB.KeySha256

        $lockPath = Join-Path $script:TargetClaimRootOverride ($descriptorA.KeySha256 + '.json.lock')
        $claimLock = [System.IO.FileStream]::new(
            $lockPath,
            [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
        try {
            Assert-ThrowsCategory -Category 'AgentBrowserTargetClaimBusy' -ExitCode 32 -Action {
                Reserve-AgentBrowserTargetClaim `
                    -CodexThreadIdValue $script:threadA `
                    -EvidenceDirectory (Join-Path $TestDrive 'stable-claim') `
                    -IdempotencyKeySha256Value ('f' * 64) `
                    -Binding $bindingB
            }
        }
        finally {
            $claimLock.Dispose()
        }
    }

    It 'rejects a second process operating the same complete target' {
        $mutexName = Get-AgentBrowserTargetMutexName -Binding $script:bindingA
        $readyPath = Join-Path $TestDrive 'same-target-ready'
        $releasePath = Join-Path $TestDrive 'same-target-release'
        $job = Start-Job -ArgumentList $mutexName, $readyPath, $releasePath -ScriptBlock {
            param($Name, $ReadyPath, $ReleasePath)
            $mutex = [System.Threading.Mutex]::new($false, $Name)
            try {
                $null = $mutex.WaitOne()
                [System.IO.File]::WriteAllText($ReadyPath, 'ready')
                while (-not [System.IO.File]::Exists($ReleasePath)) {
                    Start-Sleep -Milliseconds 25
                }
                $mutex.ReleaseMutex()
            }
            finally {
                $mutex.Dispose()
            }
        }
        try {
            $deadline = [DateTime]::UtcNow.AddSeconds(30)
            while (-not [System.IO.File]::Exists($readyPath) -and [DateTime]::UtcNow -lt $deadline) {
                Start-Sleep -Milliseconds 25
            }
            [System.IO.File]::Exists($readyPath) | Should -BeTrue
            Assert-ThrowsCategory -Category 'ConcurrentUiOperation' -ExitCode 32 -Action {
                Enter-UiMutex -TargetBinding $script:bindingA
            }
        }
        finally {
            [System.IO.File]::WriteAllText($releasePath, 'release')
            $null = Wait-Job -Job $job -Timeout 30
            Remove-Job -Job $job -Force
        }
    }

    It 'denies an incomplete target any parallel mutex identity' {
        $incomplete = [ordered]@{
            browserId = 'browser-1'; profileId = 'profile-1'; profileLabel = 'work'
            tabId = ''; sessionKey = 'browser-1:profile-1:101'
            origin = 'https://chatgpt.com'; url = 'https://chatgpt.com/'
        }
        Assert-ThrowsCategory -Category 'AgentBrowserTargetBindingIncomplete' -ExitCode 31 -Action {
            Get-AgentBrowserTargetMutexName -Binding $incomplete
        }
    }

    It 'recovers the same target claim but rejects another thread before browser work' {
        $directory = Join-Path $TestDrive 'thread-a-round-1'
        $first = Reserve-AgentBrowserTargetClaim `
            -CodexThreadIdValue $script:threadA `
            -EvidenceDirectory $directory `
            -IdempotencyKeySha256Value ('a' * 64) `
            -Binding $script:bindingA
        $first.Reused | Should -BeFalse
        (Reserve-AgentBrowserTargetClaim `
            -CodexThreadIdValue $script:threadA `
            -EvidenceDirectory $directory `
            -IdempotencyKeySha256Value ('a' * 64) `
            -Binding $script:bindingA).Reused | Should -BeTrue

        Assert-ThrowsCategory -Category 'AgentBrowserTargetClaimConflict' -ExitCode 32 -Action {
            Reserve-AgentBrowserTargetClaim `
                -CodexThreadIdValue $script:threadB `
                -EvidenceDirectory (Join-Path $TestDrive 'thread-b-round-1') `
                -IdempotencyKeySha256Value ('b' * 64) `
                -Binding $script:bindingA
        }
    }

    It 'allows the owning thread to reuse a target only after the previous round is terminal' {
        $firstDirectory = Join-Path $TestDrive 'thread-a-round-old'
        $secondDirectory = Join-Path $TestDrive 'thread-a-round-new'
        $null = Reserve-AgentBrowserTargetClaim `
            -CodexThreadIdValue $script:threadA `
            -EvidenceDirectory $firstDirectory `
            -IdempotencyKeySha256Value ('d' * 64) `
            -Binding $script:bindingB

        Assert-ThrowsCategory -Category 'AgentBrowserTargetClaimConflict' -ExitCode 32 -Action {
            Reserve-AgentBrowserTargetClaim `
                -CodexThreadIdValue $script:threadA `
                -EvidenceDirectory $secondDirectory `
                -IdempotencyKeySha256Value ('e' * 64) `
                -Binding $script:bindingB
        }

        $null = [System.IO.Directory]::CreateDirectory($firstDirectory)
        Write-EvidenceState -Directory $firstDirectory -State ([ordered]@{
            schemaVersion = $Script:SchemaVersion
            tool = $Script:ToolName
            phase = 'completed'
            invokeAttempted = $true
        })
        (Reserve-AgentBrowserTargetClaim `
            -CodexThreadIdValue $script:threadA `
            -EvidenceDirectory $secondDirectory `
            -IdempotencyKeySha256Value ('e' * 64) `
            -Binding $script:bindingB).Reused | Should -BeFalse
    }

    It 'rejects cross-thread wait before resolving or observing the bound target' {
        $directory = Join-Path $TestDrive 'cross-thread-wait'
        $null = [System.IO.Directory]::CreateDirectory($directory)
        $state = New-SendIntentState `
            -PromptSha256 ('c' * 64) `
            -IdempotencyKeyValue 'cross-thread-wait' `
            -BaselineHashes @() `
            -ConversationUrlBeforeSend 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc' `
            -Transport $Script:AgentBrowserTransport `
            -TargetBinding $script:bindingA `
            -CodexThreadIdValue $script:threadA
        Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'sent'
        Write-EvidenceState -Directory $directory -State $state
        Mock Resolve-AgentBrowserTarget { throw 'browser must not be touched' }
        Mock Invoke-PollUntilCompleted { throw 'observation must not start' }

        Assert-ThrowsCategory -Category 'CodexThreadMismatch' -ExitCode 30 -Action {
            Invoke-AgentBrowserWait `
                -EvidenceDirectory $directory `
                -TimeoutSecondsValue 5 `
                -PollMillisecondsValue 250 `
                -CodexThreadIdValue $script:threadB
        }
        Should -Invoke Resolve-AgentBrowserTarget -Times 0 -Exactly
        Should -Invoke Invoke-PollUntilCompleted -Times 0 -Exactly
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
    It 'reads allowed URL states without focus, selection, re-resolution, or restoration' -TestCases @(
        @{ AddressValue = 'https://chatgpt.com/'; ExpectedUrl = 'https://chatgpt.com/'; ExpectedExact = $false }
        @{ AddressValue = 'https://chatgpt.com/g/g-abc123'; ExpectedUrl = 'https://chatgpt.com/g/g-abc123'; ExpectedExact = $false }
        @{ AddressValue = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc?private=1#fragment'; ExpectedUrl = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'; ExpectedExact = $true }
    ) {
        param($AddressValue, $ExpectedUrl, $ExpectedExact)

        $script:setFocusCount = 0
        $addressElement = [pscustomobject]@{}
        $addressElement | Add-Member -MemberType ScriptMethod -Name SetFocus -Value { $script:setFocusCount++ }
        $context = [pscustomobject]@{
            Address = [pscustomobject]@{ Element = $addressElement }
            Window = [pscustomobject]@{ Element = 'window' }
        }

        Mock Read-LiveElementText { $AddressValue }
        Mock Resolve-LiveContext { throw 'URL read must not re-resolve after a focus action' }
        Mock Restore-FocusState { throw 'URL read must not restore focus' }

        $result = Get-LiveUrlState -Context $context
        $result.Exact | Should -Be $ExpectedExact
        $result.Url | Should -Be $ExpectedUrl
        $script:setFocusCount | Should -Be 0
        Should -Invoke Resolve-LiveContext -Times 0 -Exactly
        Should -Invoke Restore-FocusState -Times 0 -Exactly

        $source = [System.IO.File]::ReadAllText($scriptPath)
        $source | Should -Not -Match 'function Invoke-LiveAddressTextSelection'
    }

    It 'prefers an exact conversation URL over an origin-only candidate' {
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
    It 'focuses the ChatGPT composer only when explicitly allowed' {
        $script:composerFocusCount = 0
        $script:composerValues = @()
        $valuePattern = [pscustomobject]@{
            Current = [pscustomobject]@{ IsReadOnly = $false }
        }
        $valuePattern | Add-Member -MemberType ScriptMethod -Name SetValue -Value {
            param($value)
            $script:composerValues += $value
        }
        $element = [pscustomobject]@{ Pattern = $valuePattern }
        $element | Add-Member -MemberType ScriptMethod -Name SetFocus -Value {
            $script:composerFocusCount++
        }
        $element | Add-Member -MemberType ScriptMethod -Name TryGetCurrentPattern -Value {
            param($pattern, [ref]$result)
            $result.Value = $this.Pattern
            return $true
        }
        $record = [pscustomobject]@{ Element = $element }

        Set-LiveComposerValue -ComposerRecord $record -Value 'silent'
        Set-LiveComposerValue -ComposerRecord $record -Value 'foreground' -FocusComposer

        $script:composerFocusCount | Should -Be 1
        $script:composerValues | Should -Be @('silent', 'foreground')
    }

    It 'restores focus only while automation still owns the UIA top-level focus' {
        (Test-FocusRestoreAllowed -OriginalTopLevelRuntimeId 'original' -CurrentTopLevelRuntimeId 'codex' -ExpectedAutomationTopLevelRuntimeId 'codex') | Should -BeTrue
        (Test-FocusRestoreAllowed -OriginalTopLevelRuntimeId 'original' -CurrentTopLevelRuntimeId 'third-app' -ExpectedAutomationTopLevelRuntimeId 'codex') | Should -BeFalse
    }

    It 'does not restore inside the original top-level or when automation never owned focus' {
        (Test-FocusRestoreAllowed -OriginalTopLevelRuntimeId 'codex' -CurrentTopLevelRuntimeId 'codex' -ExpectedAutomationTopLevelRuntimeId 'codex') | Should -BeFalse
        (Test-FocusRestoreAllowed -OriginalTopLevelRuntimeId 'original' -CurrentTopLevelRuntimeId 'original' -ExpectedAutomationTopLevelRuntimeId 'codex') | Should -BeFalse
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
        $source | Should -Not -Match '(?i)ChatGPT\.exe'
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

        $responseText = 'harmless 中文 answer'
        $response = New-TestResponse -Text $responseText
        $evidenceArguments = @{
            EvidenceDirectory = $directory
            State = $loaded
            Response = $response
            ConversationUrl = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
            TransientObservationCount = 1
        }
        $evidence = Complete-Evidence @evidenceArguments

        $evidence.response.sha256 | Should -Be (Get-Sha256File -Path (Join-Path $directory 'response.md'))
        $evidence.response.bytes | Should -Be $Script:Utf8NoBom.GetByteCount($responseText)
        $evidence.extractor.version | Should -Be $Script:ExtractorVersion
        $evidence.extractor.windowRuntimeId | Should -Be '42.100'
        $evidence.extractor.stabilityScope | Should -Be 'same-extractor-same-visible-ui-state'
        $evidence.conversation.exact | Should -BeTrue
        $evidence.conversation.boundAtSend | Should -Be 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        $evidence.conversation.matchedBoundUrl | Should -BeTrue
        $evidence.authority.codexIsSoleWorkspaceWriter | Should -BeTrue
        $completedState = Read-EvidenceState -Directory $directory
        $completedState.phase | Should -Be 'completed'
        $completedState.responseBytes | Should -Be $Script:Utf8NoBom.GetByteCount($responseText)
        $completedState.evidenceSha256 | Should -Be (Get-Sha256File -Path (Join-Path $directory 'evidence.json'))

        $result = Get-CompletedResponseResult -EvidenceDirectory $directory
        $result.response | Should -Be $responseText
        $result.responseBytes | Should -Be $Script:Utf8NoBom.GetByteCount($responseText)
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

    It 'derives response bytes for completed version-1 evidence created before byte counts were recorded' {
        $directory = Join-Path $TestDrive 'legacy-response-bytes'
        $null = New-Item -ItemType Directory -Path $directory
        $prompt = 'safe prompt'
        $promptSha = Get-Sha256Text -Text $prompt
        Write-Utf8NoBomAtomic -Path (Join-Path $directory 'prompt.md') -Text $prompt
        $state = New-SendIntentState -PromptSha256 $promptSha -IdempotencyKeyValue 'legacy-byte-test' -BaselineHashes @() -ConversationUrlBeforeSend 'https://chatgpt.com/c/conversation_123'
        Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'sent'
        $responseText = '历史 response'
        Complete-Evidence -EvidenceDirectory $directory -State $state -Response (New-TestResponse -Text $responseText) -ConversationUrl 'https://chatgpt.com/c/conversation_123' -TransientObservationCount 0 | Out-Null

        $legacyEvidence = [System.IO.File]::ReadAllText((Join-Path $directory 'evidence.json'), $Script:Utf8NoBom) | ConvertFrom-Json
        $legacyEvidence.response.PSObject.Properties.Remove('bytes')
        Write-JsonAtomic -Path (Join-Path $directory 'evidence.json') -Value $legacyEvidence

        $legacyState = Read-EvidenceState -Directory $directory
        $legacyState.PSObject.Properties.Remove('responseBytes')
        Set-ObjectProperty -InputObject $legacyState -Name 'evidenceSha256' -Value (Get-Sha256File -Path (Join-Path $directory 'evidence.json'))
        Write-EvidenceState -Directory $directory -State $legacyState

        $result = Get-CompletedResponseResult -EvidenceDirectory $directory
        $result.response | Should -Be $responseText
        $result.responseBytes | Should -Be $Script:Utf8NoBom.GetByteCount($responseText)

        $waitResult = Invoke-LiveWait -EvidenceDirectory $directory -TimeoutSecondsValue 1 -PollMillisecondsValue 10
        $waitResult.reusedCompletedEvidence | Should -BeTrue
        $waitResult.responseBytes | Should -Be $Script:Utf8NoBom.GetByteCount($responseText)
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

Describe 'agent-browser-cli V2 transport' {
    BeforeEach {
        $script:v2Target = [pscustomobject]@{
            BrowserId = 'browser-1'
            ProfileId = 'profile-1'
            ProfileLabel = 'work'
            TabId = '101'
            SessionKey = 'browser-1:profile-1:101'
            Origin = 'https://chatgpt.com'
            Url = 'https://chatgpt.com/'
            UrlExact = $false
        }
        $script:IdempotencyRootOverride = Join-Path $TestDrive 'v2-idempotency'
        $script:TargetClaimRootOverride = Join-Path $TestDrive ('v2-target-claims-' + [guid]::NewGuid().ToString('N'))
        $null = [System.IO.Directory]::CreateDirectory($script:IdempotencyRootOverride)
        $null = [System.IO.Directory]::CreateDirectory($script:TargetClaimRootOverride)
        $script:v2ThreadId = '019fd9c5-9497-7301-a315-6e17d0704869'
    }

    AfterEach {
        $script:IdempotencyRootOverride = $null
        $script:TargetClaimRootOverride = $null
    }

    It 'accepts exactly one successful CLI JSON document and rejects trailing JSON' {
        $valid = '{"ok":true,"result":{"status":"success","metadata":{"tabs_count":0,"tabs":[]}}}'
        (ConvertFrom-AgentBrowserCliOutput -Stdout $valid -ExitCode 0 -Operation 'tabs').ok | Should -BeTrue

        Assert-ThrowsCategory -Category 'AgentBrowserCliJsonInvalid' -ExitCode 10 -Action {
            ConvertFrom-AgentBrowserCliOutput -Stdout ($valid + $valid) -ExitCode 0 -Operation 'tabs'
        }
    }

    It 'accepts one new response after ChatGPT virtualizes an unchanged baseline prefix' {
        $oldA = New-TestResponse -Text 'old-a' -Ordinal 0
        $oldB = New-TestResponse -Text 'old-b' -Ordinal 1
        $new = New-TestResponse -Text 'new-only' -Ordinal 2

        $comparison = Compare-ResponseBaseline `
            -BaselineHashes @($oldA.ContentSha256, $oldB.ContentSha256) `
            -CurrentResponses @($oldB, $new)

        $comparison.Status | Should -Be 'one'
        $comparison.NewResponse.Content | Should -Be 'new-only'
    }

    It 'rejects a response list when every recorded baseline turn disappeared' {
        $old = New-TestResponse -Text 'old'
        $new = New-TestResponse -Text 'new'

        Assert-ThrowsCategory -Category 'ResponseBaselineMismatch' -ExitCode 28 -Action {
            Compare-ResponseBaseline -BaselineHashes @($old.ContentSha256) -CurrentResponses @($new)
        }
    }

    It 'reads one bounded CLI process without waiting for daemon-inherited pipe EOF' {
        $source = [System.IO.File]::ReadAllText($scriptPath)
        $invoker = [regex]::Match($source, '(?s)function Invoke-AgentBrowserCliJson\s*\{.*?(?=\r?\nfunction Test-BoundedAgentBrowserIdentity)').Value
        $invoker | Should -Match 'ReadLineAsync\(\)'
        $invoker | Should -Match '\$process\.HasExited'
        $invoker | Should -Match 'AgentBrowserCliTimeout'
        $invoker | Should -Not -Match 'ReadToEnd\(\)|GetTempFileName|2>\s*\$stderrPath'
    }

    It 'quotes arbitrary fill arguments without a command shell' {
        (ConvertTo-WindowsProcessArgument -Value 'plain') | Should -Be 'plain'
        (ConvertTo-WindowsProcessArgument -Value 'hello world') | Should -Be '"hello world"'
        (ConvertTo-WindowsProcessArgument -Value 'say "hello"') | Should -Be '"say \"hello\""'
        (ConvertTo-WindowsProcessArgument -Value 'C:\with space\') | Should -Be '"C:\with space\\"'
    }

    It 'fails closed when two Chrome tabs match ChatGPT without an exact binding' {
        Mock Invoke-AgentBrowserCliJson {
            [pscustomobject]@{
                ok = $true
                result = [pscustomobject]@{
                    status = 'success'
                    metadata = [pscustomobject]@{ tabs = @(
                        [pscustomobject]@{ browser_id = 'b'; profile_id = 'p'; profile_label = 'work'; tab_id = '1'; session_key = 'b:p:1'; url = 'https://chatgpt.com/' }
                        [pscustomobject]@{ browser_id = 'b'; profile_id = 'p'; profile_label = 'work'; tab_id = '2'; session_key = 'b:p:2'; url = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc' }
                    ) }
                }
            }
        }

        Assert-ThrowsCategory -Category 'AgentBrowserTargetAmbiguous' -ExitCode 20 -Action {
            Resolve-AgentBrowserTarget
        }
    }

    It 'binds browser profile tab session and canonical URL without titles or history' {
        $binding = ConvertTo-AgentBrowserTargetBinding -Target $script:v2Target
        $binding.browserId | Should -Be 'browser-1'
        $binding.profileId | Should -Be 'profile-1'
        $binding.profileLabel | Should -Be 'work'
        $binding.tabId | Should -Be '101'
        $binding.sessionKey | Should -Be 'browser-1:profile-1:101'
        $binding.url | Should -Be 'https://chatgpt.com/'
        ($binding | ConvertTo-Json -Compress) | Should -Not -Match 'title|history'
    }

    It 'replaces a truncated tab-list URL with the exact inspected page URL' {
        $conversationUrl = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        Mock Invoke-AgentBrowserCliJson {
            [pscustomobject]@{
                ok = $true
                result = [pscustomobject]@{
                    status = 'success'; tab_id = '101'; session_key = 'browser-1:profile-1:101'
                    js_return = [pscustomobject]@{
                        schemaVersion = 1; origin = 'https://chatgpt.com'; url = $conversationUrl
                        composer = [pscustomobject]@{ count = 1; value = '' }
                        send = [pscustomobject]@{ count = 0 }
                        auth = [pscustomobject]@{ loginCount = 0; challengeCount = 0; proIndicatorCount = 1 }
                        model = [pscustomobject]@{ controlCount = 1; selectedLabel = 'Pro'; proSelected = $true }
                        generating = $false; userTurns = @(); assistantTurns = @(); turnLimitExceeded = $false
                    }
                }
            }
        }

        $snapshot = Get-AgentBrowserPageSnapshot -Target $script:v2Target
        $snapshot.Url | Should -Be $conversationUrl
        $script:v2Target.Url | Should -Be $conversationUrl
        $script:v2Target.UrlExact | Should -BeTrue
        $snapshot.SelectedModeControlCount | Should -Be 1
        $snapshot.SelectedModeLabel | Should -Be 'Pro'
        $snapshot.SelectedModeIsPro | Should -BeTrue
    }

    It 'keeps an exact tab identity when the tab-list URL is truncated' {
        $conversationUrl = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        $truncatedUrl = 'https://chatgpt.com/c/12345678-1234-1234'
        Mock Invoke-AgentBrowserCliJson {
            [pscustomobject]@{
                ok = $true
                result = [pscustomobject]@{
                    status = 'success'
                    metadata = [pscustomobject]@{ tabs = @([pscustomobject]@{
                        browser_id = 'browser-1'; profile_id = 'profile-1'; profile_label = 'work'
                        tab_id = '101'; session_key = 'browser-1:profile-1:101'; url = $truncatedUrl
                    }) }
                }
            }
        }
        $binding = ConvertTo-AgentBrowserTargetBinding -Target $script:v2Target
        $binding.url = $conversationUrl

        $resolved = Resolve-AgentBrowserTarget `
            -ExpectedBinding $binding `
            -ExpectedConversationUrl $conversationUrl `
            -AllowExactUrlReopen

        $resolved.SessionKey | Should -Be 'browser-1:profile-1:101'
        $resolved.Url | Should -Be $truncatedUrl
    }

    It 'uses the full profile tree when the tab-list URL is abbreviated with an ellipsis' {
        $conversationUrl = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        Mock Invoke-AgentBrowserCliJson {
            param($Arguments)
            if ([string]$Arguments[0] -eq 'tabs') {
                return [pscustomobject]@{ ok = $true; result = [pscustomobject]@{
                    status = 'success'; metadata = [pscustomobject]@{ tabs = @([pscustomobject]@{
                        browser_id = 'browser-1'; profile_id = 'profile-1'; profile_label = 'work'
                        tab_id = '101'; session_key = 'browser-1:profile-1:101'; url = 'https://chatgpt.com/c/12345678...'
                    }) }
                } }
            }
            [pscustomobject]@{ ok = $true; result = [pscustomobject]@{
                status = 'success'; browsers = @([pscustomobject]@{
                    browser_id = 'browser-1'; profiles = @([pscustomobject]@{
                        profile_id = 'profile-1'; profile_label = 'work'; tabs = @([pscustomobject]@{
                            tab_id = '101'; session_key = 'browser-1:profile-1:101'; url = $conversationUrl
                        })
                    })
                })
            } }
        }

        $resolved = Resolve-AgentBrowserTarget -ExpectedBinding (ConvertTo-AgentBrowserTargetBinding -Target $script:v2Target)

        $resolved.SessionKey | Should -Be 'browser-1:profile-1:101'
        $resolved.Url | Should -Be $conversationUrl
    }

    It 'reopens the exact URL through one persistent profile after the browser id changes' {
        $conversationUrl = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        $currentBrowserId = 'browser-2'
        $openedTabId = '202'
        $openedSessionKey = 'browser-2:profile-1:202'
        $script:v2OpenArguments = $null
        $script:v2PostOpenTabPolls = 0
        Mock Invoke-AgentBrowserCliJson {
            param($Arguments)
            switch ([string]$Arguments[0]) {
                'tabs' {
                    $tabs = @([pscustomobject]@{
                        browser_id = $currentBrowserId; profile_id = 'profile-1'; profile_label = 'work'
                        tab_id = '201'; session_key = 'browser-2:profile-1:201'; url = 'https://example.com/'
                    })
                    return [pscustomobject]@{
                        ok = $true; result = [pscustomobject]@{
                            status = 'success'; metadata = [pscustomobject]@{ tabs = $tabs }
                        }
                    }
                }
                'tabtree' {
                    $treeTabs = @([pscustomobject]@{ tab_id = '201'; session_key = 'browser-2:profile-1:201'; url = 'https://example.com/' })
                    if ($null -ne $script:v2OpenArguments) {
                        $script:v2PostOpenTabPolls++
                    }
                    if ($script:v2PostOpenTabPolls -ge 2) {
                        $treeTabs += [pscustomobject]@{ tab_id = $openedTabId; session_key = $openedSessionKey; url = $conversationUrl }
                    }
                    return [pscustomobject]@{
                        ok = $true; result = [pscustomobject]@{
                            status = 'success'; browsers = @([pscustomobject]@{
                                browser_id = $currentBrowserId
                                profiles = @([pscustomobject]@{
                                    profile_id = 'profile-1'; profile_label = 'work'
                                    tabs = $treeTabs
                                })
                            })
                        }
                    }
                }
                'open' {
                    $script:v2OpenArguments = @($Arguments)
                    return [pscustomobject]@{
                        ok = $true; result = [pscustomobject]@{
                            status = 'success'; opened_tab_id = $openedTabId; opened_session_key = $openedSessionKey
                        }
                    }
                }
                'exec' {
                    return [pscustomobject]@{
                        ok = $true; result = [pscustomobject]@{
                            status = 'success'; tab_id = $openedTabId; session_key = $openedSessionKey
                            js_return = [pscustomobject]@{
                                schemaVersion = 1; origin = 'https://chatgpt.com'; url = $conversationUrl
                                composer = [pscustomobject]@{ count = 1; value = '' }
                                send = [pscustomobject]@{ count = 0 }
                                auth = [pscustomobject]@{ loginCount = 0; challengeCount = 0; proIndicatorCount = 1 }
                                model = [pscustomobject]@{ controlCount = 1; selectedLabel = 'Pro'; proSelected = $true }
                                generating = $false; userTurns = @(); assistantTurns = @(); turnLimitExceeded = $false
                            }
                        }
                    }
                }
            }
        }
        Mock Start-Sleep {}

        $resolved = Resolve-AgentBrowserTarget `
            -ExpectedBinding (ConvertTo-AgentBrowserTargetBinding -Target $script:v2Target) `
            -ExpectedConversationUrl $conversationUrl `
            -AllowExactUrlReopen

        $resolved.BrowserId | Should -Be $currentBrowserId
        $resolved.ProfileId | Should -Be 'profile-1'
        $resolved.TabId | Should -Be $openedTabId
        $resolved.Url | Should -Be $conversationUrl
        $script:v2OpenArguments | Should -Contain '--background'
        $script:v2OpenArguments[($script:v2OpenArguments.IndexOf('--browser') + 1)] | Should -Be $currentBrowserId
        $script:v2PostOpenTabPolls | Should -BeGreaterOrEqual 2
    }

    It 'selects the ordinal-first duplicate exact URL only for read-only recovery' {
        $conversationUrl = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        Mock Invoke-AgentBrowserCliJson {
            param($Arguments)
            if ([string]$Arguments[0] -eq 'tabs') {
                return [pscustomobject]@{ ok = $true; result = [pscustomobject]@{
                    status = 'success'; metadata = [pscustomobject]@{ tabs = @() }
                } }
            }
            [pscustomobject]@{ ok = $true; result = [pscustomobject]@{
                status = 'success'; browsers = @([pscustomobject]@{
                    browser_id = 'browser-2'; profiles = @([pscustomobject]@{
                        profile_id = 'profile-1'; profile_label = 'work'; tabs = @(
                            [pscustomobject]@{ tab_id = '303'; session_key = 'browser-2:profile-1:303'; url = $conversationUrl }
                            [pscustomobject]@{ tab_id = '202'; session_key = 'browser-2:profile-1:202'; url = $conversationUrl }
                        )
                    })
                })
            } }
        }
        $binding = ConvertTo-AgentBrowserTargetBinding -Target $script:v2Target
        $binding.url = $conversationUrl

        $resolved = Resolve-AgentBrowserTarget `
            -ExpectedBinding $binding `
            -ExpectedConversationUrl $conversationUrl `
            -AllowExactUrlReopen

        $resolved.TabId | Should -Be '202'
        $resolved.SessionKey | Should -Be 'browser-2:profile-1:202'
    }

    It 'rejects a CLI operation that reports a different session after acting' {
        $envelope = [pscustomobject]@{
            result = [pscustomobject]@{ status = 'success'; tab_id = '101'; session_key = 'other:session:101' }
        }
        Assert-ThrowsCategory -Category 'AgentBrowserCommandTargetMismatch' -ExitCode 20 -Action {
            Assert-AgentBrowserCommandResultBinding -Envelope $envelope -Target $script:v2Target
        }
    }

    It 'recognizes one structurally appended user turn without comparing rendered prompt text' {
        $old = New-TestResponse -Text 'old prompt'
        $formatted = New-TestResponse -Text "expected`n`nrendered prompt" -Ordinal 1
        (Assert-AgentBrowserUserTurnAcknowledgement -BaselineHashes @($old.ContentSha256) -CurrentTurns @($old, $formatted)) | Should -BeTrue

        Assert-ThrowsCategory -Category 'UserTurnAcknowledgementMismatch' -ExitCode 28 -Action {
            Assert-AgentBrowserUserTurnAcknowledgement `
                -BaselineHashes @($old.ContentSha256) `
                -CurrentTurns @($old, $formatted, (New-TestResponse -Text 'second new turn' -Ordinal 2))
        }
    }

    It 'switches one unique thinking-mode control to Pro and verifies it before send preparation' {
        $extreme = [pscustomobject]@{
            Url = 'https://chatgpt.com/'; UrlExact = $false; ComposerCount = 1; ComposerValue = ''; SendCount = 0
            LoginCount = 0; ProCount = 0; SelectedModeControlCount = 1; SelectedModeLabel = '极高'; SelectedModeIsPro = $false
            SecurityChallengeCount = 0; Generating = $false; UserTurns = @(); Responses = @(); Target = $script:v2Target
        }
        $pro = [pscustomobject]@{
            Url = 'https://chatgpt.com/'; UrlExact = $false; ComposerCount = 1; ComposerValue = ''; SendCount = 0
            LoginCount = 0; ProCount = 1; SelectedModeControlCount = 1; SelectedModeLabel = 'Pro'; SelectedModeIsPro = $true
            SecurityChallengeCount = 0; Generating = $false; UserTurns = @(); Responses = @(); Target = $script:v2Target
        }
        $script:v2ModelActions = [System.Collections.Queue]::new()
        $script:v2ModelActions.Enqueue([pscustomobject]@{ ok = $true; phase = 'open-menu' })
        $script:v2ModelActions.Enqueue([pscustomobject]@{ ok = $true; phase = 'open-submenu' })
        $script:v2ModelActions.Enqueue([pscustomobject]@{ ok = $true; phase = 'select-pro' })
        $script:v2ModelSnapshots = [System.Collections.Queue]::new()
        $script:v2ModelSnapshots.Enqueue($extreme)
        $script:v2ModelSnapshots.Enqueue($extreme)
        $script:v2ModelSnapshots.Enqueue($pro)
        $script:v2ModelClicks = [System.Collections.Generic.List[string]]::new()
        Mock Get-AgentBrowserProSelectionAction { $script:v2ModelActions.Dequeue() }
        Mock Get-AgentBrowserPageSnapshot { $script:v2ModelSnapshots.Dequeue() }
        Mock Invoke-AgentBrowserBoundMouseClick { param($Target, $Selector) $script:v2ModelClicks.Add($Selector) }
        Mock Start-Sleep {}

        $result = Ensure-AgentBrowserProMode -Target $script:v2Target -Snapshot $extreme

        $result.SelectedModeLabel | Should -Be 'Pro'
        $script:v2ModelClicks.Count | Should -Be 2
        $script:v2ModelClicks[0] | Should -Be 'button[data-codex-gptpro-mode-control="true"]'
        $script:v2ModelClicks[1] | Should -Be '[data-codex-gptpro-pro-option="true"]'
    }

    It 'fails before the send click when the selected mode drifts away from Pro after fill' {
        $directory = Join-Path $TestDrive 'v2-mode-drift-before-click'
        $null = New-Item -ItemType Directory -Path $directory
        $prompt = 'strict Pro prompt'
        $script:v2PageCalls = 0
        $script:v2FillCalls = 0
        $script:v2ClickCalls = 0
        Mock Resolve-AgentBrowserTarget { $script:v2Target }
        Mock Get-AgentBrowserPageSnapshot {
            $script:v2PageCalls++
            if ($script:v2PageCalls -eq 1) {
                return [pscustomobject]@{
                    Url = 'https://chatgpt.com/'; UrlExact = $false; ComposerCount = 1; ComposerValue = ''; SendCount = 0
                    LoginCount = 0; ProCount = 1; SelectedModeControlCount = 1; SelectedModeLabel = 'Pro'; SelectedModeIsPro = $true
                    SecurityChallengeCount = 0; Generating = $false; UserTurns = @(); Responses = @(); Target = $script:v2Target
                }
            }
            [pscustomobject]@{
                Url = 'https://chatgpt.com/'; UrlExact = $false; ComposerCount = 1; ComposerValue = $prompt; SendCount = 1
                LoginCount = 0; ProCount = 0; SelectedModeControlCount = 1; SelectedModeLabel = '极高'; SelectedModeIsPro = $false
                SecurityChallengeCount = 0; Generating = $false; UserTurns = @(); Responses = @(); Target = $script:v2Target
            }
        }
        Mock Invoke-AgentBrowserCliJson {
            param($Arguments)
            if ($Arguments[0] -eq 'fill') { $script:v2FillCalls++ }
            if ($Arguments[0] -eq 'click') { $script:v2ClickCalls++ }
            [pscustomobject]@{ ok = $true; result = [pscustomobject]@{ status = 'success'; tab_id = '101'; session_key = 'browser-1:profile-1:101' } }
        }

        Assert-ThrowsCategory -Category 'SelectedModeNotPro' -ExitCode 22 -Action {
            Invoke-AgentBrowserSend -PromptText $prompt -EvidenceDirectory $directory -IdempotencyKeyValue 'v2-mode-drift-before-click' -CodexThreadIdValue $script:v2ThreadId -RequireFreshConversation -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $script:v2Target)
        }
        $script:v2FillCalls | Should -Be 1
        $script:v2ClickCalls | Should -Be 0
        $state = Read-EvidenceState -Directory $directory
        $state.phase | Should -Be 'pre-invoke-failed'
        $state.preInvokeFailureCategory | Should -Be 'SelectedModeNotPro'
    }

    It 'acknowledges one prompt after ChatGPT virtualizes an unchanged user-turn prefix' {
        $oldA = New-TestResponse -Text 'old prompt a' -Ordinal 0
        $oldB = New-TestResponse -Text 'old prompt b' -Ordinal 1
        $matching = New-TestResponse -Text 'expected prompt' -Ordinal 2
        (Assert-AgentBrowserUserTurnAcknowledgement `
            -BaselineHashes @($oldA.ContentSha256, $oldB.ContentSha256) `
            -CurrentTurns @($oldB, $matching)) | Should -BeTrue

        Assert-ThrowsCategory -Category 'UserTurnBaselineMismatch' -ExitCode 28 -Action {
            Assert-AgentBrowserUserTurnAcknowledgement `
                -BaselineHashes @($oldA.ContentSha256, $oldB.ContentSha256) `
                -CurrentTurns @($matching)
        }
    }

    It 'writes send-uncertain and performs no second click when the one click result is lost' {
        $directory = Join-Path $TestDrive 'v2-click-uncertain'
        $null = New-Item -ItemType Directory -Path $directory
        $script:v2PageCalls = 0
        $script:v2ClickCalls = 0
        Mock Resolve-AgentBrowserTarget { $script:v2Target }
        Mock Get-AgentBrowserPageSnapshot {
            $script:v2PageCalls++
            $composer = if ($script:v2PageCalls -eq 1) { '' } else { 'expected prompt' }
            [pscustomobject]@{
                Url = 'https://chatgpt.com/'; UrlExact = $false; ComposerCount = 1; ComposerValue = $composer
                SendCount = if ($script:v2PageCalls -eq 1) { 0 } else { 1 }
                LoginCount = 0; ProCount = 1; SelectedModeControlCount = 1; SelectedModeLabel = 'Pro'; SelectedModeIsPro = $true; SecurityChallengeCount = 0; Generating = $false
                UserTurns = @(); Responses = @(); Target = $script:v2Target
            }
        }
        Mock Invoke-AgentBrowserCliJson {
            param($Arguments)
            if ($Arguments[0] -eq 'click') {
                $script:v2ClickCalls++
                throw (New-SidebarException -ExitCode 10 -Category 'AgentBrowserCliFailed' -Message 'lost result')
            }
            [pscustomobject]@{ ok = $true; result = [pscustomobject]@{ status = 'success'; tab_id = '101'; session_key = 'browser-1:profile-1:101' } }
        }

        Assert-ThrowsCategory -Category 'SendUncertain' -ExitCode 26 -Action {
            Invoke-AgentBrowserSend -PromptText 'expected prompt' -EvidenceDirectory $directory -IdempotencyKeyValue 'v2-click-uncertain' -CodexThreadIdValue $script:v2ThreadId -RequireFreshConversation -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $script:v2Target)
        }
        $script:v2ClickCalls | Should -Be 1
        (Read-EvidenceState -Directory $directory).phase | Should -Be 'send-uncertain'
        (Read-EvidenceState -Directory $directory).automaticResendAllowed | Should -BeFalse
    }

    It 'adopts the same tab URL when the model control hides after exact Pro preflight' {
        $directory = Join-Path $TestDrive 'v2-homepage-send'
        $null = New-Item -ItemType Directory -Path $directory
        $prompt = 'homepage prompt'
        $conversationUrl = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        $exactTarget = [pscustomobject]@{
            BrowserId = $script:v2Target.BrowserId
            ProfileId = $script:v2Target.ProfileId
            ProfileLabel = $script:v2Target.ProfileLabel
            TabId = $script:v2Target.TabId
            SessionKey = $script:v2Target.SessionKey
            Origin = $script:v2Target.Origin
            Url = $conversationUrl
            UrlExact = $true
        }
        $script:v2ResolveCalls = 0
        $script:v2PageCalls = 0
        $script:v2ClickCalls = 0
        Mock Resolve-AgentBrowserTarget {
            $script:v2ResolveCalls++
            if ($script:v2ResolveCalls -ge 4) { return $exactTarget }
            return $script:v2Target
        }
        Mock Get-AgentBrowserPageSnapshot {
            $script:v2PageCalls++
            if ($script:v2PageCalls -eq 1) {
                return [pscustomobject]@{
                    Url = 'https://chatgpt.com/'; UrlExact = $false; ComposerCount = 1; ComposerValue = ''; SendCount = 0
                    LoginCount = 0; ProCount = 1; SelectedModeControlCount = 1; SelectedModeLabel = 'Pro'; SelectedModeIsPro = $true; SecurityChallengeCount = 0; Generating = $false
                    UserTurns = @(); Responses = @(); Target = $script:v2Target
                }
            }
            if ($script:v2PageCalls -le 3) {
                return [pscustomobject]@{
                    Url = 'https://chatgpt.com/'; UrlExact = $false; ComposerCount = 1; ComposerValue = $prompt; SendCount = 1
                    LoginCount = 0; ProCount = 0; SelectedModeControlCount = 0; SelectedModeLabel = ''; SelectedModeIsPro = $false; SecurityChallengeCount = 0; Generating = $false
                    UserTurns = @(); Responses = @(); Target = $script:v2Target
                }
            }
            return [pscustomobject]@{
                Url = $conversationUrl; UrlExact = $true; ComposerCount = 1; ComposerValue = $prompt; SendCount = 0
                LoginCount = 0; ProCount = 0; SelectedModeControlCount = 0; SelectedModeLabel = ''; SelectedModeIsPro = $false; SecurityChallengeCount = 0; Generating = $false
                UserTurns = @(); Responses = @(); Target = $exactTarget
            }
        }
        Mock Invoke-AgentBrowserCliJson {
            param($Arguments)
            if ($Arguments[0] -eq 'click') { $script:v2ClickCalls++ }
            [pscustomobject]@{ ok = $true; result = [pscustomobject]@{ status = 'success'; tab_id = '101'; session_key = 'browser-1:profile-1:101' } }
        }
        Mock Start-Sleep {}

        $result = Invoke-AgentBrowserSend -PromptText $prompt -EvidenceDirectory $directory -IdempotencyKeyValue 'v2-homepage-send' -CodexThreadIdValue $script:v2ThreadId -RequireFreshConversation -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $script:v2Target) -ObservationSecondsValue 0
        $result.conversationUrl | Should -Be $conversationUrl
        $result.targetBinding.tabId | Should -Be '101'
        $result.targetBinding.sessionKey | Should -Be 'browser-1:profile-1:101'
        $result.targetBinding.url | Should -Be $conversationUrl
        $result.selectedModeLabel | Should -Be 'Pro'
        $script:v2ClickCalls | Should -Be 1
        (Read-EvidenceState -Directory $directory).phase | Should -Be 'sent'
    }

    It 'waits through generation without re-requiring the hidden model control' {
        $conversationUrl = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        $exactTarget = [pscustomobject]@{
            BrowserId = $script:v2Target.BrowserId; ProfileId = $script:v2Target.ProfileId
            ProfileLabel = $script:v2Target.ProfileLabel; TabId = $script:v2Target.TabId
            SessionKey = $script:v2Target.SessionKey; Origin = $script:v2Target.Origin
            Url = $conversationUrl; UrlExact = $true
        }
        Mock Resolve-AgentBrowserTarget { $exactTarget }
        Mock Get-AgentBrowserPageSnapshot {
            [pscustomobject]@{
                Url = $conversationUrl; UrlExact = $true; ComposerCount = 1; ComposerValue = ''; SendCount = 0
                LoginCount = 0; ProCount = 0; SelectedModeControlCount = 0; SelectedModeLabel = ''; SelectedModeIsPro = $false
                SecurityChallengeCount = 0; Generating = $true; UserTurns = @(); Responses = @(); Target = $exactTarget
            }
        }

        $observation = Get-AgentBrowserWaitObservation -Binding (ConvertTo-AgentBrowserTargetBinding -Target $exactTarget) -ExpectedConversationUrl $conversationUrl

        $observation.Transient | Should -BeFalse
        $observation.Generating | Should -BeTrue
    }

    It 'keeps observing through a transitional user-turn mismatch until the same tab exposes an exact URL' {
        $directory = Join-Path $TestDrive 'v2-transitional-user-turn'
        $null = New-Item -ItemType Directory -Path $directory
        $prompt = 'transitional prompt'
        $conversationUrl = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        $exactTarget = [pscustomobject]@{
            BrowserId = $script:v2Target.BrowserId
            ProfileId = $script:v2Target.ProfileId
            ProfileLabel = $script:v2Target.ProfileLabel
            TabId = $script:v2Target.TabId
            SessionKey = $script:v2Target.SessionKey
            Origin = $script:v2Target.Origin
            Url = $conversationUrl
            UrlExact = $true
        }
        $script:v2ResolveCalls = 0
        $script:v2PageCalls = 0
        $script:v2ClickCalls = 0
        Mock Resolve-AgentBrowserTarget {
            $script:v2ResolveCalls++
            if ($script:v2ResolveCalls -ge 5) { return $exactTarget }
            return $script:v2Target
        }
        Mock Get-AgentBrowserPageSnapshot {
            $script:v2PageCalls++
            if ($script:v2PageCalls -eq 1) {
                return [pscustomobject]@{
                    Url = 'https://chatgpt.com/'; UrlExact = $false; ComposerCount = 1; ComposerValue = ''; SendCount = 0
                    LoginCount = 0; ProCount = 1; SelectedModeControlCount = 1; SelectedModeLabel = 'Pro'; SelectedModeIsPro = $true; SecurityChallengeCount = 0; Generating = $false
                    UserTurns = @(); Responses = @(); Target = $script:v2Target
                }
            }
            if ($script:v2PageCalls -le 3) {
                return [pscustomobject]@{
                    Url = 'https://chatgpt.com/'; UrlExact = $false; ComposerCount = 1; ComposerValue = $prompt; SendCount = 1
                    LoginCount = 0; ProCount = 1; SelectedModeControlCount = 1; SelectedModeLabel = 'Pro'; SelectedModeIsPro = $true; SecurityChallengeCount = 0; Generating = $false
                    UserTurns = @(); Responses = @(); Target = $script:v2Target
                }
            }
            if ($script:v2PageCalls -eq 4) {
                return [pscustomobject]@{
                    Url = 'https://chatgpt.com/'; UrlExact = $false; ComposerCount = 1; ComposerValue = ''; SendCount = 0
                    LoginCount = 0; ProCount = 1; SelectedModeControlCount = 1; SelectedModeLabel = 'Pro'; SelectedModeIsPro = $true; SecurityChallengeCount = 0; Generating = $false
                    UserTurns = @((New-TestResponse -Text 'transitional a'), (New-TestResponse -Text 'transitional b' -Ordinal 1))
                    Responses = @(); Target = $script:v2Target
                }
            }
            [pscustomobject]@{
                Url = $conversationUrl; UrlExact = $true; ComposerCount = 1; ComposerValue = ''; SendCount = 0
                LoginCount = 0; ProCount = 1; SelectedModeControlCount = 1; SelectedModeLabel = 'Pro'; SelectedModeIsPro = $true; SecurityChallengeCount = 0; Generating = $true
                UserTurns = @(); Responses = @(); Target = $exactTarget
            }
        }
        Mock Invoke-AgentBrowserCliJson {
            param($Arguments)
            if ($Arguments[0] -eq 'click') { $script:v2ClickCalls++ }
            [pscustomobject]@{ ok = $true; result = [pscustomobject]@{ status = 'success'; tab_id = '101'; session_key = 'browser-1:profile-1:101' } }
        }
        Mock Start-Sleep {}

        $result = Invoke-AgentBrowserSend -PromptText $prompt -EvidenceDirectory $directory -IdempotencyKeyValue 'v2-transitional-user-turn' -CodexThreadIdValue $script:v2ThreadId -RequireFreshConversation -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $script:v2Target) -ObservationSecondsValue 180
        $state = Read-EvidenceState -Directory $directory
        $script:v2ClickCalls | Should -Be 1
        $result.conversationUrl | Should -Be $conversationUrl
        $state.conversationUrlBound | Should -Be $conversationUrl
        $state.conversationUrlBindingPending | Should -BeFalse
        $state.attempts[0].generatingObserved | Should -BeTrue
        $state.attempts[0].outcome | Should -Be 'sent-progress'
    }

    It 'uses one background retry only after durable fresh-homepage non-submission proof' {
        $directory = Join-Path $TestDrive 'v2-one-safe-retry'
        $null = New-Item -ItemType Directory -Path $directory
        $prompt = 'retry prompt'
        $conversationUrl = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        $retryTarget = [pscustomobject]@{
            BrowserId = 'browser-1'; ProfileId = 'profile-1'; ProfileLabel = 'work'; TabId = '202'
            SessionKey = 'browser-1:profile-1:202'; Origin = 'https://chatgpt.com'; Url = 'https://chatgpt.com/'; UrlExact = $false
        }
        $exactRetryTarget = [pscustomobject]@{
            BrowserId = 'browser-1'; ProfileId = 'profile-1'; ProfileLabel = 'work'; TabId = '202'
            SessionKey = 'browser-1:profile-1:202'; Origin = 'https://chatgpt.com'; Url = $conversationUrl; UrlExact = $true
        }
        $script:v2Filled = @{}
        $script:v2Clicked = @{}
        $script:v2ClickCalls = 0
        Mock Resolve-AgentBrowserTarget {
            param($ExpectedBinding)
            if ([string](Get-ObjectProperty $ExpectedBinding 'tabId' '') -eq '202') {
                if ($script:v2Clicked['202']) { return $exactRetryTarget }
                return $retryTarget
            }
            return $script:v2Target
        }
        Mock Invoke-AgentBrowserOpenFreshTab { $retryTarget }
        Mock Get-AgentBrowserPageSnapshot {
            param($Target)
            $tab = [string]$Target.TabId
            if ($script:v2Clicked[$tab]) {
                if ($tab -eq '202') {
                    return [pscustomobject]@{
                        Url = $conversationUrl; UrlExact = $true; ComposerCount = 1; ComposerValue = ''; SendCount = 0
                        LoginCount = 0; ProCount = 1; SelectedModeControlCount = 1; SelectedModeLabel = 'Pro'; SelectedModeIsPro = $true; SecurityChallengeCount = 0; Generating = $true
                        UserTurns = @(); Responses = @(); Target = $exactRetryTarget
                    }
                }
                return [pscustomobject]@{
                    Url = 'https://chatgpt.com/'; UrlExact = $false; ComposerCount = 1; ComposerValue = $prompt; SendCount = 1
                    LoginCount = 0; ProCount = 1; SelectedModeControlCount = 1; SelectedModeLabel = 'Pro'; SelectedModeIsPro = $true; SecurityChallengeCount = 0; Generating = $false
                    UserTurns = @(); Responses = @(); Target = $script:v2Target
                }
            }
            [pscustomobject]@{
                Url = 'https://chatgpt.com/'; UrlExact = $false; ComposerCount = 1
                ComposerValue = if ($script:v2Filled[$tab]) { $prompt } else { '' }
                SendCount = if ($script:v2Filled[$tab]) { 1 } else { 0 }
                LoginCount = 0; ProCount = 1; SelectedModeControlCount = 1; SelectedModeLabel = 'Pro'; SelectedModeIsPro = $true; SecurityChallengeCount = 0; Generating = $false
                UserTurns = @(); Responses = @(); Target = $Target
            }
        }
        Mock Invoke-AgentBrowserCliJson {
            param($Arguments)
            $tab = [string]$Arguments[$Arguments.IndexOf('--tab') + 1]
            if ($Arguments[0] -eq 'fill') { $script:v2Filled[$tab] = $true }
            if ($Arguments[0] -eq 'click') { $script:v2Clicked[$tab] = $true; $script:v2ClickCalls++ }
            [pscustomobject]@{ ok = $true; result = [pscustomobject]@{ status = 'success'; tab_id = $tab; session_key = "browser-1:profile-1:$tab" } }
        }
        Mock Start-Sleep {}

        $result = Invoke-AgentBrowserSend -PromptText $prompt -EvidenceDirectory $directory -IdempotencyKeyValue 'v2-one-safe-retry' -CodexThreadIdValue $script:v2ThreadId -RequireFreshConversation -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $script:v2Target) -ObservationSecondsValue 0
        $state = Read-EvidenceState -Directory $directory
        $script:v2ClickCalls | Should -Be 2
        $result.attemptCount | Should -Be 2
        $state.idempotencyKey | Should -Be 'v2-one-safe-retry'
        $state.attempts.Count | Should -Be 2
        $state.attempts[0].outcome | Should -Be 'proved-not-submitted'
        $state.attempts[1].outcome | Should -Be 'sent-progress'
        ([DateTime]$state.responseDeadlineAtUtc - [DateTime]$state.firstClickAtUtc).TotalSeconds | Should -Be 7200
    }

    It 'stops after two proved non-submissions and never performs a third click' {
        $directory = Join-Path $TestDrive 'v2-retry-not-submitted'
        $null = New-Item -ItemType Directory -Path $directory
        $prompt = 'never submitted prompt'
        $retryTarget = [pscustomobject]@{
            BrowserId = 'browser-1'; ProfileId = 'profile-1'; ProfileLabel = 'work'; TabId = '202'
            SessionKey = 'browser-1:profile-1:202'; Origin = 'https://chatgpt.com'; Url = 'https://chatgpt.com/'; UrlExact = $false
        }
        $script:v2Filled = @{}
        $script:v2ClickCalls = 0
        Mock Resolve-AgentBrowserTarget {
            param($ExpectedBinding)
            if ([string](Get-ObjectProperty $ExpectedBinding 'tabId' '') -eq '202') { return $retryTarget }
            return $script:v2Target
        }
        Mock Invoke-AgentBrowserOpenFreshTab { $retryTarget }
        Mock Get-AgentBrowserPageSnapshot {
            param($Target)
            $tab = [string]$Target.TabId
            [pscustomobject]@{
                Url = 'https://chatgpt.com/'; UrlExact = $false; ComposerCount = 1
                ComposerValue = if ($script:v2Filled[$tab]) { $prompt } else { '' }
                SendCount = if ($script:v2Filled[$tab]) { 1 } else { 0 }
                LoginCount = 0; ProCount = 1; SelectedModeControlCount = 1; SelectedModeLabel = 'Pro'; SelectedModeIsPro = $true; SecurityChallengeCount = 0; Generating = $false
                UserTurns = @(); Responses = @(); Target = $Target
            }
        }
        Mock Invoke-AgentBrowserCliJson {
            param($Arguments)
            $tab = [string]$Arguments[$Arguments.IndexOf('--tab') + 1]
            if ($Arguments[0] -eq 'fill') { $script:v2Filled[$tab] = $true }
            if ($Arguments[0] -eq 'click') { $script:v2ClickCalls++ }
            [pscustomobject]@{ ok = $true; result = [pscustomobject]@{ status = 'success'; tab_id = $tab; session_key = "browser-1:profile-1:$tab" } }
        }
        Mock Start-Sleep {}

        Assert-ThrowsCategory -Category 'RetryNotSubmitted' -ExitCode 26 -Action {
            Invoke-AgentBrowserSend -PromptText $prompt -EvidenceDirectory $directory -IdempotencyKeyValue 'v2-retry-not-submitted' -CodexThreadIdValue $script:v2ThreadId -RequireFreshConversation -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $script:v2Target) -ObservationSecondsValue 0
        }
        $state = Read-EvidenceState -Directory $directory
        $script:v2ClickCalls | Should -Be 2
        $state.attemptCount | Should -Be 2
        $state.retryOutcome | Should -Be 'retry-not-submitted'
        $state.automaticResendAllowed | Should -BeFalse
    }

    It 'requires manual recovery without retry when the first composer proof is lost' {
        $directory = Join-Path $TestDrive 'v2-recovery-required'
        $null = New-Item -ItemType Directory -Path $directory
        $prompt = 'uncertain prompt'
        $script:v2Filled = $false
        $script:v2Clicked = $false
        $script:v2ClickCalls = 0
        Mock Resolve-AgentBrowserTarget { $script:v2Target }
        Mock Get-AgentBrowserPageSnapshot {
            $composer = if (-not $script:v2Filled) { '' } elseif ($script:v2Clicked) { '' } else { $prompt }
            [pscustomobject]@{
                Url = 'https://chatgpt.com/'; UrlExact = $false; ComposerCount = 1; ComposerValue = $composer
                SendCount = if ($script:v2Filled) { 1 } else { 0 }
                LoginCount = 0; ProCount = 1; SelectedModeControlCount = 1; SelectedModeLabel = 'Pro'; SelectedModeIsPro = $true; SecurityChallengeCount = 0; Generating = $false
                UserTurns = @(); Responses = @(); Target = $script:v2Target
            }
        }
        Mock Invoke-AgentBrowserCliJson {
            param($Arguments)
            if ($Arguments[0] -eq 'fill') { $script:v2Filled = $true }
            if ($Arguments[0] -eq 'click') { $script:v2Clicked = $true; $script:v2ClickCalls++ }
            [pscustomobject]@{ ok = $true; result = [pscustomobject]@{ status = 'success'; tab_id = '101'; session_key = 'browser-1:profile-1:101' } }
        }
        Mock Start-Sleep {}

        Assert-ThrowsCategory -Category 'RecoveryRequired' -ExitCode 26 -Action {
            Invoke-AgentBrowserSend -PromptText $prompt -EvidenceDirectory $directory -IdempotencyKeyValue 'v2-recovery-required' -CodexThreadIdValue $script:v2ThreadId -RequireFreshConversation -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $script:v2Target) -ObservationSecondsValue 0
        }
        $script:v2ClickCalls | Should -Be 1
        (Read-EvidenceState -Directory $directory).retryOutcome | Should -Be 'recovery-required'
    }

    It 'recovers an unbound uncertain homepage send only after the same prompt turn is proved' {
        $directory = Join-Path $TestDrive 'v2-unbound-uncertain-recovery'
        $null = New-Item -ItemType Directory -Path $directory
        $prompt = 'recover exact prompt'
        Write-Utf8NoBomAtomic -Path (Join-Path $directory 'prompt.md') -Text $prompt
        $state = New-SendIntentState `
            -PromptSha256 (Get-Sha256Text -Text $prompt) `
            -IdempotencyKeyValue 'v2-unbound-uncertain-recovery' `
            -IdempotencyKeySha256 (Get-Sha256Text -Text 'v2-unbound-uncertain-recovery') `
            -BaselineHashes @() `
            -Transport $Script:AgentBrowserTransport `
            -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $script:v2Target) `
            -CodexThreadIdValue $script:v2ThreadId
        Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'send-uncertain'
        Set-ObjectProperty -InputObject $state -Name 'invokeAttempted' -Value $true
        Set-ObjectProperty -InputObject $state -Name 'invokeReturned' -Value $true
        Set-ObjectProperty -InputObject $state -Name 'baselineUserTurnSha256' -Value @()
        Write-EvidenceState -Directory $directory -State $state

        $conversationUrl = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        $exactTarget = [pscustomobject]@{
            BrowserId = $script:v2Target.BrowserId; ProfileId = $script:v2Target.ProfileId
            ProfileLabel = $script:v2Target.ProfileLabel; TabId = $script:v2Target.TabId
            SessionKey = $script:v2Target.SessionKey; Origin = $script:v2Target.Origin
            Url = $conversationUrl; UrlExact = $true
        }
        Mock Resolve-AgentBrowserTarget { $exactTarget }
        Mock Get-AgentBrowserPageSnapshot {
            [pscustomobject]@{
                Url = $conversationUrl; UrlExact = $true; ComposerCount = 1; ComposerValue = ''; SendCount = 0
                LoginCount = 0; ProCount = 1; SelectedModeControlCount = 1; SelectedModeLabel = 'Pro'; SelectedModeIsPro = $true; SecurityChallengeCount = 0; Generating = $false
                UserTurns = @(New-TestResponse -Text $prompt); Responses = @(New-TestResponse -Text 'observed answer')
                Target = $exactTarget
            }
        }
        Mock Start-Sleep {}

        $null = Reserve-AgentBrowserTargetClaim `
            -CodexThreadIdValue $script:v2ThreadId `
            -EvidenceDirectory $directory `
            -IdempotencyKeySha256Value (Get-Sha256Text -Text 'v2-unbound-uncertain-recovery') `
            -Binding (ConvertTo-AgentBrowserTargetBinding -Target $script:v2Target)
        $result = Invoke-AgentBrowserWait -EvidenceDirectory $directory -TimeoutSecondsValue 5 -PollMillisecondsValue 250 -CodexThreadIdValue $script:v2ThreadId
        $persisted = Read-EvidenceState -Directory $directory
        $result.completed | Should -BeTrue
        $result.observationalRecovery | Should -BeTrue
        $result.submissionAcknowledged | Should -BeTrue
        $persisted.conversationUrlBound | Should -Be $conversationUrl
        $persisted.targetClaimKeySha256 | Should -Not -BeNullOrEmpty
        $persisted.phase | Should -Be 'completed'
    }

    It 'keeps the active dispatcher on V2 and leaves UIA unreachable' {
        $source = [System.IO.File]::ReadAllText($scriptPath)
        $dispatcher = [regex]::Match($source, '(?s)function Invoke-MainCommand\s*\{.*?(?=\r?\nif \(\$MyInvocation\.InvocationName)').Value
        $dispatcher | Should -Match 'Invoke-AgentBrowserSend'
        $dispatcher | Should -Match 'Invoke-AgentBrowserWait'
        $dispatcher | Should -Not -Match 'Initialize-LiveUiAutomation|Invoke-LiveSend|Invoke-LiveWait|Invoke-LiveNewChat'
    }

    It 'uses only the fixed structural DOM script and never embeds prompt or credential reads' {
        $domScriptPath = Join-Path (Split-Path -Parent $scriptPath) 'chatgpt-pro-agent-browser-v2.js'
        $source = [System.IO.File]::ReadAllText($domScriptPath)
        $modelScriptPath = Join-Path (Split-Path -Parent $scriptPath) 'chatgpt-pro-agent-browser-select-pro.js'
        $modelSource = [System.IO.File]::ReadAllText($modelScriptPath)
        $source | Should -Match '#prompt-textarea'
        $source | Should -Match 'button\[data-testid="send-button"\]'
        $source | Should -Match 'data-message-author-role'
        $source | Should -Match 'code\.user-message-inline-code'
        $source | Should -Match "block\.firstElementChild\.tagName === 'BR'"
        $source | Should -Match "nodePlainText\(block\)\)\.join\('\\n'\)"
        $source | Should -Match 'composerPlainText\(composers\[0\]\)'
        $source | Should -Not -Match 'document\.cookie|localStorage|sessionStorage|fetch\(|XMLHttpRequest|promptText'
        $modelSource | Should -Match 'button\[aria-haspopup="menu"\]'
        $modelSource | Should -Match '\[role="menuitemradio"\]'
        $modelSource | Should -Match "label\(element\) === 'Pro'"
        $modelSource | Should -Not -Match 'data-message-author-role|document\.cookie|localStorage|sessionStorage|fetch\(|XMLHttpRequest|promptText'
    }
}
