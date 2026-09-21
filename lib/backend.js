/**
 * backend.js — 사내 행사 API(api.dvi-ind.com/events) 호출
 *
 * 화면은 계속 같은 주소(/api/archive, /api/admin/*)를 부른다. 이 파일이 그 요청을
 * 백엔드로 넘기고, 응답 껍데기를 화면이 쓰던 모양으로 되돌린다.
 * 덕분에 화면 코드는 그대로 두고 저장 위치만 바꿀 수 있다.
 *
 *   성공  { status, message, data }  →  data 만
 *   실패  { code, status, message }  →  { error: message }
 *
 * EVENTS_API 가 없으면 등록·수정은 막히고, 목록은 배포에 포함된 기준 자료로 보여 준다.
 */

export const BASE = (process.env.EVENTS_API ?? '').replace(/\/+$/, '');
export const usingBackend = () => Boolean(BASE);

/** 아직 사내 행사 서버에 연결되지 않았을 때의 안내. 서버 고장이 아니라 설정 단계라 503. */
export const notConnected = () => json({ error: '환경변수가 설정되지 않았습니다: EVENTS_API' }, 503);

/**
 * 자료 파일 주소의 호스트를 사내 행사 서버로 바로잡는다.
 *
 * 2026-09-21 에 서버가 내려주는 서명 주소의 호스트가 이 사이트 주소로 찍혀 와
 * 사진이 깨지고 내려받기가 실패한 적이 있다. Vercel 함수를 거친 요청에 붙는
 * Forwarded 헤더를 서버가 호스트로 쓴 것이 원인이었고, 서버에서 고쳐졌다.
 *
 * 지금은 아무 일도 하지 않지만 그대로 둔다. 원인이 프록시 경로의 헤더였던 만큼
 * 앞단 설정이 바뀌면 재발할 수 있다. 서명은 저장 경로·만료·파일 이름만 묶고
 * 호스트는 묶지 않아서(서버 확인), 호스트만 바꿔도 그대로 열린다.
 *
 * 조용히 덮어버리지 않도록 /api/health 가 서버에서 온 값을 그대로 보여준다.
 * 응답 모양이 바뀌어도 놓치지 않게 값 전체를 훑는다.
 */
export function fixMediaHost(value) {
  if (!BASE) return { data: value, fixed: 0 };
  const want = new URL(BASE).origin;
  let fixed = 0;

  const walk = (v) => {
    if (typeof v === 'string') {
      if (!/^https?:\/\//.test(v) || !v.includes('/media/')) return v;
      try {
        const u = new URL(v);
        if (u.origin === want) return v;
        fixed++;
        return want + u.pathname + u.search;
      } catch { return v; }
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };

  return { data: walk(value), fixed };
}

/** 화면에 돌려줄 JSON 응답. 갱신된 토큰 쿠키가 있으면 함께 내려보낸다. */
export function json(body, status = 200, cookies = []) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}

export class BackendError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * 백엔드를 호출하고 data 만 돌려준다.
 * @param {string} path            예: '/event/e01'
 * @param {object} opt
 * @param {string} opt.token       Keycloak access token
 * @param {string} [opt.method]
 * @param {object} [opt.json]      JSON 본문
 * @param {FormData} [opt.form]    multipart 본문
 * @param {object} [opt.search]    질의 문자열
 */
export async function call(path, { token, method = 'GET', json: body, form, search } = {}) {
  if (!BASE) throw new BackendError('EVENTS_API 가 설정되지 않았습니다.', 500);

  // 질의 문자열을 직접 만든다. URLSearchParams 는 공백을 '+' 로 넣는데,
  // 서버가 그것을 공백으로 되돌리지 않으면 행사명 대조가 어긋나 엉뚱하게 거절된다.
  // %20 은 어느 쪽으로 읽어도 공백이다.
  const query = Object.entries(search ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = BASE + path + (query ? `?${query}` : '');

  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : (form ?? undefined),
    });
  } catch (e) {
    throw new BackendError(`행사 서버에 연결하지 못했습니다. (${e.message})`, 502);
  }

  let payload = null;
  try { payload = await res.json(); } catch { /* 본문이 비었거나 JSON 이 아님 */ }

  if (!res.ok) {
    const msg = payload?.message
      || (res.status === 401 ? '로그인이 필요합니다.'
        : res.status === 403 ? '권한이 없습니다.'
          : `행사 서버가 요청을 거절했습니다. (${res.status})`);
    throw new BackendError(msg, res.status);
  }

  // 성공 껍데기 안에 실패가 담겨 오는 경우도 있다
  if (payload && typeof payload.status === 'number' && payload.status >= 400) {
    throw new BackendError(payload.message ?? `요청이 거절되었습니다. (${payload.status})`, payload.status);
  }

  const data = payload && 'data' in payload ? payload.data : payload;
  return fixMediaHost(data).data;
}

/** 오류를 화면이 쓰던 { error } 모양으로 바꿔 돌려준다 */
export function fail(e, cookies = []) {
  const status = e instanceof BackendError ? e.status : 502;
  const body = { error: e.message };
  // 다시 로그인해야 하는 상황인지 화면이 알 수 있게 표시한다
  if (status === 401) body.needsLogin = true;
  return json(body, status, cookies);
}
