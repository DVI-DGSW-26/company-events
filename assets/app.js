/* ============================================================
   행사 아카이브 — 목록 / 미리보기 / 내려받기
   외부 의존성 없음. file:// 로 열어도 동작한다.
   ============================================================ */
(() => {
'use strict';

const DATA = window.ARCHIVE ?? { company: '', events: [] };
// 사본을 쓴다. applyData 가 이 배열을 비우고 다시 채우므로, 원본과 같은 배열이면 비워진다.
const EVENTS = [...(DATA.events ?? [])];

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const ICON_DL = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0 3.2-3.2M8 10 4.8 6.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 11.5v1.2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const ICON_OUT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.2 3h3.8v3.8M12.6 3.4 7.4 8.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.4 9.6v3a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

const fmtDate = (iso) => iso.replace(/-/g, '.');
const fmtSize = (n) => (!n ? '' : n < 1024 * 1024 ? `${Math.round(n / 1024)}KB` : `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)}MB`);
const fileOf = (p) => decodeURIComponent(p.split('/').pop());

/* ── 상태 ─────────────────────────────────────────────────── */
const state = {
  q: '', year: '', cat: '', type: '', pressOnly: false,
  dir: 'desc',
  id: null,      // 선택된 행사
  photo: 0,      // 미리보기 사진 index
  tab: '전체',
  lb: -1,        // 확대보기 index (-1 = 닫힘)
  visible: [],
};

/* ── 자료 반영 ─────────────────────────────────────────────── */
/* 배포본에서는 /api/archive 를 읽는다. 화면에서 등록·수정한 내용이 바로 보이게 하기
   위해서다. 파일로 열거나 사내망 서버로 열 때는 빌드가 만든 data.js 를 그대로 쓴다. */
function applyData(data) {
  $('orgName').textContent = data?.company ?? '';
  EVENTS.length = 0;
  EVENTS.push(...(data?.events ?? []));

  const n = (f) => EVENTS.reduce((s, e) => s + f(e), 0);
  $('tally').innerHTML =
    `사진 <b>${n((e) => e.photos.length)}</b>장 · ` +
    `언론기사 <b>${n((e) => e.articles.length)}</b>건 · ` +
    `영상 <b>${n((e) => e.videos.length + e.videoFiles.length)}</b>건`;

  fillSelect($('fYear'), [...new Set(EVENTS.map((e) => e.date.slice(0, 4)))].sort().reverse(), (v) => `${v}년`);
  fillSelect($('fCat'), [...new Set(EVENTS.map((e) => e.category))]);
  fillSelect($('fType'), [...new Set(EVENTS.map((e) => e.type))].sort((a, b) => a.localeCompare(b, 'ko')));
}

/** 목록을 다시 채운다. 고르고 있던 값은 남아 있으면 지킨다. */
function fillSelect(sel, values, label = (v) => v) {
  const had = sel.value;
  sel.replaceChildren(el('option', null, '전체'));
  for (const v of values) {
    const o = el('option', null, label(v));
    o.value = v;
    sel.append(o);
  }
  if (had && values.includes(had)) sel.value = had;
}

/* ── 목록 ─────────────────────────────────────────────────── */
function haystack(e) {
  return [
    e.title, e.subtitle, e.place, e.host, e.attendees, e.summary, e.type, e.category,
    fmtDate(e.date), ...(e.notes ?? []),
    ...e.articles.map((a) => `${a.press} ${a.title ?? ''} ${a.kind ?? ''}`),
    ...e.videos.map((v) => `${v.press} ${(v.marks ?? []).join(' ')}`),
  ].join(' ').toLowerCase();
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  const list = EVENTS.filter((e) => {
    if (state.year && !e.date.startsWith(state.year)) return false;
    if (state.cat && e.category !== state.cat) return false;
    if (state.type && e.type !== state.type) return false;
    if (state.pressOnly && e.articles.length === 0) return false;
    if (terms.length) {
      const h = haystack(e);
      if (!terms.every((t) => h.includes(t))) return false;
    }
    return true;
  });
  list.sort((a, b) => (state.dir === 'desc' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) || a.id.localeCompare(b.id));
  return list;
}

function renderList() {
  const list = filtered();
  state.visible = list;

  $('countNum').textContent = list.length;
  $('empty').hidden = list.length > 0;
  $('sortDate').dataset.dir = state.dir;
  $('fReset').hidden = !(state.q || state.year || state.cat || state.type || state.pressOnly);

  const tb = $('rows');
  tb.replaceChildren();

  list.forEach((e, i) => {
    const tr = el('tr');
    tr.tabIndex = 0;
    tr.dataset.id = e.id;
    tr.setAttribute('aria-selected', String(e.id === state.id));

    tr.append(
      cell('r-no', String(state.dir === 'desc' ? i + 1 : list.length - i)),
      cellNode(chip(e.category)),
      cell('r-type', e.type),
      cell('r-date', fmtDate(e.date)),
      titleCell(e),
      cell('r-host', e.host ?? ''),
      cellNode(materials(e)),
      cellNode(rowDownload(e)),
      manageCell(e),
    );
    tb.append(tr);
  });
}

/* 등록·수정·삭제 — 권한이 있을 때만 그린다 */
let isAdmin = false;

function manageCell(e) {
  const td = el('td', 't-admin');
  if (!isAdmin) return td;

  const box = el('div', 'manage');

  const edit = el('a', null, '수정');
  edit.href = `/admin.html#${e.id}`;
  edit.title = `${e.title} 수정`;
  edit.addEventListener('click', (ev) => ev.stopPropagation());

  const del = el('button', null, '삭제');
  del.type = 'button';
  del.title = `${e.title} 삭제`;
  del.addEventListener('click', (ev) => { ev.stopPropagation(); confirmDelete(e); });

  box.append(edit, del);
  td.append(box);
  return td;
}

const cell = (cls, text) => { const td = el('td'); td.append(el('span', cls, text)); return td; };
const cellNode = (node) => { const td = el('td'); td.append(node); return td; };

function chip(cat) {
  const c = el('span', cat === '사내' ? 'chip chip--out' : 'chip', cat);
  return c;
}

function titleCell(e) {
  const td = el('td');
  td.append(el('span', 'r-title', e.title));
  if (e.subtitle) td.append(el('span', 'r-sub', e.subtitle));
  return td;
}

function materials(e) {
  const wrap = el('div', 'mats');
  const vids = e.videos.length + e.videoFiles.length;
  const rows = [
    ['기사', e.articles.length, true],
    ['영상', vids, false],
    ['사진', e.photos.length, false],
  ];
  for (const [label, n, isPress] of rows) {
    const m = el('span', `mat${n ? ' mat--on' : ''}${n && isPress ? ' mat--press' : ''}`);
    m.append(el('span', null, label), el('b', null, String(n)));
    wrap.append(m);
  }
  return wrap;
}

function rowDownload(e) {
  // 화면에서 새로 등록한 행사는 아직 묶음 파일이 없다. 그때는 사진으로 안내한다.
  if (!e.bundle?.src) {
    const s = el('span', 'nodl', '사진 개별 저장');
    s.title = '묶음 파일이 아직 없습니다. 미리보기에서 사진을 한 장씩 저장하세요.';
    return s;
  }
  const a = el('a', 'rowdl');
  a.href = e.bundle.src;
  a.download = e.bundle.name;
  a.title = `${e.title} 자료 전체 (${fmtSize(e.bundle.size)})`;
  a.innerHTML = `${ICON_DL}<span>${fmtSize(e.bundle.size)}</span>`;
  a.addEventListener('click', (ev) => ev.stopPropagation());
  return a;
}

/* 행 선택 */
$('rows').addEventListener('click', (ev) => {
  const tr = ev.target.closest('tr[data-id]');
  if (tr) select(tr.dataset.id);
});
$('rows').addEventListener('keydown', (ev) => {
  const tr = ev.target.closest('tr[data-id]');
  if (!tr) return;
  if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(tr.dataset.id); }
  else if (ev.key === 'ArrowDown' && tr.nextElementSibling) { ev.preventDefault(); tr.nextElementSibling.focus(); }
  else if (ev.key === 'ArrowUp' && tr.previousElementSibling) { ev.preventDefault(); tr.previousElementSibling.focus(); }
});

/* ── 미리보기 ─────────────────────────────────────────────── */
const current = () => EVENTS.find((e) => e.id === state.id);

function select(id, keepTab) {
  state.id = id;
  // file:// 은 origin 이 null 이라 replaceState 가 막히는 브라우저가 있다
  try { if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id); } catch {}
  state.photo = 0;
  if (!keepTab) state.tab = '전체';
  $('preview').hidden = false;
  renderList();
  renderPreview();
  const row = document.querySelector(`tr[data-id="${id}"]`);
  row?.scrollIntoView({ block: 'nearest' });
}

function renderPreview() {
  const e = current();
  if (!e) return;

  /* 사진 무대 */
  const has = e.photos.length > 0;
  $('stage').classList.toggle('stage--empty', !has);
  $('navPrev').disabled = e.photos.length < 2;
  $('navNext').disabled = e.photos.length < 2;
  $('stageBtn').disabled = !has;

  if (has) {
    const p = e.photos[state.photo];
    $('stageImg').src = p.src;
    $('stageImg').alt = p.caption || `${e.title} 사진 ${state.photo + 1}`;
    $('stageCaption').textContent = p.caption || p.orig;
    $('stageCount').textContent = `${state.photo + 1} / ${e.photos.length}`;
  } else {
    $('stageImg').removeAttribute('src');
    $('stageImg').alt = '';
    $('stageCaption').textContent = '등록된 사진이 없습니다';
    $('stageCount').textContent = '';
  }

  /* 썸네일 */
  const strip = $('strip');
  strip.replaceChildren();
  if (e.photos.length > 1) {
    e.photos.forEach((p, i) => {
      const b = el('button');
      b.type = 'button';
      b.setAttribute('aria-selected', String(i === state.photo));
      b.setAttribute('aria-label', `사진 ${i + 1}`);
      const img = el('img');
      img.src = p.thumb; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      b.append(img);
      b.addEventListener('click', () => { state.photo = i; renderPreview(); });
      strip.append(b);
    });
  }

  /* 제목부 */
  const catChip = $('pvCat');
  catChip.textContent = e.category;
  catChip.className = e.category === '사내' ? 'chip chip--out' : 'chip';
  $('pvType').textContent = e.type;
  $('pvDate').textContent = `${fmtDate(e.date)} (${weekday(e.date)})`;
  $('pvTitle').textContent = e.title;
  $('pvSub').textContent = e.subtitle ?? '';
  $('pvSub').hidden = !e.subtitle;
  $('pvSummary').textContent = e.summary ?? '';
  $('pvSummary').hidden = !e.summary;

  /* 사실 목록 */
  const facts = $('pvFacts');
  facts.replaceChildren();
  const pairs = [['장소', e.place], ['주관', e.host], ['참석', e.attendees]];
  for (const [k, v] of pairs) {
    if (!v) continue;
    facts.append(el('dt', null, k), el('dd', null, v));
  }

  /* 참고 사항 */
  const notes = e.notes ?? [];
  $('pvNotes').hidden = notes.length === 0;
  const ul = $('pvNotesList');
  ul.replaceChildren();
  notes.forEach((n) => ul.append(el('li', null, n)));

  /* 전체 내려받기 — 묶음 파일이 있는 행사만 */
  const b = $('pvBundle');
  b.hidden = !e.bundle?.src;
  if (e.bundle?.src) {
    b.href = e.bundle.src;
    b.download = e.bundle.name;
    $('pvBundleSize').textContent = fmtSize(e.bundle.size);
  }

  renderTabs(e);
  renderItems(e);
}

function weekday(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return '일월화수목금토'[d.getDay()];
}

function renderTabs(e) {
  const vids = e.videos.length + e.videoFiles.length;
  const defs = [
    ['전체', null],
    ['기사', e.articles.length],
    ['영상', vids],
    ['사진', e.photos.length],
  ];
  if (!defs.some((d) => d[0] === state.tab && d[1] !== 0)) state.tab = '전체';

  const box = $('tabs');
  box.replaceChildren();
  for (const [name, n] of defs) {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(name === state.tab));
    b.disabled = n === 0;
    b.innerHTML = n === null ? name : `${name} <b>${n}</b>`;
    b.addEventListener('click', () => { state.tab = name; renderTabs(e); renderItems(e); });
    box.append(b);
  }
}

function renderItems(e) {
  const box = $('items');
  box.replaceChildren();
  box.classList.remove('photogrid');

  if (state.tab === '사진') return renderPhotoGrid(e, box);

  const show = state.tab;
  if (show === '전체' || show === '기사') e.articles.forEach((a) => box.append(articleItem(a)));
  if (show === '전체' || show === '영상') {
    e.videos.forEach((v) => box.append(videoItem(v)));
    e.videoFiles.forEach((v) => box.append(videoFileItem(v)));
  }
  if (show === '전체' && e.photos.length) box.append(photoSummaryItem(e));

  if (!box.children.length) {
    box.append(el('p', 'note-inline', '등록된 자료가 없습니다. 사진은 위 미리보기에서 확인하세요.'));
  }
  if (LOCAL_FILE && box.querySelector('a[download]')) {
    box.append(el('p', 'note-inline',
      '사진과 PDF 는 새 탭에서 열립니다. 거기서 Ctrl+S 로 저장하세요. 전체 내려받기(ZIP)는 바로 저장됩니다.'));
  }
}

function itemShell(kindLabel, kindMod, title, meta) {
  const row = el('div', 'item');
  row.append(el('span', `item__kind${kindMod ? ` item__kind--${kindMod}` : ''}`, kindLabel));
  const body = el('div', 'item__body');
  body.append(el('span', 'item__title', title));
  if (meta) body.append(el('span', 'item__meta', meta));
  row.append(body);
  const acts = el('div', 'item__acts');
  row.append(acts);
  return { row, acts };
}

/* file:// 로 열면 브라우저가 download 속성을 무시하고 그 파일로 이동해 버린다.
   ZIP 은 그대로 저장되지만 사진·PDF 는 새 탭에서 열어 페이지를 지킨다. */
const LOCAL_FILE = location.protocol === 'file:';
const isZip = (href) => /\.zip$/i.test(href);

function linkBtn(href, label, { download, mark } = {}) {
  const a = el('a', `mini${mark ? ' mini--dl' : ''}`);
  a.href = href;
  if (download) {
    a.download = download;
    if (LOCAL_FILE && !isZip(href)) { a.target = '_blank'; a.rel = 'noopener'; }
  } else { a.target = '_blank'; a.rel = 'noopener'; }
  a.innerHTML = `${mark ? ICON_DL : ICON_OUT}<span>${label}</span>`;
  return a;
}

function articleItem(a) {
  const kind = a.kind ?? '기사';
  const { row, acts } = itemShell(kind, 'press', a.title ?? a.press, [
    a.press,
    a.pdf ? `PDF ${fmtSize(a.pdf.size)}` : null,
    a.capture ? '지면 캡처' : null,
    a.memo ?? null,
    a.hasPhoto === false ? '기사 내 사진 없음' : null,
  ].filter(Boolean).join(' · '));

  if (a.pdf) acts.append(linkBtn(a.pdf.src, 'PDF 저장', { download: fileOf(a.pdf.src), mark: true }));
  if (a.capture) acts.append(linkBtn(a.capture.src, '캡처 저장', { download: fileOf(a.capture.src), mark: true }));
  acts.append(linkBtn(a.url, '원문'));
  return row;
}

function videoItem(v) {
  const { row, acts } = itemShell('영상', null, v.press, '외부 영상 링크');
  acts.append(linkBtn(v.url, '영상 보기'));
  if (v.marks?.length) {
    const m = el('div', 'marks');
    v.marks.forEach((t) => m.append(el('span', null, t)));
    row.append(m);
  }
  return row;
}

function videoFileItem(v) {
  const { row, acts } = itemShell('영상', null, v.name, `동영상 파일 · ${fmtSize(v.size)}`);
  acts.append(linkBtn(v.src, '저장', { download: v.name, mark: true }));
  return row;
}

function photoSummaryItem(e) {
  const { row, acts } = itemShell('사진', null, `행사 사진 ${e.photos.length}장`, e.bundle?.src ? '전체 내려받기에 함께 들어 있습니다' : '묶음 파일은 아직 없습니다. 크게 보기에서 한 장씩 저장하세요');
  const b = el('button', 'mini');
  b.type = 'button';
  b.textContent = '사진 전체 보기';
  b.addEventListener('click', () => { state.tab = '사진'; renderTabs(e); renderItems(e); });
  acts.append(b);
  return row;
}

function renderPhotoGrid(e, box) {
  box.classList.add('photogrid');
  e.photos.forEach((p, i) => {
    const b = el('button');
    b.type = 'button';
    b.title = p.caption || p.orig;
    b.setAttribute('aria-label', `사진 ${i + 1} 크게 보기`);
    const img = el('img');
    img.src = p.thumb; img.alt = p.caption || ''; img.loading = 'lazy'; img.decoding = 'async';
    b.append(img);
    b.addEventListener('click', () => openLightbox(i));
    box.append(b);
  });
}

/* 사진 넘기기 */
const stepPhoto = (d) => {
  const e = current();
  if (!e || e.photos.length < 2) return;
  state.photo = (state.photo + d + e.photos.length) % e.photos.length;
  renderPreview();
  document.querySelector('.strip button[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
};
$('navPrev').addEventListener('click', () => stepPhoto(-1));
$('navNext').addEventListener('click', () => stepPhoto(1));
$('stageBtn').addEventListener('click', () => openLightbox(state.photo));

/* ── 확대 보기 ────────────────────────────────────────────── */
function openLightbox(i) {
  const e = current();
  if (!e || !e.photos.length) return;
  state.lb = i;
  $('lightbox').hidden = false;
  document.body.style.overflow = 'hidden';
  paintLightbox();
  $('lbClose').focus();
}
function closeLightbox() {
  state.lb = -1;
  $('lightbox').hidden = true;
  document.body.style.overflow = '';
}
function paintLightbox() {
  const e = current();
  const p = e.photos[state.lb];
  $('lbImg').src = p.src;
  $('lbImg').alt = p.caption || `${e.title} 사진 ${state.lb + 1}`;
  $('lbEvent').textContent = e.title;
  $('lbCount').textContent = `${state.lb + 1} / ${e.photos.length}`;
  $('lbCap').textContent = [p.caption, p.taken ? `촬영 ${fmtDate(p.taken)}` : null, `${p.w}×${p.h}`].filter(Boolean).join('  ·  ');
  const dl = $('lbDownload');
  dl.href = p.src;
  dl.download = p.name;
  if (LOCAL_FILE) { dl.target = '_blank'; dl.rel = 'noopener'; }
}
const stepLb = (d) => {
  const e = current();
  state.lb = (state.lb + d + e.photos.length) % e.photos.length;
  paintLightbox();
};
$('lbPrev').addEventListener('click', () => stepLb(-1));
$('lbNext').addEventListener('click', () => stepLb(1));
$('lbClose').addEventListener('click', closeLightbox);
$('lightbox').addEventListener('click', (ev) => { if (ev.target === $('lightbox')) closeLightbox(); });

/* ── 컨트롤 ───────────────────────────────────────────────── */
const debounce = (fn, ms = 140) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

$('q').addEventListener('input', debounce((ev) => {
  state.q = ev.target.value;
  $('qClear').hidden = !state.q;
  renderList();
}));
$('qClear').addEventListener('click', () => {
  $('q').value = ''; state.q = ''; $('qClear').hidden = true; renderList(); $('q').focus();
});
$('fYear').addEventListener('change', (ev) => { state.year = ev.target.value; renderList(); });
$('fCat').addEventListener('change', (ev) => { state.cat = ev.target.value; renderList(); });
$('fType').addEventListener('change', (ev) => { state.type = ev.target.value; renderList(); });
$('fPress').addEventListener('click', (ev) => {
  state.pressOnly = !state.pressOnly;
  ev.currentTarget.setAttribute('aria-pressed', String(state.pressOnly));
  renderList();
});
$('fReset').addEventListener('click', () => {
  Object.assign(state, { q: '', year: '', cat: '', type: '', pressOnly: false });
  $('q').value = ''; $('qClear').hidden = true;
  $('fYear').value = ''; $('fCat').value = ''; $('fType').value = '';
  $('fPress').setAttribute('aria-pressed', 'false');
  renderList();
});
$('sortDate').addEventListener('click', () => { state.dir = state.dir === 'desc' ? 'asc' : 'desc'; renderList(); });
$('pvClose').addEventListener('click', () => { $('preview').hidden = true; });

/* 키보드 */
document.addEventListener('keydown', (ev) => {
  if (!sheet.hidden) { if (ev.key === 'Escape') closeSheet(); return; }
  if (state.lb >= 0) {
    if (ev.key === 'Escape') closeLightbox();
    else if (ev.key === 'ArrowLeft') stepLb(-1);
    else if (ev.key === 'ArrowRight') stepLb(1);
    return;
  }
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
  if (typing) {
    if (ev.key === 'Escape') document.activeElement.blur();
    return;
  }
  if (ev.key === '/') { ev.preventDefault(); $('q').focus(); }
  else if (ev.key === 'ArrowLeft') stepPhoto(-1);
  else if (ev.key === 'ArrowRight') stepPhoto(1);
});

/* ── 로그인 계정 표시 (배포본 전용) ───────────────────────── */
/* 사내망 서버나 파일로 열 때는 인증이 없으므로 조용히 넘어간다 */
if (!LOCAL_FILE) {
  fetch('/api/auth/me', { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      if (!me?.signedIn) return;
      // 개인 메일로 SSO 를 쓰는 계정은 이메일이 비어 있을 수 있다
      $('accountWho').textContent = [me.name, me.email].filter(Boolean).join(' · ') || '사내 계정';
      $('account').hidden = false;
      if (me.admin) {
        isAdmin = true;
        document.body.dataset.admin = '1';
        $('adminLink').hidden = false;
        $('newEvent').hidden = false;
        renderList();          // 관리 열을 다시 그린다
      }
    })
    .catch(() => {});
}

/* ── 목록에서 바로 삭제 ───────────────────────────────────── */
const toast = (msg, ms = 6000) => {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
};

const sheet = $('sheet');
let pending = null;
const closeSheet = () => { sheet.hidden = true; pending = null; };

function confirmDelete(e) {
  pending = e;
  $('sheetBody').textContent =
    `${e.title}\n\n사진 ${e.photos.length}장과 기사 ${e.articles.length}건이 함께 지워집니다.\n` +
    '저장소 이력에는 남아 있어 필요하면 되살릴 수 있습니다.';
  sheet.hidden = false;
  $('sheetNo').focus();
}

$('sheetNo').addEventListener('click', closeSheet);
sheet.addEventListener('click', (ev) => { if (ev.target === sheet) closeSheet(); });

$('sheetYes').addEventListener('click', async () => {
  const e = pending;
  if (!e) return;
  const yes = $('sheetYes');
  yes.disabled = true;
  try {
    // 그 사이 다른 사람이 저장했는지 보려면 판번호가 필요하다
    const s = await fetch('/api/admin/state', { headers: { accept: 'application/json' } });
    const rev = s.ok ? (await s.json()).rev : undefined;

    const res = await fetch('/api/admin/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: e.id, title: e.title, rev }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `삭제하지 못했습니다 (${res.status})`);

    closeSheet();
    // 목록에서 즉시 빼 준다. 실제 반영은 1~2분 뒤 배포까지 걸린다.
    const at = EVENTS.findIndex((x) => x.id === e.id);
    if (at >= 0) EVENTS.splice(at, 1);
    if (state.id === e.id) { state.id = null; $('preview').hidden = true; }
    renderList();
    if (state.visible.length && !state.id) select(state.visible[0].id);
    toast(`'${e.title}' 을 삭제했습니다.\n사이트에 완전히 반영되기까지 1~2분 걸립니다.`);
  } catch (err) {
    closeSheet();
    toast(`삭제하지 못했습니다.\n${err.message}`, 9000);
  } finally {
    yes.disabled = false;
  }
});

/* ── 시작 — 홈 화면 없이 최신 행사를 바로 펼친다 ──────────── */
function start() {
  renderList();
  const wanted = EVENTS.some((e) => e.id === location.hash.slice(1)) ? location.hash.slice(1) : null;
  if (wanted) select(wanted);
  else if (state.visible.length) select(state.visible[0].id);
  else { state.id = null; $('preview').hidden = true; }
}

applyData(DATA);
start();

/* ── 최신 목록 읽기 ────────────────────────────────────────── */
/* 사진 주소는 시간이 지나면 만료되는 서명 주소다. 주기적으로 받아 두는 대신
   실제로 만료돼 사진이 안 뜰 때 한 번 다시 받는다. 화면이 헛돌지 않게. */
const relogin = () => {
  location.href = `/api/auth/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
};

let loading = null;
let lastLoad = 0;

function loadLive({ keepView = false } = {}) {
  if (LOCAL_FILE) return Promise.resolve(false);
  if (loading) return loading;

  loading = fetch('/api/archive', { headers: { accept: 'application/json' } })
    .then(async (r) => {
      const body = await r.json().catch(() => null);
      if (r.status === 401 || body?.needsLogin) { relogin(); return false; }
      if (!r.ok || !body?.events?.length) return false;

      const keep = { id: state.id, photo: state.photo, tab: state.tab };
      applyData(body);
      lastLoad = Date.now();

      if (keepView && EVENTS.some((e) => e.id === keep.id)) {
        renderList();
        state.photo = Math.min(keep.photo, Math.max(0, (current()?.photos.length ?? 1) - 1));
        state.tab = keep.tab;
        renderPreview();
      } else start();
      return true;
    })
    .catch(() => false)
    .finally(() => { loading = null; });

  return loading;
}

/** 사진이 안 뜨면 주소가 만료된 것으로 보고 목록을 한 번 다시 받는다 */
function onMediaError() {
  if (LOCAL_FILE || Date.now() - lastLoad < 30_000) return;
  loadLive({ keepView: true });
}
window.addEventListener('error', (ev) => {
  if (ev.target instanceof HTMLImageElement) onMediaError();
}, true);

loadLive();

window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (id && id !== state.id && EVENTS.some((e) => e.id === id)) select(id);
});
})();
