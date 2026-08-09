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
    [string]$BrowserId,
    [string]$Profile,
    [string]$TabId,
    [string]$SessionKey,
    [string]$ExpectedConversationUrl,
    [string]$CodexThreadId = $env:CODEX_THREAD_ID,
    [switch]$FreshConversation,

    [int]$TimeoutSeconds = 600,

    [int]$ResponseTimeoutSeconds = 7200,

    [int]$PollMilliseconds = 1000,

    [switch]$NoPanelRecovery,
    [switch]$NoFocusRestore,
    [switch]$AllowComposerFocus
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Script:ToolName = 'chatgpt-pro-sidebar'
$Script:SchemaVersion = 1
$Script:ExtractorVersion = 'uia-agent-turn-v2'
$Script:AgentBrowserTransport = 'agent-browser-cli-v2'
$Script:AgentBrowserExtractorVersion = 'dom-agent-turn-v1'
$Script:AgentBrowserCliCommand = 'agent-browser-cli'
$Script:AgentBrowserScriptPath = Join-Path $PSScriptRoot 'chatgpt-pro-agent-browser-v2.js'
$Script:AgentBrowserSelectProScriptPath = Join-Path $PSScriptRoot 'chatgpt-pro-agent-browser-select-pro.js'
$Script:AgentBrowserPromptCharacterLimit = 24000
$Script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$Script:IdempotencyRootOverride = $null
$Script:TargetClaimRootOverride = $null
$Script:TargetWindowRuntimeId = $WindowRuntimeId
$Script:NoFocusRestore = [bool]$NoFocusRestore
$Script:AllowComposerFocus = [bool]$AllowComposerFocus
$Script:RawTraversalCache = @{}
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
    CodexWindow   = @('ChatGPT', 'Codex')
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
    param([AllowEmptyCollection()][Parameter(Mandatory = $true)][byte[]]$Bytes)

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

function Resolve-CodexThreadId {
    param([AllowEmptyString()][string]$Value)

    if (-not (Test-CodexDesktopThreadId -Value $Value)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'CodexThreadIdInvalid' -Message 'CodexThreadId must be one exact UUID.'
    }
    return $Value.ToLowerInvariant()
}

function Assert-StateCodexThreadId {
    param(
        [Parameter(Mandatory = $true)]$State,
        [Parameter(Mandatory = $true)][string]$ExpectedCodexThreadId
    )

    $expected = Resolve-CodexThreadId -Value $ExpectedCodexThreadId
    $actual = [string](Get-ObjectProperty $State 'codexThreadId' '')
    if (-not (Test-CodexDesktopThreadId -Value $actual) -or $actual.ToLowerInvariant() -cne $expected) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'CodexThreadMismatch' -Message 'The evidence belongs to a different Codex task.'
    }
    return $expected
}

function Assert-AgentBrowserTargetBindingComplete {
    param([Parameter(Mandatory = $true)]$Binding)

    foreach ($name in @('browserId', 'profileId', 'tabId', 'sessionKey')) {
        if (-not (Test-BoundedAgentBrowserIdentity -Value ([string](Get-ObjectProperty $Binding $name '')))) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'AgentBrowserTargetBindingIncomplete' -Message 'A complete browser/profile/tab/session target binding is required for parallel operation.'
        }
    }
    if (-not (Test-BoundedAgentBrowserIdentity -Value ([string](Get-ObjectProperty $Binding 'profileLabel' '')) -AllowEmpty) -or
        [string](Get-ObjectProperty $Binding 'origin' '') -cne 'https://chatgpt.com') {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'AgentBrowserTargetBindingIncomplete' -Message 'The target binding has an invalid profile label or origin.'
    }
    $url = [string](Get-ObjectProperty $Binding 'url' '')
    $canonical = ConvertTo-SanitizedChatGptUrl -Candidate $url
    if ($null -eq $canonical -or -not $canonical.AllowedForChat -or $canonical.Url -cne $url) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'AgentBrowserTargetBindingIncomplete' -Message 'The target binding must contain one canonical allowed ChatGPT URL.'
    }
    return $Binding
}

function Get-AgentBrowserTargetMutexName {
    param([Parameter(Mandatory = $true)]$Binding)

    $null = Assert-AgentBrowserTargetBindingComplete -Binding $Binding
    $identity = @(
        [string](Get-ObjectProperty $Binding 'browserId' ''),
        [string](Get-ObjectProperty $Binding 'profileId' ''),
        [string](Get-ObjectProperty $Binding 'tabId' ''),
        [string](Get-ObjectProperty $Binding 'sessionKey' '')
    ) | ConvertTo-Json -Compress
    return 'Local\ChatGptProSidebarV1-' + (Get-Sha256Text -Text $identity)
}

function Get-AgentBrowserTargetClaimRoot {
    $override = [string]$Script:TargetClaimRootOverride
    if (-not [string]::IsNullOrWhiteSpace($override)) {
        return [System.IO.Path]::GetFullPath($override)
    }
    $localApplicationData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    if ([string]::IsNullOrWhiteSpace($localApplicationData)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'TargetClaimRootUnavailable' -Message 'The per-user local application data directory is unavailable.'
    }
    return Join-Path $localApplicationData 'ChatGptProSidebar\target-claims-v1'
}

function Get-AgentBrowserTargetClaimDescriptor {
    param([Parameter(Mandatory = $true)]$Binding)

    $null = Assert-AgentBrowserTargetBindingComplete -Binding $Binding
    $url = [string](Get-ObjectProperty $Binding 'url' '')
    $canonical = ConvertTo-SanitizedChatGptUrl -Candidate $url
    if ($null -ne $canonical -and $canonical.Exact -and $canonical.Url -ceq $url) {
        $scope = 'conversation'
        $identity = @($scope, [string](Get-ObjectProperty $Binding 'profileId' ''), $url) | ConvertTo-Json -Compress
    }
    else {
        $scope = 'tab'
        $identity = @(
            $scope,
            [string](Get-ObjectProperty $Binding 'browserId' ''),
            [string](Get-ObjectProperty $Binding 'profileId' ''),
            [string](Get-ObjectProperty $Binding 'tabId' ''),
            [string](Get-ObjectProperty $Binding 'sessionKey' '')
        ) | ConvertTo-Json -Compress
    }
    return [pscustomobject]@{
        Scope = $scope
        KeySha256 = Get-Sha256Text -Text $identity
    }
}

function Test-AgentBrowserTargetClaimTransferSafeState {
    param($State)

    if ($null -eq $State) {
        return $false
    }
    $phase = [string](Get-ObjectProperty $State 'phase' '')
    if ($phase -eq 'completed') {
        return $true
    }
    if ($phase -eq 'pre-invoke-failed' -and -not [bool](Get-ObjectProperty $State 'invokeAttempted' $true)) {
        return $true
    }
    if ($phase -ne 'send-uncertain' -or
        [string](Get-ObjectProperty $State 'retryOutcome' '') -ne 'retry-not-submitted' -or
        [bool](Get-ObjectProperty $State 'submissionAcknowledged' $true) -or
        [bool](Get-ObjectProperty $State 'automaticResendAllowed' $true) -or
        [int](Get-ObjectProperty $State 'attemptCount' 0) -ne 2) {
        return $false
    }

    $promptSha256 = [string](Get-ObjectProperty $State 'promptSha256' '')
    $attempts = @((Get-ObjectProperty $State 'attempts' @()))
    if ($promptSha256 -notmatch '^[0-9a-f]{64}$' -or $attempts.Count -ne 2) {
        return $false
    }
    $expectedOutcomes = @('proved-not-submitted', 'retry-not-submitted')
    for ($index = 0; $index -lt 2; $index++) {
        $attempt = $attempts[$index]
        if ([string](Get-ObjectProperty $attempt 'outcome' '') -ne $expectedOutcomes[$index] -or
            -not [string]::IsNullOrWhiteSpace([string](Get-ObjectProperty $attempt 'exactConversationUrl' '')) -or
            [bool](Get-ObjectProperty $attempt 'userTurnObserved' $true) -or
            [bool](Get-ObjectProperty $attempt 'generatingObserved' $true) -or
            [string](Get-ObjectProperty $attempt 'composerSha256Observed' '') -cne $promptSha256) {
            return $false
        }
    }
    return $true
}

function Reserve-AgentBrowserTargetClaim {
    param(
        [Parameter(Mandatory = $true)][string]$CodexThreadIdValue,
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$IdempotencyKeySha256Value,
        [Parameter(Mandatory = $true)]$Binding
    )

    $claimLease = Enter-UiMutex -TargetBinding $Binding
    try {
    $threadId = Resolve-CodexThreadId -Value $CodexThreadIdValue
    if ($IdempotencyKeySha256Value -notmatch '^[0-9a-f]{64}$') {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'IdempotencyKeyHashInvalid' -Message 'The target claim requires one lowercase SHA-256 idempotency key hash.'
    }
    $directory = [System.IO.Path]::GetFullPath($EvidenceDirectory)
    $descriptor = Get-AgentBrowserTargetClaimDescriptor -Binding $Binding
    $root = Get-AgentBrowserTargetClaimRoot
    try { $null = [System.IO.Directory]::CreateDirectory($root) }
    catch { Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'TargetClaimRootCreateFailed' -Message 'The durable per-user target claim directory could not be created.' }
    $path = Join-Path $root ($descriptor.KeySha256 + '.json')
    $claimLock = $null
    try {
        $claimLock = [System.IO.FileStream]::new(
            ($path + '.lock'),
            [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
    }
    catch [System.IO.IOException] {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ConcurrentOperation -Category 'AgentBrowserTargetClaimBusy' -Message 'Another process is updating this ChatGPT target claim.' -Details ([ordered]@{ targetClaimKeySha256 = $descriptor.KeySha256 })
    }
    try {
    $record = [ordered]@{
        schemaVersion = $Script:SchemaVersion
        tool = $Script:ToolName
        targetClaimKeySha256 = $descriptor.KeySha256
        scope = $descriptor.Scope
        codexThreadId = $threadId
        evidenceDirectory = $directory
        idempotencyKeySha256 = $IdempotencyKeySha256Value
        targetBinding = $Binding
        claimedAtUtc = [DateTime]::UtcNow.ToString('o')
        automaticResendAllowed = $false
    }
    $bytes = $Script:Utf8NoBom.GetBytes((($record | ConvertTo-Json -Depth 10) + [Environment]::NewLine))
    $stream = $null
    try {
        try {
            $stream = [System.IO.FileStream]::new($path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Flush($true)
            return [pscustomobject]@{ KeySha256 = $descriptor.KeySha256; Scope = $descriptor.Scope; Reused = $false }
        }
        catch [System.IO.IOException] {
            if (-not [System.IO.File]::Exists($path)) { throw }
        }
    }
    finally {
        if ($null -ne $stream) { $stream.Dispose() }
    }

    try { $existing = [System.IO.File]::ReadAllText($path, $Script:Utf8NoBom) | ConvertFrom-Json }
    catch { Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'TargetClaimInvalid' -Message 'The existing target claim is unreadable or invalid JSON.' }
    if ([string](Get-ObjectProperty $existing 'targetClaimKeySha256' '') -cne $descriptor.KeySha256 -or
        [string](Get-ObjectProperty $existing 'codexThreadId' '') -cne $threadId) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ConcurrentOperation -Category 'AgentBrowserTargetClaimConflict' -Message 'This ChatGPT target is already claimed by another task or round.' -Details ([ordered]@{ targetClaimKeySha256 = $descriptor.KeySha256 })
    }
    if ([string](Get-ObjectProperty $existing 'evidenceDirectory' '') -ceq $directory -and
        [string](Get-ObjectProperty $existing 'idempotencyKeySha256' '') -ceq $IdempotencyKeySha256Value) {
        return [pscustomobject]@{ KeySha256 = $descriptor.KeySha256; Scope = $descriptor.Scope; Reused = $true }
    }

    $previousDirectory = [string](Get-ObjectProperty $existing 'evidenceDirectory' '')
    $previousStatePath = if ([string]::IsNullOrWhiteSpace($previousDirectory)) { '' } else { Join-Path $previousDirectory 'state.json' }
    try {
        $previousState = if ([string]::IsNullOrWhiteSpace($previousStatePath) -or -not [System.IO.File]::Exists($previousStatePath)) {
            $null
        }
        else {
            [System.IO.File]::ReadAllText($previousStatePath, $Script:Utf8NoBom) | ConvertFrom-Json
        }
    }
    catch { $previousState = $null }
    $previousPhase = [string](Get-ObjectProperty $previousState 'phase' '')
    $previousSafe = Test-AgentBrowserTargetClaimTransferSafeState -State $previousState
    if (-not $previousSafe) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ConcurrentOperation -Category 'AgentBrowserTargetClaimConflict' -Message 'This ChatGPT target still belongs to a non-terminal round.' -Details ([ordered]@{ targetClaimKeySha256 = $descriptor.KeySha256; phase = $previousPhase })
    }
    Write-JsonAtomic -Path $path -Value $record
    return [pscustomobject]@{ KeySha256 = $descriptor.KeySha256; Scope = $descriptor.Scope; Reused = $false }
    }
    finally {
        if ($null -ne $claimLock) { $claimLock.Dispose() }
    }
    }
    finally {
        Exit-UiMutex -Lease $claimLease
    }
}

function Assert-AgentBrowserTargetClaimOwnership {
    param(
        [Parameter(Mandatory = $true)][string]$CodexThreadIdValue,
        [Parameter(Mandatory = $true)]$Binding,
        [AllowEmptyString()][string]$EvidenceDirectory = ''
    )

    $threadId = Resolve-CodexThreadId -Value $CodexThreadIdValue
    $descriptor = Get-AgentBrowserTargetClaimDescriptor -Binding $Binding
    $path = Join-Path (Get-AgentBrowserTargetClaimRoot) ($descriptor.KeySha256 + '.json')
    if (-not [System.IO.File]::Exists($path)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ConcurrentOperation -Category 'AgentBrowserTargetClaimMissing' -Message 'The bound ChatGPT target has no durable ownership claim.'
    }
    try { $record = [System.IO.File]::ReadAllText($path, $Script:Utf8NoBom) | ConvertFrom-Json }
    catch { Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'TargetClaimInvalid' -Message 'The target claim is unreadable or invalid JSON.' }
    $expectedDirectory = if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) { '' } else { [System.IO.Path]::GetFullPath($EvidenceDirectory) }
    if ([string](Get-ObjectProperty $record 'codexThreadId' '') -cne $threadId -or
        (-not [string]::IsNullOrWhiteSpace($expectedDirectory) -and [string](Get-ObjectProperty $record 'evidenceDirectory' '') -cne $expectedDirectory)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ConcurrentOperation -Category 'AgentBrowserTargetClaimConflict' -Message 'The bound ChatGPT target belongs to another task or round.'
    }
    return $record
}

function Enter-UiMutex {
    param([Parameter(Mandatory = $true)]$TargetBinding)

    $mutexName = Get-AgentBrowserTargetMutexName -Binding $TargetBinding
    $mutex = [System.Threading.Mutex]::new($false, $mutexName)
    $acquired = $false
    try {
        try {
            $acquired = $mutex.WaitOne(0)
        }
        catch [System.Threading.AbandonedMutexException] {
            $acquired = $true
        }

        if (-not $acquired) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.ConcurrentOperation -Category 'ConcurrentUiOperation' -Message 'Another chatgpt-pro-sidebar process is operating this exact ChatGPT target.'
        }

        return [pscustomobject]@{
            Mutex = $mutex
            Acquired = $true
            Name = $mutexName
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

function Test-BoundedWindowRuntimeId {
    param([AllowEmptyString()][string]$Value)

    return -not [string]::IsNullOrWhiteSpace($Value) -and $Value.Length -le 256 -and $Value -notmatch '[\r\n]'
}

function Select-CodexWindowRecord {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Records,
        [AllowEmptyString()][string]$TargetRuntimeId = '',
        [AllowEmptyString()][string]$FocusedTopLevelRuntimeId = ''
    )

    $candidates = @($Records | Where-Object {
        [bool](Get-ObjectProperty $_ 'IsVisible' $true) -and
        [int](Get-ObjectProperty $_ 'CodexDocumentCount' 0) -gt 0
    })
    if ($candidates.Count -eq 0) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'CodexWindowMissing' -Message 'No visible top-level window containing a Codex document was proved.' -Details ([ordered]@{ candidateCount = 0 })
    }

    $candidateRuntimeIds = @($candidates | ForEach-Object {
        [string](Get-ObjectProperty $_ 'RuntimeId' '')
    })
    if (@($candidateRuntimeIds | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'CodexWindowRuntimeIdMissing' -Message 'An eligible Codex window has no UIA RuntimeId and cannot be bound.' -Details ([ordered]@{ candidateCount = $candidates.Count })
    }
    if (@($candidateRuntimeIds | Where-Object { -not (Test-BoundedWindowRuntimeId -Value $_) }).Count -gt 0) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'CodexWindowRuntimeIdInvalid' -Message 'An eligible Codex window has an unbounded UIA RuntimeId and cannot be bound.' -Details ([ordered]@{ candidateCount = $candidates.Count })
    }
    $seenRuntimeIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($candidateRuntimeId in $candidateRuntimeIds) {
        if (-not $seenRuntimeIds.Add($candidateRuntimeId)) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'CodexWindowRuntimeIdAmbiguous' -Message 'Eligible Codex windows share a UIA RuntimeId and cannot be distinguished.' -Details ([ordered]@{ candidateCount = $candidates.Count })
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($TargetRuntimeId)) {
        $targetMatches = @($candidates | Where-Object {
            [string](Get-ObjectProperty $_ 'RuntimeId' '') -ceq $TargetRuntimeId
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
            [string](Get-ObjectProperty $_ 'RuntimeId' '') -ceq $FocusedTopLevelRuntimeId
        })
        if ($focusedMatches.Count -eq 1) {
            return $focusedMatches[0]
        }
    }

    if ($candidates.Count -gt 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'CodexWindowAmbiguous' -Message 'Multiple visible top-level windows contain Codex documents; focus the intended window or pass WindowRuntimeId.' -Details ([ordered]@{
            candidateCount = $candidates.Count
            focusedTopLevelRuntimeId = $FocusedTopLevelRuntimeId
            candidateRuntimeIds = @($candidates | ForEach-Object { [string](Get-ObjectProperty $_ 'RuntimeId' '') })
        })
    }
    return $candidates[0]
}

function Set-LiveOperationWindowBinding {
    param([Parameter(Mandatory = $true)]$WindowRecord)

    $runtimeId = [string](Get-ObjectProperty $WindowRecord 'RuntimeId' '')
    if ([string]::IsNullOrWhiteSpace($runtimeId)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'CodexWindowRuntimeIdMissing' -Message 'The selected Codex window has no UIA RuntimeId and cannot be bound.'
    }
    if (-not (Test-BoundedWindowRuntimeId -Value $runtimeId)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'CodexWindowRuntimeIdInvalid' -Message 'The selected Codex window has an unbounded UIA RuntimeId and cannot be bound.'
    }
    if ([string]::IsNullOrWhiteSpace($Script:TargetWindowRuntimeId)) {
        $Script:TargetWindowRuntimeId = $runtimeId
        return $WindowRecord
    }
    if ($Script:TargetWindowRuntimeId -cne $runtimeId) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'CodexWindowBindingMismatch' -Message 'The resolved Codex window does not match the immutable operation target.'
    }
    return $WindowRecord
}

function Select-EmbeddedDocumentRecord {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Records)

    $visible = @($Records | Where-Object { [bool](Get-ObjectProperty $_ 'IsVisible' $false) })
    $canonical = @($visible | Where-Object { [bool](Get-ObjectProperty $_ 'CanonicalUrlMatch' $false) })
    if ($canonical.Count -eq 1) {
        return $canonical[0]
    }
    if ($canonical.Count -gt 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.DocumentSelection -Category 'EmbeddedDocumentAmbiguous' -Message 'Multiple embedded documents expose a canonical ChatGPT URL.' -Details ([ordered]@{ candidateCount = $canonical.Count })
    }

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
    if ($RequireFreshConversation -and ($exact -or $canonical.Url -cne 'https://chatgpt.com/')) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'FreshConversationUnproved' -Message 'A fresh ChatGPT conversation requires the canonical ChatGPT homepage; custom GPT and existing-conversation paths are not retry-safe.'
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

function Find-TurnBaselineSuffix {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$BaselineHashes,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$CurrentTurns
    )

    $currentHashes = @($CurrentTurns | ForEach-Object { [string](Get-ObjectProperty $_ 'ContentSha256' '') })
    if ($BaselineHashes.Count -eq 0) {
        return [pscustomobject]@{
            CurrentHashes = $currentHashes
            OmittedBaselinePrefixCount = 0
            RetainedBaselineCount = 0
            NewCount = $currentHashes.Count
        }
    }

    for ($omitted = 0; $omitted -lt $BaselineHashes.Count; $omitted++) {
        $retained = $BaselineHashes.Count - $omitted
        if ($currentHashes.Count -lt $retained) {
            continue
        }
        $matches = $true
        for ($index = 0; $index -lt $retained; $index++) {
            if ($currentHashes[$index] -cne $BaselineHashes[$omitted + $index]) {
                $matches = $false
                break
            }
        }
        if ($matches) {
            return [pscustomobject]@{
                CurrentHashes = $currentHashes
                OmittedBaselinePrefixCount = $omitted
                RetainedBaselineCount = $retained
                NewCount = $currentHashes.Count - $retained
            }
        }
    }
    return $null
}

function Compare-ResponseBaseline {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$BaselineHashes,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$CurrentResponses
    )

    $match = Find-TurnBaselineSuffix -BaselineHashes $BaselineHashes -CurrentTurns $CurrentResponses
    if ($null -eq $match) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'ResponseBaselineMismatch' -Message 'Rendered assistant responses do not retain an unchanged ordered suffix of the recorded baseline.' -Details ([ordered]@{ baselineCount = $BaselineHashes.Count; currentCount = $CurrentResponses.Count })
    }

    $newCount = $match.NewCount
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

function Test-PendingFreshConversationBinding {
    param([Parameter(Mandatory = $true)]$State)

    return (
        [string](Get-ObjectProperty $State 'phase' '') -eq 'sent' -and
        [bool](Get-ObjectProperty $State 'conversationUrlBindingPending' $false) -and
        [bool](Get-ObjectProperty $State 'submissionAcknowledged' $false) -and
        [bool](Get-ObjectProperty $State 'invokeAttempted' $false) -and
        [bool](Get-ObjectProperty $State 'invokeReturned' $false) -and
        -not [bool](Get-ObjectProperty $State 'automaticResendAllowed' $true) -and
        [string]::IsNullOrWhiteSpace([string](Get-ObjectProperty $State 'conversationUrlBeforeSend' '')) -and
        [string]::IsNullOrWhiteSpace([string](Get-ObjectProperty $State 'conversationUrlBound' ''))
    )
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
        focusRestoreBestEffort = -not $Script:NoFocusRestore
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

function Get-EffectiveResponseTimeoutSeconds {
    param(
        [Parameter(Mandatory = $true)]$State,
        [Parameter(Mandatory = $true)][int]$RequestedTimeoutSeconds,
        [scriptblock]$UtcNowProvider = { [DateTime]::UtcNow }
    )

    $deadlineText = [string](Get-ObjectProperty $State 'responseDeadlineAtUtc' '')
    if ([string]::IsNullOrWhiteSpace($deadlineText)) {
        return $RequestedTimeoutSeconds
    }
    try {
        $deadline = [DateTimeOffset]::Parse(
            $deadlineText,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AssumeUniversal
        ).UtcDateTime
    }
    catch {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'ResponseDeadlineInvalid' -Message 'state.json contains an invalid responseDeadlineAtUtc value.'
    }
    $remaining = [int][Math]::Ceiling(($deadline - ([DateTime](& $UtcNowProvider)).ToUniversalTime()).TotalSeconds)
    if ($remaining -le 0) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Timeout -Category 'ResponseDeadlineExpired' -Message 'The original response deadline has expired; recovery cannot grant a new wait budget.'
    }
    return [Math]::Min($RequestedTimeoutSeconds, $remaining)
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
    return $OriginalTopLevelRuntimeId -ne $ExpectedAutomationTopLevelRuntimeId -and $CurrentTopLevelRuntimeId -eq $ExpectedAutomationTopLevelRuntimeId
}

function Restore-FocusState {
    param(
        $OriginalState,
        [AllowEmptyString()][string]$ExpectedAutomationTopLevelRuntimeId
    )

    if ($Script:NoFocusRestore -or $null -eq $OriginalState) {
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

function Test-PanelControlRelation {
    param(
        [Parameter(Mandatory = $true)]$Record,
        [Parameter(Mandatory = $true)]$AnchorRecord
    )

    $values = @(
        (Get-ObjectProperty $Record 'X' 0),
        (Get-ObjectProperty $Record 'Y' 0),
        (Get-ObjectProperty $Record 'Width' 0),
        (Get-ObjectProperty $Record 'Height' 0),
        (Get-ObjectProperty $AnchorRecord 'X' 0),
        (Get-ObjectProperty $AnchorRecord 'Y' 0),
        (Get-ObjectProperty $AnchorRecord 'Width' 0),
        (Get-ObjectProperty $AnchorRecord 'Height' 0)
    )
    foreach ($value in $values) {
        $number = [double]$value
        if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) {
            return $false
        }
    }

    $anchorX = [double](Get-ObjectProperty $AnchorRecord 'X' 0)
    $anchorY = [double](Get-ObjectProperty $AnchorRecord 'Y' 0)
    $anchorHeight = [Math]::Max(1, [double](Get-ObjectProperty $AnchorRecord 'Height' 0))
    $recordY = [double](Get-ObjectProperty $Record 'Y' 0)
    $recordHeight = [double](Get-ObjectProperty $Record 'Height' 0)
    $recordRight = [double](Get-ObjectProperty $Record 'X' 0) + [double](Get-ObjectProperty $Record 'Width' 0)
    $rowTolerance = [Math]::Max(4, [Math]::Min(12, $anchorHeight * 0.35))
    $horizontalGap = $anchorX - $recordRight
    return [Math]::Abs($recordY - $anchorY) -le $rowTolerance -and
        [Math]::Abs($recordHeight - $anchorHeight) -le 12 -and
        $horizontalGap -ge -4 -and
        $horizontalGap -le 200
}

function Select-SidebarToggleRecord {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Records,
        [AllowEmptyCollection()][object[]]$RelatedRecords = @()
    )

    $eligible = @($Records | Where-Object {
        [bool](Get-ObjectProperty $_ 'IsVisible' $false) -and
        [bool](Get-ObjectProperty $_ 'IsEnabled' $false)
    })
    if ($eligible.Count -eq 0) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'SidebarToggleMissing' -Message 'No eligible SidebarToggle control was found.' -Details ([ordered]@{ candidateCount = 0 })
    }
    $relatedEligible = @($RelatedRecords | Where-Object {
        [bool](Get-ObjectProperty $_ 'IsVisible' $false) -and
        [bool](Get-ObjectProperty $_ 'IsEnabled' $false)
    })
    if ($relatedEligible.Count -eq 0) {
        if ($eligible.Count -eq 1) {
            return $eligible[0]
        }
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'SidebarToggleAmbiguous' -Message 'The closed panel did not expose ExpandPanel and its SidebarToggle was not unique.' -Details ([ordered]@{ candidateCount = $eligible.Count; relatedCandidateCount = 0; relationCount = 0 })
    }
    $pairs = @()
    foreach ($sidebarRecord in $eligible) {
        foreach ($relatedRecord in $relatedEligible) {
            if (Test-PanelControlRelation -Record $relatedRecord -AnchorRecord $sidebarRecord) {
                $pairs += [pscustomobject]@{ Sidebar = $sidebarRecord; Related = $relatedRecord }
            }
        }
    }
    if ($pairs.Count -eq 1) {
        return $pairs[0].Sidebar
    }
    Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'SidebarToggleAmbiguous' -Message 'The sidebar toggle was not uniquely proved by its structural relation to ExpandPanel.' -Details ([ordered]@{ candidateCount = $eligible.Count; relatedCandidateCount = $relatedEligible.Count; relationCount = $pairs.Count })
}

function Select-RelatedPanelControlRecord {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Records,
        [Parameter(Mandatory = $true)]$AnchorRecord,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $eligible = @($Records | Where-Object {
        [bool](Get-ObjectProperty $_ 'IsVisible' $false) -and
        [bool](Get-ObjectProperty $_ 'IsEnabled' $false)
    })
    if ($eligible.Count -eq 0) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category ($Label + 'Missing') -Message ('No eligible ' + $Label + ' control was found.') -Details ([ordered]@{ candidateCount = 0 })
    }
    $related = @($eligible | Where-Object {
        Test-PanelControlRelation -Record $_ -AnchorRecord $AnchorRecord
    })
    if ($related.Count -eq 1) {
        return $related[0]
    }
    Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category ($Label + 'Ambiguous') -Message ('The eligible ' + $Label + ' controls were not uniquely related to the selected sidebar toggle.') -Details ([ordered]@{ candidateCount = $eligible.Count; relatedCandidateCount = $related.Count })
}

function Select-CanonicalAddressRecords {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Records)

    $visible = @($Records | Where-Object { [bool](Get-ObjectProperty $_ 'IsVisible' $false) })
    if ($visible.Count -le 1) {
        return $visible
    }

    $canonical = @($visible | Where-Object { [bool](Get-ObjectProperty $_ 'CanonicalUrlMatch' $false) })
    if ($canonical.Count -eq 1) {
        return @($canonical[0])
    }
    if ($canonical.Count -gt 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.DocumentSelection -Category 'AddressControlAmbiguous' -Message 'Multiple visible address controls expose a canonical ChatGPT URL.' -Details ([ordered]@{ candidateCount = $canonical.Count })
    }
    return $visible
}

function Invoke-LiveBoundedTreeWalk {
    param(
        [Parameter(Mandatory = $true)]$Root,
        [Parameter(Mandatory = $true)]$Walker,
        [Parameter(Mandatory = $true)][scriptblock]$Condition,
        [Parameter(Mandatory = $true)]$Scope,
        [Parameter(Mandatory = $true)][ValidateSet('RawView', 'TopLevelWindow')][string]$Kind,
        [int]$MaximumVisitedElements = 10000,
        [int]$TimeoutMilliseconds = 5000,
        [scriptblock]$UtcNowProvider = $null
    )

    if ($MaximumVisitedElements -lt 1 -or $TimeoutMilliseconds -lt 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'TraversalBoundsInvalid' -Message 'UIA traversal bounds must be positive.'
    }
    if ($null -eq $UtcNowProvider) {
        $UtcNowProvider = { [DateTime]::UtcNow }
    }

    if ($Kind -eq 'RawView') {
        $exitCode = $Script:ExitCodes.ControlSelection
        $limitCategory = 'RawViewElementLimitExceeded'
        $timeoutCategory = 'RawViewTraversalTimeout'
        $unavailableCategory = 'TransientUiRerender'
    }
    else {
        $exitCode = $Script:ExitCodes.WindowSelection
        $limitCategory = 'TopLevelWindowLimitExceeded'
        $timeoutCategory = 'TopLevelWindowTraversalTimeout'
        $unavailableCategory = 'TopLevelWindowEnumerationFailed'
    }

    $deadline = ([DateTime](& $UtcNowProvider)).AddMilliseconds($TimeoutMilliseconds)
    $assertWithinDeadline = {
        if ([DateTime](& $UtcNowProvider) -ge $deadline) {
            Throw-SidebarError -ExitCode $exitCode -Category $timeoutCategory -Message 'The bounded UIA traversal exceeded its deadline.' -Details ([ordered]@{ timeoutMilliseconds = $TimeoutMilliseconds })
        }
    }
    $results = [System.Collections.Generic.List[object]]::new()
    $pending = [System.Collections.Generic.Stack[object]]::new()
    $visitedElementCount = 0
    $scopeValue = [int]$Scope
    $includeElement = ($scopeValue -band [int][System.Windows.Automation.TreeScope]::Element) -ne 0
    $includeChildren = ($scopeValue -band [int][System.Windows.Automation.TreeScope]::Children) -ne 0
    $includeDescendants = ($scopeValue -band [int][System.Windows.Automation.TreeScope]::Descendants) -ne 0

    try {
        if ($includeElement) {
            $visitedElementCount++
            if ($visitedElementCount -gt $MaximumVisitedElements) {
                Throw-SidebarError -ExitCode $exitCode -Category $limitCategory -Message 'The bounded UIA traversal exceeded its visited-element limit.' -Details ([ordered]@{ visitedElementCount = $visitedElementCount; maximumVisitedElements = $MaximumVisitedElements })
            }
            if (& $Condition $Root) {
                $null = $results.Add($Root)
            }
        }

        if ($includeChildren -or $includeDescendants) {
            & $assertWithinDeadline
            $firstChild = $Walker.GetFirstChild($Root)
            & $assertWithinDeadline
            if ($null -ne $firstChild) {
                $pending.Push($firstChild)
            }
        }

        while ($pending.Count -gt 0) {
            & $assertWithinDeadline
            $element = $pending.Pop()
            $visitedElementCount++
            if ($visitedElementCount -gt $MaximumVisitedElements) {
                Throw-SidebarError -ExitCode $exitCode -Category $limitCategory -Message 'The bounded UIA traversal exceeded its visited-element limit.' -Details ([ordered]@{ visitedElementCount = $visitedElementCount; maximumVisitedElements = $MaximumVisitedElements })
            }

            if (& $Condition $element) {
                $null = $results.Add($element)
            }

            & $assertWithinDeadline
            $nextSibling = $Walker.GetNextSibling($element)
            & $assertWithinDeadline
            if ($null -ne $nextSibling) {
                $pending.Push($nextSibling)
            }

            if ($includeDescendants) {
                & $assertWithinDeadline
                $firstChild = $Walker.GetFirstChild($element)
                & $assertWithinDeadline
                if ($null -ne $firstChild) {
                    $pending.Push($firstChild)
                }
            }
        }
    }
    catch [System.Windows.Automation.ElementNotAvailableException] {
        Throw-SidebarError -ExitCode $exitCode -Category $unavailableCategory -Message 'A UIA element became unavailable during bounded traversal.' -Details ([ordered]@{ transient = ($Kind -eq 'RawView') })
    }
    return $results.ToArray()
}

function Find-LiveRawElementsByCondition {
    param(
        [Parameter(Mandatory = $true)]$Root,
        [Parameter(Mandatory = $true)][scriptblock]$Condition,
        $Scope = $null,
        $Walker = $null,
        [int]$MaximumVisitedElements = 10000,
        [int]$TimeoutMilliseconds = 5000,
        [scriptblock]$UtcNowProvider = $null
    )

    if ($null -eq $Scope) {
        $Scope = [System.Windows.Automation.TreeScope]::Descendants
    }
    if ($null -eq $Walker) {
        $Walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    }

    $rootKey = [System.Runtime.CompilerServices.RuntimeHelpers]::GetHashCode($Root)
    $walkerKey = [System.Runtime.CompilerServices.RuntimeHelpers]::GetHashCode($Walker)
    $cacheKey = '{0}:{1}:{2}' -f $rootKey, $walkerKey, [int]$Scope
    $entry = Get-ObjectProperty $Script:RawTraversalCache $cacheKey $null
    $rawElements = @()
    if ($null -ne $entry -and
        [object]::ReferenceEquals((Get-ObjectProperty $entry 'Root' $null), $Root) -and
        [object]::ReferenceEquals((Get-ObjectProperty $entry 'Walker' $null), $Walker)) {
        $rawElements = @((Get-ObjectProperty $entry 'Elements' @()))
    }
    else {
        $rawElements = @(Invoke-LiveBoundedTreeWalk `
            -Root $Root `
            -Walker $Walker `
            -Condition { param($element) $true } `
            -Scope $Scope `
            -Kind 'RawView' `
            -MaximumVisitedElements $MaximumVisitedElements `
            -TimeoutMilliseconds $TimeoutMilliseconds `
            -UtcNowProvider $UtcNowProvider)
        $Script:RawTraversalCache[$cacheKey] = [pscustomobject]@{
            Root = $Root
            Walker = $Walker
            Elements = $rawElements
        }
    }

    if ($rawElements.Count -gt $MaximumVisitedElements) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'RawViewElementLimitExceeded' -Message 'The cached UIA traversal exceeds the requested visited-element limit.' -Details ([ordered]@{ visitedElementCount = $rawElements.Count; maximumVisitedElements = $MaximumVisitedElements })
    }

    $matches = [System.Collections.Generic.List[object]]::new()
    try {
        foreach ($element in $rawElements) {
            if (& $Condition $element) {
                $null = $matches.Add($element)
            }
        }
    }
    catch [System.Windows.Automation.ElementNotAvailableException] {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'TransientUiRerender' -Message 'The UI rerendered while cached Raw View controls were being filtered.' -Details ([ordered]@{ transient = $true })
    }
    return $matches.ToArray()
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

    if ($ControlTypes.Count -eq 0 -or $Names.Count -eq 0) {
        return @()
    }

    $targetControlTypes = @($ControlTypes)
    $targetNames = @($Names)
    $condition = {
        param($element)
        return $targetControlTypes -contains $element.Current.ControlType -and
            $targetNames -ccontains [string]$element.Current.Name
    }
    $collection = Find-LiveRawElementsByCondition -Root $Root -Condition $condition -Scope $Scope

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

    if ($ControlTypes.Count -eq 0) {
        return @()
    }

    $targetControlTypes = @($ControlTypes)
    $condition = {
        param($element)
        return $targetControlTypes -contains $element.Current.ControlType
    }
    $collection = Find-LiveRawElementsByCondition -Root $Root -Condition $condition -Scope $Scope
    $records = @()
    foreach ($element in $collection) {
        $record = ConvertTo-LiveRecord -Element $element
        if ($null -ne $record) {
            $records += $record
        }
    }
    return $records
}

function Find-LiveTopLevelElementsByProcessId {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][int[]]$ProcessIds,
        $Root = $null,
        $Walker = $null,
        [int]$MaximumVisitedElements = 512,
        [int]$TimeoutMilliseconds = 5000,
        [scriptblock]$UtcNowProvider = $null
    )

    $processIdSet = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($processId in $ProcessIds) {
        $null = $processIdSet.Add([int]$processId)
    }
    if ($processIdSet.Count -eq 0) {
        return @()
    }

    if ($null -eq $Root) {
        $Root = [System.Windows.Automation.AutomationElement]::RootElement
    }
    if ($null -eq $Walker) {
        # ponytail: raw direct children are the real desktop windows; a filtered walker can flatten matching descendants and block in a deep provider search.
        $Walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    }

    $condition = {
        param($element)
        return $processIdSet.Contains([int]$element.Current.ProcessId)
    }
    return Invoke-LiveBoundedTreeWalk `
        -Root $Root `
        -Walker $Walker `
        -Condition $condition `
        -Scope ([System.Windows.Automation.TreeScope]::Children) `
        -Kind 'TopLevelWindow' `
        -MaximumVisitedElements $MaximumVisitedElements `
        -TimeoutMilliseconds $TimeoutMilliseconds `
        -UtcNowProvider $UtcNowProvider
}

function Get-LiveCodexWindow {
    # Any new top-level resolution starts a fresh immutable read snapshot.
    $Script:RawTraversalCache = @{}
    try {
        # ponytail: process IDs only prune raw top-level candidates; descendant Codex-document proof remains authoritative.
        $processIds = @(Get-Process -ErrorAction Stop | Where-Object {
            $Script:Names.CodexWindow -contains $_.ProcessName
        } | ForEach-Object { [int]$_.Id } | Select-Object -Unique)
    }
    catch {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'TopLevelWindowEnumerationFailed' -Message 'Codex candidate process IDs could not be enumerated.'
    }

    if ($processIds.Count -gt 512) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'TopLevelWindowLimitExceeded' -Message 'The Codex candidate process count exceeds the bounded discovery limit.' -Details ([ordered]@{ candidateProcessCount = $processIds.Count })
    }

    try {
        $topLevelElements = @(Find-LiveTopLevelElementsByProcessId -ProcessIds $processIds)
    }
    catch {
        $category = Get-ExceptionCategory -Exception $_.Exception
        if ($category -in @('TopLevelWindowLimitExceeded', 'TopLevelWindowTraversalTimeout', 'TopLevelWindowEnumerationFailed')) {
            throw
        }
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'TopLevelWindowEnumerationFailed' -Message 'Codex top-level UIA windows could not be enumerated.'
    }

    $records = @()
    foreach ($element in $topLevelElements) {
        try {
            $record = ConvertTo-LiveRecord -Element $element
            if ($null -eq $record -or -not $record.IsVisible) {
                continue
            }
            if ($Script:Names.CodexWindow -notcontains $record.Name) {
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
            $category = Get-ExceptionCategory -Exception $_.Exception
            if ($category -eq 'TransientUiRerender') {
                continue
            }
            if ($category -in @('RawViewElementLimitExceeded', 'RawViewTraversalTimeout')) {
                throw
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

    $records = @(Find-LiveElementsByNames -Root $WindowElement -ControlTypes @([System.Windows.Automation.ControlType]::Edit) -Names $Script:Names.Address | Where-Object { $_.IsVisible })
    foreach ($record in $records) {
        $valueObject = $null
        $canonicalUrlMatch = $false
        if ($record.Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valueObject)) {
            $canonicalUrlMatch = $null -ne (ConvertTo-SanitizedChatGptUrl -Candidate ([string]$valueObject.Current.Value))
        }
        $record | Add-Member -NotePropertyName CanonicalUrlMatch -NotePropertyValue $canonicalUrlMatch -Force
    }
    return @(Select-CanonicalAddressRecords -Records $records)
}

function Test-DocumentGeometryMatch {
    param(
        [Parameter(Mandatory = $true)]$DocumentRecord,
        [Parameter(Mandatory = $true)]$AddressRecord
    )

    foreach ($value in @(
        $DocumentRecord.X,
        $DocumentRecord.Y,
        $DocumentRecord.Width,
        $AddressRecord.X,
        $AddressRecord.Y,
        $AddressRecord.Width,
        $AddressRecord.Height
    )) {
        $number = [double]$value
        if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) {
            return $false
        }
    }

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
        $canonicalUrlMatch = $false
        $valueObject = $null
        if ($document.Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valueObject)) {
            $canonicalUrlMatch = $null -ne (ConvertTo-SanitizedChatGptUrl -Candidate ([string]$valueObject.Current.Value))
        }
        $geometryMatch = $false
        if ($AddressRecords.Count -eq 1) {
            $geometryMatch = Test-DocumentGeometryMatch -DocumentRecord $document -AddressRecord $AddressRecords[0]
        }

        $records += [pscustomobject]@{
            Element = $document.Element
            IsVisible = $document.IsVisible
            ComposerCount = @($composerRecords | Where-Object { $_.IsVisible -and $_.IsEnabled }).Count
            CanonicalUrlMatch = $canonicalUrlMatch
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

function Invoke-LiveBrowserPanelAndWaitForAddress {
    param(
        [Parameter(Mandatory = $true)]$BrowserRecord,
        [Parameter(Mandatory = $true)]$WindowElement
    )

    Invoke-PanelControlPreservingFocus -Record $BrowserRecord -Mode 'select' -WindowElement $WindowElement
    $deadline = [DateTime]::UtcNow.AddSeconds(4)
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 300
        $window = Get-LiveCodexWindow
        $addressRecords = @(Get-LiveAddressRecords -WindowElement $window.Element)
        if ($addressRecords.Count -eq 1) {
            return $true
        }
    }
    return $false
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

    $visibleBrowserRecords = @(Find-LiveElementsByNames -Root $window.Element -ControlTypes @([System.Windows.Automation.ControlType]::Button) -Names $Script:Names.BrowserPanel | Where-Object { $_.IsVisible -and $_.IsEnabled })
    if ($visibleBrowserRecords.Count -gt 0) {
        $visibleBrowser = Select-UniqueControlRecord -Records $visibleBrowserRecords -Label 'BrowserPanel'
        if (Invoke-LiveBrowserPanelAndWaitForAddress -BrowserRecord $visibleBrowser -WindowElement $window.Element) {
            return $true
        }
    }

    $sidebarRecords = @(Find-LiveElementsByNames -Root $window.Element -ControlTypes @([System.Windows.Automation.ControlType]::Button) -Names $Script:Names.SidebarToggle | Where-Object { $_.IsVisible -and $_.IsEnabled })
    $expandRecords = @(Find-LiveElementsByNames -Root $window.Element -ControlTypes @([System.Windows.Automation.ControlType]::Button) -Names $Script:Names.ExpandPanel | Where-Object { $_.IsVisible -and $_.IsEnabled })
    $sidebar = Select-SidebarToggleRecord -Records $sidebarRecords -RelatedRecords $expandRecords
    Invoke-PanelControlPreservingFocus -Record $sidebar -Mode 'toggle-on' -WindowElement $window.Element
    Start-Sleep -Milliseconds 250

    $window = Get-LiveCodexWindow
    $addressRecords = @(Get-LiveAddressRecords -WindowElement $window.Element)
    if ($addressRecords.Count -eq 1) {
        return $true
    }

    $sidebarRecords = @(Find-LiveElementsByNames -Root $window.Element -ControlTypes @([System.Windows.Automation.ControlType]::Button) -Names $Script:Names.SidebarToggle | Where-Object { $_.IsVisible -and $_.IsEnabled })
    $expandRecords = @(Find-LiveElementsByNames -Root $window.Element -ControlTypes @([System.Windows.Automation.ControlType]::Button) -Names $Script:Names.ExpandPanel | Where-Object { $_.IsVisible -and $_.IsEnabled })
    if ($expandRecords.Count -gt 0) {
        $sidebar = Select-SidebarToggleRecord -Records $sidebarRecords -RelatedRecords $expandRecords
        $expand = Select-RelatedPanelControlRecord -Records $expandRecords -AnchorRecord $sidebar -Label 'ExpandPanel'
        Invoke-PanelControlPreservingFocus -Record $expand -Mode 'select' -WindowElement $window.Element
        Start-Sleep -Milliseconds 250
        $window = Get-LiveCodexWindow
    }

    $browserRecords = @(Find-LiveElementsByNames -Root $window.Element -ControlTypes @([System.Windows.Automation.ControlType]::Button) -Names $Script:Names.BrowserPanel | Where-Object { $_.IsVisible -and $_.IsEnabled })
    $browser = Select-UniqueControlRecord -Records $browserRecords -Label 'BrowserPanel'
    if (Invoke-LiveBrowserPanelAndWaitForAddress -BrowserRecord $browser -WindowElement $window.Element) {
        return $true
    }

    Throw-SidebarError -ExitCode $Script:ExitCodes.DocumentSelection -Category 'BrowserPanelUnavailable' -Message 'The browser side panel did not expose one address control after bounded recovery.'
}

function Resolve-LiveContext {
    param([switch]$RecoverPanel)

    $panelRecovered = $false
    $window = Get-LiveCodexWindow
    $window = Set-LiveOperationWindowBinding -WindowRecord $window
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

    $candidates = @()
    $candidates += Read-LiveElementText -Element $Context.Address.Element
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
        [Parameter(Mandatory = $true)][string]$Value,
        [switch]$FocusComposer
    )

    if ($FocusComposer) {
        $ComposerRecord.Element.SetFocus()
    }
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
        [int]$TimeoutSecondsValue = 15
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
            $category = Get-ExceptionCategory -Exception $_.Exception
            if (-not (Test-TransientUiCategory -Category $category) -and $category -ne 'RawViewTraversalTimeout') {
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

    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
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

function Get-LiveFreshConversationUrlState {
    param(
        [Parameter(Mandatory = $true)]$Context,
        [Parameter(Mandatory = $true)]$AuthSnapshot,
        $UrlState = $null
    )

    $responses = @(Get-LiveResponseRecords -Context $Context)
    $composer = Select-UniqueControlRecord -Records $AuthSnapshot.ComposerRecords -Label 'Composer'
    $composerValue = Read-LiveElementText -Element $composer.Element
    if ($responses.Count -ne 0 -or -not (Test-ComposerValueEmpty -Value $composerValue)) {
        return $null
    }
    if ($null -eq $UrlState) {
        $UrlState = Get-LiveUrlState -Context $Context
    }
    Assert-ChatGptUrlState -UrlState $UrlState -RequireFreshConversation
    return $UrlState
}

function Invoke-LiveNewChat {
    param(
        [switch]$RecoverPanel,
        [int]$PreActionTimeoutSecondsValue = 15
    )

    $preActionDeadline = [DateTime]::UtcNow.AddSeconds($PreActionTimeoutSecondsValue)
    while ($true) {
        try {
            $context = Resolve-LiveContext -RecoverPanel:$RecoverPanel
            $auth = Get-LiveAuthSnapshot -Context $context
            Assert-AuthReadySnapshot -Snapshot $auth
            $initialUrlState = Get-LiveUrlState -Context $context
            Assert-ChatGptUrlState -UrlState $initialUrlState
            $generation = Get-LiveGenerationState -Context $context
            if ($generation.Generating) {
                Throw-SidebarError -ExitCode $Script:ExitCodes.GenerationActive -Category 'GenerationAlreadyActive' -Message 'Cannot start a new chat while ChatGPT is generating.'
            }

            $alreadyFreshUrlState = Get-LiveFreshConversationUrlState -Context $context -AuthSnapshot $auth -UrlState $initialUrlState
            if ($null -ne $alreadyFreshUrlState) {
                return [ordered]@{
                    ok = $true
                    command = 'new-chat'
                    live = $true
                    conversationReset = $false
                    url = $alreadyFreshUrlState.Url
                    urlExact = $alreadyFreshUrlState.Exact
                    clipboardUsed = $false
                }
            }

            $newChatRecords = @(Find-LiveElementsByNames -Root $context.Document.Element -ControlTypes @([System.Windows.Automation.ControlType]::Button, [System.Windows.Automation.ControlType]::Hyperlink) -Names $Script:Names.NewChat)
            $newChat = Select-NewChatRecord -Records $newChatRecords
            Assert-LiveInvokePatternAvailable -Record $newChat -Label 'NewChat'
            break
        }
        catch {
            $category = Get-ExceptionCategory -Exception $_.Exception
            if (-not (Test-TransientUiCategory -Category $category) -and $category -ne 'RawViewTraversalTimeout') {
                throw
            }
            if ([DateTime]::UtcNow -ge $preActionDeadline) {
                throw
            }
        }

        Start-Sleep -Milliseconds 150
    }

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

    # ponytail: the current panel can expose its fresh root after the former six-second proof window.
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 300
        try {
            $freshContext = Resolve-LiveContext -RecoverPanel:$RecoverPanel
            $freshAuth = Get-LiveAuthSnapshot -Context $freshContext
            Assert-AuthReadySnapshot -Snapshot $freshAuth
            $freshUrlState = Get-LiveFreshConversationUrlState -Context $freshContext -AuthSnapshot $freshAuth
            if ($null -ne $freshUrlState) {
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
            $category = Get-ExceptionCategory -Exception $_.Exception
            if ((Test-TransientUiCategory -Category $category) -or $category -eq 'RawViewTraversalTimeout') {
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
        [AllowEmptyString()][string]$WindowRuntimeIdValue = '',
        [ValidateSet('windows-uia', 'agent-browser-cli-v2')][string]$Transport = 'windows-uia',
        $TargetBinding = $null,
        [AllowEmptyString()][string]$CodexThreadIdValue = '',
        [AllowEmptyString()][string]$TargetClaimKeySha256 = ''
    )

    $intentAtUtc = [DateTime]::UtcNow.ToString('o')
    $conversationUrlBoundAtUtc = ''
    if (-not [string]::IsNullOrWhiteSpace($ConversationUrlBeforeSend)) {
        $conversationUrlBoundAtUtc = $intentAtUtc
    }

    $state = [ordered]@{
        schemaVersion = $Script:SchemaVersion
        tool = $Script:ToolName
        transport = $Transport
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
        conversationUrlBindingPending = [string]::IsNullOrWhiteSpace($ConversationUrlBeforeSend)
        intentAtUtc = $intentAtUtc
        requestStartedAtUtc = $intentAtUtc
        firstClickAtUtc = ''
        responseDeadlineAtUtc = ''
        attemptCount = 0
        attempts = @()
        retryOutcome = ''
        automaticResendAllowed = $false
        clipboardUsed = $false
    }
    if ($Transport -eq $Script:AgentBrowserTransport) {
        $threadId = Resolve-CodexThreadId -Value $CodexThreadIdValue
        $null = Assert-AgentBrowserTargetBindingComplete -Binding $TargetBinding
        $null = $state.Remove('windowRuntimeId')
        $state['codexThreadId'] = $threadId
        $state['targetBinding'] = $TargetBinding
        $state['targetClaimKeySha256'] = $TargetClaimKeySha256
        $state['extractorVersion'] = $Script:AgentBrowserExtractorVersion
    }
    return $state
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
    Set-LiveComposerValue -ComposerRecord $composer -Value $PromptText -FocusComposer:$Script:AllowComposerFocus
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

        if ([string]::IsNullOrWhiteSpace($boundConversationUrl) -and -not $RequireFreshConversation) {
            Set-SendUncertainState -EvidenceDirectory $EvidenceDirectory -State $state -Reason 'post-send-url-capture-timeout' -InvokeReturned:$true
            Throw-SidebarError -ExitCode $Script:ExitCodes.UrlCapture -Category 'ExactConversationUrlUnavailableAfterSend' -Message 'The prompt was submitted once, but the exact conversation URL could not be durably bound. Automatic waiting and resubmission are prohibited.'
        }
        if ([string]::IsNullOrWhiteSpace($boundConversationUrl)) {
            Set-ObjectProperty -InputObject $state -Name 'conversationUrlBindingPending' -Value $true
        }
        else {
            Set-ObjectProperty -InputObject $state -Name 'conversationUrlBound' -Value $boundConversationUrl
            Set-ObjectProperty -InputObject $state -Name 'conversationUrlBoundAtUtc' -Value ([DateTime]::UtcNow.ToString('o'))
            Set-ObjectProperty -InputObject $state -Name 'conversationUrlBindingPending' -Value $false
            # Persist the exact URL while the phase is still send-intent. A crash
            # after this write can be observed safely without guessing a chat.
            Write-EvidenceState -Directory $EvidenceDirectory -State $state
        }
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
        conversationUrlExact = -not [string]::IsNullOrWhiteSpace($boundConversationUrl)
        conversationUrlBindingPending = [bool](Get-ObjectProperty $state 'conversationUrlBindingPending' $false)
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
        [int]$StablePollCount = 0,
        [AllowEmptyString()][string]$CodexThreadIdValue = ''
    )

    $phaseBeforeCompletion = [string](Get-ObjectProperty $State 'phase' '')
    if (-not [string]::IsNullOrWhiteSpace($CodexThreadIdValue)) {
        $null = Assert-StateCodexThreadId -State $State -ExpectedCodexThreadId $CodexThreadIdValue
    }
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
    $responseBytes = [System.IO.File]::ReadAllBytes($responsePath).LongLength
    $urlSha = Get-Sha256File -Path $urlPath
    $completedAt = [DateTime]::UtcNow.ToString('o')
    $submissionAcknowledged = [bool](Get-ObjectProperty $State 'submissionAcknowledged' ($phaseBeforeCompletion -eq 'sent'))
    $invokeAttempted = [bool](Get-ObjectProperty $State 'invokeAttempted' ($phaseBeforeCompletion -eq 'sent'))
    $invokeReturned = [bool](Get-ObjectProperty $State 'invokeReturned' ($phaseBeforeCompletion -eq 'sent'))
    $transport = [string](Get-ObjectProperty $State 'transport' 'windows-uia')
    if ($transport -eq $Script:AgentBrowserTransport) {
        $extractor = [ordered]@{
            version = [string](Get-ObjectProperty $Response 'ExtractorVersion' (Get-ObjectProperty $State 'extractorVersion' $Script:AgentBrowserExtractorVersion))
            targetBinding = Get-ObjectProperty $State 'targetBinding' $null
            turnKey = [string](Get-ObjectProperty $Response 'TurnRuntimeId' '')
            controlTypeCounts = Get-ObjectProperty $Response 'ControlTypeCounts' ([ordered]@{})
            uiState = 'captured-at-completion'
            stabilityScope = 'same-extractor-same-tab-session'
        }
    }
    else {
        $extractor = [ordered]@{
            version = [string](Get-ObjectProperty $Response 'ExtractorVersion' (Get-ObjectProperty $State 'extractorVersion' $Script:ExtractorVersion))
            windowRuntimeId = [string](Get-ObjectProperty $State 'windowRuntimeId' '')
            turnRuntimeId = [string](Get-ObjectProperty $Response 'TurnRuntimeId' '')
            controlTypeCounts = Get-ObjectProperty $Response 'ControlTypeCounts' ([ordered]@{})
            uiState = 'captured-at-completion'
            stabilityScope = 'same-extractor-same-visible-ui-state'
        }
    }

    $evidence = [ordered]@{
        schemaVersion = $Script:SchemaVersion
        tool = $Script:ToolName
        transport = $transport
        live = $true
        codexThreadId = [string](Get-ObjectProperty $State 'codexThreadId' '')
        targetClaimKeySha256 = [string](Get-ObjectProperty $State 'targetClaimKeySha256' '')
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
            bytes = $responseBytes
        }
        extractor = $extractor
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
        focusRestoreBestEffort = $transport -eq 'windows-uia' -and -not $Script:NoFocusRestore
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
    Set-ObjectProperty -InputObject $State -Name 'responseBytes' -Value $responseBytes
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
        $completedResponse = Get-CompletedResponseResult -EvidenceDirectory $EvidenceDirectory
        return [ordered]@{
            ok = $true
            command = 'wait'
            live = $true
            completed = $true
            reusedCompletedEvidence = $true
            responseSha256 = $completedResponse.responseSha256
            responseBytes = $completedResponse.responseBytes
            conversationUrl = $completedResponse.conversationUrl
            submissionAcknowledged = $completedResponse.submissionAcknowledged
            observationalRecovery = $completedResponse.observationalRecovery
        }
    }

    $waitablePhases = @('sent', 'send-intent', 'send-uncertain')
    if ($waitablePhases -notcontains $phase) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'SendStateNotWaitable' -Message 'wait requires sent or an uncertain pre-completion phase. It never resubmits.' -Details ([ordered]@{ phase = $phase })
    }
    $observationalRecovery = $phase -ne 'sent'
    $stateWindowRuntimeId = [string](Get-ObjectProperty $state 'windowRuntimeId' '')
    if ([string]::IsNullOrWhiteSpace($stateWindowRuntimeId)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'CodexWindowRuntimeIdMissing' -Message 'Incomplete evidence does not contain the immutable Codex window binding required for observation.'
    }
    if (-not (Test-BoundedWindowRuntimeId -Value $stateWindowRuntimeId)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'CodexWindowRuntimeIdInvalid' -Message 'Incomplete evidence contains an invalid Codex window binding.'
    }
    if (-not [string]::IsNullOrWhiteSpace($Script:TargetWindowRuntimeId) -and $Script:TargetWindowRuntimeId -cne $stateWindowRuntimeId) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'CodexWindowBindingMismatch' -Message 'The requested window does not match the window durably bound at send time.'
    }
    $Script:TargetWindowRuntimeId = $stateWindowRuntimeId
    $boundConversationUrl = ''
    try {
        $boundConversationUrl = Get-BoundConversationUrlFromState -State $state
    }
    catch {
        if ((Get-ExceptionCategory -Exception $_.Exception) -ne 'ConversationUrlUnbound' -or
            -not (Test-PendingFreshConversationBinding -State $state)) {
            throw
        }
    }

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
    if ([string]::IsNullOrWhiteSpace($boundConversationUrl)) {
        $boundConversationUrl = [string]$urlState.Url
        Set-ObjectProperty -InputObject $state -Name 'conversationUrlBound' -Value $boundConversationUrl
        Set-ObjectProperty -InputObject $state -Name 'conversationUrlBoundAtUtc' -Value ([DateTime]::UtcNow.ToString('o'))
        Set-ObjectProperty -InputObject $state -Name 'conversationUrlBindingPending' -Value $false
        Write-EvidenceState -Directory $EvidenceDirectory -State $state
    }

    $evidence = Complete-Evidence -EvidenceDirectory $EvidenceDirectory -State $state -Response $result.Response -ConversationUrl $boundConversationUrl -TransientObservationCount $result.TransientObservationCount -StablePollCount $result.StablePollCount
    return [ordered]@{
        ok = $true
        command = 'wait'
        live = $true
        completed = $true
        responseSha256 = $evidence.response.sha256
        evidenceSha256 = [string](Get-ObjectProperty $state 'evidenceSha256' '')
        responseCharacters = $evidence.response.characters
        responseBytes = $evidence.response.bytes
        conversationUrl = $evidence.conversation.url
        submissionAcknowledged = $evidence.submission.acknowledged
        observationalRecovery = $observationalRecovery
        transientObservationCount = $evidence.transientObservationCount
        stablePollCount = $evidence.stablePollCount
        clipboardUsed = $false
    }
}

function Get-CompletedResponseResult {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [AllowEmptyString()][string]$CodexThreadIdValue = ''
    )

    $state = Read-EvidenceState -Directory $EvidenceDirectory
    if ($null -eq $state -or [string](Get-ObjectProperty $state 'phase' '') -ne 'completed') {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'ResponseNotCompleted' -Message 'Run wait successfully before response.'
    }
    if (-not [string]::IsNullOrWhiteSpace($CodexThreadIdValue)) {
        $null = Assert-StateCodexThreadId -State $state -ExpectedCodexThreadId $CodexThreadIdValue
        $null = Assert-AgentBrowserTargetClaimOwnership `
            -CodexThreadIdValue $CodexThreadIdValue `
            -Binding (Get-ObjectProperty $state 'targetBinding' $null) `
            -EvidenceDirectory $EvidenceDirectory
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
    $responseBytes = [System.IO.File]::ReadAllBytes($responsePath).LongLength
    $urlSha = Get-Sha256File -Path $urlPath
    $evidenceSha = Get-Sha256File -Path $evidencePath
    if ($promptSha -ne [string](Get-ObjectProperty $state 'promptSha256' '')) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'PromptEvidenceHashMismatch' -Message 'The prompt evidence hash no longer matches state.json.'
    }
    if ($responseSha -ne [string](Get-ObjectProperty $state 'responseSha256' '')) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'ResponseEvidenceHashMismatch' -Message 'The response evidence hash no longer matches state.json.'
    }
    $recordedStateResponseBytes = Get-ObjectProperty $state 'responseBytes' $null
    if ($null -ne $recordedStateResponseBytes -and $responseBytes -ne [long]$recordedStateResponseBytes) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'ResponseEvidenceByteCountMismatch' -Message 'The response evidence byte count no longer matches state.json.'
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
    $stateThreadId = [string](Get-ObjectProperty $state 'codexThreadId' '')
    $stateTargetClaimKey = [string](Get-ObjectProperty $state 'targetClaimKeySha256' '')
    if ([string](Get-ObjectProperty $evidence 'transport' '') -eq $Script:AgentBrowserTransport -and
        ([string](Get-ObjectProperty $evidence 'codexThreadId' '') -cne $stateThreadId -or
        [string](Get-ObjectProperty $evidence 'targetClaimKeySha256' '') -cne $stateTargetClaimKey)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'CodexThreadMismatch' -Message 'evidence.json does not match the Codex task and target claim bound in state.json.'
    }
    $recordedEvidenceResponseBytes = Get-ObjectProperty $evidenceResponse 'bytes' $null
    $boundConversationUrl = Get-BoundConversationUrlFromState -State $state
    if ([string](Get-ObjectProperty $evidencePrompt 'sha256' '') -ne $promptSha -or
        [string](Get-ObjectProperty $evidenceResponse 'sha256' '') -ne $responseSha -or
        ($null -ne $recordedEvidenceResponseBytes -and [long]$recordedEvidenceResponseBytes -ne $responseBytes) -or
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
        responseBytes = $responseBytes
        evidenceSha256 = $evidenceSha
        conversationUrl = $conversationUrl
        codexThreadId = $stateThreadId
        targetClaimKeySha256 = $stateTargetClaimKey
        idempotencyKey = [string](Get-ObjectProperty $state 'idempotencyKey' '')
        submissionAcknowledged = [bool](Get-ObjectProperty $state 'submissionAcknowledged' $false)
        observationalRecovery = ([string](Get-ObjectProperty $state 'phaseBeforeCompletion' 'sent') -ne 'sent')
        clipboardUsed = $false
    }
}

function ConvertFrom-AgentBrowserCliOutput {
    param(
        [AllowEmptyString()][Parameter(Mandatory = $true)][string]$Stdout,
        [Parameter(Mandatory = $true)][int]$ExitCode,
        [Parameter(Mandatory = $true)][string]$Operation
    )

    if ([string]::IsNullOrWhiteSpace($Stdout)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Unsupported -Category 'AgentBrowserCliOutputMissing' -Message 'agent-browser-cli returned no JSON output.' -Details ([ordered]@{ operation = $Operation; processExitCode = $ExitCode })
    }
    try {
        $envelope = $Stdout | ConvertFrom-Json
    }
    catch {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Unsupported -Category 'AgentBrowserCliJsonInvalid' -Message 'agent-browser-cli stdout was not exactly one JSON document.' -Details ([ordered]@{ operation = $Operation; processExitCode = $ExitCode })
    }
    if ($envelope -is [System.Array] -or $null -eq $envelope -or @($envelope.PSObject.Properties).Count -eq 0) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Unsupported -Category 'AgentBrowserCliJsonInvalid' -Message 'agent-browser-cli stdout must be one JSON object.' -Details ([ordered]@{ operation = $Operation; processExitCode = $ExitCode })
    }

    $ok = [bool](Get-ObjectProperty $envelope 'ok' $false)
    $result = Get-ObjectProperty $envelope 'result' $null
    $status = [string](Get-ObjectProperty $result 'status' '')
    if ($ExitCode -ne 0 -or -not $ok -or $null -eq $result -or $status -ne 'success') {
        $errorCode = [string](Get-ObjectProperty $envelope 'error_code' '')
        Throw-SidebarError -ExitCode $Script:ExitCodes.Unsupported -Category 'AgentBrowserCliFailed' -Message 'agent-browser-cli did not return a successful result.' -Details ([ordered]@{ operation = $Operation; processExitCode = $ExitCode; errorCode = $errorCode })
    }
    return $envelope
}

function ConvertTo-WindowsProcessArgument {
    param([AllowEmptyString()][Parameter(Mandatory = $true)][string]$Value)

    if ($Value -notmatch '[\s"]') {
        return $Value
    }
    $builder = [System.Text.StringBuilder]::new()
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq [char]'\') {
            $backslashes++
            continue
        }
        if ($character -eq [char]'"') {
            [void]$builder.Append([char]'\', (($backslashes * 2) + 1))
            [void]$builder.Append('"')
            $backslashes = 0
            continue
        }
        if ($backslashes -gt 0) {
            [void]$builder.Append([char]'\', $backslashes)
            $backslashes = 0
        }
        [void]$builder.Append($character)
    }
    if ($backslashes -gt 0) {
        [void]$builder.Append([char]'\', ($backslashes * 2))
    }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Resolve-AgentBrowserCliExecutable {
    $commandInfo = Get-Command $Script:AgentBrowserCliCommand -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $commandInfo) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Unsupported -Category 'AgentBrowserCliMissing' -Message 'agent-browser-cli is not installed or not available on PATH.'
    }
    if ([System.IO.Path]::GetExtension($commandInfo.Source) -ieq '.exe') {
        return $commandInfo.Source
    }

    $packageRoot = Join-Path (Split-Path -Parent $commandInfo.Source) 'node_modules\@sleepinsummer\agent-browser-cli'
    if (-not [System.IO.Directory]::Exists($packageRoot)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Unsupported -Category 'AgentBrowserCliExecutableMissing' -Message 'The installed agent-browser-cli package has no native executable root.'
    }
    $executables = @(Get-ChildItem -LiteralPath $packageRoot -Filter 'agent-browser-cli.exe' -File -Recurse -ErrorAction Stop)
    if ($executables.Count -ne 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Unsupported -Category 'AgentBrowserCliExecutableAmbiguous' -Message 'The installed agent-browser-cli package did not expose exactly one native executable.' -Details ([ordered]@{ candidateCount = $executables.Count })
    }
    return $executables[0].FullName
}

function Invoke-AgentBrowserCliJson {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $executable = Resolve-AgentBrowserCliExecutable
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $executable
    $startInfo.Arguments = @($Arguments | ForEach-Object { ConvertTo-WindowsProcessArgument -Value ([string]$_) }) -join ' '
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $stdoutLines = [System.Collections.Generic.List[string]]::new()
    $processExitCode = -1
    try {
        if (-not $process.Start()) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.Unsupported -Category 'AgentBrowserCliLaunchFailed' -Message 'agent-browser-cli could not be started.'
        }
        $stderrDrain = $process.StandardError.ReadToEndAsync()
        $deadline = [DateTime]::UtcNow.AddSeconds(45)
        $pendingLine = $null
        while ([DateTime]::UtcNow -lt $deadline) {
            if ($null -eq $pendingLine) {
                $pendingLine = $process.StandardOutput.ReadLineAsync()
            }
            if ($pendingLine.Wait(100)) {
                $line = $pendingLine.Result
                $pendingLine = $null
                if ($null -ne $line) {
                    $stdoutLines.Add([string]$line)
                    continue
                }
            }
            if ($process.HasExited) {
                if ($null -ne $pendingLine -and $pendingLine.Wait(200) -and $null -ne $pendingLine.Result) {
                    $stdoutLines.Add([string]$pendingLine.Result)
                    $pendingLine = $null
                    continue
                }
                break
            }
        }
        if (-not $process.HasExited) {
            try { & taskkill.exe /PID $process.Id /T /F 2>&1 | Out-Null } catch { }
            Throw-SidebarError -ExitCode $Script:ExitCodes.Timeout -Category 'AgentBrowserCliTimeout' -Message 'agent-browser-cli did not exit within the bounded process timeout.' -Details ([ordered]@{ operation = [string]$Arguments[0] })
        }
        $processExitCode = [int]$process.ExitCode
    }
    catch {
        if ($_.Exception.Data.Contains('SidebarExitCode')) {
            throw
        }
        Throw-SidebarError -ExitCode $Script:ExitCodes.Unsupported -Category 'AgentBrowserCliLaunchFailed' -Message 'agent-browser-cli could not be started.'
    }
    finally {
        if ($null -ne $process) {
            try { $process.StandardOutput.Dispose() } catch { }
            try { $process.StandardError.Dispose() } catch { }
            $process.Dispose()
        }
    }

    $stdout = $stdoutLines -join "`n"
    return ConvertFrom-AgentBrowserCliOutput -Stdout $stdout -ExitCode $processExitCode -Operation ([string]$Arguments[0])
}

function Test-BoundedAgentBrowserIdentity {
    param([AllowEmptyString()][string]$Value, [switch]$AllowEmpty)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return [bool]$AllowEmpty
    }
    return $Value.Length -le 512 -and $Value -notmatch '[\r\n]'
}

function ConvertTo-AgentBrowserTabRecords {
    param([Parameter(Mandatory = $true)]$Envelope)

    $metadata = Get-ObjectProperty (Get-ObjectProperty $Envelope 'result' $null) 'metadata' $null
    $tabs = @((Get-ObjectProperty $metadata 'tabs' @()))
    if ($tabs.Count -gt 1000) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'AgentBrowserTabLimitExceeded' -Message 'agent-browser-cli returned more than 1,000 tabs.'
    }

    $records = @()
    foreach ($tab in $tabs) {
        $browserValue = [string](Get-ObjectProperty $tab 'browser_id' '')
        $profileValue = [string](Get-ObjectProperty $tab 'profile_id' '')
        $profileLabel = [string](Get-ObjectProperty $tab 'profile_label' '')
        $tabValue = [string](Get-ObjectProperty $tab 'tab_id' '')
        $sessionValue = [string](Get-ObjectProperty $tab 'session_key' '')
        if (-not (Test-BoundedAgentBrowserIdentity -Value $browserValue) -or
            -not (Test-BoundedAgentBrowserIdentity -Value $profileValue) -or
            -not (Test-BoundedAgentBrowserIdentity -Value $profileLabel -AllowEmpty) -or
            -not (Test-BoundedAgentBrowserIdentity -Value $tabValue) -or
            -not (Test-BoundedAgentBrowserIdentity -Value $sessionValue)) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'AgentBrowserTabIdentityInvalid' -Message 'A browser tab has an invalid or unbounded identity.'
        }
        $canonical = ConvertTo-SanitizedChatGptUrl -Candidate ([string](Get-ObjectProperty $tab 'url' ''))
        if ($null -eq $canonical -or -not $canonical.AllowedForChat) {
            continue
        }
        $records += [pscustomobject]@{
            BrowserId = $browserValue
            ProfileId = $profileValue
            ProfileLabel = $profileLabel
            TabId = $tabValue
            SessionKey = $sessionValue
            Origin = 'https://chatgpt.com'
            Url = [string]$canonical.Url
            UrlExact = [bool]$canonical.Exact
        }
    }
    return $records
}

function ConvertFrom-AgentBrowserProfileTree {
    param(
        [Parameter(Mandatory = $true)]$Envelope,
        [Parameter(Mandatory = $true)][string]$ProfileId
    )

    $result = Get-ObjectProperty $Envelope 'result' $null
    $flatTabs = [System.Collections.Generic.List[object]]::new()
    foreach ($browser in @((Get-ObjectProperty $result 'browsers' @()))) {
        $browserId = [string](Get-ObjectProperty $browser 'browser_id' '')
        foreach ($profileRecord in @((Get-ObjectProperty $browser 'profiles' @()))) {
            $currentProfileId = [string](Get-ObjectProperty $profileRecord 'profile_id' '')
            if ($currentProfileId -cne $ProfileId) {
                continue
            }
            $profileLabel = [string](Get-ObjectProperty $profileRecord 'profile_label' '')
            foreach ($tab in @((Get-ObjectProperty $profileRecord 'tabs' @()))) {
                if ($flatTabs.Count -ge 1000) {
                    Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'AgentBrowserTabLimitExceeded' -Message 'agent-browser-cli returned more than 1,000 tabs.'
                }
                $flatTabs.Add([pscustomobject]@{
                    browser_id = $browserId
                    profile_id = $currentProfileId
                    profile_label = $profileLabel
                    tab_id = [string](Get-ObjectProperty $tab 'tab_id' '')
                    session_key = [string](Get-ObjectProperty $tab 'session_key' '')
                    url = [string](Get-ObjectProperty $tab 'url' '')
                })
            }
        }
    }

    $syntheticEnvelope = [pscustomobject]@{
        result = [pscustomobject]@{
            metadata = [pscustomobject]@{ tabs = @($flatTabs) }
        }
    }
    return [pscustomobject]@{
        BrowserIds = @($flatTabs | ForEach-Object { [string]$_.browser_id } | Sort-Object -Unique)
        ChatGptTargets = @(ConvertTo-AgentBrowserTabRecords -Envelope $syntheticEnvelope)
    }
}

function ConvertTo-AgentBrowserTargetBinding {
    param([Parameter(Mandatory = $true)]$Target)

    return [ordered]@{
        browserId = [string](Get-ObjectProperty $Target 'BrowserId' '')
        profileId = [string](Get-ObjectProperty $Target 'ProfileId' '')
        profileLabel = [string](Get-ObjectProperty $Target 'ProfileLabel' '')
        tabId = [string](Get-ObjectProperty $Target 'TabId' '')
        sessionKey = [string](Get-ObjectProperty $Target 'SessionKey' '')
        origin = 'https://chatgpt.com'
        url = [string](Get-ObjectProperty $Target 'Url' '')
    }
}

function Test-AgentBrowserTargetMatchesBinding {
    param(
        [Parameter(Mandatory = $true)]$Target,
        [Parameter(Mandatory = $true)]$Binding
    )

    $expectedLabel = [string](Get-ObjectProperty $Binding 'profileLabel' '')
    return (
        [string](Get-ObjectProperty $Target 'BrowserId' '') -ceq [string](Get-ObjectProperty $Binding 'browserId' '') -and
        [string](Get-ObjectProperty $Target 'ProfileId' '') -ceq [string](Get-ObjectProperty $Binding 'profileId' '') -and
        [string](Get-ObjectProperty $Target 'TabId' '') -ceq [string](Get-ObjectProperty $Binding 'tabId' '') -and
        [string](Get-ObjectProperty $Target 'SessionKey' '') -ceq [string](Get-ObjectProperty $Binding 'sessionKey' '') -and
        ([string]::IsNullOrWhiteSpace($expectedLabel) -or [string](Get-ObjectProperty $Target 'ProfileLabel' '') -ceq $expectedLabel)
    )
}

function Resolve-AgentBrowserTarget {
    param(
        $ExpectedBinding = $null,
        [AllowEmptyString()][string]$ExpectedConversationUrl = '',
        [switch]$AllowExactUrlReopen
    )

    $tabsEnvelope = Invoke-AgentBrowserCliJson -Arguments @('tabs')
    $targets = @(ConvertTo-AgentBrowserTabRecords -Envelope $tabsEnvelope)
    if ($null -ne $ExpectedBinding) {
        $matches = @($targets | Where-Object { Test-AgentBrowserTargetMatchesBinding -Target $_ -Binding $ExpectedBinding })
        if ($matches.Count -eq 0) {
            # agent-browser-cli may abbreviate long conversation URLs in `tabs`.
            # The full profile tree preserves the immutable tab identity and URL.
            $expectedProfileId = [string](Get-ObjectProperty $ExpectedBinding 'profileId' '')
            $profileTree = ConvertFrom-AgentBrowserProfileTree `
                -Envelope (Invoke-AgentBrowserCliJson -Arguments @('tabtree', '--full', '--profile', $expectedProfileId)) `
                -ProfileId $expectedProfileId
            $matches = @($profileTree.ChatGptTargets | Where-Object {
                Test-AgentBrowserTargetMatchesBinding -Target $_ -Binding $ExpectedBinding
            })
        }
        if ($matches.Count -gt 1) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'AgentBrowserTargetAmbiguous' -Message 'The exact browser target identity matched more than one tab.'
        }
        if ($matches.Count -eq 1) {
            return $matches[0]
        }

        if (-not $AllowExactUrlReopen -or [string]::IsNullOrWhiteSpace($ExpectedConversationUrl)) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'AgentBrowserTargetMissing' -Message 'The browser tab bound at send time is unavailable.'
        }
        $canonical = ConvertTo-SanitizedChatGptUrl -Candidate $ExpectedConversationUrl
        if ($null -eq $canonical -or -not $canonical.Exact -or $canonical.Url -cne $ExpectedConversationUrl) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.UrlCapture -Category 'ConversationUrlUnbound' -Message 'A missing tab may be reopened only from one exact canonical conversation URL.'
        }

        $expectedProfileId = [string](Get-ObjectProperty $ExpectedBinding 'profileId' '')
        $profileTree = ConvertFrom-AgentBrowserProfileTree `
            -Envelope (Invoke-AgentBrowserCliJson -Arguments @('tabtree', '--full', '--profile', $expectedProfileId)) `
            -ProfileId $expectedProfileId
        if ($profileTree.BrowserIds.Count -eq 0) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'AgentBrowserProfileUnavailable' -Message 'The bound Chrome profile has no connected normal tab from which to reopen the exact conversation.'
        }
        if ($profileTree.BrowserIds.Count -gt 1) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'AgentBrowserProfileAmbiguous' -Message 'The persistent Chrome profile is connected through more than one browser instance.'
        }
        $currentBrowserId = [string]$profileTree.BrowserIds[0]
        $sameProfile = @($profileTree.ChatGptTargets | Where-Object { $_.Url -ceq $ExpectedConversationUrl })
        if ($sameProfile.Count -ge 1) {
            $byOrdinalKey = @{}
            [string[]]$ordinalKeys = @($sameProfile | ForEach-Object {
                $key = ([string]$_.BrowserId) + [char]0 + ([string]$_.TabId) + [char]0 + ([string]$_.SessionKey)
                $byOrdinalKey[$key] = $_
                $key
            })
            [Array]::Sort($ordinalKeys, [StringComparer]::Ordinal)
            return $byOrdinalKey[$ordinalKeys[0]]
        }

        $openArguments = @(
            'open', $ExpectedConversationUrl, '--background',
            '--browser', $currentBrowserId,
            '--profile', $expectedProfileId,
            '--timeout', '15'
        )
        $openEnvelope = Invoke-AgentBrowserCliJson -Arguments $openArguments
        $openResult = Get-ObjectProperty $openEnvelope 'result' $null
        $openedTabId = [string](Get-ObjectProperty $openResult 'opened_tab_id' '')
        $openedSessionKey = [string](Get-ObjectProperty $openResult 'opened_session_key' '')

        $refreshed = @()
        $reopenDeadline = [DateTime]::UtcNow.AddSeconds(10)
        while ([DateTime]::UtcNow -lt $reopenDeadline) {
            $refreshedTree = ConvertFrom-AgentBrowserProfileTree `
                -Envelope (Invoke-AgentBrowserCliJson -Arguments @('tabtree', '--full', '--profile', $expectedProfileId)) `
                -ProfileId $expectedProfileId
            $refreshed = @($refreshedTree.ChatGptTargets | Where-Object {
                $_.BrowserId -ceq $currentBrowserId -and
                $_.ProfileId -ceq $expectedProfileId -and
                ([string]::IsNullOrWhiteSpace($openedTabId) -or $_.TabId -ceq $openedTabId) -and
                ([string]::IsNullOrWhiteSpace($openedSessionKey) -or $_.SessionKey -ceq $openedSessionKey)
            })
            if ($refreshed.Count -ne 0) {
                break
            }
            Start-Sleep -Milliseconds 250
        }
        if ($refreshed.Count -ne 1) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'AgentBrowserReopenUnproved' -Message 'The exact conversation was opened, but one matching tab identity could not be proved.'
        }
        $reopenedSnapshot = Get-AgentBrowserPageSnapshot -Target $refreshed[0]
        Assert-ConversationUrlMatch -ExpectedUrl $ExpectedConversationUrl -ActualUrl $reopenedSnapshot.Url
        return $refreshed[0]
    }

    $matches = @($targets | Where-Object {
        ([string]::IsNullOrWhiteSpace($BrowserId) -or $_.BrowserId -ceq $BrowserId) -and
        ([string]::IsNullOrWhiteSpace($Profile) -or $_.ProfileId -ceq $Profile -or $_.ProfileLabel -ceq $Profile) -and
        ([string]::IsNullOrWhiteSpace($TabId) -or $_.TabId -ceq $TabId) -and
        ([string]::IsNullOrWhiteSpace($SessionKey) -or $_.SessionKey -ceq $SessionKey)
    })
    if ($matches.Count -eq 0) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'AgentBrowserTargetMissing' -Message 'No connected external Chrome tab matches the approved ChatGPT target.'
    }
    if ($matches.Count -gt 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'AgentBrowserTargetAmbiguous' -Message 'More than one connected external Chrome tab matches ChatGPT; pass an exact browser/profile/tab/session binding.' -Details ([ordered]@{ candidateCount = $matches.Count })
    }
    return $matches[0]
}

function Resolve-AgentBrowserCommandTarget {
    param([AllowEmptyString()][string]$ExpectedConversationUrlValue = '')

    $provided = @(@($BrowserId, $Profile, $TabId, $SessionKey) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
    if ($provided -ne 0 -and $provided -ne 4) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'AgentBrowserTargetBindingIncomplete' -Message 'Browser, profile, tab, and session must be supplied together.'
    }
    if ($provided -eq 0) {
        return Resolve-AgentBrowserTarget
    }
    $expectedBinding = [ordered]@{
        browserId = $BrowserId
        profileId = $Profile
        profileLabel = ''
        tabId = $TabId
        sessionKey = $SessionKey
        origin = 'https://chatgpt.com'
        url = if ([string]::IsNullOrWhiteSpace($ExpectedConversationUrlValue)) { 'https://chatgpt.com/' } else { $ExpectedConversationUrlValue }
    }
    return Resolve-AgentBrowserTarget `
        -ExpectedBinding $expectedBinding `
        -ExpectedConversationUrl $ExpectedConversationUrlValue `
        -AllowExactUrlReopen:(-not [string]::IsNullOrWhiteSpace($ExpectedConversationUrlValue))
}

function Assert-AgentBrowserCommandResultBinding {
    param(
        [Parameter(Mandatory = $true)]$Envelope,
        [Parameter(Mandatory = $true)]$Target
    )

    $result = Get-ObjectProperty $Envelope 'result' $null
    if ([string](Get-ObjectProperty $result 'tab_id' '') -cne [string]$Target.TabId -or
        [string](Get-ObjectProperty $result 'session_key' '') -cne [string]$Target.SessionKey) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'AgentBrowserCommandTargetMismatch' -Message 'agent-browser-cli acted on a different tab or session than the immutable target.'
    }
}

function ConvertTo-AgentBrowserTurnRecords {
    param(
        [AllowEmptyCollection()][object[]]$Turns = @(),
        [Parameter(Mandatory = $true)][string]$Role
    )

    if ($Turns.Count -gt 200) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'ResponseTurnLimitExceeded' -Message 'The page exceeds the bounded turn limit.'
    }
    $records = @()
    for ($index = 0; $index -lt $Turns.Count; $index++) {
        $turn = $Turns[$index]
        if ([bool](Get-ObjectProperty $turn 'truncated' $false)) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'ResponseTextLimitExceeded' -Message 'A browser turn exceeds the bounded character limit.'
        }
        $content = Normalize-TextForHash -Text ([string](Get-ObjectProperty $turn 'content' ''))
        if ([string]::IsNullOrWhiteSpace($content) -or $content.Length -gt 200000) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'ResponseContentInvalid' -Message 'A browser turn has missing or unbounded content.'
        }
        $records += [pscustomobject]@{
            Ordinal = $index
            Content = $content
            ContentSha256 = Get-Sha256Text -Text $content
            TurnRuntimeId = [string](Get-ObjectProperty $turn 'key' ($Role + '-' + $index))
            ControlTypeCounts = [ordered]@{ domTurn = 1 }
            ExtractorVersion = $Script:AgentBrowserExtractorVersion
        }
    }
    return $records
}

function Get-AgentBrowserPageSnapshot {
    param([Parameter(Mandatory = $true)]$Target)

    if (-not [System.IO.File]::Exists($Script:AgentBrowserScriptPath)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Unsupported -Category 'AgentBrowserDomScriptMissing' -Message 'The fixed ChatGPT DOM inspection script is missing.'
    }
    $arguments = @(
        'exec', '--file', $Script:AgentBrowserScriptPath,
        '--tab', [string]$Target.TabId,
        '--browser', [string]$Target.BrowserId,
        '--profile', [string]$Target.ProfileId,
        '--timeout', '30'
    )
    $envelope = Invoke-AgentBrowserCliJson -Arguments $arguments
    Assert-AgentBrowserCommandResultBinding -Envelope $envelope -Target $Target
    $result = Get-ObjectProperty $envelope 'result' $null
    $page = Get-ObjectProperty $result 'js_return' $null
    if ($null -eq $page -or [int](Get-ObjectProperty $page 'schemaVersion' 0) -ne 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.DocumentSelection -Category 'AgentBrowserPageStateInvalid' -Message 'The fixed DOM script returned an invalid page-state object.'
    }
    if ([string](Get-ObjectProperty $page 'origin' '') -cne 'https://chatgpt.com') {
        Throw-SidebarError -ExitCode $Script:ExitCodes.UrlCapture -Category 'ChatGptOriginUnproved' -Message 'The bound browser tab is no longer on the canonical ChatGPT origin.'
    }
    $canonical = ConvertTo-SanitizedChatGptUrl -Candidate ([string](Get-ObjectProperty $page 'url' ''))
    if ($null -eq $canonical -or -not $canonical.AllowedForChat) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.UrlCapture -Category 'ChatGptPathUnsupported' -Message 'The bound browser tab is not on an allowed ChatGPT chat path.'
    }
    if ([bool](Get-ObjectProperty $page 'turnLimitExceeded' $false)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'ResponseTurnLimitExceeded' -Message 'The page exceeds the bounded turn limit.'
    }
    Set-ObjectProperty -InputObject $Target -Name 'Url' -Value ([string]$canonical.Url)
    Set-ObjectProperty -InputObject $Target -Name 'UrlExact' -Value ([bool]$canonical.Exact)

    $composer = Get-ObjectProperty $page 'composer' $null
    $send = Get-ObjectProperty $page 'send' $null
    $auth = Get-ObjectProperty $page 'auth' $null
    $model = Get-ObjectProperty $page 'model' $null
    if ($null -eq $model) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.DocumentSelection -Category 'AgentBrowserPageStateInvalid' -Message 'The fixed DOM script did not return selected-mode evidence.'
    }
    $selectedModeControlCount = [int](Get-ObjectProperty $model 'controlCount' 0)
    $selectedModeLabel = [string](Get-ObjectProperty $model 'selectedLabel' '')
    $proSelected = [bool](Get-ObjectProperty $model 'proSelected' $false)
    if ($selectedModeLabel.Length -gt 64 -or $selectedModeLabel -match '[\r\n]' -or
        $proSelected -ne ($selectedModeControlCount -eq 1 -and $selectedModeLabel -ceq 'Pro')) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.DocumentSelection -Category 'AgentBrowserPageStateInvalid' -Message 'The fixed DOM script returned inconsistent selected-mode evidence.'
    }
    $userTurns = @(ConvertTo-AgentBrowserTurnRecords -Turns @((Get-ObjectProperty $page 'userTurns' @())) -Role 'user')
    $assistantTurns = @(ConvertTo-AgentBrowserTurnRecords -Turns @((Get-ObjectProperty $page 'assistantTurns' @())) -Role 'assistant')
    return [pscustomobject]@{
        Url = [string]$canonical.Url
        UrlExact = [bool]$canonical.Exact
        ComposerCount = [int](Get-ObjectProperty $composer 'count' 0)
        ComposerValue = Normalize-TextForHash -Text ([string](Get-ObjectProperty $composer 'value' ''))
        SendCount = [int](Get-ObjectProperty $send 'count' 0)
        LoginCount = [int](Get-ObjectProperty $auth 'loginCount' 0)
        ProCount = [int](Get-ObjectProperty $auth 'proIndicatorCount' 0)
        SelectedModeControlCount = $selectedModeControlCount
        SelectedModeLabel = $selectedModeLabel
        SelectedModeIsPro = $proSelected
        SecurityChallengeCount = [int](Get-ObjectProperty $auth 'challengeCount' 0)
        Generating = [bool](Get-ObjectProperty $page 'generating' $false)
        UserTurns = $userTurns
        Responses = $assistantTurns
        Target = $Target
    }
}

function Assert-AgentBrowserAuthBarrierAbsent {
    param([Parameter(Mandatory = $true)]$Snapshot)

    Assert-AuthReadySnapshot -Snapshot ([pscustomobject]@{
        LoginCount = $Snapshot.LoginCount
        ProCount = 1
        SecurityChallengeCount = $Snapshot.SecurityChallengeCount
        ComposerCount = $Snapshot.ComposerCount
    })
}

function Assert-AgentBrowserBaseReady {
    param([Parameter(Mandatory = $true)]$Snapshot)

    Assert-AgentBrowserAuthBarrierAbsent -Snapshot $Snapshot
    if ($Snapshot.Generating) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.GenerationActive -Category 'GenerationAlreadyActive' -Message 'ChatGPT is already generating; duplicate submission is prohibited.'
    }
}

function Assert-AgentBrowserSelectedPro {
    param([Parameter(Mandatory = $true)]$Snapshot)

    $count = [int](Get-ObjectProperty $Snapshot 'SelectedModeControlCount' 0)
    $label = [string](Get-ObjectProperty $Snapshot 'SelectedModeLabel' '')
    if ($count -eq 0) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'SelectedModeControlMissing' -Message 'The ChatGPT thinking-mode control could not be proved before send.'
    }
    if ($count -ne 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'SelectedModeControlAmbiguous' -Message 'More than one ChatGPT thinking-mode control matched before send.' -Details ([ordered]@{ candidateCount = $count })
    }
    if ($label -cne 'Pro' -or -not [bool](Get-ObjectProperty $Snapshot 'SelectedModeIsPro' $false)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.AuthBarrier -Category 'SelectedModeNotPro' -Message 'ChatGPT was not proved to be using Pro thinking mode before send.' -Details ([ordered]@{ selectedModeLabel = $label })
    }
}

function Assert-AgentBrowserPageReady {
    param([Parameter(Mandatory = $true)]$Snapshot)

    Assert-AgentBrowserBaseReady -Snapshot $Snapshot
    Assert-AgentBrowserSelectedPro -Snapshot $Snapshot
}

function Assert-AgentBrowserPostFillReady {
    param([Parameter(Mandatory = $true)]$Snapshot)

    Assert-AgentBrowserBaseReady -Snapshot $Snapshot
    # ChatGPT may hide the model control once the composer has text. The caller
    # already proved exact Pro while holding this target's UI mutex; if the
    # control remains visible, any ambiguity or drift still fails closed.
    if ([int](Get-ObjectProperty $Snapshot 'SelectedModeControlCount' 0) -ne 0) {
        Assert-AgentBrowserSelectedPro -Snapshot $Snapshot
    }
}

function Get-AgentBrowserProSelectionAction {
    param([Parameter(Mandatory = $true)]$Target)

    if (-not [System.IO.File]::Exists($Script:AgentBrowserSelectProScriptPath)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Unsupported -Category 'AgentBrowserModelScriptMissing' -Message 'The fixed ChatGPT Pro selection script is missing.'
    }
    $envelope = Invoke-AgentBrowserCliJson -Arguments @(
        'exec', '--file', $Script:AgentBrowserSelectProScriptPath,
        '--tab', [string]$Target.TabId,
        '--browser', [string]$Target.BrowserId,
        '--profile', [string]$Target.ProfileId,
        '--timeout', '15'
    )
    Assert-AgentBrowserCommandResultBinding -Envelope $envelope -Target $Target
    $action = Get-ObjectProperty (Get-ObjectProperty $envelope 'result' $null) 'js_return' $null
    if ($null -eq $action -or [int](Get-ObjectProperty $action 'schemaVersion' 0) -ne 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'SelectedModeSwitchUnproved' -Message 'The fixed Pro selection script returned an invalid action.'
    }
    return $action
}

function Invoke-AgentBrowserBoundMouseClick {
    param(
        [Parameter(Mandatory = $true)]$Target,
        [Parameter(Mandatory = $true)][string]$Selector
    )

    $envelope = Invoke-AgentBrowserCliJson -Arguments @(
        'mouse-click', $Selector,
        '--tab', [string]$Target.TabId,
        '--browser', [string]$Target.BrowserId,
        '--profile', [string]$Target.ProfileId,
        '--timeout', '15'
    )
    Assert-AgentBrowserCommandResultBinding -Envelope $envelope -Target $Target
}

function Ensure-AgentBrowserProMode {
    param(
        [Parameter(Mandatory = $true)]$Target,
        [Parameter(Mandatory = $true)]$Snapshot
    )

    Assert-AgentBrowserBaseReady -Snapshot $Snapshot
    if ([int](Get-ObjectProperty $Snapshot 'SelectedModeControlCount' 0) -ne 1) {
        Assert-AgentBrowserSelectedPro -Snapshot $Snapshot
    }
    if ([string](Get-ObjectProperty $Snapshot 'SelectedModeLabel' '') -ceq 'Pro' -and
        [bool](Get-ObjectProperty $Snapshot 'SelectedModeIsPro' $false)) {
        return $Snapshot
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    while ([DateTime]::UtcNow -lt $deadline) {
        $action = Get-AgentBrowserProSelectionAction -Target $Target
        if (-not [bool](Get-ObjectProperty $action 'ok' $false)) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'SelectedModeSwitchUnproved' -Message 'ChatGPT Pro mode could not be selected safely.' -Details ([ordered]@{
                reason = [string](Get-ObjectProperty $action 'reason' 'unknown')
                candidateCount = [int](Get-ObjectProperty $action 'count' 0)
            })
        }
        switch ([string](Get-ObjectProperty $action 'phase' '')) {
            'open-menu' {
                Invoke-AgentBrowserBoundMouseClick -Target $Target -Selector 'button[data-codex-gptpro-mode-control="true"]'
            }
            'open-submenu' { }
            'select-pro' {
                Invoke-AgentBrowserBoundMouseClick -Target $Target -Selector '[data-codex-gptpro-pro-option="true"]'
            }
            'already-pro' { }
            default {
                Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'SelectedModeSwitchUnproved' -Message 'ChatGPT Pro mode selection returned an unsupported action.'
            }
        }
        Start-Sleep -Milliseconds 250
        $Snapshot = Get-AgentBrowserPageSnapshot -Target $Target
        Assert-AgentBrowserBaseReady -Snapshot $Snapshot
        if ([string](Get-ObjectProperty $Snapshot 'SelectedModeLabel' '') -ceq 'Pro' -and
            [bool](Get-ObjectProperty $Snapshot 'SelectedModeIsPro' $false)) {
            return $Snapshot
        }
        if ([int](Get-ObjectProperty $Snapshot 'SelectedModeControlCount' 0) -ne 1) {
            Assert-AgentBrowserSelectedPro -Snapshot $Snapshot
        }
    }

    Throw-SidebarError -ExitCode $Script:ExitCodes.AuthBarrier -Category 'SelectedModeNotPro' -Message 'ChatGPT did not confirm Pro thinking mode within the bounded pre-send selection window.' -Details ([ordered]@{
        selectedModeLabel = [string](Get-ObjectProperty $Snapshot 'SelectedModeLabel' '')
    })
}

function New-AgentBrowserStatusPayload {
    param(
        [Parameter(Mandatory = $true)]$Target,
        [Parameter(Mandatory = $true)]$Snapshot
    )

    return [ordered]@{
        ok = $true
        command = 'status'
        live = $true
        transport = $Script:AgentBrowserTransport
        ready = $Snapshot.ComposerCount -eq 1 -and $Snapshot.LoginCount -eq 0 -and $Snapshot.SecurityChallengeCount -eq 0 -and $Snapshot.SelectedModeControlCount -eq 1 -and $Snapshot.SelectedModeLabel -ceq 'Pro' -and $Snapshot.SelectedModeIsPro -and -not $Snapshot.Generating
        targetBinding = ConvertTo-AgentBrowserTargetBinding -Target $Target
        composerCount = $Snapshot.ComposerCount
        loginControlCount = $Snapshot.LoginCount
        proIndicatorCount = $Snapshot.ProCount
        selectedModeControlCount = $Snapshot.SelectedModeControlCount
        selectedModeLabel = $Snapshot.SelectedModeLabel
        selectedModeIsPro = $Snapshot.SelectedModeIsPro
        securityChallengeControlCount = $Snapshot.SecurityChallengeCount
        generating = $Snapshot.Generating
        url = $Snapshot.Url
        urlExact = $Snapshot.UrlExact
        clipboardUsed = $false
        focusRequested = $false
    }
}

function Invoke-AgentBrowserOpenFreshTab {
    param([Parameter(Mandatory = $true)]$CurrentTarget)

    $openEnvelope = Invoke-AgentBrowserCliJson -Arguments @(
        'open', 'https://chatgpt.com/', '--background',
        '--browser', [string]$CurrentTarget.BrowserId,
        '--profile', [string]$CurrentTarget.ProfileId,
        '--timeout', '15'
    )
    $openResult = Get-ObjectProperty $openEnvelope 'result' $null
    $openedTabId = [string](Get-ObjectProperty $openResult 'opened_tab_id' '')
    $openedSessionKey = [string](Get-ObjectProperty $openResult 'opened_session_key' '')
    if ([string]::IsNullOrWhiteSpace($openedTabId) -or [string]::IsNullOrWhiteSpace($openedSessionKey)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'AgentBrowserOpenIdentityMissing' -Message 'agent-browser-cli did not identify the background tab it opened.'
    }

    $targets = @()
    $bindDeadline = [DateTime]::UtcNow.AddSeconds(10)
    while ([DateTime]::UtcNow -lt $bindDeadline) {
        $targets = @(ConvertTo-AgentBrowserTabRecords -Envelope (Invoke-AgentBrowserCliJson -Arguments @('tabs')) | Where-Object {
            $sanitizedUrl = ConvertTo-SanitizedChatGptUrl -Candidate ([string]$_.Url)
            $_.BrowserId -ceq [string]$CurrentTarget.BrowserId -and
            $_.ProfileId -ceq [string]$CurrentTarget.ProfileId -and
            $_.TabId -ceq $openedTabId -and
            $_.SessionKey -ceq $openedSessionKey -and
            $null -ne $sanitizedUrl -and
            -not $sanitizedUrl.Exact -and
            $sanitizedUrl.Url -ceq 'https://chatgpt.com/'
        })
        if ($targets.Count -eq 1) {
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if ($targets.Count -ne 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'AgentBrowserOpenTargetUnproved' -Message 'The background homepage tab could not be bound to one exact browser identity.'
    }

    $openedTarget = $targets[0]
    $surfaceDeadline = [DateTime]::UtcNow.AddSeconds(10)
    while ([DateTime]::UtcNow -lt $surfaceDeadline) {
        $snapshot = Get-AgentBrowserPageSnapshot -Target $openedTarget
        try {
            Assert-AgentBrowserBaseReady -Snapshot $snapshot
            if ([int](Get-ObjectProperty $snapshot 'SelectedModeControlCount' 0) -gt 0) {
                return $openedTarget
            }
        }
        catch {
            if ((Get-ExceptionCategory -Exception $_.Exception) -ne 'ComposerMissing') {
                throw
            }
        }
        Start-Sleep -Milliseconds 250
    }
    Assert-AgentBrowserBaseReady -Snapshot $snapshot
    Assert-AgentBrowserSelectedPro -Snapshot $snapshot
    return $openedTarget
}

function Invoke-AgentBrowserNewChat {
    param($Target = $null)

    if ($null -eq $Target) {
        $Target = Resolve-AgentBrowserTarget
    }
    $snapshot = Get-AgentBrowserPageSnapshot -Target $Target
    $snapshot = Ensure-AgentBrowserProMode -Target $Target -Snapshot $snapshot
    Assert-AgentBrowserPageReady -Snapshot $snapshot
    $alreadyFresh = [string]$snapshot.Url -ceq 'https://chatgpt.com/' -and -not $snapshot.UrlExact -and
        $snapshot.UserTurns.Count -eq 0 -and
        $snapshot.Responses.Count -eq 0 -and
        (Test-ComposerValueEmpty -Value $snapshot.ComposerValue)
    $opened = $false
    if (-not $alreadyFresh) {
        $Target = Invoke-AgentBrowserOpenFreshTab -CurrentTarget $Target
        $opened = $true
        $snapshot = Get-AgentBrowserPageSnapshot -Target $Target
        $snapshot = Ensure-AgentBrowserProMode -Target $Target -Snapshot $snapshot
        Assert-AgentBrowserPageReady -Snapshot $snapshot
        if ([string]$snapshot.Url -cne 'https://chatgpt.com/' -or $snapshot.UrlExact -or
            $snapshot.UserTurns.Count -ne 0 -or $snapshot.Responses.Count -ne 0 -or
            -not (Test-ComposerValueEmpty -Value $snapshot.ComposerValue)) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'NewChatUncertain' -Message 'The background homepage tab was opened, but an empty fresh conversation was not proved.' -Details ([ordered]@{
                targetBinding = ConvertTo-AgentBrowserTargetBinding -Target $Target
                url = $snapshot.Url
                urlExact = $snapshot.UrlExact
                userTurnCount = $snapshot.UserTurns.Count
                responseCount = $snapshot.Responses.Count
                composerEmpty = Test-ComposerValueEmpty -Value $snapshot.ComposerValue
            })
        }
    }

    return [ordered]@{
        ok = $true
        command = 'new-chat'
        live = $true
        transport = $Script:AgentBrowserTransport
        conversationReset = $opened
        targetBinding = ConvertTo-AgentBrowserTargetBinding -Target $Target
        url = $snapshot.Url
        urlExact = $snapshot.UrlExact
        clipboardUsed = $false
        focusRequested = $false
    }
}

function Assert-AgentBrowserUserTurnAcknowledgement {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$BaselineHashes,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$CurrentTurns
    )

    $match = Find-TurnBaselineSuffix -BaselineHashes $BaselineHashes -CurrentTurns $CurrentTurns
    if ($null -eq $match) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'UserTurnBaselineMismatch' -Message 'Rendered user turns do not retain an unchanged ordered suffix of the pre-send baseline.'
    }
    $newCount = $match.NewCount
    if ($newCount -eq 0) {
        return $false
    }
    if ($newCount -ne 1) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ResponseIsolation -Category 'UserTurnAcknowledgementMismatch' -Message 'Post-click observation requires at most one appended user turn.'
    }
    return $true
}

function Invoke-AgentBrowserSend {
    param(
        [Parameter(Mandatory = $true)][string]$PromptText,
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$IdempotencyKeyValue,
        [Parameter(Mandatory = $true)][string]$CodexThreadIdValue,
        [switch]$RequireFreshConversation,
        [switch]$RequireExistingConversation,
        [Parameter(Mandatory = $true)]$TargetBinding,
        [ValidateRange(0, 180)][int]$ObservationSecondsValue = 180,
        [ValidateRange(1, 86400)][int]$ResponseTimeoutSecondsValue = 7200
    )

    $threadId = Resolve-CodexThreadId -Value $CodexThreadIdValue
    $null = Assert-AgentBrowserTargetBindingComplete -Binding $TargetBinding
    if ($PromptText.Length -gt $Script:AgentBrowserPromptCharacterLimit) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'PromptTransportLimitExceeded' -Message 'The prompt exceeds the bounded Windows argument limit for parameterized agent-browser-cli fill.' -Details ([ordered]@{ maximumCharacters = $Script:AgentBrowserPromptCharacterLimit; characters = $PromptText.Length })
    }
    $existingState = Read-EvidenceState -Directory $EvidenceDirectory
    Assert-IdempotencyAvailable -ExistingState $existingState -IdempotencyKey $IdempotencyKeyValue
    Assert-EvidenceDirectoryPristine -Directory $EvidenceDirectory
    $null = Assert-GlobalIdempotencyKeyAvailable -IdempotencyKeyValue $IdempotencyKeyValue
    $idempotencyKeySha256 = Get-Sha256Text -Text $IdempotencyKeyValue
    $uiLease = Enter-UiMutex -TargetBinding $TargetBinding
    $retryUiLease = $null
    try {
    $target = Resolve-AgentBrowserTarget -ExpectedBinding $TargetBinding
    $snapshot = Get-AgentBrowserPageSnapshot -Target $target
    $snapshot = Ensure-AgentBrowserProMode -Target $target -Snapshot $snapshot
    Assert-AgentBrowserPageReady -Snapshot $snapshot
    Assert-ChatGptUrlState -UrlState ([pscustomobject]@{ Url = $snapshot.Url; Exact = $snapshot.UrlExact }) -RequireFreshConversation:$RequireFreshConversation -RequireExistingConversation:$RequireExistingConversation
    if (-not (Test-ComposerValueEmpty -Value $snapshot.ComposerValue)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.ControlSelection -Category 'ComposerNotEmpty' -Message 'The ChatGPT composer already contains user text; it will not be overwritten.'
    }
    $baselineResponses = @($snapshot.Responses)
    $baselineHashes = @($baselineResponses | ForEach-Object { $_.ContentSha256 })
    $baselineUserHashes = @($snapshot.UserTurns | ForEach-Object { $_.ContentSha256 })
    $promptSha = Get-Sha256Text -Text $PromptText
    $globalReservation = Reserve-GlobalIdempotencyKey -IdempotencyKeyValue $IdempotencyKeyValue -PromptSha256 $promptSha
    $conversationUrlBeforeSend = if ($snapshot.UrlExact) { [string]$snapshot.Url } else { '' }

    # Reserve the global request identity before claiming a browser target. A
    # reservation race can fail closed without stranding that target.
    $TargetBinding = ConvertTo-AgentBrowserTargetBinding -Target $target
    try {
        $targetClaim = Reserve-AgentBrowserTargetClaim `
            -CodexThreadIdValue $threadId `
            -EvidenceDirectory $EvidenceDirectory `
            -IdempotencyKeySha256Value $idempotencyKeySha256 `
            -Binding $TargetBinding
    }
    catch {
        Write-Utf8NoBomAtomic -Path (Join-Path $EvidenceDirectory 'prompt.md') -Text $PromptText
        $failedState = New-SendIntentState `
            -PromptSha256 $promptSha `
            -IdempotencyKeyValue $IdempotencyKeyValue `
            -BaselineHashes $baselineHashes `
            -ConversationUrlBeforeSend $conversationUrlBeforeSend `
            -IdempotencyKeySha256 $globalReservation.KeySha256 `
            -GlobalReservationAtUtc $globalReservation.ReservedAtUtc `
            -Transport $Script:AgentBrowserTransport `
            -TargetBinding $TargetBinding `
            -CodexThreadIdValue $threadId
        Set-ObjectProperty -InputObject $failedState -Name 'phase' -Value 'pre-invoke-failed'
        Set-ObjectProperty -InputObject $failedState -Name 'invokeAttempted' -Value $false
        Set-ObjectProperty -InputObject $failedState -Name 'preInvokeFailureCategory' -Value (Get-ExceptionCategory -Exception $_.Exception)
        Set-ObjectProperty -InputObject $failedState -Name 'preInvokeFailedAtUtc' -Value ([DateTime]::UtcNow.ToString('o'))
        Write-EvidenceState -Directory $EvidenceDirectory -State $failedState
        throw
    }

    try {
        $fillEnvelope = Invoke-AgentBrowserCliJson -Arguments @(
            'fill', '#prompt-textarea', $PromptText,
            '--tab', [string]$target.TabId,
            '--browser', [string]$target.BrowserId,
            '--profile', [string]$target.ProfileId,
            '--timeout', '30'
        )
        Assert-AgentBrowserCommandResultBinding -Envelope $fillEnvelope -Target $target
        $target = Resolve-AgentBrowserTarget -ExpectedBinding (ConvertTo-AgentBrowserTargetBinding -Target $target)
        $prepared = Get-AgentBrowserPageSnapshot -Target $target
        Assert-AgentBrowserPostFillReady -Snapshot $prepared
        Assert-PreSendUrlInvariant `
            -InitialUrlState ([pscustomobject]@{ Url = $snapshot.Url; Exact = $snapshot.UrlExact }) `
            -CurrentUrlState ([pscustomobject]@{ Url = $prepared.Url; Exact = $prepared.UrlExact }) `
            -RequireFreshConversation:$RequireFreshConversation `
            -RequireExistingConversation:$RequireExistingConversation
        Assert-SendPreconditions -Snapshot ([pscustomobject]@{
            Generating = $prepared.Generating
            ComposerCount = $prepared.ComposerCount
            SendCount = $prepared.SendCount
            ComposerSha256 = Get-Sha256Text -Text $prepared.ComposerValue
        }) -ExpectedPromptSha256 $promptSha
    }
    catch {
        Write-Utf8NoBomAtomic -Path (Join-Path $EvidenceDirectory 'prompt.md') -Text $PromptText
        $failedState = New-SendIntentState `
            -PromptSha256 $promptSha `
            -IdempotencyKeyValue $IdempotencyKeyValue `
            -BaselineHashes $baselineHashes `
            -ConversationUrlBeforeSend $conversationUrlBeforeSend `
            -IdempotencyKeySha256 $globalReservation.KeySha256 `
            -GlobalReservationAtUtc $globalReservation.ReservedAtUtc `
            -Transport $Script:AgentBrowserTransport `
            -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $target) `
            -CodexThreadIdValue $threadId `
            -TargetClaimKeySha256 $targetClaim.KeySha256
        Set-ObjectProperty -InputObject $failedState -Name 'phase' -Value 'pre-invoke-failed'
        Set-ObjectProperty -InputObject $failedState -Name 'invokeAttempted' -Value $false
        Set-ObjectProperty -InputObject $failedState -Name 'preInvokeFailureCategory' -Value (Get-ExceptionCategory -Exception $_.Exception)
        Set-ObjectProperty -InputObject $failedState -Name 'preInvokeFailedAtUtc' -Value ([DateTime]::UtcNow.ToString('o'))
        Write-EvidenceState -Directory $EvidenceDirectory -State $failedState
        throw
    }

    Write-Utf8NoBomAtomic -Path (Join-Path $EvidenceDirectory 'prompt.md') -Text $PromptText
    $state = New-SendIntentState `
        -PromptSha256 $promptSha `
        -IdempotencyKeyValue $IdempotencyKeyValue `
        -BaselineHashes $baselineHashes `
        -ConversationUrlBeforeSend $conversationUrlBeforeSend `
        -IdempotencyKeySha256 $globalReservation.KeySha256 `
        -GlobalReservationAtUtc $globalReservation.ReservedAtUtc `
        -Transport $Script:AgentBrowserTransport `
        -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $target) `
        -CodexThreadIdValue $threadId `
        -TargetClaimKeySha256 $targetClaim.KeySha256
    Set-ObjectProperty -InputObject $state -Name 'baselineUserTurnSha256' -Value $baselineUserHashes
    Write-EvidenceState -Directory $EvidenceDirectory -State $state

    $currentTarget = $target
    $attemptInitialSnapshot = $snapshot
    $attemptNumber = 1
    $responseDeadline = [DateTime]::MaxValue
    while ($attemptNumber -le 2) {
        if ($attemptNumber -eq 2) {
            try {
                $currentTarget = Invoke-AgentBrowserOpenFreshTab -CurrentTarget $currentTarget
                $retryUiLease = Enter-UiMutex -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $currentTarget)
                $attemptInitialSnapshot = Get-AgentBrowserPageSnapshot -Target $currentTarget
                $attemptInitialSnapshot = Ensure-AgentBrowserProMode -Target $currentTarget -Snapshot $attemptInitialSnapshot
                Assert-AgentBrowserPageReady -Snapshot $attemptInitialSnapshot
                if ([string]$attemptInitialSnapshot.Url -cne 'https://chatgpt.com/' -or $attemptInitialSnapshot.UrlExact -or
                    $attemptInitialSnapshot.UserTurns.Count -ne 0 -or
                    $attemptInitialSnapshot.Responses.Count -ne 0 -or -not (Test-ComposerValueEmpty -Value $attemptInitialSnapshot.ComposerValue)) {
                    Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'RecoveryRequired' -Message 'The retry tab was not proved to be one empty fresh homepage.'
                }
                $retryBinding = ConvertTo-AgentBrowserTargetBinding -Target $currentTarget
                $retryClaim = Reserve-AgentBrowserTargetClaim `
                    -CodexThreadIdValue $threadId `
                    -EvidenceDirectory $EvidenceDirectory `
                    -IdempotencyKeySha256Value $idempotencyKeySha256 `
                    -Binding $retryBinding
                Set-ObjectProperty -InputObject $state -Name 'targetBinding' -Value $retryBinding
                Set-ObjectProperty -InputObject $state -Name 'targetClaimKeySha256' -Value $retryClaim.KeySha256
                Write-EvidenceState -Directory $EvidenceDirectory -State $state

                $fillEnvelope = Invoke-AgentBrowserCliJson -Arguments @(
                    'fill', '#prompt-textarea', $PromptText,
                    '--tab', [string]$currentTarget.TabId,
                    '--browser', [string]$currentTarget.BrowserId,
                    '--profile', [string]$currentTarget.ProfileId,
                    '--timeout', '30'
                )
                Assert-AgentBrowserCommandResultBinding -Envelope $fillEnvelope -Target $currentTarget
                $currentTarget = Resolve-AgentBrowserTarget -ExpectedBinding (ConvertTo-AgentBrowserTargetBinding -Target $currentTarget)
                $prepared = Get-AgentBrowserPageSnapshot -Target $currentTarget
                Assert-AgentBrowserPostFillReady -Snapshot $prepared
                Assert-PreSendUrlInvariant `
                    -InitialUrlState ([pscustomobject]@{ Url = $attemptInitialSnapshot.Url; Exact = $attemptInitialSnapshot.UrlExact }) `
                    -CurrentUrlState ([pscustomobject]@{ Url = $prepared.Url; Exact = $prepared.UrlExact }) `
                    -RequireFreshConversation
                Assert-SendPreconditions -Snapshot ([pscustomobject]@{
                    Generating = $prepared.Generating
                    ComposerCount = $prepared.ComposerCount
                    SendCount = $prepared.SendCount
                    ComposerSha256 = Get-Sha256Text -Text $prepared.ComposerValue
                }) -ExpectedPromptSha256 $promptSha
            }
            catch {
                Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'send-uncertain'
                Set-ObjectProperty -InputObject $state -Name 'retryOutcome' -Value 'retry-not-submitted'
                Set-ObjectProperty -InputObject $state -Name 'retryFailureCategory' -Value (Get-ExceptionCategory -Exception $_.Exception)
                Write-EvidenceState -Directory $EvidenceDirectory -State $state
                Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'RetryNotSubmitted' -Message 'The first click was proved unsubmitted and the background retry failed before a second click. No request was resent.'
            }
        }

        try {
            $commitTarget = Resolve-AgentBrowserTarget -ExpectedBinding (Get-ObjectProperty $state 'targetBinding' $null)
            $commitSnapshot = Get-AgentBrowserPageSnapshot -Target $commitTarget
            Assert-AgentBrowserPostFillReady -Snapshot $commitSnapshot
            Assert-PreSendUrlInvariant `
                -InitialUrlState ([pscustomobject]@{ Url = $attemptInitialSnapshot.Url; Exact = $attemptInitialSnapshot.UrlExact }) `
                -CurrentUrlState ([pscustomobject]@{ Url = $commitSnapshot.Url; Exact = $commitSnapshot.UrlExact }) `
                -RequireFreshConversation:($attemptNumber -eq 2 -or $RequireFreshConversation) `
                -RequireExistingConversation:($attemptNumber -eq 1 -and $RequireExistingConversation)
            Assert-SendPreconditions -Snapshot ([pscustomobject]@{
                Generating = $commitSnapshot.Generating
                ComposerCount = $commitSnapshot.ComposerCount
                SendCount = $commitSnapshot.SendCount
                ComposerSha256 = Get-Sha256Text -Text $commitSnapshot.ComposerValue
            }) -ExpectedPromptSha256 $promptSha
        }
        catch {
            if ($attemptNumber -eq 1) {
                Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'pre-invoke-failed'
                Set-ObjectProperty -InputObject $state -Name 'invokeAttempted' -Value $false
                Set-ObjectProperty -InputObject $state -Name 'preInvokeFailureCategory' -Value (Get-ExceptionCategory -Exception $_.Exception)
                Set-ObjectProperty -InputObject $state -Name 'preInvokeFailedAtUtc' -Value ([DateTime]::UtcNow.ToString('o'))
                Write-EvidenceState -Directory $EvidenceDirectory -State $state
                throw
            }
            Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'send-uncertain'
            Set-ObjectProperty -InputObject $state -Name 'retryOutcome' -Value 'retry-not-submitted'
            Set-ObjectProperty -InputObject $state -Name 'retryFailureCategory' -Value (Get-ExceptionCategory -Exception $_.Exception)
            Write-EvidenceState -Directory $EvidenceDirectory -State $state
            Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'RetryNotSubmitted' -Message 'The background retry failed before its click. No third send is allowed.'
        }

        $clickStartedAt = [DateTime]::UtcNow
        if ($attemptNumber -eq 1) {
            $responseDeadline = $clickStartedAt.AddSeconds($ResponseTimeoutSecondsValue)
            Set-ObjectProperty -InputObject $state -Name 'firstClickAtUtc' -Value ($clickStartedAt.ToString('o'))
            Set-ObjectProperty -InputObject $state -Name 'responseDeadlineAtUtc' -Value ($responseDeadline.ToString('o'))
        }
        $observationDeadline = $clickStartedAt.AddSeconds($ObservationSecondsValue)
        $attemptRecord = [ordered]@{
            attempt = $attemptNumber
            targetBinding = ConvertTo-AgentBrowserTargetBinding -Target $commitTarget
            clickedAtUtc = $clickStartedAt.ToString('o')
            observationDeadlineAtUtc = $observationDeadline.ToString('o')
            exactConversationUrl = ''
            userTurnObserved = $false
            generatingObserved = $false
            composerSha256Observed = ''
            outcome = 'clicking'
        }
        $attempts = @((Get-ObjectProperty $state 'attempts' @())) + @($attemptRecord)
        Set-ObjectProperty -InputObject $state -Name 'attempts' -Value $attempts
        Set-ObjectProperty -InputObject $state -Name 'attemptCount' -Value $attemptNumber
        Set-ObjectProperty -InputObject $state -Name 'invokeAttempted' -Value $true
        Write-EvidenceState -Directory $EvidenceDirectory -State $state

        try {
            $clickEnvelope = Invoke-AgentBrowserCliJson -Arguments @(
                'click', 'button[data-testid="send-button"]',
                '--tab', [string]$commitTarget.TabId,
                '--browser', [string]$commitTarget.BrowserId,
                '--profile', [string]$commitTarget.ProfileId,
                '--timeout', '30'
            )
            Assert-AgentBrowserCommandResultBinding -Envelope $clickEnvelope -Target $commitTarget
        }
        catch {
            Set-ObjectProperty -InputObject $attemptRecord -Name 'outcome' -Value 'click-result-uncertain'
            Set-SendUncertainState -EvidenceDirectory $EvidenceDirectory -State $state -Reason 'click-result-uncertain' -InvokeReturned:$false
            Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'SendUncertain' -Message 'The agent-browser-cli click had an uncertain result and was not retried.'
        }

        Set-ObjectProperty -InputObject $state -Name 'invokeReturned' -Value $true
        Set-ObjectProperty -InputObject $attemptRecord -Name 'outcome' -Value 'observing'
        Write-EvidenceState -Directory $EvidenceDirectory -State $state
        $boundConversationUrl = [string](Get-ObjectProperty $state 'conversationUrlBound' '')
        $ackTarget = $commitTarget
        $lastSnapshot = $null
        $userTurnObserved = $false
        $progressObserved = $false
        try {
            do {
                if ($ObservationSecondsValue -gt 0) {
                    Start-Sleep -Milliseconds 1000
                }
                try {
                    $ackTarget = Resolve-AgentBrowserTarget -ExpectedBinding (Get-ObjectProperty $state 'targetBinding' $null)
                    $ackSnapshot = Get-AgentBrowserPageSnapshot -Target $ackTarget
                    $lastSnapshot = $ackSnapshot
                    if (-not [string]::IsNullOrWhiteSpace($conversationUrlBeforeSend)) {
                        Assert-ConversationUrlMatch -ExpectedUrl $conversationUrlBeforeSend -ActualUrl $ackSnapshot.Url
                    }
                    elseif ($ackSnapshot.UrlExact -and [string]::IsNullOrWhiteSpace($boundConversationUrl)) {
                        $boundConversationUrl = [string]$ackSnapshot.Url
                        $urlBinding = ConvertTo-AgentBrowserTargetBinding -Target $ackTarget
                        Set-ObjectProperty -InputObject $state -Name 'targetBinding' -Value $urlBinding
                        Set-ObjectProperty -InputObject $state -Name 'conversationUrlBound' -Value $boundConversationUrl
                        Set-ObjectProperty -InputObject $state -Name 'conversationUrlBoundAtUtc' -Value ([DateTime]::UtcNow.ToString('o'))
                        Set-ObjectProperty -InputObject $state -Name 'conversationUrlBindingPending' -Value $false
                        Set-ObjectProperty -InputObject $attemptRecord -Name 'exactConversationUrl' -Value $boundConversationUrl
                        Write-EvidenceState -Directory $EvidenceDirectory -State $state
                        $stableClaim = Reserve-AgentBrowserTargetClaim `
                            -CodexThreadIdValue $threadId `
                            -EvidenceDirectory $EvidenceDirectory `
                            -IdempotencyKeySha256Value $idempotencyKeySha256 `
                            -Binding $urlBinding
                        Set-ObjectProperty -InputObject $state -Name 'targetClaimKeySha256' -Value $stableClaim.KeySha256
                        Write-EvidenceState -Directory $EvidenceDirectory -State $state
                    }

                    $userTurnObserved = Assert-AgentBrowserUserTurnAcknowledgement -BaselineHashes $baselineUserHashes -CurrentTurns $ackSnapshot.UserTurns
                    Set-ObjectProperty -InputObject $attemptRecord -Name 'userTurnObserved' -Value $userTurnObserved
                    Set-ObjectProperty -InputObject $attemptRecord -Name 'generatingObserved' -Value ([bool]$ackSnapshot.Generating)
                    Set-ObjectProperty -InputObject $attemptRecord -Name 'composerSha256Observed' -Value (Get-Sha256Text -Text $ackSnapshot.ComposerValue)
                    $composerCleared = $ackSnapshot.ComposerCount -eq 1 -and (Test-ComposerValueEmpty -Value $ackSnapshot.ComposerValue)
                    $progressObserved = [bool]$ackSnapshot.Generating -or $composerCleared
                    if ($progressObserved) {
                        break
                    }
                }
                catch {
                    if ((Get-ExceptionCategory -Exception $_.Exception) -in @('AgentBrowserCliFailed', 'AgentBrowserTargetMissing', 'AgentBrowserPageStateInvalid')) {
                        $lastSnapshot = $null
                        $userTurnObserved = $false
                        continue
                    }
                    throw
                }
            } while ([DateTime]::UtcNow -lt $observationDeadline -and [DateTime]::UtcNow -lt $responseDeadline)
        }
        catch {
            $observationCategory = Get-ExceptionCategory -Exception $_.Exception
            $observationMessage = $_.Exception.Message
            $baselineAmbiguous = $observationCategory -in @('UserTurnBaselineMismatch', 'UserTurnAcknowledgementMismatch')
            Set-ObjectProperty -InputObject $attemptRecord -Name 'outcome' -Value $(if ($baselineAmbiguous) { 'recovery-required' } else { 'post-click-observation-error' })
            Set-ObjectProperty -InputObject $state -Name 'targetBinding' -Value (ConvertTo-AgentBrowserTargetBinding -Target $ackTarget)
            if ($baselineAmbiguous) {
                Set-ObjectProperty -InputObject $state -Name 'retryOutcome' -Value 'recovery-required'
                Set-ObjectProperty -InputObject $state -Name 'submissionAcknowledged' -Value $false
            }
            Set-SendUncertainState -EvidenceDirectory $EvidenceDirectory -State $state -Reason 'post-click-observation-error' -InvokeReturned:$true
            if ($baselineAmbiguous) {
                Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'RecoveryRequired' -Message ("Post-click user-turn evidence is ambiguous ($observationCategory); automatic retry is prohibited.") -Details ([ordered]@{ observationCategory = $observationCategory })
            }
            Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'SendUncertain' -Message ("The click returned, but post-click structural observation failed ($observationCategory): $observationMessage Automatic resend is prohibited.") -Details ([ordered]@{ observationCategory = $observationCategory })
        }

        if ($progressObserved) {
            $finalBinding = ConvertTo-AgentBrowserTargetBinding -Target $ackTarget
            Set-ObjectProperty -InputObject $state -Name 'targetBinding' -Value $finalBinding
            if ([string]::IsNullOrWhiteSpace($boundConversationUrl)) {
                Set-ObjectProperty -InputObject $state -Name 'conversationUrlBindingPending' -Value $true
            }
            else {
                Set-ObjectProperty -InputObject $state -Name 'conversationUrlBound' -Value $boundConversationUrl
                Set-ObjectProperty -InputObject $state -Name 'conversationUrlBindingPending' -Value $false
            }
            Set-ObjectProperty -InputObject $attemptRecord -Name 'outcome' -Value 'sent-progress'
            Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'sent'
            Set-ObjectProperty -InputObject $state -Name 'submissionAcknowledged' -Value $true
            Set-ObjectProperty -InputObject $state -Name 'sentAtUtc' -Value ([DateTime]::UtcNow.ToString('o'))
            Write-EvidenceState -Directory $EvidenceDirectory -State $state

            return [ordered]@{
                ok = $true
                command = 'send'
                live = $true
                transport = $Script:AgentBrowserTransport
                submittedExactlyOnce = $true
                sendActionInvokedOnce = $attemptNumber -eq 1
                sendActionCount = $attemptNumber
                attemptCount = $attemptNumber
                submissionAcknowledged = $true
                codexThreadId = $threadId
                idempotencyKey = $IdempotencyKeyValue
                promptSha256 = $promptSha
                baselineResponseCount = $baselineHashes.Count
                targetBinding = Get-ObjectProperty $state 'targetBinding' $null
                targetClaimKeySha256 = [string](Get-ObjectProperty $state 'targetClaimKeySha256' '')
                conversationUrl = $boundConversationUrl
                conversationUrlExact = -not [string]::IsNullOrWhiteSpace($boundConversationUrl)
                conversationUrlBindingPending = [bool](Get-ObjectProperty $state 'conversationUrlBindingPending' $false)
                responseDeadlineAtUtc = [string](Get-ObjectProperty $state 'responseDeadlineAtUtc' '')
                selectedModeLabel = 'Pro'
                clipboardUsed = $false
                focusRequested = $false
            }
        }

        $composerSha = if ($null -eq $lastSnapshot) { '' } else { Get-Sha256Text -Text $lastSnapshot.ComposerValue }
        $provedNotSubmitted = $null -ne $lastSnapshot -and [string]$lastSnapshot.Url -ceq 'https://chatgpt.com/' -and -not $lastSnapshot.UrlExact -and
            -not $userTurnObserved -and -not $lastSnapshot.Generating -and $lastSnapshot.ComposerCount -eq 1 -and
            $composerSha -ceq $promptSha
        if ($provedNotSubmitted -and $attemptNumber -lt 2) {
            Set-ObjectProperty -InputObject $attemptRecord -Name 'outcome' -Value 'proved-not-submitted'
            Write-EvidenceState -Directory $EvidenceDirectory -State $state
            $attemptNumber++
            continue
        }
        if ($provedNotSubmitted) {
            Set-ObjectProperty -InputObject $attemptRecord -Name 'outcome' -Value 'retry-not-submitted'
            Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'send-uncertain'
            Set-ObjectProperty -InputObject $state -Name 'retryOutcome' -Value 'retry-not-submitted'
            Set-ObjectProperty -InputObject $state -Name 'submissionAcknowledged' -Value $false
            Write-EvidenceState -Directory $EvidenceDirectory -State $state
            Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'RetryNotSubmitted' -Message 'Both clicks were durably proved not submitted. No third send is allowed.'
        }

        Set-ObjectProperty -InputObject $attemptRecord -Name 'outcome' -Value 'recovery-required'
        Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'send-uncertain'
        Set-ObjectProperty -InputObject $state -Name 'retryOutcome' -Value 'recovery-required'
        Set-ObjectProperty -InputObject $state -Name 'submissionAcknowledged' -Value $false
        Write-EvidenceState -Directory $EvidenceDirectory -State $state
        Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'RecoveryRequired' -Message 'Submission progress could not be proved and the composer no longer proves a safe retry. Automatic resend is prohibited.'
    }
    }
    finally {
        Exit-UiMutex -Lease $retryUiLease
        Exit-UiMutex -Lease $uiLease
    }
}

function Get-AgentBrowserWaitObservation {
    param(
        [Parameter(Mandatory = $true)]$Binding,
        [AllowEmptyString()][string]$ExpectedConversationUrl = ''
    )

    $uiLease = $null
    try {
        $uiLease = Enter-UiMutex -TargetBinding $Binding
        $target = Resolve-AgentBrowserTarget -ExpectedBinding $Binding -ExpectedConversationUrl $ExpectedConversationUrl -AllowExactUrlReopen:([bool]$ExpectedConversationUrl)
        $snapshot = Get-AgentBrowserPageSnapshot -Target $target
        Assert-AgentBrowserAuthBarrierAbsent -Snapshot $snapshot
        if (-not [string]::IsNullOrWhiteSpace($ExpectedConversationUrl)) {
            Assert-ConversationUrlMatch -ExpectedUrl $ExpectedConversationUrl -ActualUrl $snapshot.Url
        }
        return [pscustomobject]@{
            Transient = $false
            Generating = $snapshot.Generating
            Responses = $snapshot.Responses
            Target = $target
            Snapshot = $snapshot
        }
    }
    catch {
        $category = Get-ExceptionCategory -Exception $_.Exception
        if ($category -in @('AgentBrowserCliFailed', 'AgentBrowserTargetMissing', 'AgentBrowserPageStateInvalid')) {
            return [pscustomobject]@{ Transient = $true; Generating = $false; Responses = @(); Target = $null; Snapshot = $null }
        }
        throw
    }
    finally {
        Exit-UiMutex -Lease $uiLease
    }
}

function Invoke-AgentBrowserWait {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][int]$TimeoutSecondsValue,
        [Parameter(Mandatory = $true)][int]$PollMillisecondsValue,
        [Parameter(Mandatory = $true)][string]$CodexThreadIdValue
    )

    $state = Read-EvidenceState -Directory $EvidenceDirectory
    if ($null -eq $state) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.Evidence -Category 'EvidenceStateMissing' -Message 'send must create state.json before wait.'
    }
    $threadId = Assert-StateCodexThreadId -State $state -ExpectedCodexThreadId $CodexThreadIdValue
    $phase = [string](Get-ObjectProperty $state 'phase' '')
    if ($phase -eq 'completed') {
        $completedResponse = Get-CompletedResponseResult -EvidenceDirectory $EvidenceDirectory -CodexThreadIdValue $threadId
        return [ordered]@{
            ok = $true; command = 'wait'; live = $true; completed = $true; reusedCompletedEvidence = $true; codexThreadId = $threadId
            responseSha256 = $completedResponse.responseSha256; responseBytes = $completedResponse.responseBytes
            conversationUrl = $completedResponse.conversationUrl; submissionAcknowledged = $completedResponse.submissionAcknowledged
            observationalRecovery = $completedResponse.observationalRecovery
        }
    }
    if ([string](Get-ObjectProperty $state 'transport' '') -ne $Script:AgentBrowserTransport) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'LegacyTransportNotResumable' -Message 'Incomplete windows-uia evidence is historical and cannot be resumed by the V2 transport. Automatic resend remains prohibited.'
    }
    if (@('sent', 'send-intent', 'send-uncertain') -notcontains $phase) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.SendUncertain -Category 'SendStateNotWaitable' -Message 'wait requires sent or an uncertain post-click phase. It never resubmits.' -Details ([ordered]@{ phase = $phase })
    }
    $effectiveTimeoutSeconds = Get-EffectiveResponseTimeoutSeconds -State $state -RequestedTimeoutSeconds $TimeoutSecondsValue
    $binding = Get-ObjectProperty $state 'targetBinding' $null
    if ($null -eq $binding) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.WindowSelection -Category 'AgentBrowserTargetBindingMissing' -Message 'Incomplete evidence has no immutable browser target binding.'
    }
    $null = Assert-AgentBrowserTargetClaimOwnership -CodexThreadIdValue $threadId -Binding $binding -EvidenceDirectory $EvidenceDirectory
    $boundConversationUrl = ''
    try {
        $boundConversationUrl = Get-BoundConversationUrlFromState -State $state
    }
    catch {
        $canObserveUnboundV2Attempt = (
            [string](Get-ObjectProperty $state 'transport' '') -eq $Script:AgentBrowserTransport -and
            $phase -in @('sent', 'send-intent', 'send-uncertain') -and
            [bool](Get-ObjectProperty $state 'invokeAttempted' $false) -and
            -not [bool](Get-ObjectProperty $state 'automaticResendAllowed' $true) -and
            [string]::IsNullOrWhiteSpace([string](Get-ObjectProperty $state 'conversationUrlBeforeSend' '')) -and
            [string]::IsNullOrWhiteSpace([string](Get-ObjectProperty $state 'conversationUrlBound' ''))
        )
        if ((Get-ExceptionCategory -Exception $_.Exception) -ne 'ConversationUrlUnbound' -or
            (-not (Test-PendingFreshConversationBinding -State $state) -and -not $canObserveUnboundV2Attempt)) {
            throw
        }
    }

    $baseline = @((Get-ObjectProperty $state 'baselineResponseSha256' @()) | ForEach-Object { [string]$_ })
    $observationState = [pscustomobject]@{
        Binding = $binding
        Target = $null
        Snapshot = $null
        BoundConversationUrl = $boundConversationUrl
    }
    $pollArguments = @{
        BaselineHashes = $baseline
        ObservationProvider = {
            $observation = Get-AgentBrowserWaitObservation -Binding $observationState.Binding -ExpectedConversationUrl $observationState.BoundConversationUrl
            if (-not $observation.Transient) {
                $observationState.Target = $observation.Target
                $observationState.Snapshot = $observation.Snapshot
                $newBinding = ConvertTo-AgentBrowserTargetBinding -Target $observationState.Target
                $bindingChanged = [string](Get-ObjectProperty $newBinding 'sessionKey' '') -cne [string](Get-ObjectProperty $observationState.Binding 'sessionKey' '') -or
                    [string](Get-ObjectProperty $newBinding 'url' '') -cne [string](Get-ObjectProperty $observationState.Binding 'url' '')
                if ($bindingChanged) {
                    $observationState.Binding = $newBinding
                    Set-ObjectProperty -InputObject $state -Name 'targetBinding' -Value $observationState.Binding
                    Write-EvidenceState -Directory $EvidenceDirectory -State $state
                }
                if ([string]::IsNullOrWhiteSpace($observationState.BoundConversationUrl) -and $observationState.Snapshot.UrlExact) {
                    $observationState.BoundConversationUrl = [string]$observationState.Snapshot.Url
                    Set-ObjectProperty -InputObject $state -Name 'conversationUrlBound' -Value $observationState.BoundConversationUrl
                    Set-ObjectProperty -InputObject $state -Name 'conversationUrlBoundAtUtc' -Value ([DateTime]::UtcNow.ToString('o'))
                    Set-ObjectProperty -InputObject $state -Name 'conversationUrlBindingPending' -Value $false
                    Set-ObjectProperty -InputObject $state -Name 'submissionAcknowledged' -Value $true
                    Write-EvidenceState -Directory $EvidenceDirectory -State $state
                    $stableClaim = Reserve-AgentBrowserTargetClaim `
                        -CodexThreadIdValue $threadId `
                        -EvidenceDirectory $EvidenceDirectory `
                        -IdempotencyKeySha256Value ([string](Get-ObjectProperty $state 'idempotencyKeySha256' '')) `
                        -Binding $observationState.Binding
                    Set-ObjectProperty -InputObject $state -Name 'targetClaimKeySha256' -Value $stableClaim.KeySha256
                    Write-EvidenceState -Directory $EvidenceDirectory -State $state
                }
            }
            return $observation
        }
        SleepAction = { param($milliseconds) Start-Sleep -Milliseconds $milliseconds }
        UtcNowProvider = { [DateTime]::UtcNow }
        TimeoutSeconds = $effectiveTimeoutSeconds
        PollMilliseconds = $PollMillisecondsValue
    }
    $result = Invoke-PollUntilCompleted @pollArguments
    $boundConversationUrl = [string]$observationState.BoundConversationUrl
    $latestTarget = $observationState.Target
    $latestSnapshot = $observationState.Snapshot
    if ($null -eq $latestTarget -or $null -eq $latestSnapshot -or -not $latestSnapshot.UrlExact) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.UrlCapture -Category 'ExactConversationUrlUnavailable' -Message 'The completed response was isolated, but the same browser tab did not expose one exact conversation URL.'
    }
    if (-not [string]::IsNullOrWhiteSpace($boundConversationUrl)) {
        Assert-ConversationUrlMatch -ExpectedUrl $boundConversationUrl -ActualUrl $latestSnapshot.Url
    }
    else {
        $baselineUserHashes = @((Get-ObjectProperty $state 'baselineUserTurnSha256' @()) | ForEach-Object { [string]$_ })
        $null = Assert-AgentBrowserUserTurnAcknowledgement `
            -BaselineHashes $baselineUserHashes `
            -CurrentTurns $latestSnapshot.UserTurns
        $boundConversationUrl = [string]$latestSnapshot.Url
        Set-ObjectProperty -InputObject $state -Name 'conversationUrlBound' -Value $boundConversationUrl
        Set-ObjectProperty -InputObject $state -Name 'conversationUrlBoundAtUtc' -Value ([DateTime]::UtcNow.ToString('o'))
        Set-ObjectProperty -InputObject $state -Name 'conversationUrlBindingPending' -Value $false
        Set-ObjectProperty -InputObject $state -Name 'submissionAcknowledged' -Value $true
        $finalBinding = ConvertTo-AgentBrowserTargetBinding -Target $latestTarget
        $stableClaim = Reserve-AgentBrowserTargetClaim `
            -CodexThreadIdValue $threadId `
            -EvidenceDirectory $EvidenceDirectory `
            -IdempotencyKeySha256Value ([string](Get-ObjectProperty $state 'idempotencyKeySha256' '')) `
            -Binding $finalBinding
        Set-ObjectProperty -InputObject $state -Name 'targetClaimKeySha256' -Value $stableClaim.KeySha256
    }
    Set-ObjectProperty -InputObject $state -Name 'targetBinding' -Value (ConvertTo-AgentBrowserTargetBinding -Target $latestTarget)
    Write-EvidenceState -Directory $EvidenceDirectory -State $state

    $evidence = Complete-Evidence -EvidenceDirectory $EvidenceDirectory -State $state -Response $result.Response -ConversationUrl $boundConversationUrl -TransientObservationCount $result.TransientObservationCount -StablePollCount $result.StablePollCount -CodexThreadIdValue $threadId
    return [ordered]@{
        ok = $true
        command = 'wait'
        live = $true
        transport = $Script:AgentBrowserTransport
        completed = $true
        codexThreadId = $threadId
        responseSha256 = $evidence.response.sha256
        evidenceSha256 = [string](Get-ObjectProperty $state 'evidenceSha256' '')
        responseCharacters = $evidence.response.characters
        responseBytes = $evidence.response.bytes
        conversationUrl = $evidence.conversation.url
        submissionAcknowledged = $evidence.submission.acknowledged
        observationalRecovery = $phase -ne 'sent'
        transientObservationCount = $evidence.transientObservationCount
        stablePollCount = $evidence.stablePollCount
        clipboardUsed = $false
        focusRequested = $false
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
    if ($AllowComposerFocus -and @('send', 'run') -notcontains $Command) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'ComposerFocusModeInvalid' -Message 'AllowComposerFocus is valid only with send or run.'
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedConversationUrl) -and $Command -ne 'status') {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'ExpectedConversationUrlModeInvalid' -Message 'ExpectedConversationUrl is valid only with status.'
    }
    if ($TimeoutSeconds -lt 5 -or $TimeoutSeconds -gt 3600) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'TimeoutInvalid' -Message 'TimeoutSeconds must be between 5 and 3600.'
    }
    if ($ResponseTimeoutSeconds -lt 1 -or $ResponseTimeoutSeconds -gt 86400) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'ResponseTimeoutInvalid' -Message 'ResponseTimeoutSeconds must be between 1 and 86400.'
    }
    if ($PollMilliseconds -lt 250 -or $PollMilliseconds -gt 5000) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'PollIntervalInvalid' -Message 'PollMilliseconds must be between 250 and 5000.'
    }
    if (-not [string]::IsNullOrWhiteSpace($WindowRuntimeId)) {
        Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'LegacyWindowBindingRejected' -Message 'WindowRuntimeId belongs to the retired windows-uia transport and is not accepted by V2.'
    }
    foreach ($identity in @($BrowserId, $Profile, $TabId, $SessionKey)) {
        if (-not (Test-BoundedAgentBrowserIdentity -Value $identity -AllowEmpty)) {
            Throw-SidebarError -ExitCode $Script:ExitCodes.InvalidArguments -Category 'AgentBrowserTargetArgumentInvalid' -Message 'Browser/profile/tab/session arguments must be bounded opaque strings.'
        }
    }

    $threadId = ''
    if ($Command -in @('send', 'wait', 'response', 'run')) {
        $threadId = Resolve-CodexThreadId -Value $CodexThreadId
    }

    switch ($Command) {
        'status' {
            $target = Resolve-AgentBrowserCommandTarget -ExpectedConversationUrlValue $ExpectedConversationUrl
            $binding = ConvertTo-AgentBrowserTargetBinding -Target $target
            $uiLease = Enter-UiMutex -TargetBinding $binding
            try { $snapshot = Get-AgentBrowserPageSnapshot -Target $target }
            finally { Exit-UiMutex -Lease $uiLease }
            $payload = New-AgentBrowserStatusPayload -Target $target -Snapshot $snapshot
            try {
                Assert-AgentBrowserPageReady -Snapshot $snapshot
                Assert-ChatGptUrlState -UrlState ([pscustomobject]@{ Url = $snapshot.Url; Exact = $snapshot.UrlExact })
                if (-not [string]::IsNullOrWhiteSpace($ExpectedConversationUrl)) {
                    Assert-ConversationUrlMatch -ExpectedUrl $ExpectedConversationUrl -ActualUrl $snapshot.Url
                }
            }
            catch {
                Throw-SidebarError -ExitCode (Get-ExceptionExitCode -Exception $_.Exception) -Category (Get-ExceptionCategory -Exception $_.Exception) -Message $_.Exception.Message -Details $payload
            }
            return $payload
        }
        'new-chat' {
            $target = Resolve-AgentBrowserCommandTarget
            $uiLease = Enter-UiMutex -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $target)
            try { return Invoke-AgentBrowserNewChat -Target $target }
            finally { Exit-UiMutex -Lease $uiLease }
        }
        'send' {
            $directory = Resolve-EvidenceDirectory -Path $EvidenceDir
            $lock = Enter-EvidenceLock -Directory $directory
            try {
                $promptText = Read-PromptInput -PromptPathValue $PromptPath -PromptValue $Prompt
                $key = Resolve-IdempotencyKey -Value $IdempotencyKey
                $target = Resolve-AgentBrowserCommandTarget
                return Invoke-AgentBrowserSend `
                    -PromptText $promptText `
                    -EvidenceDirectory $directory `
                    -IdempotencyKeyValue $key `
                    -CodexThreadIdValue $threadId `
                    -RequireFreshConversation:$FreshConversation `
                    -RequireExistingConversation:(-not $FreshConversation) `
                    -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $target) `
                    -ResponseTimeoutSecondsValue $ResponseTimeoutSeconds
            }
            finally {
                $lock.Dispose()
            }
        }
        'wait' {
            $directory = Resolve-EvidenceDirectory -Path $EvidenceDir
            $lock = Enter-EvidenceLock -Directory $directory
            try {
                return Invoke-AgentBrowserWait -EvidenceDirectory $directory -TimeoutSecondsValue $TimeoutSeconds -PollMillisecondsValue $PollMilliseconds -CodexThreadIdValue $threadId
            }
            finally {
                $lock.Dispose()
            }
        }
        'response' {
            $directory = Resolve-EvidenceDirectory -Path $EvidenceDir
            $lock = Enter-EvidenceLock -Directory $directory
            try {
                return Get-CompletedResponseResult -EvidenceDirectory $directory -CodexThreadIdValue $threadId
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
                $target = Resolve-AgentBrowserCommandTarget
                $sourceLease = Enter-UiMutex -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $target)
                try { $newChatResult = Invoke-AgentBrowserNewChat -Target $target }
                finally { Exit-UiMutex -Lease $sourceLease }
                $sendResult = Invoke-AgentBrowserSend -PromptText $promptText -EvidenceDirectory $directory -IdempotencyKeyValue $key -CodexThreadIdValue $threadId -RequireFreshConversation -TargetBinding $newChatResult.targetBinding -ResponseTimeoutSecondsValue $TimeoutSeconds
                $waitResult = Invoke-AgentBrowserWait -EvidenceDirectory $directory -TimeoutSecondsValue $TimeoutSeconds -PollMillisecondsValue $PollMilliseconds -CodexThreadIdValue $threadId
                $responseResult = Get-CompletedResponseResult -EvidenceDirectory $directory -CodexThreadIdValue $threadId

                return [ordered]@{
                    ok = $true
                    command = 'run'
                    live = $true
                    transport = $Script:AgentBrowserTransport
                    submittedExactlyOnce = $sendResult.submittedExactlyOnce
                    sendActionInvokedOnce = $sendResult.sendActionInvokedOnce
                    submissionAcknowledged = $responseResult.submissionAcknowledged
                    completed = $waitResult.completed
                    codexThreadId = $threadId
                    idempotencyKey = $responseResult.idempotencyKey
                    promptSha256 = $sendResult.promptSha256
                    response = $responseResult.response
                    responseSha256 = $responseResult.responseSha256
                    responseBytes = $responseResult.responseBytes
                    conversationUrl = $responseResult.conversationUrl
                    clipboardUsed = $false
                    focusRequested = $false
                }
            }
            finally {
                $lock.Dispose()
            }
        }
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
