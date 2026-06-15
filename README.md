# Guck (Git Duck)

**Guck** (Git Duck) is a tiny (almost) always-on-top git toolbar that lives on your screen as a little dude in a duck costume. Click the duck and it expands into a command bar for everyday git: status, diff, staging, commit, pull, push, branch switching, and file browsing — no terminal context-switching.

<p align="center">
<img width="310" height="131" alt="image" src="https://github.com/user-attachments/assets/354c5a83-a7c6-42f9-9eaf-60ef58c67d71" />
<br><br>
<img width="873" height="53" alt="image" src="https://github.com/user-attachments/assets/097a876e-2867-414d-8d8f-d699f8807c1f" />
</p>

The duck keeps an eye on your repo even while idle: a **?** bubble appears when you have uncommitted changes.

<p align="center">
<img width="266" height="130" alt="image" src="https://github.com/user-attachments/assets/8c163eab-5e1d-4c40-baab-bc433f427b48" />
</p>

## Why

The goal is a dev tool I actually want to use while working on other projects, with an emphasis on a minimalistic UI and simple experience. I believe it's important to dogfood (duckfood?) your own work, so the plan is to keep Guck running across my other projects. As I run into bugs or find new features I want to implement, I'll file issues and work through them over time.

It started with the goal of only addressing the most basic git use cases. Somewhere along the way I got emotionally attached to the little duck guy. Try him out. Drag him around. It's really fun.

## Download

V0 - [Linux](https://github.com/whuang602/guck/releases/download/v0/Guck-v0-linux-x64.zip) | [MacOS](https://github.com/whuang602/guck/releases/download/v0/Guck-v0-macos-arm64.zip) | [Windows](https://github.com/whuang602/guck/releases/download/v0/Guck-v0-windows-x64.zip)


Note: Linux and MacOS will require more extensive testing as I have primarily been playing with it on Windows.

**Why is it such a large download?** Electron apps comes with the chromium browser and Node.js runtime bundled in. It's a feature, albeit an expensive feature.

## Dependencies 

- **git** — must be on your `PATH` (Guck drives the real git binary)
- **Node.js 18+ and npm** — only needed to install/run from source

Guck has exactly **one** npm dependency: Electron, pinned to an exact version. Everything else is hand-written on Node/Electron built-ins — no other framework, no wrapper packages. Considering recent supply chain attacks for Node.js, I have really been trying to be less dependent on unnecessary dependencies.

## Start

```sh
npm install
npm start
```

The duck appears near the right edge of your screen. Click it to open the
bar; drag it (or the bar, by its left-edge grip) to wherever you like —
positions are remembered.

### Standalone app (no terminal)

```sh
npm run package
```

This assembles a double-clickable app at `dist/Guck/Guck.exe` (Windows),
`dist/Guck/Guck.app` (macOS), or `dist/Guck/guck` (Linux) from the Electron
runtime you already installed — no extra packaging tools. It's ~250 MB
because it bundles the Electron/Chromium runtime.

To start Guck automatically at login on Windows: press <kbd>Win</kbd>+<kbd>R</kbd>,
run `shell:startup`, and drop a shortcut to `Guck.exe` there.

## Stop

- The **✕** at the right end of the bar collapses Guck back to the duck, meaning it will keep running quietly.
- **Right-click** the duck (or anywhere on the bar/panel) and choose
  **Quit Guck** to exit completely.

## Settings & data

- Config (last directory, theme, duck/bar positions) lives at
  `%APPDATA%\guck\config.json` on Windows
  (`~/Library/Application Support/guck` on macOS).
- For HTTPS pull/push you can store a GitHub personal access token via the
  gear menu → *remote & github auth*. It is encrypted at rest with the OS
  keychain (DPAPI on Windows, Keychain on macOS), is never written to disk in
  plaintext, and never leaves your machine.

## License

MIT
