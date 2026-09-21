/**
 * GET /api/health — 지금 어떤 상태로 돌고 있는지 한눈에 보여준다
 *
 * 환경변수가 제대로 들어갔는지, 행사 자료를 어디서 읽고 있는지, 사내 행사 서버와
 * 통신이 되는지를 브라우저에서 바로 확인하기 위한 것이다.
 * 로그인해야 열리고(미들웨어), 값 자체는 내보내지 않는다 — 설정 여부만 알려준다.
 */
import { SESSION_COOKIE, readCookie, verifySession } from '../lib/session.js';
import { AT_COOKIE, RT_COOKIE, isUsable, readTokenCookie } from '../lib/keycloak.js';
import { BASE, usingBackend } from '../lib/backend.js';

const has = (name) => Boolean(process.env[name]);

export default async function handler(req) {
  const session = await verifySession(readCookie(req, SESSION_COOKIE), process.env.SESSION_SECRET);
  const at = readTokenCookie(req, AT_COOKIE);

  const report = {
    확인시각: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),

    행사자료를_읽는_곳: usingBackend()
      ? '사내 행사 서버 (전환 완료)'
      : '배포에 포함된 기준 자료 — EVENTS_API 미설정 (등록·수정 불가)',

    로그인: session
      ? { 상태: '로그인됨', 이름: session.name, 관리권한: session.admin === true }
      : { 상태: '로그인 안 됨' },

    사내계정_토큰: {
      access: at ? (isUsable(at) ? '있음 (유효)' : '있음 (만료 — 다음 요청 때 갱신)') : '없음',
      refresh: readTokenCookie(req, RT_COOKIE) ? '있음' : '없음',
    },

    환경변수: {
      EVENTS_API: has('EVENTS_API') ? `설정됨 — ${BASE}` : '없음',
      OIDC_ISSUER: has('OIDC_ISSUER') ? '설정됨' : '없음',
      OIDC_CLIENT_ID: has('OIDC_CLIENT_ID') ? '설정됨' : '없음',
      OIDC_CLIENT_SECRET: has('OIDC_CLIENT_SECRET') ? '설정됨' : '없음',
      SESSION_SECRET: has('SESSION_SECRET') ? '설정됨' : '없음',
    },
  };

  /* 사내 행사 서버까지 실제로 닿는지 확인한다 */
  if (usingBackend()) {
    try {
      const res = await fetch(`${BASE}/event`, {
        headers: { accept: 'application/json', ...(at ? { authorization: `Bearer ${at}` } : {}) },
      });
      let count = null;
      try {
        const body = await res.json();
        count = body?.data?.events?.length ?? null;
      } catch { /* 본문이 JSON 이 아님 */ }

      report.사내_행사_서버 = res.ok
        ? { 응답: `정상 (${res.status})`, 행사수: count }
        : {
          응답: `거절 (${res.status})`,
          설명: res.status === 401 ? '토큰이 없거나 만료되었습니다. 로그아웃 후 다시 로그인해 보세요.'
            : res.status === 403 ? '권한이 없는 계정입니다.'
              : '서버가 요청을 거절했습니다.',
        };
    } catch (e) {
      report.사내_행사_서버 = { 응답: '연결 실패', 설명: e.message };
    }
  }

  return new Response(JSON.stringify(report, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
