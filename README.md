# KMod Launcher

KARDS 的 [KMod 加载器](https://github.com/CCB-TEAM/KMod-Loader-Windows)安装器与模组管理器，支持 Windows 和 Android。

## 功能

- **发现**：浏览和下载社区模组，显示下载量和 GitHub 星标（来自 [kmod-index](https://github.com/CCB-TEAM/kmod-index)，可添加其他索引），按 SHA-256 校验；原生 C++ 模组安装前会弹出警告。
- **模组管理**：Lua、原生 C++、Pak 三类分色显示；启用、停用、安装 `.kmod` 和 `.pak`、删除。
- **Windows**：在 Steam 库里找到 KARDS，安装、更新、卸载加载器（正式版或开发版），启动游戏。
- **Android**：内置安装器，把加载器注入手机上已安装的游戏并安装，不需要电脑。
- 检查并安装启动器自身的更新。
- 首次启动引导（选主题、设置 GitHub 代理）；GitHub 下载代理（预设 gh-proxy.com、gh-proxy.org）、日志查看、主题。

界面目前只有中文。

## 发布自己的模组

给模组仓库加上主题 `kmod-mod`，发一个带 `.kmod` 文件的 Release，约三小时内会出现在“发现”页。说明见 [kmod-index](https://github.com/CCB-TEAM/kmod-index)。

## 开发

需要 Node.js、pnpm、Rust 稳定版和 [Tauri 2 的依赖](https://v2.tauri.app/start/prerequisites/)。

```powershell
pnpm install
pnpm tauri dev
```

- Windows 程序：`pnpm tauri build --no-bundle`
- Android 安装包：`./scripts/build-android.ps1`（正式版加 `-Release`，需要 Android SDK/NDK 和本地签名密钥）
- 安装器内置的加载器库在 `src-tauri/gen/android/app/src/main/assets/loader/`

## 许可证

MIT。KARDS 属于其所有者，本项目与其没有隶属关系。界面风格参考了 CeleMod，没有使用其代码。
