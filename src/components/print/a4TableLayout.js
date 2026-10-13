export const A4_PX_PER_MM = 96 / 25.4;
export function a4Dimensions(orientation) {
  return orientation === "portrait" ? { width: 210, height: 297 } : { width: 297, height: 210 };
}

// Wide tables continue in column bands rather than shrinking text below readable size.
export function a4ColumnBands(columns, orientation) {
  const usable = a4Dimensions(orientation).width - 24;
  const anchors = columns.filter(c => c.repeat);
  const remaining = columns.filter(c => !c.repeat);
  const bands = []; let band = [...anchors];
  let width = anchors.reduce((n, c) => n + c.minWidth, 0);
  for (const column of remaining) {
    if (width + column.minWidth > usable && band.length > anchors.length) { bands.push(band); band = [...anchors]; width = anchors.reduce((n, c) => n + c.minWidth, 0); }
    band.push(column); width += column.minWidth;
  }
  if (band.length) bands.push(band);
  return bands;
}

export function paginateA4Rows(heights, available) {
  const pages = []; let page = [], used = 0;
  heights.forEach((height, index) => {
    if (height > available) throw new Error("A record is too tall for A4. Reduce the selected columns or shorten its metadata.");
    if (page.length && used + height > available) { pages.push(page); page = []; used = 0; }
    page.push(index); used += height;
  });
  if (page.length) pages.push(page);
  return pages;
}

export const A4_TABLE_STYLES = `
.a4-sheet{box-sizing:border-box;position:relative;background:white;color:#17273f;padding:12mm;font-family:Arial,"Noto Sans CJK SC","Microsoft YaHei",sans-serif;font-size:11px;line-height:1.4;overflow:hidden}
.a4-sheet h3{font-size:17px;margin:0 0 6px;font-weight:600}
.a4-sheet p{font-size:10px;margin:0 0 12px;color:#405465}
.a4-sheet table{border-collapse:collapse;width:100%;table-layout:fixed}
.a4-sheet th,.a4-sheet td{border-bottom:1px solid #dbe3e8;padding:7px 6px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}
.a4-sheet th{font-weight:600;background:#f5f8fa}
.a4-sheet thead{display:table-header-group}
.a4-sheet tr{break-inside:avoid}
.a4-sheet footer{position:absolute;bottom:7mm;left:12mm;right:12mm;font-size:10px;color:#405465;text-align:right}
@media print{body{margin:0}.a4-sheet{break-after:page;margin:0!important}.a4-sheet:last-child{break-after:auto}}
`;
