/**
 * GET /api/admin/state — 편집 화면이 읽을 현재 자료
 *
 * rev 도 함께 준다. 저장할 때 그 사이 다른 사람이 고쳤는지 확인하는 데 쓴다.
 * EVENTS_API 가 있으면 사내 행사 서버에서 읽고, 없으면 예전 경로(Blob)로 동작한다.
 */
import { requireAdmin } from '../../lib/admin.js';
import { accessToken } from '../../lib/keycloak.js';
import { call, fail, json, storageMissing, usingBackend } from '../../lib/backend.js';
import baseline from '../../data/baseline.js';
import { mediaUrl, readArchive, writeArchive } from '../../lib/store.js';

export default async function handler(req) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const id = new URL(req.url).searchParams.get('id');

  // 저장할 곳이 아직 정해지지 않았다. 서버 잘못이 아니라 설정 단계라 503 으로 알린다.
  if (storageMissing()) {
    return json({ error: '환경변수가 설정되지 않았습니다: EVENTS_API' }, 503);
  }

  if (usingBackend()) {
    // 토큰 갱신은 /api/archive 에서만 한다. 여기서는 있는 토큰을 그대로 쓴다.
    const { token } = await accessToken(req);
    try {
      return json(await call('/event/state', { token, search: { id } }));
    } catch (e) { return fail(e); }
  }

  try {
    let doc = await readArchive();
    if (!doc) doc = await writeArchive(baseline);

    const body = {
      rev: doc.rev ?? 0,
      user: { name: auth.user.name },
      events: (doc.events ?? []).map(({ photos, videoFiles, bundle, ...e }) => e),
    };

    if (id) {
      const ev = (doc.events ?? []).find((e) => e.id === id);
      body.media = {
        photos: (ev?.photos ?? []).map((p) => ({
          name: p.name, caption: p.caption ?? '', orig: p.orig ?? p.name,
          w: p.w, h: p.h, taken: p.taken ?? null,
          url: mediaUrl(p.src),        // 화면에 바로 띄울 주소
          src: p.src, thumb: p.thumb,  // 저장할 때 그대로 돌려보낼 값
        })),
      };
    }
    return json(body);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
