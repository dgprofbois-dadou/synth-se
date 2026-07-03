# Regénère catalog.json à partir de tous les .svg de ce dossier (aucune édition manuelle).
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$svgs = Get-ChildItem -Path $here -Filter '*.svg' -File | Sort-Object Name
$shapes = @($svgs | ForEach-Object { $_.Name })
$catalog = [ordered]@{
    defaultSize   = 120
    defaultPreset = [ordered]@{
        fill        = '#ffeb3b'
        stroke      = '#333333'
        strokeW     = 2
        alphaIdle   = 0.35
        alphaActive = 0.55
        blendMode   = 'multiply'
    }
    shapes      = $shapes
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$out = Join-Path $here 'catalog.json'
$catalog | ConvertTo-Json -Depth 6 | Set-Content -Path $out -Encoding UTF8
Write-Host "catalog.json mis a jour ($($shapes.Count) forme(s))"
