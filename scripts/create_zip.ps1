
$source = "c:\Users\sanky\Downloads\Webzz\dashboard"
$dest = "c:\Users\sanky\Downloads\Webzz\dashboard_export_temp"
$zipPath = "c:\Users\sanky\Downloads\Webzz\dashboard_project_v1.zip"

Write-Host "Creating export at $dest..."

# Clean up previous temp
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# Create dest
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# Copy files excluding node_modules, .next, .git
# Using a simpler approach: Copy specific folders/files or use Robocopy logic in PS

$items = Get-ChildItem -Path $source

foreach ($item in $items) {
    if ($item.Name -in "node_modules", ".next", ".git", "dashboard_export_temp", "dashboard_project_v1.zip", "test-api.js", "test-innertube.js", "test-ytdl.js", "list-models.js", "debug_package.py") {
        continue
    }
    
    Copy-Item -Path $item.FullName -Destination $dest -Recurse -Force
}

# Sanitize .env.local
$envPath = Join-Path $dest ".env.local"
if (Test-Path $envPath) {
    Write-Host "Sanitizing .env.local..."
    $content = Get-Content $envPath
    $newContent = @()
    foreach ($line in $content) {
        if ($line -match "^DATABASE_URL=") { $newContent += 'DATABASE_URL="yourkey"' }
        elseif ($line -match "^SESSION_SECRET=") { $newContent += 'SESSION_SECRET="yourkey"' }
        elseif ($line -match "^GEMINI_API_KEY=") { $newContent += 'GEMINI_API_KEY="yourkey"' }
        elseif ($line -match "^GROQ_API_KEY=") { $newContent += 'GROQ_API_KEY="yourkey"' }
        else { $newContent += $line }
    }
    $newContent | Set-Content $envPath
}

Write-Host "Zipping to $zipPath..."
Compress-Archive -Path "$dest\*" -DestinationPath $zipPath -Force

# Cleanup temp folder
Remove-Item $dest -Recurse -Force

Write-Host "Export completed successfully."
