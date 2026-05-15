# Servidor HTTP para o Dashboard de Produtividade
# Coloca os ficheiros num servidor local sem precisar de software extra

$basePath = Split-Path -Parent $MyInvocation.MyCommand.Definition
$port = 8080

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host ""
Write-Host "  Dashboard rodando em: http://localhost:$port/dashboard.html"
Write-Host "  Pressione CTRL+C para parar."
Write-Host ""

function Get-MimeType($ext) {
    switch ($ext) {
        ".html" { "text/html; charset=utf-8" }
        ".md"   { "text/plain; charset=utf-8" }
        ".js"   { "application/javascript; charset=utf-8" }
        ".css"  { "text/css; charset=utf-8" }
        ".json" { "application/json; charset=utf-8" }
        ".ico"  { "image/x-icon" }
        ".png"  { "image/png" }
        default { "application/octet-stream" }
    }
}

function Send-Json($response, $json, $status = 200) {
    $response.StatusCode = $status
    $response.ContentType = "application/json; charset=utf-8"
    $response.Headers.Add("Access-Control-Allow-Origin", "*")
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.OutputStream.Close()
}

while ($listener.IsListening) {
    try {
        $context  = $listener.GetContext()
        $request  = $context.Request
        $response = $context.Response

        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

        # CORS preflight
        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 204
            $response.Close()
            continue
        }

        $localPath = $request.Url.LocalPath

        # POST /save — grava um ficheiro .md
        if ($request.HttpMethod -eq "POST" -and $localPath -eq "/save") {
            $reader   = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $body     = $reader.ReadToEnd() | ConvertFrom-Json
            # Seguranca: apenas .md dentro do basePath
            $safeName = ($body.filename -replace '\.\.', '') -replace '[*?"<>|]', '_'
            $safeName = $safeName.Replace("/", [System.IO.Path]::DirectorySeparatorChar)
            $filePath = Join-Path $basePath $safeName
            # Garante que a pasta existe
            $dir = Split-Path $filePath -Parent
            if (-not (Test-Path $dir)) { New-Item $dir -ItemType Directory -Force | Out-Null }
            [System.IO.File]::WriteAllText($filePath, $body.content, [System.Text.Encoding]::UTF8)
            Send-Json $response '{"ok":true}'
            continue
        }

        # GET /list?dir=xxx — lista ficheiros de uma pasta
        if ($request.HttpMethod -eq "GET" -and $localPath -eq "/list") {
            $dirParam = $request.QueryString["dir"]
            if (-not $dirParam) { $dirParam = "" }
            $dirParam  = $dirParam -replace '\.\.', ''
            $dirSafe   = $dirParam.Replace("/", [System.IO.Path]::DirectorySeparatorChar)
            $dirPath   = Join-Path $basePath $dirSafe

            $items = @()
            if (Test-Path $dirPath -PathType Container) {
                Get-ChildItem $dirPath | ForEach-Object {
                    $items += [PSCustomObject]@{
                        name  = $_.Name
                        isDir = $_.PSIsContainer
                    }
                }
            }
            $json = if ($items.Count -eq 0) { "[]" } else { $items | ConvertTo-Json -AsArray }
            Send-Json $response $json
            continue
        }

        # GET ficheiros estaticos
        if ($localPath -eq "/" -or $localPath -eq "") { $localPath = "/dashboard.html" }
        $safePath = $localPath.TrimStart("/").Replace("/", [System.IO.Path]::DirectorySeparatorChar)
        $filePath = Join-Path $basePath $safePath

        if (Test-Path $filePath -PathType Leaf) {
            $ext     = [System.IO.Path]::GetExtension($filePath).ToLower()
            $bytes   = [System.IO.File]::ReadAllBytes($filePath)
            $lastMod = (Get-Item $filePath).LastWriteTimeUtc.ToString("R")
            $response.StatusCode       = 200
            $response.ContentType      = Get-MimeType $ext
            $response.Headers.Add("Last-Modified", $lastMod)
            $response.Headers.Add("Cache-Control", "no-cache, no-store")
            $response.ContentLength64  = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.OutputStream.Close()
        } else {
            $notFound = [System.Text.Encoding]::UTF8.GetBytes("Not found")
            $response.StatusCode      = 404
            $response.ContentLength64 = $notFound.Length
            $response.OutputStream.Write($notFound, 0, $notFound.Length)
            $response.OutputStream.Close()
        }
    }
    catch {
        try { $context.Response.Close() } catch { }
    }
}
