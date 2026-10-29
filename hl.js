// HYPERLIST page. Everything comes from /api/r (the relay), which reads Hyperliquid and Solana live.
(() => {
  const $ = (id) => document.getElementById(id)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const api = (path, q = '', body) => fetch(`/api/r?path=${path}${q}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' }).then((r) => r.json())
  const pic = (u) => (u ? `/api/img?u=${encodeURIComponent(u)}` : '')
  const n = (v, d = 2) => (v == null ? '–' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }))
  const usd = (v) => (v == null ? '–' : '$' + Math.round(v).toLocaleString('en-US'))
  const ago = (ms) => { const s = ms / 1000; return s < 60 ? Math.floor(s) + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : Math.floor(s / 3600) + 'h' }
  const pace = (h) => (h == null ? 'no trades this hour' : h < 1 ? 'under an hour' : h < 48 ? pl(Math.round(h), 'hour') : h < 24 * 400 ? pl(Math.round(h / 24), 'day') : pl(Math.round(h / 24 / 365), 'year'))
  const pl = (v, w) => v.toLocaleString() + ' ' + w + (v === 1 ? '' : 's')
  const ph = (c) => `<span class="ph">${esc((c.symbol || '?')[0])}</span>`
  const img = (c) => (c.img ? `<img src="${pic(c.img)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;ph&quot;>${esc((c.symbol || '?')[0])}</span>'">` : ph(c))
  let S = null, skew = 0
  function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => (el.hidden = true), 3200) }

  // ------------------------------------------------------------ the dial: the HIP-1 auction, interpolated between reads
  const ticks = $('ticks')
  for (let i = 0; i < 31; i++) { const a = (i / 31) * Math.PI * 2, r1 = 124, r2 = i % 6 === 0 ? 116 : 120; ticks.insertAdjacentHTML('beforeend', `<line x1="${150 + Math.cos(a) * r1}" y1="${150 + Math.sin(a) * r1}" x2="${150 + Math.cos(a) * r2}" y2="${150 + Math.sin(a) * r2}"/>`) }
  function dial() {
    if (!S?.auction) return
    const A = S.auction, now = Date.now() + skew, t = Math.min(1, Math.max(0, (now - A.start) / A.dur)), hype = S.prices.hype
    let gas, st
    if (A.endGas != null) { gas = A.endGas; st = `a ticker sold at ${n(A.endGas, 0)} HYPE · next auction in ${hm(A.start + A.dur - now)}` }
    else if (t >= 1) { gas = A.floor; st = 'at the 500 HYPE floor' }
    else { gas = A.startGas + (A.floor - A.startGas) * t; st = `falls to 500 in ${hm(A.start + A.dur - now)}` }
    $('gas').textContent = gas.toFixed(gas < 1000 ? 2 : 1)
    $('gasUsd').textContent = `${usd(gas * hype)} · ${S.prices.sol ? n((gas * hype) / S.prices.sol, 0) : '–'} SOL`
    $('gasSt').textContent = st
    $('ringPg').style.strokeDashoffset = String(854.5 * (1 - (A.endGas != null ? 1 : t)))
  }
  const hm = (ms) => { ms = Math.max(0, ms); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60; return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}s` }
  setInterval(dial, 250)

  // ------------------------------------------------------------ the stage: fees in on the left, tickers out on the right
  const L = new Map(), R = new Map(), TOPS = [0, 104, 208, 312]
  function chip(side, key, html) { const d = document.createElement('div'); d.className = 'chip' + (side === 'r' ? ' tick' : ''); d.innerHTML = html; return d }
  function sync(map, items, col, side) {
    const keep = new Set(items.map((x) => x.key))
    for (const [k, d] of map) if (!keep.has(k)) { d.classList.add('out'); setTimeout(() => d.remove(), 400); map.delete(k) }
    items.forEach((x, i) => { let d = map.get(x.key); if (!d) { d = chip(side, x.key, x.html); map.set(x.key, d); col.appendChild(d) } else d.querySelector('.upd').innerHTML = x.upd; d.style.top = TOPS[i] + 'px'; d.classList.toggle('new', !!x.isNew) })
  }
  function stage() {
    const seen = new Set(), left = S.race.filter((c) => !seen.has(c.symbol) && seen.add(c.symbol)).slice(0, 4).map((c) => ({ key: c.mint, html: `${img(c)}<div class="tx upd">${upL(c)}</div><span class="val">+${n(c.fees1h, 3)}</span>`, upd: upL(c) }))
    const right = S.tickers.slice(0, 4).map((t) => ({ key: t.name + t.index, isNew: t.at && Date.now() - t.at < 3600_000, html: `<span class="ph">${esc(t.name.slice(0, 3))}</span><div class="tx upd">${upR(t)}</div><span class="val">HIP-1</span>`, upd: upR(t) }))
    sync(L, left, $('colL'), 'l'); sync(R, right, $('colR'), 'r')
    const cy = 242, w = (x1, y1, x2, y2, cls, i) => `<path class="wire ${cls}" style="animation-delay:${-i * 0.4}s" d="M${x1} ${y1} C ${x1 + 70} ${y1}, ${x2 - 70} ${y2}, ${x2} ${y2}"/>`
    let s = ''
    left.forEach((_, i) => { const y1 = 30 + TOPS[i] + 38, y2 = cy - 54 + i * 36, x2 = 590 - Math.sqrt(160 ** 2 - (y2 - cy) ** 2); s += w(300, y1, x2, y2, 'base', i) + w(300, y1, x2, y2, 'l flow', i) })
    right.forEach((_, i) => { const y2 = 30 + TOPS[i] + 38, y1 = cy - 54 + i * 36, x1 = 590 + Math.sqrt(160 ** 2 - (y1 - cy) ** 2); s += w(x1, y1, 880, y2, 'base', i) + w(x1, y1, 880, y2, 'r flow', i) })
    $('wires').innerHTML = s
  }
  const upL = (c) => `<b>$${esc(c.symbol)}</b><small>${c.trades1h} trades · ${n(c.vol1h, 1)} SOL volume</small>`
  const upR = (t) => `<b>${esc(t.name)}</b><small>${t.at ? 'listed ' + ago(Date.now() - t.at) + ' ago' : 'spot token #' + t.index}</small>`
  function fit() { const el = $('stage'); if (innerWidth < 700) { el.style.transform = ''; el.style.marginBottom = ''; return } const k = Math.min(1, (innerWidth - 24) / 1180); el.style.transform = `scale(${k})`; el.style.marginBottom = -460 * (1 - k) + 6 + 'px' }
  addEventListener('resize', fit); fit()

  // ------------------------------------------------------------ the race table
  function race() {
    const tgt = S.ticker.sol
    $('raceRows').innerHTML = S.race.length ? S.race.map((c, i) => `<div class="tr" data-m="${esc(c.mint)}"><span class="rk">${i + 1}</span><span class="c">${img(c)}<b>$${esc(c.symbol)}</b></span>
      <span class="f">${n(c.fees1h, 3)} SOL</span><span>${c.unclaimed == null ? '…' : n(c.unclaimed, 3) + ' SOL'}</span>
      <span>${c.pct == null ? '…' : n(c.pct, c.pct < 1 ? 3 : 2) + '%'}<div class="bar"><i style="width:${Math.min(100, c.pct || 0)}%"></i></div></span><span>${pace(c.etaH)}</span></div>`).join('')
      : '<div class="empty">Reading pump.fun… the first trades land in a few seconds.</div>'
    $('raceRows').querySelectorAll('.tr').forEach((r) => (r.onclick = () => { $('mint').value = r.dataset.m; check(r.dataset.m); $('check').scrollIntoView() }))
  }

  async function poll() {
    try {
      const s = await api('state'); if (s.error) throw 0
      S = s; skew = s.now - Date.now()
      $('dot').className = s.live ? '' : 'off'; $('liveTxt').textContent = s.live ? 'live · Solana + Hyperliquid' : 'reconnecting'
      $('sFees').textContent = n(s.hour.fees, 2); $('sTrades').textContent = s.hour.trades.toLocaleString(); $('sFloor').textContent = `500 HYPE · ${usd(s.ticker.floorUsd)}`
      dial(); stage(); race()
    } catch { $('dot').className = 'off'; $('liveTxt').textContent = 'reconnecting' }
  }
  poll(); setInterval(poll, 5000)

  // ------------------------------------------------------------ check a coin
  $('form').onsubmit = (e) => { e.preventDefault(); const m = $('mint').value.trim(); if (m) check(m) }
  async function check(m) {
    $('result').innerHTML = '<div class="card"><span class="err" style="color:var(--dim)">reading Solana and Hyperliquid…</span></div>'
    const c = await api('coin', '&mint=' + encodeURIComponent(m)).catch(() => ({ error: 'the relay is offline' }))
    if (c.error) { $('result').innerHTML = `<div class="card"><span class="err">${esc(c.error)}</span></div>`; return }
    history.replaceState(null, '', '?c=' + c.mint)
    const tgt = c.ticker.sol, pct = c.pct ?? 0
    $('result').innerHTML = `<div class="card">
      <div class="hd">${img(c)}<div><b>$${esc(c.symbol || '?')}</b><small>${esc(c.name)} · creator ${esc(c.creator.slice(0, 4))}…${esc(c.creator.slice(-4))}</small></div><span class="tag">${c.graduated ? 'graduated · PumpSwap' : 'on the bonding curve'}${c.mc ? ' · mcap ' + usd(c.mc) : ''}</span></div>
      <div class="meter"><i style="width:${Math.min(100, pct)}%"></i></div>
      <div class="ml"><span><b>${n(c.unclaimed, 3)} SOL</b> unclaimed creator fees</span><span>a ticker now: <b>${n(tgt, 0)} SOL</b> (${n(c.ticker.hype, 0)} HYPE, ${usd(c.ticker.usd)})</span></div>
      <div class="kv"><div><small>of a ticker</small><b>${n(pct, pct < 1 ? 3 : 2)}%</b></div><div><small>fees, last hour</small><b>${n(c.fees1h, 3)} SOL</b></div><div><small>volume, last hour</small><b>${n(c.vol1h, 1)} SOL</b></div><div><small>full at this pace</small><b>${pace(c.etaH)}</b></div></div>
      <div class="act"><button class="btn sm" id="share">Copy this coin's meter link</button><a class="btn ghost sm" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent(`$${c.symbol}'s creator fees cover ${n(pct, pct < 1 ? 3 : 2)}% of a Hyperliquid ticker right now.\n\n${location.origin}/?c=${c.mint}`)}">Post it</a><span class="fine">${c.binds} holder${c.binds === 1 ? '' : 's'} bound a Hyperliquid address</span></div>
      <div class="bind"><h4>Hold $${esc(c.symbol)}? Bind your Hyperliquid address.</h4><p>Your Solana wallet signs one message linking it to your Hyperliquid (0x…) address, for the HyperCore twin's genesis. It moves nothing.</p>
        <div class="row"><input id="hlAddr" placeholder="0x… your Hyperliquid address" spellcheck="false"><button class="btn ghost sm" id="evm">Use my EVM wallet</button><button class="btn sm" id="sign">Sign with Solana wallet</button></div><div class="err" id="bindErr"></div></div>
    </div>`
    $('share').onclick = () => navigator.clipboard?.writeText(`${location.origin}/?c=${c.mint}`).then(() => toast('Link copied'))
    $('evm').onclick = async () => { try { const [a] = await window.ethereum.request({ method: 'eth_requestAccounts' }); $('hlAddr').value = a } catch { $('bindErr').textContent = 'no EVM wallet found: paste the address instead' } }
    $('sign').onclick = () => bind(c)
  }

  // ------------------------------------------------------------ binding: one signed message, verified by the relay
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const b58 = (u8) => { let x = 0n; for (const b of u8) x = x * 256n + BigInt(b); let s = ''; while (x > 0n) { s = B58[Number(x % 58n)] + s; x /= 58n } for (const b of u8) { if (b) break; s = '1' + s } return s }
  async function bind(c) {
    const err = $('bindErr'); err.textContent = ''
    const hl = $('hlAddr').value.trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(hl)) { err.textContent = 'paste a Hyperliquid (0x…) address first'; return }
    const w = window.phantom?.solana || window.solflare || window.backpack || window.solana
    if (!w?.signMessage) { err.textContent = 'no Solana wallet found (Phantom, Solflare or Backpack)'; return }
    try {
      const sol = (await w.connect()).publicKey?.toString() || w.publicKey.toString()
      const { msg } = await api('bindmsg', `&mint=${c.mint}&sol=${sol}&hl=${hl}`)
      const out = await w.signMessage(new TextEncoder().encode(msg), 'utf8')
      const r = await api('bind', '', { mint: c.mint, sol, hl, sig: b58(out.signature || out) })
      if (r.error) throw new Error(r.error)
      toast(`Bound. ${r.binds} holder${r.binds === 1 ? '' : 's'} on this coin.`); check(c.mint)
    } catch (e) { err.textContent = e.message || 'cancelled' }
  }

  const start = new URLSearchParams(location.search).get('c')
  if (start) { $('mint').value = start; check(start); setTimeout(() => $('check').scrollIntoView(), 300) }
})()
