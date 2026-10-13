'use strict';

/* ==========================================================
   Paciência (Klondike) — HTML + CSS + JS puro
   Pilhas: 'stock' (monte), 'waste' (descarte),
           'f0'..'f3' (fundações), 't0'..'t6' (colunas)
   ========================================================== */

const SUITS = [
  { sym: '♠', red: false },
  { sym: '♥', red: true },
  { sym: '♦', red: true },
  { sym: '♣', red: false },
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const TARGETS = ['f0', 'f1', 'f2', 'f3', 't0', 't1', 't2', 't3', 't4', 't5', 't6'];

const OFFSET_DOWN = 0.1;  // deslocamento (em alturas de carta) das cartas viradas
const OFFSET_UP = 0.3;    // deslocamento das cartas abertas

const $ = (s) => document.querySelector(s);
const ui = {
  score: $('#score'),
  moves: $('#moves'),
  time: $('#time'),
  undo: $('#btnUndo'),
  auto: $('#btnAuto'),
  newGame: $('#btnNew'),
  draw: $('#drawMode'),
  win: $('#winDialog'),
  winStats: $('#winStats'),
  again: $('#btnAgain'),
  confetti: $('#confetti'),
};

const piles = {};
document.querySelectorAll('.pile[data-pile]').forEach((p) => { piles[p.dataset.pile] = p; });

let state;
let history = [];
let drawCount = 1;
let seconds = 0;
let timerId = null;
let started = false;
let busy = false; // true durante o auto-completar
let drag = null;
let lastTap = { key: null, t: 0 };

/* ---------- Preferências ---------- */
try {
  if (localStorage.getItem('paciencia:draw') === '3') drawCount = 3;
} catch (_) { /* sem armazenamento disponível */ }
ui.draw.value = String(drawCount);

/* ---------- Utilidades ---------- */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function getPile(id) {
  if (id === 'stock') return state.stock;
  if (id === 'waste') return state.waste;
  const n = Number(id.slice(1));
  return id[0] === 'f' ? state.found[n] : state.tab[n];
}

/* ---------- Novo jogo ---------- */
function newGame() {
  stopTimer();
  seconds = 0;
  started = false;
  history = [];
  busy = false;
  ui.confetti.innerHTML = '';

  const deck = [];
  for (let s = 0; s < 4; s++) {
    for (let r = 1; r <= 13; r++) deck.push({ s, r, up: false });
  }
  shuffle(deck);

  state = {
    stock: [],
    waste: [],
    found: [[], [], [], []],
    tab: [[], [], [], [], [], [], []],
    score: 0,
    moves: 0,
  };

  for (let i = 0; i < 7; i++) {
    for (let j = 0; j <= i; j++) {
      const c = deck.pop();
      c.up = j === i;
      state.tab[i].push(c);
    }
  }
  state.stock = deck;
  render();
}

/* ---------- Cronômetro ---------- */
function touch() {
  if (started) return;
  started = true;
  timerId = setInterval(() => {
    seconds++;
    ui.time.textContent = fmtTime(seconds);
  }, 1000);
}

function stopTimer() {
  clearInterval(timerId);
  timerId = null;
}

/* ---------- Renderização ---------- */
function cardNode(c, pile, idx) {
  const d = document.createElement('div');
  d.className = 'card' + (c.up ? '' : ' down') + (c.up && SUITS[c.s].red ? ' red' : '');
  d.dataset.pile = pile;
  d.dataset.idx = idx;
  d.dataset.key = c.s * 13 + c.r;
  if (c.up) {
    const sym = SUITS[c.s].sym;
    const rk = RANKS[c.r - 1];
    d.innerHTML =
      `<span class="corner tl"><b>${rk}</b><i>${sym}</i></span>` +
      `<span class="pip">${sym}</span>` +
      `<span class="corner br"><b>${rk}</b><i>${sym}</i></span>`;
  }
  return d;
}

function render() {
  // monte
  const st = piles.stock;
  st.innerHTML = '';
  if (state.stock.length) {
    st.appendChild(cardNode(state.stock[state.stock.length - 1], 'stock', state.stock.length - 1));
  }
  st.dataset.count = state.stock.length || '';
  st.classList.toggle('recycle', !state.stock.length && state.waste.length > 0);

  // descarte (em leque quando compra 3)
  const w = piles.waste;
  w.innerHTML = '';
  const shown = drawCount === 3 ? state.waste.slice(-3) : state.waste.slice(-1);
  const base = state.waste.length - shown.length;
  shown.forEach((c, i) => {
    const n = cardNode(c, 'waste', base + i);
    n.style.left = `calc(var(--cw) * ${(i * 0.3).toFixed(2)})`;
    w.appendChild(n);
  });

  // fundações
  state.found.forEach((f, i) => {
    const p = piles['f' + i];
    p.innerHTML = '';
    if (f.length) p.appendChild(cardNode(f[f.length - 1], 'f' + i, f.length - 1));
  });

  // colunas
  state.tab.forEach((t, i) => {
    const p = piles['t' + i];
    p.innerHTML = '';
    let off = 0;
    let lastTop = 0;
    t.forEach((c, j) => {
      const n = cardNode(c, 't' + i, j);
      n.style.top = `calc(var(--ch) * ${off.toFixed(3)})`;
      p.appendChild(n);
      lastTop = off;
      off += c.up ? OFFSET_UP : OFFSET_DOWN;
    });
    p.style.height = `calc(var(--ch) * ${(1 + lastTop).toFixed(3)})`;
  });

  updateStats();
}

function updateStats() {
  ui.score.textContent = state.score;
  ui.moves.textContent = state.moves;
  ui.time.textContent = fmtTime(seconds);
  ui.undo.disabled = busy || history.length === 0;
  ui.auto.hidden = !canAuto();
}

/* ---------- Regras ---------- */
function canPlace(cards, dst) {
  const first = cards[0];
  const pile = getPile(dst);

  if (dst[0] === 'f') {
    if (cards.length !== 1) return false;
    if (!pile.length) return first.r === 1;
    const top = pile[pile.length - 1];
    return top.s === first.s && first.r === top.r + 1;
  }

  if (dst[0] === 't') {
    if (!pile.length) return first.r === 13;
    const top = pile[pile.length - 1];
    return top.up && SUITS[top.s].red !== SUITS[first.s].red && top.r === first.r + 1;
  }

  return false;
}

function pushHistory() {
  history.push(JSON.stringify(state));
  if (history.length > 300) history.shift();
}

function move(src, idx, dst) {
  pushHistory();
  touch();

  const from = getPile(src);
  const to = getPile(dst);
  const moved = from.splice(idx);
  to.push(...moved);

  let pts = 0;
  if (dst[0] === 'f') pts += 10;
  else if (dst[0] === 't') {
    if (src === 'waste') pts += 5;
    else if (src[0] === 'f') pts -= 15;
  }
  if (src[0] === 't' && from.length && !from[from.length - 1].up) {
    from[from.length - 1].up = true;
    pts += 5;
  }

  state.score = Math.max(0, state.score + pts);
  state.moves++;
  render();
  checkWin();
}

function draw() {
  if (busy) return;
  if (!state.stock.length && !state.waste.length) return;

  pushHistory();
  touch();

  if (state.stock.length) {
    const n = Math.min(drawCount, state.stock.length);
    for (let i = 0; i < n; i++) {
      const c = state.stock.pop();
      c.up = true;
      state.waste.push(c);
    }
  } else {
    // reciclar o descarte de volta para o monte
    while (state.waste.length) {
      const c = state.waste.pop();
      c.up = false;
      state.stock.push(c);
    }
    if (drawCount === 1) state.score = Math.max(0, state.score - 100);
  }

  state.moves++;
  render();
}

function undo() {
  if (busy || !history.length) return;
  state = JSON.parse(history.pop());
  render();
}

function autoFoundation(pile, idx) {
  if (pile[0] === 'f') return;
  const cards = getPile(pile);
  if (idx !== cards.length - 1) return;
  const card = cards[idx];
  for (let i = 0; i < 4; i++) {
    if (canPlace([card], 'f' + i)) {
      move(pile, idx, 'f' + i);
      return;
    }
  }
}

/* ---------- Auto-completar ---------- */
function canAuto() {
  return (
    !busy &&
    state.stock.length === 0 &&
    state.tab.every((t) => t.every((c) => c.up)) &&
    !state.found.every((f) => f.length === 13)
  );
}

function autoComplete() {
  if (!canAuto()) return;
  busy = true;
  updateStats();

  const sources = ['waste', 't0', 't1', 't2', 't3', 't4', 't5', 't6'];

  const step = () => {
    if (state.found.every((f) => f.length === 13)) return;
    for (const s of sources) {
      const p = getPile(s);
      if (!p.length) continue;
      const c = p[p.length - 1];
      for (let i = 0; i < 4; i++) {
        if (canPlace([c], 'f' + i)) {
          move(s, p.length - 1, 'f' + i);
          if (busy) setTimeout(step, 90);
          return;
        }
      }
    }
    busy = false; // sem mais jogadas automáticas
    updateStats();
  };
  step();
}

/* ---------- Vitória ---------- */
function checkWin() {
  if (!state.found.every((f) => f.length === 13)) return;
  stopTimer();
  busy = false;
  updateStats();
  ui.winStats.textContent =
    `Você terminou em ${state.moves} movimentos e ${fmtTime(seconds)}, com ${state.score} pontos.`;
  spawnConfetti();
  if (typeof ui.win.showModal === 'function') ui.win.showModal();
}

function spawnConfetti() {
  ui.confetti.innerHTML = '';
  for (let i = 0; i < 36; i++) {
    const s = document.createElement('span');
    const suit = SUITS[i % 4];
    s.textContent = suit.sym;
    if (suit.red) s.className = 'red';
    s.style.left = Math.random() * 100 + '%';
    s.style.fontSize = 18 + Math.random() * 26 + 'px';
    s.style.animationDelay = Math.random() * 1.5 + 's';
    s.style.animationDuration = 3 + Math.random() * 3 + 's';
    ui.confetti.appendChild(s);
  }
}

/* ---------- Arrastar e soltar ---------- */
function onDown(e) {
  if (drag || busy) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;

  const n = e.target.closest('.card');
  if (!n) return;
  const pile = n.dataset.pile;
  if (pile === 'stock') return;

  const idx = Number(n.dataset.idx);
  const cards = getPile(pile);
  if (!cards[idx] || !cards[idx].up) return;
  if (pile[0] !== 't' && idx !== cards.length - 1) return; // só a carta do topo

  drag = {
    pile,
    idx,
    key: n.dataset.key,
    sx: e.clientX,
    sy: e.clientY,
    active: false,
    ghost: null,
    target: null,
    offX: 0,
    offY: 0,
  };
}

function startDrag() {
  const nodes = [...piles[drag.pile].querySelectorAll('.card')]
    .filter((c) => Number(c.dataset.idx) >= drag.idx);
  const r0 = nodes[0].getBoundingClientRect();
  drag.offX = drag.sx - r0.left;
  drag.offY = drag.sy - r0.top;

  const ghost = document.createElement('div');
  ghost.className = 'ghost';
  nodes.forEach((nd) => {
    const r = nd.getBoundingClientRect();
    const clone = nd.cloneNode(true);
    clone.style.left = '0px';
    clone.style.top = r.top - r0.top + 'px';
    ghost.appendChild(clone);
    nd.classList.add('lifted');
  });
  document.body.appendChild(ghost);
  drag.ghost = ghost;
  drag.active = true;
}

function onMove(e) {
  if (!drag) return;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
    startDrag();
  }
  drag.ghost.style.transform = `translate(${e.clientX - drag.offX}px, ${e.clientY - drag.offY}px)`;
  updateTarget();
}

function updateTarget() {
  const g = drag.ghost.firstElementChild.getBoundingClientRect();
  const cards = getPile(drag.pile).slice(drag.idx);
  let best = null;
  let bestArea = 0;

  for (const id of TARGETS) {
    if (id === drag.pile) continue;
    if (!canPlace(cards, id)) continue;
    const r = piles[id].getBoundingClientRect();
    const w = Math.min(g.right, r.right) - Math.max(g.left, r.left);
    const h = Math.min(g.bottom, r.bottom) - Math.max(g.top, r.top);
    if (w > 0 && h > 0 && w * h > bestArea) {
      bestArea = w * h;
      best = id;
    }
  }
  if (bestArea < g.width * g.height * 0.12) best = null;

  if (best !== drag.target) {
    if (drag.target) piles[drag.target].classList.remove('drop-ok');
    if (best) piles[best].classList.add('drop-ok');
    drag.target = best;
  }
}

function onUp(e) {
  if (!drag) return;
  const d = drag;
  drag = null;

  if (d.active) {
    d.ghost.remove();
    if (d.target) piles[d.target].classList.remove('drop-ok');
    if (d.target && e.type !== 'pointercancel') {
      move(d.pile, d.idx, d.target);
    } else {
      document.querySelectorAll('.card.lifted').forEach((n) => n.classList.remove('lifted'));
    }
    return;
  }

  // toque simples / duplo toque (envia a carta para a fundação)
  const now = Date.now();
  if (lastTap.key === d.key && now - lastTap.t < 350) {
    lastTap = { key: null, t: 0 };
    autoFoundation(d.pile, d.idx);
  } else {
    lastTap = { key: d.key, t: now };
  }
}

document.addEventListener('pointerdown', onDown);
window.addEventListener('pointermove', onMove);
window.addEventListener('pointerup', onUp);
window.addEventListener('pointercancel', onUp);

/* ---------- Botões e atalhos ---------- */
piles.stock.addEventListener('click', draw);

ui.undo.addEventListener('click', undo);
ui.auto.addEventListener('click', autoComplete);

ui.newGame.addEventListener('click', () => {
  if (state.moves > 0 && !state.found.every((f) => f.length === 13) &&
      !confirm('Começar um novo jogo? O progresso atual será perdido.')) return;
  newGame();
});

ui.draw.addEventListener('change', () => {
  const value = Number(ui.draw.value);
  if (state.moves > 0 && !confirm('Mudar o modo de compra inicia um novo jogo. Continuar?')) {
    ui.draw.value = String(drawCount);
    return;
  }
  drawCount = value;
  try { localStorage.setItem('paciencia:draw', String(drawCount)); } catch (_) { /* ignora */ }
  newGame();
});

ui.again.addEventListener('click', () => {
  ui.win.close();
  newGame();
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  }
});

newGame();
