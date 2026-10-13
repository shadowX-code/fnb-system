import { a4Dimensions, A4_TABLE_STYLES } from "./a4TableLayout.js";

export async function downloadA4TablePdf(elements, orientation, filename) {
  const { jsPDF } = await import("jspdf");
  const { toCanvas } = await import("html-to-image");
  await document.fonts?.ready;
  const { width, height } = a4Dimensions(orientation);
  const pdf = new jsPDF({ orientation, unit: "mm", format: "a4", compress: true });
  for (let i = 0; i < elements.length; i += 1) {
    const element = elements[i];
    const canvas = await toCanvas(element, { pixelRatio: 2, backgroundColor: "#ffffff", width: element.offsetWidth, height: element.offsetHeight });
    if (!canvas.width || !canvas.height) throw new Error("Unable to render an A4 page.");
    if (i) pdf.addPage("a4", orientation);
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, width, height, undefined, "FAST");
  }
  pdf.save(filename);
  return { pages: elements.length };
}

export async function printA4Table(elements, orientation) {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Allow pop-ups to open the print preview.");
  const { width, height } = a4Dimensions(orientation);
  popup.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Finished Goods</title><style>' + A4_TABLE_STYLES + '@page{size:' + width + 'mm ' + height + 'mm;margin:0}</style></head><body>' + elements.map(e => e.outerHTML).join("") + '</body></html>');
  popup.document.close();
  await popup.document.fonts?.ready;
  popup.focus(); popup.print();
}
