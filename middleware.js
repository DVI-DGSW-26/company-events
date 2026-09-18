/**
 * middleware.js — 로그인하지 않은 접근을 전부 막는다.
 *
 * 사진·기사 PDF·ZIP 은 정적 파일이라 CDN 이 바로 내보낸다. 그래서 화면만 가려서는
 * 주소를 아는 사람이 파일을 직접 받을 수 있다. 미들웨어로 모든 경로를 검사한다.
 *
 * 통과시키는 경로는 로그인에 필요한 것뿐이다: /login.html, /api/auth/*
 */
import { next } from '@vercel/edge';
import { SESSION_COOKIE, readCookie, verifySession } from './lib/session.js';

export const config = {
  // 로그인 화면과 인증 API, Vercel 내부 경로만 제외하고 전부 검사한다
  matcher: ['/((?!api/auth|login\\.html|_vercel|favicon\\.ico).*)'],
};

export default async function middleware(req) {
  const session = await verifySession(readCookie(req, SESSION_COOKIE), process.env.SESSION_SECRET);
  const url = new URL(req.url);

  if (session) {
    // 편집 화면은 권한 있는 사람만 연다. (API 쪽에서도 다시 확인한다 —
    // 화면을 막는 것만으로는 주소를 직접 부르는 것을 못 막기 때문이다)
    if (url.pathname === '/admin.html' && session.admin !== true) {
      return new Response(null, { status: 302, headers: { Location: '/?권한없음=1' } });
    }
    return next();
  }

  const login = new URL('/login.html', url.origin);
  login.searchParams.set('next', url.pathname + url.search);

  // 페이지가 아니라 파일 요청이면 리다이렉트 대신 401 을 준다.
  // (이미지·다운로드 요청이 로그인 HTML 로 바뀌어 깨져 보이는 것을 막는다)
  const wantsHtml = (req.headers.get('accept') || '').includes('text/html');
  if (!wantsHtml) {
    return new Response('로그인이 필요합니다.', {
      status: 401,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return Response.redirect(login.toString(), 302);
}
