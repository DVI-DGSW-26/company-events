/**
 * build.mjs — 행사 아카이브 정적 사이트 빌드
 *
 *   data/events.json  +  source/**  ──▶  photos/ thumbs/ articles/ videos/ downloads/ assets/data.js
 *
 * 행사마다 사진의 출처가 둘 중 하나다.
 *   · source/ 에 촬영 원본이 있는 행사  → 원본에서 웹용·썸네일을 다시 만든다
 *   · 화면에서 등록한 행사             → photos/ 가 곧 원본이다. 그대로 두고 목록만 다시 만든다
 * 그래서 산출물 폴더를 통째로 지우지 않고 행사 단위로만 다시 만든다.
 *
 * 사진 설명·촬영일 같은 정보는 data/media/<행사ID>.json 에 남겨 둔다.
 * 원본이 없는 환경(GitHub Actions 등)에서 다시 빌드해도 설명이 사라지지 않게 하기 위해서다.
 *
 * 실행:  npm run build
 */
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { writeZip } from './zip.mjs';

const ROOT = path.resolve('..');
const P = (...a) => path.join(ROOT, ...a);

const WEB_MAX = 1920;   // 웹용 사진 긴 변 최대 픽셀
const WEB_Q = 88;       // 웹용 사진 품질
const THUMB = 420;      // 썸네일 긴 변
const THUMB_Q = 76;

const IMG = /\.(jpe?g|png|webp|gif|bmp)$/i;
const VID = /\.(mp4|mov|avi|mkv|webm)$/i;

const data = JSON.parse(fs.readFileSync(P('data', 'events.json'), 'utf8'));
const log = (...a) => console.log(...a);
const kb = (n) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

for (const d of ['photos', 'thumbs', 'articles', 'videos', 'assets', path.join('data', 'media')]) {
  fs.mkdirSync(P(d), { recursive: true });
}
// 패키지는 항상 다시 만든다 (행사명이 바뀌면 파일명도 바뀌므로 묵은 파일이 남지 않게)
fs.rmSync(P('downloads'), { recursive: true, force: true });
fs.mkdirSync(P('downloads'), { recursive: true });

/* ── 유틸 ─────────────────────────────────────────────────── */
const slug = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_').trim();
const readJson = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback);

/** 파일명에서 사람이 읽을 캡션을 만든다. `엑셀12_설명.png` → `설명` */
function captionOf(file) {
  const base = file.replace(/\.[^.]+$/, '');
  const m = /^엑셀\d+_(.+)$/.exec(base);
  if (m) return m[1];
  if (/^KakaoTalk_\d/.test(base)) return '';
  if (/^\d{8}_\d{6}/.test(base)) return '';
  if (/^Screenshot_\d+_(\w+)/.test(base)) return `${RegExp.$1} 영상 화면`;
  return base;
}

/** EXIF 촬영일 (yyyy-mm-dd) */
function takenOf(exifBuf) {
  if (!exifBuf) return null;
  const m = /(20\d\d)[:\-](\d\d)[:\-](\d\d) (\d\d):(\d\d)/.exec(exifBuf.toString('latin1'));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** 원본 → 웹용 + 썸네일. 원본보다 커지지 않게 withoutEnlargement */
async function derive(srcFile, outWeb, outThumb) {
  const pipe = sharp(srcFile, { failOn: 'none' }).rotate();
  const meta = await pipe.metadata();
  await pipe.clone()
    .resize({ width: WEB_MAX, height: WEB_MAX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: WEB_Q, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(outWeb);
  await pipe.clone()
    .resize({ width: THUMB, height: THUMB, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMB_Q, mozjpeg: true })
    .toFile(outThumb);
  const w = await sharp(outWeb).metadata();
  return { w: w.width, h: w.height, taken: takenOf(meta.exif) };
}

/* ZIP 은 tools/zip.mjs 가 직접 만든다 — OS 에 상관없이 같은 결과가 나온다 */

/* ── 이벤트 처리 ──────────────────────────────────────────── */
const out = [];
const stage = P('.build-tmp');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

for (const ev of data.events) {
  const srcDir = ev.folder ? P('source', ev.folder) : null;
  const hasSource = Boolean(srcDir && fs.existsSync(srcDir));
  const manifestFile = P('data', 'media', `${ev.id}.json`);

  for (const d of ['photos', 'thumbs', 'articles', 'videos']) fs.mkdirSync(P(d, ev.id), { recursive: true });

  let photos = [];
  let videoFiles = [];

  if (hasSource) {
    /* 촬영 원본이 있는 행사 — 웹용·썸네일을 다시 만든다 */
    for (const d of ['photos', 'thumbs', 'videos']) {
      fs.rmSync(P(d, ev.id), { recursive: true, force: true });
      fs.mkdirSync(P(d, ev.id), { recursive: true });
    }

    const entries = fs.readdirSync(srcDir).filter((f) => fs.statSync(path.join(srcDir, f)).isFile());
    const imgFiles = entries.filter((f) => IMG.test(f)).sort((a, b) => a.localeCompare(b, 'ko'));
    const vidFiles = entries.filter((f) => VID.test(f)).sort((a, b) => a.localeCompare(b, 'ko'));

    let i = 0;
    for (const f of imgFiles) {
      i++;
      const name = `${String(i).padStart(3, '0')}_${slug(f.replace(/\.[^.]+$/, ''))}.jpg`;
      const { w, h, taken } = await derive(path.join(srcDir, f), P('photos', ev.id, name), P('thumbs', ev.id, name));
      photos.push({ name, caption: captionOf(f), orig: f, w, h, taken });
    }

    for (const f of vidFiles) {
      const name = slug(f);
      fs.copyFileSync(path.join(srcDir, f), P('videos', ev.id, name));
      videoFiles.push({ name, size: fs.statSync(path.join(srcDir, f)).size });
    }

    // 화면에서 붙인 설명이 있으면 살린다 (원본 파일명으로 맞춘다)
    const prev = readJson(manifestFile, { photos: [] });
    const byOrig = new Map((prev.photos ?? []).map((p) => [p.orig ?? p.name, p]));
    photos = photos.map((p) => {
      const old = byOrig.get(p.orig);
      return old?.captionEdited ? { ...p, caption: old.caption, captionEdited: true } : p;
    });

    fs.writeFileSync(manifestFile, JSON.stringify({ photos, videos: videoFiles }, null, 1), 'utf8');
  } else {
    /* 화면에서 등록한 행사 — photos/ 가 곧 원본이다 */
    const manifest = readJson(manifestFile, { photos: [], videos: [] });
    const onDisk = new Set(fs.readdirSync(P('photos', ev.id)).filter((f) => IMG.test(f)));

    // 목록에 있는 것 중 실제로 파일이 있는 것만 남긴다 (삭제된 사진 정리)
    photos = (manifest.photos ?? []).filter((p) => onDisk.has(p.name));
    for (const p of photos) onDisk.delete(p.name);
    // 목록에 없는데 파일만 있으면 뒤에 붙인다
    for (const name of [...onDisk].sort((a, b) => a.localeCompare(b, 'ko'))) {
      photos.push({ name, caption: '', orig: name, w: 0, h: 0, taken: null });
    }
    // 치수가 비어 있으면 읽어서 채운다
    for (const p of photos) {
      if (p.w && p.h) continue;
      try {
        const md = await sharp(P('photos', ev.id, p.name)).metadata();
        p.w = md.width; p.h = md.height;
      } catch { p.w ||= 0; p.h ||= 0; }
    }

    const vidOnDisk = fs.readdirSync(P('videos', ev.id)).filter((f) => VID.test(f));
    videoFiles = vidOnDisk.map((name) => ({ name, size: fs.statSync(P('videos', ev.id, name)).size }));

    fs.writeFileSync(manifestFile, JSON.stringify({ photos, videos: videoFiles }, null, 1), 'utf8');
  }

  /* 화면이 쓸 형태로 부풀린다 */
  const photoRecords = photos.map((p) => ({
    src: `photos/${ev.id}/${p.name}`,
    thumb: `thumbs/${ev.id}/${p.name}`,
    w: p.w, h: p.h, taken: p.taken ?? null,
    name: p.name,
    caption: p.caption ?? '',
    orig: p.orig ?? p.name,
    size: fs.existsSync(P('photos', ev.id, p.name)) ? fs.statSync(P('photos', ev.id, p.name)).size : 0,
  }));
  const videoRecords = videoFiles.map((v) => ({ src: `videos/${ev.id}/${v.name}`, name: v.name, size: v.size }));

  /* 기사: 캡처 이미지 + PDF 연결 */
  const capDir = P('source', '_기사캡처', ev.id);
  const pdfDir = P('articles-pdf', ev.id);
  const articles = [];
  const keepArticleFiles = new Set();

  for (const a of ev.articles ?? []) {
    const rec = { ...a };

    if (a.capture) {
      const name = slug(a.capture);
      const inSource = path.join(capDir, a.capture);
      const already = P('articles', ev.id, name);
      const from = fs.existsSync(inSource) ? inSource : (fs.existsSync(already) ? already : null);
      if (from) {
        if (from !== already) fs.copyFileSync(from, already);
        const tName = `${name.replace(/\.[^.]+$/, '')}_thumb.jpg`;
        if (!fs.existsSync(P('articles', ev.id, tName))) {
          await sharp(already).resize({ width: THUMB, height: THUMB, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: THUMB_Q, mozjpeg: true }).toFile(P('articles', ev.id, tName));
        }
        const md = await sharp(already).metadata();
        rec.capture = {
          src: `articles/${ev.id}/${name}`, thumb: `articles/${ev.id}/${tName}`,
          w: md.width, h: md.height, size: fs.statSync(already).size,
        };
        keepArticleFiles.add(name); keepArticleFiles.add(tName);
      } else delete rec.capture;
    } else delete rec.capture;

    const pdfName = `${slug(a.press)}_${slug(a.title ?? a.press)}.pdf`;
    const pdfStaged = path.join(pdfDir, pdfName);
    const pdfHere = P('articles', ev.id, pdfName);
    if (fs.existsSync(pdfStaged)) fs.copyFileSync(pdfStaged, pdfHere);
    if (fs.existsSync(pdfHere)) {
      rec.pdf = { src: `articles/${ev.id}/${pdfName}`, size: fs.statSync(pdfHere).size };
      keepArticleFiles.add(pdfName);
    }
    articles.push(rec);
  }

  // 목록에서 빠진 기사의 파일은 정리한다
  for (const f of fs.readdirSync(P('articles', ev.id))) {
    if (!keepArticleFiles.has(f)) fs.rmSync(P('articles', ev.id, f), { force: true });
  }

  /* 행사별 전체 패키지 ZIP */
  const packName = `${ev.date.replace(/-/g, '')}_${slug(ev.title)}`;
  const info = path.join(stage, `${ev.id}_행사정보.txt`);
  fs.writeFileSync(info, infoText(ev, photoRecords, articles), 'utf8');

  const zipEntries = [
    { from: info, name: '행사정보.txt' },
    // 촬영 원본이 아니라 웹용(긴 변 1920px) 사진을 넣는다. 원본 그대로면 패키지가
    // 590MB 라 저장소·배포 용량 한도를 넘는다.
    ...photoRecords.map((p) => ({ from: P(p.src), name: `사진/${p.name}` })),
    ...videoRecords.map((v) => ({ from: P(v.src), name: `영상/${v.name}` })),
    ...[...keepArticleFiles].filter((f) => !f.endsWith('_thumb.jpg'))
      .map((f) => ({ from: P('articles', ev.id, f), name: `언론기사/${f}` })),
  ].filter((e) => fs.existsSync(e.from));

  const zipPath = P('downloads', `${packName}.zip`);
  const zipSize = writeZip(zipEntries, zipPath);

  out.push({
    id: ev.id, category: ev.category, type: ev.type, date: ev.date,
    title: ev.title, subtitle: ev.subtitle, place: ev.place, host: ev.host,
    attendees: ev.attendees, summary: ev.summary, notes: ev.notes ?? [],
    photos: photoRecords, videoFiles: videoRecords, articles, videos: ev.videos ?? [],
    bundle: { src: `downloads/${packName}.zip`, name: `${packName}.zip`, size: zipSize },
  });

  log(`${ev.id}  ${ev.date}  ${ev.title}${hasSource ? '' : '   (화면 등록)'}`);
  log(`      사진 ${photoRecords.length}  기사 ${articles.length}  영상링크 ${(ev.videos ?? []).length}  영상파일 ${videoRecords.length}  패키지 ${kb(zipSize)}`);
}

/* 목록에서 사라진 행사의 산출물 정리 */
const liveIds = new Set(data.events.map((e) => e.id));
for (const d of ['photos', 'thumbs', 'articles', 'videos']) {
  for (const dir of fs.readdirSync(P(d))) {
    if (!liveIds.has(dir)) fs.rmSync(P(d, dir), { recursive: true, force: true });
  }
}
for (const f of fs.readdirSync(P('data', 'media'))) {
  if (!liveIds.has(f.replace(/\.json$/, ''))) fs.rmSync(P('data', 'media', f), { force: true });
}

fs.rmSync(stage, { recursive: true, force: true });

/** ZIP 안에 넣을 행사 요약 텍스트 */
function infoText(ev, photos, articles) {
  const L = [];
  L.push(`${ev.title}`);
  L.push('='.repeat(60));
  L.push(`일시      ${ev.date}`);
  L.push(`구분      ${ev.category} / ${ev.type}`);
  if (ev.place) L.push(`장소      ${ev.place}`);
  if (ev.host) L.push(`주관      ${ev.host}`);
  if (ev.attendees) L.push(`참석      ${ev.attendees}`);
  L.push('');
  if (ev.summary) { L.push('[행사 개요]'); L.push(ev.summary); L.push(''); }
  if (ev.notes?.length) { L.push('[참고 사항]'); ev.notes.forEach((n) => L.push(` - ${n}`)); L.push(''); }
  if (articles.length) {
    L.push('[언론기사 · 보도자료]');
    articles.forEach((a) => {
      L.push(` - ${a.press}${a.title ? ` : ${a.title}` : ''}`);
      L.push(`   ${a.url}`);
      if (a.pdf) L.push(`   PDF: 언론기사/${path.basename(a.pdf.src)}`);
      if (a.capture) L.push(`   캡처: 언론기사/${path.basename(a.capture.src)}`);
    });
    L.push('');
  }
  if (ev.videos?.length) {
    L.push('[영상]');
    ev.videos.forEach((v) => {
      L.push(` - ${v.press}  ${v.url}`);
      (v.marks ?? []).forEach((m) => L.push(`   · ${m}`));
    });
    L.push('');
  }
  L.push(`[사진] 총 ${photos.length}장  ('사진' 폴더, 긴 변 최대 ${WEB_MAX}px)`);
  L.push(`   인쇄·제출용으로 충분한 크기입니다. 촬영 원본이 필요하면 공유드라이브의 행사 사진 폴더를 쓰세요.`);
  photos.forEach((p) => L.push(` - ${p.name}${p.caption ? `  (${p.caption})` : ''}${p.taken ? `  촬영 ${p.taken}` : ''}`));
  L.push('');
  L.push(`생성 ${new Date().toLocaleString('ko-KR')} · ${data.회사명} 행사 아카이브`);
  return L.join('\r\n');
}

/* ── data.js ─────────────────────────────────────────────── */
const payload = {
  company: data.회사명,
  generatedAt: new Date().toISOString(),
  events: out.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
};
fs.writeFileSync(P('assets', 'data.js'),
  `/* 자동 생성 파일 — 직접 수정하지 마세요. data/events.json 을 고치고 npm run build 를 실행하세요. */\nwindow.ARCHIVE = ${JSON.stringify(payload, null, 1)};\n`,
  'utf8');

const tot = (f) => out.reduce((s, e) => s + f(e), 0);
log('\n─────────────────────────────────────────────');
log(`행사 ${out.length}건 · 사진 ${tot((e) => e.photos.length)}장 · 기사 ${tot((e) => e.articles.length)}건 · 영상 ${tot((e) => e.videos.length + e.videoFiles.length)}건`);
log(`assets/data.js  ${kb(fs.statSync(P('assets', 'data.js')).size)}`);
log(`다운로드 패키지 합계  ${kb(tot((e) => e.bundle.size))}`);
