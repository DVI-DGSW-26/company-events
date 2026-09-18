/**
 * make-articles.mjs — 언론기사 원문을 PDF 로 보관
 *
 * data/events.json 의 articles[].url 을 Chrome 헤드리스로 열어
 * articles-pdf/<행사ID>/<언론사>_<제목>.pdf 로 저장한다.
 * 이미 있는 PDF 는 건너뛴다(--force 로 재생성).
 *
 * 실행:  cd tools && npm run articles
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = path.resolve('..');
const P = (...a) => path.join(ROOT, ...a);
const FORCE = process.argv.includes('--force');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));
if (!CHROME) { console.error('Chrome 또는 Edge 를 찾지 못했습니다.'); process.exit(1); }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const slug = (s) => s.replace(/[\\/:*?"<>|]/g, '_').trim();

const data = JSON.parse(fs.readFileSync(P('data', 'events.json'), 'utf8'));
const jobs = [];
for (const ev of data.events)
  for (const a of ev.articles ?? [])
    jobs.push({ eid: ev.id, press: a.press, title: a.title ?? a.press, url: a.url });

console.log(`대상 기사 ${jobs.length}건\n`);

const ok = [], fail = [];
for (const j of jobs) {
  const dir = P('articles-pdf', j.eid);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${slug(j.press)}_${slug(j.title)}.pdf`);

  if (fs.existsSync(out) && !FORCE) {
    console.log(`건너뜀  ${j.press} — ${j.title}`);
    ok.push(j); continue;
  }

  const profile = P('.chrome-profile');
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    `--user-data-dir=${profile}`,
    `--user-agent=${UA}`,
    '--lang=ko-KR',
    '--hide-scrollbars',
    '--window-size=1280,2000',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=20000',
    '--print-to-pdf-no-header',
    `--print-to-pdf=${out}`,
    j.url,
  ];

  process.stdout.write(`생성중  ${j.press} — ${j.title} ... `);
  try {
    await run(CHROME, args, { timeout: 90_000, windowsHide: true });
    const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
    // 8KB 미만이면 차단 페이지이거나 빈 문서일 가능성이 높다
    if (size < 8 * 1024) { fs.rmSync(out, { force: true }); throw new Error(`내용 없음 (${size}B)`); }
    console.log(`OK  ${(size / 1024).toFixed(0)} KB`);
    ok.push(j);
  } catch (e) {
    console.log(`실패 — ${String(e.message).split('\n')[0]}`);
    fs.rmSync(out, { force: true });
    fail.push({ ...j, reason: String(e.message).split('\n')[0] });
  }
}

// Chrome 이 프로필 폴더를 잠시 물고 있을 수 있어 실패해도 넘어간다
try { fs.rmSync(P('.chrome-profile'), { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }); } catch {}

console.log(`\n─────────────────────────────────────────────`);
console.log(`성공 ${ok.length} / 실패 ${fail.length}`);
if (fail.length) {
  console.log('\n실패한 기사 (페이지에서는 원문 링크로 연결됩니다):');
  fail.forEach((f) => console.log(` - [${f.eid}] ${f.press} — ${f.title}\n   ${f.url}\n   사유: ${f.reason}`));
}
