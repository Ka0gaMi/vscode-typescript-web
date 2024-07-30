$urlListFile = "./vueUrls.txt"
$downloadFolder = "./resources/vue"
$vueVersion = "3.4.33"

if (-not (Test-Path $urlListFile)) {
    Write-Error "File $urlListFile not found"
    exit 1
}

$packageUrls = Get-Content $urlListFile

if (-not (Test-Path $downloadFolder)) {
    New-Item -ItemType Directory -Path $downloadFolder
}

foreach ($url in $packageUrls) {
    if ($url.Trim() -eq "" -or $url.StartsWith("#")) {
        continue
    }
    $packageFile = Split-Path $url -Leaf
    $packagePath = ($url -split "vue@$vueVersion",2)[1].TrimStart("/").Replace("/", "\")
    $packageDirectory = "/" + ($packagePath -split $packageFile,2)[0].TrimEnd("\")
    if ($packageDirectory -ne "./") {
        $fullPath = Join-Path $downloadFolder $packageDirectory
        if (-not (Test-Path $fullPath)) {
            New-Item -ItemType Directory -Path $fullPath
        }
    }
    
    $webRequest = Invoke-WebRequest -Uri $url -OutFile "$downloadFolder\$packagePath" -Verbose

    if ($webRequest.StatusCode -ne 200) {
        Write-Error "Failed to download $packageFile"
        Write-Output $webRequest
        Write-Output $url
    }
    else
    {
        Wite-Output "Downloaded $packageFile"
    }
}