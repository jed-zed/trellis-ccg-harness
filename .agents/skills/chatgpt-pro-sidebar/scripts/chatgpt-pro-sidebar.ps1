#requires -Version 5.1
# Source encoding: UTF-8 with BOM (required for localized UIA names in Windows PowerShell 5.1).
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Command,

    [string]$PromptPath,
    [string]$Prompt,
    [string]$EvidenceDir,
    [string]$IdempotencyKey,
    [string]$WindowRuntimeId,
    [switch]$FreshConversation,

    [int]$TimeoutSeconds = 600,

    [int]$PollMilliseconds = 1000,

    [switch]$NoPanelRecovery,
    [switch]$NoFocusRestore
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Script:ToolName = 'chatgpt-pro-sidebar'
$Script:SchemaVersion = 1
$Script:ExtractorVersion = 'uia-agent-turn-v2'
$Script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$Script:IdempotencyRootOverride = $null
$Script:TargetWindowRuntimeId = $WindowRuntimeId
$Script:ExitCodes = [ordered]@{
    Success             = 0
    Unsupported         = 10
    WindowSelection     = 20
    DocumentSelection   = 21
    AuthBarrier         = 22
    ControlSelection    = 23
    GenerationActive    = 24
    DuplicateSubmission = 25
    SendUncertain       = 26
    Timeout             = 27
    ResponseIsolation   = 28
    UrlCapture          = 29
    Evidence            = 30
    InvalidArguments    = 31
    ConcurrentOperation = 32
    Internal            = 99
}

$Script:Names = [ordered]@{
    CodexDocument = @('Codex')
    Address       = @('输入 URL', 'Enter URL', 'Address and search bar')
    Composer      = @('与 ChatGPT 聊天', 'Message ChatGPT', 'Chat with ChatGPT')
    EmptyComposer = @('问问 ChatGPT', 'Ask ChatGPT', 'Ask anything', 'Message ChatGPT')
    Send          = @('发送提示', 'Send prompt', 'Send message')
    NewChat       = @('新聊天', 'New chat')
    SidebarToggle = @('显示/隐藏侧边栏', 'Show/hide sidebar', 'Toggle sidebar')
    ExpandPanel   = @('展开面板', 'Expand panel')
    BrowserPanel  = @('浏览器 Ctrl+T', 'Browser Ctrl+T', 'Browser')
    Login         = @('登录', 'Log in', 'Sign in')
    Pro           = @('Pro')
    Stop          = @('停止回答', '停止生成', '停止回复', '停止生成回复', 'Stop generating', 'Stop response')
    CopyResponse  = @('复制回复', 'Copy response')
    CopyMessage   = @('复制消息', 'Copy message')
}

$Script:SecurityExactNames = @(
    '选择账户', 'Choose an account', 'Use another account',
    '密码', 'Password',
    '使用通行密钥', 'Use a passkey', 'Passkey',
    '验证码', 'Verification code',
    '安全验证', 'Security check',
    '多重身份验证', 'Multi-factor authentication',
    '双重验证', 'Two-factor authentication',
    '验证您是真人', 'Verify you are human',
    '正在检查您的浏览器', 'Checking your browser',
    'CAPTCHA', 'Captcha'
)

$Script:SecurityNameFragments = @(
    'captcha', 'passkey', 'verification code', 'security check',
    'multi-factor', 'two-factor', 'choose an account', 'use another account',
    'verify you are human', 'checking your browser', 'human verification',
    '选择账户', '验证码', '通行密钥', '多重身份', '双重验证',
    '验证您是真人', '检查您的浏览器'
)

$Script:TransientUiCategories = @(
    'TransientUiRerender',
    'CodexWindowMissing',
    'EmbeddedDocumentMissing',
    'AddressControlMissing',
    'BrowserPanelUnavailable',
    'ComposerMissing'
)

$Script:ResponseActionNames = @(
    '复制回复', 'Copy response',
    '赞', '踩', 'Good response', 'Bad response',
    '朗读', 'Read aloud',
    '重试', 'Regenerate', 'Retry',
    '分享', 'Share',
    '编辑', 'Edit',
    '更多', 'More'
)

function Get-ObjectProperty {
    param(
        [AllowNull()][Parameter(Mandatory = $true)]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name,
        $Default = $null
    )

    if ($null -eq $InputObject) {
        return $Default
    }

    if ($InputObject -is [System.Collections.IDictionary]) {
        if ($InputObject.Contains($Name)) {
            return $InputObject[$Name]
        }
        return $Default
    }

    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $Default
    }

    return $property.Value
}

function Set-ObjectProperty {
    param(
        [Parameter(Mandatory = $true)]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name,
        $Value
    )

    if ($InputObject -is [System.Collections.IDictionary]) {
        $InputObject[$Name] = $Value
        return
    }

    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -ne $property) {
        $property.Value = $Value
        return
    }

    $InputObject | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
}

function Normalize-TextForHash {
    param([AllowEmptyString()][Parameter(Mandatory = $true)][string]$Text)

    $normalized = $Text -replace "`r`n", "`n"
    return ($normalized -replace "`r", "`n")
}

function Test-ComposerValueEmpty {
    param([AllowEmptyString()][string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $true
    }
    return $Script:Names.EmptyComposer -contains $Value.Trim()
}

function Test-SecurityAccessibleName {
    param([AllowEmptyString()][string]$Name)

    if ([string]::IsNullOrWhiteSpace($Name)) {
        return $false
    }
    if ($Script:SecurityExactNames -contains $Name) {
        return $true
    }

    $lower = $Name.ToLowerInvariant()
    foreach ($fragment in $Script:SecurityNameFragments) {
        if ($lower.Contains($fragment.ToLowerInvariant())) {
            return $true
        }
    }
    return $false
}

function Test-ClassNameToken {
    param(
        [AllowEmptyString()][string]$ClassName,
        [Parameter(Mandatory = $true)][string]$Token
    )

    if ([string]::IsNullOrWhiteSpace($ClassName) -or [string]::IsNullOrWhiteSpace($Token)) {
        return $false
    }
    return @($ClassName -split '\s+' | Where-Object { $_ -eq $Token }).Count -eq 1
}

function Test-TransientUiCategory {
    param([AllowEmptyString()][string]$Category)
    return $Script:TransientUiCategories -contains $Category
}

function New-SidebarException {
    param(
        [Parameter(Mandatory = $true)][int]$ExitCode,
        [Parameter(Mandatory = $true)][string]$Category,
        [Parameter(Mandatory = $true)][string]$Message,
        $Details = $null
    )

    $exception = [System.InvalidOperationException]::new($Message)
    $exception.Data['ExitCode'] = $ExitCode
    $exception.Data['Category'] = $Category
    if ($null -ne $Details) {
        $exception.Data['DetailsJson'] = ($Details | ConvertTo-Json -Depth 12 -Compress)
    }
    return $exception
}

function Throw-SidebarError {
    param(
        [Parameter(Mandatory = $true)][int]$ExitCode,
        [Parameter(Mandatory = $true)][string]$Category,
        [Parameter(Mandatory = $true)][string]$Message,
        $Details = $null
    )

    throw (New-SidebarException -ExitCode $ExitCode -Category $Category -Message $Message -Details $Details)
}

function Get-ExceptionCategory {
    param([Parameter(Mandatory = $true)]$Exception)

    if ($Exception.Data.Contains('Category')) {
        return [string]$Exception.Data['Category']
    }
    return 'InternalError'
}

function Get-ExceptionExitCode {
    param([Parameter(Mandatory = $true)]$Exception)

    if ($Exception.Data.Contains('ExitCode')) {
        return [int]$Exception.Data['ExitCode']
    }
    return [int]$Script:ExitCodes.Internal
}

function Get-ExceptionDetails {
    param([Parameter(Mandatory = $true)]$Exception)

    if (-not $Exception.Data.Contains('DetailsJson')) {
        return $null
    }

    try {
        return ([string]$Exception.Data['DetailsJson'] | ConvertFrom-Json)
    }
    catch {
        return $null
    }
}

function New-SafeErrorPayload {
    param(
        [Parameter(Mandatory = $true)]$Exception,
        [AllowEmptyString()][string]$CommandName
    )

    $categorized = $Exception.Data.Contains('Category') -and $Exception.Data.Contains('ExitCode')
    if ($categorized) {
        return [ordered]@{
            ok = $false
            command = $CommandName
            code = Get-ExceptionExitCode -Exception $Exception
            category = Get-ExceptionCategory -Exception $Exception
            message = $Exception.Message
            details = Get-ExceptionDetails -Exception $Exception
        }
    }

    return [ordered]@{
        ok = $false
        command = $CommandName
        code = [int]$Script:ExitCodes.Internal
        category = 'InternalError'
        message = 'An unexpected internal error occurred; raw exception text was suppressed.'
        details = [ordered]@{
            exceptionType = $Exception.GetType().FullName
        }
    }
}

function Write-JsonResult {
    param([Parameter(Mandatory = $true)]$Value)

    $json = $Value | ConvertTo-Json -Depth 14 -Compress
    [Console]::Out.WriteLine($json)
}

function Get-Sha256Bytes {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash($Bytes)
        return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
    }
    finally {
        $sha.Dispose()
    }
}

function Get-Sha256Text {
    param([AllowEmptyString()][Parameter(Mandatory = $true)][string]$Text)

    return Get-Sha256Bytes -Bytes $Script:Utf8NoBom.GetBytes($Text)
}

function Get-Sha256File {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash($stream)
        return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
    }
    finally {
        $sha.Dispose()
        $stream.Dispose()
    }
}

function Write-Utf8NoBomAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [AllowEmptyString()][Parameter(Mandatory = $true)][string]$Text
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $directory = [System.IO.Path]::GetDirectoryName($fullPath)
    if ([string]::IsNullOrWhiteSpace($directory)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'EvidencePathInvalid' -Message 'Evidence file path has no parent directory.'
    }

    $null = [System.IO.Directory]::CreateDirectory($directory)
    $temporaryPath = Join-Path $directory ('.tmp-' + [guid]::NewGuid().ToString('N'))
    $backupPath = Join-Path $directory ('.bak-' + [guid]::NewGuid().ToString('N'))

    $stream = $null
    try {
        $bytes = $Script:Utf8NoBom.GetBytes($Text)
        $stream = [System.IO.FileStream]::new(
            $temporaryPath,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
        $stream.Dispose()
        $stream = $null

        if ([System.IO.File]::Exists($fullPath)) {
            try {
                [System.IO.File]::Replace($temporaryPath, $fullPath, $backupPath)
            }
            catch [System.PlatformNotSupportedException] {
                [System.IO.File]::Delete($fullPath)
                [System.IO.File]::Move($temporaryPath, $fullPath)
            }
        }
        else {
            [System.IO.File]::Move($temporaryPath, $fullPath)
        }
    }
    finally {
        if ($null -ne $stream) {
            $stream.Dispose()
        }
        if ([System.IO.File]::Exists($temporaryPath)) {
            [System.IO.File]::Delete($temporaryPath)
        }
        if ([System.IO.File]::Exists($backupPath)) {
            [System.IO.File]::Delete($backupPath)
        }
    }
}

function Write-JsonAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $text = ($Value | ConvertTo-Json -Depth 14) + [Environment]::NewLine
    Write-Utf8NoBomAtomic -Path $Path -Text $text
}

function Resolve-EvidenceDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'EvidenceDirectoryRequired' -Message 'EvidenceDir is required for this command.'
    }

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $null = [System.IO.Directory]::CreateDirectory($fullPath)
    return $fullPath
}

function Enter-EvidenceLock {
    param([Parameter(Mandatory = $true)][string]$Directory)

    $lockPath = Join-Path $Directory '.chatgpt-pro-sidebar.lock'
    try {
        return [System.IO.File]::Open(
            $lockPath,
            [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
    }
    catch {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'EvidenceLocked' -Message 'Another chatgpt-pro-sidebar process holds this evidence directory.' -Details ([ordered]@{ lockFile = '.chatgpt-pro-sidebar.lock' })
    }
}

function Get-GlobalIdempotencyRoot {
    $override = [string]$Script:IdempotencyRootOverride
    if (-not [string]::IsNullOrWhiteSpace($override)) {
        return [System.IO.Path]::GetFullPath($override)
    }

    $localApplicationData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    if ([string]::IsNullOrWhiteSpace($localApplicationData)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'IdempotencyRootUnavailable' -Message 'The per-user local application data directory is unavailable.'
    }
    return Join-Path $localApplicationData 'ChatGptProSidebar\idempotency-v1'
}

function Assert-GlobalIdempotencyKeyAvailable {
    param([Parameter(Mandatory = $true)][string]$IdempotencyKeyValue)

    $root = Get-GlobalIdempotencyRoot
    $keySha256 = Get-Sha256Text -Text $IdempotencyKeyValue
    $path = Join-Path $root ($keySha256 + '.json')
    if ([System.IO.File]::Exists($path)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.DuplicateSubmission -Category 'GlobalDuplicateSubmissionBlocked' -Message 'This idempotency key already has a durable per-user reservation; automatic resend is prohibited.' -Details ([ordered]@{ idempotencyKeySha256 = $keySha256 })
    }
    return $keySha256
}

function Reserve-GlobalIdempotencyKey {
    param(
        [Parameter(Mandatory = $true)][string]$IdempotencyKeyValue,
        [Parameter(Mandatory = $true)][string]$PromptSha256
    )

    $root = Get-GlobalIdempotencyRoot
    try {
        $null = [System.IO.Directory]::CreateDirectory($root)
    }
    catch {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'IdempotencyRootCreateFailed' -Message 'The durable per-user idempotency directory could not be created.'
    }

    $keySha256 = Get-Sha256Text -Text $IdempotencyKeyValue
    $path = Join-Path $root ($keySha256 + '.json')
    $reservedAtUtc = [DateTime]::UtcNow.ToString('o')
    $record = [ordered]@{
        schemaVersion = $Script:SchemaVersion
        tool = $Script:ToolName
        idempotencyKeySha256 = $keySha256
        promptSha256 = $PromptSha256
        reservedAtUtc = $reservedAtUtc
        automaticResendAllowed = $false
    }
    $bytes = $Script:Utf8NoBom.GetBytes((($record | ConvertTo-Json -Depth 6) + [Environment]::NewLine))
    $stream = $null
    $created = $false
    try {
        try {
            $stream = [System.IO.FileStream]::new(
                $path,
                [System.IO.FileMode]::CreateNew,
                [System.IO.FileAccess]::Write,
                [System.IO.FileShare]::None
            )
            $created = $true
        }
        catch [System.IO.IOException] {
            if ([System.IO.File]::Exists($path)) {
                Throw-SidebarError -ExitCode $Script:ExitCodes.DuplicateSubmission -Category 'GlobalDuplicateSubmissionBlocked' -Message 'This idempotency key already has a durable per-user reservation; automatic resend is prohibited.' -Details ([ordered]@{ idempotencyKeySha256 = $keySha256 })
            }
            Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'IdempotencyReservationFailed' -Message 'The durable per-user idempotency reservation could not be created.'
        }

        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    }
    catch {
        if ($null -ne $stream) {
            $stream.Dispose()
            $stream = $null
        }
        if ($created -and [System.IO.File]::Exists($path)) {
            try { [System.IO.File]::Delete($path) } catch { }
        }
        if ($_.Exception.Data.Contains('Category')) {
            throw
        }
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'IdempotencyReservationFailed' -Message 'The durable per-user idempotency reservation could not be written.'
    }
    finally {
        if ($null -ne $stream) {
            $stream.Dispose()
        }
    }

    return [pscustomobject]@{
        KeySha256 = $keySha256
        ReservedAtUtc = $reservedAtUtc
    }
}

function Enter-UiMutex {
    $mutex = [System.Threading.Mutex]::new($false, 'Local\ChatGptProSidebarV1')
    $acquired = $false
    try {
        try {
            $acquired = $mutex.WaitOne(0)
        }
        catch [System.Threading.AbandonedMutexException] {
            $acquired = $true
        }

        if (-not $acquired) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.ConcurrentOperation -Category 'ConcurrentUiOperation' -Message 'Another chatgpt-pro-sidebar process is operating the Codex side panel.'
        }

        return [pscustomobject]@{
            Mutex = $mutex
            Acquired = $true
        }
    }
    catch {
        if (-not $acquired) {
            $mutex.Dispose()
        }
        throw
    }
}

function Exit-UiMutex {
    param($Lease)

    if ($null -eq $Lease) {
        return
    }
    try {
        if ([bool](Get-ObjectProperty $Lease 'Acquired' $false)) {
            $Lease.Mutex.ReleaseMutex()
        }
    }
    finally {
        $Lease.Mutex.Dispose()
    }
}

function Assert-EvidenceDirectoryPristine {
    param([Parameter(Mandatory = $true)][string]$Directory)

    $unexpected = @([System.IO.Directory]::EnumerateFileSystemEntries($Directory) | Where-Object {
        [System.IO.Path]::GetFileName($_) -ne '.chatgpt-pro-sidebar.lock'
    })
    if ($unexpected.Count -gt 0) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'EvidenceDirectoryNotPristine' -Message 'A new submission requires an otherwise empty evidence directory.' -Details ([ordered]@{ unexpectedEntryCount = $unexpected.Count })
    }
}

function Get-StatePath {
    param([Parameter(Mandatory = $true)][string]$Directory)
    return Join-Path $Directory 'state.json'
}

function Read-EvidenceState {
    param([Parameter(Mandatory = $true)][string]$Directory)

    $path = Get-StatePath -Directory $Directory
    if (-not [System.IO.File]::Exists($path)) {
        return $null
    }

    try {
        $state = [System.IO.File]::ReadAllText($path, $Script:Utf8NoBom) | ConvertFrom-Json
    }
    catch {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'EvidenceStateInvalid' -Message 'state.json is unreadable or invalid JSON.'
    }

    if ((Get-ObjectProperty -InputObject $state -Name 'schemaVersion' -Default 0) -ne $Script:SchemaVersion -or
        (Get-ObjectProperty -InputObject $state -Name 'tool' -Default '') -ne $Script:ToolName) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'EvidenceStateInvalid' -Message 'state.json does not belong to this tool or schema version.'
    }

    return $state
}

function Write-EvidenceState {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)]$State
    )

    Write-JsonAtomic -Path (Get-StatePath -Directory $Directory) -Value $State
}

function Assert-IdempotencyAvailable {
    param(
        $ExistingState,
        [Parameter(Mandatory = $true)][string]$IdempotencyKey
    )

    if ($null -eq $ExistingState) {
        return
    }

    $existingKey = [string](Get-ObjectProperty -InputObject $ExistingState -Name 'idempotencyKey' -Default '')
    $phase = [string](Get-ObjectProperty -InputObject $ExistingState -Name 'phase' -Default 'unknown')

    if ($existingKey -eq $IdempotencyKey) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.DuplicateSubmission -Category 'DuplicateSubmissionBlocked' -Message 'This idempotency key already has durable state; automatic resend is prohibited.' -Details ([ordered]@{ phase = $phase; idempotencyKey = $existingKey })
    }

    Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'EvidenceDirectoryConflict' -Message 'This evidence directory already belongs to another submission.' -Details ([ordered]@{ phase = $phase })
}

function Resolve-IdempotencyKey {
    param([AllowEmptyString()][string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'IdempotencyKeyRequired' -Message 'IdempotencyKey is required for send and run.'
    }
    if ($Value -notmatch '^[A-Za-z0-9._:-]{1,128}$') {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'IdempotencyKeyInvalid' -Message 'IdempotencyKey must be 1-128 characters from A-Z, a-z, 0-9, dot, underscore, colon, or hyphen.'
    }
    return $Value
}

function Read-PromptInput {
    param(
        [string]$PromptPathValue,
        [string]$PromptValue
    )

    $hasPath = -not [string]::IsNullOrWhiteSpace($PromptPathValue)
    $hasInline = -not [string]::IsNullOrWhiteSpace($PromptValue)

    if ($hasPath -eq $hasInline) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'PromptInputInvalid' -Message 'Provide exactly one of PromptPath or Prompt.'
    }

    if ($hasPath) {
        $fullPath = [System.IO.Path]::GetFullPath($PromptPathValue)
        if (-not [System.IO.File]::Exists($fullPath)) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'PromptFileMissing' -Message 'PromptPath does not exist.'
        }
        $text = [System.IO.File]::ReadAllText($fullPath)
    }
    else {
        $text = $PromptValue
    }

    $text = Normalize-TextForHash -Text $text
    # UIA ValuePattern removes terminal line breaks from the composer value.
    # Canonicalize them before hashing and persistence so the durable prompt is
    # exactly the value proved immediately before the one send invocation.
    $text = $text.TrimEnd([char[]]@([char]13, [char]10))
    if ([string]::IsNullOrWhiteSpace($text)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'PromptEmpty' -Message 'The prompt is empty.'
    }
    if ($text.Length -gt 200000) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'PromptTooLarge' -Message 'The prompt exceeds the 200,000-character safety limit.' -Details ([ordered]@{ characters = $text.Length })
    }

    return $text
}

function Select-CodexWindowRecord {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Records,
        [AllowEmptyString()][string]$TargetRuntimeId = '',
        [AllowEmptyString()][string]$FocusedTopLevelRuntimeId = ''
    )

    $candidates = @($Records | Where-Object {
        [bool](Get-ObjectProperty $_ 'IsVisible' $true) -and
        [int](Get-ObjectProperty $_ 'CodexDocumentCount' 0) -eq 1
    })
    if ($candidates.Count -eq 0) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'CodexWindowMissing' -Message 'No visible top-level window containing exactly one Codex document was proved.' -Details ([ordered]@{ candidateCount = 0 })
    }

    if (-not [string]::IsNullOrWhiteSpace($TargetRuntimeId)) {
        $targetMatches = @($candidates | Where-Object {
            [string](Get-ObjectProperty $_ 'RuntimeId' '') -eq $TargetRuntimeId
        })
        if ($targetMatches.Count -eq 1) {
            return $targetMatches[0]
        }
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'CodexWindowTargetMissing' -Message 'The explicitly selected Codex window is no longer available.' -Details ([ordered]@{
            candidateCount = $candidates.Count
            targetRuntimeId = $TargetRuntimeId
            candidateRuntimeIds = @($candidates | ForEach-Object { [string](Get-ObjectProperty $_ 'RuntimeId' '') })
        })
    }

    if ($candidates.Count -eq 1) {
        return $candidates[0]
    }

    $browserBearingCandidates = @($candidates | Where-Object {
        [int](Get-ObjectProperty $_ 'EmbeddedDocumentCount' 0) -gt 0
    })
    if ($browserBearingCandidates.Count -eq 1) {
        return $browserBearingCandidates[0]
    }

    if (-not [string]::IsNullOrWhiteSpace($FocusedTopLevelRuntimeId)) {
        $focusPool = if ($browserBearingCandidates.Count -gt 1) {
            $browserBearingCandidates
        }
        else {
            $candidates
        }
        $focusedMatches = @($focusPool | Where-Object {
            [string](Get-ObjectProperty $_ 'RuntimeId' '') -eq $FocusedTopLevelRuntimeId
        })
        if ($focusedMatches.Count -eq 1) {
            return $focusedMatches[0]
        }
    }

    if ($candidates.Count -gt 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'CodexWindowAmbiguous' -Message 'Multiple visible top-level windows contain exactly one Codex document; focus the intended window or pass WindowRuntimeId.' -Details ([ordered]@{
            candidateCount = $candidates.Count
            focusedTopLevelRuntimeId = $FocusedTopLevelRuntimeId
            candidateRuntimeIds = @($candidates | ForEach-Object { [string](Get-ObjectProperty $_ 'RuntimeId' '') })
        })
    }
    return $candidates[0]
}

function Select-EmbeddedDocumentRecord {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Records)

    $visible = @($Records | Where-Object { [bool](Get-ObjectProperty $_ 'IsVisible' $false) })
    $semantic = @($visible | Where-Object { [int](Get-ObjectProperty $_ 'ComposerCount' 0) -eq 1 })

    if ($semantic.Count -eq 1) {
        return $semantic[0]
    }
    if ($semantic.Count -gt 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.DocumentSelection -Category 'EmbeddedDocumentAmbiguous' -Message 'Multiple embedded documents contain a matching ChatGPT composer.' -Details ([ordered]@{ candidateCount = $semantic.Count })
    }

    $geometric = @($visible | Where-Object { [bool](Get-ObjectProperty $_ 'GeometryMatch' $false) })
    if ($geometric.Count -eq 1) {
        return $geometric[0]
    }

    $category = 'EmbeddedDocumentMissing'
    if ($geometric.Count -gt 1) {
        $category = 'EmbeddedDocumentAmbiguous'
    }
    Throw-SidebarError -ExitCode $Script:ExitCodes.DocumentSelection -Category $category -Message 'Unable to prove one embedded ChatGPT web document.' -Details ([ordered]@{ visibleDocumentCount = $visible.Count; geometricCandidateCount = $geometric.Count })
}

function Select-UniqueControlRecord {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Records,
        [Parameter(Mandatory = $true)][string]$Label,
        [switch]$AllowDisabled,
        [switch]$AllowOffscreen
    )

    $eligible = @($Records | Where-Object {
        ($AllowOffscreen -or [bool](Get-ObjectProperty $_ 'IsVisible' $false)) -and
        ($AllowDisabled -or [bool](Get-ObjectProperty $_ 'IsEnabled' $false))
    })

    if ($eligible.Count -eq 0) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category ($Label + 'Missing') -Message ('No eligible ' + $Label + ' control was found.') -Details ([ordered]@{ candidateCount = 0 })
    }
    if ($eligible.Count -gt 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category ($Label + 'Ambiguous') -Message ('Multiple eligible ' + $Label + ' controls were found.') -Details ([ordered]@{ candidateCount = $eligible.Count })
    }
    return $eligible[0]
}

function Select-NewChatRecord {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Records)

    $eligible = @($Records | Where-Object {
        [bool](Get-ObjectProperty $_ 'IsVisible' $false) -and
        [bool](Get-ObjectProperty $_ 'IsEnabled' $false)
    })

    if ($eligible.Count -eq 1) {
        return $eligible[0]
    }
    if ($eligible.Count -eq 0) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'NewChatMissing' -Message 'No eligible New chat control is visible.'
    }

    $ranked = @($eligible | Sort-Object -Property @(
        @{ Expression = { [double](Get-ObjectProperty $_ 'Width' 0) }; Descending = $true },
        @{ Expression = { [double](Get-ObjectProperty $_ 'Area' 0) }; Descending = $true },
        @{ Expression = { [double](Get-ObjectProperty $_ 'X' 0) }; Descending = $false },
        @{ Expression = { [double](Get-ObjectProperty $_ 'Y' 0) }; Descending = $false },
        @{ Expression = { [string](Get-ObjectProperty $_ 'RuntimeId' '') }; Descending = $false }
    ))

    $first = $ranked[0]
    $second = $ranked[1]
    $firstWidth = [double](Get-ObjectProperty $first 'Width' 0)
    $secondWidth = [double](Get-ObjectProperty $second 'Width' 0)
    $firstArea = [double](Get-ObjectProperty $first 'Area' 0)
    $secondArea = [double](Get-ObjectProperty $second 'Area' 0)

    $dominatesByWidth = $firstWidth -ge 96 -and ($secondWidth -le 64 -or $firstWidth -ge (1.5 * [Math]::Max($secondWidth, 1)))
    $dominatesByArea = $firstArea -gt 0 -and $firstArea -ge (1.5 * [Math]::Max($secondArea, 1))

    if ($dominatesByWidth -and $dominatesByArea) {
        return $first
    }

    Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'NewChatAmbiguous' -Message 'Duplicate New chat controls do not have a safely dominant geometry.' -Details ([ordered]@{ candidateCount = $eligible.Count })
}

function Assert-AuthReadySnapshot {
    param([Parameter(Mandatory = $true)]$Snapshot)

    $loginCount = [int](Get-ObjectProperty $Snapshot 'LoginCount' 0)
    $proCount = [int](Get-ObjectProperty $Snapshot 'ProCount' 0)
    $challengeCount = [int](Get-ObjectProperty $Snapshot 'SecurityChallengeCount' 0)
    $composerCount = [int](Get-ObjectProperty $Snapshot 'ComposerCount' 0)

    if ($loginCount -gt 0 -or $challengeCount -gt 0) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.AuthBarrier -Category 'AuthenticationOrSecurityChallenge' -Message 'Login, account selection, or a protective security challenge is visible. User action is required.' -Details ([ordered]@{ loginControlCount = $loginCount; securityChallengeControlCount = $challengeCount })
    }
    if ($proCount -lt 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.AuthBarrier -Category 'ProStateMissing' -Message 'A visible ChatGPT Pro state could not be proved.' -Details ([ordered]@{ proIndicatorCount = $proCount })
    }
    if ($composerCount -eq 0) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'ComposerMissing' -Message 'No visible, enabled ChatGPT composer was found.' -Details ([ordered]@{ composerCount = 0 })
    }
    if ($composerCount -gt 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'ComposerAmbiguous' -Message 'Multiple visible, enabled ChatGPT composers were found.' -Details ([ordered]@{ composerCount = $composerCount })
    }
}

function Assert-ChatGptUrlState {
    param(
        [Parameter(Mandatory = $true)]$UrlState,
        [switch]$RequireFreshConversation,
        [switch]$RequireExistingConversation
    )

    if ($RequireFreshConversation -and $RequireExistingConversation) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Internal -Category 'ConversationModeInvalid' -Message 'Fresh and existing conversation requirements are mutually exclusive.'
    }

    $url = [string](Get-ObjectProperty $UrlState 'Url' '')
    $declaredExact = [bool](Get-ObjectProperty $UrlState 'Exact' $false)
    if ([string]::IsNullOrWhiteSpace($url)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.UrlCapture -Category 'ChatGptOriginUnproved' -Message 'A canonical https://chatgpt.com URL could not be proved before acting.'
    }
    $canonical = ConvertTo-SanitizedChatGptUrl -Candidate $url
    if ($null -eq $canonical -or -not $canonical.AllowedForChat) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.UrlCapture -Category 'ChatGptPathUnsupported' -Message 'The canonical ChatGPT URL is not an allowed new-chat or conversation path.'
    }
    if ($declaredExact -ne [bool]$canonical.Exact) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.UrlCapture -Category 'ChatGptUrlStateInconsistent' -Message 'The reported exact-URL state does not match the canonical URL.'
    }
    $exact = [bool]$canonical.Exact
    if ($RequireFreshConversation -and $exact) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'FreshConversationUnproved' -Message 'A fresh ChatGPT conversation was required, but the address bar still identifies an existing conversation.'
    }
    if ($RequireExistingConversation -and -not $exact) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.UrlCapture -Category 'ExistingConversationUnproved' -Message 'An exact existing ChatGPT conversation URL is required for a follow-up round.'
    }
}

function Assert-PreSendUrlInvariant {
    param(
        [Parameter(Mandatory = $true)]$InitialUrlState,
        [Parameter(Mandatory = $true)]$CurrentUrlState,
        [switch]$RequireFreshConversation,
        [switch]$RequireExistingConversation
    )

    Assert-ChatGptUrlState -UrlState $InitialUrlState -RequireFreshConversation:$RequireFreshConversation -RequireExistingConversation:$RequireExistingConversation
    Assert-ChatGptUrlState -UrlState $CurrentUrlState -RequireFreshConversation:$RequireFreshConversation -RequireExistingConversation:$RequireExistingConversation

    $initialUrl = [string](Get-ObjectProperty $InitialUrlState 'Url' '')
    $currentUrl = [string](Get-ObjectProperty $CurrentUrlState 'Url' '')
    $initialExact = [bool](Get-ObjectProperty $InitialUrlState 'Exact' $false)
    $currentExact = [bool](Get-ObjectProperty $CurrentUrlState 'Exact' $false)
    if ($initialUrl -ne $currentUrl -or $initialExact -ne $currentExact) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'PreSendConversationChanged' -Message 'The ChatGPT address changed while the prompt was being prepared; no send action was invoked.'
    }
}

function Assert-SendPreconditions {
    param(
        [Parameter(Mandatory = $true)]$Snapshot,
        [Parameter(Mandatory = $true)][string]$ExpectedPromptSha256
    )

    if ([bool](Get-ObjectProperty $Snapshot 'Generating' $false)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.GenerationActive -Category 'GenerationAlreadyActive' -Message 'ChatGPT is already generating; duplicate submission is prohibited.'
    }

    $composerCount = [int](Get-ObjectProperty $Snapshot 'ComposerCount' 0)
    $sendCount = [int](Get-ObjectProperty $Snapshot 'SendCount' 0)
    $composerSha = [string](Get-ObjectProperty $Snapshot 'ComposerSha256' '')

    if ($composerCount -ne 1 -or $sendCount -ne 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'ComposerOrSendAmbiguous' -Message 'Exactly one composer and one send control are required immediately before submission.' -Details ([ordered]@{ composerCount = $composerCount; sendCount = $sendCount })
    }
    if ($composerSha -ne $ExpectedPromptSha256) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'ComposerVerificationFailed' -Message 'The composer value does not match the requested prompt hash.'
    }
}

function Compare-ResponseBaseline {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$BaselineHashes,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$CurrentResponses
    )

    $currentHashes = @($CurrentResponses | ForEach-Object { [string](Get-ObjectProperty $_ 'ContentSha256' '') })

    if ($currentHashes.Count -lt $BaselineHashes.Count) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'ResponseBaselineMismatch' -Message 'The current response list is shorter than the recorded baseline.' -Details ([ordered]@{ baselineCount = $BaselineHashes.Count; currentCount = $currentHashes.Count })
    }

    for ($index = 0; $index -lt $BaselineHashes.Count; $index++) {
        if ($currentHashes[$index] -ne $BaselineHashes[$index]) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'ResponseBaselineMismatch' -Message 'Existing assistant responses no longer match the recorded ordered baseline.' -Details ([ordered]@{ mismatchIndex = $index; baselineCount = $BaselineHashes.Count; currentCount = $currentHashes.Count })
        }
    }

    $newCount = $currentHashes.Count - $BaselineHashes.Count
    if ($newCount -eq 0) {
        return [pscustomobject]@{ Status = 'none'; NewResponse = $null }
    }
    if ($newCount -eq 1) {
        return [pscustomobject]@{ Status = 'one'; NewResponse = $CurrentResponses[$CurrentResponses.Count - 1] }
    }

    Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'MultipleNewResponses' -Message 'More than one new assistant response appeared after one send.' -Details ([ordered]@{ newResponseCount = $newCount })
}

function Join-ResponseTextRecords {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Records,
        [Parameter(Mandatory = $true)][double]$CopyAnchorY,
        [int]$MaximumCharacters = 200000,
        [switch]$PreserveInputOrder
    )

    if ($PreserveInputOrder) {
        $ordered = @($Records)
    }
    else {
        $ordered = @($Records | Sort-Object -Property @(
            @{ Expression = { [double](Get-ObjectProperty $_ 'Y' 0) }; Descending = $false },
            @{ Expression = { [double](Get-ObjectProperty $_ 'X' 0) }; Descending = $false },
            @{ Expression = { [string](Get-ObjectProperty $_ 'RuntimeId' '') }; Descending = $false }
        ))
    }
    $parts = [System.Collections.Generic.List[string]]::new()
    $seen = @{}
    $characterCount = 0

    foreach ($record in $ordered) {
        $name = [string](Get-ObjectProperty $record 'Name' '')
        if ([string]::IsNullOrWhiteSpace($name)) {
            continue
        }
        $name = $name.Trim()
        if ($Script:ResponseActionNames -contains $name) {
            continue
        }

        $y = [double](Get-ObjectProperty $record 'Y' 0)
        if ($CopyAnchorY -gt 0 -and $y -gt ($CopyAnchorY + 80)) {
            continue
        }

        $runtimeId = [string](Get-ObjectProperty $record 'RuntimeId' '')
        $x = [Math]::Round([double](Get-ObjectProperty $record 'X' 0), 1)
        $roundedY = [Math]::Round($y, 1)
        $width = [Math]::Round([double](Get-ObjectProperty $record 'Width' 0), 1)
        $height = [Math]::Round([double](Get-ObjectProperty $record 'Height' 0), 1)
        if ($x -ne 0 -or $roundedY -ne 0 -or $width -gt 0 -or $height -gt 0) {
            $key = 'geometry|' + $x + '|' + $roundedY + '|' + $width + '|' + $height + '|' + $name
        }
        else {
            $key = 'runtime|' + $runtimeId + '|' + $name
        }
        if ($seen.ContainsKey($key)) {
            continue
        }
        $seen[$key] = $true

        $additional = $name.Length
        if ($parts.Count -gt 0) {
            $additional += [Environment]::NewLine.Length
        }
        if (($characterCount + $additional) -gt $MaximumCharacters) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'ResponseTextLimitExceeded' -Message 'A candidate assistant response exceeds the bounded character limit.' -Details ([ordered]@{ maximumCharacters = $MaximumCharacters })
        }

        $null = $parts.Add($name)
        $characterCount += $additional
    }

    return ($parts.ToArray() -join [Environment]::NewLine).Trim()
}

function ConvertTo-SanitizedChatGptUrl {
    param([AllowEmptyString()][string]$Candidate)

    if ([string]::IsNullOrWhiteSpace($Candidate)) {
        return $null
    }

    $text = $Candidate.Trim()
    if ($text -match '^chatgpt\.com(?:/|$)') {
        $text = 'https://' + $text
    }

    $uri = $null
    if (-not [System.Uri]::TryCreate($text, [System.UriKind]::Absolute, [ref]$uri)) {
        return $null
    }

    if ($uri.Scheme -ne 'https' -or -not $uri.IsDefaultPort) {
        return $null
    }

    $uriHost = $uri.DnsSafeHost.ToLowerInvariant()
    if ($uriHost -ne 'chatgpt.com' -and $uriHost -ne 'www.chatgpt.com') {
        return $null
    }
    if (-not [string]::IsNullOrEmpty($uri.UserInfo)) {
        return $null
    }

    $path = $uri.AbsolutePath
    if ($path.Length -gt 1) {
        $path = $path.TrimEnd('/')
    }

    $builder = [System.UriBuilder]::new($uri)
    $builder.Host = 'chatgpt.com'
    $builder.Path = $path
    $builder.Query = ''
    $builder.Fragment = ''
    $builder.UserName = ''
    $builder.Password = ''
    $builder.Port = -1
    $sanitized = $builder.Uri.AbsoluteUri
    $conversationSegment = '[A-Za-z0-9_-]{8,128}'
    $gptSegment = '[A-Za-z0-9_-]{1,128}'
    $exact = $path -match ('^/(?:g/' + $gptSegment + '/)?c/' + $conversationSegment + '$')
    $allowedForChat = $path -eq '/' -or $exact -or $path -match ('^/g/' + $gptSegment + '$')

    return [pscustomobject]@{
        Url = $sanitized
        Exact = [bool]$exact
        AllowedForChat = [bool]$allowedForChat
    }
}

function Assert-ConversationUrlMatch {
    param(
        [AllowEmptyString()][string]$ExpectedUrl,
        [Parameter(Mandatory = $true)][string]$ActualUrl
    )

    if ([string]::IsNullOrWhiteSpace($ExpectedUrl)) {
        return
    }
    if ($ExpectedUrl -ne $ActualUrl) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'ConversationUrlChanged' -Message 'The final conversation URL does not match the URL bound to this send.'
    }
}

function Get-BoundConversationUrlFromState {
    param([Parameter(Mandatory = $true)]$State)

    $candidate = [string](Get-ObjectProperty $State 'conversationUrlBound' '')
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        $candidate = [string](Get-ObjectProperty $State 'conversationUrlBeforeSend' '')
    }

    $canonical = ConvertTo-SanitizedChatGptUrl -Candidate $candidate
    if ($null -eq $canonical -or -not $canonical.Exact -or $canonical.Url -ne $candidate) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.UrlCapture -Category 'ConversationUrlUnbound' -Message 'This submission is not durably bound to one exact ChatGPT conversation URL; response extraction is prohibited.'
    }
    return $canonical.Url
}

function Resolve-SanitizedUrlFromCandidates {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Candidates)

    $fallback = $null
    foreach ($candidate in $Candidates) {
        $value = ConvertTo-SanitizedChatGptUrl -Candidate ([string]$candidate)
        if ($null -eq $value) {
            continue
        }
        if ($value.Exact) {
            return $value
        }
        if ($null -eq $fallback) {
            $fallback = $value
        }
    }
    return $fallback
}

function New-BoundedStatusPayload {
    param([Parameter(Mandatory = $true)]$Snapshot)

    $codexWindowCount = [int](Get-ObjectProperty $Snapshot 'CodexWindowCount' 0)
    $embeddedDocumentCount = [int](Get-ObjectProperty $Snapshot 'EmbeddedDocumentCount' 0)
    $addressCount = [int](Get-ObjectProperty $Snapshot 'AddressCount' 0)
    $composerCount = [int](Get-ObjectProperty $Snapshot 'ComposerCount' 0)
    $loginCount = [int](Get-ObjectProperty $Snapshot 'LoginCount' 0)
    $proCount = [int](Get-ObjectProperty $Snapshot 'ProCount' 0)
    $challengeCount = [int](Get-ObjectProperty $Snapshot 'SecurityChallengeCount' 0)
    $url = Get-ObjectProperty $Snapshot 'Url' $null
    $urlInfo = if ($null -eq $url) { $null } else { ConvertTo-SanitizedChatGptUrl -Candidate ([string]$url) }
    $urlAllowed = $null -ne $urlInfo -and $urlInfo.AllowedForChat
    $generating = [bool](Get-ObjectProperty $Snapshot 'Generating' $false)
    $windowRuntimeId = [string](Get-ObjectProperty $Snapshot 'WindowRuntimeId' '')

    return [ordered]@{
        ok = $true
        command = 'status'
        live = $true
        transport = 'windows-uia'
        ready = $codexWindowCount -eq 1 -and $embeddedDocumentCount -eq 1 -and $addressCount -eq 1 -and $loginCount -eq 0 -and $challengeCount -eq 0 -and $proCount -ge 1 -and $composerCount -eq 1 -and -not $generating -and $urlAllowed
        codexWindowCount = $codexWindowCount
        windowRuntimeId = $windowRuntimeId
        embeddedDocumentCount = $embeddedDocumentCount
        addressControlCount = $addressCount
        composerCount = $composerCount
        loginControlCount = $loginCount
        proIndicatorCount = $proCount
        securityChallengeControlCount = $challengeCount
        generating = $generating
        panelRecovered = [bool](Get-ObjectProperty $Snapshot 'PanelRecovered' $false)
        url = $url
        urlExact = [bool](Get-ObjectProperty $Snapshot 'UrlExact' $false)
        urlAllowedForChat = [bool]$urlAllowed
        clipboardUsed = $false
        focusRestoreBestEffort = -not [bool]$NoFocusRestore
    }
}

function Invoke-PollUntilCompleted {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$BaselineHashes,
        [Parameter(Mandatory = $true)][scriptblock]$ObservationProvider,
        [Parameter(Mandatory = $true)][scriptblock]$SleepAction,
        [Parameter(Mandatory = $true)][scriptblock]$UtcNowProvider,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
        [Parameter(Mandatory = $true)][int]$PollMilliseconds
    )

    $deadline = (& $UtcNowProvider).AddSeconds($TimeoutSeconds)
    $stableHash = $null
    $stablePolls = 0
    $requiredStablePolls = [Math]::Max(2, [int][Math]::Ceiling(1500.0 / $PollMilliseconds) + 1)
    $transientCount = 0
    $baselineMismatchPolls = 0

    while ((& $UtcNowProvider) -lt $deadline) {
        $observation = & $ObservationProvider
        if ([bool](Get-ObjectProperty $observation 'Transient' $false)) {
            $transientCount++
            & $SleepAction $PollMilliseconds
            continue
        }

        try {
            $comparison = Compare-ResponseBaseline -BaselineHashes $BaselineHashes -CurrentResponses @((Get-ObjectProperty $observation 'Responses' @()))
            $baselineMismatchPolls = 0
        }
        catch {
            if ((Get-ExceptionCategory -Exception $_.Exception) -ne 'ResponseBaselineMismatch') {
                throw
            }
            $baselineMismatchPolls++
            if ($baselineMismatchPolls -ge 3) {
                throw
            }
            & $SleepAction $PollMilliseconds
            continue
        }

        if ($comparison.Status -eq 'one' -and -not [bool](Get-ObjectProperty $observation 'Generating' $false)) {
            $response = $comparison.NewResponse
            $content = [string](Get-ObjectProperty $response 'Content' '')
            $hash = [string](Get-ObjectProperty $response 'ContentSha256' '')

            if (-not [string]::IsNullOrWhiteSpace($content) -and -not [string]::IsNullOrWhiteSpace($hash)) {
                if ($hash -eq $stableHash) {
                    $stablePolls++
                }
                else {
                    $stableHash = $hash
                    $stablePolls = 1
                }

                if ($stablePolls -ge $requiredStablePolls) {
                    return [pscustomobject]@{
                        Response = $response
                        TransientObservationCount = $transientCount
                        StablePollCount = $stablePolls
                    }
                }
            }
        }
        else {
            $stableHash = $null
            $stablePolls = 0
        }

        & $SleepAction $PollMilliseconds
    }

    Throw-SidebarError -ExitCode $Script:ExitCodes.Timeout -Category 'ResponseTimeout' -Message 'Timed out before one new assistant response became idle and stable.' -Details ([ordered]@{ timeoutSeconds = $TimeoutSeconds; transientObservationCount = $transientCount })
}

function Initialize-LiveUiAutomation {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Unsupported -Category 'WindowsRequired' -Message 'Live mode requires Windows.'
    }

    $null = Add-Type -AssemblyName UIAutomationClient
    $null = Add-Type -AssemblyName UIAutomationTypes
}

function Get-FocusedAutomationElement {
    try {
        return [System.Windows.Automation.AutomationElement]::FocusedElement
    }
    catch {
        return $null
    }
}

function Get-AutomationRuntimeIdText {
    param($Element)

    if ($null -eq $Element) {
        return ''
    }
    try {
        return (($Element.GetRuntimeId() | ForEach-Object { [string]$_ }) -join '.')
    }
    catch {
        return ''
    }
}

function Get-LiveTopLevelRuntimeId {
    param($Element)

    if ($null -eq $Element) {
        return ''
    }

    try {
        $root = [System.Windows.Automation.AutomationElement]::RootElement
        $rootId = Get-AutomationRuntimeIdText -Element $root
        $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
        $current = $Element
        for ($depth = 0; $depth -lt 64 -and $null -ne $current; $depth++) {
            $parent = $walker.GetParent($current)
            if ($null -eq $parent) {
                return ''
            }
            if ((Get-AutomationRuntimeIdText -Element $parent) -eq $rootId) {
                return Get-AutomationRuntimeIdText -Element $current
            }
            $current = $parent
        }
    }
    catch [System.Windows.Automation.ElementNotAvailableException] {
        return ''
    }
    catch {
        return ''
    }
    return ''
}

function Get-LiveFocusState {
    $focusedElement = Get-FocusedAutomationElement
    return [pscustomobject]@{
        Element = $focusedElement
        TopLevelRuntimeId = Get-LiveTopLevelRuntimeId -Element $focusedElement
    }
}

function Test-FocusRestoreAllowed {
    param(
        [AllowEmptyString()][string]$OriginalTopLevelRuntimeId,
        [AllowEmptyString()][string]$CurrentTopLevelRuntimeId,
        [AllowEmptyString()][string]$ExpectedAutomationTopLevelRuntimeId
    )

    if ([string]::IsNullOrWhiteSpace($OriginalTopLevelRuntimeId) -or
        [string]::IsNullOrWhiteSpace($CurrentTopLevelRuntimeId) -or
        [string]::IsNullOrWhiteSpace($ExpectedAutomationTopLevelRuntimeId)) {
        return $false
    }
    return $CurrentTopLevelRuntimeId -eq $ExpectedAutomationTopLevelRuntimeId -or $CurrentTopLevelRuntimeId -eq $OriginalTopLevelRuntimeId
}

function Invoke-LiveAddressTextSelection {
    param([Parameter(Mandatory = $true)]$AddressElement)

    $textObject = $null
    if (-not $AddressElement.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textObject)) {
        return $false
    }
    try {
        $textObject.DocumentRange.Select()
        return $true
    }
    catch [System.Windows.Automation.ElementNotAvailableException] {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'TransientUiRerender' -Message 'The address control rerendered while its UIA text range was selected.' -Details ([ordered]@{ transient = $true })
    }
    catch {
        return $false
    }
}

function Restore-FocusState {
    param(
        $OriginalState,
        [AllowEmptyString()][string]$ExpectedAutomationTopLevelRuntimeId
    )

    if ($NoFocusRestore -or $null -eq $OriginalState) {
        return $false
    }
    $originalElement = Get-ObjectProperty $OriginalState 'Element' $null
    $originalTopLevelRuntimeId = [string](Get-ObjectProperty $OriginalState 'TopLevelRuntimeId' '')
    if ($null -eq $originalElement -or [string]::IsNullOrWhiteSpace($originalTopLevelRuntimeId)) {
        return $false
    }

    $currentState = Get-LiveFocusState
    $currentTopLevelRuntimeId = [string](Get-ObjectProperty $currentState 'TopLevelRuntimeId' '')
    if (-not (Test-FocusRestoreAllowed -OriginalTopLevelRuntimeId $originalTopLevelRuntimeId -CurrentTopLevelRuntimeId $currentTopLevelRuntimeId -ExpectedAutomationTopLevelRuntimeId $ExpectedAutomationTopLevelRuntimeId)) {
        return $false
    }

    try {
        $originalElement.SetFocus()
        return $true
    }
    catch [System.Windows.Automation.ElementNotAvailableException] {
        return $false
    }
    catch {
        return $false
    }
}

function Get-ControlTypeName {
    param($Element)
    try {
        return [string]$Element.Current.ControlType.ProgrammaticName
    }
    catch {
        return ''
    }
}

function ConvertTo-LiveRecord {
    param([Parameter(Mandatory = $true)]$Element)

    try {
        $rectangle = $Element.Current.BoundingRectangle
        $width = [double]$rectangle.Width
        $height = [double]$rectangle.Height
        $runtimeId = ''
        try {
            $runtimeId = (($Element.GetRuntimeId() | ForEach-Object { [string]$_ }) -join '.')
        }
        catch {
            $runtimeId = ''
        }

        return [pscustomobject]@{
            Element = $Element
            Name = [string]$Element.Current.Name
            AutomationId = [string]$Element.Current.AutomationId
            ClassName = [string]$Element.Current.ClassName
            ControlType = Get-ControlTypeName -Element $Element
            IsEnabled = [bool]$Element.Current.IsEnabled
            IsVisible = -not [bool]$Element.Current.IsOffscreen -and $width -gt 0 -and $height -gt 0
            X = [double]$rectangle.X
            Y = [double]$rectangle.Y
            Width = $width
            Height = $height
            Area = $width * $height
            RuntimeId = $runtimeId
        }
    }
    catch [System.Windows.Automation.ElementNotAvailableException] {
        return $null
    }
}

function New-OrCondition {
    param([Parameter(Mandatory = $true)][object[]]$Conditions)

    if ($Conditions.Count -eq 1) {
        return $Conditions[0]
    }
    return [System.Windows.Automation.OrCondition]::new([System.Windows.Automation.Condition[]]$Conditions)
}

function Find-LiveElementsByNames {
    param(
        [Parameter(Mandatory = $true)]$Root,
        [Parameter(Mandatory = $true)][object[]]$ControlTypes,
        [Parameter(Mandatory = $true)][string[]]$Names,
        $Scope = $null
    )

    if ($null -eq $Scope) {
        $Scope = [System.Windows.Automation.TreeScope]::Descendants
    }

    $conditions = @()
    foreach ($controlType in $ControlTypes) {
        foreach ($name in $Names) {
            $conditions += [System.Windows.Automation.AndCondition]::new(
                [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $controlType),
                [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $name)
            )
        }
    }

    if ($conditions.Count -eq 0) {
        return @()
    }

    $condition = New-OrCondition -Conditions $conditions
    try {
        $collection = $Root.FindAll($Scope, $condition)
    }
    catch [System.Windows.Automation.ElementNotAvailableException] {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'TransientUiRerender' -Message 'The UI rerendered while controls were being selected.' -Details ([ordered]@{ transient = $true })
    }

    $records = @()
    foreach ($element in $collection) {
        $record = ConvertTo-LiveRecord -Element $element
        if ($null -ne $record) {
            $records += $record
        }
    }
    return $records
}

function Find-LiveElementsByControlTypes {
    param(
        [Parameter(Mandatory = $true)]$Root,
        [Parameter(Mandatory = $true)][object[]]$ControlTypes,
        $Scope = $null
    )

    if ($null -eq $Scope) {
        $Scope = [System.Windows.Automation.TreeScope]::Descendants
    }

    $conditions = @()
    foreach ($controlType in $ControlTypes) {
        $conditions += [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $controlType)
    }
    $condition = New-OrCondition -Conditions $conditions
    try {
        $collection = $Root.FindAll($Scope, $condition)
    }
    catch [System.Windows.Automation.ElementNotAvailableException] {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'TransientUiRerender' -Message 'The UI rerendered while controls were being selected.' -Details ([ordered]@{ transient = $true })
    }
    $records = @()
    foreach ($element in $collection) {
        $record = ConvertTo-LiveRecord -Element $element
        if ($null -ne $record) {
            $records += $record
        }
    }
    return $records
}

function Get-LiveCodexWindow {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    try {
        $topLevelElements = $root.FindAll(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.Condition]::TrueCondition
        )
    }
    catch {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'TopLevelWindowEnumerationFailed' -Message 'Windows UI Automation could not enumerate top-level elements.'
    }

    if ($topLevelElements.Count -gt 512) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'TopLevelWindowLimitExceeded' -Message 'The top-level UI Automation element count exceeds the bounded discovery limit.' -Details ([ordered]@{ topLevelElementCount = $topLevelElements.Count })
    }

    $records = @()
    foreach ($element in $topLevelElements) {
        try {
            $record = ConvertTo-LiveRecord -Element $element
            if ($null -eq $record -or -not $record.IsVisible) {
                continue
            }

            $documents = @(Find-LiveElementsByControlTypes -Root $element -ControlTypes @([System.Windows.Automation.ControlType]::Document))
            $codexDocuments = @($documents | Where-Object {
                $Script:Names.CodexDocument -contains $_.Name
            })
            $embeddedDocuments = @($documents | Where-Object {
                $_.IsVisible -and $Script:Names.CodexDocument -notcontains $_.Name
            })
            $records += [pscustomobject]@{
                Element = $element
                CodexDocumentCount = @($codexDocuments).Count
                EmbeddedDocumentCount = @($embeddedDocuments).Count
                IsVisible = $record.IsVisible
                RuntimeId = $record.RuntimeId
            }
        }
        catch [System.Windows.Automation.ElementNotAvailableException] {
            continue
        }
        catch {
            if ((Get-ExceptionCategory -Exception $_.Exception) -eq 'TransientUiRerender') {
                continue
            }
            continue
        }
    }

    $focusedTopLevelRuntimeId = ''
    try {
        $focusedTopLevelRuntimeId = [string](Get-ObjectProperty (Get-LiveFocusState) 'TopLevelRuntimeId' '')
    }
    catch {
        $focusedTopLevelRuntimeId = ''
    }
    return Select-CodexWindowRecord -Records $records -TargetRuntimeId $Script:TargetWindowRuntimeId -FocusedTopLevelRuntimeId $focusedTopLevelRuntimeId
}

function Get-LiveAddressRecords {
    param([Parameter(Mandatory = $true)]$WindowElement)

    return @(Find-LiveElementsByNames -Root $WindowElement -ControlTypes @([System.Windows.Automation.ControlType]::Edit) -Names $Script:Names.Address | Where-Object { $_.IsVisible })
}

function Test-DocumentGeometryMatch {
    param(
        [Parameter(Mandatory = $true)]$DocumentRecord,
        [Parameter(Mandatory = $true)]$AddressRecord
    )

    $documentLeft = [double]$DocumentRecord.X
    $documentRight = $documentLeft + [double]$DocumentRecord.Width
    $addressLeft = [double]$AddressRecord.X
    $addressRight = $addressLeft + [double]$AddressRecord.Width
    $overlap = [Math]::Max(0, [Math]::Min($documentRight, $addressRight) - [Math]::Max($documentLeft, $addressLeft))
    $minimumWidth = [Math]::Max(1, [Math]::Min([double]$DocumentRecord.Width, [double]$AddressRecord.Width))
    $horizontalRatio = $overlap / $minimumWidth
    $documentTop = [double]$DocumentRecord.Y
    $addressBottom = [double]$AddressRecord.Y + [double]$AddressRecord.Height

    return $horizontalRatio -ge 0.65 -and $documentTop -ge ($addressBottom - 20)
}

function Get-LiveEmbeddedDocumentRecords {
    param(
        [Parameter(Mandatory = $true)]$WindowElement,
        [object[]]$AddressRecords = @()
    )

    $documents = Find-LiveElementsByControlTypes -Root $WindowElement -ControlTypes @([System.Windows.Automation.ControlType]::Document)
    $records = @()
    foreach ($document in $documents) {
        if ($Script:Names.CodexDocument -contains $document.Name) {
            continue
        }

        $composerRecords = Find-LiveElementsByNames -Root $document.Element -ControlTypes @([System.Windows.Automation.ControlType]::Edit) -Names $Script:Names.Composer
        $geometryMatch = $false
        if ($AddressRecords.Count -eq 1) {
            $geometryMatch = Test-DocumentGeometryMatch -DocumentRecord $document -AddressRecord $AddressRecords[0]
        }

        $records += [pscustomobject]@{
            Element = $document.Element
            IsVisible = $document.IsVisible
            ComposerCount = @($composerRecords | Where-Object { $_.IsVisible -and $_.IsEnabled }).Count
            GeometryMatch = $geometryMatch
            X = $document.X
            Y = $document.Y
            Width = $document.Width
            Height = $document.Height
            RuntimeId = $document.RuntimeId
        }
    }
    return $records
}

function Invoke-PanelControl {
    param(
        [Parameter(Mandatory = $true)]$Record,
        [Parameter(Mandatory = $true)][ValidateSet('toggle-on', 'select')]$Mode
    )

    $element = $Record.Element
    if ($Mode -eq 'toggle-on') {
        $toggleObject = $null
        if (-not $element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$toggleObject)) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'PanelToggleUnsupported' -Message 'The sidebar control does not expose TogglePattern.'
        }
        if ($toggleObject.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::Off) {
            $toggleObject.Toggle()
        }
        elseif ($toggleObject.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::Indeterminate) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'PanelToggleIndeterminate' -Message 'The sidebar TogglePattern state is indeterminate.'
        }
        return
    }

    $selectionObject = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionObject)) {
        if (-not $selectionObject.Current.IsSelected) {
            $selectionObject.Select()
        }
        return
    }

    $toggleObject = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$toggleObject)) {
        if ($toggleObject.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::Off) {
            $toggleObject.Toggle()
        }
        elseif ($toggleObject.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::Indeterminate) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'PanelSelectionIndeterminate' -Message 'The browser-panel TogglePattern state is indeterminate.'
        }
        return
    }

    $invokeObject = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokeObject)) {
        $invokeObject.Invoke()
        return
    }

    Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'PanelSelectionUnsupported' -Message 'The browser-panel control exposes no supported activation pattern.'
}

function Invoke-PanelControlPreservingFocus {
    param(
        [Parameter(Mandatory = $true)]$Record,
        [Parameter(Mandatory = $true)][ValidateSet('toggle-on', 'select')]$Mode,
        $WindowElement
    )

    $focusState = Get-LiveFocusState
    $expectedTopLevelRuntimeId = Get-AutomationRuntimeIdText -Element $WindowElement
    try {
        Invoke-PanelControl -Record $Record -Mode $Mode
    }
    finally {
        $null = Restore-FocusState -OriginalState $focusState -ExpectedAutomationTopLevelRuntimeId $expectedTopLevelRuntimeId
    }
}

function Ensure-LiveBrowserPanel {
    $window = Get-LiveCodexWindow
    $addressRecords = @(Get-LiveAddressRecords -WindowElement $window.Element)
    if ($addressRecords.Count -eq 1) {
        return $false
    }
    if ($addressRecords.Count -gt 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.DocumentSelection -Category 'AddressControlAmbiguous' -Message 'Multiple embedded-browser address controls are visible; panel recovery will not act.' -Details ([ordered]@{ candidateCount = $addressRecords.Count })
    }

    $sidebarRecords = @(Find-LiveElementsByNames -Root $window.Element -ControlTypes @([System.Windows.Automation.ControlType]::Button) -Names $Script:Names.SidebarToggle | Where-Object { $_.IsVisible -and $_.IsEnabled })
    $sidebar = Select-UniqueControlRecord -Records $sidebarRecords -Label 'SidebarToggle'
    Invoke-PanelControlPreservingFocus -Record $sidebar -Mode 'toggle-on' -WindowElement $window.Element
    Start-Sleep -Milliseconds 250

    $window = Get-LiveCodexWindow
    $addressRecords = @(Get-LiveAddressRecords -WindowElement $window.Element)
    if ($addressRecords.Count -eq 1) {
        return $true
    }

    $expandRecords = @(Find-LiveElementsByNames -Root $window.Element -ControlTypes @([System.Windows.Automation.ControlType]::Button) -Names $Script:Names.ExpandPanel | Where-Object { $_.IsVisible -and $_.IsEnabled })
    if ($expandRecords.Count -gt 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'ExpandPanelAmbiguous' -Message 'Multiple Expand panel controls are visible.' -Details ([ordered]@{ candidateCount = $expandRecords.Count })
    }
    if ($expandRecords.Count -eq 1) {
        Invoke-PanelControlPreservingFocus -Record $expandRecords[0] -Mode 'select' -WindowElement $window.Element
        Start-Sleep -Milliseconds 250
        $window = Get-LiveCodexWindow
    }

    $browserRecords = @(Find-LiveElementsByNames -Root $window.Element -ControlTypes @([System.Windows.Automation.ControlType]::Button) -Names $Script:Names.BrowserPanel | Where-Object { $_.IsVisible -and $_.IsEnabled })
    $browser = Select-UniqueControlRecord -Records $browserRecords -Label 'BrowserPanel'
    Invoke-PanelControlPreservingFocus -Record $browser -Mode 'select' -WindowElement $window.Element

    $deadline = [DateTime]::UtcNow.AddSeconds(4)
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 300
        $window = Get-LiveCodexWindow
        $addressRecords = @(Get-LiveAddressRecords -WindowElement $window.Element)
        if ($addressRecords.Count -eq 1) {
            return $true
        }
    }

    Throw-SidebarError -ExitCode $Script:ExitCodes.DocumentSelection -Category 'BrowserPanelUnavailable' -Message 'The browser side panel did not expose one address control after bounded recovery.'
}

function Resolve-LiveContext {
    param([switch]$RecoverPanel)

    $panelRecovered = $false
    $window = Get-LiveCodexWindow
    $addressRecords = @(Get-LiveAddressRecords -WindowElement $window.Element)
    $documentRecords = @(Get-LiveEmbeddedDocumentRecords -WindowElement $window.Element -AddressRecords $addressRecords)

    try {
        $document = Select-EmbeddedDocumentRecord -Records $documentRecords
    }
    catch {
        $selectionCategory = Get-ExceptionCategory -Exception $_.Exception
        if (-not $RecoverPanel -or $selectionCategory -ne 'EmbeddedDocumentMissing') {
            throw
        }

        $panelRecovered = Ensure-LiveBrowserPanel
        $window = Get-LiveCodexWindow
        $addressRecords = @(Get-LiveAddressRecords -WindowElement $window.Element)
        $documentRecords = @(Get-LiveEmbeddedDocumentRecords -WindowElement $window.Element -AddressRecords $addressRecords)
        $document = Select-EmbeddedDocumentRecord -Records $documentRecords
    }

    if ($addressRecords.Count -eq 0 -and $RecoverPanel -and -not $panelRecovered) {
        $panelRecovered = Ensure-LiveBrowserPanel
        $window = Get-LiveCodexWindow
        $addressRecords = @(Get-LiveAddressRecords -WindowElement $window.Element)
        $documentRecords = @(Get-LiveEmbeddedDocumentRecords -WindowElement $window.Element -AddressRecords $addressRecords)
        $document = Select-EmbeddedDocumentRecord -Records $documentRecords
    }

    if ($addressRecords.Count -eq 0) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.DocumentSelection -Category 'AddressControlMissing' -Message 'The embedded-browser address control is not visible after bounded panel recovery.'
    }
    if ($addressRecords.Count -gt 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.DocumentSelection -Category 'AddressControlAmbiguous' -Message 'Multiple visible embedded-browser address controls were found; no control will be used.' -Details ([ordered]@{ candidateCount = $addressRecords.Count })
    }

    return [pscustomobject]@{
        Window = $window
        Address = $addressRecords[0]
        Document = $document
        PanelRecovered = $panelRecovered
    }
}

function Test-LiveProIndicatorRecord {
    param(
        [Parameter(Mandatory = $true)]$Record,
        $ComposerAnchor,
        $DocumentRectangle
    )

    if (-not $Record.IsVisible) { return $false }
    if ($Record.Width -gt 180 -or $Record.Height -gt 80) { return $false }

    if ($Record.ControlType -eq 'ControlType.Button' -and $null -ne $ComposerAnchor) {
        $padding = 40
        $recordRight = [double]$Record.X + [double]$Record.Width
        $recordBottom = [double]$Record.Y + [double]$Record.Height
        $composerRight = [double]$ComposerAnchor.X + [double]$ComposerAnchor.Width
        $composerBottom = [double]$ComposerAnchor.Y + [double]$ComposerAnchor.Height

        return (
            $recordRight -ge ([double]$ComposerAnchor.X - $padding) -and
            [double]$Record.X -le ($composerRight + $padding) -and
            $recordBottom -ge ([double]$ComposerAnchor.Y - $padding) -and
            [double]$Record.Y -le ($composerBottom + $padding)
        )
    }

    if ($null -eq $DocumentRectangle) { return $false }
    $topLimit = $DocumentRectangle.Y + [Math]::Min(240, [Math]::Max(100, $DocumentRectangle.Height * 0.30))
    return $Record.Y -le $topLimit
}

function Get-LiveAuthSnapshot {
    param([Parameter(Mandatory = $true)]$Context)

    $documentElement = $Context.Document.Element
    $composerRecords = @(Find-LiveElementsByNames -Root $documentElement -ControlTypes @([System.Windows.Automation.ControlType]::Edit) -Names $Script:Names.Composer | Where-Object { $_.IsVisible -and $_.IsEnabled })
    $loginRecords = @(Find-LiveElementsByNames -Root $documentElement -ControlTypes @([System.Windows.Automation.ControlType]::Button, [System.Windows.Automation.ControlType]::Hyperlink) -Names $Script:Names.Login | Where-Object { $_.IsVisible })

    $documentRectangle = ConvertTo-LiveRecord -Element $documentElement
    $composerAnchor = if ($composerRecords.Count -eq 1) { $composerRecords[0] } else { $null }
    $proRecords = @(Find-LiveElementsByNames -Root $documentElement -ControlTypes @([System.Windows.Automation.ControlType]::Text, [System.Windows.Automation.ControlType]::Button, [System.Windows.Automation.ControlType]::Group) -Names $Script:Names.Pro | Where-Object {
        Test-LiveProIndicatorRecord -Record $_ -ComposerAnchor $composerAnchor -DocumentRectangle $documentRectangle
    })

    $interactiveTypes = @(
        [System.Windows.Automation.ControlType]::Button,
        [System.Windows.Automation.ControlType]::Edit,
        [System.Windows.Automation.ControlType]::Hyperlink,
        [System.Windows.Automation.ControlType]::CheckBox,
        [System.Windows.Automation.ControlType]::ComboBox
    )
    $interactive = @(Find-LiveElementsByControlTypes -Root $documentElement -ControlTypes $interactiveTypes | Where-Object { $_.IsVisible })
    if ($interactive.Count -gt 2000) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.AuthBarrier -Category 'InteractiveTreeTooLarge' -Message 'The visible interactive control set exceeds the bounded safety limit.' -Details ([ordered]@{ visibleInteractiveControlCount = $interactive.Count })
    }

    $challengeCount = 0
    foreach ($record in $interactive) {
        if (Test-SecurityAccessibleName -Name ([string]$record.Name)) {
            $challengeCount++
        }
    }

    # Challenge pages sometimes expose the barrier only as text. Scan text names
    # only when the composer and all response anchors are absent. This avoids
    # treating ordinary discussion of CAPTCHA/MFA as an authentication barrier
    # during a transient composer rerender.
    if ($composerRecords.Count -eq 0) {
        $assistantTurns = @(Get-LiveAssistantTurnRecords -DocumentElement $documentElement)
        if ($assistantTurns.Count -eq 0) {
            $challengeText = @(Find-LiveElementsByControlTypes -Root $documentElement -ControlTypes @([System.Windows.Automation.ControlType]::Text) | Where-Object { $_.IsVisible })
            if ($challengeText.Count -gt 2000) {
                Throw-SidebarError -ExitCode $Script:ExitCodes.AuthBarrier -Category 'ChallengeTextTreeTooLarge' -Message 'The visible challenge-text set exceeds the bounded safety limit.' -Details ([ordered]@{ visibleTextControlCount = $challengeText.Count })
            }
            foreach ($record in $challengeText) {
                if (Test-SecurityAccessibleName -Name ([string]$record.Name)) {
                    $challengeCount++
                }
            }
        }
    }

    return [pscustomobject]@{
        ComposerCount = $composerRecords.Count
        ComposerRecords = $composerRecords
        LoginCount = $loginRecords.Count
        ProCount = $proRecords.Count
        SecurityChallengeCount = $challengeCount
    }
}

function Get-LiveGenerationState {
    param([Parameter(Mandatory = $true)]$Context)

    $stopRecords = @(Find-LiveElementsByNames -Root $Context.Document.Element -ControlTypes @([System.Windows.Automation.ControlType]::Button) -Names $Script:Names.Stop | Where-Object { $_.IsVisible -and $_.IsEnabled })
    return [pscustomobject]@{
        Generating = $stopRecords.Count -gt 0
        StopControlCount = $stopRecords.Count
    }
}

function Read-LiveElementText {
    param([Parameter(Mandatory = $true)]$Element)

    $valueObject = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valueObject)) {
        return [string]$valueObject.Current.Value
    }

    $legacyObject = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacyObject)) {
        return [string]$legacyObject.Current.Value
    }

    $textObject = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textObject)) {
        return [string]$textObject.DocumentRange.GetText(-1)
    }

    return ''
}

function Get-LiveUrlState {
    param([Parameter(Mandatory = $true)]$Context)

    $focusState = Get-LiveFocusState
    $expectedTopLevelRuntimeId = Get-AutomationRuntimeIdText -Element $Context.Window.Element
    $candidates = @()
    $candidates += Read-LiveElementText -Element $Context.Address.Element
    $resolved = Resolve-SanitizedUrlFromCandidates -Candidates $candidates
    if ($null -ne $resolved -and $resolved.Exact) {
        return $resolved
    }

    try {
        $Context.Address.Element.SetFocus()
        Start-Sleep -Milliseconds 120
        $freshContext = Resolve-LiveContext -RecoverPanel:(-not $NoPanelRecovery)
        $candidates += Read-LiveElementText -Element $freshContext.Address.Element
        $resolved = Resolve-SanitizedUrlFromCandidates -Candidates $candidates
        if ($null -ne $resolved -and $resolved.Exact) {
            return $resolved
        }

        $freshContext = Resolve-LiveContext -RecoverPanel:(-not $NoPanelRecovery)
        $freshContext.Address.Element.SetFocus()
        Start-Sleep -Milliseconds 80
        if (Invoke-LiveAddressTextSelection -AddressElement $freshContext.Address.Element) {
            Start-Sleep -Milliseconds 80
            $freshContext = Resolve-LiveContext -RecoverPanel:(-not $NoPanelRecovery)
            $candidates += Read-LiveElementText -Element $freshContext.Address.Element
        }
    }
    finally {
        $null = Restore-FocusState -OriginalState $focusState -ExpectedAutomationTopLevelRuntimeId $expectedTopLevelRuntimeId
    }

    $resolved = Resolve-SanitizedUrlFromCandidates -Candidates $candidates
    if ($null -eq $resolved) {
        return [pscustomobject]@{ Url = $null; Exact = $false }
    }
    return $resolved
}

function Assert-LiveInvokePatternAvailable {
    param(
        [Parameter(Mandatory = $true)]$Record,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $invokeObject = $null
    if (-not $Record.Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokeObject)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category ($Label + 'InvokeUnsupported') -Message ($Label + ' does not expose InvokePattern.')
    }
}

function Invoke-LiveInvokePatternOnce {
    param(
        [Parameter(Mandatory = $true)]$Record,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $invokeObject = $null
    if (-not $Record.Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokeObject)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category ($Label + 'InvokeUnsupported') -Message ($Label + ' does not expose InvokePattern.')
    }
    $invokeObject.Invoke()
}

function Set-LiveComposerValue {
    param(
        [Parameter(Mandatory = $true)]$ComposerRecord,
        [Parameter(Mandatory = $true)][string]$Value
    )

    $valueObject = $null
    if (-not $ComposerRecord.Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valueObject)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'ComposerValueUnsupported' -Message 'The ChatGPT composer does not expose ValuePattern.'
    }
    if ($valueObject.Current.IsReadOnly) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'ComposerReadOnly' -Message 'The ChatGPT composer is read-only.'
    }
    $valueObject.SetValue($Value)
}

function Test-CodexDesktopThreadId {
    param([AllowEmptyString()][string]$Value)

    return $Value -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
}

function Normalize-LiveDesktopComposerValue {
    param([AllowEmptyString()][Parameter(Mandatory = $true)][string]$Value)

    return (Normalize-TextForHash -Text $Value).Trim()
}

function Test-LiveDesktopComposerRecord {
    param(
        [Parameter(Mandatory = $true)]$Record,
        $WindowRectangle = $null,
        [double]$BrowserLeft = [double]::NaN
    )

    if (-not [bool](Get-ObjectProperty $Record 'IsVisible' $false) -or
        -not [bool](Get-ObjectProperty $Record 'IsEnabled' $false)) {
        return $false
    }
    if ([string](Get-ObjectProperty $Record 'ControlType' '') -ne 'ControlType.Edit' -or
        [string](Get-ObjectProperty $Record 'ClassName' '') -ne 'ProseMirror') {
        return $false
    }
    if ([string](Get-ObjectProperty $Record 'AutomationId' '') -eq 'prompt-textarea') {
        return $false
    }

    $x = [double](Get-ObjectProperty $Record 'X' 0)
    $y = [double](Get-ObjectProperty $Record 'Y' 0)
    $width = [double](Get-ObjectProperty $Record 'Width' 0)
    $height = [double](Get-ObjectProperty $Record 'Height' 0)
    if ($width -lt 180 -or $width -gt 2600 -or $height -lt 20 -or $height -gt 420) {
        return $false
    }
    if (-not [double]::IsNaN($BrowserLeft) -and $x -ge ($BrowserLeft - 12)) {
        return $false
    }

    if ($null -ne $WindowRectangle) {
        $windowX = [double](Get-ObjectProperty $WindowRectangle 'X' 0)
        $windowY = [double](Get-ObjectProperty $WindowRectangle 'Y' 0)
        $windowWidth = [double](Get-ObjectProperty $WindowRectangle 'Width' 0)
        $windowHeight = [double](Get-ObjectProperty $WindowRectangle 'Height' 0)
        if ($windowWidth -le 0 -or $windowHeight -le 0) {
            return $false
        }
        if ($x -lt ($windowX - 4) -or
            ($x + $width) -gt ($windowX + $windowWidth + 4) -or
            $y -lt ($windowY + ($windowHeight * 0.45)) -or
            ($y + $height) -gt ($windowY + $windowHeight + 4)) {
            return $false
        }
    }

    return $true
}

function Test-LiveDesktopButtonGeometry {
    param(
        [Parameter(Mandatory = $true)]$Record,
        [Parameter(Mandatory = $true)]$ComposerRecord
    )

    if (-not [bool](Get-ObjectProperty $Record 'IsVisible' $false) -or
        -not [bool](Get-ObjectProperty $Record 'IsEnabled' $false) -or
        [string](Get-ObjectProperty $Record 'ControlType' '') -ne 'ControlType.Button') {
        return $false
    }
    if ([string](Get-ObjectProperty $Record 'ClassName' '') -notmatch '(^|\s)size-token-button-composer(\s|$)') {
        return $false
    }

    $x = [double](Get-ObjectProperty $Record 'X' 0)
    $y = [double](Get-ObjectProperty $Record 'Y' 0)
    $width = [double](Get-ObjectProperty $Record 'Width' 0)
    $height = [double](Get-ObjectProperty $Record 'Height' 0)
    $composerX = [double](Get-ObjectProperty $ComposerRecord 'X' 0)
    $composerY = [double](Get-ObjectProperty $ComposerRecord 'Y' 0)
    $composerWidth = [double](Get-ObjectProperty $ComposerRecord 'Width' 0)
    $composerHeight = [double](Get-ObjectProperty $ComposerRecord 'Height' 0)
    $centerX = $x + ($width / 2)
    $centerY = $y + ($height / 2)

    return (
        $width -ge 16 -and $width -le 80 -and
        $height -ge 16 -and $height -le 80 -and
        $centerX -ge ($composerX + ($composerWidth * 0.60)) -and
        $centerX -le ($composerX + $composerWidth + 28) -and
        $centerY -ge ($composerY - 30) -and
        $centerY -le ($composerY + $composerHeight + 80)
    )
}

function Test-LiveDesktopStopRecord {
    param(
        [Parameter(Mandatory = $true)]$Record,
        [Parameter(Mandatory = $true)]$ComposerRecord
    )

    if (-not (Test-LiveDesktopButtonGeometry -Record $Record -ComposerRecord $ComposerRecord)) {
        return $false
    }
    return $Script:Names.DesktopStop -contains [string](Get-ObjectProperty $Record 'Name' '')
}

function Test-LiveDesktopSubmitRecord {
    param(
        [Parameter(Mandatory = $true)]$Record,
        [Parameter(Mandatory = $true)]$ComposerRecord
    )

    if (-not (Test-LiveDesktopButtonGeometry -Record $Record -ComposerRecord $ComposerRecord)) {
        return $false
    }
    return $Script:Names.DesktopStop -notcontains [string](Get-ObjectProperty $Record 'Name' '')
}

function Get-LiveDesktopComposerRecords {
    param([Parameter(Mandatory = $true)]$WindowRecord)

    $windowRectangle = ConvertTo-LiveRecord -Element $WindowRecord.Element
    if ($null -eq $windowRectangle) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'CodexWindowUnavailable' -Message 'The selected Codex Desktop window is no longer available.'
    }

    $edits = @(Find-LiveElementsByControlTypes -Root $WindowRecord.Element -ControlTypes @([System.Windows.Automation.ControlType]::Edit))
    $browserComposerRecords = @($edits | Where-Object {
        $_.IsVisible -and [string](Get-ObjectProperty $_ 'AutomationId' '') -eq 'prompt-textarea'
    })
    $browserLeft = [double]::NaN
    if ($browserComposerRecords.Count -gt 0) {
        $browserLeft = [double](($browserComposerRecords | Measure-Object -Property X -Minimum).Minimum)
    }

    return @($edits | Where-Object {
        Test-LiveDesktopComposerRecord -Record $_ -WindowRectangle $windowRectangle -BrowserLeft $browserLeft
    })
}

function Get-LiveDesktopButtonRecords {
    param(
        [Parameter(Mandatory = $true)]$WindowRecord,
        [Parameter(Mandatory = $true)]$ComposerRecord
    )

    $buttons = @(Find-LiveElementsByControlTypes -Root $WindowRecord.Element -ControlTypes @([System.Windows.Automation.ControlType]::Button))
    return [pscustomobject]@{
        StopRecords = @($buttons | Where-Object {
            Test-LiveDesktopStopRecord -Record $_ -ComposerRecord $ComposerRecord
        })
        SubmitRecords = @($buttons | Where-Object {
            Test-LiveDesktopSubmitRecord -Record $_ -ComposerRecord $ComposerRecord
        })
    }
}

function Invoke-LiveDesktopWake {
    param(
        [Parameter(Mandatory = $true)][string]$PromptText,
        [Parameter(Mandatory = $true)][string]$ThreadId,
        [Parameter(Mandatory = $true)][int]$TimeoutSecondsValue
    )

    if (-not (Test-CodexDesktopThreadId -Value $ThreadId)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'CodexThreadIdInvalid' -Message 'CodexThreadId must be one exact UUID.'
    }

    $deepLink = 'codex://threads/' + $ThreadId.ToLowerInvariant()
    try {
        $null = Start-Process -FilePath $deepLink
    }
    catch {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'CodexDesktopDeepLinkFailed' -Message 'Codex Desktop could not open the exact task deep link.'
    }

    $deadline = [datetime]::UtcNow.AddSeconds($TimeoutSecondsValue)
    $composerRecord = $null
    while ([datetime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 250
        $window = Get-LiveCodexWindow
        $composerRecords = @(Get-LiveDesktopComposerRecords -WindowRecord $window)
        if ($composerRecords.Count -gt 1) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'DesktopComposerAmbiguous' -Message 'Multiple eligible Codex Desktop composers are visible; the wake prompt was not written.'
        }
        if ($composerRecords.Count -ne 1) {
            continue
        }

        $buttons = Get-LiveDesktopButtonRecords -WindowRecord $window -ComposerRecord $composerRecords[0]
        if ($buttons.StopRecords.Count -gt 0) {
            continue
        }

        $currentText = Normalize-LiveDesktopComposerValue -Value (Read-LiveElementText -Element $composerRecords[0].Element)
        if (-not (Test-ComposerValueEmpty -Value $currentText)) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'DesktopComposerNotEmpty' -Message 'The Codex Desktop composer already contains user text; the wake prompt was not written.'
        }
        $composerRecord = $composerRecords[0]
        break
    }
    if ($null -eq $composerRecord) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Timeout -Category 'DesktopIdleTimeout' -Message 'Codex Desktop did not expose one idle empty composer before the bounded timeout.'
    }

    $expectedText = Normalize-LiveDesktopComposerValue -Value $PromptText
    $expectedSha256 = Get-Sha256Text -Text $expectedText
    Set-LiveComposerValue -ComposerRecord $composerRecord -Value $expectedText

    $preparedWindow = $null
    $preparedComposer = $null
    $preparedSubmit = $null
    while ([datetime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 120
        $window = Get-LiveCodexWindow
        $composerRecords = @(Get-LiveDesktopComposerRecords -WindowRecord $window)
        if ($composerRecords.Count -gt 1) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'DesktopComposerAmbiguousAfterWrite' -Message 'The Codex Desktop composer became ambiguous after the wake prompt was written.'
        }
        if ($composerRecords.Count -ne 1) {
            continue
        }

        $actualText = Normalize-LiveDesktopComposerValue -Value (Read-LiveElementText -Element $composerRecords[0].Element)
        if ((Get-Sha256Text -Text $actualText) -ne $expectedSha256) {
            if (-not (Test-ComposerValueEmpty -Value $actualText)) {
                Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'DesktopComposerChangedAfterWrite' -Message 'The Codex Desktop composer changed after the wake prompt was written; no submit action was attempted.'
            }
            continue
        }

        $buttons = Get-LiveDesktopButtonRecords -WindowRecord $window -ComposerRecord $composerRecords[0]
        if ($buttons.StopRecords.Count -gt 0) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.GenerationActive -Category 'DesktopGenerationStartedBeforeSubmit' -Message 'Codex Desktop started another generation before the wake prompt could be submitted.'
        }
        if ($buttons.SubmitRecords.Count -gt 1) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'DesktopSubmitAmbiguous' -Message 'Multiple eligible Codex Desktop submit controls are visible; no submit action was attempted.'
        }
        if ($buttons.SubmitRecords.Count -ne 1) {
            continue
        }

        $preparedWindow = $window
        $preparedComposer = $composerRecords[0]
        $preparedSubmit = $buttons.SubmitRecords[0]
        break
    }
    if ($null -eq $preparedSubmit) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Timeout -Category 'DesktopSubmitUnavailable' -Message 'Codex Desktop did not expose one eligible submit control before the bounded timeout.'
    }

    $finalText = Normalize-LiveDesktopComposerValue -Value (Read-LiveElementText -Element $preparedComposer.Element)
    if ((Get-Sha256Text -Text $finalText) -ne $expectedSha256) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'DesktopComposerChangedBeforeInvoke' -Message 'The Codex Desktop composer changed before submission; no submit action was attempted.'
    }

    Invoke-LiveInvokePatternOnce -Record $preparedSubmit -Label 'DesktopSubmit'

    $acknowledged = $false
    $ackDeadline = [datetime]::UtcNow.AddSeconds(10)
    if ($ackDeadline -gt $deadline) {
        $ackDeadline = $deadline
    }
    while ([datetime]::UtcNow -lt $ackDeadline) {
        Start-Sleep -Milliseconds 150
        $window = Get-LiveCodexWindow
        $buttons = Get-LiveDesktopButtonRecords -WindowRecord $window -ComposerRecord $preparedComposer
        if ($buttons.StopRecords.Count -gt 0) {
            $acknowledged = $true
            break
        }

        $composerRecords = @(Get-LiveDesktopComposerRecords -WindowRecord $window)
        if ($composerRecords.Count -eq 1) {
            $currentText = Normalize-LiveDesktopComposerValue -Value (Read-LiveElementText -Element $composerRecords[0].Element)
            if (Test-ComposerValueEmpty -Value $currentText) {
                $acknowledged = $true
                break
            }
        }
    }
    if (-not $acknowledged) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'DesktopWakeAcknowledgementUncertain' -Message 'The Codex Desktop submit action was invoked once, but acknowledgement was not observed. The action will not be retried.'
    }

    return [ordered]@{
        ok = $true
        command = 'desktop-wake'
        live = $true
        transport = 'windows-uia'
        codexThreadId = $ThreadId.ToLowerInvariant()
        desktopThreadWakeInvokedOnce = $true
        clipboardUsed = $false
    }
}

function Get-LivePreparedSend {
    param(
        [Parameter(Mandatory = $true)][string]$ExpectedPromptSha256,
        [switch]$RecoverPanel,
        [int]$TimeoutSecondsValue = 3
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSecondsValue)
    $lastComposerCount = 0
    $lastSendCount = 0

    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $context = Resolve-LiveContext -RecoverPanel:$RecoverPanel
            $auth = Get-LiveAuthSnapshot -Context $context
            Assert-AuthReadySnapshot -Snapshot $auth
            $generation = Get-LiveGenerationState -Context $context
            if ($generation.Generating) {
                Throw-SidebarError -ExitCode $Script:ExitCodes.GenerationActive -Category 'GenerationAlreadyActive' -Message 'ChatGPT began generating before this send could be committed.'
            }

            $composer = Select-UniqueControlRecord -Records $auth.ComposerRecords -Label 'Composer'
            $composerText = Normalize-TextForHash -Text (Read-LiveElementText -Element $composer.Element)
            $sendRecords = @(Find-LiveElementsByNames -Root $context.Document.Element -ControlTypes @([System.Windows.Automation.ControlType]::Button) -Names $Script:Names.Send | Where-Object { $_.IsVisible -and $_.IsEnabled })
            $lastComposerCount = $auth.ComposerCount
            $lastSendCount = $sendRecords.Count

            if ($sendRecords.Count -gt 1) {
                Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'ComposerOrSendAmbiguous' -Message 'Multiple eligible send controls are visible immediately before submission.' -Details ([ordered]@{ composerCount = $auth.ComposerCount; sendCount = $sendRecords.Count })
            }

            $composerSha = Get-Sha256Text -Text $composerText
            if ($sendRecords.Count -eq 1 -and $composerSha -eq $ExpectedPromptSha256) {
                $snapshot = [pscustomobject]@{
                    Generating = $false
                    ComposerCount = $auth.ComposerCount
                    SendCount = $sendRecords.Count
                    ComposerSha256 = $composerSha
                }
                Assert-SendPreconditions -Snapshot $snapshot -ExpectedPromptSha256 $ExpectedPromptSha256
                $send = Select-UniqueControlRecord -Records $sendRecords -Label 'Send'
                Assert-LiveInvokePatternAvailable -Record $send -Label 'Send'
                return [pscustomobject]@{
                    Context = $context
                    Composer = $composer
                    Send = $send
                    Snapshot = $snapshot
                }
            }
        }
        catch [System.Windows.Automation.ElementNotAvailableException] {
        }
        catch {
            if (-not (Test-TransientUiCategory -Category (Get-ExceptionCategory -Exception $_.Exception))) {
                throw
            }
        }

        Start-Sleep -Milliseconds 150
    }

    Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'ComposerOrSendNotReady' -Message 'The exact composer value and one enabled send control did not become stable within the bounded pre-send window.' -Details ([ordered]@{ composerCount = $lastComposerCount; sendCount = $lastSendCount })
}

function Test-LiveElementInsideExcludedControl {
    param(
        [Parameter(Mandatory = $true)]$Element,
        [Parameter(Mandatory = $true)][string]$TurnRuntimeId
    )

    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $current = $walker.GetParent($Element)
    for ($depth = 0; $depth -lt 24 -and $null -ne $current; $depth++) {
        $record = ConvertTo-LiveRecord -Element $current
        if ($null -eq $record -or $record.RuntimeId -eq $TurnRuntimeId) {
            return $false
        }
        if (@('ControlType.Button', 'ControlType.Edit', 'ControlType.MenuItem') -contains $record.ControlType) {
            return $true
        }
        $current = $walker.GetParent($current)
    }
    return $true
}

function Test-LiveElementHasNamedSemanticDescendant {
    param([Parameter(Mandatory = $true)]$Element)

    $semanticTypes = @(
        [System.Windows.Automation.ControlType]::Text,
        [System.Windows.Automation.ControlType]::ListItem,
        [System.Windows.Automation.ControlType]::DataItem,
        [System.Windows.Automation.ControlType]::Header,
        [System.Windows.Automation.ControlType]::Hyperlink
    )
    $descendants = @(Find-LiveElementsByControlTypes -Root $Element -ControlTypes $semanticTypes)
    foreach ($descendant in $descendants) {
        if (-not [string]::IsNullOrWhiteSpace([string]$descendant.Name)) {
            return $true
        }
    }
    return $false
}

function Get-LiveAssistantTurnRecords {
    param([Parameter(Mandatory = $true)]$DocumentElement)

    $containers = @(Find-LiveElementsByControlTypes -Root $DocumentElement -ControlTypes @(
        [System.Windows.Automation.ControlType]::Group,
        [System.Windows.Automation.ControlType]::Pane,
        [System.Windows.Automation.ControlType]::Custom
    ))
    if ($containers.Count -gt 10000) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'ResponseContainerLimitExceeded' -Message 'The document exceeds the bounded container-element limit.' -Details ([ordered]@{ containerElementCount = $containers.Count })
    }

    $turns = @($containers | Where-Object { Test-ClassNameToken -ClassName ([string]$_.ClassName) -Token 'agent-turn' })
    if ($turns.Count -eq 0) {
        $messageGroups = @($containers | Where-Object {
            $_.ControlType -eq 'ControlType.Group' -and
            (Test-ClassNameToken -ClassName ([string]$_.ClassName) -Token 'text-message')
        })
        foreach ($messageGroup in $messageGroups) {
            $userActions = @(Find-LiveElementsByNames -Root $messageGroup.Element -ControlTypes @([System.Windows.Automation.ControlType]::Button) -Names $Script:Names.CopyMessage)
            $composers = @(Find-LiveElementsByNames -Root $messageGroup.Element -ControlTypes @([System.Windows.Automation.ControlType]::Edit) -Names $Script:Names.Composer)
            if ($userActions.Count -eq 0 -and $composers.Count -eq 0) {
                $turns += $messageGroup
            }
        }
    }
    if ($turns.Count -gt 200) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'ResponseTurnLimitExceeded' -Message 'The assistant-turn count exceeds the bounded safety limit.' -Details ([ordered]@{ assistantTurnCount = $turns.Count })
    }
    return $turns
}

function Get-LiveAssistantResponseContent {
    param([Parameter(Mandatory = $true)]$TurnRecord)

    $semanticTypes = @(
        [System.Windows.Automation.ControlType]::Text,
        [System.Windows.Automation.ControlType]::ListItem,
        [System.Windows.Automation.ControlType]::DataItem,
        [System.Windows.Automation.ControlType]::Header,
        [System.Windows.Automation.ControlType]::Hyperlink
    )
    $semanticRecords = @(Find-LiveElementsByControlTypes -Root $TurnRecord.Element -ControlTypes $semanticTypes)
    if ($semanticRecords.Count -gt 5000) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'ResponseSemanticLimitExceeded' -Message 'A candidate assistant turn exceeds the bounded semantic-element limit.' -Details ([ordered]@{ semanticElementCount = $semanticRecords.Count })
    }

    $captured = [System.Collections.Generic.List[object]]::new()
    $counts = [ordered]@{
        text = 0
        listItem = 0
        dataItem = 0
        header = 0
        hyperlink = 0
    }
    foreach ($record in $semanticRecords) {
        if ([string]::IsNullOrWhiteSpace([string]$record.Name)) {
            continue
        }
        if (Test-LiveElementInsideExcludedControl -Element $record.Element -TurnRuntimeId $TurnRecord.RuntimeId) {
            continue
        }
        if ($record.ControlType -ne 'ControlType.Text' -and (Test-LiveElementHasNamedSemanticDescendant -Element $record.Element)) {
            continue
        }

        $null = $captured.Add($record)
        switch ($record.ControlType) {
            'ControlType.Text' { $counts.text++ }
            'ControlType.ListItem' { $counts.listItem++ }
            'ControlType.DataItem' { $counts.dataItem++ }
            'ControlType.Header' { $counts.header++ }
            'ControlType.Hyperlink' { $counts.hyperlink++ }
        }
    }

    $content = Join-ResponseTextRecords -Records $captured.ToArray() -CopyAnchorY 0 -PreserveInputOrder
    if ([string]::IsNullOrWhiteSpace($content)) {
        return $null
    }
    return [pscustomobject]@{
        Content = $content
        ContentSha256 = Get-Sha256Text -Text $content
        TurnRuntimeId = $TurnRecord.RuntimeId
        ControlTypeCounts = $counts
        ExtractorVersion = $Script:ExtractorVersion
    }
}

function Get-LiveResponseRecords {
    param([Parameter(Mandatory = $true)]$Context)

    $turnRecords = @(Get-LiveAssistantTurnRecords -DocumentElement $Context.Document.Element)
    $responses = @()
    $ordinal = 0
    foreach ($turnRecord in $turnRecords) {
        $response = Get-LiveAssistantResponseContent -TurnRecord $turnRecord
        if ($null -eq $response) {
            continue
        }
        $responses += [pscustomobject]@{
            Ordinal = $ordinal
            Content = $response.Content
            ContentSha256 = $response.ContentSha256
            TurnRuntimeId = $response.TurnRuntimeId
            ContainerRuntimeId = $response.TurnRuntimeId
            ControlTypeCounts = $response.ControlTypeCounts
            ExtractorVersion = $response.ExtractorVersion
        }
        $ordinal++
    }
    return $responses
}

function Get-LiveStatusSnapshot {
    param([switch]$RecoverPanel)

    $context = Resolve-LiveContext -RecoverPanel:$RecoverPanel
    $auth = Get-LiveAuthSnapshot -Context $context
    $generation = Get-LiveGenerationState -Context $context
    $url = Get-LiveUrlState -Context $context

    return [pscustomobject]@{
        Context = $context
        CodexWindowCount = 1
        WindowRuntimeId = [string]$context.Window.RuntimeId
        EmbeddedDocumentCount = 1
        AddressCount = 1
        ComposerCount = $auth.ComposerCount
        LoginCount = $auth.LoginCount
        ProCount = $auth.ProCount
        SecurityChallengeCount = $auth.SecurityChallengeCount
        Generating = $generation.Generating
        PanelRecovered = $context.PanelRecovered
        Url = $url.Url
        UrlExact = $url.Exact
    }
}

function Invoke-LiveNewChat {
    param([switch]$RecoverPanel)

    $context = Resolve-LiveContext -RecoverPanel:$RecoverPanel
    $auth = Get-LiveAuthSnapshot -Context $context
    Assert-AuthReadySnapshot -Snapshot $auth
    $initialUrlState = Get-LiveUrlState -Context $context
    Assert-ChatGptUrlState -UrlState $initialUrlState
    $generation = Get-LiveGenerationState -Context $context
    if ($generation.Generating) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.GenerationActive -Category 'GenerationAlreadyActive' -Message 'Cannot start a new chat while ChatGPT is generating.'
    }

    $newChatRecords = @(Find-LiveElementsByNames -Root $context.Document.Element -ControlTypes @([System.Windows.Automation.ControlType]::Button, [System.Windows.Automation.ControlType]::Hyperlink) -Names $Script:Names.NewChat)
    $newChat = Select-NewChatRecord -Records $newChatRecords
    Assert-LiveInvokePatternAvailable -Record $newChat -Label 'NewChat'
    $focusState = Get-LiveFocusState
    $expectedTopLevelRuntimeId = Get-AutomationRuntimeIdText -Element $context.Window.Element
    try {
        Invoke-LiveInvokePatternOnce -Record $newChat -Label 'NewChat'
    }
    catch {
        Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'NewChatUncertain' -Message 'The New chat action had an uncertain result and was not retried.'
    }
    finally {
        $null = Restore-FocusState -OriginalState $focusState -ExpectedAutomationTopLevelRuntimeId $expectedTopLevelRuntimeId
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(6)
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 300
        try {
            $freshContext = Resolve-LiveContext -RecoverPanel:$RecoverPanel
            $freshAuth = Get-LiveAuthSnapshot -Context $freshContext
            Assert-AuthReadySnapshot -Snapshot $freshAuth
            $responses = @(Get-LiveResponseRecords -Context $freshContext)
            $composer = Select-UniqueControlRecord -Records $freshAuth.ComposerRecords -Label 'Composer'
            $composerValue = Read-LiveElementText -Element $composer.Element
            if ($responses.Count -eq 0 -and (Test-ComposerValueEmpty -Value $composerValue)) {
                $freshUrlState = Get-LiveUrlState -Context $freshContext
                Assert-ChatGptUrlState -UrlState $freshUrlState -RequireFreshConversation
                return [ordered]@{
                    ok = $true
                    command = 'new-chat'
                    live = $true
                    conversationReset = $true
                    url = $freshUrlState.Url
                    urlExact = $freshUrlState.Exact
                    clipboardUsed = $false
                }
            }
        }
        catch {
            if (Test-TransientUiCategory -Category (Get-ExceptionCategory -Exception $_.Exception)) {
                continue
            }
            throw
        }
    }

    Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'NewChatUncertain' -Message 'The UI did not prove an empty new conversation after one New chat action.'
}

function New-SendIntentState {
    param(
        [Parameter(Mandatory = $true)][string]$PromptSha256,
        [Parameter(Mandatory = $true)][string]$IdempotencyKeyValue,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$BaselineHashes,
        [AllowEmptyString()][string]$ConversationUrlBeforeSend = '',
        [AllowEmptyString()][string]$IdempotencyKeySha256 = '',
        [AllowEmptyString()][string]$GlobalReservationAtUtc = '',
        [AllowEmptyString()][string]$WindowRuntimeIdValue = ''
    )

    $intentAtUtc = [DateTime]::UtcNow.ToString('o')
    $conversationUrlBoundAtUtc = ''
    if (-not [string]::IsNullOrWhiteSpace($ConversationUrlBeforeSend)) {
        $conversationUrlBoundAtUtc = $intentAtUtc
    }

    return [ordered]@{
        schemaVersion = $Script:SchemaVersion
        tool = $Script:ToolName
        transport = 'windows-uia'
        live = $true
        phase = 'send-intent'
        idempotencyKey = $IdempotencyKeyValue
        idempotencyKeySha256 = $IdempotencyKeySha256
        globalReservationAtUtc = $GlobalReservationAtUtc
        promptFile = 'prompt.md'
        promptSha256 = $PromptSha256
        baselineResponseSha256 = @($BaselineHashes)
        windowRuntimeId = $WindowRuntimeIdValue
        extractorVersion = $Script:ExtractorVersion
        conversationUrlBeforeSend = $ConversationUrlBeforeSend
        conversationUrlBound = $ConversationUrlBeforeSend
        conversationUrlBoundAtUtc = $conversationUrlBoundAtUtc
        intentAtUtc = $intentAtUtc
        automaticResendAllowed = $false
        clipboardUsed = $false
    }
}

function Try-BindLiveConversationUrl {
    param(
        [Parameter(Mandatory = $true)]$State,
        [switch]$RecoverPanel,
        [int]$TimeoutSecondsValue = 3
    )

    $existing = [string](Get-ObjectProperty $State 'conversationUrlBound' '')
    $existingCanonical = ConvertTo-SanitizedChatGptUrl -Candidate $existing
    if ($null -ne $existingCanonical -and $existingCanonical.Exact -and $existingCanonical.Url -eq $existing) {
        return $existing
    }

    $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(1, $TimeoutSecondsValue))
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $context = Resolve-LiveContext -RecoverPanel:$RecoverPanel
            $auth = Get-LiveAuthSnapshot -Context $context
            Assert-AuthReadySnapshot -Snapshot $auth
            $urlState = Get-LiveUrlState -Context $context
            if ($urlState.Exact) {
                $bound = [string]$urlState.Url
                Set-ObjectProperty -InputObject $State -Name 'conversationUrlBound' -Value $bound
                Set-ObjectProperty -InputObject $State -Name 'conversationUrlBoundAtUtc' -Value ([DateTime]::UtcNow.ToString('o'))
                return $bound
            }
        }
        catch {
            if (-not (Test-TransientUiCategory -Category (Get-ExceptionCategory -Exception $_.Exception))) {
                return ''
            }
        }
        Start-Sleep -Milliseconds 300
    }
    return ''
}

function Set-SendUncertainState {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)]$State,
        [Parameter(Mandatory = $true)][string]$Reason,
        [bool]$InvokeReturned = $false
    )

    Set-ObjectProperty -InputObject $State -Name 'phase' -Value 'send-uncertain'
    Set-ObjectProperty -InputObject $State -Name 'uncertainReason' -Value $Reason
    Set-ObjectProperty -InputObject $State -Name 'invokeAttempted' -Value $true
    Set-ObjectProperty -InputObject $State -Name 'invokeReturned' -Value $InvokeReturned
    Set-ObjectProperty -InputObject $State -Name 'uncertainAtUtc' -Value ([DateTime]::UtcNow.ToString('o'))
    Write-EvidenceState -Directory $EvidenceDirectory -State $State
}

function Invoke-LiveSend {
    param(
        [Parameter(Mandatory = $true)][string]$PromptText,
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$IdempotencyKeyValue,
        [switch]$RequireFreshConversation,
        [switch]$RequireExistingConversation,
        [switch]$RecoverPanel
    )

    $existingState = Read-EvidenceState -Directory $EvidenceDirectory
    Assert-IdempotencyAvailable -ExistingState $existingState -IdempotencyKey $IdempotencyKeyValue
    Assert-EvidenceDirectoryPristine -Directory $EvidenceDirectory
    $null = Assert-GlobalIdempotencyKeyAvailable -IdempotencyKeyValue $IdempotencyKeyValue

    $context = Resolve-LiveContext -RecoverPanel:$RecoverPanel
    $auth = Get-LiveAuthSnapshot -Context $context
    Assert-AuthReadySnapshot -Snapshot $auth
    $generation = Get-LiveGenerationState -Context $context
    if ($generation.Generating) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.GenerationActive -Category 'GenerationAlreadyActive' -Message 'ChatGPT is already generating; duplicate submission is prohibited.'
    }

    $preSendUrlState = Get-LiveUrlState -Context $context
    Assert-ChatGptUrlState -UrlState $preSendUrlState -RequireFreshConversation:$RequireFreshConversation -RequireExistingConversation:$RequireExistingConversation
    $conversationUrlBeforeSend = ''
    if ($null -ne $preSendUrlState -and $preSendUrlState.Exact) {
        $conversationUrlBeforeSend = [string]$preSendUrlState.Url
    }

    $context = Resolve-LiveContext -RecoverPanel:$RecoverPanel
    $auth = Get-LiveAuthSnapshot -Context $context
    Assert-AuthReadySnapshot -Snapshot $auth
    $generation = Get-LiveGenerationState -Context $context
    if ($generation.Generating) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.GenerationActive -Category 'GenerationAlreadyActive' -Message 'ChatGPT is already generating; duplicate submission is prohibited.'
    }

    $baselineResponses = @(Get-LiveResponseRecords -Context $context)
    $baselineHashes = @($baselineResponses | ForEach-Object { $_.ContentSha256 })
    $promptSha = Get-Sha256Text -Text $PromptText
    $globalReservation = Reserve-GlobalIdempotencyKey -IdempotencyKeyValue $IdempotencyKeyValue -PromptSha256 $promptSha

    $composer = Select-UniqueControlRecord -Records $auth.ComposerRecords -Label 'Composer'
    Set-LiveComposerValue -ComposerRecord $composer -Value $PromptText
    $prepared = Get-LivePreparedSend -ExpectedPromptSha256 $promptSha -RecoverPanel:$RecoverPanel
    $verifiedUrlState = Get-LiveUrlState -Context $prepared.Context
    Assert-PreSendUrlInvariant -InitialUrlState $preSendUrlState -CurrentUrlState $verifiedUrlState -RequireFreshConversation:$RequireFreshConversation -RequireExistingConversation:$RequireExistingConversation

    Write-Utf8NoBomAtomic -Path (Join-Path $EvidenceDirectory 'prompt.md') -Text $PromptText
    $state = New-SendIntentState -PromptSha256 $promptSha -IdempotencyKeyValue $IdempotencyKeyValue -BaselineHashes $baselineHashes -ConversationUrlBeforeSend $conversationUrlBeforeSend -IdempotencyKeySha256 $globalReservation.KeySha256 -GlobalReservationAtUtc $globalReservation.ReservedAtUtc -WindowRuntimeIdValue ([string]$prepared.Context.Window.RuntimeId)
    Write-EvidenceState -Directory $EvidenceDirectory -State $state

    try {
        # Re-resolve after the durable intent write. No stale element captured
        # before filesystem I/O is allowed to perform the one send action.
        $commitPrepared = Get-LivePreparedSend -ExpectedPromptSha256 $promptSha -RecoverPanel:$RecoverPanel
        $commitUrlState = Get-LiveUrlState -Context $commitPrepared.Context
        Assert-PreSendUrlInvariant -InitialUrlState $preSendUrlState -CurrentUrlState $commitUrlState -RequireFreshConversation:$RequireFreshConversation -RequireExistingConversation:$RequireExistingConversation
        $send = $commitPrepared.Send
    }
    catch {
        Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'pre-invoke-failed'
        Set-ObjectProperty -InputObject $state -Name 'invokeAttempted' -Value $false
        Set-ObjectProperty -InputObject $state -Name 'preInvokeFailureCategory' -Value (Get-ExceptionCategory -Exception $_.Exception)
        Set-ObjectProperty -InputObject $state -Name 'preInvokeFailedAtUtc' -Value ([DateTime]::UtcNow.ToString('o'))
        Write-EvidenceState -Directory $EvidenceDirectory -State $state
        throw
    }

    $focusState = Get-LiveFocusState
    $expectedTopLevelRuntimeId = Get-AutomationRuntimeIdText -Element $commitPrepared.Context.Window.Element
    try {
        Invoke-LiveInvokePatternOnce -Record $send -Label 'Send'
    }
    catch {
        $null = Try-BindLiveConversationUrl -State $state -RecoverPanel:$RecoverPanel -TimeoutSecondsValue 3
        Set-SendUncertainState -EvidenceDirectory $EvidenceDirectory -State $state -Reason 'invoke-threw' -InvokeReturned:$false
        Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'SendUncertain' -Message 'The send InvokePattern had an uncertain result. It was not retried.' -Details ([ordered]@{ idempotencyKey = $IdempotencyKeyValue })
    }
    finally {
        $null = Restore-FocusState -OriginalState $focusState -ExpectedAutomationTopLevelRuntimeId $expectedTopLevelRuntimeId
    }

    Set-ObjectProperty -InputObject $state -Name 'invokeAttempted' -Value $true
    Set-ObjectProperty -InputObject $state -Name 'invokeReturned' -Value $true
    $acknowledged = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(6)
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 300
        try {
            $ackContext = Resolve-LiveContext -RecoverPanel:$RecoverPanel
            $ackAuth = Get-LiveAuthSnapshot -Context $ackContext
            Assert-AuthReadySnapshot -Snapshot $ackAuth
            $ackComposer = Select-UniqueControlRecord -Records $ackAuth.ComposerRecords -Label 'Composer'
            $ackValue = Read-LiveElementText -Element $ackComposer.Element
            $ackGeneration = Get-LiveGenerationState -Context $ackContext
            if ((Test-ComposerValueEmpty -Value $ackValue) -or $ackGeneration.Generating) {
                $acknowledged = $true
                break
            }
        }
        catch {
            if (Test-TransientUiCategory -Category (Get-ExceptionCategory -Exception $_.Exception)) {
                continue
            }
            $null = Try-BindLiveConversationUrl -State $state -RecoverPanel:$RecoverPanel -TimeoutSecondsValue 3
            Set-SendUncertainState -EvidenceDirectory $EvidenceDirectory -State $state -Reason 'acknowledgement-error' -InvokeReturned:$true
            throw
        }
    }

    if (-not $acknowledged) {
        $null = Try-BindLiveConversationUrl -State $state -RecoverPanel:$RecoverPanel -TimeoutSecondsValue 3
        Set-SendUncertainState -EvidenceDirectory $EvidenceDirectory -State $state -Reason 'acknowledgement-timeout' -InvokeReturned:$true
        Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'SendAcknowledgementMissing' -Message 'The UI did not acknowledge the one send action. Automatic resend is prohibited.' -Details ([ordered]@{ idempotencyKey = $IdempotencyKeyValue })
    }

    $boundConversationUrl = [string](Get-ObjectProperty $state 'conversationUrlBound' '')
    if ([string]::IsNullOrWhiteSpace($boundConversationUrl)) {
        $urlDeadline = [DateTime]::UtcNow.AddSeconds(8)
        try {
            while ([DateTime]::UtcNow -lt $urlDeadline) {
                try {
                    $urlContext = Resolve-LiveContext -RecoverPanel:$RecoverPanel
                    $urlAuth = Get-LiveAuthSnapshot -Context $urlContext
                    Assert-AuthReadySnapshot -Snapshot $urlAuth
                    $postSendUrlState = Get-LiveUrlState -Context $urlContext
                    if ($postSendUrlState.Exact) {
                        $boundConversationUrl = [string]$postSendUrlState.Url
                        break
                    }
                }
                catch {
                    if (-not (Test-TransientUiCategory -Category (Get-ExceptionCategory -Exception $_.Exception))) {
                        throw
                    }
                }
                Start-Sleep -Milliseconds 300
            }
        }
        catch {
            Set-SendUncertainState -EvidenceDirectory $EvidenceDirectory -State $state -Reason 'post-send-url-capture-error' -InvokeReturned:$true
            throw
        }

        if ([string]::IsNullOrWhiteSpace($boundConversationUrl)) {
            Set-SendUncertainState -EvidenceDirectory $EvidenceDirectory -State $state -Reason 'post-send-url-capture-timeout' -InvokeReturned:$true
            Throw-SidebarError -ExitCode $Script:ExitCodes.UrlCapture -Category 'ExactConversationUrlUnavailableAfterSend' -Message 'The prompt was submitted once, but the exact conversation URL could not be durably bound. Automatic waiting and resubmission are prohibited.'
        }
        Set-ObjectProperty -InputObject $state -Name 'conversationUrlBound' -Value $boundConversationUrl
        Set-ObjectProperty -InputObject $state -Name 'conversationUrlBoundAtUtc' -Value ([DateTime]::UtcNow.ToString('o'))
        # Persist the exact URL while the phase is still send-intent. A crash
        # after this write can be observed safely without guessing a chat.
        Write-EvidenceState -Directory $EvidenceDirectory -State $state
    }

    Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'sent'
    Set-ObjectProperty -InputObject $state -Name 'submissionAcknowledged' -Value $true
    Set-ObjectProperty -InputObject $state -Name 'sentAtUtc' -Value ([DateTime]::UtcNow.ToString('o'))
    Write-EvidenceState -Directory $EvidenceDirectory -State $state

    return [ordered]@{
        ok = $true
        command = 'send'
        live = $true
        submittedExactlyOnce = $true
        sendActionInvokedOnce = $true
        submissionAcknowledged = $true
        idempotencyKey = $IdempotencyKeyValue
        promptSha256 = $promptSha
        baselineResponseCount = $baselineHashes.Count
        windowRuntimeId = [string](Get-ObjectProperty $state 'windowRuntimeId' '')
        conversationUrl = $boundConversationUrl
        clipboardUsed = $false
    }
}

function Get-LiveWaitObservation {
    param([switch]$RecoverPanel)

    try {
        $context = Resolve-LiveContext -RecoverPanel:$RecoverPanel
        $auth = Get-LiveAuthSnapshot -Context $context
        Assert-AuthReadySnapshot -Snapshot $auth
        $generation = Get-LiveGenerationState -Context $context
        $responses = @(Get-LiveResponseRecords -Context $context)
        return [pscustomobject]@{
            Transient = $false
            Generating = $generation.Generating
            Responses = $responses
            Context = $context
        }
    }
    catch [System.Windows.Automation.ElementNotAvailableException] {
        return [pscustomobject]@{ Transient = $true; Generating = $false; Responses = @() }
    }
    catch {
        $category = Get-ExceptionCategory -Exception $_.Exception
        if (Test-TransientUiCategory -Category $category) {
            return [pscustomobject]@{ Transient = $true; Generating = $false; Responses = @() }
        }
        throw
    }
}

function Complete-Evidence {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)]$State,
        [Parameter(Mandatory = $true)]$Response,
        [Parameter(Mandatory = $true)][string]$ConversationUrl,
        [Parameter(Mandatory = $true)][int]$TransientObservationCount,
        [int]$StablePollCount = 0
    )

    $phaseBeforeCompletion = [string](Get-ObjectProperty $State 'phase' '')
    $canonicalUrl = ConvertTo-SanitizedChatGptUrl -Candidate $ConversationUrl
    if ($null -eq $canonicalUrl -or -not $canonicalUrl.Exact -or $canonicalUrl.Url -ne $ConversationUrl) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.UrlCapture -Category 'ConversationUrlInvalid' -Message 'Completion requires one canonical exact ChatGPT conversation URL.'
    }

    $expectedUrl = Get-BoundConversationUrlFromState -State $State
    Assert-ConversationUrlMatch -ExpectedUrl $expectedUrl -ActualUrl $ConversationUrl

    $promptFile = [string](Get-ObjectProperty $State 'promptFile' '')
    if ($promptFile -ne 'prompt.md') {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'PromptEvidencePathInvalid' -Message 'state.json must reference the fixed prompt.md evidence file.'
    }
    $promptPath = Join-Path $EvidenceDirectory 'prompt.md'
    if (-not [System.IO.File]::Exists($promptPath)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'PromptEvidenceMissing' -Message 'The prompt evidence file is missing.'
    }
    $promptSha = Get-Sha256File -Path $promptPath
    if ($promptSha -ne [string](Get-ObjectProperty $State 'promptSha256' '')) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'PromptEvidenceHashMismatch' -Message 'The prompt evidence hash no longer matches state.json.'
    }

    $responseText = [string](Get-ObjectProperty $Response 'Content' '')
    $responseObjectSha = [string](Get-ObjectProperty $Response 'ContentSha256' '')
    if ([string]::IsNullOrWhiteSpace($responseText) -or (Get-Sha256Text -Text $responseText) -ne $responseObjectSha) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'ResponseObjectHashMismatch' -Message 'The isolated response content does not match its in-memory SHA-256.'
    }

    $responsePath = Join-Path $EvidenceDirectory 'response.md'
    $urlPath = Join-Path $EvidenceDirectory 'url.txt'
    Write-Utf8NoBomAtomic -Path $responsePath -Text $responseText
    Write-Utf8NoBomAtomic -Path $urlPath -Text ($ConversationUrl + [Environment]::NewLine)

    $responseSha = Get-Sha256File -Path $responsePath
    $urlSha = Get-Sha256File -Path $urlPath
    $completedAt = [DateTime]::UtcNow.ToString('o')
    $submissionAcknowledged = [bool](Get-ObjectProperty $State 'submissionAcknowledged' ($phaseBeforeCompletion -eq 'sent'))
    $invokeAttempted = [bool](Get-ObjectProperty $State 'invokeAttempted' ($phaseBeforeCompletion -eq 'sent'))
    $invokeReturned = [bool](Get-ObjectProperty $State 'invokeReturned' ($phaseBeforeCompletion -eq 'sent'))

    $evidence = [ordered]@{
        schemaVersion = $Script:SchemaVersion
        tool = $Script:ToolName
        transport = 'windows-uia'
        live = $true
        idempotencyKey = [string](Get-ObjectProperty $State 'idempotencyKey' '')
        idempotencyKeySha256 = [string](Get-ObjectProperty $State 'idempotencyKeySha256' '')
        globalReservationAtUtc = [string](Get-ObjectProperty $State 'globalReservationAtUtc' '')
        prompt = [ordered]@{
            file = $promptFile
            sha256 = $promptSha
        }
        response = [ordered]@{
            file = 'response.md'
            sha256 = $responseSha
            characters = $responseText.Length
        }
        extractor = [ordered]@{
            version = [string](Get-ObjectProperty $Response 'ExtractorVersion' (Get-ObjectProperty $State 'extractorVersion' $Script:ExtractorVersion))
            windowRuntimeId = [string](Get-ObjectProperty $State 'windowRuntimeId' '')
            turnRuntimeId = [string](Get-ObjectProperty $Response 'TurnRuntimeId' '')
            controlTypeCounts = Get-ObjectProperty $Response 'ControlTypeCounts' ([ordered]@{})
            uiState = 'captured-at-completion'
            stabilityScope = 'same-extractor-same-visible-ui-state'
        }
        conversation = [ordered]@{
            file = 'url.txt'
            url = $ConversationUrl
            sha256 = $urlSha
            exact = $true
            boundAtSend = $expectedUrl
            matchedBoundUrl = $expectedUrl -eq $ConversationUrl
        }
        submission = [ordered]@{
            phaseBeforeCompletion = $phaseBeforeCompletion
            acknowledged = $submissionAcknowledged
            invokeAttempted = $invokeAttempted
            invokeReturned = $invokeReturned
            observationalRecovery = $phaseBeforeCompletion -ne 'sent'
            automaticResendAllowed = $false
        }
        timestamps = [ordered]@{
            intentAtUtc = [string](Get-ObjectProperty $State 'intentAtUtc' '')
            sentAtUtc = [string](Get-ObjectProperty $State 'sentAtUtc' '')
            uncertainAtUtc = [string](Get-ObjectProperty $State 'uncertainAtUtc' '')
            conversationUrlBoundAtUtc = [string](Get-ObjectProperty $State 'conversationUrlBoundAtUtc' '')
            completedAtUtc = $completedAt
        }
        baselineResponseCount = @((Get-ObjectProperty $State 'baselineResponseSha256' @())).Count
        transientObservationCount = $TransientObservationCount
        stablePollCount = $StablePollCount
        clipboardUsed = $false
        focusRestoreBestEffort = -not [bool]$NoFocusRestore
        authority = [ordered]@{
            externalOutputIsUntrusted = $true
            codexIsSoleWorkspaceWriter = $true
        }
    }
    $evidencePath = Join-Path $EvidenceDirectory 'evidence.json'
    Write-JsonAtomic -Path $evidencePath -Value $evidence
    $evidenceSha = Get-Sha256File -Path $evidencePath

    Set-ObjectProperty -InputObject $State -Name 'phase' -Value 'completed'
    Set-ObjectProperty -InputObject $State -Name 'phaseBeforeCompletion' -Value $phaseBeforeCompletion
    Set-ObjectProperty -InputObject $State -Name 'completedAtUtc' -Value $completedAt
    Set-ObjectProperty -InputObject $State -Name 'responseFile' -Value 'response.md'
    Set-ObjectProperty -InputObject $State -Name 'responseSha256' -Value $responseSha
    Set-ObjectProperty -InputObject $State -Name 'urlFile' -Value 'url.txt'
    Set-ObjectProperty -InputObject $State -Name 'conversationUrl' -Value $ConversationUrl
    Set-ObjectProperty -InputObject $State -Name 'urlSha256' -Value $urlSha
    Set-ObjectProperty -InputObject $State -Name 'evidenceFile' -Value 'evidence.json'
    Set-ObjectProperty -InputObject $State -Name 'evidenceSha256' -Value $evidenceSha
    Set-ObjectProperty -InputObject $State -Name 'submissionAcknowledged' -Value $submissionAcknowledged
    Write-EvidenceState -Directory $EvidenceDirectory -State $State

    return $evidence
}

function Invoke-LiveWait {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][int]$TimeoutSecondsValue,
        [Parameter(Mandatory = $true)][int]$PollMillisecondsValue,
        [switch]$RecoverPanel
    )

    $state = Read-EvidenceState -Directory $EvidenceDirectory
    if ($null -eq $state) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'EvidenceStateMissing' -Message 'send must create state.json before wait.'
    }
    $phase = [string](Get-ObjectProperty $state 'phase' '')
    if ($phase -eq 'completed') {
        return [ordered]@{
            ok = $true
            command = 'wait'
            live = $true
            completed = $true
            reusedCompletedEvidence = $true
            responseSha256 = [string](Get-ObjectProperty $state 'responseSha256' '')
            conversationUrl = [string](Get-ObjectProperty $state 'conversationUrl' '')
            submissionAcknowledged = [bool](Get-ObjectProperty $state 'submissionAcknowledged' $false)
            observationalRecovery = ([string](Get-ObjectProperty $state 'phaseBeforeCompletion' 'sent') -ne 'sent')
        }
    }

    $waitablePhases = @('sent', 'send-intent', 'send-uncertain')
    if ($waitablePhases -notcontains $phase) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'SendStateNotWaitable' -Message 'wait requires sent or an uncertain pre-completion phase. It never resubmits.' -Details ([ordered]@{ phase = $phase })
    }
    $observationalRecovery = $phase -ne 'sent'
    $stateWindowRuntimeId = [string](Get-ObjectProperty $state 'windowRuntimeId' '')
    if (-not [string]::IsNullOrWhiteSpace($stateWindowRuntimeId)) {
        if (-not [string]::IsNullOrWhiteSpace($Script:TargetWindowRuntimeId) -and $Script:TargetWindowRuntimeId -ne $stateWindowRuntimeId) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'CodexWindowBindingMismatch' -Message 'The requested window does not match the window durably bound at send time.'
        }
        $Script:TargetWindowRuntimeId = $stateWindowRuntimeId
    }
    $boundConversationUrl = Get-BoundConversationUrlFromState -State $state

    $baseline = @((Get-ObjectProperty $state 'baselineResponseSha256' @()) | ForEach-Object { [string]$_ })
    $pollArguments = @{
        BaselineHashes = $baseline
        ObservationProvider = { Get-LiveWaitObservation -RecoverPanel:$RecoverPanel }
        SleepAction = { param($milliseconds) Start-Sleep -Milliseconds $milliseconds }
        UtcNowProvider = { [DateTime]::UtcNow }
        TimeoutSeconds = $TimeoutSecondsValue
        PollMilliseconds = $PollMillisecondsValue
    }
    $result = Invoke-PollUntilCompleted @pollArguments

    $urlDeadline = [DateTime]::UtcNow.AddSeconds([Math]::Min(10, $TimeoutSecondsValue))
    $urlState = $null
    while ([DateTime]::UtcNow -lt $urlDeadline) {
        try {
            $context = Resolve-LiveContext -RecoverPanel:$RecoverPanel
            $urlState = Get-LiveUrlState -Context $context
            if ($urlState.Exact) {
                break
            }
        }
        catch {
            if (-not (Test-TransientUiCategory -Category (Get-ExceptionCategory -Exception $_.Exception))) {
                throw
            }
            $urlState = $null
        }
        Start-Sleep -Milliseconds $PollMillisecondsValue
    }
    if ($null -eq $urlState -or -not $urlState.Exact) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.UrlCapture -Category 'ExactConversationUrlUnavailable' -Message 'The completed response was isolated, but an exact ChatGPT conversation URL could not be captured.'
    }
    Assert-ConversationUrlMatch -ExpectedUrl $boundConversationUrl -ActualUrl $urlState.Url

    $evidence = Complete-Evidence -EvidenceDirectory $EvidenceDirectory -State $state -Response $result.Response -ConversationUrl $urlState.Url -TransientObservationCount $result.TransientObservationCount -StablePollCount $result.StablePollCount
    return [ordered]@{
        ok = $true
        command = 'wait'
        live = $true
        completed = $true
        responseSha256 = $evidence.response.sha256
        evidenceSha256 = [string](Get-ObjectProperty $state 'evidenceSha256' '')
        responseCharacters = $evidence.response.characters
        conversationUrl = $evidence.conversation.url
        submissionAcknowledged = $evidence.submission.acknowledged
        observationalRecovery = $observationalRecovery
        transientObservationCount = $evidence.transientObservationCount
        stablePollCount = $evidence.stablePollCount
        clipboardUsed = $false
    }
}

function Get-CompletedResponseResult {
    param([Parameter(Mandatory = $true)][string]$EvidenceDirectory)

    $state = Read-EvidenceState -Directory $EvidenceDirectory
    if ($null -eq $state -or [string](Get-ObjectProperty $state 'phase' '') -ne 'completed') {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'ResponseNotCompleted' -Message 'Run wait successfully before response.'
    }

    if ([string](Get-ObjectProperty $state 'promptFile' '') -ne 'prompt.md' -or
        [string](Get-ObjectProperty $state 'responseFile' '') -ne 'response.md' -or
        [string](Get-ObjectProperty $state 'urlFile' '') -ne 'url.txt' -or
        [string](Get-ObjectProperty $state 'evidenceFile' '') -ne 'evidence.json') {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'EvidencePathInvalid' -Message 'Completed state must reference only the fixed evidence filenames.'
    }

    $promptPath = Join-Path $EvidenceDirectory 'prompt.md'
    $responsePath = Join-Path $EvidenceDirectory 'response.md'
    $urlPath = Join-Path $EvidenceDirectory 'url.txt'
    $evidencePath = Join-Path $EvidenceDirectory 'evidence.json'

    foreach ($requiredPath in @($promptPath, $responsePath, $urlPath, $evidencePath)) {
        if (-not [System.IO.File]::Exists($requiredPath)) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'CompletedEvidenceMissing' -Message 'One or more completed evidence files are missing.'
        }
    }

    $promptSha = Get-Sha256File -Path $promptPath
    $responseSha = Get-Sha256File -Path $responsePath
    $urlSha = Get-Sha256File -Path $urlPath
    $evidenceSha = Get-Sha256File -Path $evidencePath
    if ($promptSha -ne [string](Get-ObjectProperty $state 'promptSha256' '')) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'PromptEvidenceHashMismatch' -Message 'The prompt evidence hash no longer matches state.json.'
    }
    if ($responseSha -ne [string](Get-ObjectProperty $state 'responseSha256' '')) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'ResponseEvidenceHashMismatch' -Message 'The response evidence hash no longer matches state.json.'
    }
    if ($urlSha -ne [string](Get-ObjectProperty $state 'urlSha256' '')) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'UrlEvidenceHashMismatch' -Message 'The URL evidence hash no longer matches state.json.'
    }
    if ($evidenceSha -ne [string](Get-ObjectProperty $state 'evidenceSha256' '')) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'EvidenceManifestHashMismatch' -Message 'evidence.json no longer matches its SHA-256 in state.json.'
    }

    $conversationUrl = [System.IO.File]::ReadAllText($urlPath, $Script:Utf8NoBom).Trim()
    $canonicalUrl = ConvertTo-SanitizedChatGptUrl -Candidate $conversationUrl
    if ($null -eq $canonicalUrl -or -not $canonicalUrl.Exact -or $canonicalUrl.Url -ne $conversationUrl -or $conversationUrl -ne [string](Get-ObjectProperty $state 'conversationUrl' '')) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'UrlEvidenceInvalid' -Message 'The URL evidence is not one canonical exact conversation URL matching state.json.'
    }

    try {
        $evidence = [System.IO.File]::ReadAllText($evidencePath, $Script:Utf8NoBom) | ConvertFrom-Json
    }
    catch {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'EvidenceJsonInvalid' -Message 'evidence.json is unreadable or invalid JSON.'
    }
    $evidencePrompt = Get-ObjectProperty $evidence 'prompt' $null
    $evidenceResponse = Get-ObjectProperty $evidence 'response' $null
    $evidenceConversation = Get-ObjectProperty $evidence 'conversation' $null
    $boundConversationUrl = Get-BoundConversationUrlFromState -State $state
    if ([string](Get-ObjectProperty $evidencePrompt 'sha256' '') -ne $promptSha -or
        [string](Get-ObjectProperty $evidenceResponse 'sha256' '') -ne $responseSha -or
        [string](Get-ObjectProperty $evidenceConversation 'sha256' '') -ne $urlSha -or
        [string](Get-ObjectProperty $evidenceConversation 'url' '') -ne $conversationUrl -or
        [string](Get-ObjectProperty $evidenceConversation 'boundAtSend' '') -ne $boundConversationUrl -or
        -not [bool](Get-ObjectProperty $evidenceConversation 'matchedBoundUrl' $false)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'EvidenceJsonHashMismatch' -Message 'evidence.json does not match the durable evidence files and bound conversation.'
    }

    $responseText = [System.IO.File]::ReadAllText($responsePath, $Script:Utf8NoBom)
    return [ordered]@{
        ok = $true
        command = 'response'
        live = $true
        response = $responseText
        promptSha256 = $promptSha
        responseSha256 = $responseSha
        evidenceSha256 = $evidenceSha
        conversationUrl = $conversationUrl
        idempotencyKey = [string](Get-ObjectProperty $state 'idempotencyKey' '')
        submissionAcknowledged = [bool](Get-ObjectProperty $state 'submissionAcknowledged' $false)
        observationalRecovery = ([string](Get-ObjectProperty $state 'phaseBeforeCompletion' 'sent') -ne 'sent')
        clipboardUsed = $false
    }
}

function Invoke-MainCommand {
    if ([string]::IsNullOrWhiteSpace($Command)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'CommandRequired' -Message 'Command is required: status, new-chat, send, wait, response, or run.'
    }
    if (@('status', 'new-chat', 'send', 'wait', 'response', 'run') -notcontains $Command) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'CommandInvalid' -Message 'Command must be status, new-chat, send, wait, response, or run.'
    }
    if ($FreshConversation -and $Command -ne 'send') {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'FreshConversationModeInvalid' -Message 'FreshConversation is valid only with the send command.'
    }
    if ($TimeoutSeconds -lt 5 -or $TimeoutSeconds -gt 3600) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'TimeoutInvalid' -Message 'TimeoutSeconds must be between 5 and 3600.'
    }
    if ($PollMilliseconds -lt 250 -or $PollMilliseconds -gt 5000) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'PollIntervalInvalid' -Message 'PollMilliseconds must be between 250 and 5000.'
    }
    if (-not [string]::IsNullOrWhiteSpace($Script:TargetWindowRuntimeId) -and $Script:TargetWindowRuntimeId -notmatch '^[0-9.-]{1,256}$') {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'WindowRuntimeIdInvalid' -Message 'WindowRuntimeId must be a bounded UIA runtime-id string containing only digits, dots, and hyphens.'
    }

    Initialize-LiveUiAutomation
    $recoverPanel = -not $NoPanelRecovery
    $uiLease = $null

    try {
        $uiLease = Enter-UiMutex
        switch ($Command) {
        'status' {
            $snapshot = Get-LiveStatusSnapshot -RecoverPanel:$recoverPanel
            $payload = New-BoundedStatusPayload -Snapshot $snapshot
            try {
                Assert-AuthReadySnapshot -Snapshot $snapshot
                Assert-ChatGptUrlState -UrlState ([pscustomobject]@{ Url = $snapshot.Url; Exact = $snapshot.UrlExact })
            }
            catch {
                Throw-SidebarError -ExitCode (Get-ExceptionExitCode -Exception $_.Exception) -Category (Get-ExceptionCategory -Exception $_.Exception) -Message $_.Exception.Message -Details $payload
            }
            return $payload
        }
        'new-chat' {
            return Invoke-LiveNewChat -RecoverPanel:$recoverPanel
        }
        'send' {
            $directory = Resolve-EvidenceDirectory -Path $EvidenceDir
            $lock = Enter-EvidenceLock -Directory $directory
            try {
                $promptText = Read-PromptInput -PromptPathValue $PromptPath -PromptValue $Prompt
                $key = Resolve-IdempotencyKey -Value $IdempotencyKey
                return Invoke-LiveSend -PromptText $promptText -EvidenceDirectory $directory -IdempotencyKeyValue $key -RequireFreshConversation:$FreshConversation -RequireExistingConversation:(-not $FreshConversation) -RecoverPanel:$recoverPanel
            }
            finally {
                $lock.Dispose()
            }
        }
        'wait' {
            $directory = Resolve-EvidenceDirectory -Path $EvidenceDir
            $lock = Enter-EvidenceLock -Directory $directory
            try {
                return Invoke-LiveWait -EvidenceDirectory $directory -TimeoutSecondsValue $TimeoutSeconds -PollMillisecondsValue $PollMilliseconds -RecoverPanel:$recoverPanel
            }
            finally {
                $lock.Dispose()
            }
        }
        'response' {
            $directory = Resolve-EvidenceDirectory -Path $EvidenceDir
            $lock = Enter-EvidenceLock -Directory $directory
            try {
                return Get-CompletedResponseResult -EvidenceDirectory $directory
            }
            finally {
                $lock.Dispose()
            }
        }
        'run' {
            $directory = Resolve-EvidenceDirectory -Path $EvidenceDir
            $lock = Enter-EvidenceLock -Directory $directory
            try {
                $promptText = Read-PromptInput -PromptPathValue $PromptPath -PromptValue $Prompt
                $key = Resolve-IdempotencyKey -Value $IdempotencyKey

                $existingState = Read-EvidenceState -Directory $directory
                Assert-IdempotencyAvailable -ExistingState $existingState -IdempotencyKey $key
                Assert-EvidenceDirectoryPristine -Directory $directory
                # Check the per-user reservation before New chat so a known
                # duplicate cannot change the user's selected conversation.
                $null = Assert-GlobalIdempotencyKeyAvailable -IdempotencyKeyValue $key
                $null = Invoke-LiveNewChat -RecoverPanel:$recoverPanel
                $sendResult = Invoke-LiveSend -PromptText $promptText -EvidenceDirectory $directory -IdempotencyKeyValue $key -RequireFreshConversation -RecoverPanel:$recoverPanel
                $waitResult = Invoke-LiveWait -EvidenceDirectory $directory -TimeoutSecondsValue $TimeoutSeconds -PollMillisecondsValue $PollMilliseconds -RecoverPanel:$recoverPanel
                $responseResult = Get-CompletedResponseResult -EvidenceDirectory $directory

                return [ordered]@{
                    ok = $true
                    command = 'run'
                    live = $true
                    submittedExactlyOnce = $sendResult.submittedExactlyOnce
                    sendActionInvokedOnce = $sendResult.sendActionInvokedOnce
                    submissionAcknowledged = $responseResult.submissionAcknowledged
                    completed = $waitResult.completed
                    idempotencyKey = $responseResult.idempotencyKey
                    promptSha256 = $sendResult.promptSha256
                    response = $responseResult.response
                    responseSha256 = $responseResult.responseSha256
                    conversationUrl = $responseResult.conversationUrl
                    clipboardUsed = $false
                }
            }
            finally {
                $lock.Dispose()
            }
        }
        }
    }
    finally {
        Exit-UiMutex -Lease $uiLease
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try { [Console]::OutputEncoding = $Script:Utf8NoBom } catch { }
    try {
        $result = Invoke-MainCommand
        Write-JsonResult -Value $result
        exit 0
    }
    catch {
        $exception = $_.Exception
        $payload = New-SafeErrorPayload -Exception $exception -CommandName $Command
        Write-JsonResult -Value $payload
        exit ([int]$payload.code)
    }
}
