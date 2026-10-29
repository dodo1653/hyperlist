// HYPEDUAL film score (38 s, 120 bpm): a clean pulse that builds through the tunnel, typing and chimes on the
// launcher, a drop at 0.30 %, pops as the coins fill the meter, and a held chord on the end card.
// usage: DUR=38 node music.mjs music.wav
import fs from 'node:fs'

const SR = 44100, DUR = +(process.env.DUR || 15), N = SR * DUR, TAU = Math.PI * 2
const L = new Float32Array(N), R = new Float32Array(N), VL = new Float32Array(N), VR = new Float32Array(N)
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12)
let seed = 4242
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
const seg = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)))
function add(i, v, pan = 0, send = 0) {
  i |= 0; if (i < 0 || i >= N) return
  const a = ((pan + 1) * Math.PI) / 4, l = v * Math.cos(a) * 1.414, r = v * Math.sin(a) * 1.414
  L[i] += l; R[i] += r; if (send) { VL[i] += l * send; VR[i] += r * send }
}
// soft plucked keys: sine + detuned triangle, fast attack, exp decay, gentle lowpass
function pluck(t0, m, amp = 0.12, dec = 4, pan = 0, send = 0.4) {
  const f = mtof(m); let y = 0
  for (let k = 0; k < Math.min(2.5, 6 / dec) * SR; k++) {
    const tt = k / SR, ph = tt * f
    let v = Math.sin(ph * TAU) * 0.7 + (4 * Math.abs(((ph * 1.003) % 1) - 0.5) - 1) * 0.35 + Math.sin(ph * 2 * TAU) * 0.15 * Math.exp(-tt * 12)
    y += 0.35 * (v - y)
    add(t0 * SR + k, y * Math.exp(-tt * dec) * Math.min(1, tt * 600) * amp, pan, send)
  }
}
function pad(t0, t1, notes, amp, att = 0.4, rel = 0.6) {
  notes.forEach((m, ni) => {
    let p1 = 0, p2 = 0, y = 0; const f = mtof(m)
    for (let i = (t0 * SR) | 0; i < Math.min(N, (t1 + rel) * SR); i++) {
      const t = i / SR, env = Math.min(1, (t - t0) / att) * (t > t1 ? Math.max(0, 1 - (t - t1) / rel) : 1)
      p1 += f / SR; p2 += (f * 1.005) / SR
      y += 0.04 * (((p1 % 1) * 2 - 1) + ((p2 % 1) * 2 - 1) - y)
      add(i, y * env * amp, ni % 2 ? 0.45 : -0.45, 0.5)
    }
  })
}
function kick(t0, amp = 0.8) { let ph = 0; for (let k = 0; k < 0.35 * SR; k++) { const tt = k / SR; ph += (TAU * (46 + 100 * Math.exp(-tt * 32))) / SR; add(t0 * SR + k, Math.sin(ph) * Math.exp(-tt * 9) * amp) } }
function snap(t0, amp = 0.3) { let p = 0; for (let k = 0; k < 0.16 * SR; k++) { const tt = k / SR, n = noise(), hp = n - p * 0.8; p = n; add(t0 * SR + k, hp * Math.exp(-tt * 30) * amp, 0.1, 0.35) } }
function hat(t0, amp = 0.08, pan = 0.3) { let p = 0; for (let k = 0; k < 0.04 * SR; k++) { const tt = k / SR, n = noise(), hp = n - p; p = n; add(t0 * SR + k, hp * Math.exp(-tt * 90) * amp, pan) } }
function sub(t0, dur, m, amp = 0.22) { const f = mtof(m); for (let k = 0; k < dur * SR; k++) { const tt = k / SR; const env = Math.min(1, tt * 80) * Math.min(1, (dur - tt) * 30); add(t0 * SR + k, Math.sin(tt * f * TAU) * env * amp) } }
function whoosh(t0, dur, amp = 0.3) { let y = 0; for (let k = 0; k < dur * SR; k++) { const p = k / (dur * SR), e = Math.sin(p * Math.PI) ** 2; y += (0.03 + 0.45 * e) * (noise() - y); add(t0 * SR + k, y * e * amp, (p - 0.5) * 1.6, 0.3) } }
function clink(t0, amp = 0.08, f = 3200, pan = 0) { for (let k = 0; k < 0.35 * SR; k++) { const tt = k / SR; add(t0 * SR + k, (Math.sin(tt * TAU * f) * 0.6 + Math.sin(tt * TAU * f * 2.71) * 0.3 + Math.sin(tt * TAU * f * 4.1) * 0.15) * Math.exp(-tt * 14) * amp, pan, 0.5) } }
function boom(t0, amp = 0.7) { let ph = 0; for (let k = 0; k < 1.5 * SR; k++) { const tt = k / SR; ph += (TAU * (40 + 50 * Math.exp(-tt * 8))) / SR; add(t0 * SR + k, Math.sin(ph) * Math.exp(-tt * 3) * amp, 0, 0.2) } }
function sparkle(t0, amp = 0.06) { ;[84, 88, 91, 96, 100, 103].forEach((m, i) => pluck(t0 + i * 0.045, m, amp, 5, i % 2 ? 0.5 : -0.5, 0.7)) }
function click(t0, amp = 0.3) { for (let k = 0; k < 0.03 * SR; k++) { const tt = k / SR; add(t0 * SR + k, (Math.sin(tt * TAU * 1800) * 0.7 + noise() * 0.3) * Math.exp(-tt * 160) * amp) } }
// extra sound design
function tick(t0, amp = 0.05) { const f = 2600 + noise() * 500; for (let k = 0; k < 0.012 * SR; k++) { const tt = k / SR; add(t0 * SR + k, (Math.sin(tt * TAU * f) * 0.5 + noise() * 0.5) * Math.exp(-tt * 380) * amp, 0.1) } }
function pop(t0, amp = 0.22, f0 = 950, f1 = 420) { let ph = 0; for (let k = 0; k < 0.12 * SR; k++) { const tt = k / SR; ph += TAU * (f1 + (f0 - f1) * Math.exp(-tt * 40)) / SR; add(t0 * SR + k, Math.sin(ph) * Math.exp(-tt * 28) * amp, 0, 0.25) } }
function boing(t0, amp = 0.2) { let ph = 0; for (let k = 0; k < 0.6 * SR; k++) { const tt = k / SR; const f = 220 * Math.pow(2, 1.6 * Math.min(1, tt * 3)) * (1 + 0.06 * Math.sin(tt * 38)); ph += TAU * f / SR; add(t0 * SR + k, Math.sin(ph) * Math.exp(-tt * 4.5) * amp, 0, 0.4) } }
function riser(t0, dur, amp = 0.18) { let y = 0; for (let k = 0; k < dur * SR; k++) { const p = k / (dur * SR); y += (0.02 + 0.5 * p * p) * (noise() - y); add(t0 * SR + k, y * p * p * amp, 0, 0.3) } }
function chime(t0) { pluck(t0, 88, 0.07, 6, 0.3, 0.6); pluck(t0 + 0.08, 95, 0.06, 6, -0.3, 0.6) }
function thud(t0, amp = 0.5) { let ph = 0; for (let k = 0; k < 0.5 * SR; k++) { const tt = k / SR; ph += (TAU * (70 + 60 * Math.exp(-tt * 18))) / SR; add(t0 * SR + k, Math.sin(ph) * Math.exp(-tt * 7) * amp, 0, 0.15) } }
const BEAT = 60 / 120
function swipe(t0, dur = .32, amp = .14) { let y = 0; for (let k = 0; k < dur * SR; k++) { const p = k / (dur * SR), e = Math.sin(p * Math.PI) ** 1.5; y += (.02 + .25 * p) * (noise() - y); add(t0 * SR + k, y * e * amp, (p - .5) * .8, .2) } }
// chords: C - Am - F - G, two beats each (bright, simple)
const CH = [[48, 55, 60, 64, 67], [45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [43, 50, 55, 59, 62]]
const BASS = [36, 33, 29, 31]
function groove(t0, t1, { kicks = true, snaps = true, hats = true, bass = true, arp = true, amp = 1 } = {}) {
  for (let t = t0; t < t1 - 0.01; t += BEAT / 2) {
    const k = Math.round((t - t0) / (BEAT / 2)), bar = Math.floor(k / 4) % 4
    if (kicks && k % 2 === 0) kick(t, .42 * amp)
    if (snaps && k % 4 === 2) snap(t, .1 * amp)
    if (hats) hat(t + BEAT / 4, .03 * amp, k % 2 ? .3 : -.3)
    if (bass && k % 2 === 0) sub(t, BEAT * .48, BASS[bar], .12 * amp)
    if (arp) pluck(t, CH[bar][(k % 4) + 1] + 12, .035 * amp, 6, k % 2 ? .4 : -.4, .45)
    if (k % 4 === 0) pad(t, t + BEAT * 2 - .05, CH[bar].slice(0, 4), .012 * amp, .08, .25)
  }
}
// 1. the merge (0 - 3.6): a low bed, the two shapes swoosh in, a flash
pad(0, 3.5, [36, 43, 48, 55], .022, 1.2, .5); sub(0.2, 3.2, 24, .07); whoosh(0.1, 1.5, .1); riser(1.2, 1.25, .16)
boom(2.45, .55); sparkle(2.47, .06); pluck(2.55, 84, .05, 3, 0, .6)
// 2. the title (3.6 - 6.8): the coin flies off, a soft arpeggio, a sparkle on "Hypedual"
swipe(3.6, .45, .1); groove(3.8, 6.8, { kicks: false, snaps: false, bass: false, amp: .7 }); sparkle(4.4, .045); riser(6.0, .8, .14)
// 3. the tunnel (6.8 - 12.4): the beat comes in; a swipe and lift at the swap
boom(6.8, .45); groove(6.8, 12.4); swipe(9.45, .45, .12); riser(8.9, .6, .1); sparkle(9.75, .035)
// 4. the launcher (12.4 - 18.4): lighter groove, keys typing, the click, a chime per step
swipe(12.35, .35, .1); groove(12.4, 18.4, { kicks: false, amp: .75 })
for (const [a, b, n] of [[13.2, 13.85, 9], [14.0, 14.55, 9]]) for (let i = 0; i < n; i++) tick(a + (i * (b - a)) / n, .09)
click(15.0, .35); pop(15.02, .12, 1100, 500)
;[15.8, 16.4, 17.1, 17.75].forEach((t, i) => pluck(t, [76, 79, 83, 88][i], .06, 5, 0, .6)); sparkle(17.8, .05)
riser(17.6, .8, .16)
// 5. 0.30 % (18.4 - 22.6): the drop, the coin rolls in and lands in the zero
boom(18.42, .6); groove(18.4, 22.6); whoosh(18.65, .9, .12); thud(19.45, .4); clink(19.48, .07, 2800)
// 6. the meter (22.6 - 27.2): a pop as each coin lands in the dial
swipe(22.55, .35, .1); groove(22.6, 27.2)
for (let i = 0; i < 10; i++) pop(23.0 + i * 0.32 + 1.25, .1, 900 + i * 40, 420 + i * 20)
riser(26.4, .8, .16)
// 7. the twin (27.2 - 31.0)
boom(27.3, .5); groove(27.2, 31.0, { kicks: false, amp: .8 }); ;[27.9, 28.2, 28.5, 28.8].forEach((t, i) => pop(t, .1, 1000 + i * 60, 480))
// 8. the terminals (31.0 - 34.4)
swipe(30.95, .35, .1); groove(31.0, 34.4); for (let i = 0; i < 8; i++) pop(31.15 + i * 0.08, .06, 1200, 600); riser(33.6, .8, .16)
// 9. the end (34.4 - 38)
boom(34.48, .55); sub(34.48, 2.4, 24, .14); pad(34.4, 37.2, [36, 48, 55, 60, 64, 67], .03, .1, .8); sparkle(35.0, .05); pluck(35.4, 84, .04, 2, .2, .6)
/* reverb */
const taps = [[0.037, 0.5], [0.061, 0.42], [0.097, 0.36], [0.141, 0.3], [0.199, 0.24], [0.271, 0.19], [0.37, 0.14], [0.5, 0.1], [0.66, 0.07]]
let dl = 0, dr = 0
for (let i = 0; i < N; i++) {
  let l = 0, r = 0
  for (const [d, g] of taps) { const j = i - Math.floor(d * SR); if (j >= 0) { l += VR[j] * g; r += VL[j] * g } }
  dl += 0.4 * (l - dl); dr += 0.4 * (r - dr); L[i] += dl * 0.7; R[i] += dr * 0.7
}
/* master */
let peak = 0
for (let i = 0; i < N; i++) { const t = i / SR, f = seg(t, 0, 0.05) * (1 - seg(t, DUR - 1, DUR)); L[i] = Math.tanh(L[i] * 1.1) * f; R[i] = Math.tanh(R[i] * 1.1) * f; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])) }
const g = 0.9 / peak, buf = Buffer.alloc(44 + N * 4)
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40)
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * g * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * g * 32767), 46 + i * 4) }
fs.writeFileSync(process.argv[2] || 'music.wav', buf)
console.log('wrote', process.argv[2], 'peak', peak.toFixed(2))
