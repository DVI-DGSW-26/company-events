/**
 * /api/auth/callback — 사내 통합 로그인 결과 처리
 *
 * 1. 임시 쿠키의 state 와 대조해 요청 위조를 막는다
 * 2. code + code_verifier 를 토큰 엔드포인트에 보내 토큰을 받는다
 * 3. iss · aud · nonce · exp 를 확인한다
 * 4. realm 역할에 employee 가 있는지 본다  ← 재직자 판별은 이것으로 한다
 * 5. 서명한 세션 쿠키를 심고 원래 보려던 주소로 돌려보낸다
 *
 * 이메일 도메인은 보지 않는다. 생산 인력 등 상당수가 개인 메일 계정으로
 * SSO 에 로그인하기 때문에, 도메인으로 거르면 정작 행사 참여자가 막힌다.
 */
import { SESSION_COOKIE, SESSION_HOURS, buildCookie, readCookie, signSession, verifySession }
  from '../../lib/session.js';
import { AUTH_COOKIE, configError, decodeJwt, discover, htmlError, safePath } from '../../lib/oidc.js';

export const config = { runtime: 'edge' };

/**
 * Keycloak 은 realm_access · resource_access 를 보통 access_token 에만 담는다.
 * (id_token 에 넣으려면 별도 매퍼가 필요하다) 두 토큰을 모두 보고 합친다.
 */
function collectRoles(tokens, clientId) {
  const realm = new Set();
  const client = new Set();
  for (const t of tokens) {
    if (!t) continue;
    for (const r of t.realm_access?.roles ?? []) realm.add(r);
    for (const r of t.resource_access?.[clientId]?.roles ?? []) client.add(r);
  }
  return { realm: [...realm], client: [...client] };
}

export default async function handler(req) {
  const url = new URL(req.url);
  const secret = process.env.SESSION_SECRET;
  const issuer = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  // 재직자 판별에 쓰는 realm 역할. 빈 값으로 두면 인증된 계정 전부 허용한다.
  const requiredRole = process.env.REQUIRED_REALM_ROLE ?? 'employee';

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
    // 미리보기 배포는 주소가 매번 달라 redirect_uri 를 등록할 수 없다
    const hint = /redirect/i.test(detail)
      ? '<br><br>미리보기(Preview) 배포에서는 로그인할 수 없습니다. 운영 주소로 접속해 주세요.'
      : '';
    return htmlError('로그인하지 못했습니다',
      `통합 로그인 서버가 토큰 발급을 거절했습니다. (${res.status}${detail ? ` · ${detail}` : ''})${hint}`, 502);
  }

  const token = await res.json();
  if (!token.id_token) return htmlError('로그인하지 못했습니다', '계정 정보를 받지 못했습니다.', 502);

  let claims, access = null;
  try { claims = decodeJwt(token.id_token); }
  catch { return htmlError('로그인하지 못했습니다', '계정 정보를 해석하지 못했습니다.', 502); }
  try { access = token.access_token ? decodeJwt(token.access_token) : null; }
  catch { /* 역할 정보만 못 읽는 것이라 아래에서 걸러진다 */ }

  /* 토큰 검증 */
  const audOk = Array.isArray(claims.aud) ? claims.aud.includes(clientId) : claims.aud === clientId;
  if (!audOk) return htmlError('로그인하지 못했습니다', '이 사이트를 위해 발급된 계정 정보가 아닙니다.', 401);
  if (claims.iss !== meta.issuer) return htmlError('로그인하지 못했습니다', '발급처가 올바르지 않습니다.', 401);
  if (claims.nonce !== pending.nonce) return htmlError('로그인하지 못했습니다', '로그인 응답이 요청과 맞지 않습니다.', 401);
  if (!claims.exp || claims.exp * 1000 < Date.now()) return htmlError('로그인하지 못했습니다', '계정 정보가 만료되었습니다.', 401);
  if (!claims.sub) return htmlError('로그인하지 못했습니다', '계정 식별자(sub)가 없습니다.', 502);

  /* 재직자 확인 — 부서가 배정된 재직자에게만 employee 역할이 붙는다 */
  const roles = collectRoles([claims, access], clientId);
  if (requiredRole) {
    if (!roles.realm.length) {
      return htmlError('권한을 확인할 수 없습니다',
        '토큰에 역할 정보가 없습니다. Keycloak 클라이언트에 realm roles 매퍼가 켜져 있는지 ' +
        '확인이 필요합니다. 관리자에게 문의해 주세요.', 500);
    }
    if (!roles.realm.includes(requiredRole)) {
      return htmlError('접근 권한이 없습니다',
        '재직 중이며 부서가 배정된 계정만 이용할 수 있습니다.<br>' +
        '담당 부서가 지정돼 있는데도 막힌다면 경영지원팀에 문의해 주세요.', 403);
    }
  }

  /* 사용자 식별은 sub 으로 한다. 이메일은 바뀔 수 있지만 sub 은 바뀌지 않는다. */
  const session = {
    sub: claims.sub,
    email: String(claims.email || '').toLowerCase(),
    name: claims.name || claims.preferred_username || '사내 계정',
    admin: roles.client.includes('admin'),
    exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600,
  };

  const headers = new Headers({
    Location: new URL(safePath(pending.next), url.origin).toString(),
    'cache-control': 'no-store',
  });
  headers.append('Set-Cookie', buildCookie(SESSION_COOKIE, await signSession(session, secret), SESSION_HOURS * 3600));
  headers.append('Set-Cookie', buildCookie(AUTH_COOKIE, '', 0));
  return new Response(null, { status: 302, headers });
}
