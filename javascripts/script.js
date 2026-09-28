/* ================= Helpers ================= */
const $ = id => document.getElementById(id);
const TAU = Math.PI * 2, MAX = 23;
const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;          // random integer a..b
const show = (id, on) => $(id).classList.toggle('hidden', !on);
const NAMES = { red: 'RED', black: 'BLACK', green: 'GREEN' };
const cs = c => '<span class="' + (c === 'red' ? 'r' : c === 'black' ? 'b' : 'g') + '">' + NAMES[c] + '</span>';
const LABEL = { safe: 'SAFE', out: 'OUT', prize: 'PRIZE' };

/* ================= Sounds (Web Audio API, no files needed) ================= */
let audioCtx = null, soundOn = true, lastTick = 0;

function ac() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
// one short beep: frequency, start delay (s), duration (s), wave type, volume
function tone(freq, delay, dur, type = 'sine', vol = 0.15) {
  if (!soundOn) return;
  const c = ac(), t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(c.destination);
  o.start(t); o.stop(t + dur);
}
const sound = {
  // each time the ball / pointer passes a slot (limited so it never turns into a buzz)
  tick() {
    const now = performance.now();
    if (now - lastTick < 35) return;
    lastTick = now;
    tone(1500, 0, 0.03, 'square', 0.04);
  },
  spinStart() { tone(180, 0, 0.3, 'sawtooth', 0.06); tone(320, 0.1, 0.3, 'sawtooth', 0.05); tone(520, 0.2, 0.3, 'sawtooth', 0.04); },
  ding() { tone(880, 0, 0.35, 'triangle', 0.18); tone(1320, 0.08, 0.4, 'triangle', 0.12); },
  land() { tone(140, 0, 0.25, 'sine', 0.35); tone(90, 0.03, 0.3, 'sine', 0.3); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.28, 'triangle', 0.18)); },
  lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.22, 0.4, 'sawtooth', 0.11)); },
  prize() {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.11, 0.3, 'square', 0.09));
    [1568, 2093, 1568, 2093].forEach((f, i) => tone(f, 0.9 + i * 0.09, 0.2, 'triangle', 0.14));   // coin sparkle
  }
};
$('soundBtn').onclick = () => {
  soundOn = !soundOn;
  $('soundBtn').textContent = 'Sound: ' + (soundOn ? 'ON' : 'OFF');
  $('soundBtn').setAttribute('aria-pressed', soundOn);
  if (soundOn) sound.ding();
};

/* ================= Game state ================= */
let banned = {};            // { playerNumber: roundsLeft } -> players sitting out
let chosen = [], nSpins = 0, nRot = 0;   // phase 1
let players = [], turn = 0, bet = null, forced = null, ball = null, ballAngle = 0;   // phase 2

/* ================= Shared drawing: casino rim with gold bulbs ================= */
const S = 380;
function drawRim(ctx, innerR) {
  const outer = S / 2 - 4;
  ctx.beginPath(); ctx.arc(S/2, S/2, outer, 0, TAU); ctx.fillStyle = '#3b1d0e'; ctx.fill();          // wood ring
  ctx.lineWidth = 3; ctx.strokeStyle = '#e2b93b'; ctx.stroke();
  const bulbR = (outer + innerR) / 2;
  for (let i = 0; i < 36; i++) {                                                                     // bulbs
    const a = i * TAU / 36;
    ctx.beginPath(); ctx.arc(S/2 + Math.cos(a) * bulbR, S/2 + Math.sin(a) * bulbR, 3.8, 0, TAU);
    ctx.fillStyle = i % 2 ? '#fff3b0' : '#e2b93b'; ctx.fill();
  }
  ctx.beginPath(); ctx.arc(S/2, S/2, innerR, 0, TAU); ctx.lineWidth = 3; ctx.strokeStyle = '#e2b93b'; ctx.stroke();
}

/* ================= PHASE 1: number wheel (1-23), spun 3 times ================= */
const nX = $('numWheel').getContext('2d'), R1 = S / 2 - 30;
function drawNum() {
  const sl = TAU / MAX;
  nX.clearRect(0, 0, S, S);
  drawRim(nX, R1);
  nX.save(); nX.translate(S/2, S/2); nX.rotate(nRot);
  for (let i = 0; i < MAX; i++) {
    nX.beginPath(); nX.moveTo(0, 0); nX.arc(0, 0, R1, i * sl, (i + 1) * sl); nX.closePath();
    nX.fillStyle = i % 2 ? '#0a3d2a' : '#12603f'; nX.fill();
    nX.strokeStyle = '#e2b93b'; nX.lineWidth = 1.5; nX.stroke();
    nX.save(); nX.rotate((i + .5) * sl); nX.translate(R1 * .76, 0); nX.rotate(Math.PI / 2);
    nX.fillStyle = '#fff3b0'; nX.font = '600 17px Oswald, sans-serif'; nX.textAlign = 'center'; nX.textBaseline = 'middle';
    nX.fillText(i + 1, 0, 0); nX.restore();
  }
  nX.restore();
}
const resetPicks = () => { $('picks').innerHTML = '<div class="seat"><b>?</b>Player</div>'.repeat(3); };
function banText() {
  const k = Object.keys(banned);
  $('banNote').textContent = k.length ? 'Sitting out: ' + k.map(n => '#' + n + ' (' + banned[n] + ' rounds)').join(', ') : '';
}
resetPicks(); banText(); drawNum();

function spinNum() {
  $('spin').disabled = true;
  sound.spinStart();
  const avail = [];
  for (let n = 1; n <= MAX; n++) if (!banned[n] && !chosen.includes(n)) avail.push(n);   // no repeats, no benched players
  const w = avail[rnd(0, avail.length - 1)], sl = TAU / MAX;
  const fin = nRot - (nRot % TAU) + TAU * rnd(6, 7) - ((w - 1) * sl + sl / 2) + 1.5 * Math.PI;   // whole turns: lands exactly on w
  const st = nRot, d = fin - st, t0 = performance.now();
  let lastIdx = -1;
  (function f(now) {
    const t = Math.min(1, (now - t0) / 3200);
    nRot = st + d * (1 - Math.pow(1 - t, 3)); drawNum();
    const idx = Math.floor(((((1.5 * Math.PI - nRot) % TAU) + TAU) % TAU) / sl);      // slot under the pointer
    if (idx !== lastIdx) { lastIdx = idx; sound.tick(); }
    if (t < 1) return requestAnimationFrame(f);
    nRot %= TAU; chosen.push(w); nSpins++; sound.ding();
    $('picks').children[nSpins - 1].innerHTML = '<b>' + w + '</b>Player ' + nSpins;
    if (nSpins < 3) $('msg1').textContent = 'Spin ' + (nSpins + 1) + ' of 3';
    else { $('msg1').textContent = 'Players ready!'; $('spin').textContent = 'CONTINUE'; }
    $('spin').disabled = false;
  })(t0);
}
$('spin').onclick = () => nSpins < 3 ? spinNum() : startPhase2();

/* ================= PHASE 2: color roulette with an orbiting ball ================= */
// 25 slots: 24 alternating red/black + exactly ONE green
const COLORS = Array.from({ length: 24 }, (_, i) => i % 2 ? 'black' : 'red').concat('green');
const N = COLORS.length;
const HEX = { red: '#c62828', black: '#151515', green: '#22b45a' };
const rX = $('rrWheel').getContext('2d'), R2 = S / 2 - 30;

function drawRR() {
  const sl = TAU / N;
  rX.clearRect(0, 0, S, S);
  drawRim(rX, R2);
  for (let i = 0; i < N; i++) {
    rX.beginPath(); rX.moveTo(S/2, S/2); rX.arc(S/2, S/2, R2, i * sl - Math.PI/2, (i + 1) * sl - Math.PI/2); rX.closePath();
    rX.fillStyle = HEX[COLORS[i]]; rX.fill(); rX.strokeStyle = '#e2b93b'; rX.lineWidth = 1.5; rX.stroke();
  }
  rX.beginPath(); rX.arc(S/2, S/2, 28, 0, TAU); rX.fillStyle = '#e2b93b'; rX.fill();               // center cap
  if (ball !== null) {                                                                              // the ball
    const x = S/2 + Math.cos(ball) * (R2 - 18), y = S/2 + Math.sin(ball) * (R2 - 18);
    rX.beginPath(); rX.arc(x + 1.5, y + 2, 10, 0, TAU); rX.fillStyle = 'rgba(0,0,0,.5)'; rX.fill();
    rX.beginPath(); rX.arc(x, y, 9, 0, TAU); rX.fillStyle = '#fff'; rX.fill();
  }
}
drawRR();

function startPhase2() {
  show('phase1', false); show('phase2', true);
  players = chosen.map(n => ({ num: n, status: '', green: false }));
  turn = 0; forced = null; ball = null; drawRR(); beginTurn();
}

function render() {
  const ended = !$('endBox').classList.contains('hidden');
  $('status').innerHTML = players.map((p, i) =>
    '<div class="seat ' + p.status + (i === turn && !ended ? ' current' : '') + '"><b>' + p.num + '</b>P' + (i + 1) +
    '<br><span>' + (LABEL[p.status] || '&nbsp;') + '</span></div>').join('');
}

function beginTurn() {
  render();
  const p = players[turn];
  $('turnTitle').textContent = "Player " + (turn + 1) + "'s turn (#" + p.num + ")";
  ['betRow', 'go', 'colorRow', 'nextTurn', 'endBox'].forEach(id => show(id, false));
  if (forced) {                                              // bet chosen by the previous player's prize
    bet = forced; forced = null; show('go', true);
    $('msg2').innerHTML = 'Forced bet: ' + cs(bet) + '. Spin!';
  } else {
    show('betRow', true); $('msg2').textContent = 'Place your bet';
  }
}

document.querySelectorAll('.bet').forEach(b => b.onclick = () => {
  bet = b.dataset.c; show('betRow', false); show('go', true);
  $('msg2').innerHTML = 'You bet ' + cs(bet) + '. Spin!';
});
document.querySelectorAll('.pick').forEach(b => b.onclick = () => {
  forced = b.dataset.c; show('colorRow', false); show('nextTurn', true);
  $('msg2').innerHTML = 'The next player will bet ' + cs(forced) + '.';
});

$('go').onclick = () => {
  $('go').disabled = true; $('msg2').textContent = 'No more bets...';
  sound.spinStart();
  const w = rnd(0, N - 1), sl = TAU / N, target = w * sl + sl / 2 - Math.PI / 2;
  const st = ballAngle, fin = st - (st % TAU) + TAU * rnd(6, 7) + target, d = fin - st, t0 = performance.now();
  let lastIdx = -1;
  (function f(now) {
    const t = Math.min(1, (now - t0) / 3800);
    ballAngle = st + d * (1 - Math.pow(1 - t, 3)); ball = ballAngle; drawRR();
    const idx = Math.floor(((((ballAngle + Math.PI / 2) % TAU) + TAU) % TAU) / sl);   // slot under the ball
    if (idx !== lastIdx) { lastIdx = idx; sound.tick(); }
    if (t < 1) return requestAnimationFrame(f);
    ballAngle %= TAU; ball = ballAngle; drawRR(); resolve(COLORS[w]);
  })(t0);
};

/* Rules:
   bet red   -> safe on red or green      bet black -> safe on black or green
   bet green -> safe only on green (and wins a PRIZE + picks the next player's color)
   landing on green (any bet) -> that player sits out the next 2 games */
function resolve(landed) {
  const p = players[turn], last = turn === players.length - 1;
  const safe = bet === 'green' ? landed === 'green' : (landed === bet || landed === 'green');
  const prize = bet === 'green' && landed === 'green';
  p.green = landed === 'green';
  p.status = !safe ? 'out' : prize ? 'prize' : 'safe';
  $('go').disabled = false; show('go', false); render();

  sound.land();                                                       // ball drops into the slot...
  setTimeout(() => (prize ? sound.prize() : safe ? sound.win() : sound.lose()), 350);   // ...then the result sound

  let m = 'It landed on ' + cs(landed) + '. ';
  if (!safe) m += 'Player ' + (turn + 1) + ' is out.';
  else if (prize) m += 'PRIZE! Player ' + (turn + 1) + ' is safe.' + (last ? '' : " Pick the next player's color.");
  else m += 'Player ' + (turn + 1) + ' is safe.' + (p.green ? ' (Green by luck)' : '');
  if (p.green) m += ' Sits out 2 rounds.';
  $('msg2').innerHTML = m;
  if (prize && !last) show('colorRow', true); else show('nextTurn', true);
}

$('nextTurn').onclick = () => { turn++; turn < players.length ? beginTurn() : finish(); };

function finish() {
  show('nextTurn', false);
  $('turnTitle').textContent = 'Game over'; $('msg2').textContent = '';
  show('endBox', true); render();
  $('summary').innerHTML = players.map((p, i) =>
    'Player ' + (i + 1) + ' (#' + p.num + '): ' + LABEL[p.status] + (p.green ? ' · sits out 2 rounds' : '')).join('<br>');
}

$('newGame').onclick = () => {
  Object.keys(banned).forEach(k => { if (--banned[k] <= 0) delete banned[k]; });   // one round has passed
  players.forEach(p => { if (p.green) banned[p.num] = 2; });                        // green landers sit out 2 rounds
  chosen = []; nSpins = 0; resetPicks(); banText(); ball = null; drawRR();
  $('msg1').textContent = 'Spin 1 of 3'; $('spin').textContent = 'SPIN';
  show('phase2', false); show('phase1', true);
};