/**
 * store.js — 행사 자료를 Vercel Blob 에 보관한다
 *
 * GitHub 에 커밋하는 방식에서 옮겨 왔다. 저장소에 쓰려면 조직 소유자나 봇 계정의
 * 열쇠가 필요했는데, Vercel 프로젝트는 담당자가 이미 가지고 있어 추가 권한이 필요 없다.
 * Vercel 화면에서 Blob 저장소를 만들면 BLOB_READ_WRITE_TOKEN 이 자동으로 꽂힌다.
 *
 * 보관 형태
 *   archive.json              행사 목록과 사진 설명 (전체 한 문서)
 *   photos/<행사ID>/<파일>     화면용 사진 (긴 변 1920px)
 *   thumbs/<행사ID>/<파일>     썸네일
 *   bundles/<행사ID>.zip       행사 자료 묶음
 *
 * 전부 access: 'private' 로 넣는다. 공개로 두면 주소를 아는 사람이 로그인 없이
 * 사진을 받을 수 있어서, 붙여 둔 로그인이 의미가 없어진다.
 * 브라우저에는 /api/media 를 거쳐 내보낸다.
 */
import { del, get, head, list, put } from '@vercel/blob';

export const DOC = 'archive.json';
const ACCESS = 'private';

export function assertConfigured() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('환경변수가 설정되지 않았습니다: BLOB_READ_WRITE_TOKEN');
  }
}

/* ── 행사 문서 ─────────────────────────────────────────────── */

/**
 * 행사 목록을 읽는다. 아직 만들어지지 않았으면 null.
 * rev 는 저장할 때 다른 사람이 먼저 고쳤는지 보는 데 쓴다.
 */
export async function readArchive() {
  assertConfigured();
  try {
    // 목록은 항상 최신이어야 한다. 캐시를 타면 방금 저장한 내용이 안 보일 수 있다.
    const r = await get(DOC, { access: ACCESS, useCache: false });
    if (!r) return null;
    const text = await new Response(r.stream).text();
    return JSON.parse(text);
  } catch (e) {
    if (/not.?found/i.test(e.message ?? '')) return null;
    throw e;
  }
}

/** 행사 목록을 덮어쓴다 */
export async function writeArchive(doc) {
  assertConfigured();
  const body = JSON.stringify({ ...doc, rev: (doc.rev ?? 0) + 1, savedAt: new Date().toISOString() }, null, 1);
  await put(DOC, body, {
    access: ACCESS,
    contentType: 'application/json; charset=utf-8',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
  return JSON.parse(body);
}

/* ── 파일 ──────────────────────────────────────────────────── */

/** 이진 파일을 넣는다. 같은 경로면 덮어쓴다. */
export async function putFile(pathname, body, contentType) {
  assertConfigured();
  const r = await put(pathname, body, {
    access: ACCESS,
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return { pathname: r.pathname, size: body.length ?? body.size ?? 0 };
}

/** 파일을 내보낸다. 브라우저로 그대로 흘려보낼 수 있는 형태. */
export async function getFile(pathname) {
  assertConfigured();
  try {
    const r = await get(pathname, { access: ACCESS });
    return r ?? null;
  } catch (e) {
    if (/not.?found/i.test(e.message ?? '')) return null;
    throw e;
  }
}

export async function fileInfo(pathname) {
  assertConfigured();
  try { return await head(pathname, { access: ACCESS }); }
  catch { return null; }
}

/** 파일을 지운다. 없는 파일이어도 조용히 넘어간다. */
export async function removeFiles(pathnames) {
  assertConfigured();
  const targets = (Array.isArray(pathnames) ? pathnames : [pathnames]).filter(Boolean);
  if (!targets.length) return 0;
  try { await del(targets, { access: ACCESS }); } catch { /* 이미 없으면 그만 */ }
  return targets.length;
}

/** 특정 폴더 아래의 파일 경로를 모은다 (행사 삭제 때 쓴다) */
export async function listUnder(prefix) {
  assertConfigured();
  const found = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000, access: ACCESS });
    for (const b of page.blobs) found.push(b.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return found;
}

/* ── 경로 규칙 ─────────────────────────────────────────────── */

export const paths = {
  photo: (id, name) => `photos/${id}/${name}`,
  thumb: (id, name) => `thumbs/${id}/${name}`,
  bundle: (id) => `bundles/${id}.zip`,
  eventPrefixes: (id) => [`photos/${id}/`, `thumbs/${id}/`, `bundles/${id}.zip`],
};

/**
 * 화면이 쓸 주소로 바꿔 준다.
 * Blob 이 아니라 저장소에 함께 배포된 파일(기존 12건 자료)은 경로를 그대로 쓴다.
 */
export const mediaUrl = (pathname) =>
  pathname?.startsWith('blob:') ? `/api/media?p=${encodeURIComponent(pathname.slice(5))}` : pathname;

/** 반대 방향 — 저장할 때 Blob 경로임을 표시한다 */
export const blobRef = (pathname) => `blob:${pathname}`;
export const isBlobRef = (s) => typeof s === 'string' && s.startsWith('blob:');
export const refPath = (s) => (isBlobRef(s) ? s.slice(5) : s);
