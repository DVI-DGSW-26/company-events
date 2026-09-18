/**
 * admin.js — 등록·수정·삭제 API 의 공통 검사
 *
 * 화면에서 버튼을 숨기는 것만으로는 부족하다. 주소를 아는 사람이 API 를 직접
 * 호출할 수 있으므로 서버에서 매번 확인한다.
 *
 *   · 로그인했는가            → 세션 쿠키
 *   · 재직자인가              → realm 역할 employee
 *   · 고칠 권한이 있는가      → company-events 클라이언트의 admin 역할
 *
 * 역할은 로그인 시점에 토큰에서 읽어 세션에 넣어 둔 값을 쓴다.
 */
import { SESSION_COOKIE, readCookie, verifySession } from './session.js';

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * 관리 권한을 확인한다.
 * @returns {Promise<{ok:true, user:object} | {ok:false, res:Response}>}
 */
export async function requireAdmin(req) {
  const session = await verifySession(readCookie(req, SESSION_COOKIE), process.env.SESSION_SECRET);
  if (!session) return { ok: false, res: json({ error: '로그인이 필요합니다.' }, 401) };
  if (session.admin !== true) {
    return { ok: false, res: json({ error: '행사를 고칠 권한이 없습니다. 담당자에게 문의해 주세요.' }, 403) };
  }
  return { ok: true, user: session };
}

/** 요청 본문을 JSON 으로 읽는다. 크기 초과·형식 오류를 구분해 돌려준다. */
export async function readJsonBody(req, limitBytes = 4_000_000) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > limitBytes) {
    return { error: json({ error: '한 번에 보낼 수 있는 크기를 넘었습니다. 사진을 나눠서 올려주세요.' }, 413) };
  }
  try {
    return { body: await req.json() };
  } catch {
    return { error: json({ error: '요청 형식이 올바르지 않습니다.' }, 400) };
  }
}

/* ── 입력 검사 ────────────────────────────────────────────── */

const ID_RE = /^e\d{2,4}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_NAME = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ._ ()\-]+\.jpg$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** 행사 입력을 검사하고 저장할 형태로 정리한다 */
export function cleanEvent(input) {
  const errors = [];
  const id = str(input?.id, 8);
  if (!ID_RE.test(id)) errors.push('행사 번호 형식이 올바르지 않습니다.');

  const date = str(input?.date, 10);
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) errors.push('일시를 YYYY-MM-DD 형식으로 입력해 주세요.');

  const title = str(input?.title, 200);
  if (!title) errors.push('행사명을 입력해 주세요.');

  const category = str(input?.category, 10);
  if (!['사내', '사외'].includes(category)) errors.push('구분은 사내 또는 사외여야 합니다.');

  const type = str(input?.type, 30);
  if (!type) errors.push('행사구분을 입력해 주세요.');

  const articles = (Array.isArray(input?.articles) ? input.articles : []).slice(0, 50).map((a) => {
    const url = str(a?.url, 1000);
    const ok = /^https?:\/\//i.test(url);
    if (!ok) errors.push(`기사 링크가 올바르지 않습니다: ${url.slice(0, 40) || '(비어 있음)'}`);
    return {
      press: str(a?.press, 100) || '언론사',
      title: str(a?.title, 300) || undefined,
      url,
      kind: str(a?.kind, 20) || undefined,
      memo: str(a?.memo, 300) || undefined,
      hasPhoto: a?.hasPhoto !== false,
    };
  });

  const videos = (Array.isArray(input?.videos) ? input.videos : []).slice(0, 30).map((v) => {
    const url = str(v?.url, 1000);
    if (!/^https?:\/\//i.test(url)) errors.push(`영상 링크가 올바르지 않습니다: ${url.slice(0, 40) || '(비어 있음)'}`);
    return {
      press: str(v?.press, 100) || '영상',
      url,
      marks: (Array.isArray(v?.marks) ? v.marks : []).slice(0, 30).map((m) => str(m, 200)).filter(Boolean),
    };
  });

  const event = {
    id,
    folder: str(input?.folder, 300) || undefined,   // 화면에서 만든 행사는 원본 폴더가 없다
    category, type, date, title,
    subtitle: str(input?.subtitle, 200) || undefined,
    place: str(input?.place, 200) || undefined,
    host: str(input?.host, 200) || undefined,
    attendees: str(input?.attendees, 300) || undefined,
    summary: str(input?.summary, 2000) || undefined,
    notes: (Array.isArray(input?.notes) ? input.notes : []).slice(0, 30).map((n) => str(n, 500)).filter(Boolean),
    articles,
    videos,
  };
  for (const k of Object.keys(event)) if (event[k] === undefined) delete event[k];

  return { event, errors };
}

/** 업로드 사진 이름이 안전한지 본다 (경로 탈출·이상한 확장자 차단) */
export function safePhotoName(name) {
  const n = String(name || '');
  if (n.includes('/') || n.includes('\\') || n.includes('..')) return null;
  return SAFE_NAME.test(n) ? n : null;
}

/** data URL 에서 base64 부분만 꺼낸다 (JPEG 만 받는다) */
export function jpegBase64(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  return m ? m[1] : null;
}
