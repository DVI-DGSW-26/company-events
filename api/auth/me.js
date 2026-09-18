/**
 * /api/auth/me — 화면 상단에 표시할 로그인 계정 정보
 *
 * sub 은 내부 식별자라 화면에 내보내지 않는다. 표시용 이름과, 나중에 등록·수정
 * 기능이 생겼을 때 쓸 admin 여부만 돌려준다.
 */
import { SESSION_COOKIE, readCookie, verifySession } from '../../lib/session.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const session = await verifySession(readCookie(req, SESSION_COOKIE), process.env.SESSION_SECRET);
  const json = (body, status) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });

  if (!session) return json({ signedIn: false }, 401);
  return json({
    signedIn: true,
    name: session.name ?? '',
    email: session.email ?? '',
    admin: session.admin === true,
  }, 200);
}
