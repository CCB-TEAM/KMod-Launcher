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
Write-Host "APK: $project/app/build/outputs/apk/arm64/$profile"
