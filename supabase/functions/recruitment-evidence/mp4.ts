export class MediaIntegrityError extends Error {}
// Structural MP4 verification. Byte ranges avoid loading interview files into Edge memory.
export function boxes(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result: {
    type: string;
    start: number;
    end: number;
    data: Uint8Array;
  }[] = [];
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    let size = view.getUint32(offset);
    let header = 8;
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (size === 1) {
      if (offset + 16 > bytes.length)
        throw new MediaIntegrityError("Incomplete MP4 box");
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    }
    if (size === 0) size = bytes.length - offset;
    if (size < header || offset + size > bytes.length)
      throw new MediaIntegrityError("Incomplete MP4 box");
    result.push({
      type,
      start: offset,
      end: offset + size,
      data: bytes.slice(offset + header, offset + size),
    });
    offset += size;
  }
  if (offset !== bytes.length)
    throw new MediaIntegrityError("Trailing incomplete MP4 bytes");
  return result;
}
export function tracks(moov: Uint8Array) {
  let width = 0,
    height = 0,
    audio = false;
  for (const track of boxes(moov).filter((b) => b.type === "trak")) {
    const children = boxes(track.data),
      tkhd = children.find((b) => b.type === "tkhd"),
      mdia = children.find((b) => b.type === "mdia");
    const handler = mdia && boxes(mdia.data).find((b) => b.type === "hdlr");
    const kind = handler && String.fromCharCode(...handler.data.slice(8, 12));
    if (kind === "soun") audio = true;
    if (kind === "vide" && tkhd && tkhd.data.length >= 8) {
      const v = new DataView(tkhd.data.buffer, tkhd.data.byteOffset);
      width = v.getUint32(tkhd.data.length - 8) / 65536;
      height = v.getUint32(tkhd.data.length - 4) / 65536;
    }
  }
  if (!audio || width < 1 || height < 1)
    throw new MediaIntegrityError("MP4 requires real audio and video tracks");
  return { width: Math.round(width), height: Math.round(height) };
}
export async function verifyMp4(url: string, total: number) {
  const read = async (offset: number, length: number) => {
    const response = await fetch(url, {
      headers: {
        Range: `bytes=${offset}-${Math.min(total - 1, offset + length - 1)}`,
      },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 206) {
      await response.body?.cancel();
      throw Error("Recording range unavailable");
    }
    return new Uint8Array(await response.arrayBuffer());
  };
  let offset = 0,
    video = null,
    media = false,
    format = false,
    count = 0;
  while (offset + 8 <= total && count++ < 4000) {
    const header = await read(offset, 16);
    const view = new DataView(header.buffer);
    let size = view.getUint32(0),
      head = 8;
    const type = String.fromCharCode(...header.slice(4, 8));
    if (size === 1) {
      if (header.length < 16) throw new MediaIntegrityError("Incomplete box");
      size = Number(view.getBigUint64(8));
      head = 16;
    }
    if (size === 0) size = total - offset;
    if (size < head || offset + size > total)
      throw new MediaIntegrityError("Incomplete recording");
    if (type === "ftyp") format = true;
    if (type === "mdat" && size > head) media = true;
    if (type === "moov") {
      if (size > 4 * 1024 * 1024)
        throw new MediaIntegrityError("Recording index too large");
      video = tracks(await read(offset + head, size - head));
    }
    offset += size;
  }
  if (!format || !media || !video || offset !== total)
    throw new MediaIntegrityError(
      "Recording is not a finalized audio/video MP4",
    );
  return video;
}
