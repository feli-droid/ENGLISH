/* =========================================================
   Casino Night — game logic
   Sections: Firebase, data (categories/questions), settings,
   screens, player-selection slot machine, roulette wheel,
   betting + question flow.
   ========================================================= */

/* ---------- small helpers ---------- */
const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const show = (id, on) => $(id).classList.toggle('hidden', !on);
const screen = id => { ['startScreen','settingsScreen','selectScreen','rouletteScreen','historyScreen'].forEach(s => show(s, s === id)); };

/* ---------- Firebase Realtime Database (REST, no SDK needed) ---------- */
const FIREBASE_URL = 'https://proyecto-ia-55108-default-rtdb.firebaseio.com';
async function fbGet(path) {
  try { const r = await fetch(FIREBASE_URL + path + '.json'); return await r.json(); }
  catch (e) { console.warn('Firebase GET failed', e); return null; }
}
async function fbPatch(path, data) {
  try { await fetch(FIREBASE_URL + path + '.json', { method: 'PATCH', body: JSON.stringify(data) }); }
  catch (e) { console.warn('Firebase PATCH failed', e); }
}
const blankRecord = () => ({ wins: 0, losses: 0, winsOdd: 0, winsEven: 0, winsRed: 0, winsBlack: 0, winsGreen: 0, questionsCorrect: 0, questionsAnswered: 0, happyFaces: 0 });

// Firebase RTDB keys can't contain . # $ [ ] / — turn a student's name into a safe key.
function slug(name) { return (name || '').trim().replace(/[.#$[\]/]/g, '_') || 'unnamed'; }

// Reads a user's record, applies a patch function to it, and saves it back.
async function updateUserHistory(name, mutate) {
  const key = slug(name);
  const current = (await fbGet('/users/' + key)) || blankRecord();
  const rec = Object.assign(blankRecord(), current);
  mutate(rec);
  await fbPatch('/users/' + key, rec);
  return rec;
}

/* ---------- Question bank (SAMPLE — more can be added later) ----------
   Each category has easy / medium / hard arrays. Every question is a
   short multiple-choice / "is this correct" style item. */
const QUESTIONS = {
  "Should, could, would": {
    easy: [
      { q: 'Which word correctly completes: "You ___ see a doctor if you feel sick."', options: ['should', 'would', 'must not'], correct: 0 },
      { q: 'Is this sentence correct: "She could to swim when she was five"?', options: ['Yes, leave it as is', 'No, remove "to"', 'No, change "could" to "should"'], correct: 1 }
    ],
    medium: [
      { q: 'Which option best completes: "If I had more time, I ___ travel more."', options: ['would', 'should', 'must'], correct: 0 },
      { q: 'Select the correct form: "You ___ have called me earlier." (regret about the past)', options: ['should', 'would', 'can'], correct: 0 }
    ],
    hard: [
      { q: 'Choose the best option: "___ you mind closing the window?" (polite request)', options: ['Would', 'Should', 'Must'], correct: 0 },
      { q: 'Which is correct: "I would rather you ___ late than not at all."', options: ['came', 'come', 'coming'], correct: 0 }
    ]
  },
  "Passive voice": {
    easy: [
      { q: 'Turn into passive: "They clean the office every day."', options: ['The office is cleaned every day.', 'The office cleans every day.', 'The office was clean every day.'], correct: 0 },
      { q: 'Is this passive sentence correct: "The cake was eaten by the children"?', options: ['Yes, leave it as is', 'No, should be "is eaten"', 'No, should be "eaten was"'], correct: 0 }
    ],
    medium: [
      { q: 'Choose the correct passive form: "The report ___ by Monday."', options: ['will finish', 'will be finished', 'will finished'], correct: 1 },
      { q: 'Select the best passive version of "Someone has stolen my bike."', options: ['My bike has been stolen.', 'My bike has stolen.', 'My bike was being stolen.'], correct: 0 }
    ],
    hard: [
      { q: 'Which is the correct passive of "They were repairing the road"?', options: ['The road was being repaired.', 'The road is being repaired.', 'The road has being repaired.'], correct: 0 },
      { q: 'Choose the correct form: "It ___ that the project will succeed."', options: ['is believed', 'is believing', 'believes'], correct: 0 }
    ]
  },
  "Present perfect": {
    easy: [
      { q: 'Which is correct: "I ___ never been to Paris."', options: ['have', 'has', 'had'], correct: 0 },
      { q: 'Is this correct: "She has went to the store"?', options: ['Yes, leave it as is', 'No, change to "has gone"', 'No, change to "have went"'], correct: 1 }
    ],
    medium: [
      { q: 'Choose the best option: "They ___ lived here since 2015."', options: ['have', 'has', 'are'], correct: 0 },
      { q: 'Select the correct sentence.', options: ['He has just finished his homework.', 'He has just finish his homework.', 'He have just finished his homework.'], correct: 0 }
    ],
    hard: [
      { q: 'Choose the correct form: "By the time you arrive, I ___ already left."', options: ['will have', 'have', 'had'], correct: 0 },
      { q: 'Which sentence uses the present perfect correctly?', options: ['I have seen that movie three times.', 'I have see that movie three times.', 'I has seen that movie three times.'], correct: 0 }
    ]
  },
  "Used to": {
    easy: [
      { q: 'Which is correct: "I ___ play soccer every weekend when I was a kid."', options: ['used to', 'use to', 'was used'], correct: 0 },
      { q: 'Is this correct: "She didn\u2019t used to like coffee"?', options: ['Yes, leave it as is', 'No, change to "didn\u2019t use to"', 'No, change to "doesn\u2019t used to"'], correct: 1 }
    ],
    medium: [
      { q: 'Choose the correct question form.', options: ['Did you use to live in Bogotá?', 'Did you used to live in Bogotá?', 'Were you used to live in Bogotá?'], correct: 0 },
      { q: 'Select the sentence that means "I am accustomed to working at night."', options: ['I am used to working at night.', 'I used to work at night.', 'I use to working at night.'], correct: 0 }
    ],
    hard: [
      { q: 'Which sentence contrasts past habit with the present correctly?', options: ['I used to hate vegetables, but now I love them.', 'I use to hate vegetables, but now I loved them.', 'I am used to hate vegetables, but now I love them.'], correct: 0 },
      { q: 'Choose the correct form: "It took time, but I ___ to the new schedule."', options: ['got used', 'used', 'use'], correct: 0 }
    ]
  }
};
const ALL_CATEGORIES = Object.keys(QUESTIONS);

/* ---------- Default roster (editable in Settings) ---------- */
const DEFAULT_NAMES = ['Sneyder','Esteban','Sofía','Santiago','Leonel','Jose Angel','Frayden','Gouveia',
  'Raymond','Marlon','Julián','Sebastian','Camilo','Yeison','Deyvid','Camila','Mauricio','Nicole',
  'Dilan','Stephanie','Karen','Anaya','Yojhan','Felis'];

/* ---------- Settings state (defaults) ---------- */
const settings = {
  playerCount: 3,
  names: DEFAULT_NAMES.slice(),
  askQuestions: true,
  odds: { easy: 45, medium: 40, hard: 15 },
  enabledCategories: new Set(ALL_CATEGORIES)
};

/* ---------- Settings screen wiring ---------- */
function buildCategoryList() {
  $('catList').innerHTML = ALL_CATEGORIES.map(cat =>
    '<label><input type="checkbox" class="catChk" value="' + cat + '" checked> ' + cat + '</label>').join('');
}
buildCategoryList();

/* number-of-players: a clickable 1-10 grid instead of typing a number */
function buildCountGrid() {
  const box = $('countGrid');
  box.innerHTML = '';
  for (let n = 1; n <= 10; n++) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'count-btn' + (n === settings.playerCount ? ' selected' : '');
    b.textContent = n; b.dataset.n = n;
    b.onclick = () => {
      settings.playerCount = n;
      [...box.children].forEach(x => x.classList.toggle('selected', x === b));
      checkNames();
    };
    box.appendChild(b);
  }
}
buildCountGrid();
$('namesBox').value = settings.names.join('\n');

function checkNames() {
  const names = $('namesBox').value.split('\n').map(s => s.trim()).filter(Boolean);
  const ok = names.length >= settings.playerCount;
  $('namesHint').textContent = ok ? '' : 'Add at least ' + settings.playerCount + ' names (currently ' + names.length + ').';
  return ok;
}
$('namesBox').addEventListener('input', checkNames);

function checkOdds() {
  const e = +$('pEasy').value, m = +$('pMedium').value, h = +$('pHard').value, total = e + m + h;
  $('oddsHint').textContent = total === 100 ? '' : 'These three numbers should add up to 100 (currently ' + total + ').';
  return total === 100;
}
['pEasy', 'pMedium', 'pHard'].forEach(id => $(id).addEventListener('input', checkOdds));

$('gearBtn').onclick = () => { buildCountGrid(); $('namesBox').value = settings.names.join('\n'); checkNames(); screen('settingsScreen'); };
$('backFromSettings').onclick = () => screen('startScreen');
$('saveSettings').onclick = () => {
  if (!checkOdds() || !checkNames()) return;
  settings.askQuestions = $('askQuestions').checked;
  settings.odds = { easy: +$('pEasy').value, medium: +$('pMedium').value, hard: +$('pHard').value };
  settings.enabledCategories = new Set([...document.querySelectorAll('.catChk:checked')].map(c => c.value));
  if (settings.enabledCategories.size === 0) settings.enabledCategories = new Set(ALL_CATEGORIES);
  settings.names = $('namesBox').value.split('\n').map(s => s.trim()).filter(Boolean);
  screen('startScreen');
};

$('startBtn').onclick = () => { buildReels(); screen('selectScreen'); };

/* ---------- classification table (reads every roster name's record from Firebase) ---------- */
$('historyBtn').onclick = async () => {
  screen('historyScreen');
  $('historyMsg').textContent = 'Loading...';
  $('historyBody').innerHTML = '';
  const rows = await Promise.all(settings.names.map(async name => {
    const rec = Object.assign(blankRecord(), (await fbGet('/users/' + slug(name))) || {});
    return { name, rec };
  }));
  const topWins = Math.max(0, ...rows.map(r => r.rec.wins));
  $('historyBody').innerHTML = rows.map(({ name, rec }) =>
    '<tr' + (rec.wins > 0 && rec.wins === topWins ? ' class="top-player"' : '') + '><td>' + name + '</td><td>' +
    (rec.happyFaces > 0 ? '😄×' + rec.happyFaces : '—') + '</td><td>' + rec.wins + '</td><td>' + rec.losses + '</td><td>' +
    rec.winsOdd + '</td><td>' + rec.winsEven + '</td><td>' + rec.winsRed + '</td><td>' + rec.winsBlack + '</td><td>' +
    rec.winsGreen + '</td><td>' + rec.questionsCorrect + '</td><td>' + rec.questionsAnswered + '</td></tr>').join('');
  $('historyMsg').textContent = '';
};
$('backFromHistory').onclick = () => screen('startScreen');

/* =========================================================
   PLAYER SELECTION — slot-machine reels, one per player,
   each one locks on a unique number from 1 to 23.
   ========================================================= */
let chosenPlayers = [];
const ITEM_H = 90;        // must match .reel-item height in style.css
const STRIP_LEN = 24;     // how many numbers scroll past before landing

function buildReels() {
  chosenPlayers = [];
  const box = $('reels');
  box.innerHTML = '';
  for (let i = 0; i < settings.playerCount; i++) {
    const reel = document.createElement('div');
    reel.className = 'reel';
    const strip = document.createElement('div');
    strip.className = 'reel-strip';
    strip.style.transform = 'translateY(0)';
    const first = document.createElement('div');
    first.className = 'reel-item'; first.textContent = '?';
    strip.appendChild(first);
    reel.appendChild(strip);
    box.appendChild(reel);
  }
  $('selectMsg').textContent = 'Press SPIN to pick the players';
  $('spinReels').disabled = false; $('spinReels').textContent = 'SPIN';
}

$('spinReels').onclick = () => {
  if (chosenPlayers.length >= settings.playerCount) return startRoulettePhase();
  if (settings.names.length < settings.playerCount) {
    $('selectMsg').textContent = 'Not enough names in Settings for ' + settings.playerCount + ' players.';
    return;
  }
  $('spinReels').disabled = true;
  $('selectMsg').textContent = 'Spinning...';

  // Decide every reel's final (unique) name up front, then animate them all at once.
  const pool = settings.names;
  const finals = [];
  while (finals.length < settings.playerCount) {
    const n = pool[rnd(0, pool.length - 1)];
    if (!finals.includes(n)) finals.push(n);
  }

  const strips = [...document.querySelectorAll('.reel-strip')];
  const waits = strips.map((strip, i) => new Promise(resolveOne => {
    // Build a strip of random names, ending on this reel's final name.
    strip.innerHTML = '';
    for (let k = 0; k < STRIP_LEN - 1; k++) {
      const d = document.createElement('div');
      d.className = 'reel-item'; d.textContent = pool[rnd(0, pool.length - 1)];
      strip.appendChild(d);
    }
    const last = document.createElement('div');
    last.className = 'reel-item'; last.textContent = finals[i];
    strip.appendChild(last);

    strip.style.transition = 'none';
    strip.style.transform = 'translateY(0)';
    void strip.offsetHeight;                         // force reflow so the reset above is applied first
    const duration = 2.4 + i * 0.18 + Math.random() * 0.3;   // slight stagger so they don't all freeze in sync
    strip.style.transition = 'transform ' + duration + 's cubic-bezier(.1,.75,.25,1)';
    strip.style.transform = 'translateY(-' + ((STRIP_LEN - 1) * ITEM_H) + 'px)';
    strip.addEventListener('transitionend', function done() {
      strip.removeEventListener('transitionend', done);
      resolveOne();
    }, { once: true });
  }));

  Promise.all(waits).then(() => {
    chosenPlayers = finals;
    $('selectMsg').textContent = 'Players ready: ' + chosenPlayers.join(', ');
    $('spinReels').textContent = 'CONTINUE'; $('spinReels').disabled = false;
  });
};

/* =========================================================
   ROULETTE PHASE
   ========================================================= */
const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function colorOf(n) { if (n === 0) return 'green'; return RED_NUMBERS.has(n) ? 'red' : 'black'; }
const HEX = { red: '#c62828', black: '#151515', green: '#22b45a' };

let players = [], turn = 0, phase = 'bet', ball = null, ballAngle = 0;
const S = 380, cv = $('wheel'), cx = cv.getContext('2d');

function drawWheel() {
  const N = 37, sl = TAU / N, R = S / 2 - 6;
  cx.clearRect(0, 0, S, S);
  for (let i = 0; i < N; i++) {
    cx.beginPath(); cx.moveTo(S/2, S/2); cx.arc(S/2, S/2, R, i * sl - Math.PI/2, (i + 1) * sl - Math.PI/2); cx.closePath();
    cx.fillStyle = HEX[colorOf(i)]; cx.fill(); cx.strokeStyle = '#e2b93b'; cx.lineWidth = 1.2; cx.stroke();
    cx.save(); cx.translate(S/2, S/2); cx.rotate(i * sl - Math.PI/2 + sl/2); cx.translate(R * .82, 0); cx.rotate(Math.PI/2);
    cx.fillStyle = '#fff3b0'; cx.font = '600 11px Oswald, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(i, 0, 0); cx.restore();
  }
  cx.beginPath(); cx.arc(S/2, S/2, 24, 0, TAU); cx.fillStyle = '#e2b93b'; cx.fill();           // hub
  if (ball !== null) {
    const r = ball.r, x = S/2 + Math.cos(ball.a) * r, y = S/2 + Math.sin(ball.a) * r;
    cx.beginPath(); cx.arc(x + 2, y + 2, 8, 0, TAU); cx.fillStyle = 'rgba(0,0,0,.5)'; cx.fill();
    cx.beginPath(); cx.arc(x, y, 7, 0, TAU); cx.fillStyle = '#fff'; cx.fill();
  }
}
drawWheel();

let pendingList = [], qIndex = 0;

function startRoulettePhase() {
  players = chosenPlayers.map(name => ({ name, colorBet: null, parityBet: null, status: '', landedColor: null, landedParity: null, happyGain: 0 }));
  turn = 0; phase = 'spin'; screen('rouletteScreen'); beginSpinTurn();
}

function renderSeats() {
  const ended = !$('endBox').classList.contains('hidden');
  $('status').innerHTML = players.map((p, i) =>
    '<div class="seat ' + p.status + (i === turn && !ended ? ' current' : '') + '"><b>' + p.name + '</b>' +
    '<br><span>' + ({safe:'SAFE', out:'OUT', pending:'?'}[p.status] || '&nbsp;') + '</span></div>').join('');
}
function colorSpan(c) { return '<span class="' + (c === 'red' ? 'r' : c === 'black' ? 'b' : 'g') + '">' + c.toUpperCase() + '</span>'; }

/* ---- for every player, in turn: place a bet, then spin right away ---- */
function beginSpinTurn() {
  renderSeats();
  const p = players[turn];
  ball = null; drawWheel();
  $('turnTitle').textContent = p.name + "'s turn";
  ['spinWheel','slotStage','questionBox','nextTurn','endBox'].forEach(id => show(id, false));
  show('wheelbox', true); show('betRow', true); show('fireFx', false);
  $('spinWheel').disabled = false;
  document.querySelectorAll('.bet-color,.parity').forEach(b => { b.disabled = false; b.classList.remove('selected'); });
  $('bettingMsg').textContent = 'Pick a color and odd or even, then spin';
}

document.querySelectorAll('.bet-color').forEach(b => b.onclick = () => {
  players[turn].colorBet = b.dataset.c;
  document.querySelectorAll('.bet-color').forEach(x => x.classList.toggle('selected', x === b));
  maybeEnableSpin();
});
document.querySelectorAll('.parity').forEach(b => b.onclick = () => {
  players[turn].parityBet = b.dataset.p;
  document.querySelectorAll('.parity').forEach(x => x.classList.toggle('selected', x === b));
  maybeEnableSpin();
});
function maybeEnableSpin() {
  const p = players[turn];
  if (p.colorBet && p.parityBet) { show('spinWheel', true); $('bettingMsg').textContent = 'Bet locked in. Spin!'; }
}

$('spinWheel').onclick = () => {
  $('spinWheel').disabled = true;
  document.querySelectorAll('.bet-color,.parity').forEach(b => b.disabled = true);
  $('bettingMsg').textContent = 'Spinning...';
  const winner = rnd(0, 36), N = 37, sl = TAU / N, target = winner * sl + sl/2 - Math.PI/2;
  const outerR = S/2 + 4, innerR = S/2 - 40;
  const st = ballAngle, fin = st - (st % TAU) + TAU * rnd(6,7) + target, d = fin - st, t0 = performance.now(), dur = 3800;
  (function f(now) {
    const t = Math.min(1, (now - t0) / dur);
    ballAngle = st + d * (1 - Math.pow(1 - t, 3));
    const r = outerR - (outerR - innerR) * Math.pow(t, 1.6);   // spins out on the purple ring, then drifts inward
    ball = { a: ballAngle, r };
    drawWheel();
    if (t < 1) return requestAnimationFrame(f);
    ballAngle %= TAU; resolveSpin(winner);
  })(t0);
};

function resolveSpin(winner) {
  const p = players[turn];
  const c = colorOf(winner), parity = winner === 0 ? null : (winner % 2 ? 'odd' : 'even');
  p.landedColor = c; p.landedParity = parity; p.happyGain = 0;

  // Special case: 0 / green has no odd-or-even, so parity never applies when it comes up.
  if (c === 'green') {
    if (p.colorBet === 'green') {
      p.happyGain = 10;
      $('bettingMsg').innerHTML = 'The ball landed on <b>0</b> (' + colorSpan('green') + ')! You called it — automatic win. 😄×10';
      finalize(true, false);
    } else {
      p.happyGain = 5;
      $('bettingMsg').innerHTML = 'The ball landed on <b>0</b> (' + colorSpan('green') + '). Your odd/even bet doesn\u2019t apply here, ' +
        'and your color bet missed — but landing on green earns a bonus. 😄×5';
      finalize(false, false);
    }
    return;
  }

  const hits = (p.colorBet === c ? 1 : 0) + (p.parityBet === parity ? 1 : 0);
  $('bettingMsg').innerHTML = 'The ball landed on <b>' + winner + '</b> (' + colorSpan(c) + ', ' +
    parity + '). You guessed ' + hits + ' of 2 correctly.';

  if (hits === 2) {
    finalize(true, false);
  } else if (!settings.askQuestions) {
    finalize(false, false);
  } else {
    p.status = 'pending';   // 0 or 1 correct guess -> answers a question later, once everyone has spun
    p.hitCount = hits;      // used to pick how hard that question will be
    renderSeats();
    show('spinWheel', false);
    show('nextTurn', true);
    setNextLabel();
  }
}

/* ---- label the NEXT TURN button with who (or what) comes next ---- */
function setNextLabel() {
  const btn = $('nextTurn');
  if (phase === 'spin') {
    btn.textContent = (turn + 1 < players.length) ? "CONTINUE: " + players[turn + 1].name : "LET'S CONTINUE WITH THE QUESTIONS";
  } else {
    btn.textContent = (qIndex + 1 < pendingList.length) ? "CONTINUE: " + players[pendingList[qIndex + 1]].name : 'SEE RESULTS';
  }
}

/* ---------- after every player has bet & spun, go through pending players' questions ---------- */
function startQuestionPhase() {
  pendingList = players.map((p, i) => i).filter(i => players[i].status === 'pending');
  if (pendingList.length === 0) return finishGame();
  phase = 'question'; qIndex = 0; beginQuestionTurn();
}
function beginQuestionTurn() {
  turn = pendingList[qIndex];
  renderSeats();
  const p = players[turn];
  $('turnTitle').textContent = p.name + ": answer to be safe";
  ['betRow','spinWheel','questionBox','nextTurn','endBox'].forEach(id => show(id, false));
  show('wheelbox', false);
  $('bettingMsg').textContent = (p.hitCount === 1 ? 'One correct guess! ' : 'No correct guesses — tougher odds. ') + "Let\u2019s see what question comes up...";
  show('slotStage', true); show('fireFx', false);
  runDifficultyThenCategory();
}

/* ---------- difficulty + category slot machine ----------
   One correct guess  -> uses the odds configured in Settings (easy/medium favored by default).
   Zero correct guesses -> harder: the easy/hard odds are swapped, so medium and hard become the likely outcomes. */
function weightedPick(weights) {
  const total = weights.easy + weights.medium + weights.hard;
  let r = Math.random() * total;
  if ((r -= weights.easy) < 0) return 'easy';
  if ((r -= weights.medium) < 0) return 'medium';
  return 'hard';
}
function runDifficultyThenCategory() {
  const p = players[turn];
  const o = settings.odds;
  const weights = p.hitCount === 0 ? { easy: o.hard, medium: o.medium, hard: o.easy } : o;
  const diffReel = $('difficultyReel');
  let ticks = 0;
  const diffPool = ['easy', 'medium', 'hard'];
  const iv = setInterval(() => {
    diffReel.textContent = diffPool[rnd(0, 2)].toUpperCase();
    ticks++;
    if (ticks > 16) {
      clearInterval(iv);
      const finalDiff = weightedPick(weights);
      diffReel.textContent = finalDiff.toUpperCase();
      show('fireFx', finalDiff === 'hard');
      spinCategory(finalDiff);
    }
  }, 70);
}
function spinCategory(difficulty) {
  const catReel = $('categoryReel');
  const pool = [...settings.enabledCategories];
  let ticks = 0;
  const iv = setInterval(() => {
    catReel.textContent = pool[rnd(0, pool.length - 1)];
    ticks++;
    if (ticks > 16) {
      clearInterval(iv);
      const finalCat = pool[rnd(0, pool.length - 1)];
      catReel.textContent = finalCat;
      setTimeout(() => askQuestion(finalCat, difficulty), 500);
    }
  }, 70);
}

/* ---------- question card ---------- */
function askQuestion(category, difficulty) {
  show('slotStage', false);
  const pool = (QUESTIONS[category] && QUESTIONS[category][difficulty]) || [];
  if (pool.length === 0) { finalize(true, true); return; }   // no question available -> treat as safe
  const q = pool[rnd(0, pool.length - 1)];
  show('questionBox', true);
  $('qCatLabel').textContent = category + ' — ' + difficulty.toUpperCase();
  $('qText').textContent = q.q;
  const box = $('qOptions'); box.innerHTML = '';
  q.options.forEach((opt, idx) => {
    const btn = document.createElement('button');
    btn.textContent = opt;
    btn.onclick = () => {
      [...box.children].forEach(b => b.disabled = true);
      const ok = idx === q.correct;
      btn.classList.add(ok ? 'correct' : 'wrong');
      if (!ok) box.children[q.correct].classList.add('correct');
      setTimeout(() => { show('questionBox', false); finalize(ok, true); }, 900);
    };
    box.appendChild(btn);
  });
}

/* ---------- finalize the current player: update seat + Firebase history ---------- */
function finalize(safe, answeredQuestion) {
  const p = players[turn];
  p.status = safe ? 'safe' : 'out';
  renderSeats();

  updateUserHistory(p.name, rec => {
    if (safe) rec.wins++; else rec.losses++;
    if (p.landedParity === 'odd') rec.winsOdd += safe ? 1 : 0;
    if (p.landedParity === 'even') rec.winsEven += safe ? 1 : 0;
    if (p.landedColor === 'red') rec.winsRed += safe ? 1 : 0;
    if (p.landedColor === 'black') rec.winsBlack += safe ? 1 : 0;
    if (p.landedColor === 'green') rec.winsGreen += safe ? 1 : 0;
    if (p.happyGain) rec.happyFaces += p.happyGain;
    if (answeredQuestion) { rec.questionsAnswered++; if (safe) rec.questionsCorrect++; }
  });

  show('spinWheel', false);
  show('nextTurn', true);
  setNextLabel();
}

$('nextTurn').onclick = () => {
  if (phase === 'spin') {
    turn++;
    if (turn < players.length) beginSpinTurn(); else startQuestionPhase();
  } else {
    qIndex++;
    if (qIndex < pendingList.length) beginQuestionTurn(); else finishGame();
  }
};

function finishGame() {
  show('nextTurn', false);
  show('wheelbox', false);
  $('turnTitle').textContent = 'Round summary';
  $('bettingMsg').textContent = '';
  $('summary').innerHTML = players.map(p =>
    p.name + ': ' + ({safe:'SAFE', out:'OUT'}[p.status]) + (p.happyGain ? ' 😄×' + p.happyGain : '')).join('<br>');
  show('endBox', true); renderSeats();
}
$('toSelect').onclick = () => { buildReels(); screen('selectScreen'); };
$('toStart').onclick = () => screen('startScreen');
