/**
 * GET /api/archive — 화면이 읽을 행사 목록
 *
 * EVENTS_API 가 있으면 사내 행사 서버에서 읽고, 없으면 예전 경로(Blob)로 동작한다.
 *
 * Keycloak 토큰 갱신은 여기에서만 한다. Keycloak 이 refresh token 재사용을
 * 탐지하기 때문에, 여러 경로에서 동시에 갱신하면 세션이 끊긴다.
 * 다른 경로는 401 을 돌려주고 화면이 이 경로를 한 번 부르게 한다.
 */
import baseline from '../data/baseline.js';
import { accessToken } from '../lib/keycloak.js';
import { BackendError, call, fail, json, usingBackend } from '../lib/backend.js';
import { mediaUrl, readArchive, writeArchive } from '../lib/store.js';

/** 저장된 형태 → 화면이 쓰는 형태 (Blob 경로일 때만 필요하다) */
function forBrowser(doc) {
  return {
    company: doc.company,
    generatedAt: doc.savedAt ?? doc.generatedAt,
    rev: doc.rev ?? 0,
    events: (doc.events ?? []).map((e) => ({
      ...e,
      photos: (e.photos ?? []).map((p) => ({ ...p, src: mediaUrl(p.src), thumb: mediaUrl(p.thumb) })),
      videoFiles: (e.videoFiles ?? []).map((v) => ({ ...v, src: mediaUrl(v.src) })),
      articles: (e.articles ?? []).map((a) => ({
        ...a,
        pdf: a.pdf ? { ...a.pdf, src: mediaUrl(a.pdf.src) } : undefined,
        capture: a.capture
          ? { ...a.capture, src: mediaUrl(a.capture.src), thumb: mediaUrl(a.capture.thumb) }
          : undefined,
      })),
      bundle: e.bundle ? { ...e.bundle, src: mediaUrl(e.bundle.src) } : undefined,
    })),
  };
}

export default async function handler(req) {
  if (usingBackend()) {
    // 갱신을 허용하는 유일한 지점
    const { token, cookies, expired } = await accessToken(req, true);
    if (!token) {
      return fail(new BackendError('로그인이 만료되었습니다. 다시 로그인해 주세요.', 401), cookies);
    }
    try {
      return json(await call('/event', { token }), 200, cookies);
    } catch (e) {
      // 목록을 못 읽어도 보기·내려받기는 이어갈 수 있게 배포된 자료로 떨어진다.
      // 다만 다시 로그인이 필요한 경우는 화면이 알아야 하므로 그대로 알린다.
      if (e.status === 401 || e.status === 403) return fail(e, cookies);
      return json({ ...baseline, rev: 0, degraded: e.message }, 200, cookies);
    }
  }

  try {
    let doc = await readArchive();
    if (!doc) doc = await writeArchive(baseline);   // 저장소를 만든 직후 한 번
    return json(forBrowser(doc));
  } catch (e) {
    // 저장소가 아직 없어도 목록은 보여야 한다.
    return json({ ...forBrowser(baseline), degraded: e.message }, 200);
  }
}
