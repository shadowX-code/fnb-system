import { getDocument, Util } from 'npm:pdfjs-dist@4.8.69/legacy/build/pdf.mjs';
import { WorkerMessageHandler } from 'npm:pdfjs-dist@4.8.69/legacy/build/pdf.worker.mjs';
// PDF.js' supported in-process worker handler; Edge has no browser Worker.
(globalThis as any).pdfjsWorker = { WorkerMessageHandler };

export async function readPdfPages(bytes: Uint8Array) {
  const task = getDocument({data:bytes.slice(), isEvalSupported:false, useSystemFonts:false, disableFontFace:true, verbosity:0});
  try {
    const pdf = await task.promise;
    if (pdf.numPages>12) throw new Error('Official PDF exceeds the supported page limit. Review it manually.');
    const pages=[];
    let total=0;
    for (let number=1;number<=pdf.numPages;number++) {
      const page=await pdf.getPage(number), content=await page.getTextContent();
      const items=content.items.filter((i:any)=>typeof i.str==='string' && i.str.trim()) as any[];
      total+=items.length; if(total>64000) throw new Error('Official PDF text exceeds the supported limit.');
      const first=items.find(i=>i.str.trim().length>20);
      const rotation=first && Math.abs(first.transform[1])>Math.abs(first.transform[0])?90:0;
      const viewport=page.getViewport({scale:1,rotation});
      pages.push({page:number,width:viewport.width,height:viewport.height,items:items.map(i=>{
        const matrix=Util.transform(viewport.transform,i.transform);
        return {text:i.str,x:matrix[4],y:viewport.height-matrix[5],width:i.width,height:i.height};
      })});
      page.cleanup();
    }
    return pages;
  } finally { await task.destroy(); }
}
