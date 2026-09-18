/**
 * GET /api/media?p=<경로> — Blob 에 보관한 사진·묶음을 내보낸다
 *
 * Blob 을 private 으로 넣기 때문에 공개 주소가 없다. 그래서 이 경로를 거쳐 내보낸다.
 * 미들웨어가 앞에서 로그인을 확인하므로, 주소를 알아도 로그인 없이는 못 받는다.
 *
 * 저장소에 함께 배포된 기존 자료(photos/e01/... 같은 정적 파일)는 여기를 타지 않고
 * CDN 이 바로 내보낸다. 이 경로는 화면에서 새로 올린 자료만 다룬다.
 */
import { getFile } from '../lib/store.js';

// 내보낼 수 있는 폴더를 못 박는다. 행사 문서(archive.json)나 다른 경로는 막는다.
const ALLOWED = [/^photos\//, /^thumbs\//, /^bundles\//];

const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', zip: 'application/zip', mp4: 'video/mp4' };

export default async function handler(req) {
  const p = new URL(req.url).searchParams.get('p') ?? '';

  if (p.includes('..') || !ALLOWED.some((re) => re.test(p))) {
    return new Response('잘못된 경로입니다.', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  let file;
  try { file = await getFile(p); }
  catch (e) {
    return new Response(`자료를 읽지 못했습니다: ${e.message}`, {
      status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  if (!file) {
    return new Response('자료를 찾을 수 없습니다.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  const name = decodeURIComponent(p.split('/').pop() ?? 'file');
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const headers = new Headers({
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    // 로그인한 사람의 브라우저에만 남게 한다. 공용 캐시에는 담지 않는다.
    'cache-control': 'private, max-age=86400',
  });
  if (ext === 'zip') {
    headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  }
  const len = file.headers?.['content-length'] ?? file.blob?.size;
  if (len) headers.set('content-length', String(len));

  return new Response(file.stream, { status: 200, headers });
}
