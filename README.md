# KMod Launcher

KMod Launcher installs and manages the [KMod loader](https://github.com/CCB-TEAM/KMod-Loader-Windows) for KARDS on Windows.

- Finds KARDS in your Steam libraries (or pick the folder by hand) and launches the game.
- Installs, updates and uninstalls the loader from GitHub releases (release or dev flavor, pre-releases optional), with SHA-256 of the download.
- Lists mods, switches them on and off, installs `.kmod` files and mod folders.
- Shows the loader logs.

The UI is Chinese only for now. Android is not covered yet.

## Development

Needs Node.js, pnpm, Rust (stable) and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
pnpm install
pnpm tauri dev
```

Build an exe: `pnpm tauri build --no-bundle`.

## License

MIT. KARDS belongs to its owner; this project is not affiliated with it. The interface was inspired by CeleMod, no code was taken from it.
