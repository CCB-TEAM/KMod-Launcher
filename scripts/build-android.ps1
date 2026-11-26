# Builds the Android APK without the Tauri CLI's build step.
# The CLI links the Rust library into the Gradle project with a symbolic link, which Windows only
# allows in developer mode. This script does the same steps by copying instead:
#   frontend -> cargo (aarch64-linux-android) -> copy the .so -> Gradle with the Rust task disabled.
# Usage: ./scripts/build-android.ps1 [-Release]
param([switch]$Release, [switch]$SkipFrontend)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

if (!$env:ANDROID_HOME) { $env:ANDROID_HOME = "$env:LOCALAPPDATA/Android/Sdk" }
if (!$env:NDK_HOME) { $env:NDK_HOME = (Get-ChildItem "$env:ANDROID_HOME/ndk" | Sort-Object Name -Descending | Select-Object -First 1).FullName }
if (!$env:JAVA_HOME) { throw 'Set JAVA_HOME to a JDK 17+ (Android Studio ships one in jbr).' }
$bin = "$env:NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin"
$env:CC_aarch64_linux_android = "$bin/aarch64-linux-android24-clang.cmd"
$env:AR_aarch64_linux_android = "$bin/llvm-ar.exe"
$env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = "$bin/aarch64-linux-android24-clang.cmd"

if (!$SkipFrontend) {
    pnpm build
    if ($LASTEXITCODE) { throw 'Frontend build failed' }
}

$project = Join-Path $repo 'src-tauri/gen/android'
# the Tauri CLI would write the app version for Gradle; without it, derive it from tauri.conf.json here
$version = (Get-Content "$repo/src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json).version
$p = $version.Split('-')[0].Split('.')
$code = [int]$p[0] * 1000000 + [int]$p[1] * 1000 + [int]$p[2]
Set-Content "$project/app/tauri.properties" "tauri.android.versionName=$version`ntauri.android.versionCode=$code" -Encoding ascii
$generated = Join-Path $project 'app/src/main/java/team/ccb/kmod_launcher/generated'
New-Item -ItemType Directory -Force $generated | Out-Null
$env:TAURI_ANDROID_PROJECT_PATH = $project
$env:WRY_ANDROID_PACKAGE = 'team.ccb.kmod_launcher'
$env:WRY_ANDROID_LIBRARY = 'kmod_launcher_lib'
$env:WRY_ANDROID_KOTLIN_FILES_OUT_DIR = $generated

$profile = if ($Release) { 'release' } else { 'debug' }
$cargoArgs = @('build', '--target', 'aarch64-linux-android', '-p', 'kmod-launcher', '--lib', '--features', 'custom-protocol')
if ($Release) { $cargoArgs += '--release' }
cargo @cargoArgs
if ($LASTEXITCODE) { throw 'Rust build failed' }

$jni = Join-Path $project 'app/src/main/jniLibs/arm64-v8a'
New-Item -ItemType Directory -Force $jni | Out-Null
Copy-Item "target/aarch64-linux-android/$profile/libkmod_launcher_lib.so" $jni -Force
& "$bin/llvm-strip.exe" --strip-debug "$jni/libkmod_launcher_lib.so"

Push-Location $project
try {
    $task = if ($Release) { ':app:assembleArm64Release' } else { ':app:assembleArm64Debug' }
    ./gradlew.bat $task -PkmodPrebuiltRust=true --console=plain
    if ($LASTEXITCODE) { throw 'Gradle build failed' }
} finally { Pop-Location }
$outDir = "$project/app/build/outputs/apk/arm64/$profile"
if ($Release) {
    # Gradle leaves the release APK unsigned: align it and sign it with release.keystore (alias and password in release-key.txt, both git-ignored; back them up,
    # an app signed with another key cannot update an installed one).
    $bt = (Get-ChildItem "$env:ANDROID_HOME/build-tools" | Sort-Object Name -Descending | Select-Object -First 1).FullName
    $kv = @{}; Get-Content "$repo/release-key.txt" | ForEach-Object { $p = $_ -split '=', 2; if ($p.Count -eq 2) { $kv[$p[0]] = $p[1] } }
    $unsigned = Get-ChildItem $outDir -Filter '*unsigned.apk' | Select-Object -First 1
    if (!$unsigned) { throw "No unsigned release APK in $outDir" }
    $aligned = Join-Path $outDir 'aligned.apk'
    $final = Join-Path $outDir 'kmod-launcher-release.apk'
    Remove-Item $aligned, $final -ErrorAction SilentlyContinue
    & "$bt/zipalign.exe" -p -f 4 $unsigned.FullName $aligned
    if ($LASTEXITCODE) { throw 'zipalign failed' }
    & "$bt/apksigner.bat" sign --ks "$repo/release.keystore" --ks-pass "pass:$($kv['password'])" --key-pass "pass:$($kv['password'])" --ks-key-alias $kv['alias'] --out $final $aligned
    if ($LASTEXITCODE) { throw 'apksigner failed' }
    Remove-Item $aligned
    Write-Host "APK: $final"
} else {
    Write-Host "APK: $outDir"
}
