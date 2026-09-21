/**
 * check-api.mjs — 배포 전에 API 경로의 흔한 실수를 잡는다
 *
 * Vercel 은 api/ 아래 파일을 기본적으로 Node 런타임으로 돌린다. Node 런타임의
 * 핸들러는 (req, res) 를 Node 객체로 받으므로, 웹 표준 Request/Response 로 짠
 * 코드는 불리는 즉시 터진다(500). 겉보기엔 멀쩡해 배포하고 나서야 알게 된다.
 * 실제로 그 일이 있었기에 검사로 남긴다.
 *
 * 실행:  npm run check
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('..');
const API = path.join(ROOT, 'api');

/** api/ 아래 .js 를 모두 모은다 */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.js') ? [p] : []);
  });
}

const problems = [];
const files = fs.existsSync(API) ? walk(API) : [];

for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const src = fs.readFileSync(file, 'utf8');

  // 이 프로젝트의 핸들러는 모두 웹 표준(Request/Response)으로 짠다. Response 를
  // 헬퍼로 감싸 쓰는 파일도 있어 본문만 훑으면 놓친다. 그래서 전부 edge 를 요구한다.
  // Node 런타임이 꼭 필요한 파일이 생기면 여기 목록에 적는다.
  const NODE_OK = [];

  if (!/runtime:\s*'edge'/.test(src) && !NODE_OK.includes(rel)) {
    problems.push(`${rel}\n    edge 런타임 선언이 없습니다. Node 런타임은 (req,res) 를 Node 객체로 넘겨` +
      `\n    Request/Response 로 짠 핸들러가 불리는 즉시 500 이 납니다.` +
      `\n    해결: 마지막 import 아래에  export const config = { runtime: 'edge' };`);
  }
  if (!/export default/.test(src)) {
    problems.push(`${rel}\n    export default 핸들러가 없습니다.`);
  }
}

/* 지워진 모듈을 아직 참조하는지 */
const sources = [...files, ...(fs.existsSync(path.join(ROOT, 'lib')) ? walk(path.join(ROOT, 'lib')) : [])];
for (const file of sources) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const dir = path.dirname(file);
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/from\s+'(\.[^']+)'/g)) {
    if (!fs.existsSync(path.resolve(dir, m[1]))) {
      problems.push(`${rel}\n    없는 파일을 불러옵니다: ${m[1]}`);
    }
  }
}

if (problems.length) {
  console.error(`API 경로 점검 — 문제 ${problems.length}건\n`);
  problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}\n`));
  process.exit(1);
}

console.log(`API 경로 점검 — 이상 없음 (${files.length}개)`);
