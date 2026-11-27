param(
    [string]$Message = 'Update Kaxia project',
    [string]$Repo = 'XiaoHongzhe/kaxia',
    [string]$Tag = '',
    [string]$Apk = '',
    [string]$ReleaseName = '',
    [string]$NotesFile = '',
    [string]$AssetName = '',
    [switch]$ReplaceAsset,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$tokenPath = Join-Path $env:LOCALAPPDATA 'Kaxia\github-token.dpapi'

if (-not (Test-Path -LiteralPath $tokenPath)) {
    throw "Local GitHub credential not found: $tokenPath"
}

$encrypted = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
$secure = ConvertTo-SecureString -String $encrypted
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:GITHUB_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    $arguments = @(
        (Join-Path $PSScriptRoot 'github_publish.py'),
        '--repo', $Repo,
        '--message', $Message
    )
    if ($Tag) { $arguments += @('--tag', $Tag) }
    if ($Apk) { $arguments += @('--apk', $Apk) }
    if ($ReleaseName) { $arguments += @('--release-name', $ReleaseName) }
    if ($NotesFile) { $arguments += @('--notes-file', $NotesFile) }
    if ($AssetName) { $arguments += @('--asset-name', $AssetName) }
    if ($ReplaceAsset) { $arguments += '--replace-asset' }
    if ($DryRun) { $arguments += '--dry-run' }

    & python @arguments
    if ($LASTEXITCODE -ne 0) { throw "github_publish.py exit code: $LASTEXITCODE" }
}
finally {
    Remove-Item Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
