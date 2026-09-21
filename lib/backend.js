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
 * EVENTS_API 가 없으면 예전 경로(Vercel Blob)로 동작한다.
 * 전환은 환경변수를 넣고 Redeploy 하는 것으로 이뤄지고, 빼면 그대로 되돌아간다.
 */

export const BASE = (process.env.EVENTS_API ?? '').replace(/\/+$/, '');
export const usingBackend = () => Boolean(BASE);

/** 행사 자료를 읽고 쓸 곳이 아직 정해지지 않았는지 */
export const storageMissing = () => !usingBackend() && !process.env.BLOB_READ_WRITE_TOKEN;

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

  return payload && 'data' in payload ? payload.data : payload;
}

/** 오류를 화면이 쓰던 { error } 모양으로 바꿔 돌려준다 */
export function fail(e, cookies = []) {
  const status = e instanceof BackendError ? e.status : 502;
  const body = { error: e.message };
  // 다시 로그인해야 하는 상황인지 화면이 알 수 있게 표시한다
  if (status === 401) body.needsLogin = true;
  return json(body, status, cookies);
}
