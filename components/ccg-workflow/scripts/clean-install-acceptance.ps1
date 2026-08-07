param(
  [string]$GoExecutable = 'go'
)

$ErrorActionPreference = 'Stop'
$goPath = (Get-Command -Name $GoExecutable -ErrorAction Stop).Source
$goVersion = & $goPath version
if ($LASTEXITCODE -ne 0 -or $goVersion -notmatch '\bgo1\.21\.13\b') {
  throw "Clean-install acceptance requires Go 1.21.13; got: $goVersion"
}

$previousRun = $env:CCG_CLEAN_INSTALL_E2E
$previousGo = $env:CCG_CLEAN_INSTALL_GO
try {
  $env:CCG_CLEAN_INSTALL_E2E = '1'
  $env:CCG_CLEAN_INSTALL_GO = $goPath
  & corepack pnpm exec vitest run tests/clean-install-acceptance.test.mjs
  exit $LASTEXITCODE
}
finally {
  $env:CCG_CLEAN_INSTALL_E2E = $previousRun
  $env:CCG_CLEAN_INSTALL_GO = $previousGo
}
