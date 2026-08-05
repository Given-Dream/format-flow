$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outputDirectory = Join-Path $PSScriptRoot '..\resources'

function New-IconImage([int]$size) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $scale = $size / 256.0
  $margin = 12 * $scale
  $corner = 48 * $scale
  $backgroundPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $backgroundPath.AddArc($margin, $margin, $size - 2 * $margin, $size - 2 * $margin, 180, 90)
  $backgroundPath.AddArc($size - $margin - 2 * $corner, $margin, 2 * $corner, 2 * $corner, 270, 90)
  $backgroundPath.AddArc($size - $margin - 2 * $corner, $size - $margin - 2 * $corner, 2 * $corner, 2 * $corner, 0, 90)
  $backgroundPath.AddArc($margin, $size - $margin - 2 * $corner, 2 * $corner, 2 * $corner, 90, 90)
  $backgroundPath.CloseFigure()
  $backgroundBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 15, 23, 42))
  $graphics.FillPath($backgroundBrush, $backgroundPath)

  $bluePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 56, 189, 248), [single](22 * $scale))
  $bluePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $bluePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $bluePath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $bluePath.AddBezier(70 * $scale, 78 * $scale, 100 * $scale, 78 * $scale, 124 * $scale, 78 * $scale, 124 * $scale, 120 * $scale)
  $bluePath.AddBezier(124 * $scale, 120 * $scale, 124 * $scale, 162 * $scale, 148 * $scale, 178 * $scale, 186 * $scale, 178 * $scale)

  $greenPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 52, 211, 153), [single](22 * $scale))
  $greenPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $greenPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $greenPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $greenPath.AddBezier(70 * $scale, 178 * $scale, 100 * $scale, 178 * $scale, 142 * $scale, 178 * $scale, 142 * $scale, 136 * $scale)
  $greenPath.AddBezier(142 * $scale, 136 * $scale, 142 * $scale, 94 * $scale, 160 * $scale, 78 * $scale, 186 * $scale, 78 * $scale)

  $graphics.DrawPath($bluePen, $bluePath)
  $graphics.DrawPath($greenPen, $greenPath)

  $whiteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 248, 250, 252))
  $blueBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 56, 189, 248))
  $greenBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 52, 211, 153))
  $nodeRadius = 18 * $scale
  foreach ($node in @(@(70, 78), @(70, 178))) {
    $graphics.FillEllipse($whiteBrush, $node[0] * $scale - $nodeRadius, $node[1] * $scale - $nodeRadius, 2 * $nodeRadius, 2 * $nodeRadius)
  }
  $graphics.FillEllipse($blueBrush, 186 * $scale - $nodeRadius, 78 * $scale - $nodeRadius, 2 * $nodeRadius, 2 * $nodeRadius)
  $graphics.FillEllipse($greenBrush, 186 * $scale - $nodeRadius, 178 * $scale - $nodeRadius, 2 * $nodeRadius, 2 * $nodeRadius)

  $backgroundBrush.Dispose()
  $backgroundPath.Dispose()
  $bluePen.Dispose()
  $greenPen.Dispose()
  $bluePath.Dispose()
  $greenPath.Dispose()
  $whiteBrush.Dispose()
  $blueBrush.Dispose()
  $greenBrush.Dispose()
  $graphics.Dispose()
  return $bitmap
}

$images = @()
foreach ($size in @(256, 128, 64, 48, 32, 16)) {
  $bitmap = New-IconImage $size
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $images += ,@($size, $stream.ToArray())
  if ($size -eq 256) {
    [IO.File]::WriteAllBytes((Join-Path $outputDirectory 'format-flow-preview.png'), $stream.ToArray())
  }
  $stream.Dispose()
  $bitmap.Dispose()
}

$icoStream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($icoStream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$images.Count)
$offset = 6 + 16 * $images.Count
foreach ($image in $images) {
  $size = $image[0]
  $bytes = $image[1]
  $writer.Write([byte]$(if ($size -ge 256) { 0 } else { $size }))
  $writer.Write([byte]$(if ($size -ge 256) { 0 } else { $size }))
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$bytes.Length)
  $writer.Write([UInt32]$offset)
  $offset += $bytes.Length
}
foreach ($image in $images) {
  $writer.Write([byte[]]$image[1])
}
$writer.Flush()
[IO.File]::WriteAllBytes((Join-Path $outputDirectory 'format-flow.ico'), $icoStream.ToArray())
$writer.Dispose()
$icoStream.Dispose()
