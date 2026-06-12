// Builds a standalone, double-clickable Guck from the Electron runtime that
// npm install already downloaded — no packager dependency. This is all an
// Electron "build" is: the prebuilt runtime with the app in resources/app
// and the binary renamed.
//
//   npm run package  →  dist/Guck/Guck.exe   (Windows)
//                       dist/Guck/Guck.app   (macOS)
//                       dist/Guck/guck       (Linux)

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const dist = path.join(root, 'dist', 'Guck')
const electronDist = path.join(root, 'node_modules', 'electron', 'dist')

if (!fs.existsSync(electronDist)) {
  console.error('Electron runtime not found — run `npm install` first.')
  process.exit(1)
}

fs.rmSync(dist, { recursive: true, force: true })
fs.cpSync(electronDist, dist, { recursive: true })

// the app the runtime will load (replaces the default splash app)
const appFiles = ['package.json', 'main.js', 'preload.js']
const appDirs = ['renderer', 'assets']
let appDir
let launch

if (process.platform === 'darwin') {
  fs.renameSync(path.join(dist, 'Electron.app'), path.join(dist, 'Guck.app'))
  appDir = path.join(dist, 'Guck.app', 'Contents', 'Resources', 'app')
  launch = path.join(dist, 'Guck.app')
} else {
  const exe = process.platform === 'win32' ? 'electron.exe' : 'electron'
  const out = process.platform === 'win32' ? 'Guck.exe' : 'guck'
  fs.renameSync(path.join(dist, exe), path.join(dist, out))
  appDir = path.join(dist, 'resources', 'app')
  launch = path.join(dist, out)
}

fs.rmSync(path.join(path.dirname(appDir), 'default_app.asar'), { force: true })
fs.mkdirSync(appDir, { recursive: true })
for (const f of appFiles) fs.copyFileSync(path.join(root, f), path.join(appDir, f))
for (const d of appDirs) fs.cpSync(path.join(root, d), path.join(appDir, d), { recursive: true })

console.log(`packaged: ${launch}`)
