param(
    [Parameter(Mandatory=$true)]
    [string]$OutputPath,
    [int]$MonitorIndex = 0
)

try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    
    $screens = [System.Windows.Forms.Screen]::AllScreens
    $screen = if ($MonitorIndex -lt $screens.Length -and $MonitorIndex -ge 0) { $screens[$MonitorIndex] } else { [System.Windows.Forms.Screen]::PrimaryScreen }
    
    $bounds = $screen.Bounds
    $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    
    $dir = [System.IO.Path]::GetDirectoryName($OutputPath)
    if (-not [string]::IsNullOrEmpty($dir) -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    
    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
    
    Write-Output "SUCCESS:$OutputPath"
    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
