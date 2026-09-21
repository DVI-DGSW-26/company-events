/**
 * GET /api/archive — 화면이 읽을 행사 목록
 *
 * 사내 행사 서버(EVENTS_API)에서 읽는다. 읽지 못하면 배포에 포함된 기준 자료로
 * 떨어져 보기·내려받기는 이어갈 수 있게 한다.
 *
 * Keycloak 토큰 갱신은 여기에서만 한다. Keycloak 이 refresh token 재사용을
 * 탐지하기 때문에, 여러 경로에서 동시에 갱신하면 세션이 끊긴다.
 * 다른 경로는 401 을 돌려주고 화면이 이 경로를 한 번 부르게 한다.
 */
import baseline from '../data/baseline.js';
import { accessToken } from '../lib/keycloak.js';
import { BackendError, call, fail, json, usingBackend } from '../lib/backend.js';

export default async function handler(req) {
  if (!usingBackend()) {
    // 아직 연결 전. 목록은 보여 주되 등록·수정은 막힌다(각 경로에서 503 으로 안내).
    return json({ ...baseline, rev: 0, degraded: '환경변수가 설정되지 않았습니다: EVENTS_API' });
  }

  // 갱신을 허용하는 유일한 지점
  const { token, cookies } = await accessToken(req, true);
  if (!token) {
    return fail(new BackendError('로그인이 만료되었습니다. 다시 로그인해 주세요.', 401), cookies);
  }

  try {
    return json(await call('/event', { token }), 200, cookies);
  } catch (e) {
    // 다시 로그인해야 하는 경우는 화면이 알아야 하므로 그대로 알린다.
    if (e.status === 401 || e.status === 403) return fail(e, cookies);
    // 그 밖의 장애는 기준 자료로 떨어져 보기·내려받기를 이어간다.
    return json({ ...baseline, rev: 0, degraded: e.message }, 200, cookies);
  }
}
