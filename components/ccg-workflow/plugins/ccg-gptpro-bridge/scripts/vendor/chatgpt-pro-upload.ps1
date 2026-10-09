# Fixed formal ZIP entry. Dot-source only from the approved adapter.
function Throw-UploadError {
    param([string]$Category,[string]$Message)
    Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category $Category -Message $Message
}
function Assert-UploadBindingEqual {
    param($Expected,$Actual)
    $null=Assert-AgentBrowserTargetBindingComplete -Binding $Expected
    $null=Assert-AgentBrowserTargetBindingComplete -Binding $Actual
    foreach($name in @('browserId','profileId','tabId','sessionKey','origin','url')) {
        if([string](Get-ObjectProperty $Expected $name '') -cne [string](Get-ObjectProperty $Actual $name '')) {Throw-UploadError 'AttachmentBindingMismatch' 'The exact browser/profile/tab/session and homepage binding must match.'}
    }
    if([string](Get-ObjectProperty $Expected 'url' '') -cne 'https://chatgpt.com/'){Throw-UploadError 'AttachmentBindingMismatch' 'Only the approved independent homepage is allowed.'}
}
function Read-ApprovedUploadManifest {
    param([Parameter(Mandatory=$true)][string]$Path)
    if (-not [System.IO.File]::Exists($Path)) { Throw-UploadError 'AttachmentManifestMissing' 'The explicit local attachment manifest is missing.' }
    $raw=[System.IO.File]::ReadAllBytes($Path)
    if ($raw.Length -gt 65536) { Throw-UploadError 'AttachmentManifestOverLimit' 'The manifest exceeds the bridge limit of 64 KiB.' }
    $m=$Script:Utf8NoBom.GetString($raw).TrimStart([char]0xfeff) | ConvertFrom-Json
    $files=@(Get-ObjectProperty $m 'files' @())
    if ([int](Get-ObjectProperty $m 'schemaVersion' 0) -ne 1 -or $files.Count -lt 1 -or $files.Count -gt 6) { Throw-UploadError 'AttachmentManifestInvalid' 'A schema-v1 manifest with one to six explicitly authorized ZIP files is required.' }
    $null=Assert-AgentBrowserTargetBindingComplete -Binding (Get-ObjectProperty $m 'targetBinding' $null)
    if ([string](Get-ObjectProperty $m.targetBinding 'url' '') -cne 'https://chatgpt.com/') { Throw-UploadError 'AttachmentTargetNotFresh' 'ZIP uploads require the explicitly bound independent homepage.' }
    $names=@{};$paths=@{};$total=0L
    Add-Type -AssemblyName System.IO.Compression
    foreach($f in $files) {
        $pathValue=[string](Get-ObjectProperty $f 'path' '')
        if (-not [System.IO.Path]::IsPathRooted($pathValue) -or -not [System.IO.File]::Exists($pathValue)) { Throw-UploadError 'AttachmentFileMissing' 'An explicitly listed local file does not exist.' }
        $full=[System.IO.Path]::GetFullPath($pathValue);$info=Get-Item -LiteralPath $full
        $name=[string](Get-ObjectProperty $f 'filename' '')
        if ($info.PSIsContainer -or ($info.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or $name -cne $info.Name -or $name.Length -gt 180 -or $name -match '[\r\n]' -or $info.Extension -ine '.zip') { Throw-UploadError 'AttachmentTypeInvalid' 'Each attachment must be an ordinary ZIP with its exact safe basename.' }
        if ($names.ContainsKey($name.ToLowerInvariant()) -or $paths.ContainsKey($full.ToLowerInvariant())) { Throw-UploadError 'AttachmentDuplicate' 'Duplicate paths or ambiguous attachment names are rejected.' }
        $names[$name.ToLowerInvariant()]=$true;$paths[$full.ToLowerInvariant()]=$true
        $size=[long](Get-ObjectProperty $f 'sizeBytes' -1)
        if ($size -lt 1 -or $size -gt 1048576 -or $info.Length -gt 1048576) { Throw-UploadError 'AttachmentOverLimit' 'The conservative bridge limit is 1 MiB per ZIP; it is not a claim about native transport capacity.' }
        $total += $info.Length
        if ($total -gt 4194304) { Throw-UploadError 'AttachmentOverLimit' 'The bridge limits each manifest to 4 MiB in total.' }
        $bytes=[System.IO.File]::ReadAllBytes($full)
        if ($size -ne $bytes.Length -or [string](Get-ObjectProperty $f 'sha256' '') -cne (Get-Sha256Bytes -Bytes $bytes)) { Throw-UploadError 'AttachmentFileChanged' 'Attachment bytes do not match the reviewed size and SHA256.' }
        $stream=[System.IO.MemoryStream]::new($bytes,$false);$zip=$null
        try {
            $zip=[System.IO.Compression.ZipArchive]::new($stream,[System.IO.Compression.ZipArchiveMode]::Read,$false)
            $uncompressed=0L
            foreach($entry in $zip.Entries) {
                if ($entry.FullName -match '(^[/\\]|(^|[/\\])\.\.([/\\]|$)|^[A-Za-z]:)') { Throw-UploadError 'AttachmentZipUnsafe' 'ZIP entries contain unsafe paths.' }
                $uncompressed += $entry.Length
                if ($entry.Length -gt 8388608 -or $uncompressed -gt 8388608) { Throw-UploadError 'AttachmentZipOverLimit' 'The bridge bounds inspected uncompressed ZIP content to 8 MiB.' }
                if ($entry.Length -gt 0) {
                    $reader=[System.IO.StreamReader]::new($entry.Open())
                    try { $text=$reader.ReadToEnd() } finally { $reader.Dispose() }
                    if ($text -match '(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bAKIA[A-Z0-9]{16}\b|(?im)["'']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password)["'']?\s*[=:]\s*["'']?[A-Za-z0-9_+/=-]{20,})') { Throw-UploadError 'AttachmentCredentialDetected' 'A credential pattern was found; no bytes were uploaded.' }
                }
            }
        } catch { if (Get-ExceptionCategory -Exception $_.Exception) { throw }; Throw-UploadError 'AttachmentZipInvalid' 'ZIP validation failed.' }
        finally { if($null -ne $zip){$zip.Dispose()};$stream.Dispose() }
    }
    return [pscustomobject]@{Manifest=$m;Hash=(Get-Sha256Bytes -Bytes $raw);Files=$files}
}
function Assert-UploadFreshSnapshot {
    param($Snapshot,[switch]$AllowDraft)
    Assert-AgentBrowserBaseReady -Snapshot $Snapshot
    if ($Snapshot.Url -cne 'https://chatgpt.com/' -or $Snapshot.UrlExact -or @($Snapshot.UserTurns).Count -ne 0 -or @($Snapshot.Responses).Count -ne 0 -or (-not $AllowDraft -and -not (Test-ComposerValueEmpty -Value $Snapshot.ComposerValue))) { Throw-UploadError 'AttachmentPageDrift' 'The independent attachment page or draft changed.' }
}
function Invoke-FixedUploadAction {
    param($Target,$ManifestContext,[ValidateSet('inspect','assign')][string]$Action,$File)
    $payload=[ordered]@{action=$Action;expectedUrl='https://chatgpt.com/';expectedNames=@($ManifestContext.Files | ForEach-Object {$_.filename});displayNameMappings=(Get-ObjectProperty $ManifestContext 'DisplayNameMappings' ([ordered]@{}))}
    if($Action -eq 'assign') {
        $bytes=[System.IO.File]::ReadAllBytes([string]$File.path)
        if($bytes.Length -ne [long]$File.sizeBytes -or (Get-Sha256Bytes -Bytes $bytes) -cne [string]$File.sha256){Throw-UploadError 'AttachmentFileChanged' 'Attachment bytes changed immediately before assignment.'}
        $payload['file']=[ordered]@{name=[string]$File.filename;sizeBytes=$bytes.Length;sha256=[string]$File.sha256;base64=[Convert]::ToBase64String($bytes)}
    }
    $templatePath=Join-Path $PSScriptRoot 'chatgpt-pro-agent-browser-upload.js'
    $template=[System.IO.File]::ReadAllText($templatePath,$Script:Utf8NoBom)
    $marker='/*APPROVED_UPLOAD_PAYLOAD*/ {}'
    if(($template.Split(@($marker),[StringSplitOptions]::None)).Count -ne 2){Throw-UploadError 'AttachmentScriptInvalid' 'The fixed upload template is invalid.'}
    $code=$template.Replace($marker,($payload | ConvertTo-Json -Depth 8 -Compress))
    $temporary=Join-Path ([System.IO.Path]::GetTempPath()) ('gptpro-fixed-upload-'+[Guid]::NewGuid().ToString('N')+'.js')
    try {
        [System.IO.File]::WriteAllText($temporary,$code,$Script:Utf8NoBom)
        $envelope=Invoke-AgentBrowserCliJson -Arguments @('exec','--file',$temporary,'--tab',[string]$Target.TabId,'--browser',[string]$Target.BrowserId,'--profile',[string]$Target.ProfileId,'--timeout','15')
        Assert-AgentBrowserCommandResultBinding -Envelope $envelope -Target $Target
        $result=Get-ObjectProperty (Get-ObjectProperty $envelope 'result' $null) 'js_return' $null
        if ($null -eq $result -or [int](Get-ObjectProperty $result 'schemaVersion' 0) -ne 1) { Throw-UploadError 'AttachmentResultUnknown' 'The upload action returned no bound result; observe before any further action.' }
        return $result
    } finally { if([System.IO.File]::Exists($temporary)){[System.IO.File]::Delete($temporary)} }
}
function Read-UploadDisplayMapEvidence {
    param($Evidence,[string]$Directory,[string]$ExpectedBasename)
    $expected=Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Directory))) $ExpectedBasename
    $path=[string](Get-ObjectProperty $Evidence 'path' '')
    if(-not [IO.Path]::IsPathRooted($path) -or [IO.Path]::GetFullPath($path) -cne [IO.Path]::GetFullPath($expected) -or -not [IO.File]::Exists($path)){Throw-UploadError 'AttachmentDisplayMapEvidenceInvalid' 'Display mapping only accepts the three exact reviewed local evidence files.'}
    $info=Get-Item -LiteralPath $path
    if($info.PSIsContainer -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $info.Length -gt 1048576){Throw-UploadError 'AttachmentDisplayMapEvidenceInvalid' 'The local evidence is not an ordinary bounded file.'}
    $bytes=[IO.File]::ReadAllBytes($path)
    if([string](Get-ObjectProperty $Evidence 'sha256' '') -cne (Get-Sha256Bytes $bytes)){Throw-UploadError 'AttachmentDisplayMapEvidenceChanged' 'An original display mapping evidence file changed.'}
    return ($Script:Utf8NoBom.GetString($bytes).TrimStart([char]0xfeff)|ConvertFrom-Json)
}
function Initialize-IncrementalUploadDisplayNameMaps {
    param($ManifestContext,[string]$Directory,$State,[switch]$Register)
    $names=$ManifestContext.DisplayNameMappings;$seals=[ordered]@{}
    foreach($key in @($names.Keys)){$owner=@($State.files|Where-Object {$_.filename -ceq $key})[0];$seals[$key]=[string]$owner.displayNameMappingSha256}
    $evidenceNames=@('','second-zip-completion-status.json','third-zip-completion-status.json','fourth-zip-completion-status.json')
    for($i=1;$i -lt $ManifestContext.Files.Count;$i++) {
        $file=$ManifestContext.Files[$i];$owned=@($State.files|Where-Object {$_.filename -ceq $file.filename})
        if($owned.Count -ne 1){Throw-UploadError 'AttachmentDisplayMapUnowned' 'An incremental mapping requires exactly one original file row.'}
        $row=$owned[0];$registered=[string](Get-ObjectProperty $row 'displayNameMappingSha256' '')
        $path=Join-Path $Directory ('display-name-map-{0:D2}.json' -f ($i+1))
        if(-not [IO.File]::Exists($path)){if($registered){Throw-UploadError 'AttachmentDisplayMapMissing' 'An original incremental mapping sidecar is missing.'};continue}
        $info=Get-Item -LiteralPath $path
        if($info.PSIsContainer -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $info.Length -gt 65536){Throw-UploadError 'AttachmentDisplayMapInvalid' 'The incremental mapping sidecar is not an ordinary bounded file.'}
        $bytes=[IO.File]::ReadAllBytes($path);$seal=Get-Sha256Bytes $bytes;$map=$Script:Utf8NoBom.GetString($bytes).TrimStart([char]0xfeff)|ConvertFrom-Json
        $display=[string](Get-ObjectProperty $map 'observedDisplayName' '')
        if([int](Get-ObjectProperty $map 'schemaVersion' 0) -ne 1 -or [int](Get-ObjectProperty $map 'fileIndex' 0) -ne ($i+1) -or [string](Get-ObjectProperty $map 'associationKind' '') -cne 'single-controlled-local-upload-card-delta' -or [string]$map.manifestSha256 -cne $ManifestContext.Hash -or [string]$map.canonicalFilename -cne [string]$file.filename -or [string]$map.sourceName -cne [string]$file.filename -or [long]$map.sizeBytes -ne [long]$file.sizeBytes -or [string]$map.localBytesSha256 -cne [string]$file.sha256 -or [string]::IsNullOrWhiteSpace($display) -or $display.Length -gt 180 -or $display -match '[\r\n]' -or [IO.Path]::GetExtension($display) -ine '.zip'){Throw-UploadError 'AttachmentDisplayMapInvalid' 'The incremental mapping must name the exact original file, bytes, and explicitly observed ZIP display name.'}
        Assert-UploadBindingEqual -Expected $ManifestContext.Manifest.targetBinding -Actual $map.targetBinding
        $attempts=@($row.attempts);$attempt=$null
        if($row.attemptCount -ne 1 -or $attempts.Count -ne 1 -or $attempts[0].attempt -ne 1 -or $attempts[0].attemptId -cne $map.attemptId -or $attempts[0].outcome -cne 'assigned' -or $row.sha256 -cne $file.sha256 -or $row.sizeBytes -ne $file.sizeBytes){Throw-UploadError 'AttachmentDisplayMapUnowned' 'Only the exact original once-assigned attempt owns an incremental mapping.'}
        $attempt=$attempts[0];$source=$attempt.verifiedSource;$result=$attempt.assignmentResult;$pre=$attempt.preAssignmentCardSet
        if($source.name -cne $file.filename -or $source.sizeBytes -ne $file.sizeBytes -or $source.localBytesSha256 -cne $file.sha256 -or $source.manifestSha256 -cne $ManifestContext.Hash -or -not $result.ok -or $result.phase -cne 'assigned' -or $result.name -cne $file.filename -or $result.sizeBytes -ne $file.sizeBytes -or $result.fileType -cne 'application/zip' -or -not $result.fileNameVerified -or -not $result.fileSizeVerified -or $attempt.assignmentResultSha256 -cne $map.assignmentResultSha256 -or $attempt.preAssignmentCardSetSha256 -cne $map.preAssignmentCardSetSha256){Throw-UploadError 'AttachmentDisplayMapUnowned' 'The original native File result and byte validation do not prove this mapping.'}
        $preHash=Get-Sha256Bytes -Bytes ($Script:Utf8NoBom.GetBytes(($pre|ConvertTo-Json -Depth 8 -Compress)))
        if($preHash -cne $map.preAssignmentCardSetSha256 -or -not $pre.cardSetValid -or $pre.busyCount -ne 0 -or $pre.alertCount -ne 0 -or $pre.fileInputCount -ne 1 -or $pre.selectedFileCount -ne 0 -or -not (Test-UploadInspectionMatchSet $pre $ManifestContext)){Throw-UploadError 'AttachmentDisplayMapEvidenceInvalid' 'The immutable preassignment card subset changed or was not ready.'}
        $expected=@()
        for($j=0;$j -lt $ManifestContext.Files.Count;$j++) {
            $priorFile=$ManifestContext.Files[$j];$prior=@($State.files|Where-Object {$_.filename -ceq $priorFile.filename})[0];$before=@($pre.matches|Where-Object {$_.name -ceq $priorFile.filename})[0]
            if($j -lt $i){$known=[string]$priorFile.filename;if($names.Contains([string]$priorFile.filename)){$known=[string]$names[[string]$priorFile.filename]};if($before.matchCount -ne 1 -or $before.observedDisplayName -cne $known -or [string]::IsNullOrWhiteSpace([string]$before.cardSignature) -or [string]$before.cardSignature -cne [string]$prior.cardSignature){Throw-UploadError 'AttachmentDisplayMapEvidenceInvalid' 'A preexisting owned card differs from its original stable proof.'};$expected+=$known}
            elseif($before.matchCount -ne 0){Throw-UploadError 'AttachmentDisplayMapEvidenceInvalid' 'A later uninvoked file already had a card before assignment.'}
        }
        $expected+=$display
        if(@($expected|Select-Object -Unique).Count -ne $expected.Count -or @($ManifestContext.Files|Where-Object {$_.filename -cne $file.filename -and $_.filename -ceq $display}).Count -or @($names.Keys|Where-Object {[string]$_ -cne [string]$file.filename -and [string]$names[$_] -ceq $display}).Count){Throw-UploadError 'AttachmentDisplayMapInvalid' 'Display mappings must remain a one-to-one exact set without canonical collisions.'}
        $completed=Read-UploadDisplayMapEvidence -Evidence $map.completedEvidence -Directory $Directory -ExpectedBasename $evidenceNames[$i]
        $end=$completed.result;$inspection=$end.observation.attachmentInspection;$cards=@($inspection.cards)
        Assert-UploadBindingEqual -Expected $ManifestContext.Manifest.targetBinding -Actual $end.targetBinding
        if($end.manifestSha256 -cne $ManifestContext.Hash -or $inspection.ownedCardCount -ne ($i+1) -or $inspection.formCardRawCount -ne ($i+1) -or $inspection.mainOutsideFormCardCount -ne 0 -or $inspection.historyCount -ne 0 -or $inspection.cardTruncated -or -not $inspection.approvedBlankPage -or $cards.Count -ne ($i+1) -or -not $inspection.sendAvailability.uniqueEnabled -or $end.observation.busyCount -ne 0 -or $end.observation.alertCount -ne 0 -or $end.observation.selectedFileCount -ne 0){Throw-UploadError 'AttachmentDisplayMapEvidenceInvalid' 'The completion evidence must contain the exact prior set plus one complete owned card.'}
        $seen=@()
        foreach($card in $cards){$open=@($card.openControls);$remove=@($card.removeControls);$displayNames=@($card.observedDisplayNames);if(-not $card.visible -or -not $card.sameComposerForm -or $card.ariaBusy -or $card.busyCount -ne 0 -or $card.alertCount -ne 0 -or $card.visibleAnimateSpinCount -ne 0 -or -not $card.uniqueOpenRemoveRelationship -or $displayNames.Count -ne 1 -or $open.Count -ne 1 -or $remove.Count -ne 1 -or $open[0].disabled -or $remove[0].disabled -or -not $open[0].sameCardOwner -or -not $remove[0].sameCardOwner -or -not $open[0].sameComposerForm -or -not $remove[0].sameComposerForm -or $open[0].ariaLabel -cne $displayNames[0] -or $expected -cnotcontains [string]$displayNames[0] -or $seen -ccontains [string]$displayNames[0]){Throw-UploadError 'AttachmentDisplayMapEvidenceInvalid' 'The completed card set contains an extra, duplicate, missing, pending, or unowned display name.'};$seen+=[string]$displayNames[0]}
        $endRow=@($end.files|Where-Object {$_.filename -ceq $file.filename})
        if($endRow.Count -ne 1 -or $endRow[0].attemptCount -ne 1 -or $endRow[0].attempts[0].attemptId -cne $map.attemptId -or $endRow[0].attempts[0].outcome -cne 'assigned' -or $endRow[0].sha256 -cne $file.sha256 -or $endRow[0].sizeBytes -ne $file.sizeBytes -or [DateTimeOffset]$completed.observedAtUtc -le [DateTimeOffset]$attempt.startedAtUtc){Throw-UploadError 'AttachmentDisplayMapEvidenceInvalid' 'The completion evidence does not follow this original exact assigned attempt.'}
        if($registered){if($registered -cne $seal -or [string]$row.observedDisplayName -cne $display){Throw-UploadError 'AttachmentDisplayMapChanged' 'An original incremental mapping cannot be replaced.'}}
        else {
            if(-not $Register -or $row.phase -cne 'pending' -or @($State.files|Select-Object -Skip ($i+1)|Where-Object {$_.phase -cne 'not-invoked' -or $_.attemptCount -ne 0}).Count){Throw-UploadError 'AttachmentDisplayMapUnregistered' 'Only the original pending attempt may register its literal before a later upload.'}
            Set-ObjectProperty $row 'observedDisplayName' $display;Set-ObjectProperty $row 'displayNameMappingSha256' $seal;Set-ObjectProperty $row 'displayNameAssociationKind' 'single-controlled-local-upload-card-delta'
        }
        $names[[string]$file.filename]=$display;$seals[[string]$file.filename]=$seal
    }
    Set-ObjectProperty $ManifestContext 'DisplayNameMappingSeals' $seals
}

function Initialize-UploadDisplayNameMap {
    param($ManifestContext,[string]$Directory,$State,[switch]$Register)
    $path=Join-Path ([IO.Path]::GetFullPath($Directory)) 'display-name-map.json'
    $mappedRows=@($State.files | Where-Object {-not [string]::IsNullOrWhiteSpace([string](Get-ObjectProperty $_ 'displayNameMappingSha256' ''))})
    $names=[ordered]@{}
    if(-not [IO.File]::Exists($path)) {
        if($mappedRows.Count){Throw-UploadError 'AttachmentDisplayMapMissing' 'The original sealed display-name sidecar is required.'}
        Set-ObjectProperty $ManifestContext 'DisplayNameMappings' $names
        Set-ObjectProperty $ManifestContext 'DisplayNameMappingSha256' ''
        return
    }
    $info=Get-Item -LiteralPath $path
    if($info.PSIsContainer -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $info.Length -gt 65536){Throw-UploadError 'AttachmentDisplayMapInvalid' 'The sealed display-name sidecar is invalid or over limit.'}
    $raw=[IO.File]::ReadAllBytes($path);$seal=Get-Sha256Bytes $raw
    $map=$Script:Utf8NoBom.GetString($raw).TrimStart([char]0xfeff)|ConvertFrom-Json
    $entries=@(Get-ObjectProperty $map 'entries' @())
    if([int](Get-ObjectProperty $map 'schemaVersion' 0) -ne 1 -or [string](Get-ObjectProperty $map 'associationKind' '') -cne 'single-controlled-local-upload-card-transition' -or [string](Get-ObjectProperty $map 'manifestSha256' '') -cne $ManifestContext.Hash -or $entries.Count -ne 1){Throw-UploadError 'AttachmentDisplayMapInvalid' 'Only the one reviewed local association for the original manifest is accepted.'}
    Assert-UploadBindingEqual -Expected $ManifestContext.Manifest.targetBinding -Actual $map.targetBinding
    $entry=$entries[0];$canonical=[string](Get-ObjectProperty $entry 'canonicalFilename' '');$display=[string](Get-ObjectProperty $entry 'observedDisplayName' '')
    $file=@($ManifestContext.Files|Where-Object {$_.filename -ceq $canonical})
    $rows=@($State.files|Where-Object {$_.filename -ceq $canonical})
    if($file.Count -ne 1 -or $rows.Count -ne 1 -or $canonical -cne [string]$ManifestContext.Files[0].filename -or $display -cne 'GPTPro_video_handoff_FINAL_20261002(2).zip' -or $canonical -cne 'GPTPro_video_handoff_FINAL_20261002.zip' -or [string](Get-ObjectProperty $entry 'sourceName' '') -cne $canonical -or [long](Get-ObjectProperty $entry 'sizeBytes' -1) -ne [long]$file[0].sizeBytes -or [string](Get-ObjectProperty $entry 'localBytesSha256' '') -cne [string]$file[0].sha256){Throw-UploadError 'AttachmentDisplayMapInvalid' 'Only the exact reviewed canonical name, actual display name, and original bytes are mapped.'}
    if(@($ManifestContext.Files|Where-Object {$_.filename -ceq $display}).Count){Throw-UploadError 'AttachmentDisplayMapInvalid' 'Canonical and display names may not collide.'}
    $before=Read-UploadDisplayMapEvidence -Evidence $entry.evidence.before -Directory $Directory -ExpectedBasename 'business-after-upload-preassignment-rejection-status.json'
    $assigned=Read-UploadDisplayMapEvidence -Evidence $entry.evidence.assigned -Directory $Directory -ExpectedBasename 'explicit-restored-first-zip-assignment.json'
    $completed=Read-UploadDisplayMapEvidence -Evidence $entry.evidence.completed -Directory $Directory -ExpectedBasename 'first-zip-current-card-and-error-diagnostic.json'
    foreach($binding in @($before.targetBinding,$assigned.result.targetBinding,$completed.result.targetBinding)){Assert-UploadBindingEqual -Expected $map.targetBinding -Actual $binding}
    $buttons=@($before.inspection.composerFormButtons)
    $expectedLabels='["\u6dfb\u52a0\u6587\u4ef6\u7b49\u5185\u5bb9","\u9009\u62e9 ChatGPT \u6a21\u578b","\u542c\u5199","\u5f00\u59cb\u8bed\u97f3"]'|ConvertFrom-Json
    $inputs=@($before.inspection.uploadInspection.fileInputs)
    if(-not [bool]$before.ok -or -not [bool]$before.selectedModeIsPro -or [string]$before.selectedModeLabel -cne 'Pro' -or $before.url -cne 'https://chatgpt.com/' -or $before.userTurnCount -ne 0 -or $before.responseCount -ne 0 -or -not [bool]$before.composerValueEmpty -or $before.generating -or $before.inspection.busyCount -ne 0 -or $before.inspection.composerFormButtonCount -ne 4 -or $buttons.Count -ne 4 -or $inputs.Count -ne 3 -or @($inputs|Where-Object {$_.selectedFileCount -ne 0 -or -not $_.insideComposerForm -or $_.insideMessage}).Count){Throw-UploadError 'AttachmentDisplayMapEvidenceInvalid' 'Original preassignment evidence must prove the reviewed empty composer controls and upload inputs.'}
    for($i=0;$i -lt 4;$i++){if([string]$buttons[$i].ariaLabel -cne [string]$expectedLabels[$i] -or -not [bool]$buttons[$i].visible -or [bool]$buttons[$i].disabled){Throw-UploadError 'AttachmentDisplayMapEvidenceInvalid' 'Preassignment controls differ from the exact reviewed four-button structure.'}}
    $post=$assigned.result;$postRow=@($post.files|Where-Object {$_.filename -ceq $canonical});$postMatch=@($post.observation.matches|Where-Object {$_.name -ceq $canonical})
    $attemptId=[string](Get-ObjectProperty $entry 'attemptId' '')
    if($post.manifestSha256 -cne $ManifestContext.Hash -or $postRow.Count -ne 1 -or $postMatch.Count -ne 1 -or $postRow[0].phase -cne 'pending' -or $postRow[0].attemptCount -ne 2 -or @($postRow[0].attempts).Count -ne 2 -or $postRow[0].attempts[1].attemptId -cne $attemptId -or $postRow[0].attempts[1].outcome -cne 'assigned' -or $postMatch[0].matchCount -ne 1 -or $post.observation.busyCount -ne 1 -or $post.observation.alertCount -ne 0 -or @($post.files|Where-Object {$_.filename -cne $canonical -and ($_.phase -cne 'not-invoked' -or $_.attemptCount -ne 0)}).Count -or @($post.observation.matches|Where-Object {$_.name -cne $canonical -and $_.matchCount -ne 0}).Count){Throw-UploadError 'AttachmentDisplayMapEvidenceInvalid' 'The original assigned evidence must prove one canonical busy card from exact durable attempt two.'}
    $end=$completed.result;$cards=@($end.observation.attachmentInspection.cards)
    $inspect=$end.observation.attachmentInspection
    if($end.manifestSha256 -cne $ManifestContext.Hash -or $inspect.ownedCardCount -ne 1 -or $inspect.formCardRawCount -ne 1 -or $inspect.mainOutsideFormCardCount -ne 0 -or $inspect.cardTruncated -or $inspect.historyCount -ne 0 -or -not $inspect.approvedBlankPage -or $cards.Count -ne 1 -or -not $cards[0].visible -or -not $cards[0].sameComposerForm -or $cards[0].busyCount -ne 0 -or $cards[0].alertCount -ne 0 -or $end.observation.busyCount -ne 0 -or $end.observation.alertCount -ne 0 -or $end.observation.selectedFileCount -ne 0){Throw-UploadError 'AttachmentDisplayMapEvidenceInvalid' 'The reviewed completed evidence must contain exactly one owned complete alias card.'}
    $open=@($cards[0].controls|Where-Object {$_.tag -ceq 'button' -and $_.className -match '(^|\s)composer-attachment-surface(\s|$)'})
    if($open.Count -ne 1 -or [string]$open[0].ariaLabel -cne $display -or $open[0].disabled){Throw-UploadError 'AttachmentDisplayMapEvidenceInvalid' 'The actual completed card display name differs from the fixed reviewed literal.'}
    $beforeAt=[DateTimeOffset]::Parse($before.observedAtUtc);$assignedAt=[DateTimeOffset]::Parse($assigned.observedAtUtc);$endAt=[DateTimeOffset]::Parse($completed.observedAtUtc)
    if($beforeAt -ge $assignedAt -or $assignedAt -ge $endAt){Throw-UploadError 'AttachmentDisplayMapEvidenceInvalid' 'The immutable evidence sequence is not preassignment, assignment, then completion.'}
    $row=$rows[0];$attempts=@($row.attempts)
    if($row.attemptCount -ne 2 -or $attempts.Count -ne 2 -or $attempts[1].attemptId -cne $attemptId -or $attempts[1].outcome -cne 'assigned' -or $row.sha256 -cne $file[0].sha256 -or $row.sizeBytes -ne $file[0].sizeBytes){Throw-UploadError 'AttachmentDisplayMapUnowned' 'The original durable ledger does not own this exact assigned file and attempt.'}
    $existing=[string](Get-ObjectProperty $row 'displayNameMappingSha256' '')
    if([string]::IsNullOrWhiteSpace($existing)) {
        if(-not $Register -or [string]$row.phase -cne 'pending' -or @($State.files|Where-Object {$_.filename -cne $canonical -and ($_.phase -cne 'not-invoked' -or $_.attemptCount -ne 0)}).Count){Throw-UploadError 'AttachmentDisplayMapUnregistered' 'Only the original pending attempt may register the local association before any later upload.'}
        Set-ObjectProperty $row 'observedDisplayName' $display
        Set-ObjectProperty $row 'displayNameMappingSha256' $seal
        Set-ObjectProperty $row 'displayNameAssociationKind' 'single-controlled-local-upload-card-transition'
    } elseif($existing -cne $seal -or [string](Get-ObjectProperty $row 'observedDisplayName' '') -cne $display){Throw-UploadError 'AttachmentDisplayMapChanged' 'The original registered display mapping cannot be replaced.'}
    $names[$canonical]=$display
    Set-ObjectProperty $ManifestContext 'DisplayNameMappings' $names
    Set-ObjectProperty $ManifestContext 'DisplayNameMappingSha256' $seal
    Initialize-IncrementalUploadDisplayNameMaps -ManifestContext $ManifestContext -Directory $Directory -State $State -Register:$Register
}

function Test-UploadInspectionMatchSet {
    param($Observation,$ManifestContext)
    $matches=@(Get-ObjectProperty $Observation 'matches' @())
    if($matches.Count -ne $ManifestContext.Files.Count){return $false}
    foreach($file in $ManifestContext.Files) {
        $found=@($matches | Where-Object {[string](Get-ObjectProperty $_ 'name' '') -ceq [string]$file.filename})
        if($found.Count -ne 1){return $false}
        $count=Get-ObjectProperty $found[0] 'matchCount' $null
        if(($count -isnot [int] -and $count -isnot [long]) -or [long]$count -lt 0){return $false}
    }
    return $true
}
function Get-UploadCandidateProof {
    param($Observation,$ManifestContext)
    # The fixed inspector owns DOM/card recognition. Missing proof fields fail closed.
    if (-not [bool](Get-ObjectProperty $Observation 'ok' $false) -or
        -not [bool](Get-ObjectProperty $Observation 'cardSetValid' $false) -or
        [int](Get-ObjectProperty $Observation 'busyCount' -1) -ne 0 -or
        [int](Get-ObjectProperty $Observation 'alertCount' -1) -ne 0 -or
        -not (Test-UploadInspectionMatchSet -Observation $Observation -ManifestContext $ManifestContext)) { return $null }
    $matches=@(Get-ObjectProperty $Observation 'matches' @())
    if($matches.Count -ne $ManifestContext.Files.Count){return $null}
    $cards=@();$rows=@{}
    foreach($file in $ManifestContext.Files) {
        $found=@($matches | Where-Object {[string](Get-ObjectProperty $_ 'name' '') -ceq [string]$file.filename})
        if($found.Count -ne 1){return $null}
        $match=$found[0];$count=[int](Get-ObjectProperty $match 'matchCount' -1)
        $map=Get-ObjectProperty $ManifestContext 'DisplayNameMappings' ([ordered]@{})
        $expectedDisplay=[string]$file.filename
        if($map.Contains([string]$file.filename)){$expectedDisplay=[string]$map[[string]$file.filename]}
        if($count -gt 0 -and [string](Get-ObjectProperty $match 'observedDisplayName' '') -cne $expectedDisplay){return $null}
        if($count -eq 0) {if([bool](Get-ObjectProperty $match 'readyProved' $false)){return $null};continue}
        $sig=[string](Get-ObjectProperty $match 'cardSignature' '')
        if($count -ne 1 -or -not [bool](Get-ObjectProperty $match 'readyProved' $false) -or [string]::IsNullOrWhiteSpace($sig) -or $sig.Length -gt 4096){return $null}
        $rows[[string]$file.filename]=$sig
        $cards+= [ordered]@{name=[string]$file.filename;cardSignature=$sig}
    }
    if($cards.Count -eq 0){return $null}
    $canonical=@($cards | Sort-Object { $_.name }) | ConvertTo-Json -Depth 5 -Compress
    $setSignature=Get-Sha256Bytes -Bytes ($Script:Utf8NoBom.GetBytes([string]$canonical))
    $fullSignature=[string](Get-ObjectProperty $Observation 'cardSetSignature' '')
    $complete=$cards.Count -eq $ManifestContext.Files.Count -and [bool](Get-ObjectProperty $Observation 'readyProved' $false) -and -not [string]::IsNullOrWhiteSpace($fullSignature) -and $fullSignature.Length -le 4096
    return [pscustomobject]@{signature=$setSignature;cards=$rows;complete=$complete}
}
function Wait-UploadStabilityInterval {
    # Use a monotonic timer; a wall-clock correction cannot shorten the interval.
    $watch=[Diagnostics.Stopwatch]::StartNew()
    Start-Sleep -Milliseconds 500
    if($watch.Elapsed.TotalMilliseconds -lt 500){[Threading.Thread]::Sleep([int][Math]::Ceiling(500-$watch.Elapsed.TotalMilliseconds))}
    return [long][Math]::Floor($watch.Elapsed.TotalMilliseconds)
}
function Get-StableUploadObservation {
    param($Target,$ManifestContext,$FirstObservation)
    $first=Get-UploadCandidateProof -Observation $FirstObservation -ManifestContext $ManifestContext
    $firstAt=[DateTime]::UtcNow.ToString('o')
    if($null -eq $first){return [pscustomobject]@{stable=$false;observation=$FirstObservation;proof=$null;candidate=$null}}
    $elapsed=Wait-UploadStabilityInterval
    if($elapsed -lt 500){Throw-UploadError 'AttachmentObservationTooSoon' 'Two attachment observations must be at least 500 ms apart.'}
    $secondObservation=Invoke-FixedUploadAction -Target $Target -ManifestContext $ManifestContext -Action inspect
    $secondAt=[DateTime]::UtcNow.ToString('o')
    $second=Get-UploadCandidateProof -Observation $secondObservation -ManifestContext $ManifestContext
    $stable=$null -ne $second -and [string]$first.signature -ceq [string]$second.signature
    $proof=$null
    if($stable){$proof=[ordered]@{schemaVersion=1;firstObservedAtUtc=$firstAt;secondObservedAtUtc=$secondAt;intervalMilliseconds=$elapsed;cardSetSignature=$second.signature}}
    return [pscustomobject]@{stable=$stable;observation=$secondObservation;proof=$proof;candidate=$second}
}
function Assert-UploadRowStabilityProof {
    param($Row)
    $proof=Get-ObjectProperty $Row 'stabilityProof' $null
    if([int](Get-ObjectProperty $proof 'schemaVersion' 0) -ne 1 -or [long](Get-ObjectProperty $proof 'intervalMilliseconds' 0) -lt 500 -or [string]::IsNullOrWhiteSpace([string](Get-ObjectProperty $proof 'cardSetSignature' '')) -or [string]::IsNullOrWhiteSpace([string](Get-ObjectProperty $Row 'cardSignature' ''))){Throw-UploadError 'AttachmentReceiptMismatch' 'A ready attachment requires two stable original observations at least 500 ms apart.'}
    $first=[DateTimeOffset]::MinValue;$second=[DateTimeOffset]::MinValue
    if(-not [DateTimeOffset]::TryParse([string](Get-ObjectProperty $proof 'firstObservedAtUtc' ''),[ref]$first) -or -not [DateTimeOffset]::TryParse([string](Get-ObjectProperty $proof 'secondObservedAtUtc' ''),[ref]$second) -or $second -lt $first){Throw-UploadError 'AttachmentReceiptMismatch' 'Stable observation timestamps are missing or invalid.'}
}
function Assert-ExplicitUnassignedResume {
    param($Row,$Observation,$Snapshot,$ManifestContext)
    $attempts=@(Get-ObjectProperty $Row 'attempts' @())
    if([string](Get-ObjectProperty $Row 'phase' '') -cne 'definitely-not-assigned' -or [int](Get-ObjectProperty $Row 'attemptCount' 0) -ne 1 -or $attempts.Count -ne 1 -or [int](Get-ObjectProperty $attempts[0] 'attempt' 0) -ne 1 -or [string](Get-ObjectProperty $attempts[0] 'outcome' '') -cne 'upload-pro-unproved'){Throw-UploadError 'AttachmentResumeNotAllowed' 'Explicit recovery only accepts the original first upload-pro-unproved result before assignment.'}
    Assert-AgentBrowserPageReady -Snapshot $Snapshot
    Assert-UploadFreshSnapshot -Snapshot $Snapshot
    $selected=Get-ObjectProperty $Observation 'selectedFileCount' $null
    $numericSelected=$selected -is [int] -or $selected -is [long] -or $selected -is [double]
    if(-not [bool](Get-ObjectProperty $Observation 'ok' $false) -or -not (Test-UploadInspectionMatchSet -Observation $Observation -ManifestContext $ManifestContext) -or [int](Get-ObjectProperty $Observation 'fileInputCount' -1) -ne 1 -or -not $numericSelected -or [double]$selected -ne 0 -or [int](Get-ObjectProperty $Observation 'busyCount' -1) -ne 0 -or [int](Get-ObjectProperty $Observation 'alertCount' -1) -ne 0 -or @($Observation.matches | Where-Object {[int](Get-ObjectProperty $_ 'matchCount' -1) -ne 0}).Count -ne 0){Throw-UploadError 'AttachmentResumeNotAllowed' 'Recovery requires a fresh empty, exact Pro page with no assigned files, cards, transfer, or error.'}
    return $true
}
function Invoke-FormalZipUpload {
    param($Target,[string]$ManifestPath,[string]$Directory,[switch]$ObserveOnly,[switch]$ResumeUnassigned)
    if($ObserveOnly -and $ResumeUnassigned){Throw-UploadError 'AttachmentResumeNotAllowed' 'Observation and explicit preassignment recovery cannot be combined.'}
    $ctx=Read-ApprovedUploadManifest -Path $ManifestPath
    Assert-UploadBindingEqual -Expected $ctx.Manifest.targetBinding -Actual (ConvertTo-AgentBrowserTargetBinding -Target $Target)
    $lease=Enter-UiMutex -TargetBinding $ctx.Manifest.targetBinding
    try {
        $snapshot=Get-AgentBrowserPageSnapshot -Target $Target
        Assert-UploadFreshSnapshot -Snapshot $snapshot
        if(-not $ObserveOnly){$snapshot=Ensure-AgentBrowserProMode -Target $Target -Snapshot $snapshot;Assert-AgentBrowserPageReady -Snapshot $snapshot;Assert-UploadFreshSnapshot -Snapshot $snapshot}
        $statePath=Join-Path $Directory 'upload-state.json';$receiptPath=Join-Path $Directory 'attachment-receipt.json'
        if([System.IO.File]::Exists($statePath)) {
            $state=[System.IO.File]::ReadAllText($statePath,$Script:Utf8NoBom) | ConvertFrom-Json
            if ([string]$state.manifestSha256 -cne $ctx.Hash){Throw-UploadError 'AttachmentManifestChanged' 'The original attachment ledger manifest cannot be replaced.'}
            Assert-UploadBindingEqual -Expected $state.targetBinding -Actual $ctx.Manifest.targetBinding
        } else {
            if($ObserveOnly -or $ResumeUnassigned){Throw-UploadError 'AttachmentLedgerMissing' 'Observation or recovery requires the original upload ledger.'}
            $state=[ordered]@{schemaVersion=1;manifestSha256=$ctx.Hash;targetBinding=$ctx.Manifest.targetBinding;files=@($ctx.Files | ForEach-Object {[ordered]@{filename=$_.filename;sha256=$_.sha256;sizeBytes=$_.sizeBytes;phase='not-invoked';attemptCount=0;attempts=@()}});messageSubmitted=$false}
            Write-JsonAtomic -Path $statePath -Value $state
        }
        Initialize-UploadDisplayNameMap -ManifestContext $ctx -Directory $Directory -State $state -Register
        Write-JsonAtomic -Path $statePath -Value $state
        $observation=Invoke-FixedUploadAction -Target $Target -ManifestContext $ctx -Action inspect
        if(-not [bool]$observation.ok){Throw-UploadError 'AttachmentPageDrift' 'The fixed upload inspector could not prove the page.'}
        $stable=Get-StableUploadObservation -Target $Target -ManifestContext $ctx -FirstObservation $observation
        $observation=$stable.observation;$resumeConsumed=$false
        foreach($f in $ctx.Files) {
            $rows=@($state.files | Where-Object {$_.filename -ceq $f.filename})
            $matches=@($observation.matches | Where-Object {$_.name -ceq $f.filename})
            if($rows.Count -ne 1 -or $matches.Count -ne 1){Throw-UploadError 'AttachmentLedgerInvalid' 'The manifest must have exactly one original ledger row and observed name entry per file.'}
            $row=$rows[0];$match=$matches[0]
            if($stable.stable -and [bool](Get-ObjectProperty $match 'readyProved' $false)) {
                if([int]$row.attemptCount -lt 1 -or [int]$row.attemptCount -gt 2 -or [string]$row.phase -notin @('pending','unknown','ready') -or @($row.attempts).Count -ne [int]$row.attemptCount){Throw-UploadError 'AttachmentUnownedCard' 'A pre-existing card cannot be adopted as an upload from this manifest.'}
                Set-ObjectProperty $row 'phase' 'ready';Set-ObjectProperty $row 'cardSignature' ([string]$match.cardSignature);Set-ObjectProperty $row 'stabilityProof' $stable.proof
                continue
            }
            if([string]$row.phase -ceq 'ready'){Set-ObjectProperty $row 'phase' 'pending'}
            if($ObserveOnly){continue}
            $recover=[string]$row.phase -ceq 'definitely-not-assigned' -and $ResumeUnassigned -and -not $resumeConsumed
            if($recover){$fresh=Get-AgentBrowserPageSnapshot -Target $Target;$null=Assert-ExplicitUnassignedResume -Row $row -Observation $observation -Snapshot $fresh -ManifestContext $ctx;$resumeConsumed=$true}
            elseif([string]$row.phase -cne 'not-invoked'){break}
            if([int]$match.matchCount -ne 0){Throw-UploadError 'AttachmentDuplicateExisting' 'An attachment name already appears without a matching original upload receipt.'}
            $attemptNumber= $(if($recover){2}else{1})
            if(-not $recover -and ([int]$row.attemptCount -ne 0 -or @($row.attempts).Count -ne 0)){Throw-UploadError 'AttachmentLedgerInvalid' 'An uninvoked file cannot already have an upload attempt.'}
            $attempt=[ordered]@{attempt=$attemptNumber;attemptId=[Guid]::NewGuid().ToString('N');startedAtUtc=[DateTime]::UtcNow.ToString('o');outcome='invoking';preassignmentKnownNotAssigned=$false}
            if(-not $recover) {
                $observation=Invoke-FixedUploadAction -Target $Target -ManifestContext $ctx -Action inspect
                $selected=Get-ObjectProperty $observation 'selectedFileCount' $null
                $numericSelected=$selected -is [int] -or $selected -is [long] -or $selected -is [double]
                if(-not [bool](Get-ObjectProperty $observation 'ok' $false) -or -not [bool](Get-ObjectProperty $observation 'cardSetValid' $false) -or -not (Test-UploadInspectionMatchSet $observation $ctx) -or [int](Get-ObjectProperty $observation 'busyCount' -1) -ne 0 -or [int](Get-ObjectProperty $observation 'alertCount' -1) -ne 0 -or [int](Get-ObjectProperty $observation 'fileInputCount' -1) -ne 1 -or -not $numericSelected -or [double]$selected -ne 0){Throw-UploadError 'AttachmentsNotReady' 'A new file requires a fresh exact owned attachment subset with no pending, unknown, extra, duplicate, input file, or error.'}
                foreach($prior in $state.files) {
                    $current=@($observation.matches|Where-Object {$_.name -ceq $prior.filename})[0]
                    if([string]$prior.phase -ceq 'ready') {
                        if(-not [bool](Get-ObjectProperty $current 'readyProved' $false) -or [string](Get-ObjectProperty $current 'cardSignature' '') -cne [string](Get-ObjectProperty $prior 'cardSignature' '')){Throw-UploadError 'AttachmentsNotReady' 'An earlier owned attachment changed before the next first assignment.'}
                    } elseif([string]$prior.phase -cne 'not-invoked' -or [int]$current.matchCount -ne 0){Throw-UploadError 'AttachmentsNotReady' 'All earlier assignments must be proved ready and all later files must remain uninvoked.'}
                }
            }
            $preCards=@($observation.matches|ForEach-Object {[ordered]@{name=[string]$_.name;matchCount=[int]$_.matchCount;observedDisplayName=[string](Get-ObjectProperty $_ 'observedDisplayName' '');cardSignature=[string](Get-ObjectProperty $_ 'cardSignature' '')}})
            $preSet=[ordered]@{matches=$preCards;cardSetValid=[bool](Get-ObjectProperty $observation 'cardSetValid' $false);busyCount=[int](Get-ObjectProperty $observation 'busyCount' -1);alertCount=[int](Get-ObjectProperty $observation 'alertCount' -1);fileInputCount=[int](Get-ObjectProperty $observation 'fileInputCount' -1);selectedFileCount=(Get-ObjectProperty $observation 'selectedFileCount' $null)}
            $attempt['preAssignmentCardSet']=$preSet
            $attempt['preAssignmentCardSetSha256']=Get-Sha256Bytes -Bytes ($Script:Utf8NoBom.GetBytes(($preSet|ConvertTo-Json -Depth 8 -Compress)))
            $attempt['verifiedSource']=[ordered]@{name=[string]$f.filename;sizeBytes=[long]$f.sizeBytes;localBytesSha256=[string]$f.sha256;manifestSha256=$ctx.Hash}
            if($recover){$attempt['resumedFromAttempt']=1;$attempt['originalKnownNotAssignedReason']='upload-pro-unproved';Set-ObjectProperty $row 'preassignmentRecoveryRequested' $true}
            Set-ObjectProperty $row 'phase' 'unknown';Set-ObjectProperty $row 'attemptCount' $attemptNumber;Set-ObjectProperty $row 'attempts' @(@($row.attempts)+@($attempt))
            Write-JsonAtomic -Path $statePath -Value $state
            try {
                $action=Invoke-FixedUploadAction -Target $Target -ManifestContext $ctx -Action assign -File $f
                $reported=[ordered]@{ok=[bool](Get-ObjectProperty $action 'ok' $false);phase=[string](Get-ObjectProperty $action 'phase' '');name=[string](Get-ObjectProperty $action 'name' '');sizeBytes=[long](Get-ObjectProperty $action 'sizeBytes' -1);fileType=[string](Get-ObjectProperty $action 'fileType' '');fileNameVerified=[bool](Get-ObjectProperty $action 'fileNameVerified' $false);fileSizeVerified=[bool](Get-ObjectProperty $action 'fileSizeVerified' $false)}
                Set-ObjectProperty $attempt 'assignmentResult' $reported
                Set-ObjectProperty $attempt 'assignmentResultSha256' (Get-Sha256Bytes -Bytes ($Script:Utf8NoBom.GetBytes(($action|ConvertTo-Json -Depth 10 -Compress))))
                if([bool]$action.ok -and [string]$action.phase -ceq 'assigned') {Set-ObjectProperty $row 'phase' 'pending';Set-ObjectProperty $attempt 'outcome' 'assigned'}
                else {$reason=[string](Get-ObjectProperty $action 'reason' 'unproved');Set-ObjectProperty $row 'phase' $(if($reason -ceq 'upload-pro-unproved'){'definitely-not-assigned'}else{'unknown'});Set-ObjectProperty $attempt 'outcome' $reason;Set-ObjectProperty $attempt 'preassignmentKnownNotAssigned' ($reason -ceq 'upload-pro-unproved')}
            } catch {Set-ObjectProperty $row 'phase' 'unknown';Set-ObjectProperty $attempt 'outcome' 'result-unknown';Write-JsonAtomic -Path $statePath -Value $state;throw}
            Write-JsonAtomic -Path $statePath -Value $state
            Start-Sleep -Milliseconds 500
            $observation=Invoke-FixedUploadAction -Target $Target -ManifestContext $ctx -Action inspect
            $stable=Get-StableUploadObservation -Target $Target -ManifestContext $ctx -FirstObservation $observation
            $observation=$stable.observation
            $match=@($observation.matches | Where-Object {$_.name -ceq $f.filename})[0]
            if($stable.stable -and [bool](Get-ObjectProperty $match 'readyProved' $false) -and [string]$row.phase -in @('pending','unknown')){Set-ObjectProperty $row 'phase' 'ready';Set-ObjectProperty $row 'cardSignature' ([string]$match.cardSignature);Set-ObjectProperty $row 'stabilityProof' $stable.proof}
            # An invoked pending/unknown attempt is only observed, never assigned again.
            if([string]$row.phase -cne 'ready'){break}
        }
        Set-ObjectProperty $state 'observation' $observation;Set-ObjectProperty $state 'observedAtUtc' ([DateTime]::UtcNow.ToString('o'))
        $ready=@($state.files | Where-Object {$_.phase -ne 'ready'}).Count -eq 0 -and $stable.stable -and $null -ne $stable.candidate -and $stable.candidate.complete
        if($ready){
            Set-ObjectProperty $state 'stabilityProof' $stable.proof
            foreach($ownedRow in $state.files){
                Set-ObjectProperty $ownedRow 'stabilityProof' $stable.proof;Set-ObjectProperty $ownedRow 'cardSignature' ([string]$stable.candidate.cards[[string]$ownedRow.filename])
                $currentMatch=@($observation.matches|Where-Object {$_.name -ceq $ownedRow.filename})[0]
                Set-ObjectProperty $ownedRow 'observedDisplayName' ([string]$currentMatch.observedDisplayName)
            }
        }
        Write-JsonAtomic -Path $statePath -Value $state
        if($ready){Write-JsonAtomic -Path $receiptPath -Value ([ordered]@{schemaVersion=1;manifestSha256=$ctx.Hash;targetBinding=$ctx.Manifest.targetBinding;files=$state.files;observedAtUtc=$state.observedAtUtc;stabilityProof=$stable.proof;displayNameMappingSha256=(Get-ObjectProperty $ctx 'DisplayNameMappingSha256' '');displayNameMappingSeals=(Get-ObjectProperty $ctx 'DisplayNameMappingSeals' ([ordered]@{}));attachmentAssociation='local-bytes-and-current-frontend-cards';ready=$true;messageSubmitted=$false})}
        return [ordered]@{ok=$true;command= $(if($ObserveOnly){'upload-status'}elseif($ResumeUnassigned){'upload-resume-unassigned'}else{'upload'});ready=$ready;receiptPath=$(if($ready){$receiptPath}else{''});manifestSha256=$ctx.Hash;targetBinding=$ctx.Manifest.targetBinding;files=$state.files;observation=$observation;messageSubmitted=$false;automaticReuploadAllowed=$false;explicitRecoveryConsumed=$resumeConsumed}
    } finally {Exit-UiMutex -Lease $lease}
}

function Assert-FormalAttachmentsForSend {
    param($Target,$Snapshot)
    if([string]::IsNullOrWhiteSpace($AttachmentManifestPath) -and [string]::IsNullOrWhiteSpace($AttachmentReceiptPath)){return}
    if([string]::IsNullOrWhiteSpace($AttachmentManifestPath) -or [string]::IsNullOrWhiteSpace($AttachmentReceiptPath)){Throw-UploadError 'AttachmentReceiptRequired' 'Attachment manifest and receipt must both be supplied.'}
    $ctx=Read-ApprovedUploadManifest -Path $AttachmentManifestPath
    Assert-UploadBindingEqual -Expected $ctx.Manifest.targetBinding -Actual (ConvertTo-AgentBrowserTargetBinding -Target $Target)
    Assert-UploadFreshSnapshot -Snapshot $Snapshot -AllowDraft
    if(-not [System.IO.File]::Exists($AttachmentReceiptPath)){Throw-UploadError 'AttachmentReceiptMissing' 'No completed attachment receipt exists; no message may be sent.'}
    $receipt=[System.IO.File]::ReadAllText($AttachmentReceiptPath,$Script:Utf8NoBom) | ConvertFrom-Json
    if(-not [bool](Get-ObjectProperty $receipt 'ready' $false) -or [string]$receipt.manifestSha256 -cne $ctx.Hash){Throw-UploadError 'AttachmentReceiptMismatch' 'The receipt does not prove the exact manifest.'}
    Assert-UploadBindingEqual -Expected $ctx.Manifest.targetBinding -Actual $receipt.targetBinding
    $rows=@(Get-ObjectProperty $receipt 'files' @())
    if($rows.Count -ne $ctx.Files.Count){Throw-UploadError 'AttachmentReceiptMismatch' 'The receipt must contain the exact attachment set.'}
    $ledgerPath=Join-Path ([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($AttachmentReceiptPath))) 'upload-state.json'
    if(-not [System.IO.File]::Exists($ledgerPath)){Throw-UploadError 'AttachmentLedgerMissing' 'The original durable upload ledger is required.'}
    $ledger=[System.IO.File]::ReadAllText($ledgerPath,$Script:Utf8NoBom) | ConvertFrom-Json
    if([string]$ledger.manifestSha256 -cne $ctx.Hash){Throw-UploadError 'AttachmentReceiptMismatch' 'The durable upload ledger belongs to another manifest.'}
    Assert-UploadBindingEqual -Expected $ctx.Manifest.targetBinding -Actual $ledger.targetBinding
    Initialize-UploadDisplayNameMap -ManifestContext $ctx -Directory ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($AttachmentReceiptPath))) -State $ledger
    foreach($file in $ctx.Files) {
        $receiptRows=@($rows | Where-Object {$_.filename -ceq $file.filename})
        $ledgerRows=@($ledger.files | Where-Object {$_.filename -ceq $file.filename})
        if($receiptRows.Count -ne 1 -or $ledgerRows.Count -ne 1){Throw-UploadError 'AttachmentReceiptMismatch' 'Duplicate or missing receipt entries are rejected.'}
        foreach($row in @($receiptRows[0],$ledgerRows[0])) {
            if([string]$row.phase -cne 'ready' -or [string]$row.sha256 -cne [string]$file.sha256 -or [long]$row.sizeBytes -ne [long]$file.sizeBytes -or [int]$row.attemptCount -lt 1 -or [int]$row.attemptCount -gt 2 -or @($row.attempts).Count -ne [int]$row.attemptCount){Throw-UploadError 'AttachmentReceiptMismatch' 'The exact file bytes and original upload attempt must be proved ready.'}
            Assert-UploadRowStabilityProof -Row $row
            $names=Get-ObjectProperty $ctx 'DisplayNameMappings' ([ordered]@{})
            $expectedDisplay=[string]$file.filename
            if($names.Contains([string]$file.filename)){
                $expectedDisplay=[string]$names[[string]$file.filename]
                if([string](Get-ObjectProperty $row 'displayNameMappingSha256' '') -cne [string]$ctx.DisplayNameMappingSeals[[string]$file.filename]){Throw-UploadError 'AttachmentReceiptMismatch' 'The attachment receipt does not carry its original display mapping seal.'}
            }
            if([string](Get-ObjectProperty $row 'observedDisplayName' '') -cne $expectedDisplay){Throw-UploadError 'AttachmentReceiptMismatch' 'Canonical and observed display names differ from the original exact mapping.'}
        }
    }
    $observation=Invoke-FixedUploadAction -Target $Target -ManifestContext $ctx -Action inspect
    $stable=Get-StableUploadObservation -Target $Target -ManifestContext $ctx -FirstObservation $observation
    if(-not $stable.stable -or $null -eq $stable.candidate -or -not $stable.candidate.complete){Throw-UploadError 'AttachmentsNotReady' 'Two current bound-page observations do not prove every genuine attachment complete.'}
    foreach($file in $ctx.Files) {
        $row=@($rows | Where-Object {$_.filename -ceq $file.filename})[0]
        $ledgerRow=@($ledger.files | Where-Object {$_.filename -ceq $file.filename})[0]
        if([string]$row.cardSignature -cne [string]$stable.candidate.cards[[string]$file.filename] -or [string]$ledgerRow.cardSignature -cne [string]$stable.candidate.cards[[string]$file.filename]){Throw-UploadError 'AttachmentsNotReady' 'Current attachment cards differ from the original stable receipt.'}
    }
    if([string](Get-ObjectProperty $receipt 'displayNameMappingSha256' '') -cne [string](Get-ObjectProperty $ctx 'DisplayNameMappingSha256' '')){Throw-UploadError 'AttachmentReceiptMismatch' 'The original sealed display map must accompany the completed receipt.'}
    $receiptSeals=Get-ObjectProperty $receipt 'displayNameMappingSeals' ([ordered]@{})
    foreach($mappedName in @($ctx.DisplayNameMappings.Keys)){if([string](Get-ObjectProperty $receiptSeals ([string]$mappedName) '') -cne [string]$ctx.DisplayNameMappingSeals[[string]$mappedName]){Throw-UploadError 'AttachmentReceiptMismatch' 'A completed receipt must retain every original independent mapping seal.'}}
    foreach($container in @($receipt,$ledger)) {
        $saved=Get-ObjectProperty $container 'stabilityProof' $null
        if([int](Get-ObjectProperty $saved 'schemaVersion' 0) -ne 1 -or [long](Get-ObjectProperty $saved 'intervalMilliseconds' 0) -lt 500 -or [string](Get-ObjectProperty $saved 'cardSetSignature' '') -cne [string]$stable.candidate.signature){Throw-UploadError 'AttachmentReceiptMismatch' 'The exact complete attachment set lacks its original two-observation proof.'}
    }
}
