// Guck bar — segment interactions, mode transitions (idle/bar/panel),
// hover expand/collapse, and live state rendering.

const Bar = (() => {
  const $ = (id) => document.getElementById(id)

  let mode = 'idle'
  let state = null
  let lastPanel = 'status'
  let popup = null // 'settings' | 'branch' | null

  // ---------- mode handling ----------
  function setMode(next) {
    if (mode === next) return
    mode = next
    // swap only the mode-* class — a blanket className assignment would
    // wipe the theme's 'dark' class
    for (const c of [...document.body.classList]) {
      if (c.startsWith('mode-')) document.body.classList.remove(c)
    }
    document.body.classList.add(`mode-${next}`)
    window.gitbar.setMode(next)
    if (next !== 'panel') Panel.close()
    if (next !== 'menu') setPopup(null)
    updateToggleIcon()
    Mascot.perk(false)
  }

  // the two drop-ups (settings gear, branch switcher) share the 'menu'
  // window mode; only one is open at a time
  function setPopup(which) {
    popup = which
    $('menu').classList.toggle('open', which === 'settings')
    $('branch-menu').classList.toggle('open', which === 'branch')
    if (which) setMode('menu')
    else if (mode === 'menu') setMode('bar')
  }

  function updateToggleIcon() {
    $('toggle-icon').innerHTML = mode === 'panel'
      ? '<path d="M3.5 6L8 10.5 12.5 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<path d="M3.5 10L8 5.5 12.5 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
  }

  let openType = null // which panel is currently open

  function openPanel(type) {
    lastPanel = type
    openType = type
    setMode('panel')
    document.querySelectorAll('.seg').forEach((s) => s.classList.remove('active'))
    const seg = $(`seg-${type === 'status' ? 'changes' : type}`)
    if (seg) seg.classList.add('active')
    Panel.render(type, state)
  }

  function closePanel() {
    openType = null
    document.querySelectorAll('.seg').forEach((s) => s.classList.remove('active'))
    setMode('bar')
  }

  // a segment click opens its panel, or closes it if already showing
  function togglePanel(type, onOpen) {
    if (mode === 'panel' && openType === type) return closePanel()
    openPanel(type)
    if (onOpen) onOpen()
  }

  // ---------- branch switcher (+ pull, which is branch-related and
  // too infrequent to earn a bar segment) ----------
  const BRANCH_ICON = '<svg viewBox="0 0 16 16" width="13" height="13"><path d="M5 3.5v9M5 3.5a1.5 1.5 0 100-.01M5 12.5a1.5 1.5 0 100 .01M11 5a1.5 1.5 0 100-.01M11 6.5c0 2.5-2 3-4 3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
  const PULL_ICON = '<svg viewBox="0 0 16 16" width="13" height="13"><path d="M8 2v10M4.5 8.5L8 12l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'

  function appendPullItem(menu) {
    const sep = document.createElement('div')
    sep.className = 'menu-sep'
    const pullItem = document.createElement('button')
    pullItem.className = 'menu-item'
    pullItem.innerHTML = PULL_ICON + '<span>pull</span>'
    pullItem.addEventListener('click', () => {
      setPopup(null)
      if (state && state.isRepo && !state.originUrl) return openPanel('remote')
      openPanel('pull')
      window.gitbar.pull()
    })
    menu.append(sep, pullItem)
  }

  async function openBranchMenu() {
    const menu = $('branch-menu')
    menu.innerHTML = '<span class="muted branch-error">loading…</span>'
    setPopup('branch')
    const res = await window.gitbar.branches()
    if (popup !== 'branch') return
    menu.innerHTML = ''

    if (!res.ok || res.branches.length === 0) {
      const empty = document.createElement('span')
      empty.className = 'muted branch-error'
      empty.textContent = 'no other branches'
      menu.appendChild(empty)
    }
    for (const name of res.branches) {
      const item = document.createElement('button')
      item.className = 'menu-item branch-item'
      item.innerHTML = BRANCH_ICON
      const label = document.createElement('span')
      label.textContent = name
      item.appendChild(label)
      if (state && name === state.branch) {
        const check = document.createElement('span')
        check.className = 'branch-check'
        check.textContent = '✓'
        item.appendChild(check)
      } else {
        item.addEventListener('click', async () => {
          item.disabled = true
          const out = await window.gitbar.checkout(name)
          if (out.ok) {
            applyState(await window.gitbar.getState())
            setPopup(null)
          } else {
            let err = menu.querySelector('.branch-error')
            if (!err) {
              err = document.createElement('span')
              err.className = 'branch-error t-err'
              menu.appendChild(err)
            }
            err.textContent = out.output
            item.disabled = false
          }
        })
      }
      menu.appendChild(item)
    }

    appendPullItem(menu) // always present, even in a repo with no branches yet
  }

  // ---------- theme ----------
  function applyTheme(theme) {
    const dark = theme === 'dark'
    document.body.classList.toggle('dark', dark)
    $('theme-icon-sun').classList.toggle('hidden', !dark)
    $('theme-icon-moon').classList.toggle('hidden', dark)
    $('theme-label').textContent = dark ? 'light mode' : 'dark mode'
  }

  // ---------- state rendering ----------
  function shortDir(p) {
    const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
    return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p
  }

  function applyState(s) {
    state = s
    $('menu-dir-label').textContent = shortDir(s.cwd)
    $('menu-dir').title = s.cwd
    $('menu-remote').classList.toggle('menu-disabled', !s.isRepo)

    Mascot.setState({
      changes: s.isRepo ? s.files.length : 0,
      ahead: s.isRepo ? s.ahead : 0
    })

    const repoSegs = ['seg-branch', 'seg-changes', 'seg-diff', 'seg-commit', 'seg-push', 'seg-browse']
    $('no-repo').classList.toggle('hidden', s.isRepo)
    repoSegs.forEach((id) => $(id).classList.toggle('hidden', !s.isRepo))
    if (!s.isRepo) return

    $('branch-name').textContent = s.branch || '(no branch)'
    const n = s.files.length
    $('changes-label').textContent = n
    $('seg-changes').title = `${n} change${n === 1 ? '' : 's'}`
    $('seg-changes').classList.toggle('has-changes', n > 0)

    const badge = $('push-badge')
    badge.classList.toggle('hidden', s.ahead === 0)
    badge.textContent = s.ahead
  }

  // press-and-move drags the whole window. The renderer only detects the
  // gesture and pings the main process; all position math happens there in
  // one coordinate space (see drag:move in main.js). A movement under 4px
  // counts as a click.
  function wireDrag(el, onClick) {
    let press = null
    let moveRaf = null
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      press = { x: e.screenX, y: e.screenY }
      try { el.setPointerCapture(e.pointerId) } catch { /* synthetic events (test harness) have no active pointer */ }
      window.gitbar.dragStart()
    })
    el.addEventListener('pointermove', (e) => {
      if (!press) return
      if (Math.hypot(e.screenX - press.x, e.screenY - press.y) > 4) el.classList.add('dragging')
      if (!moveRaf) {
        moveRaf = requestAnimationFrame(() => {
          moveRaf = null
          if (press) window.gitbar.dragMove()
        })
      }
    })
    const endDrag = (e) => {
      if (!press) return
      const wasClick = e && Math.hypot(e.screenX - press.x, e.screenY - press.y) <= 4
      press = null
      el.classList.remove('dragging')
      window.gitbar.dragEnd()
      if (wasClick && onClick) onClick()
    }
    el.addEventListener('pointerup', endDrag)
    el.addEventListener('pointercancel', () => endDrag(null))
  }

  // ---------- wiring ----------
  function init() {
    // idle strip: hover perks the mascot up; click opens the bar; press-and-
    // move drags the duck anywhere on screen
    const strip = $('idle-strip')
    strip.addEventListener('mouseenter', () => Mascot.perk(true))
    strip.addEventListener('mouseleave', () => Mascot.perk(false))
    wireDrag(strip, () => setMode('bar'))

    // 6-dot grip at the bar's left edge: drag to relocate the bar
    wireDrag($('bar-grip'), null)

    // the bar stays open until the X is clicked
    $('seg-close').addEventListener('click', () => setMode('idle'))

    // gear: toggle the set-once-and-forget drop-up
    $('seg-setup').addEventListener('click', (e) => {
      e.stopPropagation()
      setPopup(popup === 'settings' ? null : 'settings')
    })

    // branch chip: toggle the branch switcher drop-up
    $('seg-branch').addEventListener('click', (e) => {
      e.stopPropagation()
      if (popup === 'branch') return setPopup(null)
      openBranchMenu()
    })

    document.addEventListener('click', (e) => {
      if (mode === 'menu') {
        if (!$('menu').contains(e.target) && !$('branch-menu').contains(e.target)) setPopup(null)
      } else if (mode === 'panel') {
        // clicking the transparent margins/gaps (i.e. outside both the panel
        // and the bar) closes the panel
        if ((e.target === $('app') || e.target === document.body) && openType) closePanel()
      }
    })

    $('menu-theme').addEventListener('click', async () => {
      const next = document.body.classList.contains('dark') ? 'light' : 'dark'
      applyTheme(await window.gitbar.setTheme(next))
    })

    $('menu-dir').addEventListener('click', async () => applyState(await window.gitbar.pickDir()))
    $('menu-remote').addEventListener('click', () => {
      if (state && state.isRepo) openPanel('remote')
    })
    $('seg-changes').addEventListener('click', () => togglePanel('status'))
    $('seg-diff').addEventListener('click', () => togglePanel('diff'))
    $('seg-commit').addEventListener('click', () => togglePanel('commit'))
    $('seg-browse').addEventListener('click', () => togglePanel('browse'))
    // push needs an origin — route to the remote panel when there is none.
    // push is a powerful action, so it opens a confirm prompt rather than
    // firing immediately (Panel calls back here on confirm).
    $('seg-push').addEventListener('click', () => {
      if (mode === 'panel' && openType === 'push') return closePanel()
      if (state && state.isRepo && !state.originUrl) return openPanel('remote')
      openPanel('push')
    })
    $('seg-toggle').addEventListener('click', () => {
      if (mode === 'panel') closePanel()
      else openPanel(lastPanel)
    })
    $('panel-close').addEventListener('click', closePanel)
    $('btn-init').addEventListener('click', async () => {
      await window.gitbar.initRepo()
      applyState(await window.gitbar.getState())
    })

    window.gitbar.onStatus(applyState)
    window.gitbar.getState().then(applyState)
    window.gitbar.getTheme().then(applyTheme)
  }

  init()
  return { applyState, closePanelExternal: closePanel }
})()
