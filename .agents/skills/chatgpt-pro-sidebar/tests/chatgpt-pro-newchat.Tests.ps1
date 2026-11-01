#requires -Version 5.1
#requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
BeforeAll {
    . (Join-Path $PSScriptRoot '../scripts/chatgpt-pro-sidebar.ps1')
}
Describe 'Exact newly opened tab proof' {
    BeforeEach {
        $script:testClock = [DateTime]::UtcNow
        $script:probeCount = 0
        $script:probeBudgets = @()
        $script:source = [pscustomobject]@{ BrowserId='browser-1'; ProfileId='profile-1'; ProfileLabel='work'; TabId='101'; SessionKey='browser-1:profile-1:101' }
        Mock Start-Sleep { param($Milliseconds) $script:testClock=$script:testClock.AddMilliseconds($Milliseconds) }
        Mock Invoke-AgentBrowserCliJson {
            param($Arguments)
            if ($Arguments[0] -ne 'open') { throw 'Tab enumeration must not choose the opened identity.' }
            [pscustomobject]@{ok=$true;result=[pscustomobject]@{status='success';opened_tab_id='202';opened_session_key='browser-1:profile-1:202';metadata=[pscustomobject]@{executor=[pscustomobject]@{tab_id='101';session_key='browser-1:profile-1:101'}}}}
        }
        Mock Get-AgentBrowserPageSnapshot {
            param($Target,$TimeoutMilliseconds)
            $script:probeCount++
            $script:probeBudgets += $TimeoutMilliseconds
            if ($script:probeCount -eq 1) { Throw-SidebarError -ExitCode 10 -Category 'AgentBrowserCliFailed' -Message 'Session not registered yet.' }
            [pscustomobject]@{Url='https://chatgpt.com/';UrlExact=$false}
        }
    }
    It 'proves the actual returned session after registration delay without tab enumeration' {
        $target=Invoke-AgentBrowserOpenFreshTab -CurrentTarget $script:source -BindOnly -UtcNowProvider { $script:testClock }
        $target.TabId | Should -BeExactly '202'
        $target.SessionKey | Should -BeExactly 'browser-1:profile-1:202'
        $script:probeCount | Should -Be 2
        $script:probeBudgets[0] | Should -Be 10000
        $script:probeBudgets[1] | Should -Be 9750
        Should -Invoke Invoke-AgentBrowserCliJson -Times 1 -Exactly
    }
    It 'rejects a returned session from another profile before DOM access' {
        Mock Invoke-AgentBrowserCliJson { [pscustomobject]@{result=[pscustomobject]@{opened_tab_id='202';opened_session_key='browser-1:other-profile:202'}} }
        try { Invoke-AgentBrowserOpenFreshTab -CurrentTarget $script:source -BindOnly; throw 'Expected rejection.' }
        catch { (Get-ExceptionCategory -Exception $_.Exception) | Should -BeExactly 'AgentBrowserOpenIdentityMismatch' }
        Should -Invoke Get-AgentBrowserPageSnapshot -Times 0 -Exactly
    }
    It 'never retries an executor identity mismatch' {
        Mock Get-AgentBrowserPageSnapshot { Throw-SidebarError -ExitCode 20 -Category 'AgentBrowserCommandTargetMismatch' -Message 'Wrong session.' }
        try { Invoke-AgentBrowserOpenFreshTab -CurrentTarget $script:source -BindOnly; throw 'Expected rejection.' }
        catch { (Get-ExceptionCategory -Exception $_.Exception) | Should -BeExactly 'AgentBrowserCommandTargetMismatch' }
        Should -Invoke Get-AgentBrowserPageSnapshot -Times 1 -Exactly
        Should -Invoke Start-Sleep -Times 0 -Exactly
    }
    It 'rejects contradictory execution metadata even when the reported result binding matches' {
        $envelope=[pscustomobject]@{result=[pscustomobject]@{tab_id='101';session_key='browser-1:profile-1:101';metadata=[pscustomobject]@{executor=[pscustomobject]@{tab_id='202';session_key='browser-1:profile-1:202'}}}}
        try { Assert-AgentBrowserCommandResultBinding -Envelope $envelope -Target $script:source; throw 'Expected rejection.' }
        catch { (Get-ExceptionCategory -Exception $_.Exception) | Should -BeExactly 'AgentBrowserCommandTargetMismatch' }
    }
    It 'rejects a conversation page instead of accepting it as a fresh homepage' {
        Mock Get-AgentBrowserPageSnapshot { [pscustomobject]@{Url='https://chatgpt.com/c/12345678-1234';UrlExact=$true} }
        try { Invoke-AgentBrowserOpenFreshTab -CurrentTarget $script:source -BindOnly; throw 'Expected rejection.' }
        catch { (Get-ExceptionCategory -Exception $_.Exception) | Should -BeExactly 'AgentBrowserOpenTargetUnproved' }
        Should -Invoke Start-Sleep -Times 0 -Exactly
    }
    It 'expires once within the original ten-second budget and retains exact opened identity' {
        Mock Get-AgentBrowserPageSnapshot { Throw-SidebarError -ExitCode 10 -Category 'AgentBrowserCliFailed' -Message 'Unavailable.' }
        try { Invoke-AgentBrowserOpenFreshTab -CurrentTarget $script:source -BindOnly -UtcNowProvider { $script:testClock }; throw 'Expected rejection.' }
        catch {
            (Get-ExceptionCategory -Exception $_.Exception) | Should -BeExactly 'AgentBrowserOpenTargetUnproved'
            $details=Get-ExceptionDetails -Exception $_.Exception
            $details.openedTarget.tabId | Should -BeExactly '202'
            $details.bindAttempts | Should -Be 40
            $details.bindTimeoutMilliseconds | Should -Be 10000
            $details.lastFailureCategory | Should -BeExactly 'AgentBrowserCliFailed'
        }
        Should -Invoke Invoke-AgentBrowserCliJson -Times 1 -Exactly
    }
    It 'passes the remaining process budget through fixed DOM inspection' {
        $source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../scripts/chatgpt-pro-sidebar.ps1'))
        $snapshot=[regex]::Match($source,'(?s)function Get-AgentBrowserPageSnapshot\s*\{.*?(?=\r?\nfunction )').Value
        $snapshot | Should -Match 'Invoke-AgentBrowserCliJson -Arguments \$arguments -TimeoutMilliseconds \$TimeoutMilliseconds'
        $invoker=[regex]::Match($source,'(?s)function Invoke-AgentBrowserCliJson\s*\{.*?(?=\r?\nfunction )').Value
        $invoker | Should -Match 'UtcNow.AddMilliseconds\(\$TimeoutMilliseconds\)'
    }
}
