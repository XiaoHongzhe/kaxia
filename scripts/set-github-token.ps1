$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'Kaxia'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$secure = Read-Host -AsSecureString 'Paste GitHub token'
$encrypted = ConvertFrom-SecureString -SecureString $secure
Set-Content -LiteralPath (Join-Path $dir 'github-token.dpapi') -Value $encrypted -Encoding ascii
icacls $dir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
Write-Host "Saved encrypted GitHub token to $dir\github-token.dpapi"
