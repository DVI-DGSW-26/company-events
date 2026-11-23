/**
 * /api/auth/me — 화면 상단에 표시할 로그인 계정 정보
 *
 * sub 은 내부 식별자라 화면에 내보내지 않는다. 표시용 이름과, 나중에 등록·수정
 * 기능이 생겼을 때 쓸 admin 여부만 돌려준다.
 *
 * 세션 쿠키만 보지 않는다. 로그인 상태는 토큰 갱신이 성공했는지로 판단한다.
 * 갱신은 /api/archive 한 곳에서만 하고(동시에 갱신하면 Keycloak 이 세션을 끊는다),
 * 실패하면 거기서 ev_rt 와 세션을 지운다. 그래서 ev_rt 가 남아 있어야 마지막 갱신이
 * 성공한 것이다. 화면은 /api/archive 를 받은 뒤에 이 경로를 부른다.
 */
import { SESSION_COOKIE, readCookie, verifySession } from '../../lib/session.js';
import { RT_COOKIE, readTokenCookie } from '../../lib/keycloak.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const session = await verifySession(readCookie(req, SESSION_COOKIE), process.env.SESSION_SECRET);
  const json = (body, status) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });

  if (!session || !readTokenCookie(req, RT_COOKIE)) return json({ signedIn: false }, 401);
  return json({
    signedIn: true,
    name: session.name ?? '',
    email: session.email ?? '',
    admin: session.admin === true,
  }, 200);
}
