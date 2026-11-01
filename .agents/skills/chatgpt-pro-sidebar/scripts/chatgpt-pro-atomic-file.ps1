#requires -Version 5.1

function Complete-BridgeAtomicFile {
    param(
        [Parameter(Mandatory = $true)][string]$TemporaryPath,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$BackupPath,
        [switch]$IgnoreMetadataErrors
    )

    # ponytail: one bounded retry owner for short external Windows reader locks.
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        try {
            if ([IO.File]::Exists($Path)) {
                [IO.File]::Replace($TemporaryPath, $Path, $BackupPath, [bool]$IgnoreMetadataErrors)
            }
            else {
                [IO.File]::Move($TemporaryPath, $Path)
            }
            return
        }
        catch {
            $cause = $_.Exception.GetBaseException()
            if ($cause -isnot [IO.IOException] -or $cause.HResult -ne -2147024864 -or $attempt -eq 20) { throw }
            Start-Sleep -Milliseconds 50
        }
    }
}

function Open-BridgeTextReader {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Text.Encoding]$Encoding = [Text.UTF8Encoding]::new($false)
    )

    $stream = [IO.FileStream]::new($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    try { return [IO.StreamReader]::new($stream, $Encoding, $true) }
    catch { $stream.Dispose(); throw }
}

function Read-BridgeText {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Text.Encoding]$Encoding = [Text.UTF8Encoding]::new($false)
    )

    $reader = Open-BridgeTextReader -Path $Path -Encoding $Encoding
    try { return $reader.ReadToEnd() }
    finally { $reader.Dispose() }
}
