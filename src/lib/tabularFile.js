// Tabular parsing only. Domain validation and import authority remain server-side.
export const TABULAR_LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, inflatedBytes: 32 * 1024 * 1024, columns: 100, rows: 500 });
export function parseCsv(text) {
 const matrix=[];let row=[],cell='',quoted=false;
 text=String(text).replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){row.push(cell.trim());cell='';}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());if(row.some(Boolean))matrix.push(row);row=[];cell='';}
  else cell+=c;
 }
 if(quoted)throw new Error('Unclosed quoted CSV field.');
 row.push(cell.trim());if(row.some(Boolean))matrix.push(row);
 return tabularRecords(matrix);
}
function tabularRecords(matrix,rowNumbers=[]) {
 const headers=Array.from(matrix[0]||[],c=>String(c??'').trim());
 if(!headers.length||headers.length>TABULAR_LIMITS.columns||headers.some(h=>!h)||new Set(headers.map(h=>h.toLowerCase())).size!==headers.length)throw new Error('Use unique, non-empty column headers (up to 100 columns).');
 const rows=matrix.slice(1).map((cells,index)=>{if(cells.length>headers.length)throw new Error(`Row ${index+2} has more values than headers.`);return Object.assign(Object.create(null),Object.fromEntries(headers.map((h,j)=>[h,String(cells[j]??'')])),{__row:rowNumbers[index+1]||index+2});});
 return {headers,rows};
}
function readUInt16(view, offset) { return view.getUint16(offset, true); }
function readUInt32(view, offset) { return view.getUint32(offset, true); }
function columnIndex(cellRef = "") {
  const letters = String(cellRef).match(/[A-Z]+/i)?.[0] ?? "A";
  return [...letters.toUpperCase()].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

async function inflateRaw(bytes) {
  if (!("DecompressionStream" in window)) throw new Error("XLSX parsing requires browser ZIP support. Please use CSV in this browser.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader=stream.getReader();const chunks=[];let size=0;
  try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>TABULAR_LIMITS.inflatedBytes){await reader.cancel();throw new Error('Workbook expands beyond the supported size.');}chunks.push(value);}}finally{reader.releaseLock();}
  const out=new Uint8Array(size);let offset=0;for(const part of chunks){out.set(part,offset);offset+=part.length;}return out;
}

async function unzipXlsx(buffer) {
  const view = new DataView(buffer);
  let eocdOffset = -1;
  for (let offset = view.byteLength - 22; offset >= Math.max(0, view.byteLength - 66000); offset -= 1) {
    if (readUInt32(view, offset) === 0x06054b50) { eocdOffset = offset; break; }
  }
  if (eocdOffset === -1) throw new Error("Unable to read XLSX workbook.");
  const entryCount = readUInt16(view, eocdOffset + 10);
  let centralOffset = readUInt32(view, eocdOffset + 16);
  const files = {}; let inflatedTotal=0,actualTotal=0;
  if(entryCount>500)throw new Error("Workbook has too many archive entries.");
  const decoder = new TextDecoder();
  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(view, centralOffset) !== 0x02014b50) break;
    const method = readUInt16(view, centralOffset + 10);
    const compressedSize = readUInt32(view, centralOffset + 20);
    const fileNameLength = readUInt16(view, centralOffset + 28);
    const extraLength = readUInt16(view, centralOffset + 30);
    const commentLength = readUInt16(view, centralOffset + 32);
    const localOffset = readUInt32(view, centralOffset + 42);
    const inflatedSize = readUInt32(view, centralOffset + 24);
    inflatedTotal+=inflatedSize;if(inflatedTotal>TABULAR_LIMITS.inflatedBytes)throw new Error("Workbook expands beyond the supported size.");
    const name = decoder.decode(new Uint8Array(buffer, centralOffset + 46, fileNameLength));
    if(!/^xl\/(sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml)$/.test(name)){centralOffset += 46 + fileNameLength + extraLength + commentLength;continue;}
    const localNameLength = readUInt16(view, localOffset + 26);
    const localExtraLength = readUInt16(view, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = new Uint8Array(buffer, dataOffset, compressedSize);
    const bytes = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : null;
    if(bytes){actualTotal+=bytes.length;if(actualTotal>TABULAR_LIMITS.inflatedBytes)throw new Error("Workbook expands beyond the supported size.");files[name]=decoder.decode(bytes);}
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }
  return files;
}

function textFromXlsxCell(cell, sharedStrings) {
  const type = cell.getAttribute("t");
  if (type === "s") return sharedStrings[Number(cell.querySelector("v")?.textContent ?? -1)] ?? "";
  if (type === "inlineStr") return [...cell.querySelectorAll("t")].map((item) => item.textContent ?? "").join("");
  return cell.querySelector("v")?.textContent ?? "";
}

export async function parseXlsx(file) {
  const files = await unzipXlsx(await file.arrayBuffer());
  const parser = new DOMParser();
  const sharedStringsXml = files["xl/sharedStrings.xml"];
  const sharedStrings = sharedStringsXml
    ? [...parser.parseFromString(sharedStringsXml, "application/xml").querySelectorAll("si")].map((node) => [...node.querySelectorAll("t")].map((item) => item.textContent ?? "").join(""))
    : [];
  const workbook=parser.parseFromString(files['xl/workbook.xml']||'<workbook/>','application/xml');
  const relationshipId=workbook.querySelector('sheets sheet')?.getAttribute('r:id');
  const relationships=parser.parseFromString(files['xl/_rels/workbook.xml.rels']||'<Relationships/>','application/xml');
  const target=[...relationships.querySelectorAll('Relationship')].find(r=>r.getAttribute('Id')===relationshipId)?.getAttribute('Target');
  const requestedSheet=target?.startsWith('/')?target.slice(1):target?`xl/${target}`:null;
  const sheetName=requestedSheet&&files[requestedSheet]?requestedSheet:Object.keys(files).filter(name=>/^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))[0];
  if (!sheetName) throw new Error("No worksheet found in XLSX file.");
  const sheet = parser.parseFromString(files[sheetName], "application/xml");
  if(sheet.querySelector("parsererror"))throw new Error("Unable to read worksheet XML.");
  const rowNumbers=[];
  const rawRows = [...sheet.querySelectorAll("sheetData row")].map((rowNode) => {
    const values = [];
    [...rowNode.querySelectorAll("c")].forEach((cell) => { const column=columnIndex(cell.getAttribute("r"));if(column>=TABULAR_LIMITS.columns)throw new Error("Workbook exceeds 100 columns.");if(cell.querySelector("f"))throw new Error("Replace spreadsheet formulas with values before importing.");values[column] = textFromXlsxCell(cell, sharedStrings); });
    if(values.some(cell=>String(cell??'').trim()))rowNumbers.push(Number(rowNode.getAttribute("r"))||rowNumbers.length+1);
    return values;
  }).filter((row) => row.some((cell) => String(cell ?? "").trim()));
  return {...tabularRecords(rawRows,rowNumbers),format:'xlsx',dateSystem:['1','true'].includes(workbook.querySelector('workbookPr')?.getAttribute('date1904'))?1904:1900};
}
export async function readTabularFile(file, {maxRows=TABULAR_LIMITS.rows}={}) {
 if(!file||file.size>TABULAR_LIMITS.bytes)throw new Error('Choose a CSV or XLSX file up to 10 MB.');
 const extension=file.name.split('.').pop().toLowerCase();
 if(!['csv','xlsx'].includes(extension))throw new Error('Choose a CSV or XLSX file.');
 const data=extension==='csv'?parseCsv(await file.text()):await parseXlsx(file);
 if(data.rows.length<1||data.rows.length>maxRows)throw new Error(`Import 1–${maxRows.toLocaleString('en-MY')} rows per file.`);
 return data;
}
export function safeCsvCell(value) {
 let text=String(value??'');if(/^[=+@\-\t\r]/.test(text))text="'"+text;
 return '"'+text.replace(/"/g,'""')+'"';
}
export function downloadCsv(filename,matrix) {
 const url=URL.createObjectURL(new Blob(['\uFEFF'+matrix.map(row=>row.map(safeCsvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
 const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
