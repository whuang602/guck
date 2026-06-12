// Guck (git duck) — main process: window management, git IPC, persistence.
// No runtime npm dependencies: git runs via the system binary through
// child_process.spawn (args as arrays, no shell), persistence is a JSON file.

const { app, BrowserWindow, ipcMain, screen, dialog, shell, safeStorage, Menu } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

// ---------- layout constants (see PRD design tokens) ----------
const BAR_W = 710          // window width in bar/panel mode
const BAR_H = 56           // bar (40px) + shadow padding
const PANEL_H = 252        // panel (244px) + gap — fallback before renderer measures
const PANEL_MIN = 96       // smallest panel area (tight forms)
const PANEL_MAX = 320      // largest before content scrolls
const MENU_H = 230         // drop-up settings menu
const IDLE_W = 48
const IDLE_H = 110
const EDGE_GAP = 12        // gap from right screen edge in bar mode
const BOTTOM_MARGIN = 80   // bar floats this far above the work-area bottom

let win = null
let mode = 'idle'          // 'idle' | 'bar' | 'panel' | 'menu'
let cwd = os.homedir()
let pollTimer = null
let idlePos = null         // user-chosen mascot position, persisted
let barPos = null          // user-chosen bar position {x, bottom}, persisted
let dragStart = null       // window position when a drag began
let panelArea = PANEL_H    // current panel content area (renderer-measured)

// ---------- tiny JSON persistence (replaces electron-store) ----------
const configFile = () => path.join(app.getPath('userData'), 'config.json')

// One-time migration from the app's pre-rename identity ("gitbar"): keeps the
// user's positions, theme, last directory, and encrypted token (DPAPI/Keychain
// ciphertext is per-OS-user, not per-app, so it decrypts fine after the move).
function migrateLegacyConfig() {
  const legacy = path.join(app.getPath('appData'), 'gitbar', 'gitbar-config.json')
  if (fs.existsSync(configFile()) || !fs.existsSync(legacy)) return
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.copyFileSync(legacy, configFile())
  } catch { /* fall back to fresh defaults */ }
}

function loadConfig() {
  // strip a UTF-8 BOM if present — hand-edited configs (notably anything
  // written by Windows PowerShell 5.1) often carry one and JSON.parse rejects it
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8').replace(/^\uFEFF/, '')) } catch { return {} }
}

function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch }
  try { fs.writeFileSync(configFile(), JSON.stringify(next, null, 2)) } catch { /* non-fatal */ }
}

// ---------- git via the system binary ----------
// Repo discovery is confined to the selected directory: without a ceiling,
// git walks up the parent chain, so selecting an empty folder inside a repo
// (e.g. anywhere under a ~ that has a .git) lights up that parent repo.
function gitEnv(extra) {
  return { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(cwd), ...extra }
}

function git(args) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('git', args, { cwd, windowsHide: true, env: gitEnv() })
    } catch (err) {
      return resolve({ code: -1, stdout: '', stderr: String(err) })
    }
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

// ---------- GitHub token (encrypted at rest via OS keychain/DPAPI) ----------
function getToken() {
  const enc = loadConfig().ghToken
  if (!enc) return null
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')) } catch { return null }
}

// Askpass helper: git invokes this for username/password prompts. The token
// travels via an environment variable, never on a command line.
function ensureAskpass() {
  const file = path.join(app.getPath('userData'), process.platform === 'win32' ? 'askpass.cmd' : 'askpass.sh')
  const content = process.platform === 'win32'
    ? '@echo off\r\necho.%~1 | findstr /I "username" >nul && (echo x-access-token) || (echo %GITBAR_TOKEN%)\r\n'
    : '#!/bin/sh\ncase "$1" in *sername*) echo x-access-token ;; *) echo "$GITBAR_TOKEN" ;; esac\n'
  fs.writeFileSync(file, content)
  if (process.platform !== 'win32') fs.chmodSync(file, 0o755)
  return file
}

// Streams pull/push output to the renderer line by line.
function streamGit(op, args) {
  const send = (payload) => {
    if (win && !win.isDestroyed()) win.webContents.send('git:stream', { op, ...payload })
  }
  const env = gitEnv({ GIT_TERMINAL_PROMPT: '0' }) // never hang on a prompt
  let fullArgs = args
  const token = getToken()
  if (token) {
    env.GIT_ASKPASS = ensureAskpass()
    env.GITBAR_TOKEN = token
    // disable configured credential helpers (e.g. Git Credential Manager) so
    // auth goes only through our askpass — never the user's stored logins
    fullArgs = ['-c', 'credential.helper=', ...args]
  }
  let child
  try {
    child = spawn('git', fullArgs, { cwd, windowsHide: true, env })
  } catch (err) {
    return send({ line: String(err), done: true, ok: false })
  }
  const onData = (d) => {
    // git progress uses \r to redraw lines; treat CR like a line break
    d.toString().split(/\r\n|\n|\r/).filter(Boolean).forEach((line) => send({ line, done: false, ok: true }))
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('error', (err) => send({ line: String(err), done: true, ok: false }))
  child.on('close', (code) => {
    send({ line: '', done: true, ok: code === 0 })
    refreshStatus()
  })
}

// Parses `git status --porcelain=v2 --branch` into the app's state shape.
async function getState() {
  const probe = await git(['rev-parse', '--is-inside-work-tree'])
  const state = {
    cwd, isRepo: false, branch: '', ahead: 0, behind: 0,
    upstream: '', originUrl: '', files: []
  }
  if (probe.code !== 0 || !probe.stdout.trim().startsWith('true')) return state
  state.isRepo = true

  const origin = await git(['remote', 'get-url', 'origin'])
  if (origin.code === 0) state.originUrl = origin.stdout.trim()

  const res = await git(['status', '--porcelain=v2', '--branch'])
  for (const line of res.stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      state.branch = line.slice('# branch.head '.length).trim()
    } else if (line.startsWith('# branch.upstream ')) {
      state.upstream = line.slice('# branch.upstream '.length).trim()
    } else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/)
      if (m) { state.ahead = Number(m[1]); state.behind = Number(m[2]) }
    } else if (line.startsWith('1 ')) {
      // 1 XY sub mH mI mW hH hI path — X = index (staged), Y = worktree
      const parts = line.split(' ')
      const xy = parts[1]
      const file = parts.slice(8).join(' ')
      let status = 'modified'
      if (xy.includes('D')) status = 'deleted'
      else if (xy[0] === 'A') status = 'new'
      state.files.push({ path: file, status, staged: xy[0] !== '.' })
    } else if (line.startsWith('2 ')) {
      // renamed: 2 XY sub mH mI mW hH hI Xscore path<TAB>origPath
      const seg = line.split('\t')[0].split(' ')
      const file = seg.slice(9).join(' ')
      state.files.push({ path: file, status: 'modified', staged: seg[1][0] !== '.' })
    } else if (line.startsWith('? ')) {
      state.files.push({ path: line.slice(2), status: 'new', staged: false })
    } else if (line.startsWith('u ')) {
      state.files.push({ path: line.split(' ').slice(10).join(' '), status: 'conflict', staged: false })
    }
  }
  return state
}

async function refreshStatus() {
  if (!win || win.isDestroyed()) return
  win.webContents.send('git:status', await getState())
}

// Poll fast while the bar is visible, slowly while idle — the idle mascot
// still reflects repo state (uncommitted "?" / unpushed-commit belly).
function setPolling(m) {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  pollTimer = setInterval(refreshStatus, m === 'idle' ? 10000 : 3000)
}

// ---------- file tree for the browse panel ----------
const SKIP_DIRS = new Set(['.git', 'node_modules'])

function buildTree(dir, relBase, statusByPath, depth, budget) {
  if (depth > 6 || budget.count <= 0) return []
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return [] }
  entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name))
  const nodes = []
  for (const entry of entries) {
    if (budget.count-- <= 0) break
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      nodes.push({
        name: entry.name,
        path: rel,
        type: 'dir',
        children: buildTree(path.join(dir, entry.name), rel, statusByPath, depth + 1, budget)
      })
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path: rel, type: 'file', status: statusByPath.get(rel) || null })
    }
  }
  return nodes
}

// ---------- window ----------
// Keeps a rect on-screen, using the full bounds of the nearest display so
// the mascot can sit anywhere visible (including over the taskbar).
function clampToDisplay(x, y, w, h) {
  const b = screen.getDisplayMatching({ x, y, width: w, height: h }).bounds
  return {
    x: Math.min(Math.max(x, b.x), b.x + b.width - w),
    y: Math.min(Math.max(y, b.y), b.y + b.height - h),
    width: w,
    height: h
  }
}

function boundsFor(m) {
  const wa = screen.getPrimaryDisplay().workArea
  const bottomY = wa.y + wa.height - BOTTOM_MARGIN
  if (m === 'idle') {
    if (idlePos) return clampToDisplay(idlePos.x, idlePos.y, IDLE_W, IDLE_H)
    return { x: wa.x + wa.width - IDLE_W, y: bottomY - IDLE_H, width: IDLE_W, height: IDLE_H }
  }
  // bar / panel / menu: bottom edge anchored (panel/menu grow upward) at the
  // user-dragged position, or horizontally centered by default
  const height = m === 'panel' ? BAR_H + panelArea : m === 'menu' ? BAR_H + MENU_H : BAR_H
  if (barPos) return clampToDisplay(barPos.x, barPos.bottom - height, BAR_W, height)
  const x = wa.x + Math.round((wa.width - BAR_W) / 2)
  return { x, y: bottomY - height, width: BAR_W, height }
}

function applyMode(m) {
  mode = m
  if (m !== 'panel') panelArea = PANEL_H // reset; renderer re-measures on open
  // setBounds on a non-resizable window is unreliable on Windows;
  // toggle resizable around the call.
  win.setResizable(true)
  win.setBounds(boundsFor(m))
  win.setResizable(false)
  setPolling(m)
  if (m !== 'idle') refreshStatus()
}

function createWindow() {
  win = new BrowserWindow({
    ...boundsFor('idle'),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  win.once('ready-to-show', () => win.showInactive()) // never steal focus

  // Right-click anywhere — duck, bar, or panel — offers Quit. The window has
  // no frame and no taskbar presence, so this is the discoverable way to exit
  // (the bar's ✕ only collapses back to the duck).
  win.webContents.on('context-menu', (_e, params) => {
    const template = []
    if (params.isEditable) {
      template.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' })
    }
    template.push({ label: 'Quit Guck', click: () => app.quit() })
    // anchor to the clicked spot (popup's default is the OS cursor, which
    // differs from the click position for synthetic/test events)
    Menu.buildFromTemplate(template).popup({ window: win, x: params.x, y: params.y })
  })
}

// ---------- IPC ----------
ipcMain.handle('state:get', () => getState())

ipcMain.handle('git:diff', async () => {
  const res = await git(['diff'])
  return { output: res.code === 0 ? res.stdout : res.stderr, ok: res.code === 0 }
})

ipcMain.handle('git:status-text', async () => {
  const res = await git(['status'])
  return { output: res.code === 0 ? res.stdout : res.stderr, ok: res.code === 0 }
})

// Commits whatever is staged; staging is done explicitly via git:add.
ipcMain.handle('git:commit', async (_e, { message }) => {
  if (!message || !message.trim()) return { success: false, output: 'Commit message is empty.' }
  const commit = await git(['commit', '-m', message])
  refreshStatus()
  return { success: commit.code === 0, output: (commit.stdout + '\n' + commit.stderr).trim() }
})

ipcMain.handle('git:add', async (_e, files) => {
  const res = files === 'all'
    ? await git(['add', '-A'])
    : await git(['add', '--', ...files])
  refreshStatus()
  return { ok: res.code === 0, output: (res.stderr || res.stdout).trim() }
})

ipcMain.handle('git:unstage', async (_e, files) => {
  let res = await git(['restore', '--staged', '--', ...files])
  // repos with no commits yet have no HEAD for restore to resolve
  if (res.code !== 0) res = await git(['rm', '--cached', '-r', '-q', '--', ...files])
  refreshStatus()
  return { ok: res.code === 0, output: (res.stderr || res.stdout).trim() }
})

ipcMain.handle('remote:set', async (_e, url) => {
  url = String(url || '').trim()
  if (!url) return { ok: false, output: 'Remote URL is empty.' }
  const existing = (await git(['remote'])).stdout.split('\n').map((s) => s.trim())
  const res = existing.includes('origin')
    ? await git(['remote', 'set-url', 'origin', url])
    : await git(['remote', 'add', 'origin', url])
  refreshStatus()
  return { ok: res.code === 0, output: (res.stdout + res.stderr).trim() }
})

// ---------- theme ----------
ipcMain.handle('theme:get', () => loadConfig().theme === 'dark' ? 'dark' : 'light')

ipcMain.handle('theme:set', (_e, theme) => {
  theme = theme === 'dark' ? 'dark' : 'light'
  saveConfig({ theme })
  return theme
})

// ---------- GitHub token ----------
ipcMain.handle('github:token-status', () => ({ saved: !!getToken() }))

ipcMain.handle('github:set-token', (_e, token) => {
  token = String(token || '').trim()
  if (!token) return { ok: false, output: 'Token is empty.' }
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, output: 'OS encryption is unavailable; refusing to store the token.' }
  saveConfig({ ghToken: safeStorage.encryptString(token).toString('base64') })
  return { ok: true, output: 'Token saved (encrypted with the OS keychain).' }
})

ipcMain.handle('github:clear-token', () => {
  saveConfig({ ghToken: null })
  return { ok: true, output: 'Token removed.' }
})

ipcMain.handle('github:verify', async () => {
  const token = getToken()
  if (!token) return { ok: false, output: 'No token saved.' }
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Guck' }
    })
    if (!res.ok) return { ok: false, output: `GitHub API replied ${res.status} — token may be invalid or expired.` }
    const user = await res.json()
    return { ok: true, output: `Authenticated as ${user.login}` }
  } catch (err) {
    return { ok: false, output: `Could not reach GitHub: ${err.message || err}` }
  }
})

ipcMain.handle('git:branches', async () => {
  const res = await git(['branch', '--format=%(refname:short)'])
  return {
    ok: res.code === 0,
    branches: res.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
  }
})

ipcMain.handle('git:checkout', async (_e, branch) => {
  const res = await git(['checkout', String(branch)])
  refreshStatus()
  return { ok: res.code === 0, output: (res.stdout + res.stderr).trim() }
})

ipcMain.handle('git:init', async () => {
  const res = await git(['init'])
  refreshStatus()
  return { success: res.code === 0, output: (res.stdout + res.stderr).trim() }
})

ipcMain.on('git:pull', () => streamGit('pull', ['pull', '--progress']))

ipcMain.on('git:push', async () => {
  // first push of a branch: set the upstream automatically
  const state = await getState()
  if (state.isRepo && state.originUrl && !state.upstream) {
    streamGit('push', ['push', '--progress', '-u', 'origin', 'HEAD'])
  } else {
    streamGit('push', ['push', '--progress'])
  }
})

ipcMain.handle('browse:tree', async () => {
  const state = await getState()
  const statusByPath = new Map(state.files.map((f) => [f.path, f.status]))
  return { tree: buildTree(cwd, '', statusByPath, 0, { count: 800 }) }
})

ipcMain.handle('file:open', (_e, relPath) => {
  // only open paths that resolve inside the active directory
  const abs = path.resolve(cwd, relPath)
  if (!abs.startsWith(path.resolve(cwd) + path.sep)) return { ok: false }
  shell.openPath(abs)
  return { ok: true }
})

ipcMain.handle('dir:pick', async () => {
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: cwd })
  if (!result.canceled && result.filePaths[0]) {
    cwd = result.filePaths[0]
    saveConfig({ lastDir: cwd })
  }
  return getState()
})

ipcMain.handle('window:mode', (_e, m) => {
  if (['idle', 'bar', 'panel', 'menu'].includes(m)) applyMode(m)
})

// Renderer reports the panel's natural content height; we resize the window
// to fit exactly (clamped), so panels never show wasted empty space.
ipcMain.on('window:panel-area', (_e, h) => {
  if (mode !== 'panel' || !Number.isFinite(h)) return
  const next = Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.round(h)))
  if (next === panelArea) return
  panelArea = next
  win.setResizable(true)
  win.setBounds(boundsFor('panel'))
  win.setResizable(false)
})

// ---------- window dragging (mascot in idle mode, grip in bar mode) ----------
// All drag math lives here, in one coordinate space: both
// screen.getCursorScreenPoint() and win.setPosition speak DIPs. The renderer
// only signals "the pointer moved" — its pointer coordinates are physical
// pixels, and feeding those deltas back (even scaleFactor-corrected) created
// a feedback loop on scaled displays: our own setPosition shifted the
// window under the stationary cursor, which re-fired pointermove with a
// slightly different rounding, which moved the window again — a slow drift.
ipcMain.on('drag:start', () => {
  if (!win) return
  const [x, y] = win.getPosition()
  // intended size comes from boundsFor, never from the window: reading the
  // size back round-trips it through physical pixels, which is lossy at
  // fractional scale factors
  const { width, height } = boundsFor(mode)
  dragStart = { x, y, width, height, cursor: screen.getCursorScreenPoint(), mode, lastX: x, lastY: y }
  win.setResizable(true) // setBounds is unreliable on non-resizable windows on Windows
})

ipcMain.on('drag:move', () => {
  if (!dragStart) return
  const c = screen.getCursorScreenPoint()
  const x = dragStart.x + (c.x - dragStart.cursor.x)
  const y = dragStart.y + (c.y - dragStart.cursor.y)
  if (x === dragStart.lastX && y === dragStart.lastY) return
  dragStart.lastX = x
  dragStart.lastY = y
  // always pass the full bounds with the intended size: bare setPosition
  // re-applies a size it read back from the window, and at fractional scale
  // factors that read-back rounds differently at each position — repeated
  // moves ratchet the window wider ("the bar elongates while dragging")
  win.setBounds({ x, y, width: dragStart.width, height: dragStart.height })
})

ipcMain.on('drag:end', () => {
  if (!dragStart) return
  const d = dragStart
  dragStart = null
  const [x, y] = win.getPosition()
  const clamped = clampToDisplay(x, y, d.width, d.height)
  win.setBounds(clamped)
  win.setResizable(false)
  if (d.mode === 'idle') {
    idlePos = { x: clamped.x, y: clamped.y }
    saveConfig({ idlePos })
  } else {
    // bar/panel/menu: remember the bottom edge so panels keep growing upward
    // from the same anchor regardless of the height at drag time
    barPos = { x: clamped.x, bottom: clamped.y + d.height }
    saveConfig({ barPos })
  }
})

// ---------- lifecycle ----------
app.whenReady().then(() => {
  migrateLegacyConfig()
  const config = loadConfig()
  if (config.lastDir && fs.existsSync(config.lastDir)) cwd = config.lastDir
  if (config.idlePos && Number.isFinite(config.idlePos.x) && Number.isFinite(config.idlePos.y)) {
    idlePos = config.idlePos
  }
  if (config.barPos && Number.isFinite(config.barPos.x) && Number.isFinite(config.barPos.bottom)) {
    barPos = config.barPos
  }
  createWindow()
  setPolling('idle') // keep the mascot's repo-state hints fresh while collapsed
})

app.on('window-all-closed', () => app.quit())
