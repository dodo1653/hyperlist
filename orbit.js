// The first screen's halftone rings: dots in lanes round tilted ellipses, each ring with one bright arc that travels
// slowly round it, Hyperliquid mint and white, on black. Also mirrors the live ticker price and the CA into the pills,
// and lights the dock item for the section in view.
;(() => {
  const cv = document.getElementById('orbitCv'); if (!cv) return
  const g = cv.getContext('2d'), still = matchMedia('(prefers-reduced-motion: reduce)').matches
  const MINT = [94, 240, 207], WHITE = [236, 255, 250]
  // rx, ry (of the shorter side), tilt, lanes, lane gap, arc start, arc spread, white?, step (deg), speed (deg/s)
  const RINGS = [[0.50, 0.30, -12, 9, 0.012, 205, 64, 0, 1.1, 5], [0.47, 0.272, -9, 5, 0.0085, 25, 52, 1, 1.2, -4],
    [0.57, 0.37, -16, 12, 0.014, 150, 58, 0, 1.0, 3], [0.545, 0.35, -15, 4, 0.0095, 330, 46, 1, 1.2, -6],
    [0.66, 0.45, -20, 8, 0.02, 60, 40, 0, 0.9, 2.5], [0.64, 0.43, -18, 3, 0.011, 250, 36, 1, 1.0, -3]]
  let W = 0, H = 0, dpr = 1, dots = []
  function build() {
    dpr = Math.min(2, devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight
    cv.width = W * dpr; cv.height = H * dpr
    const U = Math.min(W * 0.95, H * 1.35)                                   // ring size follows the shorter side
    dots = []
    for (const [rx, ry, tilt, lanes, gap, arc, spread, white, step, speed] of RINGS) {
      for (let L = 0; L < lanes; L++) {
        const u = (L - (lanes - 1) / 2) * gap, lane = Math.exp(-(((L - (lanes - 1) / 2) / (lanes / 2.2)) ** 2))
        for (let a = Math.random() * step; a < 360; a += step) dots.push({ rx: (rx + u) * U * 1.25, ry: (ry + u * 0.62) * U, t: tilt * Math.PI / 180, a, arc, spread, speed, lane, c: (white > 0.5) !== (Math.random() < 0.08) ? WHITE : MINT })
      }
    }
  }
  function frame(ms) {
    const s = ms / 1000, cx = W / 2, cy = H * 0.47
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); g.globalCompositeOperation = 'lighter'
    for (const d of dots) {
      const a = d.a + s * d.speed * 0.6, arc = d.arc + s * d.speed
      let dist = Math.abs(((a - arc) % 360 + 540) % 360 - 180), env = Math.exp(-((dist / d.spread) ** 2))
      const r = 0.5 + 2.6 * env * d.lane; if (r < 0.65) continue
      const rad = a * Math.PI / 180, x = d.rx * Math.cos(rad), y = d.ry * Math.sin(rad)
      const X = cx + x * Math.cos(d.t) - y * Math.sin(d.t), Y = cy + x * Math.sin(d.t) + y * Math.cos(d.t)
      const k = 0.25 + 0.75 * env
      g.fillStyle = `rgba(${d.c[0]},${d.c[1]},${d.c[2]},${k})`
      g.beginPath(); g.arc(X, Y, r, 0, 6.2832); g.fill()
    }
    g.globalCompositeOperation = 'source-over'
    // keep the words readable: a soft black oval in the middle
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * 0.42)
    grd.addColorStop(0, 'rgba(0,0,0,.92)'); grd.addColorStop(0.7, 'rgba(0,0,0,.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd; g.beginPath(); g.ellipse(cx, cy, W * 0.42, H * 0.3, 0, 0, 6.2832); g.fill()
    if (!still) requestAnimationFrame(frame)
  }
  build(); addEventListener('resize', build); requestAnimationFrame(frame)

  // live values from the page's own elements (hl.js keeps #gas and #ca current)
  const mirror = (from, to, fmt = (t) => t) => { const a = document.getElementById(from), b = document.getElementById(to); if (!a || !b) return; const set = () => { b.textContent = fmt(a.textContent.trim()) }; set(); new MutationObserver(set).observe(a, { childList: true, characterData: true, subtree: true }) }
  mirror('gas', 'oGas'); mirror('ca', 'oCa', (t) => (/soon/i.test(t) ? 'soon' : t.length > 14 ? t.slice(0, 4) + '…' + t.slice(-4) : t))

  // the dock lights the section in view
  const links = [...document.querySelectorAll('.dock a')]
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) links.forEach((l) => l.classList.toggle('on', l.getAttribute('href') === '#' + e.target.id)) }, { rootMargin: '-45% 0px -50% 0px' })
  for (const l of links) { const t = document.querySelector(l.getAttribute('href')); if (t) io.observe(t) }
})()
