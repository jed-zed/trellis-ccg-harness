#requires -Version 5.1
#requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $bridge = Split-Path -Parent $PSScriptRoot
    . (Join-Path $bridge 'scripts/chatgpt-pro-sidebar.ps1')
    . (Join-Path $bridge 'scripts/chatgpt-pro-sidebar-watch.ps1')
}

Describe 'Atomic evidence replacement under Windows readers' {
    It 'retries a sharing violation only after preserving the old bytes for <Writer>' -ForEach @(
        @{ Writer = 'Write-Utf8NoBomAtomic' }, @{ Writer = 'Write-WatchTextAtomic' }
    ) {
        $path = Join-Path $TestDrive ($Writer + '-transient.json')
        [IO.File]::WriteAllText($path, '{"phase":"old"}', $Script:Utf8NoBom)
        $script:atomicReadLock = [IO.File]::Open($path, 'Open', 'Read', 'Read')
        Mock Start-Sleep {
            [IO.File]::ReadAllText($path) | Should -BeExactly '{"phase":"old"}'
            $script:atomicReadLock.Dispose()
        } -ParameterFilter { $Milliseconds -eq 50 }
        try {
            & $Writer -Path $path -Text '{"phase":"new"}'
            [IO.File]::ReadAllText($path) | Should -BeExactly '{"phase":"new"}'
            Should -Invoke Start-Sleep -Times 1 -ParameterFilter { $Milliseconds -eq 50 }
        } finally { $script:atomicReadLock.Dispose() }
    }

    It 'fails a persistent lock with original diagnostics and old bytes for <Writer>' -ForEach @(
        @{ Writer = 'Write-Utf8NoBomAtomic' }, @{ Writer = 'Write-WatchTextAtomic' }
    ) {
        $path = Join-Path $TestDrive ($Writer + '-persistent.json')
        [IO.File]::WriteAllText($path, '{"phase":"old"}', $Script:Utf8NoBom)
        $handle = [IO.File]::Open($path, 'Open', 'Read', 'Read')
        Mock Start-Sleep {} -ParameterFilter { $Milliseconds -eq 50 }
        try {
            $failure = $null
            try { & $Writer -Path $path -Text '{"phase":"new"}' } catch { $failure = $_ }
            $failure | Should -Not -BeNullOrEmpty
            $failure.Exception.GetBaseException().HResult | Should -Be -2147024864
            $diagnostics = Get-SafeErrorDiagnostics -Exception $failure.Exception -ErrorRecord $failure
            $diagnostics.innerHResult | Should -Be -2147024864
            $diagnostics.scriptName | Should -BeExactly 'chatgpt-pro-atomic-file.ps1'
            $diagnostics.line | Should -BeGreaterThan 0
            (ConvertTo-WatchSafeDiagnostics -Diagnostics $diagnostics).scriptName | Should -BeExactly 'chatgpt-pro-atomic-file.ps1'
            [IO.File]::ReadAllText($path) | Should -BeExactly '{"phase":"old"}'
            Should -Invoke Start-Sleep -Times 19 -Exactly -ParameterFilter { $Milliseconds -eq 50 }
        } finally { $handle.Dispose() }
    }

    It 'does not retry an unrelated missing-source I/O error' {
        $path = Join-Path $TestDrive 'missing-source.json'
        [IO.File]::WriteAllText($path, 'original', $Script:Utf8NoBom)
        Mock Start-Sleep {}
        $failure = $null
        try { Complete-BridgeAtomicFile -TemporaryPath (Join-Path $TestDrive 'absent.tmp') -Path $path -BackupPath (Join-Path $TestDrive 'absent.bak') } catch { $failure = $_ }
        $failure.Exception.GetBaseException() | Should -BeOfType ([IO.FileNotFoundException])
        Should -Invoke Start-Sleep -Times 0 -Exactly
        [IO.File]::ReadAllText($path) | Should -BeExactly 'original'
    }

    It 'reads complete UTF-8 with a stream that allows replacement' {
        $path = Join-Path $TestDrive 'shared-read.json'
        Write-Utf8NoBomAtomic -Path $path -Text '{"value":"old"}'
        $reader = Open-BridgeTextReader -Path $path
        try {
            Write-WatchTextAtomic -Path $path -Text '{"value":"new"}'
            $reader.ReadToEnd() | Should -BeExactly '{"value":"old"}'
            Read-BridgeText -Path $path | Should -BeExactly '{"value":"new"}'
        } finally { $reader.Dispose() }
    }
}
