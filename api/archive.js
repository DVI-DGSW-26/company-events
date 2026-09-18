/**
 * GET /api/archive — 화면이 읽을 행사 목록
 *
 * 예전에는 빌드가 만든 assets/data.js 를 그대로 썼다. 화면에서 등록·수정이 생긴 뒤에는
 * 목록이 수시로 바뀌므로 Blob 에 둔 문서를 읽어 내보낸다. 저장하면 바로 반영된다.
 *
 * Blob 에 문서가 없으면(저장소를 새로 만든 직후) 배포에 포함된 기준 자료로 한 번 만든다.
 * 기존 12건이 사라져 보이는 일이 없게 하기 위해서다.
 *
 * 사진 주소는 두 가지가 섞여 있다.
 *   · photos/e01/001_....jpg   저장소에 함께 배포된 기존 자료 → CDN 이 바로 내보냄
 *   · blob:photos/e13/001_...  화면에서 올린 자료            → /api/media 를 거침
 * 화면은 이 차이를 몰라도 되게 여기서 주소를 정리해 준다.
 */
import baseline from '../data/baseline.js';
import { mediaUrl, readArchive, writeArchive } from '../lib/store.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/** 저장된 형태 → 화면이 쓰는 형태 */
function forBrowser(doc) {
  return {
    company: doc.company,
    generatedAt: doc.savedAt ?? doc.generatedAt,
    rev: doc.rev ?? 0,
    events: (doc.events ?? []).map((e) => ({
      ...e,
      photos: (e.photos ?? []).map((p) => ({ ...p, src: mediaUrl(p.src), thumb: mediaUrl(p.thumb) })),
      videoFiles: (e.videoFiles ?? []).map((v) => ({ ...v, src: mediaUrl(v.src) })),
      articles: (e.articles ?? []).map((a) => ({
        ...a,
        pdf: a.pdf ? { ...a.pdf, src: mediaUrl(a.pdf.src) } : undefined,
        capture: a.capture
          ? { ...a.capture, src: mediaUrl(a.capture.src), thumb: mediaUrl(a.capture.thumb) }
          : undefined,
      })),
      bundle: e.bundle ? { ...e.bundle, src: mediaUrl(e.bundle.src) } : undefined,
    })),
  };
}

export default async function handler() {
  try {
    let doc = await readArchive();
    if (!doc) doc = await writeArchive(baseline);   // 저장소를 만든 직후 한 번
    return json(forBrowser(doc));
  } catch (e) {
    // 저장소가 아직 없어도 목록은 보여야 한다. 보기·다운로드는 배포된 자료로 계속 된다.
    return json({ ...forBrowser(baseline), degraded: e.message }, 200);
  }
}
