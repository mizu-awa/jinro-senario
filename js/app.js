'use strict';

/* ===== 定義 ===== */
const ROLES = {
  villager: { name: '村人', team: 'village' },
  werewolf: { name: '人狼', team: 'wolf' },
  seer: { name: '占い師', team: 'village' },
  medium: { name: '霊媒師', team: 'village' },
  knight: { name: '騎士', team: 'village' },
  madman: { name: '狂人', team: 'wolf' }, // 勝敗カウントでは人間扱い
};
const STORAGE_KEY = 'jinro-senario:v1';
const DEFAULT_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ecf0f1', '#ff6fa8', '#95a5a6'];

/* ===== 状態 ===== */
let state = load() || createInitialState();

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function createInitialState() {
  const names = ['アカネ', 'ソウタ', 'ミドリ', 'キイロ', 'ムラサキ'];
  const roles = ['werewolf', 'seer', 'madman', 'villager', 'villager'];
  return {
    title: '',
    memo: '',
    players: names.map((name, i) => ({ id: uid(), name, role: roles[i], color: DEFAULT_COLORS[i], note: '' })),
    days: [createDay()],
  };
}

function createDay() {
  return {
    id: uid(),
    lines: [], // { id, speaker, text }  speaker: playerId or '' (ナレーション)
    votes: {}, // voterId -> targetId
    executed: 'auto', // 'auto' | 'none' | playerId
    night: { attack: '', divine: '', guard: '' },
    nightLines: [],
  };
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch (e) {
    return null;
  }
}

function normalize(s) {
  const base = createInitialState();
  s.title = s.title || '';
  s.memo = s.memo || '';
  s.players = Array.isArray(s.players) ? s.players : base.players;
  s.days = Array.isArray(s.days) && s.days.length ? s.days : [createDay()];
  s.days = s.days.map((d) => Object.assign(createDay(), d, { night: Object.assign(createDay().night, d.night) }));
  return s;
}

/* ===== ゲーム進行の計算 ===== */
const player = (id) => state.players.find((p) => p.id === id);
const pname = (id) => (player(id) ? player(id).name : '？');
const isWolf = (id) => player(id) && player(id).role === 'werewolf';

/** 投票の集計と処刑者の決定 */
function tally(day, alive) {
  const count = {};
  for (const voter of alive) {
    const t = day.votes[voter];
    if (t && alive.includes(t)) count[t] = (count[t] || 0) + 1;
  }
  const max = Math.max(0, ...Object.values(count));
  const top = Object.keys(count).filter((k) => count[k] === max && max > 0);
  let executed = null;
  if (day.executed === 'auto') executed = top.length === 1 ? top[0] : null;
  else if (day.executed !== 'none' && alive.includes(day.executed)) executed = day.executed;
  return { count, top, executed };
}

function judgeWinner(alive) {
  const wolves = alive.filter(isWolf).length;
  const humans = alive.length - wolves;
  if (wolves === 0) return 'village';
  if (wolves >= humans) return 'wolf';
  return null;
}

/** 全日程をシミュレーションして各日の結果を返す */
function simulate() {
  let alive = state.players.map((p) => p.id);
  let winner = judgeWinner(alive);
  const results = [];
  for (const day of state.days) {
    const r = { aliveAtStart: alive.slice(), winnerBefore: winner };
    if (winner) { r.skipped = true; results.push(r); continue; }

    const t = tally(day, alive);
    r.tally = t;
    if (t.executed) {
      alive = alive.filter((id) => id !== t.executed);
      r.medium = isWolf(t.executed) ? '人狼' : '人間';
    }
    winner = judgeWinner(alive);
    r.winnerAfterDay = winner;
    r.aliveAtNight = alive.slice();

    if (!winner) {
      const n = day.night;
      if (n.divine && alive.includes(n.divine)) r.divine = isWolf(n.divine) ? '人狼' : '人間';
      if (n.attack && alive.includes(n.attack)) {
        const guarded = n.guard && n.guard === n.attack && alive.some((id) => player(id).role === 'knight');
        if (guarded) r.guarded = true;
        else { r.killed = n.attack; alive = alive.filter((id) => id !== n.attack); }
      }
      winner = judgeWinner(alive);
      r.winnerAfterNight = winner;
    }
    results.push(r);
  }
  return { results, winner, alive };
}

/* ===== DOM ヘルパー ===== */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function playerSelect(value, ids, onChange, emptyLabel = '―') {
  return h('select', { onchange: (e) => onChange(e.target.value) },
    h('option', { value: '' }, emptyLabel),
    ids.map((id) => h('option', { value: id, selected: id === value }, pname(id))));
}

function chip(id, extraClass = '') {
  const p = player(id);
  return h('span', { class: `chip ${extraClass}` }, h('span', { class: 'dot', style: `background:${p.color}` }), p.name);
}

function commit(rerender = true) {
  save();
  if (rerender) render();
}

/* ===== ① 配役 ===== */
function renderSetup() {
  document.getElementById('title').value = state.title;
  document.getElementById('memo').value = state.memo;

  const counts = {};
  state.players.forEach((p) => { counts[p.role] = (counts[p.role] || 0) + 1; });
  const summary = document.getElementById('role-summary');
  summary.replaceChildren(
    h('span', { class: 'chip' }, `${state.players.length}人`),
    ...Object.entries(counts).map(([r, c]) => h('span', { class: `chip ${r === 'werewolf' ? 'wolf' : ''}` }, `${ROLES[r].name}×${c}`)));

  const tbody = document.getElementById('player-list');
  tbody.replaceChildren(...state.players.map((p) => h('tr', {},
    h('td', {}, h('input', { type: 'color', value: p.color, onchange: (e) => { p.color = e.target.value; commit(); } })),
    h('td', {}, h('input', { type: 'text', value: p.name, onchange: (e) => { p.name = e.target.value; commit(); } })),
    h('td', {}, h('select', { onchange: (e) => { p.role = e.target.value; commit(); } },
      Object.entries(ROLES).map(([k, r]) => h('option', { value: k, selected: k === p.role }, r.name)))),
    h('td', {}, h('input', { type: 'text', value: p.note || '', placeholder: '口調・性格など', oninput: (e) => { p.note = e.target.value; commit(false); } })),
    h('td', {}, h('button', { class: 'small danger', title: '削除', onclick: () => removePlayer(p.id) }, '×')),
  )));
}

function removePlayer(id) {
  if (!confirm(`${pname(id)} を削除しますか？`)) return;
  state.players = state.players.filter((p) => p.id !== id);
  commit();
}

/* ===== ② シナリオ ===== */
function renderScenario() {
  const { results } = simulate();
  const list = document.getElementById('day-list');
  list.replaceChildren(...state.days.map((day, i) => renderDay(day, i, results[i])));
}

function renderDay(day, i, r) {
  const n = i + 1;
  const card = h('div', { class: 'card day' });
  card.append(h('div', { class: 'card-head' },
    h('h2', {}, `${n}日目`),
    h('button', { class: 'small danger', onclick: () => { if (confirm(`${n}日目を削除しますか？`)) { state.days.splice(i, 1); if (!state.days.length) state.days.push(createDay()); commit(); } } }, 'この日を削除')));

  if (r.skipped) {
    card.append(h('div', { class: 'result' }, '（ゲームは既に終了しています）'));
    return card;
  }

  card.append(h('div', { class: 'status' },
    state.players.map((p) => chip(p.id, r.aliveAtStart.includes(p.id) ? '' : 'dead'))));

  // 昼：議論
  card.append(h('h3', {}, '☀ 昼の議論'));
  card.append(renderLines(day.lines, r.aliveAtStart));

  // 投票
  card.append(h('h3', {}, '🗳 投票'));
  card.append(h('div', { class: 'grid2' }, r.aliveAtStart.map((voter) => h('label', {},
    h('span', {}, pname(voter)),
    playerSelect(day.votes[voter] || '', r.aliveAtStart.filter((x) => x !== voter), (v) => { day.votes[voter] = v; commit(); }, '（未投票）')))));

  const tallyText = Object.entries(r.tally.count).sort((a, b) => b[1] - a[1]).map(([id, c]) => `${pname(id)} ${c}票`).join(' / ') || '票なし';
  card.append(h('div', { class: 'result' }, `集計：${tallyText}`));

  const execSel = h('select', { onchange: (e) => { day.executed = e.target.value; commit(); } },
    h('option', { value: 'auto', selected: day.executed === 'auto' }, '自動（最多票）'),
    h('option', { value: 'none', selected: day.executed === 'none' }, '処刑なし'),
    r.aliveAtStart.map((id) => h('option', { value: id, selected: day.executed === id }, pname(id))));
  card.append(h('div', { class: 'grid2' }, h('label', {}, h('span', {}, '処刑者'), execSel)));

  if (r.tally.executed) {
    card.append(h('div', { class: 'result' }, `⚰ ${pname(r.tally.executed)} が処刑された（霊媒結果：${r.medium}）`));
  } else if (day.executed === 'auto' && r.tally.top.length > 1) {
    card.append(h('div', { class: 'result' }, `同票（${r.tally.top.map(pname).join('・')}）のため処刑者を手動で選んでください`));
  }

  if (r.winnerAfterDay) {
    card.append(winBox(r.winnerAfterDay));
    return card;
  }

  // 夜
  card.append(h('h3', {}, '🌙 夜の行動'));
  const alive = r.aliveAtNight;
  const hasRole = (role) => alive.some((id) => player(id).role === role);
  const nightFields = [];
  nightFields.push(h('label', {}, h('span', {}, '人狼の襲撃'), playerSelect(day.night.attack, alive.filter((id) => !isWolf(id)), (v) => { day.night.attack = v; commit(); }, '（なし）')));
  if (hasRole('seer')) {
    const seer = alive.find((id) => player(id).role === 'seer');
    nightFields.push(h('label', {}, h('span', {}, '占い先'), playerSelect(day.night.divine, alive.filter((id) => id !== seer), (v) => { day.night.divine = v; commit(); }, '（なし）')));
  }
  if (hasRole('knight')) {
    const knight = alive.find((id) => player(id).role === 'knight');
    nightFields.push(h('label', {}, h('span', {}, '護衛先'), playerSelect(day.night.guard, alive.filter((id) => id !== knight), (v) => { day.night.guard = v; commit(); }, '（なし）')));
  }
  card.append(h('div', { class: 'grid2' }, nightFields));

  const nightResults = [];
  if (r.divine) nightResults.push(`🔮 占い：${pname(day.night.divine)} は「${r.divine}」`);
  if (r.guarded) nightResults.push(`🛡 ${pname(day.night.attack)} への襲撃は護衛により失敗（翌朝：犠牲者なし）`);
  if (r.killed) nightResults.push(`🐺 ${pname(r.killed)} が襲撃された`);
  if (!day.night.attack) nightResults.push('襲撃なし');
  nightResults.forEach((t) => card.append(h('div', { class: 'result' }, t)));

  card.append(h('h3', {}, '夜の会話・演出'));
  card.append(renderLines(day.nightLines, alive));

  if (r.winnerAfterNight) card.append(winBox(r.winnerAfterNight));
  return card;
}

function winBox(winner) {
  return h('div', { class: `result win ${winner === 'village' ? 'village' : ''}` },
    winner === 'village' ? '🎉 村人陣営の勝利！' : '🐺 人狼陣営の勝利！');
}

/** 台詞リストの編集 UI */
function renderLines(lines, speakers) {
  const wrap = h('div', { class: 'lines' });
  lines.forEach((line, idx) => {
    const move = (d) => {
      const j = idx + d;
      if (j < 0 || j >= lines.length) return;
      [lines[idx], lines[j]] = [lines[j], lines[idx]];
      commit();
    };
    const ids = [...new Set([...speakers, line.speaker].filter(Boolean))];
    wrap.append(h('div', { class: 'line' },
      playerSelect(line.speaker, ids, (v) => { line.speaker = v; commit(); }, 'ナレーション'),
      h('textarea', { rows: 1, value: line.text, placeholder: '台詞・ト書き', oninput: (e) => { line.text = e.target.value; commit(false); } }),
      h('div', { class: 'ops' },
        h('button', { class: 'small', title: '上へ', onclick: () => move(-1) }, '↑'),
        h('button', { class: 'small', title: '下へ', onclick: () => move(1) }, '↓'),
        h('button', { class: 'small danger', title: '削除', onclick: () => { lines.splice(idx, 1); commit(); } }, '×'))));
  });
  wrap.append(h('div', {}, h('button', { class: 'small', onclick: () => { lines.push({ id: uid(), speaker: '', text: '' }); commit(); } }, '＋ 台詞を追加')));
  return wrap;
}

/* ===== ③ 台本プレビュー ===== */
function buildScript() {
  const { results, winner } = simulate();
  const out = [];
  const lineText = (l) => (l.speaker ? `${pname(l.speaker)}「${l.text}」` : `（${l.text}）`);
  out.push(`■ ${state.title || '無題のシナリオ'}`);
  if (state.memo) out.push(state.memo);
  out.push('');
  out.push('【配役】');
  state.players.forEach((p) => out.push(`・${p.name}：${ROLES[p.role].name}${p.note ? `（${p.note}）` : ''}`));

  state.days.forEach((day, i) => {
    const r = results[i];
    if (r.skipped) return;
    out.push('', `━━━━ ${i + 1}日目 昼 ━━━━`);
    out.push(`生存者：${r.aliveAtStart.map(pname).join('、')}`);
    day.lines.filter((l) => l.text).forEach((l) => out.push(lineText(l)));
    const votes = r.aliveAtStart.filter((v) => day.votes[v]).map((v) => `${pname(v)}→${pname(day.votes[v])}`);
    if (votes.length) out.push(`［投票］${votes.join('、')}`);
    if (r.tally.executed) out.push(`［処刑］${pname(r.tally.executed)}`);
    if (r.winnerAfterDay) return;
    out.push('', `━━━━ ${i + 1}日目 夜 ━━━━`);
    day.nightLines.filter((l) => l.text).forEach((l) => out.push(lineText(l)));
    if (r.divine) out.push(`［占い］${pname(day.night.divine)}：${r.divine}`);
    if (r.guarded) out.push(`［護衛成功］${pname(day.night.guard)}`);
    if (r.killed) out.push(`［襲撃］${pname(r.killed)}`);
  });
  out.push('');
  out.push(winner ? `★ ${winner === 'village' ? '村人' : '人狼'}陣営の勝利` : '（決着していません）');
  return out.join('\n');
}

function renderPreview() {
  document.getElementById('preview').textContent = buildScript();
}

/* ===== 全体 ===== */
function render() {
  renderSetup();
  renderScenario();
  renderPreview();
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab, .tab-panel').forEach((el) => el.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    render();
  }));

  document.getElementById('title').addEventListener('input', (e) => { state.title = e.target.value; commit(false); });
  document.getElementById('memo').addEventListener('input', (e) => { state.memo = e.target.value; commit(false); });

  document.getElementById('btn-add-player').addEventListener('click', () => {
    const i = state.players.length;
    state.players.push({ id: uid(), name: `キャラ${i + 1}`, role: 'villager', color: DEFAULT_COLORS[i % DEFAULT_COLORS.length], note: '' });
    commit();
  });

  document.getElementById('btn-random-roles').addEventListener('click', () => {
    const roles = state.players.map((p) => p.role);
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }
    state.players.forEach((p, i) => { p.role = roles[i]; });
    commit();
  });

  document.getElementById('btn-add-day').addEventListener('click', () => { state.days.push(createDay()); commit(); });

  document.getElementById('btn-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildScript());
      alert('コピーしました');
    } catch (e) {
      alert('コピーに失敗しました');
    }
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${state.title || 'jinro-scenario'}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  document.getElementById('input-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      state = normalize(JSON.parse(await file.text()));
      commit();
    } catch (err) {
      alert('読み込みに失敗しました: ' + err.message);
    }
    e.target.value = '';
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    if (!confirm('すべての内容を初期状態に戻しますか？')) return;
    state = createInitialState();
    commit();
  });
}

bindEvents();
render();
