param(
    [int]$Port = 8765,
    [switch]$Open
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$rootFull = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
$listener = $null

function Get-ContentType([string]$path) {
    switch ([IO.Path]::GetExtension($path).ToLowerInvariant()) {
        '.html' { 'text/html; charset=utf-8'; break }
        '.htm'  { 'text/html; charset=utf-8'; break }
        '.js'   { 'text/javascript; charset=utf-8'; break }
        '.mjs'  { 'text/javascript; charset=utf-8'; break }
        '.css'  { 'text/css; charset=utf-8'; break }
        '.json' { 'application/json; charset=utf-8'; break }
        '.webmanifest' { 'application/manifest+json; charset=utf-8'; break }
        '.svg'  { 'image/svg+xml'; break }
        '.png'  { 'image/png'; break }
        '.jpg'  { 'image/jpeg'; break }
        '.jpeg' { 'image/jpeg'; break }
        '.webp' { 'image/webp'; break }
        '.ico'  { 'image/x-icon'; break }
        '.woff' { 'font/woff'; break }
        '.woff2' { 'font/woff2'; break }
        '.txt'  { 'text/plain; charset=utf-8'; break }
        default { 'application/octet-stream' }
    }
}

try {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
} catch {
    Write-Host ""
    Write-Host "无法启动本地服务器：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host "端口 $Port 可能被占用。请关闭占用该端口的程序后重试。" -ForegroundColor Yellow
    exit 1
}

$url = "http://127.0.0.1:$Port/"
Write-Host ""
Write-Host "  卡匣 · Switch 卡带管家"
Write-Host "  地址  $url"
Write-Host "  数据  保存在浏览器 IndexedDB，不经过服务器"
Write-Host "  退出  关闭这个窗口即可"
Write-Host ""

if ($Open) {
    try { Start-Process $url | Out-Null } catch { }
}

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = New-Object System.IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 4096, $true)
            $requestLine = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }

            while ($true) {
                $line = $reader.ReadLine()
                if ($null -eq $line -or $line -eq '') { break }
            }

            $parts = $requestLine.Split(' ')
            if ($parts.Length -lt 2) { throw '无效请求' }
            $method = $parts[0].ToUpperInvariant()
            $rawPath = $parts[1]
            $pathOnly = $rawPath.Split('?')[0]
            $path = [Uri]::UnescapeDataString($pathOnly)
            if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }

            $relative = $path.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
            $full = [IO.Path]::GetFullPath((Join-Path $root $relative))
            if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
                $body = [Text.Encoding]::UTF8.GetBytes('403 Forbidden')
                $header = "HTTP/1.1 403 Forbidden`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
            } elseif (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
                $body = [Text.Encoding]::UTF8.GetBytes('404 Not Found')
                $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
            } elseif ($method -ne 'GET' -and $method -ne 'HEAD') {
                $body = [Text.Encoding]::UTF8.GetBytes('405 Method Not Allowed')
                $header = "HTTP/1.1 405 Method Not Allowed`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
            } else {
                $body = [IO.File]::ReadAllBytes($full)
                $contentType = Get-ContentType $full
                $header = "HTTP/1.1 200 OK`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache, no-store, must-revalidate`r`nX-Content-Type-Options: nosniff`r`nReferrer-Policy: no-referrer`r`nConnection: close`r`n`r`n"
            }

            $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            if ($method -ne 'HEAD' -and $body.Length -gt 0) {
                $stream.Write($body, 0, $body.Length)
            }
        } catch {
            try {
                $body = [Text.Encoding]::UTF8.GetBytes('500 Internal Server Error')
                $header = "HTTP/1.1 500 Internal Server Error`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
                $stream.Write([Text.Encoding]::ASCII.GetBytes($header), 0, [Text.Encoding]::ASCII.GetByteCount($header))
                $stream.Write($body, 0, $body.Length)
            } catch { }
        } finally {
            try { $client.Close() } catch { }
        }
    }
} finally {
    if ($listener) { $listener.Stop() }
}
