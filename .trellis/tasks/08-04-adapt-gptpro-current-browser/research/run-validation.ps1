#requires -Version 5.1
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$skillRoot = 'I:\ai\trellis-ccg-harness\.agents\skills\chatgpt-pro-sidebar'
$paths = @(
    (Join-Path $skillRoot 'scripts\chatgpt-pro-sidebar.ps1'),
    (Join-Path $skillRoot 'scripts\chatgpt-pro-sidebar-watch.ps1'),
    (Join-Path $skillRoot 'tests\chatgpt-pro-sidebar.Tests.ps1'),
    (Join-Path $skillRoot 'tests\chatgpt-pro-sidebar-watch.Tests.ps1'),
    (Join-Path $skillRoot 'tests\chatgpt-pro-sidebar-stop-hook.Tests.ps1')
)

foreach ($path in $paths) {
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count) {
        $errors | Format-List -Force
        throw "PowerShell parse failed: $path"
    }
}
Write-Output ('PARSE_OK=' + $paths.Count)

$pesterPath = 'I:\ai\trellis-ccg-harness\.ccg\tools\Pester\5.7.1\Pester.psd1'
if (-not [System.IO.File]::Exists($pesterPath)) {
    throw 'The project-local Pester 5.7.1 module is missing.'
}
Import-Module $pesterPath -Force
$result = Invoke-Pester -Path (Join-Path $skillRoot 'tests') -Output Detailed -PassThru
[pscustomobject]@{
    Result = $result.Result
    Total = $result.TotalCount
    Passed = $result.PassedCount
    Failed = $result.FailedCount
    Skipped = $result.SkippedCount
    DurationSeconds = [math]::Round($result.Duration.TotalSeconds, 3)
} | ConvertTo-Json -Compress
if ($result.FailedCount -gt 0) { exit 1 }
