@echo off
rem Serifa - abre o editor no navegador.
rem Com a pasta web\ ao lado, sobe um servidor local pelo PowerShell (nada para instalar).
rem Sem ela, abre a versao online no GitHub Pages.
setlocal
cd /d "%~dp0"
title Serifa
if not exist "web\index.html" (
  echo Pasta web nao encontrada. Abrindo a versao online...
  start "" "https://violet-pixel.github.io/Fiction-Writing-Editor/"
  exit /b 0
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = Get-Content -LiteralPath '%~f0' -Raw -Encoding UTF8; $m = '#SERIFA' + '-PS#'; Invoke-Expression $s.Substring($s.LastIndexOf($m) + $m.Length)"
if errorlevel 1 (
  echo.
  echo Nao foi possivel iniciar o servidor local. Abrindo a versao online...
  start "" "https://violet-pixel.github.io/Fiction-Writing-Editor/"
  pause
)
exit /b 0
#SERIFA-PS#
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path (Get-Location) 'web'))
$listener = $null
$port = 0
foreach ($p in 8790..8820) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l
    $port = $p
    break
  } catch { }
}
if (-not $listener) { exit 1 }
$url = "http://localhost:$port/"
Write-Host ''
Write-Host '  Serifa aberto no navegador:' $url
Write-Host '  Seus textos ficam salvos no navegador deste computador.'
Write-Host '  Para encerrar, feche esta janela.'
Write-Host ''
Start-Process $url
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.svg' = 'image/svg+xml'
  '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.wasm' = 'application/wasm'; '.txt' = 'text/plain; charset=utf-8'
  '.aff' = 'text/plain; charset=utf-8'; '.dic' = 'text/plain; charset=utf-8'
}
$csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
    $inside = $full.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
    if ($ctx.Request.HttpMethod -ne 'GET' -and $ctx.Request.HttpMethod -ne 'HEAD') {
      $res.StatusCode = 405; $bytes = [Text.Encoding]::UTF8.GetBytes('Metodo nao permitido')
    } elseif (-not $inside -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
      $res.StatusCode = 404; $bytes = [Text.Encoding]::UTF8.GetBytes('Nao encontrado')
    } else {
      $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
      if ($types.ContainsKey($ext)) { $res.ContentType = $types[$ext] } else { $res.ContentType = 'application/octet-stream' }
      $bytes = [IO.File]::ReadAllBytes($full)
    }
    $res.Headers['X-Content-Type-Options'] = 'nosniff'
    $res.Headers['X-Frame-Options'] = 'DENY'
    $res.Headers['Referrer-Policy'] = 'no-referrer'
    $res.Headers['Content-Security-Policy'] = $csp
    $res.Headers['Cache-Control'] = 'no-cache'
    $res.ContentLength64 = $bytes.Length
    if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
  } catch {
  } finally {
    $res.Close()
  }
}
