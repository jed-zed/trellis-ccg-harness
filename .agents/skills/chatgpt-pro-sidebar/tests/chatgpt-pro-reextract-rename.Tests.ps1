#requires -Version 5.1
#requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
BeforeAll {
    . (Join-Path $PSScriptRoot '../scripts/chatgpt-pro-sidebar.ps1')
    function Start-ChildFileLock {
        param([string]$FilePath,[string]$ReadyPath,[string]$ReleasePath,[string]$DonePath)
        $job=Start-Job -ArgumentList $FilePath,$ReadyPath,$ReleasePath,$DonePath -ScriptBlock {
            param($FilePath,$ReadyPath,$ReleasePath,$DonePath)
            $stream=[IO.FileStream]::new($FilePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
            try {
                [IO.File]::WriteAllText($ReadyPath,'locked without delete sharing')
                $deadline=[DateTime]::UtcNow.AddSeconds(20)
                while(-not [IO.File]::Exists($ReleasePath) -and [DateTime]::UtcNow -lt $deadline) {[Threading.Thread]::Sleep(10)}
            } finally {$stream.Dispose()}
            [IO.File]::WriteAllText($DonePath,'released')
        }
        $deadline=[DateTime]::UtcNow.AddSeconds(10)
        while(-not [IO.File]::Exists($ReadyPath) -and [DateTime]::UtcNow -lt $deadline) {[Threading.Thread]::Sleep(20)}
        if(-not [IO.File]::Exists($ReadyPath)) {Stop-Job $job; Receive-Job $job; Remove-Job $job; throw 'Child file lock was not ready.'}
        return $job
    }
    function Stop-ChildFileLock {
        param($Job,[string]$ReleasePath)
        [IO.File]::WriteAllText($ReleasePath,'release')
        Wait-Job -Job $Job -Timeout 5 | Out-Null
        if($Job.State -eq 'Running') {Stop-Job $Job}
        Receive-Job $Job | Out-Null
        Remove-Job $Job
    }
}
Describe 'Bounded exclusive reextraction rename recovery' {
    BeforeEach {
        $script:parent=Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $script:staging=Join-Path $script:parent '.reextraction-staging-owned'
        [IO.Directory]::CreateDirectory($script:staging) | Out-Null
        $script:responsePath=Join-Path $script:staging 'response.md'
        [IO.File]::WriteAllText($script:responsePath,'complete immutable response')
        $script:ready=Join-Path $script:parent 'ready'
        $script:release=Join-Path $script:parent 'release'
        $script:done=Join-Path $script:parent 'done'
        $script:retrySleeps=0
        Mock Start-Sleep {param($Milliseconds) $script:retrySleeps++; [Threading.Thread]::Sleep($Milliseconds)}
    }
    It 'retries the proved child-handle AccessDenied once after the child releases it' {
        $job=Start-ChildFileLock -FilePath $script:responsePath -ReadyPath $script:ready -ReleasePath $script:release -DonePath $script:done
        try {
            $native=$null
            try {[IO.Directory]::Move($script:staging,(Join-Path $script:parent 'native-probe'))} catch {$native=$_.Exception.GetBaseException()}
            $native | Should -Not -BeNullOrEmpty
            $native.HResult | Should -Be -2147024891
            Mock Start-Sleep {
                param($Milliseconds)
                $script:retrySleeps++
                [IO.File]::WriteAllText($script:release,'release on first retry')
                $deadline=[DateTime]::UtcNow.AddSeconds(5)
                while(-not [IO.File]::Exists($script:done) -and [DateTime]::UtcNow -lt $deadline) {[Threading.Thread]::Sleep(10)}
                if(-not [IO.File]::Exists($script:done)) {throw 'Child did not release its file lock.'}
                [Threading.Thread]::Sleep($Milliseconds)
            }
            $output=Move-ReextractionToNextRevision -StagingDirectory $script:staging -ParentDirectory $script:parent
            $script:retrySleeps | Should -Be 1
            $output | Should -BeExactly (Join-Path $script:parent 'reextraction')
            [IO.File]::ReadAllText((Join-Path $output 'response.md')) | Should -BeExactly 'complete immutable response'
        } finally {Stop-ChildFileLock -Job $job -ReleasePath $script:release}
    }
    It 'exhausts exactly three short retries and preserves the actual IOException and staging content' {
        $job=Start-ChildFileLock -FilePath $script:responsePath -ReadyPath $script:ready -ReleasePath $script:release -DonePath $script:done
        try {
            $caught=$null
            try {Move-ReextractionToNextRevision -StagingDirectory $script:staging -ParentDirectory $script:parent} catch {$caught=$_.Exception.GetBaseException()}
            $caught | Should -BeOfType ([IO.IOException])
            $caught.HResult | Should -Be -2147024891
            $script:retrySleeps | Should -Be 3
            Should -Invoke Start-Sleep -Times 3 -Exactly -ParameterFilter {$Milliseconds -eq 50}
            [IO.File]::ReadAllText($script:responsePath) | Should -BeExactly 'complete immutable response'
            Test-Path -LiteralPath (Join-Path $script:parent 'reextraction') | Should -BeFalse
        } finally {Stop-ChildFileLock -Job $job -ReleasePath $script:release}
    }
    It 'chooses the next revision when another output appears during the retry without overwriting it' {
        $job=Start-ChildFileLock -FilePath $script:responsePath -ReadyPath $script:ready -ReleasePath $script:release -DonePath $script:done
        try {
            Mock Start-Sleep {
                param($Milliseconds)
                $script:retrySleeps++
                $winner=Join-Path $script:parent 'reextraction'
                [IO.Directory]::CreateDirectory($winner) | Out-Null
                [IO.File]::WriteAllText((Join-Path $winner 'response.md'),'other completed result')
                [IO.File]::WriteAllText($script:release,'release')
                $deadline=[DateTime]::UtcNow.AddSeconds(5)
                while(-not [IO.File]::Exists($script:done) -and [DateTime]::UtcNow -lt $deadline) {[Threading.Thread]::Sleep(10)}
                if(-not [IO.File]::Exists($script:done)) {throw 'Child did not release its file lock.'}
            }
            $output=Move-ReextractionToNextRevision -StagingDirectory $script:staging -ParentDirectory $script:parent
            $output | Should -BeExactly (Join-Path $script:parent 'reextraction-2')
            [IO.File]::ReadAllText((Join-Path $script:parent 'reextraction/response.md')) | Should -BeExactly 'other completed result'
            [IO.File]::ReadAllText((Join-Path $output 'response.md')) | Should -BeExactly 'complete immutable response'
        } finally {Stop-ChildFileLock -Job $job -ReleasePath $script:release}
    }
}
