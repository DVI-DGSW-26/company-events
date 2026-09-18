/**
 * github.js — 저장소에 파일을 커밋한다
 *
 * 화면에서 고친 내용을 GitHub 에 그대로 반영하고, 그 push 가 빌드와 배포를 부른다.
 * 별도 DB 없이 저장소가 원본이 되고, 누가 언제 무엇을 고쳤는지 이력이 남는다.
 *
 * 여러 파일을 한 번에 바꿀 때 파일마다 커밋하면 중간 상태가 배포될 수 있어서,
 * Git Data API 로 트리를 만들어 커밋 하나로 묶는다.
 *
 * ── 인증 ────────────────────────────────────────────────────
 * GitHub App 으로 인증한다. 개인 토큰을 쓰면 그 사람이 조직에서 빠지는 순간
 * 저장 기능이 멈추기 때문이다. App 은 조직이 소유하므로 담당자가 바뀌어도 살아 있고,
 * 긴 수명의 토큰을 보관하지 않고 요청할 때마다 1시간짜리를 새로 받는다.
 *
 *   GH_REPO              예: DVI-DGSW-26/company-events
 *   GH_APP_ID            App 설정 화면의 App ID
 *   GH_APP_PRIVATE_KEY   App 에서 내려받은 .pem 내용 전체
 *   GH_APP_INSTALLATION_ID  (선택) 없으면 저장소를 보고 알아서 찾는다
 *   GH_BRANCH            (선택) 기본 main
 *
 * 봇 계정 토큰을 쓰는 방식으로 되돌리려면 GH_TOKEN 만 넣으면 된다.
 */

const API = 'https://api.github.com';

function cfg() {
  const repo = process.env.GH_REPO;
  const branch = process.env.GH_BRANCH || 'main';
  const missing = [];
  if (!repo) missing.push('GH_REPO');
  if (!process.env.GH_TOKEN) {
    if (!process.env.GH_APP_ID) missing.push('GH_APP_ID');
    if (!process.env.GH_APP_PRIVATE_KEY) missing.push('GH_APP_PRIVATE_KEY');
  }
  if (missing.length) throw new Error(`환경변수가 설정되지 않았습니다: ${missing.join(', ')}`);
  return { repo, branch };
}

/* ── GitHub App 인증 ─────────────────────────────────────────── */

const b64url = (bytes) => {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** DER 길이 표기 */
function derLen(n) {
  if (n < 0x80) return [n];
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

/**
 * GitHub 이 주는 .pem 은 PKCS#1(`BEGIN RSA PRIVATE KEY`) 인데
 * Web Crypto 는 PKCS#8 만 읽는다. 사용자가 openssl 로 변환하지 않아도 되게
 * PKCS#1 본문을 PKCS#8 껍데기로 감싸 준다.
 */
function toPkcs8(pem) {
  // 형식을 먼저 본다. 잘못된 값이 들어왔을 때 base64 오류가 아니라 무엇이 틀렸는지 알려주기 위해서다.
  const isPkcs8 = /BEGIN PRIVATE KEY/.test(pem);
  const isPkcs1 = /BEGIN RSA PRIVATE KEY/.test(pem);
  if (!isPkcs8 && !isPkcs1) {
    throw new Error('GH_APP_PRIVATE_KEY 형식을 알 수 없습니다. GitHub App 에서 내려받은 .pem 파일 내용을 BEGIN/END 줄까지 그대로 넣어 주세요.');
  }

  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  let bin;
  try { bin = atob(body); }
  catch { throw new Error('GH_APP_PRIVATE_KEY 를 읽지 못했습니다. .pem 내용이 중간에 잘렸는지 확인해 주세요.'); }
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);

  if (isPkcs8) return der;

  const version = [0x02, 0x01, 0x00];
  const algId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLen(der.length), ...der];
  const inner = [...version, ...algId, ...octet];
  return new Uint8Array([0x30, ...derLen(inner.length), ...inner]);
}

/** App 을 증명하는 10분짜리 JWT */
async function appJwt() {
  const pem = process.env.GH_APP_PRIVATE_KEY.replace(/\\n/g, '\n');
  const key = await crypto.subtle.importKey(
    'pkcs8', toPkcs8(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );

  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  // iat 를 조금 앞으로 당긴다 — 서버 시계가 살짝 달라도 거절되지 않게
  const body = b64url(enc.encode(JSON.stringify({
    iat: now - 30, exp: now + 540, iss: process.env.GH_APP_ID,
  })));
  const sig = b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${sig}`;
}

let cached = null;   // { token, exp }  같은 인스턴스에서 재사용

/** 실제 API 호출에 쓸 토큰. App 이면 1시간짜리를 받아 온다. */
async function bearer() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (cached && cached.exp - 120_000 > Date.now()) return cached.token;

  const { repo } = cfg();
  const jwt = await appJwt();
  const head = { authorization: `Bearer ${jwt}`, accept: 'application/vnd.github+json', 'user-agent': 'company-events-archive' };

  let installId = process.env.GH_APP_INSTALLATION_ID;
  if (!installId) {
    // 저장소에 설치된 것을 직접 찾는다 — 설치 번호를 사람이 찾아 넣지 않아도 되게
    const r = await fetch(`${API}/repos/${repo}/installation`, { headers: head });
    if (!r.ok) {
      throw new Error(r.status === 404
        ? `GitHub App 이 ${repo} 저장소에 설치되지 않았습니다. App 설정에서 이 저장소를 추가해 주세요.`
        : `GitHub App 설치 정보를 읽지 못했습니다 (${r.status}). App ID 와 비밀키를 확인해 주세요.`);
    }
    installId = (await r.json()).id;
  }

  const t = await fetch(`${API}/app/installations/${installId}/access_tokens`, { method: 'POST', headers: head });
  if (!t.ok) {
    let why = '';
    try { why = (await t.json()).message ?? ''; } catch { /* 본문 없음 */ }
    throw new Error(`GitHub App 토큰을 받지 못했습니다 (${t.status}${why ? ` · ${why}` : ''}).`);
  }
  const data = await t.json();
  cached = { token: data.token, exp: new Date(data.expires_at).getTime() };
  return cached.token;
}

/* ── API 호출 ────────────────────────────────────────────────── */

async function gh(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${await bearer()}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      'user-agent': 'company-events-archive',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const e = await res.json(); msg += ` ${e.message ?? ''}`; } catch { /* 본문 없음 */ }
    throw new Error(`GitHub 요청 실패 (${msg.trim()})`);
  }
  return res.status === 204 ? null : res.json();
}

/** 지금 브랜치가 가리키는 커밋을 읽는다 */
export async function headCommit() {
  const { repo, branch } = cfg();
  const ref = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const commit = await gh(`/repos/${repo}/git/commits/${ref.object.sha}`);
  return { sha: ref.object.sha, tree: commit.tree.sha };
}

/** 특정 폴더 아래의 파일 경로를 모두 모은다 (행사 삭제 때 쓴다) */
export async function listPaths(prefixes) {
  const { repo } = cfg();
  const base = await headCommit();
  const tree = await gh(`/repos/${repo}/git/trees/${base.tree}?recursive=1`);
  return (tree.tree ?? [])
    .filter((n) => n.type === 'blob' && prefixes.some((p) => n.path === p || n.path.startsWith(`${p}/`)))
    .map((n) => n.path);
}

/** 파일 하나를 읽는다. 없으면 null */
export async function readFile(filePath) {
  const { repo, branch } = cfg();
  try {
    const r = await gh(`/repos/${repo}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`);
    if (Array.isArray(r) || !r.content) return null;
    const bin = atob(r.content.replace(/\n/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { text: new TextDecoder().decode(bytes), sha: r.sha };
  } catch (e) {
    if (String(e.message).includes('404')) return null;
    throw e;
  }
}

/**
 * 파일 여러 개를 커밋 하나로 반영한다.
 *
 * @param {Array<{path:string, text?:string, base64?:string, remove?:boolean}>} files
 * @param {string} message  커밋 메시지
 * @param {{name?:string, email?:string}} author  화면에서 고친 사람
 * @param {string} [expectedHead]  이 커밋 위에서만 반영한다 (동시 수정 충돌 방지)
 */
export async function commitFiles(files, message, author = {}, expectedHead) {
  const { repo, branch } = cfg();
  const base = await headCommit();

  if (expectedHead && expectedHead !== base.sha) {
    const err = new Error('다른 사람이 먼저 저장했습니다. 화면을 새로 고친 뒤 다시 저장해 주세요.');
    err.conflict = true;
    throw err;
  }

  const tree = [];
  for (const f of files) {
    if (f.remove) {
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    // 텍스트는 그대로, 사진 같은 이진 파일은 blob 으로 먼저 올린 뒤 sha 로 붙인다
    if (f.base64 != null) {
      const blob = await gh(`/repos/${repo}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: f.base64, encoding: 'base64' }),
      });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    } else {
      tree.push({ path: f.path, mode: '100644', type: 'blob', content: f.text ?? '' });
    }
  }

  const newTree = await gh(`/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: base.tree, tree }),
  });

  const commit = await gh(`/repos/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      tree: newTree.sha,
      parents: [base.sha],
      author: author.name
        ? { name: author.name, email: author.email || 'noreply@dvi-ind.com', date: new Date().toISOString() }
        : undefined,
    }),
  });

  await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  return { sha: commit.sha, head: base.sha };
}
