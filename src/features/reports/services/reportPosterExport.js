export const REPORT_POSTER_LOGICAL_WIDTH = 1200;
export const REPORT_POSTER_MONTHLY_LOGICAL_HEIGHT = 1500;
export const REPORT_POSTER_YEARLY_LOGICAL_HEIGHT = REPORT_POSTER_LOGICAL_WIDTH * 297 / 210;
export const YEARLY_POSTER_PNG_WIDTH = 2480;
export const YEARLY_POSTER_PNG_HEIGHT = 3508;

function posterSurface(reportType) {
  if (reportType === "yearly") return { height: REPORT_POSTER_YEARLY_LOGICAL_HEIGHT, pixelRatio: YEARLY_POSTER_PNG_WIDTH / REPORT_POSTER_LOGICAL_WIDTH, pngWidth: YEARLY_POSTER_PNG_WIDTH, pngHeight: YEARLY_POSTER_PNG_HEIGHT };
  return { height: REPORT_POSTER_MONTHLY_LOGICAL_HEIGHT, pixelRatio: 2, pngWidth: REPORT_POSTER_LOGICAL_WIDTH * 2, pngHeight: REPORT_POSTER_MONTHLY_LOGICAL_HEIGHT * 2 };
}

export function outletSlug(outletName) {
  const normalized = String(outletName ?? "outlet").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return normalized.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "outlet";
}

export function reportExportFilename({ reportType, outletName, year, month, periodMode, format }) {
  const outlet = outletSlug(outletName);
  const extension = format === "pdf" ? "pdf" : "png";
  if (reportType === "monthly") {
    return `monthly-profit-report_${outlet}_${year}-${String(month).padStart(2, "0")}.${extension}`;
  }
  const ytd = periodMode === "ytd" ? "-ytd" : "";
  return `yearly-pnl-report_${outlet}_${year}${ytd}.${extension}`;
}

export function getPosterNode(element) {
  if (element?.matches?.(".report-poster")) return element;
  return element?.querySelector?.(".report-poster") ?? null;
}

function waitForLayout() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function assertLogicalPosterSurface(poster, reportType) {
  const { width, height } = poster.getBoundingClientRect();
  const surface = posterSurface(reportType);
  if (Math.round(width) !== REPORT_POSTER_LOGICAL_WIDTH || Math.abs(height - surface.height) > 1) {
    throw new Error("The export poster did not reach its fixed logical canvas size.");
  }
}

function assertCanvasHasPosterContent(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || !canvas.width || !canvas.height) throw new Error("The poster image could not be created.");

  const stepX = Math.max(1, Math.floor(canvas.width / 180));
  const stepY = Math.max(1, Math.floor(canvas.height / 225));
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let meaningfulPixels = 0;
  for (let y = 0; y < canvas.height; y += stepY) {
    for (let x = 0; x < canvas.width; x += stepX) {
      const offset = (y * canvas.width + x) * 4;
      const difference = Math.abs(pixels[offset] - 247) + Math.abs(pixels[offset + 1] - 251) + Math.abs(pixels[offset + 2] - 250);
      if (pixels[offset + 3] > 20 && difference > 28) meaningfulPixels += 1;
    }
  }
  if (meaningfulPixels < 120) throw new Error("The poster capture was blank. No file was downloaded.");
}

async function capturePoster(element, reportType) {
  const poster = getPosterNode(element);
  if (!poster) throw new Error("The generated poster is no longer available for export.");
  await document.fonts?.ready;
  await waitForLayout();
  assertLogicalPosterSurface(poster, reportType);
  const surface = posterSurface(reportType);
  const { toCanvas } = await import("html-to-image");
  const canvas = await toCanvas(poster, {
    backgroundColor: "#f7fbfa",
    cacheBust: true,
    pixelRatio: surface.pixelRatio,
    width: REPORT_POSTER_LOGICAL_WIDTH,
    height: surface.height,
  });
  if (canvas.width !== surface.pngWidth || canvas.height !== surface.pngHeight) throw new Error("The poster image did not reach its required export resolution.");
  assertCanvasHasPosterContent(canvas);
  return canvas;
}

function downloadDataUrl(dataUrl, filename) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function exportPoster({ element, reportType, dataset, filters, format }) {
  const filename = reportExportFilename({
    reportType,
    outletName: dataset?.outlet?.name,
    year: filters?.year ?? dataset?.year ?? dataset?.period?.year,
    month: filters?.month ?? dataset?.period?.month,
    periodMode: dataset?.periodMode,
    format,
  });
  const posterCanvas = await capturePoster(element, reportType);
  const png = posterCanvas.toDataURL("image/png");

  if (format === "pdf") {
    const { jsPDF } = await import("jspdf");
    const yearly = reportType === "yearly";
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: yearly ? "mm" : "px",
      format: yearly ? "a4" : [REPORT_POSTER_LOGICAL_WIDTH, REPORT_POSTER_MONTHLY_LOGICAL_HEIGHT],
      ...(yearly ? {} : { hotfixes: ["px_scaling"] }),
      compress: true,
    });
    pdf.addImage(png, "PNG", 0, 0, yearly ? 210 : REPORT_POSTER_LOGICAL_WIDTH, yearly ? 297 : REPORT_POSTER_MONTHLY_LOGICAL_HEIGHT, undefined, "FAST");
    pdf.save(filename);
  } else {
    downloadDataUrl(png, filename);
  }

  return filename;
}
