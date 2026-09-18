/**
 * /api/auth/callback — 사내 통합 로그인 결과 처리
 *
 * 1. 임시 쿠키의 state 와 대조해 요청 위조를 막는다
 * 2. code + code_verifier 를 토큰 엔드포인트에 보내 id_token 을 받는다
 * 3. iss · aud · nonce · exp 를 확인한다
 * 4. ALLOWED_DOMAIN 이 설정돼 있으면 이메일 도메인까지 본다
 * 5. 서명한 세션 쿠키를 심고 원래 보려던 주소로 돌려보낸다
 */
import { SESSION_COOKIE, SESSION_HOURS, buildCookie, readCookie, signSession, verifySession }
  from '../../lib/session.js';
import { AUTH_COOKIE, configError, decodeJwt, discover, htmlError, safePath } from '../../lib/oidc.js';

export const config = { runtime: 'edge' };

const clearAuth = () => buildCookie(AUTH_COOKIE, '', 0);

export default async function handler(req) {
  const url = new URL(req.url);
  const secret = process.env.SESSION_SECRET;
  const issuer = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;   // 공개 클라이언트면 없어도 된다
  const domain = process.env.ALLOWED_DOMAIN;             // 비워 두면 인증된 사내 계정 전부 허용

  if (!secret || !issuer || !clientId) return configError('서버 환경변수가 설정되지 않았습니다.');

  if (url.searchParams.get('error')) {
    const desc = url.searchParams.get('error_description') || url.searchParams.get('error');
    return htmlError('로그인하지 못했습니다', `통합 로그인에서 거절되었습니다. (${desc})`);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const pending = await verifySession(readCookie(req, AUTH_COOKIE), secret);

  if (!code || !state || !pending) {
    return htmlError('로그인하지 못했습니다', '로그인 정보가 없거나 만료되었습니다. 처음부터 다시 시도해 주세요.');
  }
  if (pending.state !== state) {
    return htmlError('로그인하지 못했습니다', '로그인 요청이 유효하지 않습니다. 처음부터 다시 시도해 주세요.');
  }

  let meta;
  try { meta = await discover(issuer); }
  catch (e) { return configError(e.message); }

  /* 토큰 교환 — 비밀키가 있으면 client_secret_post, 없으면 PKCE 만으로 인증한다 */
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: `${url.origin}/api/auth/callback`,
    code_verifier: pending.verifier,
  });
  if (clientSecret) form.set('client_secret', clientSecret);

  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form,
  });
  if (!res.ok) {
    let detail = '';
    try {
      const err = await res.json();
      detail = err.error_description || err.error || '';
    } catch { /* 본문이 JSON 이 아니면 상태코드만 쓴다 */ }
    return htmlError('로그인하지 못했습니다',
      `통합 로그인 서버가 토큰 발급을 거절했습니다. (${res.status}${detail ? ` · ${detail}` : ''})`, 502);
  }

  const token = await res.json();
  if (!token.id_token) return htmlError('로그인하지 못했습니다', '계정 정보를 받지 못했습니다.', 502);

  let claims;
  try { claims = decodeJwt(token.id_token); }
  catch { return htmlError('로그인하지 못했습니다', '계정 정보를 해석하지 못했습니다.', 502); }

  /* 토큰 검증 */
  const audOk = Array.isArray(claims.aud) ? claims.aud.includes(clientId) : claims.aud === clientId;
  if (!audOk) return htmlError('로그인하지 못했습니다', '이 사이트를 위해 발급된 계정 정보가 아닙니다.', 401);
  if (claims.iss !== meta.issuer) return htmlError('로그인하지 못했습니다', '발급처가 올바르지 않습니다.', 401);
  if (claims.nonce !== pending.nonce) return htmlError('로그인하지 못했습니다', '로그인 응답이 요청과 맞지 않습니다.', 401);
  if (!claims.exp || claims.exp * 1000 < Date.now()) return htmlError('로그인하지 못했습니다', '계정 정보가 만료되었습니다.', 401);

  const email = String(claims.email || '').toLowerCase();
  if (domain && !email.endsWith(`@${domain.toLowerCase()}`)) {
    return htmlError('접근할 수 없습니다', `${domain} 계정으로만 접속할 수 있습니다.`, 403);
  }

  const who = claims.name || claims.preferred_username || email || '사내 계정';
  const value = await signSession(
    { email, name: who, exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600 },
    secret,
  );

  const headers = new Headers({
    Location: new URL(safePath(pending.next), url.origin).toString(),
    'cache-control': 'no-store',
  });
  headers.append('Set-Cookie', buildCookie(SESSION_COOKIE, value, SESSION_HOURS * 3600));
  headers.append('Set-Cookie', clearAuth());
  return new Response(null, { status: 302, headers });
}
