#requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
BeforeAll {
    $candidate = Split-Path -Parent $PSScriptRoot
    . (Join-Path $candidate 'scripts/chatgpt-pro-sidebar.ps1')
    . (Join-Path $candidate 'scripts/chatgpt-pro-upload.ps1')
    function Get-ManifestFailureCategory {
        param([string]$Path)
        try { $null = Read-ApprovedUploadManifest -Path $Path } catch { return Get-ExceptionCategory -Exception $_.Exception }
        return '<no exception>'
    }
    function New-ManifestFixture {
        param([string]$Name, [string]$Json)
        $path = Join-Path $TestDrive $Name
        [IO.File]::WriteAllText($path, $Json)
        $path
    }
}
Describe 'Upload manifest validation before target binding' {
    BeforeAll { Mock Invoke-AgentBrowserCliJson { throw 'Manifest validation must not reach the browser.' } }
    It 'rejects a missing manifest' {
        Get-ManifestFailureCategory -Path (Join-Path $TestDrive 'absent.json') | Should -Be 'AttachmentManifestMissing'
    }
    It 'rejects a manifest over 64 KiB' {
        $path = Join-Path $TestDrive 'oversize.json'
        [IO.File]::WriteAllBytes($path, [byte[]](,0x20 * 65537))
        Get-ManifestFailureCategory -Path $path | Should -Be 'AttachmentManifestOverLimit'
    }
    It 'rejects a manifest with no files' {
        $path = New-ManifestFixture 'files0.json' '{"schemaVersion":1,"files":[]}'
        Get-ManifestFailureCategory -Path $path | Should -Be 'AttachmentManifestInvalid'
    }
    It 'rejects a manifest with seven files' {
        $path = New-ManifestFixture 'files7.json' ('{"schemaVersion":1,"files":[' + ((1..7 | ForEach-Object { '{}' }) -join ',') + ']}')
        Get-ManifestFailureCategory -Path $path | Should -Be 'AttachmentManifestInvalid'
    }
    It 'rejects an unsupported schema version' {
        $path = New-ManifestFixture 'schema2.json' '{"schemaVersion":2,"files":[{}]}'
        Get-ManifestFailureCategory -Path $path | Should -Be 'AttachmentManifestInvalid'
    }
}
