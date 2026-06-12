# Guck 🦆

**Guck** (Git Duck) is a tiny always-on-top git toolbar that lives on your
screen as a little dude in a duck costume. Click the duck and it expands into a
command bar for everyday git: status, diff, staging, commit, pull, push,
branch switching, and file browsing — no terminal context-switching.

The duck keeps an eye on your repo even while idle: a **?** bubble appears
when you have uncommitted changes.

## Dependencies

- **git** — must be on your `PATH` (Guck drives the real git binary)
- **Node.js 18+ and npm** — only needed to install/run from source

Guck has exactly **one** npm dependency: Electron, pinned to an exact
version. Everything else is hand-written on Node/Electron built-ins — no
framework, no wrapper packages. Considering recent supply chain attacks for Node,
I have really been trying to be less dependent on unnecessary dependencies.

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

- The **✕** at the right end of the bar collapses Guck back to the duck —
  it keeps running quietly.
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
