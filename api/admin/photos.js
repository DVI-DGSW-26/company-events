/**
 * POST /api/admin/photos — 사진 올리기
 *
 * 화면은 브라우저에서 긴 변 1920px 로 줄인 사진을 base64 로 보낸다.
 * 여기서 multipart(files)로 바꿔 사내 행사 서버에 넘긴다. 썸네일은 서버가 만든다.
 *
 * 브라우저에서 이 경로까지는 요청 본문 한도(약 4.5MB)가 걸려 있어,
 * 화면이 알아서 나눠 보내고 여기서는 받은 만큼만 넘긴다.
 *
 * 본문: { id, photos: [{ name, image }] }   image 는 data:image/jpeg;base64,...
 */
import { requireAdmin, readJsonBody, json, safePhotoName, jpegBase64 } from '../../lib/admin.js';
import { accessToken } from '../../lib/keycloak.js';
import { call, fail, json as apiJson, notConnected, usingBackend } from '../../lib/backend.js';

const bytesOf = (b64) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'POST 로 요청해 주세요.' }, 405);

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  if (!usingBackend()) return notConnected();

  const { body, error } = await readJsonBody(req);
  if (error) return error;

  const id = String(body?.id ?? '');
  if (!/^e\d{2,4}$/.test(id)) return json({ error: '행사 번호가 올바르지 않습니다.' }, 400);

  const list = Array.isArray(body?.photos) ? body.photos : [];
  if (!list.length) return json({ error: '올릴 사진이 없습니다.' }, 400);
  if (list.length > 40) return json({ error: '한 번에 40장까지 올릴 수 있습니다.' }, 400);

  const form = new FormData();
  for (const p of list) {
    const name = safePhotoName(p?.name);
    if (!name) return json({ error: `사진 이름을 쓸 수 없습니다: ${String(p?.name).slice(0, 60)}` }, 400);
    const image = jpegBase64(p?.image);
    if (!image) return json({ error: `사진 형식이 올바르지 않습니다: ${name}` }, 400);
    form.append('files', new Blob([bytesOf(image)], { type: 'image/jpeg' }), name);
  }

  const { token } = await accessToken(req);
  try {
    return apiJson(await call(`/event/${encodeURIComponent(id)}/photo`, { token, method: 'POST', form }));
  } catch (e) { return fail(e); }
}
