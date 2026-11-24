$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Windows.Forms
    Write-Host 'This check does not change your installed app or project files.'
    Write-Host 'Select an existing football video when prompted. Nothing is uploaded.'
    $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'check-files.json') -Raw | ConvertFrom-Json
    foreach ($item in $manifest.files) {
        if ($item.path -notmatch '^(media/bin/(ffmpeg|ffprobe)\.exe|check-windows-media\.py)$') {
            throw 'Unexpected file in the diagnostic manifest.'
        }
        $actual = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $item.path) -Algorithm SHA256).Hash
        if ($actual -ne $item.sha256) { throw "The diagnostic download is incomplete or changed: $($item.path)" }
    }
    if ($manifest.files.Count -ne 3) { throw 'Incomplete diagnostic manifest.' }
    $locations = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Annotate'),
        (Join-Path $env:LOCALAPPDATA 'Programs\annotate-desktop'),
        (Join-Path $env:ProgramFiles 'Annotate')
    )
    $install = $locations | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'resources\runtime\python\python.exe') } | Select-Object -First 1
    if (-not $install) {
        $app = New-Object System.Windows.Forms.OpenFileDialog
        $app.Title = 'Select Annotate.exe in your installed Annotate folder'
        $app.Filter = 'Annotate application (Annotate.exe)|Annotate.exe'
        if ($app.ShowDialog() -ne 'OK') { exit 0 }
        $install = Split-Path -Parent $app.FileName
        $app.Dispose()
    }
    $runtime = Join-Path $install 'resources\runtime'
    $python = Join-Path $runtime 'python\python.exe'
    if (-not (Test-Path -LiteralPath $python)) { throw 'The selected folder does not contain the bundled Python runtime.' }
    $video = New-Object System.Windows.Forms.OpenFileDialog
    $video.Title = 'Select a football video for the comparison'
    $video.Filter = 'Video files|*.mp4;*.mkv;*.mov;*.avi;*.webm;*.m4v;*.ts|All files|*.*'
    if ($video.ShowDialog() -ne 'OK') { exit 0 }
    $videoPath = $video.FileName
    $video.Dispose()
    $env:PYTHONDONTWRITEBYTECODE = '1'
    $env:PYTHONNOUSERSITE = '1'
    & $python (Join-Path $PSScriptRoot 'check-windows-media.py') --runtime $runtime --candidate (Join-Path $PSScriptRoot 'media') --video $videoPath --output $PSScriptRoot
    $result = $LASTEXITCODE
    Write-Host 'The results folder is beside this launcher. Send results.json and commands.log back to Patrick.'
    exit $result
} catch {
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'launcher-error.txt') -Encoding UTF8
    Write-Host $_ -ForegroundColor Red
    Write-Host 'Details were saved beside this launcher as launcher-error.txt.'
    exit 1
}
