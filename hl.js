// HYPEDUAL page. Everything comes from /api/r (the relay), which reads Hyperliquid and Solana live.
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
      ${chains(c, pct)}
      <div class="act"><button class="btn sm" id="share">Copy this coin's meter link</button><a class="btn ghost sm" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent(`$${c.symbol}'s creator fees cover ${n(pct, pct < 1 ? 3 : 2)}% of a Hyperliquid ticker right now.\n\n${location.origin}/?c=${c.mint}`)}">Post it</a><span class="fine">${c.binds} holder${c.binds === 1 ? '' : 's'} bound a Hyperliquid address</span></div>
      <div class="bind"><h4>Hold $${esc(c.symbol)}? Bind your Hyperliquid address.</h4><p>Your Solana wallet signs one message linking it to your Hyperliquid (0x…) address. When the creator takes the snapshot, you claim your exact balance of the twin on HyperEVM. It moves nothing.</p>
        <div class="row"><input id="hlAddr" placeholder="0x… your Hyperliquid address" spellcheck="false"><button class="btn ghost sm" id="evm">Use my EVM wallet</button><button class="btn sm" id="sign">Sign with Solana wallet</button></div><div class="err" id="bindErr"></div></div>
    </div>`
    $('share').onclick = () => navigator.clipboard?.writeText(`${location.origin}/?c=${c.mint}`).then(() => toast('Link copied'))
    $('evm').onclick = async () => { try { const [a] = await window.ethereum.request({ method: 'eth_requestAccounts' }); $('hlAddr').value = a } catch { $('bindErr').textContent = 'no EVM wallet found: paste the address instead' } }
    $('sign').onclick = () => bind(c)
    wireChains(c)
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

  // ------------------------------------------------------------ the coin's three chains: pump.fun, HyperEVM twin, HyperCore ticker
  const short = (a) => a.slice(0, 6) + '…' + a.slice(-4)
  const LX = () => (window.HLX ? Promise.resolve(window.HLX) : new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'assets/launch.js'; sc.onload = () => ok(window.HLX); sc.onerror = no; document.head.appendChild(sc) }))
  function chains(c, pct) {
    const t = c.twin, snap = t?.snapshot, posted = t?.root, match = snap && posted && posted.toLowerCase() === snap.root.toLowerCase()
    const twinBox = t
      ? `<small>contract <a href="https://hyperevmscan.io/address/${t.address}" target="_blank" rel="noopener">${short(t.address)}</a></small>
         <small>${!snap ? 'snapshot not taken yet' : !posted ? `snapshot of ${snap.holders} holders taken, root not posted yet` : match ? `snapshot of ${snap.holders} holders · root on chain matches` : 'root on chain does NOT match the public snapshot'}</small>
         ${!snap ? '<button class="btn ghost sm" id="tSnap">Take the snapshot (creator)</button>' : !posted ? '<button class="btn ghost sm" id="tRoot">Post the root (creator)</button>' : match ? '<button class="btn sm" id="tClaim">Claim my twin</button>' : ''}`
      : `<small>no twin yet</small><button class="btn ghost sm" id="tDeploy">Deploy its twin (creator)</button>`
    return `<div class="chains">
      <div class="chain"><div class="ch1"><img src="assets/platforms/pumpfun.png" alt="">pump.fun<em>live</em></div><small><a href="https://pump.fun/coin/${c.mint}" target="_blank" rel="noopener">${short(c.mint)}</a></small><small>${c.graduated ? 'graduated to PumpSwap' : 'on the bonding curve'}</small></div>
      <div class="chain"><div class="ch1"><img src="assets/platforms/hyperliquid.png" alt="">HyperEVM twin<em class="${t ? '' : 'wait'}">${t ? 'deployed' : 'none'}</em></div>${twinBox}<span class="err" id="tErr"></span></div>
      <div class="chain"><div class="ch1"><img src="assets/platforms/hyperliquid.png" alt="">HyperCore ticker<em class="wait">${n(pct, pct < 1 ? 3 : 2)}%</em></div><small>creator fees vs the live HIP-1 auction (${n(c.ticker.hype, 0)} HYPE)</small></div>
    </div>`
  }
  function wireChains(c) {
    const err = (e) => { const el = $('tErr'); if (el) el.textContent = String(e?.message || e).slice(0, 200) }
    const run = (id, fn) => { const b = $(id); if (b) b.onclick = async () => { b.disabled = true; err(''); try { await fn((t) => (b.textContent = t)); toast('Done'); check(c.mint) } catch (e) { err(e); b.disabled = false } } }
    run('tDeploy', async (note) => { const X = await LX(); const sol = await X.connectSol(); if (sol !== c.creator) throw new Error('connect the coin\'s creator wallet (' + short(c.creator) + ')'); const evm = await X.connectEvm(); await X.deployTwin({ mint: c.mint, name: c.name, symbol: c.symbol, image: c.img, evm }, note) })
    run('tSnap', async (note) => { const X = await LX(); const sol = await X.connectSol(); if (sol !== c.creator) throw new Error('only the creator wallet can take it'); note('sign in your Solana wallet'); await X.takeSnapshot(c.mint) })
    run('tRoot', async (note) => { const X = await LX(); const evm = await X.connectEvm(); if (evm !== c.twin.evmCreator) throw new Error('connect the EVM wallet that deployed the twin'); await X.postRoot({ twin: c.twin.address, root: c.twin.snapshot.root, evm }, note) })
    run('tClaim', async (note) => { const X = await LX(); const evm = await X.connectEvm(); await X.claim({ mint: c.mint, twin: c.twin.address, evm }, note) })
  }

  // ------------------------------------------------------------ launch on both
  let pic64 = null, sol = null, evm = null
  const pick = async (f) => {
    if (!f || !/^image\//.test(f.type)) return
    const bmp = await createImageBitmap(f), side = Math.min(bmp.width, bmp.height), cv = document.createElement('canvas'); cv.width = cv.height = 512
    cv.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 512, 512)
    pic64 = f.type === 'image/gif' && f.size < 1_800_000 ? await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f) }) : cv.toDataURL('image/png')
    $('lPrev').src = pic64; $('lPrev').hidden = false
  }
  $('lFile').onchange = (e) => pick(e.target.files[0])
  const drop = $('lPic'); drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('drag') }; drop.ondragleave = () => drop.classList.remove('drag'); drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('drag'); pick(e.dataTransfer.files[0]) }
  $('lSym').oninput = (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))
  const wset = (id, a) => { const b = $(id); b.classList.add('on'); b.querySelector('small').textContent = short(a) }
  const lnote = (t, bad) => { $('lNote').textContent = t; $('lNote').classList.toggle('err', !!bad) }
  $('wSol').onclick = async () => { try { sol = await (await LX()).connectSol(); wset('wSol', sol) } catch (e) { lnote(e.message, true) } }
  $('wEvm').onclick = async () => { try { evm = await (await LX()).connectEvm(); wset('wEvm', evm) } catch (e) { lnote(e.message, true) } }
  const step = (k, st) => { const li = $('lSteps').querySelector(`[data-k="${k}"]`); li.className = st || '' }
  $('lGo').onclick = async () => {
    const name = $('lName').value.trim(), symbol = $('lSym').value.trim(), go = $('lGo')
    if (!name || !symbol || !pic64) return lnote('name, ticker and a picture first', true)
    go.disabled = true; ['meta', 'pump', 'twin', 'link'].forEach((k) => step(k)); $('lDone').innerHTML = ''
    let cur = 'meta'
    try {
      const X = await LX()
      if (!sol) { sol = await X.connectSol(); wset('wSol', sol) }
      if (!evm) { evm = await X.connectEvm(); wset('wEvm', evm) }
      step('meta', 'run')
      const r = await X.launchPump({ name, symbol, description: $('lDesc').value, twitter: $('lX').value, image: pic64, buy: +$('lBuy').value || 0, sol }, (t) => { lnote(t); if (/sign the launch/.test(t)) { step('meta', 'ok'); step(cur = 'pump', 'run') } })
      step('meta', 'ok'); step('pump', 'ok'); step(cur = 'twin', 'run')
      const twin = await X.deployTwin({ mint: r.mint, name, symbol, image: r.image, evm }, (t) => { lnote(t); if (/sign the link/.test(t)) { step('twin', 'ok'); step(cur = 'link', 'run') } })
      step('twin', 'ok'); step('link', 'ok'); lnote(`$${symbol} is live on both chains.`)
      $('lDone').innerHTML = `<div class="done"><span>pump.fun <a href="https://pump.fun/coin/${r.mint}" target="_blank" rel="noopener">${r.mint}</a></span><span>HyperEVM <a href="https://hyperevmscan.io/address/${twin}" target="_blank" rel="noopener">${twin}</a></span><span><a href="/?c=${r.mint}">Open its page: binds, snapshot, claims, ticker meter</a></span></div>`
      launched()
    } catch (e) { step(cur, 'no'); lnote(String(e?.message || e).slice(0, 240), true) }
    go.disabled = false
  }
  async function launched() {
    const r = await api('launches').catch(() => null); if (!r?.coins?.length) return
    $('launched').innerHTML = r.coins.map((L) => `<div class="lc" data-m="${esc(L.mint)}">${L.img ? `<img src="${esc(L.img)}" alt="">` : ph(L)}<div><b>$${esc(L.symbol)}</b><small><img src="assets/platforms/pumpfun.png" alt="">${esc(short(L.mint))}</small><small><img src="assets/platforms/hyperliquid.png" alt="">${esc(short(L.twin))}</small></div><div class="f">+${n(L.fees1h, 3)}<small>SOL / hour</small></div></div>`).join('')
    $('launched').querySelectorAll('.lc').forEach((d) => (d.onclick = () => { $('mint').value = d.dataset.m; check(d.dataset.m); $('check').scrollIntoView() }))
  }
  launched(); setInterval(launched, 20000)

  const start = new URLSearchParams(location.search).get('c')
  if (start) { $('mint').value = start; check(start); setTimeout(() => $('check').scrollIntoView(), 300) }
})()
