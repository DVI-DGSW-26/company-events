/**
 * build.mjs — 행사 아카이브 정적 사이트 빌드
 *
 *   data/events.json  +  source/**  ──▶  photos/ thumbs/ articles/ videos/ downloads/ assets/data.js
 *
 * 실행:  cd tools && npm run build
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

/* 산출물 폴더 초기화 (source/ 와 data/ 는 건드리지 않는다) */
for (const d of ['photos', 'thumbs', 'articles', 'videos', 'downloads']) {
  fs.rmSync(P(d), { recursive: true, force: true });
  fs.mkdirSync(P(d), { recursive: true });
}
fs.mkdirSync(P('assets'), { recursive: true });

/* ── 유틸 ─────────────────────────────────────────────────── */
const slug = (s) => s.replace(/[\\/:*?"<>|]/g, '_').trim();

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

for (const ev of data.events) {
  const srcDir = P('source', ev.folder);
  if (!fs.existsSync(srcDir)) { console.warn(`!! source 없음: ${ev.folder}`); continue; }

  for (const d of ['photos', 'thumbs', 'articles', 'videos']) fs.mkdirSync(P(d, ev.id), { recursive: true });

  const entries = fs.readdirSync(srcDir).filter((f) => fs.statSync(path.join(srcDir, f)).isFile());
  const imgFiles = entries.filter((f) => IMG.test(f)).sort((a, b) => a.localeCompare(b, 'ko'));
  const vidFiles = entries.filter((f) => VID.test(f)).sort((a, b) => a.localeCompare(b, 'ko'));

  /* 사진 */
  const photos = [];
  let i = 0;
  for (const f of imgFiles) {
    i++;
    const n = String(i).padStart(3, '0');
    const name = `${n}_${slug(f.replace(/\.[^.]+$/, ''))}.jpg`;
    const { w, h, taken } = await derive(path.join(srcDir, f), P('photos', ev.id, name), P('thumbs', ev.id, name));
    photos.push({
      src: `photos/${ev.id}/${name}`,
      thumb: `thumbs/${ev.id}/${name}`,
      w, h, taken,
      name,
      caption: captionOf(f),
      orig: f,
      size: fs.statSync(P('photos', ev.id, name)).size,
      origSize: fs.statSync(path.join(srcDir, f)).size,
    });
  }

  /* 영상 파일 */
  const videoFiles = [];
  for (const f of vidFiles) {
    const name = slug(f);
    fs.copyFileSync(path.join(srcDir, f), P('videos', ev.id, name));
    videoFiles.push({ src: `videos/${ev.id}/${name}`, name, size: fs.statSync(path.join(srcDir, f)).size });
  }

  /* 기사: 캡처 이미지 + (미리 생성된) PDF 연결 */
  const capDir = P('source', '_기사캡처', ev.id);
  const pdfDir = P('articles-pdf', ev.id);
  const articles = [];
  for (const a of ev.articles ?? []) {
    const rec = { ...a };

    if (a.capture && fs.existsSync(path.join(capDir, a.capture))) {
      const name = slug(a.capture);
      const from = path.join(capDir, a.capture);
      fs.copyFileSync(from, P('articles', ev.id, name));
      const tName = name.replace(/\.[^.]+$/, '') + '_thumb.jpg';
      const md = await sharp(from).metadata();
      await sharp(from).resize({ width: THUMB, height: THUMB, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: THUMB_Q, mozjpeg: true }).toFile(P('articles', ev.id, tName));
      rec.capture = {
        src: `articles/${ev.id}/${name}`,
        thumb: `articles/${ev.id}/${tName}`,
        w: md.width, h: md.height,
        size: fs.statSync(from).size,
      };
    } else delete rec.capture;

    // make-articles.mjs 가 만들어 둔 PDF 가 있으면 연결
    const pdfName = `${slug(a.press)}_${slug(a.title ?? a.press)}.pdf`;
    if (fs.existsSync(path.join(pdfDir, pdfName))) {
      fs.copyFileSync(path.join(pdfDir, pdfName), P('articles', ev.id, pdfName));
      rec.pdf = { src: `articles/${ev.id}/${pdfName}`, size: fs.statSync(path.join(pdfDir, pdfName)).size };
    }
    articles.push(rec);
  }

  /* 행사별 전체 패키지 ZIP (원본사진 + 기사PDF/캡처 + 영상 + 행사정보.txt) */
  const packName = `${ev.date.replace(/-/g, '')}_${slug(ev.title)}`;

  const info = path.join(stage, `${ev.id}_행사정보.txt`);
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(info, infoText(ev, photos, articles), 'utf8');

  const artFiles = fs.readdirSync(P('articles', ev.id)).filter((f) => !f.endsWith('_thumb.jpg'));
  const zipEntries = [
    { from: info, name: '행사정보.txt' },
    // 촬영 원본이 아니라 웹용(긴 변 1920px) 사진을 넣는다. 원본 그대로면 패키지가
    // 590MB 라 저장소·배포 용량 한도를 넘는다. 원본은 source/ 와 공유드라이브에 남아 있다.
    ...photos.map((p) => ({ from: P(p.src), name: `사진/${p.name}` })),
    ...vidFiles.map((f) => ({ from: path.join(srcDir, f), name: `영상/${f}` })),
    ...artFiles.map((f) => ({ from: P('articles', ev.id, f), name: `언론기사/${f}` })),
  ];

  const zipPath = P('downloads', `${packName}.zip`);
  const zipSize = writeZip(zipEntries, zipPath);
  const bundle = { src: `downloads/${packName}.zip`, name: `${packName}.zip`, size: zipSize };

  out.push({
    id: ev.id, category: ev.category, type: ev.type, date: ev.date,
    title: ev.title, subtitle: ev.subtitle, place: ev.place, host: ev.host,
    attendees: ev.attendees, summary: ev.summary, notes: ev.notes ?? [],
    photos, videoFiles, articles, videos: ev.videos ?? [], bundle,
  });

  log(`${ev.id}  ${ev.date}  ${ev.title}`);
  log(`      사진 ${photos.length}  기사 ${articles.length}  영상링크 ${(ev.videos ?? []).length}  영상파일 ${videoFiles.length}  패키지 ${kb(bundle.size)}`);
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
