/**
 * make-articles.mjs — 언론기사 원문을 PDF 로 보관
 *
 * data/events.json 의 articles[].url 을 헤드리스 브라우저로 열어
 * articles-pdf/<행사ID>/<언론사>_<제목>.pdf 로 저장한다.
 * 기사 제목이 비어 있으면 문서 제목에서 읽어 events.json 에 채워 넣는다.
 *
 * 이미 받아 둔 기사는 건너뛴다(--force 로 재생성).
 * 실행:  npm run articles
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = path.resolve('..');
const P = (...a) => path.join(ROOT, ...a);
const FORCE = process.argv.includes('--force');

/** 윈도우·리눅스 어디서 돌려도 브라우저를 찾도록 한다 (GitHub Actions 포함) */
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/snap/bin/chromium',
].find((p) => p && fs.existsSync(p));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const slug = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_').trim();

const docPath = P('data', 'events.json');
const doc = JSON.parse(fs.readFileSync(docPath, 'utf8'));

const jobs = [];
for (const ev of doc.events)
  for (const a of ev.articles ?? [])
    jobs.push({ eid: ev.id, article: a });

if (!CHROME) {
  console.warn('브라우저를 찾지 못해 기사 PDF 저장을 건너뜁니다.');
  console.warn('CHROME_PATH 환경변수로 경로를 지정할 수 있습니다.');
  process.exit(0);
}
console.log(`대상 기사 ${jobs.length}건  ·  브라우저 ${CHROME}\n`);

/** PDF 안에 Chrome 이 넣어 둔 문서 제목을 읽는다 */
function titleOf(file) {
  const s = fs.readFileSync(file).toString('latin1');
  const hex = /\/Title\s*<([0-9A-Fa-f]+)>/.exec(s);
  if (hex) {
    const b = Buffer.from(hex[1], 'hex');
    const t = b[0] === 0xfe && b[1] === 0xff ? b.slice(2).swap16().toString('utf16le') : b.toString('utf8');
    return t.replace(/\u0000/g, '').trim();
  }
  const plain = /\/Title\s*\(([^)]*)\)/.exec(s);
  return plain ? plain[1].trim() : '';
}

/** 언론사 꼬리표를 떼어 기사 제목만 남긴다 */
function cleanTitle(raw, press) {
  let t = raw.split(/\s[<|｜]\s|\s-\s(?=[^-]*$)/)[0].trim();
  t = t.replace(new RegExp(`\\s*[-|｜<]\\s*${press}\\s*$`), '').trim();
  return t.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').slice(0, 200);
}

const profile = P('.chrome-profile');
const ok = [], fail = [];
let filled = 0;

for (const { eid, article } of jobs) {
  const dir = P('articles-pdf', eid);
  fs.mkdirSync(dir, { recursive: true });

  const name = (t) => `${slug(article.press)}_${slug(t ?? article.press)}.pdf`;
  const already = [path.join(dir, name(article.title)), P('articles', eid, name(article.title))]
    .find((f) => fs.existsSync(f));

  if (already && !FORCE) {
    console.log(`건너뜀  ${article.press} — ${article.title ?? ''}`);
    ok.push(article);
    continue;
  }

  // 제목을 모르는 동안에는 임시 이름으로 받고, 문서 제목을 읽은 뒤 옮긴다
  const tmp = path.join(dir, `.tmp_${slug(article.press)}.pdf`);
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-dev-shm-usage',
    `--user-data-dir=${profile}`, `--user-agent=${UA}`, '--lang=ko-KR', '--hide-scrollbars',
    '--window-size=1280,2000', '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=20000', '--print-to-pdf-no-header', `--print-to-pdf=${tmp}`,
    article.url,
  ];

  process.stdout.write(`생성중  ${article.press} — ${article.title ?? article.url.slice(0, 50)} ... `);
  try {
    await run(CHROME, args, { timeout: 90_000, windowsHide: true });
    const size = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
    if (size < 8 * 1024) { fs.rmSync(tmp, { force: true }); throw new Error(`내용 없음 (${size}B)`); }

    if (!article.title) {
      const found = cleanTitle(titleOf(tmp), article.press);
      if (found) { article.title = found; filled++; }
    }
    const out = path.join(dir, name(article.title));
    fs.rmSync(out, { force: true });
    fs.renameSync(tmp, out);

    console.log(`OK  ${(size / 1024).toFixed(0)} KB${article.title ? `  · ${article.title}` : ''}`);
    ok.push(article);
  } catch (e) {
    console.log(`실패 — ${String(e.message).split('\n')[0]}`);
    fs.rmSync(tmp, { force: true });
    fail.push({ eid, ...article, reason: String(e.message).split('\n')[0] });
  }
}

// Chrome 이 프로필 폴더를 잠시 물고 있을 수 있어 실패해도 넘어간다
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }); } catch {}

if (filled) {
  fs.writeFileSync(docPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  console.log(`\n기사 제목 ${filled}건을 data/events.json 에 채웠습니다.`);
}

console.log('\n─────────────────────────────────────────────');
console.log(`성공 ${ok.length} / 실패 ${fail.length}`);
if (fail.length) {
  console.log('\n실패한 기사 (페이지에서는 원문 링크로 연결됩니다):');
  fail.forEach((f) => console.log(` - [${f.eid}] ${f.press}\n   ${f.url}\n   사유: ${f.reason}`));
}
