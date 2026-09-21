/**
 * POST /api/admin/event — 행사 등록·수정
 *
 * 행사 목록 문서를 읽어 해당 행사만 갈아 끼우고 다시 쓴다.
 * rev 를 함께 받아, 편집을 시작한 뒤 다른 사람이 저장했으면 거절한다.
 * 뺀 사진은 파일까지 지운다.
 *
 * 본문: { event, media, removePhotos: [name], rev }
 */
import { requireAdmin, readJsonBody, json, cleanEvent, safePhotoName } from '../../lib/admin.js';
import { accessToken } from '../../lib/keycloak.js';
import { call, fail, json as apiJson, usingBackend } from '../../lib/backend.js';
import baseline from '../../data/baseline.js';
import { isBlobRef, paths, readArchive, refPath, removeFiles, writeArchive } from '../../lib/store.js';

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'POST 로 요청해 주세요.' }, 405);

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const { body, error } = await readJsonBody(req);
  if (error) return error;

  const { event, errors } = cleanEvent(body?.event);
  if (errors.length) return json({ error: errors.join('\n') }, 400);

  if (usingBackend()) {
    // 본문 모양이 백엔드의 SaveEventRequest 와 같아 그대로 넘긴다
    const { token } = await accessToken(req);
    try {
      const data = await call(`/event/${encodeURIComponent(event.id)}`, {
        token, method: 'PUT',
        json: { event, media: body?.media ?? { photos: [] }, removePhotos: body?.removePhotos ?? [], rev: body?.rev },
      });
      return apiJson(data);
    } catch (e) { return fail(e); }
  }

  /* 사진 목록 — 화면이 보낸 순서를 그대로 쓴다 */
  const photos = (Array.isArray(body?.media?.photos) ? body.media.photos : [])
    .map((p) => {
      const name = safePhotoName(p?.name);
      if (!name) return null;
      return {
        name,
        caption: typeof p?.caption === 'string' ? p.caption.trim().slice(0, 300) : '',
        orig: typeof p?.orig === 'string' ? p.orig.slice(0, 300) : name,
        w: Number(p?.w) || 0,
        h: Number(p?.h) || 0,
        taken: /^\d{4}-\d{2}-\d{2}$/.test(p?.taken ?? '') ? p.taken : null,
        // src/thumb 은 화면이 돌려보낸 값을 그대로 쓴다.
        // 기존 자료는 저장소 경로, 새로 올린 사진은 blob: 경로다.
        src: typeof p?.src === 'string' ? p.src : '',
        thumb: typeof p?.thumb === 'string' ? p.thumb : '',
      };
    })
    .filter((p) => p && p.src && p.thumb);

  const removeNames = (Array.isArray(body?.removePhotos) ? body.removePhotos : [])
    .map(safePhotoName).filter(Boolean);

  try {
    let doc = await readArchive();
    if (!doc) doc = await writeArchive(baseline);

    if (body?.rev != null && Number(body.rev) !== (doc.rev ?? 0)) {
      return json({ error: '다른 사람이 먼저 저장했습니다. 화면을 새로 고친 뒤 다시 저장해 주세요.' }, 409);
    }

    const at = (doc.events ?? []).findIndex((e) => e.id === event.id);
    const isNew = at < 0;
    const before = isNew ? null : doc.events[at];

    const merged = {
      ...event,
      // 원본 폴더 경로와 영상 파일은 화면에서 다루지 않는다. 기존 값을 지킨다.
      folder: before?.folder ?? event.folder,
      photos,
      videoFiles: before?.videoFiles ?? [],
      bundle: before?.bundle,
    };
    for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];

    doc.events = isNew ? [...(doc.events ?? []), merged] : doc.events.map((e, i) => (i === at ? merged : e));
    doc.events.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

    const next = await writeArchive(doc);

    /* 뺀 사진의 파일 정리 — 화면에서 올린 것만 지운다.
       저장소에 배포된 기존 자료는 다음 빌드에서 정리된다. */
    const gone = (before?.photos ?? [])
      .filter((p) => removeNames.includes(p.name) && isBlobRef(p.src))
      .flatMap((p) => [refPath(p.src), refPath(p.thumb)]);
    if (gone.length) await removeFiles(gone);

    return json({ ok: true, rev: next.rev, id: event.id, created: isNew, bundleStale: true });
  } catch (e) {
    return json({ error: `저장하지 못했습니다: ${e.message}` }, 502);
  }
}
