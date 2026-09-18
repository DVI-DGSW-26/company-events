/**
 * github.js — 저장소에 파일을 커밋한다
 *
 * 화면에서 고친 내용을 GitHub 에 그대로 반영하고, 그 push 가 빌드와 배포를 부른다.
 * 별도 DB 없이 저장소가 원본이 되고, 누가 언제 무엇을 고쳤는지 이력이 남는다.
 *
 * 여러 파일을 한 번에 바꿀 때 파일마다 커밋하면 중간 상태가 배포될 수 있어서,
 * Git Data API 로 트리를 만들어 커밋 하나로 묶는다.
 *
 * 필요한 환경변수
 *   GH_TOKEN   contents:write 권한이 있는 토큰
 *   GH_REPO    예: DVI-DGSW-26/company-events
 *   GH_BRANCH  기본 main
 */

const API = 'https://api.github.com';

function cfg() {
  const token = process.env.GH_TOKEN;
  const repo = process.env.GH_REPO;
  const branch = process.env.GH_BRANCH || 'main';
  if (!token || !repo) {
    const missing = [!token && 'GH_TOKEN', !repo && 'GH_REPO'].filter(Boolean).join(', ');
    throw new Error(`환경변수가 설정되지 않았습니다: ${missing}`);
  }
  return { token, repo, branch };
}

async function gh(path, init = {}) {
  const { token } = cfg();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
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
