import QRCode from "qrcode";

export function legacyLabelContentField(definition, index) {
  if (!definition.reference_note?.includes("Labelife S08 screenshot"))
    return null;
  const elements = definition.elements;
  if (
    elements.some((e) =>
      ["ingredients", "manufacturer_name", "manufacturer_address"].includes(
        e.field,
      ),
    )
  )
    return null;
  if (elements[index]?.type !== "text" || elements[index]?.field) return null;
  const previous = elements[index - 1]?.text?.trim();
  if (previous === "Ingredients:") return "ingredients";
  if (previous === "Manufactured by:") return "manufacturer_name";
  if (elements[index - 2]?.text?.trim() === "Manufactured by:")
    return "manufacturer_address";
  return null;
}
export const LABEL_DPI = 203;
export const mmToDots = (mm) => Math.round((Number(mm) * LABEL_DPI) / 25.4);
const fields = new Set([
  "ingredients",
  "manufacturer_name",
  "manufacturer_address",
  "packaged_units",
  "product_name",
  "product_name_cn",
  "product_name_bm",
  "product_code",
  "variant_name",
  "net_weight",
  "storage_instructions",
  "manufacturing_date",
  "expiry_date",
  "batch_no",
]);
// Code 39, including start/stop. Wide:narrow = 3:1, with a ten-module quiet zone.
const code39 = {
  0: "nnnwwnwnn",
  1: "wnnwnnnnw",
  2: "nnwwnnnnw",
  3: "wnwwnnnnn",
  4: "nnnwwnnnw",
  5: "wnnwwnnnn",
  6: "nnwwwnnnn",
  7: "nnnwnnwnw",
  8: "wnnwnnwnn",
  9: "nnwwnnwnn",
  A: "wnnnnwnnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  $: "nwnwnwnnn",
  "/": "nwnwnnnwn",
  "+": "nwnnnwnwn",
  "%": "nnnwnwnwn",
  "*": "nwnnwnwnn",
};
export function barcodeModules(value) {
  const text = String(value);
  if (!/^[0-9A-Z .$/+%\-]+$/.test(text))
    throw new Error(
      "Code 39 requires uppercase letters, numbers or supported punctuation. Use QR for other text.",
    );
  return [
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...[...`*${text}*`].flatMap((c) =>
      [...code39[c]]
        .flatMap((width, i) =>
          Array(width === "w" ? 3 : 1).fill(i % 2 === 0 ? 1 : 0),
        )
        .concat(0),
    ),
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ];
}
export function validateDefinition(definition, widthMm, heightMm) {
  if (
    !definition ||
    !Array.isArray(definition.elements) ||
    definition.elements.length < 1 ||
    definition.elements.length > 50
  )
    throw new Error("A template needs 1–50 elements.");
  for (const e of definition.elements) {
    if (!["text", "image", "qr", "barcode", "rect", "line"].includes(e.type))
      throw new Error("Unsupported label element.");
    if (
      ![e.x, e.y, e.w, e.h].every(Number.isFinite) ||
      e.x < 0 ||
      e.y < 0 ||
      e.w <= 0 ||
      e.h <= 0 ||
      e.x + e.w > widthMm ||
      e.y + e.h > heightMm
    )
      throw new Error("Every element must fit inside the label.");
    if (e.field && !fields.has(e.field))
      throw new Error(`Unknown label field: ${e.field}`);
    if (
      e.type === "image" &&
      (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(e.src || "") ||
        e.src.length > 400000)
    )
      throw new Error(
        "Images and logos must be embedded PNG files under 300 KB.",
      );
    if (
      e.type === "text" &&
      (!Number.isFinite(e.size) || e.size < 1.5 || e.size > 20)
    )
      throw new Error("Text size must be 1.5–20 mm.");
  }
  return definition;
}
export function packMonochrome(rgba, width, height) {
  const stride = Math.ceil(width / 8),
    bytes = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (
        rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114 < 160 &&
        rgba[i + 3] > 127
      )
        bytes[y * stride + (x >> 3)] |= 128 >> (x % 8);
    }
  return bytes;
}
const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load label image."));
    image.src = src;
  });

// A single frozen bitmap drives preview and both Windows transports; no printer fonts are assumed.
export function labelText(snapshot, index) {
  const e = snapshot.definition.elements[index];
  const bound = legacyLabelContentField(snapshot.definition, index);
  const value = e.field
    ? snapshot[e.field]
    : (snapshot.content?.text_overrides?.[String(index)] ??
      (bound ? snapshot.content?.[bound] : undefined) ??
      e.text);
  const formatted =
    e.date_format === "dd/MM/yyyy" && /^\d{4}-\d{2}-\d{2}$/.test(value || "")
      ? value.split("-").reverse().join("/")
      : value;
  return `${e.prefix || ""}${formatted ?? ""}${e.suffix || ""}`;
}
export function layoutLabelText(ctx, text, element) {
  const lines = [];
  let line = "",
    tooWide = false;
  for (const char of text) {
    if (char === "\n") {
      lines.push(line);
      line = "";
      continue;
    }
    if (ctx.measureText(char).width > element.w) tooWide = true;
    if (ctx.measureText(line + char).width > element.w) {
      if (line) lines.push(line);
      line = char;
    } else line += char;
  }
  if (line) lines.push(line);
  const lineHeight = element.size * 1.25;
  return {
    lines,
    lineHeight,
    overflow: tooWide || lines.length * lineHeight > element.h,
  };
}
export async function renderLabel(snapshot, { diagnostics = false } = {}) {
  const { width_mm: wm, height_mm: hm } = snapshot;
  validateDefinition(snapshot.definition, Number(wm), Number(hm));
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = mmToDots(wm);
  canvas.height = mmToDots(hm);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }),
    scale = LABEL_DPI / 25.4;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#000";
  ctx.imageSmoothingEnabled = false;
  const issues = [];
  for (const [index, e] of snapshot.definition.elements.entries()) {
    const text = labelText(snapshot, index);
    if (
      diagnostics &&
      (e.x < 2 || e.y < 2 || e.x + e.w > wm - 2 || e.y + e.h > hm - 2)
    )
      issues.push({
        index,
        severity: "warning",
        message: "Within 2 mm of the label edge. Verify printer calibration.",
      });
    if (e.type === "rect" || e.type === "line") {
      ctx.lineWidth = e.stroke || 0.25;
      ctx.strokeStyle = "#000";
      ctx.beginPath();
      if (e.type === "rect") ctx.roundRect(e.x, e.y, e.w, e.h, e.radius || 0);
      else {
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x + e.w, e.y);
      }
      ctx.stroke();
    } else if (e.type === "text") {
      if (!text) continue;
      ctx.font = `${e.bold ? "700" : "400"} ${e.size}px Arial, "Microsoft YaHei", "PingFang SC", sans-serif`;
      ctx.textBaseline = "top";
      ctx.textAlign = e.align || "left";
      const { lines, lineHeight: lh, overflow } = layoutLabelText(ctx, text, e);
      if (overflow) {
        const message =
          "Text exceeds its field. Shorten the content or resize the field; font size is unchanged.";
        if (!diagnostics)
          throw new Error(
            `Label text does not fit: ${e.field || "custom text"}. Adjust the template before printing.`,
          );
        issues.push({ index, severity: "error", message });
        ctx.save();
        ctx.beginPath();
        ctx.rect(e.x, e.y, e.w, e.h);
        ctx.clip();
      }
      lines.forEach((l, i) =>
        ctx.fillText(
          l,
          e.x +
            (e.align === "center" ? e.w / 2 : e.align === "right" ? e.w : 0),
          e.y + i * lh,
        ),
      );
      if (overflow) ctx.restore();
    } else if (e.type === "image") {
      const image = await loadImage(e.src);
      const ratio = Math.min(e.w / image.width, e.h / image.height);
      ctx.drawImage(image, e.x, e.y, image.width * ratio, image.height * ratio);
    } else if (e.type === "qr") {
      if (!text) throw new Error("QR content is missing.");
      const qr = QRCode.create(text, { errorCorrectionLevel: "M" }),
        count = qr.modules.size + 8;
      const dot = Math.floor((Math.min(e.w, e.h) * scale) / count);
      if (dot < 2)
        throw new Error(
          "QR element needs at least two printer dots per module. Enlarge it.",
        );
      const startX = Math.round(e.x * scale),
        startY = Math.round(e.y * scale);
      ctx.save();
      ctx.resetTransform();
      for (let y = 0; y < qr.modules.size; y++)
        for (let x = 0; x < qr.modules.size; x++)
          if (qr.modules.get(y, x))
            ctx.fillRect(
              startX + (x + 4) * dot,
              startY + (y + 4) * dot,
              dot,
              dot,
            );
      ctx.restore();
    } else {
      const modules = barcodeModules(text),
        dot = Math.floor((e.w * scale) / modules.length);
      if (dot < 2)
        throw new Error(
          "Barcode needs at least two printer dots per narrow bar. Enlarge it or use QR.",
        );
      ctx.save();
      ctx.resetTransform();
      modules.forEach((black, i) => {
        if (black)
          ctx.fillRect(
            Math.round(e.x * scale) + i * dot,
            Math.round(e.y * scale),
            dot,
            mmToDots(e.h),
          );
      });
      ctx.restore();
    }
  }
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height),
    bytes = packMonochrome(pixels.data, canvas.width, canvas.height),
    stride = Math.ceil(canvas.width / 8);
  // Preview the actual thresholded print pixels.
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4,
        color = bytes[y * stride + (x >> 3)] & (128 >> (x % 8)) ? 0 : 255;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = color;
      pixels.data[i + 3] = 255;
    }
  ctx.putImageData(pixels, 0, 0);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return {
    issues,
    preview: canvas.toDataURL("image/png"),
    raster: issues.some((issue) => issue.severity === "error")
      ? null
      : {
          format: "mono1",
          width: canvas.width,
          height: canvas.height,
          data: btoa(binary),
        },
  };
}

export function previewFrozenRaster(raster) {
  const bytes = Uint8Array.from(atob(raster.data), (c) => c.charCodeAt(0)),
    { width, height } = raster,
    stride = Math.ceil(width / 8);
  if (raster.format !== "mono1" || bytes.length !== stride * height)
    throw new Error("Saved label pixels are unavailable.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d"),
    image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        color = bytes[y * stride + (x >> 3)] & (128 >> (x % 8)) ? 0 : 255;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = color;
      image.data[i + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
  return { preview: canvas.toDataURL("image/png"), raster };
}
