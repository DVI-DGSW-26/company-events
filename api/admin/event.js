/**
 * POST /api/admin/event — 행사 등록·수정
 *
 * data/events.json 과 data/media/<id>.json 을 한 커밋으로 반영한다.
 * 뺀 사진이 있으면 그 파일도 같은 커밋에서 지운다. 중간 상태가 배포되지 않게 하기 위해서다.
 *
 * 본문: { event, media, removePhotos: [name], head }
 *   head 는 편집을 시작할 때 읽은 커밋 sha. 그 사이 다른 사람이 저장했으면 거절한다.
 */
import { requireAdmin, readJsonBody, json, cleanEvent, safePhotoName } from '../../lib/admin.js';
import { commitFiles, readFile } from '../../lib/github.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'POST 로 요청해 주세요.' }, 405);

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const { body, error } = await readJsonBody(req);
  if (error) return error;

  const { event, errors } = cleanEvent(body?.event);
  if (errors.length) return json({ error: errors.join('\n') }, 400);

  /* 사진 목록 정리 — 화면이 보낸 순서를 그대로 쓴다 */
  const photos = (Array.isArray(body?.media?.photos) ? body.media.photos : [])
    .map((p) => {
      const name = safePhotoName(p?.name);
      if (!name) return null;
      const caption = typeof p?.caption === 'string' ? p.caption.trim().slice(0, 300) : '';
      return {
        name, caption,
        orig: typeof p?.orig === 'string' ? p.orig.slice(0, 300) : name,
        w: Number(p?.w) || 0,
        h: Number(p?.h) || 0,
        taken: /^\d{4}-\d{2}-\d{2}$/.test(p?.taken ?? '') ? p.taken : null,
        // 원본에서 다시 만들 때 화면에서 고친 설명이 덮이지 않도록 표시해 둔다
        captionEdited: true,
      };
    })
    .filter(Boolean);

  const removePhotos = (Array.isArray(body?.removePhotos) ? body.removePhotos : [])
    .map(safePhotoName).filter(Boolean);

  try {
    const current = await readFile('data/events.json');
    if (!current) return json({ error: '행사 자료를 찾지 못했습니다.' }, 500);
    const doc = JSON.parse(current.text);

    const at = doc.events.findIndex((e) => e.id === event.id);
    const isNew = at < 0;

    if (isNew) {
      if (doc.events.some((e) => e.id === event.id)) return json({ error: '이미 있는 행사 번호입니다.' }, 409);
      doc.events.push(event);
    } else {
      // 원본 폴더(folder)는 화면에서 바꾸지 않는다. 기존 값을 지킨다.
      const keepFolder = doc.events[at].folder;
      doc.events[at] = keepFolder ? { ...event, folder: keepFolder } : event;
    }
    doc.events.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

    const files = [
      { path: 'data/events.json', text: `${JSON.stringify(doc, null, 2)}\n` },
      { path: `data/media/${event.id}.json`, text: `${JSON.stringify({ photos, videos: body?.media?.videos ?? [] }, null, 1)}\n` },
    ];
    for (const name of removePhotos) {
      files.push({ path: `photos/${event.id}/${name}`, remove: true });
      files.push({ path: `thumbs/${event.id}/${name}`, remove: true });
    }

    const verb = isNew ? '등록' : '수정';
    const { sha } = await commitFiles(
      files,
      `${event.id} ${event.title} ${verb}\n\n행사 아카이브 화면에서 ${verb}함` +
      (removePhotos.length ? `\n사진 ${removePhotos.length}장 삭제` : ''),
      { name: auth.user.name, email: auth.user.email },
      typeof body?.head === 'string' ? body.head : undefined,
    );

    return json({ ok: true, sha, id: event.id, created: isNew });
  } catch (e) {
    return json({ error: e.message }, e.conflict ? 409 : 502);
  }
}
