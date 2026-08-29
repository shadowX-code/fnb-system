export const REPORT_POSTER_LOGICAL_WIDTH = 1200;
const REPORT_POSTER_LOGICAL_HEIGHT = 1500;

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

function getPosterNode(element) {
  if (element?.matches?.(".report-poster")) return element;
  return element?.querySelector?.(".report-poster") ?? null;
}

async function capturePoster(element) {
  const poster = getPosterNode(element);
  if (!poster) throw new Error("The generated poster is no longer available for export.");

  const exportCanvas = poster.cloneNode(true);
  exportCanvas.setAttribute("aria-hidden", "true");
  Object.assign(exportCanvas.style, {
    position: "fixed",
    left: "-20000px",
    top: "0",
    width: `${REPORT_POSTER_LOGICAL_WIDTH}px`,
    height: `${REPORT_POSTER_LOGICAL_HEIGHT}px`,
    maxWidth: "none",
    aspectRatio: "4 / 5",
    pointerEvents: "none",
  });
  document.body.appendChild(exportCanvas);

  try {
    await document.fonts?.ready;
    const { toPng } = await import("html-to-image");
    return await toPng(exportCanvas, {
      backgroundColor: "#f7fbfa",
      cacheBust: true,
      pixelRatio: 2,
      width: REPORT_POSTER_LOGICAL_WIDTH,
      height: REPORT_POSTER_LOGICAL_HEIGHT,
    });
  } finally {
    exportCanvas.remove();
  }
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
  const png = await capturePoster(element);

  if (format === "pdf") {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "px",
      format: [REPORT_POSTER_LOGICAL_WIDTH, REPORT_POSTER_LOGICAL_HEIGHT],
      hotfixes: ["px_scaling"],
      compress: true,
    });
    pdf.addImage(png, "PNG", 0, 0, REPORT_POSTER_LOGICAL_WIDTH, REPORT_POSTER_LOGICAL_HEIGHT, undefined, "FAST");
    pdf.save(filename);
  } else {
    downloadDataUrl(png, filename);
  }

  return filename;
}
