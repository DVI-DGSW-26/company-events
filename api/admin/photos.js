/**
 * POST /api/admin/photos — 사진 올리기
 *
 * 사진은 브라우저에서 긴 변 1920px 로 줄이고 썸네일까지 만들어 보낸다.
 * 서버에서 변환하지 않는 이유는 두 가지다.
 *   · 요청 본문 크기 한도(수 MB)에 촬영 원본이 바로 걸린다
 *   · 화면에 쓰는 크기는 어차피 1920px 이라 원본을 올릴 실익이 없다
 * 촬영 원본은 지금처럼 공유드라이브에 보관한다.
 *
 * 본문: { id, photos: [{ name, image, thumb }] }   image·thumb 은 data:image/jpeg;base64,...
 */
import { requireAdmin, readJsonBody, json, safePhotoName, jpegBase64 } from '../../lib/admin.js';
import { commitFiles } from '../../lib/github.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'POST 로 요청해 주세요.' }, 405);

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const { body, error } = await readJsonBody(req);
  if (error) return error;

  const id = String(body?.id ?? '');
  if (!/^e\d{2,4}$/.test(id)) return json({ error: '행사 번호가 올바르지 않습니다.' }, 400);

  const list = Array.isArray(body?.photos) ? body.photos : [];
  if (!list.length) return json({ error: '올릴 사진이 없습니다.' }, 400);
  if (list.length > 40) return json({ error: '한 번에 40장까지 올릴 수 있습니다.' }, 400);

  const files = [];
  const added = [];
  for (const p of list) {
    const name = safePhotoName(p?.name);
    if (!name) return json({ error: `사진 이름을 쓸 수 없습니다: ${String(p?.name).slice(0, 60)}` }, 400);

    const image = jpegBase64(p?.image);
    const thumb = jpegBase64(p?.thumb);
    if (!image || !thumb) return json({ error: `사진 형식이 올바르지 않습니다: ${name}` }, 400);

    files.push({ path: `photos/${id}/${name}`, base64: image });
    files.push({ path: `thumbs/${id}/${name}`, base64: thumb });
    added.push(name);
  }

  try {
    const { sha } = await commitFiles(
      files,
      `${id} 사진 ${added.length}장 추가\n\n행사 아카이브 화면에서 올림`,
      { name: auth.user.name, email: auth.user.email },
    );
    return json({ ok: true, sha, added });
  } catch (e) {
    return json({ error: e.message }, e.conflict ? 409 : 502);
  }
}
