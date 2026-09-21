/* ============================================================
   행사 관리 — 등록 · 수정 · 삭제
   사진은 브라우저에서 줄여서 올린다. 촬영 원본은 공유드라이브에 남는다.
   ============================================================ */
(() => {
'use strict';

const WEB_MAX = 1920, WEB_Q = 0.88;
const THUMB_MAX = 420, THUMB_Q = 0.76;
const BATCH_BYTES = 2_600_000;   // 한 요청에 담을 사진 용량 상한

const $ = (id) => document.getElementById(id);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

const state = {
  rev: null,         // 편집 시작 시점의 판번호. 저장할 때 충돌 확인에 쓴다
  doc: null,         // 행사 목록
  id: null,          // 지금 편집 중인 행사
  photos: [],        // { name, caption, w, h, taken, orig, url, file? }  file 이 있으면 새로 올릴 사진
  removed: [],       // 지울 기존 사진 이름
  dirtyNew: false,
};

const say = (msg, tone) => { const s = $('status'); s.textContent = msg; s.dataset.tone = tone ?? ''; };

/* ── 불러오기 ─────────────────────────────────────────────── */
async function loadState(id) {
  const res = await fetch(`/api/admin/state${id ? `?id=${encodeURIComponent(id)}` : ''}`, { headers: { accept: 'application/json' } });
  if (res.status === 401) { relogin(); throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.'); }
  if (res.status === 403) throw new Error('행사를 고칠 권한이 없습니다.');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '자료를 읽지 못했습니다.');
  return res.json();
}

async function boot() {
  try {
    const s = await loadState();
    state.rev = s.rev;
    state.doc = { events: s.events ?? [] };
    $('who').textContent = s.user?.name ? `${s.user.name} 님` : '';
    renderPicks();

    // 목록 화면의 '수정' 은 /admin.html#행사ID 로 들어온다
    const wanted = location.hash.slice(1);
    if (wanted && state.doc.events.some((e) => e.id === wanted)) await open(wanted);
  } catch (e) {
    showBootError(e);
  }
}

/** 시작하지 못한 이유를 사람이 조치할 수 있는 형태로 보여준다 */
function showBootError(e) {
  $('newEvent').disabled = true;          // 저장할 수 없는 상태에서 입력하게 두지 않는다
  const box = $('blank');
  box.classList.add('edit--error');
  box.replaceChildren();

  const missing = /환경변수가 설정되지 않았습니다:\s*(.+)$/.exec(e.message);
  const h = el('h2', null, missing ? '설정이 한 단계 남았습니다' : '행사 자료를 불러오지 못했습니다');
  box.append(h);

  if (missing) {
    box.append(el('p', null,
      '고친 내용을 담아 둘 저장 공간이 아직 없습니다. ' +
      'Vercel 화면에서 한 번 만들면 설정값이 자동으로 들어가고, 그 뒤에는 손댈 것이 없습니다.'));
    const steps = el('pre');
    steps.textContent = [
      'Vercel → 프로젝트 → Storage 탭',
      '  → Create Database → Blob 선택 → Create',
      '  → 이 프로젝트에 연결(Connect)',
      '  → Deployments 탭에서 Redeploy',
    ].join('\n');
    box.append(steps);
    box.append(el('p', 'fine',
      `만들면 ${missing[1]} 값이 프로젝트에 자동으로 추가됩니다. 따로 복사해 넣을 것은 없습니다. ` +
      '보기와 내려받기는 지금도 정상 동작합니다 — 등록·수정만 이 단계가 필요합니다.'));
  } else {
    box.append(el('p', null, e.message));
    box.append(el('p', 'fine', '잠시 뒤 새로 고쳐 보고, 계속 같으면 담당자에게 이 메시지를 알려주세요.'));
  }
}

function renderPicks() {
  const ul = $('picks');
  ul.replaceChildren();
  const list = [...state.doc.events].sort((a, b) => b.date.localeCompare(a.date));
  for (const ev of list) {
    const li = el('li');
    const b = el('button');
    b.type = 'button';
    b.setAttribute('aria-current', String(ev.id === state.id));
    b.append(el('b', null, ev.title), el('span', null, `${ev.date.replace(/-/g, '.')} · ${ev.category} · ${ev.type}`));
    b.addEventListener('click', () => open(ev.id));
    li.append(b);
    ul.append(li);
  }
  const types = [...new Set(state.doc.events.map((e) => e.type))].sort((a, b) => a.localeCompare(b, 'ko'));
  $('typeList').replaceChildren(...types.map((t) => { const o = el('option'); o.value = t; return o; }));
}

/* ── 편집 열기 ────────────────────────────────────────────── */
async function open(id) {
  const ev = state.doc.events.find((e) => e.id === id);
  if (!ev) return;
  say('');
  state.id = id;
  state.removed = [];
  state.dirtyNew = false;

  let media = { photos: [] };
  try {
    const s = await loadState(id);
    state.rev = s.rev; state.doc = { events: s.events ?? [] };
    media = s.media ?? { photos: [] };
  } catch (e) { say(e.message, 'bad'); }

  state.photos = (media.photos ?? []).map((p) => ({ ...p }));

  $('editTitle').textContent = '행사 수정';
  $('editId').textContent = id;
  $('del').hidden = false;
  fill(ev);
  show();
  renderPicks();
}

function newEvent() {
  say('');
  const used = new Set(state.doc.events.map((e) => e.id));
  let n = 1;
  while (used.has(`e${String(n).padStart(2, '0')}`)) n++;
  state.id = `e${String(n).padStart(2, '0')}`;
  state.photos = []; state.removed = []; state.dirtyNew = true;

  $('editTitle').textContent = '새 행사 등록';
  $('editId').textContent = state.id;
  $('del').hidden = true;
  fill({ category: '사외', date: new Date().toISOString().slice(0, 10) });
  show();
  renderPicks();
  $('fTitle').focus();
}

function show() { $('blank').hidden = true; $('edit').hidden = false; }

function fill(ev) {
  $('fTitle').value = ev.title ?? '';
  $('fSubtitle').value = ev.subtitle ?? '';
  $('fCategory').value = ev.category ?? '사외';
  $('fType').value = ev.type ?? '';
  $('fDate').value = ev.date ?? '';
  $('fPlace').value = ev.place ?? '';
  $('fHost').value = ev.host ?? '';
  $('fAttendees').value = ev.attendees ?? '';
  $('fSummary').value = ev.summary ?? '';
  $('fNotes').value = (ev.notes ?? []).join('\n');

  $('articles').replaceChildren();
  (ev.articles ?? []).forEach(addArticleRow);
  $('videos').replaceChildren();
  (ev.videos ?? []).forEach(addVideoRow);

  renderPhotos();
  counts();
}

const counts = () => {
  $('photoCount').textContent = state.photos.length;
  $('articleCount').textContent = $('articles').children.length;
  $('videoCount').textContent = $('videos').children.length;
  $('photoEmpty').hidden = state.photos.length > 0;
};

/* ── 사진 ─────────────────────────────────────────────────── */
function renderPhotos() {
  const box = $('photos');
  box.replaceChildren();
  state.photos.forEach((p, i) => {
    const card = el('div', `shot${p.file ? ' shot--new' : ''}`);
    const wrap = el('div', 'shot__img');
    const img = el('img');
    img.src = p.url; img.alt = ''; img.loading = 'lazy';
    wrap.append(img);
    if (p.file) wrap.append(el('span', 'shot__badge', '새로 올림'));

    const rm = el('button', 'shot__rm', '×');
    rm.type = 'button';
    rm.title = '이 사진 빼기';
    rm.setAttribute('aria-label', `사진 ${i + 1} 빼기`);
    rm.addEventListener('click', () => {
      if (!p.file) state.removed.push(p.name);
      state.photos.splice(i, 1);
      renderPhotos(); counts();
    });
    wrap.append(rm);

    const cap = el('input');
    cap.value = p.caption ?? '';
    cap.placeholder = '사진 설명 (선택)';
    cap.maxLength = 300;
    cap.addEventListener('input', () => { p.caption = cap.value; });

    card.append(wrap, cap);
    box.append(card);
  });
}

/** 캔버스로 긴 변을 맞춰 JPEG 로 다시 그린다 */
function resize(img, max, quality) {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return { dataUrl: c.toDataURL('image/jpeg', quality), w, h };
}

const loadImage = (file) => new Promise((res, rej) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); res(img); };
  img.onerror = () => { URL.revokeObjectURL(url); rej(new Error(`${file.name} 을 읽지 못했습니다.`)); };
  img.src = url;
});

/** 파일명을 안전하게 만든다. 서버가 받는 형식과 맞춘다. */
function makeName(index, original) {
  const base = original.replace(/\.[^.]+$/, '')
    .replace(/[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ._ ()\-]/g, '_')
    .slice(0, 80) || 'photo';
  return `${String(index).padStart(3, '0')}_${base}.jpg`;
}

$('pick').addEventListener('change', async (ev) => {
  const files = [...ev.target.files].filter((f) => /^image\//.test(f.type));
  ev.target.value = '';
  if (!files.length) return;

  say(`사진 ${files.length}장 준비 중…`);
  let n = state.photos.length;
  const used = new Set(state.photos.map((p) => p.name));

  for (const file of files) {
    try {
      const img = await loadImage(file);
      const web = resize(img, WEB_MAX, WEB_Q);
      const thumb = resize(img, THUMB_MAX, THUMB_Q);
      let name = makeName(++n, file.name);
      while (used.has(name)) name = makeName(++n, file.name);
      used.add(name);
      state.photos.push({
        name, caption: '', orig: file.name, w: web.w, h: web.h, taken: null,
        url: web.dataUrl, file: { image: web.dataUrl, thumb: thumb.dataUrl },
      });
    } catch (e) { say(e.message, 'bad'); }
  }
  renderPhotos(); counts();
  say(`사진 ${files.length}장 추가했습니다. 저장을 눌러야 반영됩니다.`);
});

/* ── 기사 · 영상 줄 ───────────────────────────────────────── */
function addArticleRow(a = {}) {
  const row = el('div', 'row');
  const press = el('input'); press.placeholder = '언론사'; press.value = a.press ?? '';
  const title = el('input'); title.placeholder = '기사 제목 (비우면 저장할 때 자동으로 채웁니다)'; title.value = a.title ?? '';
  const url = el('input', 'row__url'); url.placeholder = 'https://…'; url.value = a.url ?? ''; url.type = 'url';
  const rm = el('button', 'row__rm', '×'); rm.type = 'button'; rm.title = '이 기사 빼기';
  rm.addEventListener('click', () => { row.remove(); counts(); });

  row.append(press, title, rm, url);
  row.dataset.kind = a.kind ?? '';
  $('articles').append(row);
  counts();
}

function addVideoRow(v = {}) {
  const row = el('div', 'row');
  const press = el('input'); press.placeholder = '채널·언론사'; press.value = v.press ?? '';
  const url = el('input'); url.placeholder = 'https://…'; url.value = v.url ?? ''; url.type = 'url';
  const rm = el('button', 'row__rm', '×'); rm.type = 'button'; rm.title = '이 영상 빼기';
  rm.addEventListener('click', () => { row.remove(); counts(); });
  const marks = el('textarea');
  marks.rows = 2;
  marks.placeholder = '등장 구간 메모 — 한 줄에 하나씩 (예: 25:10~ 대표이사 등장)';
  marks.value = (v.marks ?? []).join('\n');

  row.append(press, url, rm, marks);
  $('videos').append(row);
  counts();
}

$('addArticle').addEventListener('click', () => addArticleRow());
$('addVideo').addEventListener('click', () => addVideoRow());

/* ── 저장 ─────────────────────────────────────────────────── */
function collect() {
  const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  // 줄 안의 입력칸 순서: 언론사 · 제목 · 주소 (삭제는 button 이라 잡히지 않는다)
  const articles = [...$('articles').children].map((r) => {
    const [press, title, url] = r.querySelectorAll('input');
    return { press: press.value.trim(), title: title.value.trim() || undefined, url: url.value.trim(), kind: r.dataset.kind || undefined };
  }).filter((a) => a.url);
  const videos = [...$('videos').children].map((r) => {
    const [press, url] = r.querySelectorAll('input');
    return { press: press.value.trim(), url: url.value.trim(), marks: lines(r.querySelector('textarea').value) };
  }).filter((v) => v.url);

  return {
    id: state.id,
    category: $('fCategory').value,
    type: $('fType').value.trim(),
    date: $('fDate').value,
    title: $('fTitle').value.trim(),
    subtitle: $('fSubtitle').value.trim() || undefined,
    place: $('fPlace').value.trim() || undefined,
    host: $('fHost').value.trim() || undefined,
    attendees: $('fAttendees').value.trim() || undefined,
    summary: $('fSummary').value.trim() || undefined,
    notes: lines($('fNotes').value),
    articles, videos,
  };
}

function validate(ev) {
  const bad = [];
  const mark = (id, ok) => { $(id).setAttribute('aria-invalid', String(!ok)); return ok; };
  if (!mark('fTitle', !!ev.title)) bad.push('행사명');
  if (!mark('fType', !!ev.type)) bad.push('행사구분');
  if (!mark('fDate', /^\d{4}-\d{2}-\d{2}$/.test(ev.date))) bad.push('일시');
  return bad;
}

/** 로그인이 만료됐을 때 다시 로그인으로 보낸다 */
const relogin = () => {
  location.href = `/api/auth/login?next=${encodeURIComponent(location.pathname + location.hash)}`;
};

/* 토큰 갱신은 /api/archive 한 곳에서만 한다. 401 이 오면 그 경로를 한 번 부르고
   같은 요청을 다시 보낸다. 여러 곳에서 동시에 갱신하면 Keycloak 이 재사용으로
   보고 세션을 끊기 때문이다. */
async function post(path, body, retried = false) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));

  if (res.status === 401 && !retried) {
    const renewed = await fetch('/api/archive', { headers: { accept: 'application/json' } })
      .then((r) => r.ok).catch(() => false);
    if (renewed) return post(path, body, true);
    relogin();
  }
  if (!res.ok) { const e = new Error(out.error || `저장하지 못했습니다 (${res.status})`); e.status = res.status; throw e; }
  return out;
}

$('save').addEventListener('click', async () => {
  let ev;
  try {
    ev = collect();
  } catch (e) {
    return say(`입력한 내용을 읽지 못했습니다: ${e.message}`, 'bad');
  }
  const bad = validate(ev);
  if (bad.length) return say(`${bad.join(', ')} 을(를) 입력해 주세요.`, 'bad');

  $('save').disabled = true; $('del').disabled = true;
  try {
    /* 1) 새 사진을 나눠서 올린다 (요청 크기 한도 때문) */
    const fresh = state.photos.filter((p) => p.file);
    if (fresh.length) {
      let batch = [], bytes = 0, done = 0;
      const flush = async () => {
        if (!batch.length) return;
        const r = await post('/api/admin/photos', { id: state.id, photos: batch });
        // 올린 사진의 저장 경로를 받아 둔다. 행사 정보를 저장할 때 그대로 돌려보낸다.
        for (const up of r.saved ?? []) {
          const target = state.photos.find((x) => x.name === up.name);
          if (target) { target.src = up.src; target.thumb = up.thumb; }
        }
        done += batch.length;
        say(`사진 올리는 중… ${done}/${fresh.length}`);
        batch = []; bytes = 0;
      };
      for (const p of fresh) {
        const size = p.file.image.length + p.file.thumb.length;
        if (bytes + size > BATCH_BYTES) await flush();
        batch.push({ name: p.name, image: p.file.image, thumb: p.file.thumb });
        bytes += size;
      }
      await flush();
    }

    /* 2) 행사 정보와 사진 목록을 저장 */
    say('행사 정보 저장 중…');
    const media = {
      photos: state.photos.map(({ name, caption, w, h, taken, orig, src, thumb }) =>
        ({ name, caption, w, h, taken, orig, src, thumb })),
    };
    const r = await post('/api/admin/event', { event: ev, media, removePhotos: state.removed, rev: state.rev });

    state.rev = r.rev;
    state.removed = [];
    state.photos = state.photos.map(({ file, ...p }) => p);
    renderPhotos();

    const s = await loadState();
    state.doc = { events: s.events ?? [] }; state.rev = s.rev;
    renderPicks();
    $('editTitle').textContent = '행사 수정';
    $('del').hidden = false;

    say(r.created ? '등록했습니다. 사이트에 반영되기까지 1~2분 걸립니다.'
                  : '저장했습니다. 사이트에 반영되기까지 1~2분 걸립니다.', 'ok');
  } catch (e) {
    say(e.status === 409
      ? `${e.message}\n(새로 고치면 다른 사람이 저장한 내용이 보입니다)`
      : e.message, 'bad');
  } finally {
    $('save').disabled = false; $('del').disabled = false;
  }
});

/* ── 삭제 ─────────────────────────────────────────────────── */
const sheet = $('sheet');
let onYes = null;
const ask = (title, body, fn) => {
  $('sheetTitle').textContent = title;
  $('sheetBody').textContent = body;
  onYes = fn;
  sheet.hidden = false;
  $('sheetNo').focus();
};
$('sheetNo').addEventListener('click', () => { sheet.hidden = true; onYes = null; });
sheet.addEventListener('click', (e) => { if (e.target === sheet) { sheet.hidden = true; onYes = null; } });
$('sheetYes').addEventListener('click', async () => { sheet.hidden = true; await onYes?.(); });

$('del').addEventListener('click', () => {
  const ev = state.doc.events.find((e) => e.id === state.id);
  if (!ev) return;
  ask('이 행사를 삭제할까요?',
    `${ev.title}\n\n사진 ${state.photos.length}장과 기사 자료가 함께 지워집니다.\n저장소 이력에는 남아 있어 필요하면 되살릴 수 있습니다.`,
    async () => {
      $('save').disabled = true; $('del').disabled = true;
      try {
        await post('/api/admin/delete', { id: state.id, title: ev.title, rev: state.rev });
        const s = await loadState();
        state.doc = { events: s.events ?? [] }; state.rev = s.rev; state.id = null;
        renderPicks();
        $('edit').hidden = true; $('blank').hidden = false;
        say('');
      } catch (e) { say(e.message, 'bad'); }
      finally { $('save').disabled = false; $('del').disabled = false; }
    });
});

$('newEvent').addEventListener('click', newEvent);

window.addEventListener('beforeunload', (e) => {
  if (state.photos.some((p) => p.file) || state.dirtyNew) { e.preventDefault(); e.returnValue = ''; }
});

boot();
})();
