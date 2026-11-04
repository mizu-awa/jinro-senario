'use strict';

/* ===== 定義 ===== */
// 勝敗判定では人狼以外をすべて「人間」として数える
const ROLES = {
  villager: '村人',
  werewolf: '人狼',
  seer: '占い師',
  medium: '霊能者',
  hunter: '狩人',
  madman: '狂人',
  nekomata: '猫又',
  fox: '妖狐',
};
const STORAGE_KEY = 'jinro-senario:v2';
const PRESET_KEY = 'jinro-senario:presets';
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ecf0f1', '#ff6fa8', '#95a5a6'];

/* ===== 状態 ===== */
const uid = () => Math.random().toString(36).slice(2, 10);

function createInitialState() {
  const roles = ['werewolf', 'seer', 'madman', 'villager', 'villager'];
  return {
    title: '',
    players: roles.map((role, i) => ({ id: uid(), name: `キャラ${i + 1}`, role, color: COLORS[i] })),
    firstNight: { victim: '', divine: '', lines: [] },
    days: [createDay()],
  };
}

function createDay() {
  return {
    id: uid(),
    lines: [],
    votes: {}, // 投票者ID -> 投票先ID
    executed: 'auto', // 'auto' | 'none' | 処刑者ID
    nekoExec: '', // 処刑された猫又の道連れ先
    night: { attack: '', divine: '', guard: '', nekoWolf: '' }, // nekoWolf: 噛まれた猫又の道連れ先（人狼）
    nightLines: [],
  };
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 保存できない環境では無視 */ }
}

let state = loadJSON(STORAGE_KEY, null) || createInitialState();
let presets = loadJSON(PRESET_KEY, []);

/* ===== ルール計算 ===== */
const player = (id) => state.players.find((p) => p.id === id);
const pname = (id) => (player(id) ? player(id).name : '？');
const roleOf = (id) => (player(id) ? player(id).role : null);
const isWolf = (id) => roleOf(id) === 'werewolf';
const result = (id) => (isWolf(id) ? '人狼' : '人間'); // 占い・霊能結果

/** 勝敗判定。決着時に人狼勝利/村人勝利の条件を満たしても妖狐が生存していれば妖狐勝利 */
function judge(alive) {
  const wolves = alive.filter(isWolf).length;
  let w = null;
  if (wolves === 0) w = 'village';
  else if (wolves >= alive.length - wolves) w = 'wolf';
  if (w && alive.some((id) => roleOf(id) === 'fox')) w = 'fox';
  return w;
}

/** 夜の処理（占い→襲撃）。死亡者を deaths に積む */
function resolveNight(alive, { attack, divine, guard, nekoWolf }, deaths, info) {
  const has = (role) => alive.some((id) => roleOf(id) === role);
  const dead = new Set();

  if (divine && has('seer') && alive.includes(divine)) {
    info.divine = { target: divine, result: result(divine) };
    if (roleOf(divine) === 'fox') { dead.add(divine); deaths.push({ id: divine, cause: '呪殺' }); }
  }
  if (attack && alive.includes(attack)) {
    if (guard && guard === attack && has('hunter')) info.attackFail = '護衛成功';
    else if (roleOf(attack) === 'fox') info.attackFail = '妖狐は襲撃で死なない';
    else {
      dead.add(attack);
      deaths.push({ id: attack, cause: '襲撃' });
      if (roleOf(attack) === 'nekomata') {
        if (nekoWolf && isWolf(nekoWolf) && alive.includes(nekoWolf)) {
          dead.add(nekoWolf);
          deaths.push({ id: nekoWolf, cause: '猫又の道連れ' });
        } else info.needNekoWolf = true;
      }
    }
  }
  return alive.filter((id) => !dead.has(id));
}

/** 全体をシミュレーション */
function simulate() {
  let alive = state.players.map((p) => p.id);
  const fn = state.firstNight;
  const first = { deaths: [] };
  if (fn.victim && alive.includes(fn.victim)) {
    alive = alive.filter((id) => id !== fn.victim);
    first.deaths.push({ id: fn.victim, cause: '初日犠牲者' });
  }
  alive = resolveNight(alive, { divine: fn.divine }, first.deaths, first);
  let winner = judge(alive);
  first.winner = winner;

  const days = state.days.map((day) => {
    const r = { aliveAtStart: alive.slice(), deathsDay: [], deathsNight: [] };
    if (winner) { r.skipped = true; return r; }

    // 投票集計
    const count = {};
    alive.forEach((v) => {
      const t = day.votes[v];
      if (t && alive.includes(t) && t !== v) count[t] = (count[t] || 0) + 1;
    });
    const max = Math.max(0, ...Object.values(count));
    r.count = count;
    r.top = Object.keys(count).filter((k) => max > 0 && count[k] === max);
    let exe = null;
    if (day.executed === 'auto') exe = r.top.length === 1 ? r.top[0] : null;
    else if (alive.includes(day.executed)) exe = day.executed;
    r.executed = exe;

    if (exe) {
      alive = alive.filter((id) => id !== exe);
      r.deathsDay.push({ id: exe, cause: '処刑' });
      r.medium = result(exe);
      if (roleOf(exe) === 'nekomata') {
        if (day.nekoExec && alive.includes(day.nekoExec)) {
          alive = alive.filter((id) => id !== day.nekoExec);
          r.deathsDay.push({ id: day.nekoExec, cause: '猫又の道連れ' });
        } else r.needNekoExec = true;
      }
    }
    winner = judge(alive);
    r.winnerDay = winner;
    r.aliveAtNight = alive.slice();
    if (winner) return r;

    alive = resolveNight(alive, day.night, r.deathsNight, r);
    winner = judge(alive);
    r.winnerNight = winner;
    return r;
  });
  return { first, days, winner };
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

function select(value, options, onChange) {
  return h('select', { onchange: (e) => onChange(e.target.value) },
    options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
}

function playerSelect(value, ids, onChange, emptyLabel = '（なし）') {
  return select(value, [['', emptyLabel], ...ids.map((id) => [id, pname(id)])], onChange);
}

const field = (label, control) => h('div', { class: 'row' }, h('span', { class: 'label' }, label), control);
const note = (text, cls = '') => h('div', { class: `result ${cls}` }, text);

function chips(alive) {
  return h('div', { class: 'chips' }, state.players.map((p) => h('span', { class: `chip ${alive.includes(p.id) ? '' : 'dead'}` },
    h('span', { class: 'dot', style: `background:${p.color}` }), p.name)));
}

function commit(rerender = true) {
  saveJSON(STORAGE_KEY, state);
  if (rerender) render();
}

/* ===== 配役 ===== */
function renderSetup() {
  document.getElementById('title').value = state.title;

  const counts = {};
  state.players.forEach((p) => { counts[p.role] = (counts[p.role] || 0) + 1; });
  document.getElementById('role-summary').textContent =
    `${state.players.length}人：` + Object.keys(ROLES).filter((r) => counts[r]).map((r) => `${ROLES[r]}${counts[r]}`).join(' ');

  document.getElementById('player-list').replaceChildren(...state.players.map((p) => h('div', { class: 'row' },
    h('input', { type: 'color', value: p.color, onchange: (e) => { p.color = e.target.value; commit(); } }),
    h('input', { type: 'text', value: p.name, onchange: (e) => { p.name = e.target.value; commit(); } }),
    h('select', { class: 'role', onchange: (e) => { p.role = e.target.value; commit(); } },
      Object.entries(ROLES).map(([k, name]) => h('option', { value: k, selected: k === p.role }, name))),
    h('button', { class: 'icon danger', onclick: () => { if (confirm(`${p.name} を削除しますか？`)) { state.players = state.players.filter((x) => x !== p); commit(); } } }, '×'),
  )));

  document.getElementById('preset-select').replaceChildren(
    presets.length ? null : h('option', { value: '' }, '（プリセットなし）'),
    ...presets.map((ps, i) => h('option', { value: i }, `${ps.name}（${ps.members.length}人）`)));
}

/* ===== シナリオ ===== */
function renderScenario() {
  const sim = simulate();
  document.getElementById('day-list').replaceChildren(
    renderFirstNight(sim.first),
    ...state.days.map((day, i) => renderDay(day, i, sim.days[i])));
  document.getElementById('btn-add-day').hidden = !!sim.winner;
}

function deathNotes(deaths) {
  return deaths.map((d) => note(`☠ ${pname(d.id)}（${d.cause}）`));
}

function winNote(w) {
  const text = { village: '🎉 村人陣営の勝利', wolf: '🐺 人狼陣営の勝利', fox: '🦊 妖狐の勝利' }[w];
  return note(text, `win ${w}`);
}

function renderFirstNight(r) {
  const fn = state.firstNight;
  const all = state.players.map((p) => p.id);
  const card = h('div', { class: 'card' }, h('h2', {}, '初日の夜'));
  card.append(field('初日犠牲者', playerSelect(fn.victim, all.filter((id) => !['werewolf', 'fox', 'nekomata'].includes(roleOf(id))), (v) => { fn.victim = v; commit(); })));
  const seer = all.find((id) => roleOf(id) === 'seer' && id !== fn.victim);
  if (seer) {
    card.append(field('初日占い', playerSelect(fn.divine, all.filter((id) => id !== seer && id !== fn.victim), (v) => { fn.divine = v; commit(); })));
  }
  if (r.divine) card.append(note(`🔮 ${pname(r.divine.target)} は ${r.divine.result}`));
  card.append(...deathNotes(r.deaths));
  card.append(h('h3', {}, '台詞'), renderLines(fn.lines, all));
  if (r.winner) card.append(winNote(r.winner));
  return card;
}

function renderDay(day, i, r) {
  const n = i + 1;
  const card = h('div', { class: 'card' }, h('h2', {}, `${n}日目`));
  if (r.skipped) {
    card.append(note('（ゲーム終了済み）'), deleteDayButton(i));
    return card;
  }
  const alive = r.aliveAtStart;
  card.append(chips(alive));

  card.append(h('h3', {}, '☀ 昼'), renderLines(day.lines, alive));

  card.append(h('h3', {}, '🗳 投票'));
  alive.forEach((v) => card.append(field(pname(v),
    playerSelect(day.votes[v] || '', alive.filter((x) => x !== v), (t) => { day.votes[v] = t; commit(); }, '（未投票）'))));
  const counted = Object.entries(r.count).sort((a, b) => b[1] - a[1]).map(([id, c]) => `${pname(id)}${c}`).join(' / ');
  card.append(note(`集計：${counted || '票なし'}`));
  card.append(field('処刑', select(day.executed,
    [['auto', '自動（最多票）'], ['none', 'なし'], ...alive.map((id) => [id, pname(id)])],
    (v) => { day.executed = v; commit(); })));
  if (day.executed === 'auto' && r.top.length > 1) card.append(note('同票です。処刑者を選んでください', 'warn'));
  if (r.executed && roleOf(r.executed) === 'nekomata') {
    card.append(field('猫又道連れ', playerSelect(day.nekoExec, alive.filter((id) => id !== r.executed), (v) => { day.nekoExec = v; commit(); }, '（選択）')));
  }
  if (r.needNekoExec) card.append(note('猫又の道連れ先を選んでください', 'warn'));
  card.append(...deathNotes(r.deathsDay));
  if (r.medium) card.append(note(`👻 霊能結果：${pname(r.executed)} は ${r.medium}`));
  if (r.winnerDay) {
    card.append(winNote(r.winnerDay), deleteDayButton(i));
    return card;
  }

  card.append(h('h3', {}, '🌙 夜'));
  const na = r.aliveAtNight;
  const find = (role) => na.find((id) => roleOf(id) === role);
  card.append(field('襲撃', playerSelect(day.night.attack, na.filter((id) => !isWolf(id)), (v) => { day.night.attack = v; commit(); })));
  const seer = find('seer');
  if (seer) card.append(field('占い', playerSelect(day.night.divine, na.filter((id) => id !== seer), (v) => { day.night.divine = v; commit(); })));
  const hunter = find('hunter');
  if (hunter) card.append(field('護衛', playerSelect(day.night.guard, na.filter((id) => id !== hunter), (v) => { day.night.guard = v; commit(); })));
  if (roleOf(day.night.attack) === 'nekomata' && !r.attackFail) {
    card.append(field('猫又道連れ', playerSelect(day.night.nekoWolf, na.filter(isWolf), (v) => { day.night.nekoWolf = v; commit(); }, '（選択）')));
  }
  if (r.needNekoWolf) card.append(note('猫又の道連れ先（人狼）を選んでください', 'warn'));
  if (r.divine) card.append(note(`🔮 ${pname(r.divine.target)} は ${r.divine.result}`));
  if (r.attackFail) card.append(note(`🛡 襲撃失敗（${r.attackFail}）`));
  card.append(...deathNotes(r.deathsNight));
  if (day.night.attack && !r.attackFail && !r.deathsNight.length) card.append(note('平和な朝'));
  card.append(h('h3', {}, '夜の台詞'), renderLines(day.nightLines, na));
  if (r.winnerNight) card.append(winNote(r.winnerNight));
  card.append(deleteDayButton(i));
  return card;
}

function deleteDayButton(i) {
  return h('button', {
    class: 'wide danger',
    onclick: () => {
      if (!confirm(`${i + 1}日目を削除しますか？`)) return;
      state.days.splice(i, 1);
      if (!state.days.length) state.days.push(createDay());
      commit();
    },
  }, `${i + 1}日目を削除`);
}

/** 台詞リスト */
function renderLines(lines, speakers) {
  const wrap = h('div');
  lines.forEach((line, idx) => {
    const move = (d) => {
      const j = idx + d;
      if (j < 0 || j >= lines.length) return;
      [lines[idx], lines[j]] = [lines[j], lines[idx]];
      commit();
    };
    const ids = [...new Set([...speakers, line.speaker].filter(Boolean))];
    wrap.append(h('div', { class: 'line' },
      h('div', { class: 'row' },
        playerSelect(line.speaker, ids, (v) => { line.speaker = v; commit(); }, 'ナレーション'),
        h('button', { class: 'icon', onclick: () => move(-1) }, '↑'),
        h('button', { class: 'icon', onclick: () => move(1) }, '↓'),
        h('button', { class: 'icon danger', onclick: () => { lines.splice(idx, 1); commit(); } }, '×')),
      h('textarea', { rows: 2, value: line.text, oninput: (e) => { line.text = e.target.value; commit(false); } })));
  });
  wrap.append(h('button', { class: 'wide', onclick: () => { lines.push({ speaker: '', text: '' }); commit(); } }, '＋ 台詞'));
  return wrap;
}

/* ===== 台本 ===== */
function buildScript() {
  const sim = simulate();
  const out = [];
  const say = (lines) => lines.filter((l) => l.text).forEach((l) => out.push(l.speaker ? `${pname(l.speaker)}「${l.text}」` : `（${l.text}）`));
  const deaths = (ds) => ds.forEach((d) => out.push(`［${d.cause}］${pname(d.id)}`));

  out.push(`■ ${state.title || '無題'}`, '', '【配役】');
  state.players.forEach((p) => out.push(`${p.name}：${ROLES[p.role]}`));

  out.push('', '―― 初日の夜 ――');
  say(state.firstNight.lines);
  if (sim.first.divine) out.push(`［占い］${pname(sim.first.divine.target)}→${sim.first.divine.result}`);
  deaths(sim.first.deaths);

  state.days.forEach((day, i) => {
    const r = sim.days[i];
    if (r.skipped) return;
    out.push('', `―― ${i + 1}日目 昼 ――`);
    say(day.lines);
    const votes = r.aliveAtStart.filter((v) => day.votes[v]).map((v) => `${pname(v)}→${pname(day.votes[v])}`);
    if (votes.length) out.push(`［投票］${votes.join('、')}`);
    deaths(r.deathsDay);
    if (r.medium) out.push(`［霊能］${pname(r.executed)}→${r.medium}`);
    if (r.winnerDay) return;
    out.push('', `―― ${i + 1}日目 夜 ――`);
    say(day.nightLines);
    if (r.divine) out.push(`［占い］${pname(r.divine.target)}→${r.divine.result}`);
    if (r.attackFail) out.push(`［襲撃失敗］${r.attackFail}`);
    deaths(r.deathsNight);
  });
  const w = { village: '村人陣営の勝利', wolf: '人狼陣営の勝利', fox: '妖狐の勝利' }[sim.winner];
  out.push('', w ? `★ ${w}` : '（未決着）');
  return out.join('\n');
}

/* ===== 全体 ===== */
function render() {
  renderSetup();
  renderScenario();
  document.getElementById('preview').textContent = buildScript();
}

function bindEvents() {
  const $ = (id) => document.getElementById(id);

  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab, .tab-panel').forEach((el) => el.classList.remove('active'));
    tab.classList.add('active');
    $(`tab-${tab.dataset.tab}`).classList.add('active');
    render();
    window.scrollTo(0, 0);
  }));

  $('title').addEventListener('input', (e) => { state.title = e.target.value; commit(false); });

  $('btn-add-player').addEventListener('click', () => {
    const i = state.players.length;
    state.players.push({ id: uid(), name: `キャラ${i + 1}`, role: 'villager', color: COLORS[i % COLORS.length] });
    commit();
  });

  $('btn-preset-save').addEventListener('click', () => {
    const name = prompt('プリセット名', state.title || 'メンバー');
    if (!name) return;
    presets.push({ name, members: state.players.map(({ name: n, color }) => ({ name: n, color })) });
    saveJSON(PRESET_KEY, presets);
    render();
  });

  $('btn-preset-load').addEventListener('click', () => {
    const ps = presets[$('preset-select').value];
    if (!ps || !confirm(`「${ps.name}」でメンバーを置き換えますか？（役職は今の並び順のまま引き継ぎます）`)) return;
    state.players = ps.members.map((m, i) => ({
      id: state.players[i] ? state.players[i].id : uid(), name: m.name, color: m.color, role: state.players[i] ? state.players[i].role : 'villager',
    }));
    commit();
  });

  $('btn-preset-delete').addEventListener('click', () => {
    const i = $('preset-select').value;
    if (!presets[i] || !confirm(`「${presets[i].name}」を削除しますか？`)) return;
    presets.splice(i, 1);
    saveJSON(PRESET_KEY, presets);
    render();
  });

  $('btn-reset').addEventListener('click', () => {
    if (!confirm('シナリオを初期状態に戻しますか？（プリセットは残ります）')) return;
    state = createInitialState();
    commit();
  });

  $('btn-add-day').addEventListener('click', () => { state.days.push(createDay()); commit(); });

  $('btn-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildScript());
      alert('コピーしました');
    } catch (e) {
      alert('コピーに失敗しました');
    }
  });
}

bindEvents();
render();
