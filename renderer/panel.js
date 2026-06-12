// Guck panels — renders diff / status / pull / push / commit / browse
// into #panel-body. Pure DOM, no framework.

const Panel = (() => {
  const tabEl = () => document.getElementById('panel-tab')
  const bodyEl = () => document.getElementById('panel-body')

  let current = null         // active panel type
  let streamPre = null       // <pre> receiving pull/push lines
  let streamOp = null

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Ask main to size the window to the panel's natural content height, so
  // panels stay tight with no wasted empty space. Big value (streams) is
  // clamped to the max on the main side.
  function requestPanelHeight(big) {
    requestAnimationFrame(() => {
      if (big) return window.gitbar.setPanelArea(9999)
      const header = document.querySelector('.panel-header')
      const content = bodyEl().firstElementChild
      if (!header || !content) return
      // content is natural-height (inner scroll regions are max-height capped),
      // so its offsetHeight is the true desired height — unlike body.scrollHeight,
      // which reports the flex-stretched container size.
      window.gitbar.setPanelArea(header.offsetHeight + content.offsetHeight + 12)
    })
  }

  // ---------- terminal-style rendering ----------
  function termHTML(lines) {
    return lines.map(({ text, cls }) =>
      `<span class="${cls || ''}">${esc(text)}</span>`
    ).join('\n')
  }

  function colorizeDiff(output) {
    return output.split('\n').map((text) => {
      let cls = ''
      if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('diff --git')) cls = 't-file'
      else if (text.startsWith('@@')) cls = 't-hunk'
      else if (text.startsWith('+')) cls = 't-add'
      else if (text.startsWith('-')) cls = 't-del'
      return { text, cls }
    })
  }

  function colorizeStatus(output) {
    let untrackedSection = false
    return output.split('\n').map((text) => {
      const t = text.trim()
      if (/^Untracked files:/.test(t)) untrackedSection = true
      else if (t === '' || /^[A-Z(]/.test(t)) untrackedSection = false

      let cls = ''
      if (/^\s+(modified|renamed):/.test(text)) cls = 't-mod'
      else if (/^\s+deleted:/.test(text)) cls = 't-del'
      else if (/^\s+new file:/.test(text)) cls = 't-new'
      else if (/^\(use /.test(t)) cls = 't-muted'
      else if (untrackedSection && /^\s+\S/.test(text) && !/^Untracked/.test(t)) cls = 't-new'
      return { text, cls }
    })
  }

  function renderTerm(cmd, lines) {
    bodyEl().innerHTML = `<pre class="term"><span class="t-cmd">$ ${esc(cmd)}</span>\n${termHTML(lines)}</pre>`
    requestPanelHeight()
  }

  // ---------- panel types ----------
  async function renderDiff() {
    renderTerm('git diff', [{ text: 'loading…', cls: 't-muted' }])
    const res = await window.gitbar.diff()
    const out = res.output.trim() ? colorizeDiff(res.output) : [{ text: 'no unstaged changes', cls: 't-muted' }]
    if (current === 'diff') renderTerm('git diff', out)
  }

  async function renderStatus() {
    renderTerm('git status', [{ text: 'loading…', cls: 't-muted' }])
    const res = await window.gitbar.statusText()
    if (current === 'status') renderTerm('git status', colorizeStatus(res.output))
  }

  function renderStream(op) {
    streamOp = op
    bodyEl().innerHTML = `<pre class="term"><span class="t-cmd">$ git ${op}</span>\n</pre>`
    streamPre = bodyEl().querySelector('pre')
    requestPanelHeight(true) // streaming output — give it the max area
  }

  function handleStream({ op, line, done, ok }) {
    if (op !== streamOp || !streamPre || !streamPre.isConnected) return
    if (line) {
      const span = document.createElement('span')
      span.textContent = line + '\n'
      streamPre.appendChild(span)
    }
    if (done) {
      const span = document.createElement('span')
      span.className = ok ? 't-ok' : 't-err'
      span.textContent = ok ? '✓ Done' : '✗ Failed'
      streamPre.appendChild(span)
      streamOp = null
    }
    bodyEl().scrollTop = bodyEl().scrollHeight
  }

  // Commit panel: checkboxes mirror the real index — checking a file runs
  // `git add`, unchecking runs `git restore --staged`. Commit commits staged.
  function renderCommit(state, note, keepMsg) {
    const body = bodyEl()
    body.innerHTML = ''
    const form = document.createElement('div')
    form.className = 'commit-form'

    const stagedCount = state.files.filter((f) => f.staged).length

    const msgRow = document.createElement('div')
    msgRow.className = 'commit-msg-row'
    const input = document.createElement('input')
    input.id = 'commit-msg'
    input.placeholder = 'commit message…'
    input.spellcheck = false
    if (keepMsg) input.value = keepMsg
    const btn = document.createElement('button')
    btn.className = 'commit-btn'
    btn.textContent = stagedCount > 0 ? `Commit (${stagedCount})` : 'Commit'
    btn.disabled = stagedCount === 0
    msgRow.append(input, btn)

    const toolbar = document.createElement('div')
    toolbar.className = 'commit-toolbar'
    const hint = document.createElement('span')
    hint.className = 'muted commit-hint'
    hint.textContent = 'checked = staged (git add)'
    const stageAll = document.createElement('button')
    stageAll.className = 'mini-btn'
    stageAll.textContent = 'Stage all'
    toolbar.append(hint, stageAll)

    const refresh = async (msg) => {
      const fresh = await window.gitbar.getState()
      Bar.applyState(fresh)
      if (Panel.current === 'commit') renderCommit(fresh, msg, document.getElementById('commit-msg')?.value)
    }

    const list = document.createElement('div')
    list.className = 'commit-files'
    if (state.files.length === 0) {
      list.innerHTML = '<span class="muted">working tree clean — nothing to commit</span>'
    }
    for (const f of state.files) {
      const row = document.createElement('label')
      row.className = 'commit-file'
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = f.staged
      cb.addEventListener('change', async () => {
        cb.disabled = true
        if (cb.checked) await window.gitbar.add([f.path])
        else await window.gitbar.unstage([f.path])
        refresh()
      })
      const name = document.createElement('span')
      name.textContent = f.path
      const badge = document.createElement('span')
      badge.className = `status-badge ${f.status}`
      badge.textContent = f.status
      row.append(cb, name, badge)
      list.appendChild(row)
    }
    stageAll.addEventListener('click', async () => {
      stageAll.disabled = true
      await window.gitbar.add('all')
      refresh()
    })

    const output = document.createElement('div')
    output.className = 'commit-output term'
    if (note) output.innerHTML = `<span class="t-ok">${esc(note)}</span>`

    btn.addEventListener('click', async () => {
      btn.disabled = true
      const res = await window.gitbar.commit(input.value)
      if (res.success) {
        refresh('✓ committed')
      } else {
        btn.disabled = false
        output.innerHTML = `<span class="t-err">${esc(res.output || 'commit failed')}</span>`
      }
    })
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btn.disabled) btn.click() })

    form.append(msgRow, toolbar, list, output)
    body.appendChild(form)
    requestPanelHeight()
    if (!keepMsg) input.focus()
  }

  // Remote panel: origin URL + GitHub token (stored encrypted in the main
  // process; the renderer only ever sees saved/not-saved).
  async function renderRemote(state) {
    const body = bodyEl()
    body.innerHTML = ''
    const wrap = document.createElement('div')
    wrap.className = 'remote-form'

    const intro = document.createElement('div')
    intro.className = 'remote-row muted'
    intro.textContent = state.originUrl
      ? ''
      : 'No remote configured — pull and push need an origin.'
    if (intro.textContent) wrap.appendChild(intro)

    // --- origin url ---
    const originLabel = document.createElement('div')
    originLabel.className = 'remote-label muted'
    originLabel.textContent = 'remote origin'
    const originRow = document.createElement('div')
    originRow.className = 'remote-row'
    const urlInput = document.createElement('input')
    urlInput.className = 'remote-input'
    urlInput.placeholder = 'https://github.com/user/repo.git'
    urlInput.value = state.originUrl || ''
    urlInput.spellcheck = false
    const urlBtn = document.createElement('button')
    urlBtn.className = 'mini-btn'
    urlBtn.textContent = state.originUrl ? 'Update' : 'Add origin'
    const urlOut = document.createElement('span')
    urlOut.className = 'remote-out'
    originRow.append(urlInput, urlBtn, urlOut)

    urlBtn.addEventListener('click', async () => {
      urlBtn.disabled = true
      const res = await window.gitbar.setRemote(urlInput.value)
      urlBtn.disabled = false
      urlOut.textContent = res.ok ? '✓ saved' : (res.output || 'failed')
      urlOut.className = `remote-out ${res.ok ? 't-ok' : 't-err'}`
      if (res.ok) Bar.applyState(await window.gitbar.getState())
    })

    // --- github token ---
    const ghLabel = document.createElement('div')
    ghLabel.className = 'remote-label muted'
    ghLabel.textContent = 'github authentication'
    const ghRow = document.createElement('div')
    ghRow.className = 'remote-row'
    wrap.append(originLabel, originRow, ghLabel, ghRow)

    const ghOut = document.createElement('span')
    ghOut.className = 'remote-out'

    const renderToken = async () => {
      ghRow.innerHTML = ''
      const status = await window.gitbar.tokenStatus()
      if (status.saved) {
        const saved = document.createElement('span')
        saved.className = 't-ok'
        saved.textContent = '✓ token saved (encrypted)'
        const verify = document.createElement('button')
        verify.className = 'mini-btn'
        verify.textContent = 'Verify'
        verify.addEventListener('click', async () => {
          verify.disabled = true
          const res = await window.gitbar.verifyToken()
          verify.disabled = false
          ghOut.textContent = res.output
          ghOut.className = `remote-out ${res.ok ? 't-ok' : 't-err'}`
        })
        const remove = document.createElement('button')
        remove.className = 'mini-btn'
        remove.textContent = 'Remove'
        remove.addEventListener('click', async () => {
          await window.gitbar.clearToken()
          ghOut.textContent = ''
          renderToken()
        })
        ghRow.append(saved, verify, remove, ghOut)
      } else {
        const tokenInput = document.createElement('input')
        tokenInput.className = 'remote-input'
        tokenInput.type = 'password'
        tokenInput.placeholder = 'personal access token (ghp_… / github_pat_…)'
        const save = document.createElement('button')
        save.className = 'mini-btn'
        save.textContent = 'Save'
        save.addEventListener('click', async () => {
          save.disabled = true
          const res = await window.gitbar.setToken(tokenInput.value)
          save.disabled = false
          ghOut.textContent = res.ok ? '' : res.output
          ghOut.className = 'remote-out t-err'
          if (res.ok) renderToken()
        })
        ghRow.append(tokenInput, save, ghOut)
      }
    }
    renderToken()

    const note = document.createElement('div')
    note.className = 'remote-label muted'
    note.textContent = 'the token is used for https pull/push and never leaves this machine'
    wrap.appendChild(note)

    body.appendChild(wrap)
    requestPanelHeight()
  }

  // ---------- browse ----------
  const ICON_FOLDER = '<svg viewBox="0 0 16 16" width="13" height="13"><path d="M2 4.5A1.5 1.5 0 013.5 3h2l1.2 1.5H12.5A1.5 1.5 0 0114 6v5.5A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5v-7z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>'
  const ICON_FILE = '<svg viewBox="0 0 16 16" width="13" height="13"><path d="M4 1.5h5.5L13 5v9.5H4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>'

  function buildNodes(nodes, parentUl) {
    for (const node of nodes) {
      const li = document.createElement('li')
      li.dataset.path = node.path.toLowerCase()
      const row = document.createElement('div')
      row.className = 'node-row'
      row.innerHTML = ICON_FOLDER
      if (node.type === 'dir') {
        li.className = 'node-dir'
        const name = document.createElement('span')
        name.textContent = `${node.name}/`
        row.appendChild(name)
        li.appendChild(row)
        const ul = document.createElement('ul')
        buildNodes(node.children || [], ul)
        li.appendChild(ul)
        row.addEventListener('click', () => li.classList.toggle('collapsed'))
      } else {
        li.className = 'node-file'
        row.innerHTML = ICON_FILE
        const name = document.createElement('span')
        name.textContent = node.name
        row.appendChild(name)
        if (node.status) {
          const badge = document.createElement('span')
          badge.className = `status-badge ${node.status}`
          badge.textContent = node.status === 'new' ? 'new' : node.status
          row.appendChild(badge)
        }
        row.addEventListener('click', () => window.gitbar.openFile(node.path))
        li.appendChild(row)
      }
      parentUl.appendChild(li)
    }
  }

  function applySearch(treeEl, query) {
    const q = query.trim().toLowerCase()
    const files = treeEl.querySelectorAll('.node-file')
    files.forEach((li) => { li.style.display = !q || li.dataset.path.includes(q) ? '' : 'none' })
    // hide folders with no visible files; expand matches while searching
    const dirs = [...treeEl.querySelectorAll('.node-dir')].reverse()
    dirs.forEach((li) => {
      const visible = [...li.querySelectorAll('.node-file')].some((f) => f.style.display !== 'none')
      li.style.display = !q || visible ? '' : 'none'
      if (q && visible) li.classList.remove('collapsed')
    })
  }

  async function renderBrowse() {
    const body = bodyEl()
    body.innerHTML = '<div class="browse-wrap"><div class="browse-search-row">' +
      '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' +
      '<input id="browse-search" placeholder="search files..." spellcheck="false"></div>' +
      '<div class="tree"><span class="muted tree-loading">loading…</span></div></div>'
    const treeEl = body.querySelector('.tree')
    const res = await window.gitbar.tree()
    if (current !== 'browse') return
    treeEl.innerHTML = ''
    const ul = document.createElement('ul')
    buildNodes(res.tree, ul)
    treeEl.appendChild(ul)
    requestPanelHeight()
    body.querySelector('#browse-search').addEventListener('input', (e) => applySearch(treeEl, e.target.value))
  }

  // ---------- entry point ----------
  const TAB_LABELS = {
    diff: 'git diff', status: 'git status', pull: 'git pull',
    push: 'git push', commit: 'commit', browse: 'browse',
    remote: 'remote / auth'
  }

  // Push is powerful (rewrites the remote), so confirm before running.
  function renderPushConfirm(state) {
    const body = bodyEl()
    body.innerHTML = ''
    const wrap = document.createElement('div')
    wrap.className = 'confirm-box'

    const ahead = state && state.ahead ? state.ahead : 0
    const dest = (state && state.upstream) || (state && state.originUrl) || 'origin'
    const msg = document.createElement('div')
    msg.className = 'confirm-msg'
    msg.innerHTML = `Push <b>${ahead || 'your'}</b> commit${ahead === 1 ? '' : 's'} to <b>${esc(dest)}</b>?`

    const sub = document.createElement('div')
    sub.className = 'muted confirm-sub'
    sub.textContent = 'This publishes your local commits to the remote.'

    const row = document.createElement('div')
    row.className = 'confirm-row'
    const cancel = document.createElement('button')
    cancel.className = 'mini-btn'
    cancel.textContent = 'Cancel'
    const go = document.createElement('button')
    go.className = 'commit-btn'
    go.textContent = 'Push'
    row.append(cancel, go)

    cancel.addEventListener('click', () => Bar.closePanelExternal())
    go.addEventListener('click', () => {
      renderStream('push')
      window.gitbar.push()
    })

    wrap.append(msg, sub, row)
    body.appendChild(wrap)
    requestPanelHeight()
  }

  function render(type, state) {
    current = type
    tabEl().textContent = TAB_LABELS[type] || type
    if (type === 'diff') renderDiff()
    else if (type === 'status') renderStatus()
    else if (type === 'pull') renderStream(type)
    else if (type === 'push') renderPushConfirm(state)
    else if (type === 'commit') renderCommit(state)
    else if (type === 'browse') renderBrowse()
    else if (type === 'remote') renderRemote(state)
  }

  function close() { current = null; streamOp = null }

  window.gitbar.onStream(handleStream)

  return { render, close, get current() { return current } }
})()
