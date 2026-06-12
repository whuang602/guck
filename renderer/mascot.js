// Guck mascot — a kid in a duck costume, standing at the screen edge.
// Idle breathing runs as a CSS loop; every 8–12s a random one-shot
// action class is applied (wave / look around / stretch).

const MASCOT_SVG = `
<svg viewBox="0 0 44 66" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g class="m-body-group">
    <!-- webbed feet -->
    <g class="m-leg-l"><ellipse cx="15" cy="58.5" rx="4.6" ry="2.4" fill="#E8A33D"/></g>
    <g class="m-leg-r"><ellipse cx="25.5" cy="58.5" rx="4.6" ry="2.4" fill="#E8A33D"/></g>

    <!-- tail feathers, pointing away from the screen -->
    <path d="M32 47 Q38 46 37 40 Q41 46 35.5 50 Z" fill="#EDBA3F"/>

    <!-- duck suit body; .m-belly scales horizontally with unpushed commits -->
    <g class="m-belly">
      <g class="m-torso">
        <path d="M20 31 Q31 32 32 44 Q32 55 26 57 L15 57 Q9 55 9 44 Q10 32 20 31 Z" fill="#F5C84C"/>
        <ellipse cx="20.5" cy="46" rx="7.5" ry="8.5" fill="#FBE9B7"/>
      </g>
    </g>

    <!-- wing arms -->
    <g class="m-arm-l">
      <path d="M11 37 Q5 40 4.5 46 L8 47.5 Q10.5 42 13.5 40 Z" fill="#EDBA3F"/>
    </g>
    <g class="m-arm-r">
      <path d="M30 37 Q35 41 34 47 L30.5 48 Q30 42 28.5 39 Z" fill="#EDBA3F"/>
    </g>

    <!-- duck hood with the kid's face peeking out, facing the screen -->
    <g class="m-head">
      <circle cx="20" cy="22" r="11" fill="#F5C84C"/>
      <!-- crest tuft -->
      <path d="M20 11.5 Q21 6.5 25 6 Q22.5 8 23 11.5 Z" fill="#F5C84C" stroke="#D9A93C" stroke-width="0.7"/>
      <!-- duck eyes on the hood -->
      <circle cx="14.5" cy="14.5" r="1.2" fill="#3a3a3a"/>
      <circle cx="23.5" cy="14.5" r="1.2" fill="#3a3a3a"/>
      <!-- bill: brim over the face -->
      <path d="M12 17 Q2 16.5 3.5 20.5 Q6 23.5 13 21.5 Z" fill="#D98A2B"/>
      <path d="M4.5 21.5 Q9 23.2 12.5 22" fill="none" stroke="#B36F1F" stroke-width="0.9" stroke-linecap="round"/>
      <!-- the kid's face -->
      <circle cx="18.5" cy="24.5" r="6.8" fill="#FFE9D6"/>
      <circle cx="16" cy="23.8" r="0.95" fill="#3a3a3a"/>
      <circle cx="21.3" cy="23.8" r="0.95" fill="#3a3a3a"/>
      <circle cx="14.4" cy="26.6" r="1.3" fill="#F6B8AE" opacity="0.85"/>
      <circle cx="22.9" cy="26.6" r="1.3" fill="#F6B8AE" opacity="0.85"/>
      <path d="M17 27.8 Q18.6 29.4 20.2 27.8" stroke="#B3653F" stroke-width="0.9" fill="none" stroke-linecap="round"/>
    </g>

    <!-- "?" bubble: visible when the repo has uncommitted changes -->
    <g class="m-q">
      <circle cx="36" cy="8" r="5.4" fill="#f6ead8" stroke="#ba7517" stroke-width="0.8"/>
      <text x="36" y="10.6" text-anchor="middle" font-size="8" font-weight="bold" fill="#ba7517" font-family="monospace">?</text>
    </g>
  </g>
</svg>`

const Mascot = (() => {
  const ACTIONS = ['act-wave', 'act-look', 'act-stretch']
  let el = null
  let timer = null

  function scheduleNext() {
    const delay = 8000 + Math.random() * 4000
    timer = setTimeout(() => {
      const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)]
      el.classList.add(action)
      setTimeout(() => el.classList.remove(action), 2100)
      scheduleNext()
    }, delay)
  }

  function init() {
    el = document.getElementById('mascot')
    el.innerHTML = MASCOT_SVG
    scheduleNext()
  }

  function perk(on) {
    if (el) el.classList.toggle('perk', on)
  }

  // Repo-state body language: "?" bubble while there are uncommitted
  // changes; belly grows with unpushed commits (caps at 5).
  function setState({ changes, ahead }) {
    if (!el) return
    el.classList.toggle('has-changes', changes > 0)
    const chub = 1 + Math.min(ahead || 0, 5) * 0.16
    el.style.setProperty('--chub', chub)
  }

  return { init, perk, setState }
})()

Mascot.init()
