/**
 * serve.mjs — 행사 아카이브를 로컬 웹서버로 띄운다.
 *
 * index.html 을 파일로 직접 열면 브라우저 정책 때문에 사진·PDF 를 클릭했을 때
 * 저장되지 않고 새 탭에서 열린다. 이 서버로 열면 모든 내려받기가 한 번에 저장된다.
 *
 * 실행:  프로젝트 폴더의 `열기.cmd` 더블클릭  (또는 cd tools && node serve.mjs)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8787;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
};

const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400).end('잘못된 주소'); return; }

  if (rel === '/' || rel === '') rel = '/index.html';

  // 상위 폴더 탈출 차단
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) {
    res.writeHead(403).end('접근할 수 없습니다');
    return;
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('파일을 찾을 수 없습니다'); return; }

    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const range = req.headers.range;

    // 동영상 탐색을 위해 부분 전송을 지원한다
    if (range && /^bytes=\d*-\d*$/.test(range)) {
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = s ? Number(s) : 0;
      const end = e ? Math.min(Number(e), st.size - 1) : st.size - 1;
      res.writeHead(206, {
        'content-type': type,
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${st.size}`,
        'accept-ranges': 'bytes',
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'content-type': type,
      'content-length': st.size,
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n${PORT} 번 포트를 이미 쓰고 있습니다. 브라우저에서 http://localhost:${PORT}/ 를 열어 보세요.`);
    console.error('다른 포트로 열려면:  set PORT=8080 && node serve.mjs\n');
  } else console.error(e);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  행사 아카이브가 열렸습니다.`);
  console.log(`  브라우저에서  http://localhost:${PORT}/  로 접속하세요.`);
  console.log(`\n  이 창을 닫으면 종료됩니다. (Ctrl+C 로도 종료)\n`);
});
