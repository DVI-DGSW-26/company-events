/**
 * zip.mjs — 의존성 없는 ZIP 생성기
 *
 * 이전에는 PowerShell 로 ZIP 을 만들었는데, 그러면 Windows 에서만 빌드할 수 있고
 * 리눅스 빌드 서버(Vercel 등)에서 실패한다. 표준 ZIP 을 직접 써서 어디서든 돌게 한다.
 *
 * - 파일명은 UTF-8 로 넣고 범용 플래그 11번 비트를 세워 한글 이름을 보존한다.
 * - 폴더 구분자는 규격대로 슬래시(/)를 쓴다.
 * - 이미 압축된 형식(jpg·png·mp4·pdf·zip)은 STORE, 나머지는 DEFLATE 로 넣는다.
 *   어차피 줄지 않는 파일을 다시 압축하느라 시간을 쓰지 않기 위해서다.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

/* ── CRC-32 ───────────────────────────────────────────────── */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 자바스크립트 Date → DOS 날짜/시각 (ZIP 규격) */
function dosTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const PRECOMPRESSED = /\.(jpe?g|png|gif|webp|mp4|mov|webm|pdf|zip|7z|gz)$/i;

/**
 * 파일 목록을 ZIP 으로 묶는다.
 * @param {{from:string,name:string}[]} entries  name 은 zip 안에서의 경로(슬래시 구분)
 * @param {string} outZip
 * @returns {number} 만들어진 파일 크기
 */
export function writeZip(entries, outZip) {
  const chunks = [];
  const central = [];
  let offset = 0;

  const push = (b) => { chunks.push(b); offset += b.length; };

  for (const e of entries) {
    const data = fs.readFileSync(e.from);
    const stat = fs.statSync(e.from);
    const name = Buffer.from(e.name.split('\\').join('/'), 'utf8');
    const { time, date } = dosTime(stat.mtime);
    const crc = crc32(data);

    const store = PRECOMPRESSED.test(e.name);
    const body = store ? data : zlib.deflateRawSync(data, { level: 9 });
    const method = store ? 0 : 8;

    const localOffset = offset;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // 로컬 파일 헤더 서명
    local.writeUInt16LE(20, 4);           // 필요 버전 2.0
    local.writeUInt16LE(0x0800, 6);       // 플래그: 11번 비트 = 파일명이 UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);           // extra 없음
    push(local); push(name); push(body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);     // 중앙 디렉터리 서명
    dir.writeUInt16LE(20, 4);             // 만든 버전
    dir.writeUInt16LE(20, 6);             // 필요 버전
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30);             // extra
    dir.writeUInt16LE(0, 32);             // 주석
    dir.writeUInt16LE(0, 34);             // 디스크 번호
    dir.writeUInt16LE(0, 36);             // 내부 속성
    dir.writeUInt32LE(0, 38);             // 외부 속성
    dir.writeUInt32LE(localOffset, 42);
    central.push(Buffer.concat([dir, name]));
  }

  const centralBuf = Buffer.concat(central);
  const centralOffset = offset;
  push(centralBuf);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);       // 중앙 디렉터리 끝 서명
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);               // 주석 길이
  push(end);

  fs.writeFileSync(outZip, Buffer.concat(chunks));
  return fs.statSync(outZip).size;
}
