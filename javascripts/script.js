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
const screen = id => { ['startScreen','gameSelectScreen','settingsScreen','selectScreen','rouletteScreen','historyScreen'].forEach(s => show(s, s === id)); };
let gameMode = 'roulette';   // 'roulette' | 'blackjack' | 'balloon' — chosen on the game-select screen (or fixed in Settings)
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- sound effects (Web Audio API — no sound files needed) ---------- */
let audioCtx = null, soundOn = true, lastTick = 0;
function ac() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); return audioCtx; }
function tone(freq, delay, dur, type = 'square', vol = 0.15) {
  if (!soundOn) return;
  const c = ac(), t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur);
}
const sound = {
  tick() { const now = performance.now(); if (now - lastTick < 35) return; lastTick = now; tone(1500, 0, 0.03, 'square', 0.04); },
  spinStart() { tone(180, 0, 0.25, 'sawtooth', 0.06); tone(320, 0.08, 0.25, 'sawtooth', 0.05); },
  land() { tone(140, 0, 0.25, 'sine', 0.3); tone(90, 0.03, 0.3, 'sine', 0.25); },
  select() { tone(700, 0, 0.08, 'square', 0.1); },
  reveal() { tone(660, 0, 0.12, 'triangle', 0.14); tone(990, 0.08, 0.16, 'triangle', 0.12); },
  fire() { tone(120, 0, 0.3, 'sawtooth', 0.12); tone(90, 0.1, 0.3, 'sawtooth', 0.1); },
  correct() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.22, 'triangle', 0.16)); },
  wrong() { [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.18, 0.32, 'sawtooth', 0.1)); },
  prize() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.1, 0.26, 'square', 0.09)); },
  safe() { tone(880, 0, 0.3, 'triangle', 0.16); tone(1175, 0.1, 0.35, 'triangle', 0.12); },
  out() { tone(220, 0, 0.4, 'sawtooth', 0.14); },
  pump(n) { tone(300 + n * 28, 0, 0.09, 'triangle', 0.12); tone(220 + n * 20, 0.05, 0.08, 'sine', 0.08); },
  pop() { tone(900, 0, 0.05, 'square', 0.25); tone(120, 0.02, 0.35, 'sawtooth', 0.22); tone(70, 0.05, 0.4, 'sine', 0.3); },
  timerTick(urgent) { tone(urgent ? 1046 : 784, 0, 0.08, 'square', urgent ? 0.14 : 0.08); },
  timeout() { tone(140, 0, 0.5, 'sawtooth', 0.2); }
};
$('soundBtn').onclick = () => {
  soundOn = !soundOn;
  $('soundBtn').textContent = (soundOn ? '🔊 SOUND: ON' : '🔇 SOUND: OFF');
  $('soundBtn').setAttribute('aria-pressed', soundOn);
  if (soundOn) sound.select();
};

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
const blankRecord = () => ({ wins: 0, losses: 0, winsOdd: 0, winsEven: 0, winsRed: 0, winsBlack: 0, winsGreen: 0, questionsCorrect: 0, questionsAnswered: 0, happyFaces: 0,
  roulettePlayed: 0, blackjackPlayed: 0,
  bets: { red:{w:0,l:0}, black:{w:0,l:0}, green:{w:0,l:0}, odd:{w:0,l:0}, even:{w:0,l:0} },
  bj: { w: 0, l: 0, p: 0, t21: 0 },
  balloonPlayed: 0, bl: { w: 0, l: 0 } });
// merge a (possibly old / partial) Firebase record onto the defaults, including the nested parts
function normRecord(raw) {
  const base = blankRecord(), r = Object.assign(base, raw || {});
  r.bets = Object.assign(blankRecord().bets, (raw && raw.bets) || {});
  Object.keys(r.bets).forEach(k => r.bets[k] = Object.assign({ w: 0, l: 0 }, r.bets[k]));
  r.bj = Object.assign({ w: 0, l: 0, p: 0, t21: 0 }, (raw && raw.bj) || {});
  r.bl = Object.assign({ w: 0, l: 0 }, (raw && raw.bl) || {});
  return r;
}

// Firebase RTDB keys can't contain . # $ [ ] / — turn a student's name into a safe key.
function slug(name) { return (name || '').trim().replace(/[.#$[\]/]/g, '_') || 'unnamed'; }

// Reads a user's record, applies a patch function to it, and saves it back.
async function updateUserHistory(name, mutate) {
  const key = slug(name);
  const current = (await fbGet('/users/' + key)) || blankRecord();
  const rec = normRecord(current);
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
  },
  "Gerunds": {
    easy: [
      { q: 'Which is correct: "I love ___ user interfaces."', options: ['designing', 'design', 'to designing'], correct: 0 },
      { q: 'Complete the sentence: "She enjoys ___ with Python."', options: ['working', 'work', 'worked'], correct: 0 },
      { q: 'What is the gerund of "write"?', options: ['writing', 'writeing', 'writting'], correct: 0 }
    ],
    medium: [
      { q: 'Which sentence is correct?', options: ['He hates writing documentation.', 'He hates write documentation.', 'He hates to writing documentation.'], correct: 0 },
      { q: 'What is the gerund of "run"?', options: ['running', 'runing', 'runeing'], correct: 0 },
      { q: 'Which sentence shows a NEUTRAL feeling?', options: ["I don't mind testing the code.", "I can't stand testing the code.", 'I love testing the code.'], correct: 0 }
    ],
    hard: [
      { q: 'Find the error: "They don\u2019t mind to work late on release days."', options: ['"to work" should be "working"', '"don\u2019t mind" should be "hate"', '"late" should be "lately"'], correct: 0 },
      { q: 'What is the correct gerund of "program"?', options: ['programming', 'programing', 'programeing'], correct: 0 },
      { q: 'Which sentence is correct?', options: ["We can't stand using slow internet.", "We can't stand use slow internet.", "We can't stand to using slow internet."], correct: 0 }
    ]
  }
};

/* Gerunds also has timed, open-answer tasks (15 s, then the group judges the answer) */
const GERUND_TASKS = {
  negative: [
    { prompt: 'Make it NEGATIVE:\n"I enjoy designing user interfaces."', answer: "I don't enjoy designing user interfaces." },
    { prompt: 'Make it NEGATIVE:\n"She likes working with Python."', answer: "She doesn't like working with Python." },
    { prompt: 'Make it NEGATIVE:\n"We love fixing legacy code."', answer: "We don't love fixing legacy code." },
    { prompt: 'Make it NEGATIVE:\n"He enjoys writing documentation."', answer: "He doesn't enjoy writing documentation." },
    { prompt: 'Make it NEGATIVE:\n"They prefer testing the code."', answer: "They don't prefer testing the code." },
    { prompt: 'Make it NEGATIVE:\n"I like attending daily meetings."', answer: "I don't like attending daily meetings." }
  ],
  question: [
    { prompt: 'Turn it into a QUESTION:\n"You enjoy writing documentation."', answer: 'Do you enjoy writing documentation?' },
    { prompt: 'Turn it into a QUESTION:\n"She likes working with Python."', answer: 'Does she like working with Python?' },
    { prompt: 'Turn it into a QUESTION:\n"They hate attending long meetings."', answer: 'Do they hate attending long meetings?' },
    { prompt: 'Turn it into a QUESTION:\n"He prefers coding over writing reports."', answer: 'Does he prefer coding over writing reports?' },
    { prompt: 'Turn it into a QUESTION:\n"You like fixing other people\u2019s code."', answer: 'Do you like fixing other people\u2019s code?' }
  ],
  create: [
    { prompt: 'CREATE a question about an IT task, using a preference verb + gerund.', answer: 'Example: "Do you enjoy configuring networks?"' },
    { prompt: 'CREATE a question to ask a classmate which task they hate doing at work.', answer: 'Example: "Which IT task do you hate doing?"' },
    { prompt: 'CREATE a question about something a teammate doesn\u2019t mind doing.', answer: 'Example: "Do you mind working from home?"' }
  ]
};
const ALL_CATEGORIES = Object.keys(QUESTIONS);

/* ---------- Default roster (editable in Settings) ---------- */
const DEFAULT_NAMES = ['Sneyder','Sofía','Santiago','Leonel','Jose Angel','Frayden','Gouveia',
  'Raymond','Marlon','Julián','Sebastian','Camilo','Yeison','Deyvid','Camila','Mauricio','Nicole',
  'Dilan','Stephanie','Karen','Anaya','Yojhan','Mario'];

/* ---------- Settings state (defaults) ---------- */
const settings = {
  playerCount: 3,
  names: DEFAULT_NAMES.slice(),
  askQuestions: true,
  odds: { easy: 45, medium: 40, hard: 15 },
  enabledCategories: new Set(ALL_CATEGORIES),
  games: new Set(['roulette', 'blackjack', 'balloon'])
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

function checkGames() {
  const ok = $('gameRoulette').checked || $('gameBlackjack').checked || $('gameBalloon').checked;
  $('gamesHint').textContent = ok ? '' : 'Keep at least one game enabled.';
  return ok;
}
$('gameRoulette').addEventListener('change', checkGames);
$('gameBlackjack').addEventListener('change', checkGames);
$('gameBalloon').addEventListener('change', checkGames);

$('gearBtn').onclick = () => {
  buildCountGrid(); $('namesBox').value = settings.names.join('\n'); checkNames();
  $('gameRoulette').checked = settings.games.has('roulette');
  $('gameBlackjack').checked = settings.games.has('blackjack');
  $('gameBalloon').checked = settings.games.has('balloon');
  screen('settingsScreen');
};
$('backFromSettings').onclick = () => screen('startScreen');
$('saveSettings').onclick = () => {
  if (!checkOdds() || !checkNames() || !checkGames()) return;
  settings.askQuestions = $('askQuestions').checked;
  settings.odds = { easy: +$('pEasy').value, medium: +$('pMedium').value, hard: +$('pHard').value };
  settings.enabledCategories = new Set([...document.querySelectorAll('.catChk:checked')].map(c => c.value));
  if (settings.enabledCategories.size === 0) settings.enabledCategories = new Set(ALL_CATEGORIES);
  settings.names = $('namesBox').value.split('\n').map(s => s.trim()).filter(Boolean);
  const games = new Set();
  if ($('gameRoulette').checked) games.add('roulette');
  if ($('gameBlackjack').checked) games.add('blackjack');
  if ($('gameBalloon').checked) games.add('balloon');
  settings.games = games;
  screen('startScreen');
};

/* ---- START: go straight to the only enabled game, or let the host pick ---- */
$('startBtn').onclick = () => {
  if (settings.games.size > 1) { screen('gameSelectScreen'); return; }
  gameMode = [...settings.games][0] || 'roulette';
  buildReels(); screen('selectScreen');
};
$('pickRoulette').onclick = () => { gameMode = 'roulette'; buildReels(); screen('selectScreen'); };
$('pickBlackjack').onclick = () => { gameMode = 'blackjack'; buildReels(); screen('selectScreen'); };
$('pickBalloon').onclick = () => { gameMode = 'balloon'; buildReels(); screen('selectScreen'); };
$('backFromGameSelect').onclick = () => screen('startScreen');

/* ---------- classification table (reads every roster name's record from Firebase) ---------- */
$('historyBtn').onclick = async () => {
  screen('historyScreen');
  $('historyMsg').textContent = 'Loading...';
  $('historyBody').innerHTML = '';
  const rows = await Promise.all(settings.names.map(async name => {
    const rec = normRecord(await fbGet('/users/' + slug(name)));
    return { name, rec };
  }));
  const topWins = Math.max(0, ...rows.map(r => r.rec.wins));
  $('historyBody').innerHTML = rows.map(({ name, rec }, i) =>
    '<tr class="prow' + (rec.wins > 0 && rec.wins === topWins ? ' top-player' : '') + '"><td>' + name + '</td><td>' +
    (rec.happyFaces > 0 ? '😄×' + rec.happyFaces : '—') + '</td><td>' + rec.wins + '</td><td>' + rec.losses + '</td>' +
    '<td><button class="qbtn" data-i="' + i + '" aria-expanded="false" aria-label="Show results for ' + name + '">?</button></td><td>' +
    rec.questionsCorrect + '</td><td>' + rec.questionsAnswered + '</td></tr>' +
    '<tr class="detail hidden" id="detail' + i + '"><td colspan="7">' + resultDetailHTML(rec) + '</td></tr>').join('');
  $('historyMsg').textContent = '';
};
// what a player chose (roulette / blackjack) and what they won or lost in each
function resultDetailHTML(rec) {
  const chip = (label, w, l) => '<div class="rchip"><span>' + label + '</span><b class="ok">✅ ' + w + '</b><b class="no">❌ ' + l + '</b></div>';
  const B = rec.bets, hasR = rec.roulettePlayed > 0 || Object.values(B).some(x => x.w + x.l > 0);
  const hasB = rec.blackjackPlayed > 0 || rec.bj.w + rec.bj.l + rec.bj.p > 0;
  const roul = hasR
    ? '<div class="rgrid">' + chip('RED', B.red.w, B.red.l) + chip('BLACK', B.black.w, B.black.l) + chip('GREEN', B.green.w, B.green.l) +
      chip('ODD', B.odd.w, B.odd.l) + chip('EVEN', B.even.w, B.even.l) + '</div><div class="rnote">Played ' + rec.roulettePlayed + ' time(s)</div>'
    : '<div class="rnote">Never played</div>';
  const bj = hasB
    ? '<div class="rgrid">' + chip('HANDS', rec.bj.w, rec.bj.l) + '<div class="rchip"><span>PUSH</span><b>🤝 ' + rec.bj.p + '</b></div>' +
      '<div class="rchip"><span>21s</span><b>🃏 ' + rec.bj.t21 + '</b></div></div><div class="rnote">Played ' + rec.blackjackPlayed + ' time(s)</div>'
    : '<div class="rnote">Never played</div>';
  const hasBl = rec.balloonPlayed > 0 || rec.bl.w + rec.bl.l > 0;
  const bal = hasBl ? '<div class="rgrid">' + chip('ROUNDS', rec.bl.w, rec.bl.l) + '</div><div class="rnote">Won ✅ / Popped ❌ — played ' + rec.balloonPlayed + ' time(s)</div>' : '<div class="rnote">Never played</div>';
  return '<div class="rbox"><h4>🎈 BALLOON</h4>' + bal + '</div><div class="rbox"><h4>🎡 ROULETTE</h4>' + roul + '</div><div class="rbox"><h4>🃏 BLACKJACK</h4>' + bj + '</div>';
}
$('historyBody').onclick = e => {
  const btn = e.target.closest('.qbtn'); if (!btn) return;
  const row = $('detail' + btn.dataset.i), open = row.classList.contains('hidden');
  row.classList.toggle('hidden', !open);
  btn.setAttribute('aria-expanded', open); btn.textContent = open ? '×' : '?';
};
$('backFromHistory').onclick = () => screen('startScreen');

/* =========================================================
   PLAYER SELECTION — one big name reveal at a time (not a
   crowd of tiny reels), then the final lineup in a row.
   ========================================================= */
let chosenPlayers = [];

function buildReels() {
  chosenPlayers = [];
  show('bigReveal', true); show('lineup', false); show('pickCounter', true);
  $('bigReveal').textContent = '?';
  $('pickCounter').textContent = settings.playerCount + ' players';
  $('lineup').innerHTML = '';
  $('selectMsg').textContent = 'Press SPIN to pick the players';
  $('spinReels').disabled = false; $('spinReels').textContent = 'SPIN';
}

$('spinReels').onclick = async () => {
  if (chosenPlayers.length >= settings.playerCount) return startGamePhase();
  if (settings.names.length < settings.playerCount) {
    $('selectMsg').textContent = 'Not enough names in Settings for ' + settings.playerCount + ' players.';
    return;
  }
  $('spinReels').disabled = true;
  show('lineup', false); $('lineup').innerHTML = ''; show('bigReveal', true); show('pickCounter', true);
  const pool = settings.names, finals = [], total = settings.playerCount;

  for (let i = 0; i < total; i++) {
    $('selectMsg').textContent = 'Picking player ' + (i + 1) + ' of ' + total + '...';
    $('pickCounter').textContent = (i + 1) + ' / ' + total;
    let name;
    do { name = pool[rnd(0, pool.length - 1)]; } while (finals.includes(name));
    finals.push(name);

    const reveal = $('bigReveal');
    reveal.classList.remove('pop', 'locked');
    await spinSlotMachine(reveal, pool, name, 14);      // quick flicker, lands on this player's name
    sound.reveal();
    void reveal.offsetWidth; reveal.classList.add('pop', 'locked');   // the chosen name, HUGE
    await sleep(1700);                                   // let everyone read it
    reveal.classList.remove('pop', 'locked');
    reveal.textContent = '';
    await sleep(300);
  }

  // all picked: swap the big name for a tidy numbered lineup
  chosenPlayers = finals;
  show('bigReveal', false); show('pickCounter', false);
  $('lineup').innerHTML = finals.map((n, i) =>
    '<div class="tag" style="animation-delay:' + (i * 110) + 'ms"><i>' + (i + 1) + '</i><span>' + n.replace(/</g, '&lt;') + '</span></div>').join('');
  show('lineup', true);
  sound.select && sound.select();
  $('selectMsg').textContent = 'Players ready!';
  $('spinReels').textContent = 'CONTINUE'; $('spinReels').disabled = false;
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

function startGamePhase() {
  players = chosenPlayers.map(name => ({ name, colorBet: null, parityBet: null, status: '', landedColor: null, landedParity: null, happyGain: 0 }));
  turn = 0; phase = 'spin'; screen('rouletteScreen');
  show('rouletteArea', gameMode === 'roulette'); show('blackjackArea', gameMode === 'blackjack'); show('balloonArea', gameMode === 'balloon');
  if (gameMode === 'roulette') beginSpinTurn(); else if (gameMode === 'blackjack') beginBlackjackTurn(); else { resetBalloon(); if (players.length < 2) endBalloonMatch(0); else beginBalloonTurn(); }
}

function renderSeats() {
  const ended = !$('endBox').classList.contains('hidden');
  $('status').innerHTML = players.map((p, i) => {
    // one correct guess = yellow aura ("pending"); zero correct guesses = red aura ("pending-hard")
    const cls = p.status === 'pending' && p.hitCount === 0 ? 'pending-hard' : p.status;
    const label = p.status === 'pending' ? (p.balloonResult === 'popped' ? '💥' : p.hitCount === 0 ? '?!' : '?') : ({safe:'SAFE', out:'OUT'}[p.status] || '&nbsp;');
    return '<div class="seat ' + cls + (i === turn && !ended ? ' current' : '') + '"><i class="n">' + (i + 1) + '</i><b>' + p.name + '</b><span>' + label + '</span></div>';
  }).join('');
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
  sound.spinStart();
  const winner = rnd(0, 36), N = 37, sl = TAU / N, target = winner * sl + sl/2 - Math.PI/2;
  const outerR = S/2 + 4, innerR = S/2 - 40;
  const st = ballAngle, fin = st - (st % TAU) + TAU * rnd(6,7) + target, d = fin - st, t0 = performance.now(), dur = 3800;
  let lastSlot = -1;
  (function f(now) {
    const t = Math.min(1, (now - t0) / dur);
    ballAngle = st + d * (1 - Math.pow(1 - t, 3));
    const r = outerR - (outerR - innerR) * Math.pow(t, 1.6);   // spins out on the purple ring, then drifts inward
    ball = { a: ballAngle, r };
    drawWheel();
    const slotNow = Math.floor((((ballAngle + Math.PI/2) % TAU) + TAU) % TAU / sl);
    if (slotNow !== lastSlot) { lastSlot = slotNow; sound.tick(); }
    if (t < 1) return requestAnimationFrame(f);
    ballAngle %= TAU; sound.land(); resolveSpin(winner);
  })(t0);
};

function resolveSpin(winner) {
  const p = players[turn];
  const c = colorOf(winner), parity = winner === 0 ? null : (winner % 2 ? 'odd' : 'even');
  p.landedColor = c; p.landedParity = parity; p.happyGain = 0;

  // Special case: 0 / green has no odd-or-even, so parity never applies when it comes up.
  if (c === 'green') {
    sound.prize();
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
  if (hits === 0) restoreAll(); else if (hits === 1) bounceAll();   // missed everything -> they stop; not a full miss -> they bounce

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

/* =========================================================
   BLACKJACK — the other game mode. Each player, in turn, plays a
   hand against the bot; winning is an automatic save, same as a
   roulette double-hit; losing or a push goes to the question phase
   (losing = harder question, push = normal odds), exactly like roulette.
   ========================================================= */
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const SUITS = [{s:'♠',red:false},{s:'♥',red:true},{s:'♦',red:true},{s:'♣',red:false}];
function drawCard() { return { rank: RANKS[rnd(0, 12)], suit: SUITS[rnd(0, 3)] }; }
function cardValue(rank) { if (rank === 'A') return 11; if (rank === 'J' || rank === 'Q' || rank === 'K') return 10; return +rank; }
function handTotal(hand) {
  let total = hand.reduce((s, c) => s + cardValue(c.rank), 0), aces = hand.filter(c => c.rank === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}
function cardHTML(c) { return '<div class="bj-card' + (c.suit.red ? ' red' : '') + '">' + c.rank + c.suit.s + '</div>'; }

let playerHand = [], botHand = [], bjBusy = false;

function renderHands(hideBotSecond) {
  $('playerCards').innerHTML = playerHand.map(cardHTML).join('');
  $('playerTotal').textContent = '(' + handTotal(playerHand) + ')';
  $('botCards').innerHTML = botHand.map((c, i) => (i === 1 && hideBotSecond) ? '<div class="bj-card back">?</div>' : cardHTML(c)).join('');
  $('botTotal').textContent = hideBotSecond ? '' : '(' + handTotal(botHand) + ')';
}

function beginBlackjackTurn() {
  renderSeats();
  const p = players[turn];
  $('turnTitle').textContent = p.name + "'s turn";
  ['nextTurn', 'endBox'].forEach(id => show(id, false));
  show('bjActions', true); $('hitBtn').disabled = false; $('standBtn').disabled = false;
  $('bettingMsg').textContent = 'Get as close to 21 as you can without going over. Hit or stand?';
  playerHand = [drawCard(), drawCard()]; botHand = [drawCard(), drawCard()];
  renderHands(true);
  sound.select();
  bjBusy = false;
  if (handTotal(playerHand) === 21) { bjBusy = true; $('hitBtn').disabled = true; $('standBtn').disabled = true; setTimeout(standTurn, 900); }   // natural 21
}

$('hitBtn').onclick = () => {
  if (bjBusy) return;
  playerHand.push(drawCard());
  sound.tick();
  renderHands(true);
  if (handTotal(playerHand) >= 21) { bjBusy = true; $('hitBtn').disabled = true; $('standBtn').disabled = true; setTimeout(standTurn, 500); }
};
$('standBtn').onclick = () => { if (!bjBusy) standTurn(); };

async function standTurn() {
  bjBusy = true; $('hitBtn').disabled = true; $('standBtn').disabled = true;
  renderHands(false);                       // reveal the bot's hidden card
  sound.reveal();
  await sleep(600);
  while (handTotal(botHand) < 17 && handTotal(playerHand) <= 21) {
    botHand.push(drawCard()); sound.tick(); renderHands(false);
    await sleep(700);
  }
  resolveBlackjack();
}

function resolveBlackjack() {
  const pt = handTotal(playerHand), bt = handTotal(botHand);
  let result;
  if (pt > 21) result = 'lose';
  else if (bt > 21 || pt > bt) result = 'win';
  else if (pt < bt) result = 'lose';
  else result = 'push';

  const p = players[turn];
  p.bjResult = result; p.bjPlayerTotal = pt; p.bjBotTotal = Math.min(bt, 21);
  p.happyGain = (pt === 21) ? 3 : 0;          // exactly 21 = 3 happy faces
  const bonus21 = pt === 21 ? ' 🎉 21! +😄×3' : '';
  show('bjActions', false);

  if (result === 'win') {
    $('bettingMsg').textContent = 'You: ' + pt + ' — Dealer: ' + bt + '. You win!' + bonus21;
    sound.safe(); finalize(true, false);
  } else if (result === 'push') {
    $('bettingMsg').textContent = 'You: ' + pt + ' — Dealer: ' + bt + '. Push — let\u2019s see a question.' + bonus21;
    sound.select(); bounceAll();               // a push is not a fail
    p.status = 'pending'; p.hitCount = 1;
    renderSeats(); show('nextTurn', true); setNextLabel();
  } else {
    $('bettingMsg').textContent = 'You: ' + pt + ' — Dealer: ' + bt + '. You lose this hand.' + bonus21;
    sound.out(); restoreAll();                 // lost the hand -> decorations stop and go back
    p.status = 'pending'; p.hitCount = 0;
    renderSeats(); show('nextTurn', true); setNextLabel();
  }
}

/* ---- label the NEXT TURN button with who (or what) comes next ---- */
function setNextLabel() {
  const btn = $('nextTurn');
  if (phase === 'spin' && gameMode === 'balloon') {
    btn.textContent = players.some(p => p.status === 'pending') ? "LET'S CONTINUE WITH THE QUESTIONS" : 'SEE RESULTS';
  } else if (phase === 'spin') {
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
  ['betRow','spinWheel','questionBox','nextTurn','endBox','diffReveal','catReveal','qIntro','bjActions'].forEach(id => show(id, false));
  show('wheelbox', false); show('rouletteArea', false); show('blackjackArea', false); show('balloonArea', false);
  $('bettingMsg').textContent = (p.hitCount === 1 ? 'One correct guess! ' : 'No correct guesses — tougher odds. ') + "Let\u2019s see what question comes up...";
  if (pendingCreated) {
    $('bettingMsg').textContent = 'Answer the question created by ' + pendingCreated.from + '!';
    runAnswerCreated();
  } else runDifficultyThenCategory();
}

/* ---- generic slot-machine flicker: lands on finalText, ticking as it goes ---- */
function spinSlotMachine(el, pool, finalText, ticks = 16) {
  return new Promise(resolve => {
    let n = 0;
    const iv = setInterval(() => {
      el.textContent = pool[rnd(0, pool.length - 1)];
      sound.tick();
      n++;
      if (n > ticks) { clearInterval(iv); el.textContent = finalText; resolve(); }
    }, 70);
  });
}
/* ---- a big banner that pops in, holds, then disappears ---- */
async function revealBanner(id, text, holdMs = 1100) {
  sound.reveal();
  $(id).textContent = text;
  $(id).classList.remove('hidden');
  // restart the pop-in animation even if it was shown before
  $(id).style.animation = 'none'; void $(id).offsetWidth; $(id).style.animation = '';
  await sleep(holdMs);
  show(id, false);
}

/* ---------- difficulty + category slot machine, with a reveal banner after each ----------
   One correct guess  -> uses the odds configured in Settings (easy/medium favored by default).
   Zero correct guesses -> harder: the easy/hard odds are swapped, so medium and hard become likely. */
function weightedPick(weights) {
  const total = weights.easy + weights.medium + weights.hard;
  let r = Math.random() * total;
  if ((r -= weights.easy) < 0) return 'easy';
  if ((r -= weights.medium) < 0) return 'medium';
  return 'hard';
}
async function runDifficultyThenCategory() {
  const p = players[turn];
  const o = settings.odds;
  const weights = p.hitCount === 0 ? { easy: o.hard, medium: o.medium, hard: o.easy } : o;
  const finalDiff = weightedPick(weights);

  show('slotStage', true); show('fireFx', false);
  show('difficultyReel', true); show('categoryReel', false);
  await spinSlotMachine($('difficultyReel'), ['EASY', 'MEDIUM', 'HARD'], finalDiff.toUpperCase());
  if (finalDiff === 'hard') { show('fireFx', true); sound.fire(); await sleep(500); }
  show('slotStage', false); show('fireFx', false);
  await revealBanner('diffReveal', 'DIFFICULTY: ' + finalDiff.toUpperCase());

  const pool = [...settings.enabledCategories];
  const finalCat = pool[rnd(0, pool.length - 1)];
  show('slotStage', true); show('difficultyReel', false); show('categoryReel', true);
  await spinSlotMachine($('categoryReel'), pool, finalCat);
  show('slotStage', false);
  await revealBanner('catReveal', 'CATEGORY: ' + finalCat.toUpperCase());

  await revealBanner('qIntro', 'YOUR QUESTION IS...', 900);
  askQuestion(finalCat, finalDiff);
}

/* ---------- question card, with a difficulty-based countdown timer ---------- */
const TIME_LIMIT = { easy: 15, medium: 20, hard: 25 };
function askQuestion(category, difficulty) {
  const p = players[turn];
  p.qCategory = category; p.qDifficulty = difficulty;   // kept for the round summary
  const pool = (QUESTIONS[category] && QUESTIONS[category][difficulty]) || [];
  // Gerunds: most of the time it is a timed open task (negative / question / create-a-question)
  if (category === 'Gerunds' && Math.random() < 0.65) {
    const kinds = ['negative', 'question'];
    if (qIndex < pendingList.length - 1) kinds.push('create');   // the LAST player never gets "create a question" (nobody left to answer it)
    return askOpenQuestion(category, difficulty, kinds[rnd(0, kinds.length - 1)]);
  }
  if (pool.length === 0) { p.qResult = 'n/a'; finalize(true, true); return; }   // no question available -> treat as safe
  const q = pool[rnd(0, pool.length - 1)];
  show('questionBox', true);
  $('qCatLabel').textContent = category + ' — ' + difficulty.toUpperCase();
  $('qText').textContent = q.q;
  const box = $('qOptions'); box.innerHTML = '';
  const opts = q.options.map((t, i) => ({ t, ok: i === q.correct }));
  for (let k = opts.length - 1; k > 0; k--) { const r = rnd(0, k); [opts[k], opts[r]] = [opts[r], opts[k]]; }   // shuffle the answers
  const correctIdx = opts.findIndex(o => o.ok);
  opts.forEach((o, idx) => {
    const btn = document.createElement('button');
    btn.textContent = o.t;
    btn.onclick = () => {
      clearInterval(timerId);
      [...box.children].forEach(b => b.disabled = true);
      const ok = idx === correctIdx;
      btn.classList.add(ok ? 'correct' : 'wrong');
      if (!ok) box.children[correctIdx].classList.add('correct');
      p.qResult = ok ? 'correct' : 'wrong';
      (ok ? sound.correct : sound.wrong)();
      setTimeout(() => { show('questionBox', false); finalize(ok, true); }, 900);
    };
    box.appendChild(btn);
  });

  // countdown — runs out of time = automatic loss
  let remaining = TIME_LIMIT[difficulty] || 20;
  const bar = $('qTimerBar'), num = $('qTimerNum');
  bar.classList.remove('low'); bar.style.width = '100%'; num.textContent = remaining;
  const total = remaining;
  const timerId = setInterval(() => {
    remaining--;
    bar.style.width = Math.max(0, remaining / total * 100) + '%';
    num.textContent = Math.max(0, remaining);
    const urgent = remaining <= 5;
    bar.classList.toggle('low', urgent);
    if (remaining > 0) sound.timerTick(urgent);
    if (remaining <= 0) {
      clearInterval(timerId);
      sound.timeout();
      [...box.children].forEach(b => b.disabled = true);
      box.children[correctIdx].classList.add('correct');
      p.qResult = 'timeout';
      setTimeout(() => { show('questionBox', false); finalize(false, true); }, 900);
    }
  }, 1000);
}

/* ---------- Gerunds: timed open tasks (15 s) judged by the group ---------- */
const OPEN_TIME = 15;
const OPEN_LABEL = { negative: 'MAKE IT NEGATIVE', question: 'MAKE A QUESTION', create: 'CREATE A QUESTION', answer: 'ANSWER THE QUESTION' };
let pendingCreated = null;     // a question one player created; the NEXT player has to answer it
function runCountdown(total, onEnd) {
  const bar = $('qTimerBar'), num = $('qTimerNum');
  let remaining = total;
  bar.classList.remove('low'); bar.style.width = '100%'; num.textContent = remaining;
  const id = setInterval(() => {
    remaining--;
    bar.style.width = Math.max(0, remaining / total * 100) + '%';
    num.textContent = Math.max(0, remaining);
    const urgent = remaining <= 5;
    bar.classList.toggle('low', urgent);
    if (remaining > 0) sound.timerTick(urgent);
    if (remaining <= 0) { clearInterval(id); sound.timeout(); onEnd(); }
  }, 1000);
}
function askOpenQuestion(category, difficulty, kind) {
  const p = players[turn];
  const task = GERUND_TASKS[kind][rnd(0, GERUND_TASKS[kind].length - 1)];
  p.qCategory = category; p.qDifficulty = difficulty;
  show('questionBox', true);
  $('qCatLabel').textContent = category + ' — ' + OPEN_LABEL[kind];
  $('qText').textContent = task.prompt;
  const box = $('qOptions');
  if (kind === 'create') {
    box.innerHTML = '<div class="qhint">The NEXT player will have to answer your question!</div>' +
      '<input id="createInput" class="qinput" type="text" maxlength="140" autocomplete="off" placeholder="Type your question here...">';
    const inp = $('createInput'); inp.focus();
  } else {
    box.innerHTML = '<div class="qhint">Say or write your answer before the time runs out.</div>';
  }
  runCountdown(OPEN_TIME, () => {
    if (kind === 'create') {
      const typed = ($('createInput') ? $('createInput').value : '').trim();
      pendingCreated = { from: p.name, text: typed };
      return showVerdict({ answer: (typed ? 'Your question: "' + typed + '"\n' : '') + task.answer }, 'create');
    }
    showVerdict(task, kind);
  });
}
/* the NEXT player's turn: answer the question that the previous player created */
async function runAnswerCreated() {
  const c = pendingCreated; pendingCreated = null;
  const p = players[turn];
  p.qCategory = 'Gerunds'; p.qDifficulty = 'easy';
  await revealBanner('qIntro', 'ANSWER ' + c.from.toUpperCase() + "'S QUESTION!", 1500);
  show('questionBox', true);
  $('qCatLabel').textContent = 'Gerunds — ' + OPEN_LABEL.answer;
  $('qText').textContent = c.from + ' asks:\n' + (c.text ? '"' + c.text + '"' : '(they asked it out loud)');
  $('qOptions').innerHTML = '<div class="qhint">' + p.name + ', answer ' + c.from + "'s question before the time runs out.</div>";
  runCountdown(OPEN_TIME, () => showVerdict({ answer: '' }, 'answer'));
}
function showVerdict(task, kind) {
  const p = players[turn];
  $('qCatLabel').textContent = p.qCategory + ' — ' + OPEN_LABEL[kind];
  $('qText').textContent = "\u23F0 Time's up! " + (kind === 'create' ? 'Was the question well made?' : 'Was the answer correct?');
  const box = $('qOptions'); box.innerHTML = '';
  if (task.answer) {
    const ref = document.createElement('div'); ref.className = 'qref';
    ref.textContent = (kind === 'negative' || kind === 'question' ? 'Model answer: ' : '') + task.answer; box.appendChild(ref);
  }
  const row = document.createElement('div'); row.className = 'verdict-row'; box.appendChild(row);
  [['\u2705 CORRECT', true], ['\u274C WRONG', false]].forEach(([label, ok]) => {
    const b = document.createElement('button'); b.textContent = label; b.className = ok ? 'v-ok' : 'v-no';
    b.onclick = () => {
      [...row.children].forEach(x => x.disabled = true);
      b.classList.add(ok ? 'correct' : 'wrong');
      p.qResult = ok ? 'correct' : 'wrong';
      (ok ? sound.correct : sound.wrong)();
      $('qText').textContent = ok ? 'Answered correctly!' : 'Answered wrong.';
      setTimeout(() => { show('questionBox', false); finalize(ok, true); }, 1100);
    };
    row.appendChild(b);
  });
}

/* ---------- finalize the current player: update seat + Firebase history ---------- */
function finalize(safe, answeredQuestion, quiet) {
  const p = players[turn];
  p.status = safe ? 'safe' : 'out';
  if (!quiet) { (safe ? sound.safe : sound.out)(); safe ? bounceAll() : restoreAll(); }      // win -> decorations bounce, fail -> they return to their spot
  renderSeats();

  updateUserHistory(p.name, rec => {
    if (safe) rec.wins++; else rec.losses++;
    if (p.landedParity === 'odd') rec.winsOdd += safe ? 1 : 0;
    if (p.landedParity === 'even') rec.winsEven += safe ? 1 : 0;
    if (p.landedColor === 'red') rec.winsRed += safe ? 1 : 0;
    if (p.landedColor === 'black') rec.winsBlack += safe ? 1 : 0;
    if (p.landedColor === 'green') rec.winsGreen += safe ? 1 : 0;
    if (p.happyGain) rec.happyFaces += p.happyGain;
    if (p.colorBet) {                       // roulette: what they chose, and did it hit
      rec.roulettePlayed++;
      rec.bets[p.colorBet][p.colorBet === p.landedColor ? 'w' : 'l']++;
      if (p.parityBet && p.landedParity) rec.bets[p.parityBet][p.parityBet === p.landedParity ? 'w' : 'l']++;
    } else if (p.balloonResult) {           // balloon
      rec.balloonPlayed++; rec.bl[p.balloonResult === 'popped' ? 'l' : 'w']++;
    } else if (p.bjResult) {                // blackjack
      rec.blackjackPlayed++;
      rec.bj[{ win: 'w', lose: 'l', push: 'p' }[p.bjResult]]++;
      if (p.bjPlayerTotal === 21) rec.bj.t21++;
    }
    if (answeredQuestion) { rec.questionsAnswered++; if (safe) rec.questionsCorrect++; }
  });

  show('spinWheel', false);
  show('nextTurn', true);
  setNextLabel();
}

$('nextTurn').onclick = () => {
  if (phase === 'spin' && gameMode === 'balloon') { startQuestionPhase(); }
  else if (phase === 'spin') {
    turn++;
    if (turn < players.length) { gameMode === 'roulette' ? beginSpinTurn() : gameMode === 'blackjack' ? beginBlackjackTurn() : beginBalloonTurn(); }
    else startQuestionPhase();
  } else {
    qIndex++;
    if (qIndex < pendingList.length) beginQuestionTurn(); else finishGame();
  }
};

function finishGame() {
  show('nextTurn', false);
  show('wheelbox', false); show('rouletteArea', false); show('blackjackArea', false); show('balloonArea', false); show('bjActions', false);
  $('turnTitle').textContent = 'Round summary';
  $('bettingMsg').textContent = '';
  (players.some(p => p.status === 'safe') ? sound.correct : sound.select)();

  $('summary').innerHTML = players.map(p => {
    const lines = [];
    if (p.colorBet) {
      lines.push('Bet: ' + p.colorBet.toUpperCase() + (p.parityBet ? ' / ' + p.parityBet.toUpperCase() : ''));
      lines.push('Landed: ' + (p.landedColor || '?').toUpperCase() + (p.landedParity ? ' / ' + p.landedParity.toUpperCase() : ' / —'));
    } else if (p.bjResult) {
      lines.push('Blackjack: you ' + p.bjPlayerTotal + ' — dealer ' + p.bjBotTotal +
        ' (' + ({win:'win', lose:'loss', push:'push'}[p.bjResult]) + ')');
    }
    else if (p.balloonResult) {
      lines.push('Balloon: ' + (p.balloonResult === 'popped' ? 'it popped on you 💥' : 'last one standing 🏆'));
    }
    if (p.qCategory) {
      const resultLabel = { correct: 'answered correctly', wrong: 'answered wrong', timeout: 'ran out of time', 'n/a': 'no question available' }[p.qResult] || p.qResult;
      lines.push('Question: ' + p.qCategory + ' (' + p.qDifficulty.toUpperCase() + ') — ' + resultLabel);
    }
    if (p.happyGain) lines.push('Bonus: 😄 × ' + p.happyGain);
    return '<div class="result-card ' + p.status + '"><b>' + p.name + ' — ' + ({safe:'SAFE',out:'OUT'}[p.status]) + '</b>' +
      lines.map(l => '<div class="result-line">' + l + '</div>').join('') + '</div>';
  }).join('');

  show('endBox', true); renderSeats();
}
$('toSelect').onclick = () => { buildReels(); screen('selectScreen'); };
$('toStart').onclick = () => screen('startScreen');


/* =========================================================
   PIXEL WALKER — a little gambler (top hat, suit, bow tie),
   drawn in code with a 4-frame walk cycle
   ========================================================= */
(function buildWalker() {
  const PAL = { K:'#111111', W:'#f4f4f4', S:'#f2c29b', H:'#3b2314', G:'#e2b93b', R:'#c62828', C:'#2b2b3d', D:'#1a1a28', B:'#0a0a0a', E:'#222' };
  const W = 16, H = 23, px = 3;
  function frame(f) {
    const g = Array.from({ length: H }, () => Array(W).fill('.'));
    const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c; };
    const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c); };
    // top hat
    rect(5, 0, 6, 3, 'K'); rect(5, 2, 6, 1, 'G'); rect(3, 3, 10, 1, 'K');
    // head (faces right)
    rect(5, 4, 6, 5, 'S'); rect(5, 4, 6, 1, 'H'); rect(5, 5, 1, 2, 'H');
    set(9, 6, 'K'); set(10, 7, 'S'); set(8, 8, 'R');            // eye, nose hint, little smile
    rect(7, 9, 2, 1, 'S');                                       // neck
    // suit + shirt + bow tie
    rect(4, 10, 8, 7, 'C'); rect(7, 10, 2, 7, 'W'); rect(7, 10, 2, 1, 'R'); set(6, 10, 'R'); set(9, 10, 'R');
    rect(4, 16, 8, 1, 'D'); set(7, 14, 'G'); set(8, 14, 'G');    // belt + gold button
    // arms swing opposite to the legs
    const front = (f === 0 || f === 3);       // which arm leads
    const arm = (x, dy) => { rect(x, 11 + dy, 2, 4, 'C'); rect(x, 15 + dy, 2, 1, 'S'); };
    arm(front ? 2 : 3, 0); arm(front ? 12 : 11, 0);
    if (front) { rect(2, 11, 2, 4, 'D'); } else { rect(12, 11, 2, 4, 'D'); }   // the far arm is a shade darker
    // legs: A apart, B together (one foot up), C apart (swapped), D together
    const leg = (x, lift, shoeDx) => { rect(x, 17, 3, 5 - lift, 'D'); rect(x + shoeDx, 22 - lift, 3, 1, 'B'); };
    if (f === 0) { leg(4, 0, -1); leg(9, 0, 1); }
    if (f === 1) { leg(6, 1, 0); leg(7, 0, 1); }
    if (f === 2) { leg(3, 0, -1); leg(10, 0, 1); }
    if (f === 3) { leg(7, 1, 1); leg(6, 0, 0); }
    return g;
  }
  const svg = (g, i) => {
    let r = '';
    g.forEach((row, y) => row.forEach((c, x) => { if (PAL[c]) r += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + PAL[c] + '"/>'; }));
    return '<svg class="frame f' + (i + 1) + '" width="' + W * px + '" height="' + H * px + '" viewBox="0 0 ' + W + ' ' + H + '" shape-rendering="crispEdges">' + r + '</svg>';
  };
  const el = document.getElementById('walkerSprite');
  if (el) el.innerHTML = [0, 1, 2, 3].map(i => svg(frame(i), i)).join('');
})();

/* =========================================================
   SIDE DECORATIONS — they bounce around the whole screen when
   someone WINS (or when clicked) and go back to their spot when
   someone FAILS (or when clicked again)
   ========================================================= */
const decoSpans = [...document.querySelectorAll('.deco span')];

function startBounce(sp) {
  if (sp._stop) return;                                   // already bouncing
  const r = sp.getBoundingClientRect();
  if (!r.width) return;                                   // decorations hidden on small screens
  const b = document.createElement('div');
  b.className = 'bouncer'; b.textContent = sp.textContent;
  document.body.appendChild(b);
  const size = Math.max(r.width, r.height, 36);
  const ang = Math.random() * TAU, speed = rnd(320, 520);
  let x = r.left, y = r.top, vx = Math.cos(ang) * speed, vy = Math.sin(ang) * speed, rot = 0, alive = true;
  const spin = (Math.random() < .5 ? -1 : 1) * rnd(120, 360);
  if (Math.abs(vx) < 120) vx = vx < 0 ? -160 : 160;       // avoid boring straight up/down paths
  if (Math.abs(vy) < 120) vy = vy < 0 ? -160 : 160;
  sp.classList.add('away');
  let last = performance.now(), lastSound = 0;
  (function f(now) {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    x += vx * dt; y += vy * dt; rot += spin * dt;
    const maxX = window.innerWidth - size, maxY = window.innerHeight - size;
    let hit = false;
    if (x < 0) { x = 0; vx = Math.abs(vx); hit = true; }
    if (x > maxX) { x = maxX; vx = -Math.abs(vx); hit = true; }
    if (y < 0) { y = 0; vy = Math.abs(vy); hit = true; }
    if (y > maxY) { y = maxY; vy = -Math.abs(vy); hit = true; }
    if (hit && now - lastSound > 120) { lastSound = now; sound.tick(); }
    b.style.transform = 'translate(' + x + 'px,' + y + 'px) rotate(' + rot + 'deg)';
    requestAnimationFrame(f);
  })(last);
  sp._stop = () => { alive = false; b.remove(); sp.classList.remove('away'); sp._stop = null; };
  b.addEventListener('click', () => { sp._stop(); sound.select(); });
}
const bounceAll  = () => decoSpans.forEach(startBounce);
const restoreAll = () => decoSpans.forEach(sp => sp._stop && sp._stop());
decoSpans.forEach(sp => sp.addEventListener('click', () => startBounce(sp)));


/* =========================================================
   BALLOON — elimination game. ONE balloon goes around the table:
   on your turn you INFLATE it as much as you dare (at least once),
   then PASS it to the next player still in. Whoever it pops on is
   eliminated, a new balloon starts with the players who are left,
   and the LAST one standing wins.
   ========================================================= */
let balloonPumps = 0, balloonLimit = 10, turnPumps = 0, balloonBusy = false;
const aliveIdx = () => players.map((p, i) => i).filter(i => players[i].balloonResult !== 'popped');
function nextAlive(from) {
  for (let k = 1; k <= players.length; k++) {
    const j = (from + k) % players.length;
    if (players[j].balloonResult !== 'popped') return j;
  }
  return from;
}
function drawBalloon() {
  const w = Math.min(230, 60 + balloonPumps * 5);                  // grows with every pump
  const b = $('balloon');
  b.style.width = w + 'px';
  b.style.setProperty('--wob', Math.max(0.25, 1.6 - balloonPumps * 0.04) + 's');   // wobbles faster as it gets tense
  const hue = Math.max(0, 205 - balloonPumps * 6);                 // blue -> red
  $('balloonBody').setAttribute('fill', 'hsl(' + hue + ',80%,52%)');
  $('balloonKnot').setAttribute('fill', 'hsl(' + hue + ',80%,40%)');
  $('pumpInfo').textContent = 'Pumps so far: ' + balloonPumps + '  —  Players left: ' + aliveIdx().length;
}
function resetBalloon() {
  balloonPumps = 0; balloonLimit = rnd(14, 36);                       // hidden: nobody knows when it pops
  $('balloon').classList.remove('gone'); show('boom', false);
  drawBalloon();
}
function beginBalloonTurn() {
  renderSeats();
  const p = players[turn];
  turnPumps = 0; balloonBusy = false;
  $('turnTitle').textContent = p.name + "'s turn";
  ['nextTurn', 'endBox'].forEach(id => show(id, false));
  show('balloonActions', true); $('pumpBtn').disabled = false; $('passBtn').disabled = true;
  $('bettingMsg').textContent = p.name + ': inflate the balloon as much as you dare, then pass it to ' + players[nextAlive(turn)].name + '. Inflate at least once!';
  sound.select();
}
function showBoom(emoji, msg) {
  $('balloon').classList.add('gone');
  document.querySelector('.boom-emoji').textContent = emoji;
  $('boomMsg').textContent = msg;
  show('boom', true);
  const bx = $('boom'); bx.style.animation = 'none'; void bx.offsetWidth; bx.style.animation = '';
}
function popBalloon() {
  const p = players[turn];
  balloonBusy = true;
  show('balloonActions', false);
  showBoom('💥', p.name + ' LOST!'); sound.pop();
  $('bettingMsg').textContent = '💥 The balloon popped on ' + p.name + '! ' + p.name + ' is out.';
  p.balloonResult = 'popped';
  p.status = 'pending'; p.hitCount = 0;            // out of the balloon; answers a question later (if questions are on)
  restoreAll();                                     // a loss: the decorations stop and go back
  renderSeats();
  setTimeout(() => {
    const alive = aliveIdx();
    if (alive.length <= 1) return endBalloonMatch(alive[0]);
    resetBalloon();                                 // new balloon, same game, fewer players
    turn = nextAlive(turn);
    beginBalloonTurn();
  }, 2400);
}
function endBalloonMatch(w) {
  show('balloonActions', false);
  if (!settings.askQuestions) {                     // no questions: the eliminated players are simply out
    players.forEach((q, i) => { if (q.status === 'pending') { turn = i; finalize(false, false, true); } });
  }
  turn = w;
  const win = players[w];
  win.balloonResult = 'last';
  showBoom('🏆', win.name + ' WINS!'); sound.correct();
  $('bettingMsg').textContent = '🏆 ' + win.name + ' is the last one standing and wins the balloon game!';
  finalize(true, false);
}
$('pumpBtn').onclick = () => {
  if (balloonBusy) return;
  balloonPumps++; turnPumps++;
  sound.pump(balloonPumps);
  if (balloonPumps >= balloonLimit) { $('pumpInfo').textContent = 'Pumps so far: ' + balloonPumps; return popBalloon(); }
  drawBalloon();
  const b = $('balloon'); b.classList.remove('pumped'); void b.offsetWidth; b.classList.add('pumped');
  $('passBtn').disabled = false;
};
$('passBtn').onclick = () => {
  if (balloonBusy || turnPumps === 0) return;
  balloonBusy = true;
  const p = players[turn], nxt = nextAlive(turn);
  show('balloonActions', false);
  $('bettingMsg').textContent = p.name + ' passes the balloon to ' + players[nxt].name + '...';
  sound.select();
  setTimeout(() => { turn = nxt; beginBalloonTurn(); }, 900);
};
