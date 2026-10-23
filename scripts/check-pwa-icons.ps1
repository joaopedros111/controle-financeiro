$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$icons = @($manifest.icons) + @([pscustomobject]@{src='icons/apple-touch-icon.png'; sizes='180x180'; purpose='apple'})
foreach ($icon in $icons) {
    $bitmap = [System.Drawing.Bitmap]::new((Join-Path $root $icon.src))
    try {
        $size = $bitmap.Width
        if ($icon.sizes -ne "${size}x${size}" -or $bitmap.Height -ne $size) { throw "Invalid dimensions: $($icon.src)" }
        $nonOpaque = 0; $maxRadius = 0.0; $foreground = 0
        for ($y = 0; $y -lt $size; $y++) {
            for ($x = 0; $x -lt $size; $x++) {
                $pixel = $bitmap.GetPixel($x, $y)
                if ($pixel.A -ne 255) { $nonOpaque++ }
                if ($icon.purpose -notin @('maskable', 'apple')) { continue }
                # The mint/white bars and yellow arrow are brighter than the teal background.
                if ($pixel.R -gt 130 -and $pixel.G -gt 130) {
                    $foreground++
                    $radius = [Math]::Sqrt([Math]::Pow(($x + 0.5) / $size - 0.5, 2) + [Math]::Pow(($y + 0.5) / $size - 0.5, 2))
                    $maxRadius = [Math]::Max($maxRadius, $radius)
                }
                if (($x -eq 0 -or $y -eq 0 -or $x -eq $size - 1 -or $y -eq $size - 1) -and
                    ($pixel.G -le $pixel.R -or $pixel.G -le $pixel.B)) { throw "Non-green border: $($icon.src)" }
            }
        }
        if ($icon.purpose -eq 'maskable' -and ($nonOpaque -ne 0 -or $foreground -eq 0 -or $maxRadius -gt 0.4)) {
            throw "Maskable icon is transparent or exceeds the safe circle: $($icon.src), radius=$maxRadius"
        }
        if ($icon.purpose -eq 'apple' -and ($nonOpaque -ne 0 -or $foreground -eq 0 -or $size -ne 180)) {
            throw "Apple icon must be opaque, 180x180 and contain the financial symbol"
        }
        [pscustomobject]@{ Icon=$icon.src; Size=$size; NonOpaquePixels=$nonOpaque; ForegroundRadius=[Math]::Round($maxRadius, 4) }
    } finally { $bitmap.Dispose() }
}
