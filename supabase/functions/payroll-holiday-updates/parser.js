// Layout evidence, not a date seed. BKPP's 2026 annual PDF embeds its state
// headings as images. The exact source hash pins the visually verified order.
export const parserVersion = 'bkpp_proposal_v2';
const annualHash = '415023261014e30880b0fbb7a40c47a9655605183ef976204489d760fed769a3';
const stateOrder = ['MY-14','MY-15','MY-16','MY-01','MY-02','MY-03','MY-04','MY-05','MY-06','MY-08','MY-09','MY-07','MY-12','MY-13','MY-10','MY-11'];
const headings = ['W.P. K. LUMPUR','W.P. LABUAN','W.P. PUTRAJAYA','JOHOR','KEDAH','KELANTAN','MELAKA','N. SEMBILAN','PAHANG','PERAK','PERLIS','P. PINANG','SABAH','SARAWAK','SELANGOR','TERENGGANU'];
const months = ['Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'];
const normal = value => value.replace(/\s+/g,' ').trim();
const joinItems = items => normal(items.reduce((text,item,index)=>text+(index && item.x-(items[index-1].x+items[index-1].width)>Math.min(item.height,items[index-1].height)*0.18?' ':'')+item.text,''));
const datePattern = new RegExp(`^(\\d{1,2}) (${months.join('|')})$`, 'i');
const weekdays = ['Ahad','Isnin','Selasa','Rabu','Khamis','Jumaat','Sabtu'];
export function textLines(items) {
  const lines = [];
  for (const item of [...items].sort((a,b)=>b.y-a.y || a.x-b.x)) {
    let line = lines.find(l => Math.abs(l.y-item.y)<3);
    if (!line) { line={y:item.y,items:[]}; lines.push(line); }
    line.items.push(item);
  }
  return lines.map(l=>({...l,items:l.items.sort((a,b)=>a.x-b.x),text:joinItems(l.items)}));
}
function requiredSuggestion(name, scope) {
  const national = ['Hari Pekerja','Hari Kebangsaan','Hari Malaysia'];
  return national.includes(name) || /^Hari Keputeraan Rasmi .*Yang di-Pertuan Agong$/.test(name)
    || (scope==='state' && (/^Hari (Keputeraan (Sultan|Yang di-Pertuan Besar)|Ulang Tahun Keputeraan Raja|Jadi Yang di-Pertua Negeri)/.test(name) || name==='Hari Wilayah Persekutuan'));
}
export function parseOfficialPages(pages, year, hash) {
  const allText=pages.map(p=>textLines(p.items).map(l=>l.text).join('\n')).join('\n');
  const annual = /JADUAL HARI KELEPASAN AM PERSEKUTUAN DAN NEGERI/.test(allText);
  if (!annual) return parseSupplement(pages,year,allText);
  if (!new RegExp(`JADUAL HARI KELEPASAN AM (?:PERSEKUTUAN(?: DAN NEGERI)?|NEGERI) ${year}\\b`).test(allText)) throw new Error('Official calendar year could not be verified. Review the document.');
  const provisionalDates=new Set();
  for (const page of pages.slice(0,3)) for (const line of textLines(page.items)) {
    const m=line.text.match(new RegExp(`\\* (\\d{1,2}) (${months.join('|')})\\b`, 'i'));
    if (m) provisionalDates.add(`${year}-${String(months.findIndex(v=>v.toLowerCase()===m[2].toLowerCase())+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`);
  }
  const rows=[]; const seen=new Set(); let ordinal=0;
  // The combined table avoids duplicate federal/state presentations of the same day.
  for (const page of pages.filter(p=>p.page>=4)) {
    const lines=textLines(page.items);
    const columns=hash===annualHash ? stateOrder.map((code,i)=>({code,x:447+i*21}))
      : headings.map((name,i)=>{const h=page.items.find(item=>normal(item.text)===name);return h?{code:stateOrder[i],x:h.x}:null;});
    if (columns.some(c=>!c) || columns.length!==16) throw new Error('State column headings could not be verified. Manual source review is required.');
    const dateHeader=page.items.find(i=>i.text==='TARIKH' || i.text==='tarikh');
    // Gazette continuation pages retain the same visible, named column layout.
    const dateX=dateHeader?.x ?? (hash===annualHash?335:pages[3].items.find(i=>i.text==='TARIKH')?.x);
    const dayX=page.items.find(i=>i.text==='HARI' && i.x>dateX)?.x ?? (hash===annualHash?401:pages[3].items.find(i=>i.text==='HARI' && i.x>dateX)?.x);
    if (!dateX || !dayX) throw new Error('Date and weekday columns could not be verified.');
    const numberX=page.items.find(i=>/^BIL\.?$/i.test(i.text))?.x ?? pages[3].items.find(i=>/^BIL\.?$/i.test(i.text))?.x;
    if (!numberX) throw new Error('Holiday name column could not be verified.');
    const dateLines=lines.map(l=>({...l,dateText:joinItems(l.items.filter(i=>i.x>dateX-20 && i.x<dayX-10))})).filter(l=>datePattern.test(l.dateText));
    for (let index=0;index<dateLines.length;index++) {
      const line=dateLines[index], match=line.dateText.match(datePattern);
      const day=Number(match[1]), month=months.findIndex(m=>m.toLowerCase()===match[2].toLowerCase())+1;
      const date=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      if (new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date) throw new Error('Invalid official calendar date.');
      const upper=index? (dateLines[index-1].y+line.y)/2 : line.y+14;
      const lower=index+1<dateLines.length? (line.y+dateLines[index+1].y)/2 : line.y-14;
      const number=normal(lines.filter(l=>l.y<=upper && l.y>lower).map(l=>joinItems(l.items.filter(i=>i.x>=numberX-8 && i.x<=numberX+15))).join(' '));
      if (!/^\d+\.$/.test(number) || Number(number.slice(0,-1))!==++ordinal) throw new Error('Official table is incomplete or its row order changed. Review the source.');
      const name=normal(lines.filter(l=>l.y<=upper && l.y>lower).map(l=>joinItems(l.items.filter(i=>i.x>numberX+15 && i.x<dateX-25))).join(' ')).replace(/\s*\([PN]\)\s*(?:\/\s*\([PN]\))?\s*/g,' ').replace(/\s+\/\s*$/,'').replace(/\s*-\s*/g,'-').trim();
      if (!name || /^Catatan/i.test(name)) throw new Error('Holiday name could not be verified.');
      const marks=line.items.filter(i=>i.x>dayX+20 && /^[√✓-]$/.test(i.text));
      const applicable=[];
      for (const mark of marks) {
        const nearest=[...columns].sort((a,b)=>Math.abs(a.x-mark.x)-Math.abs(b.x-mark.x))[0];
        if (Math.abs(nearest.x-mark.x)>7) throw new Error('Holiday jurisdiction marker is outside a verified state column.');
        if (mark.text!=='-') applicable.push(nearest.code);
      }
      if (!applicable.length || new Set(applicable).size!==applicable.length) throw new Error('Holiday jurisdiction is missing or duplicated.');
      const weekday=joinItems(line.items.filter(i=>i.x>dayX-10 && i.x<columns[0].x-5));
      const issue=weekday!==weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()]?'Source date and weekday disagree. Verify against the document.':provisionalDates.has(date)?'Official source marks this date subject to change. Confirm the observed date against official evidence.':null;
      for (const code of applicable.length===16?[null]:applicable) {
        const scope=code?'state':'national',key=[date,name,code].join('|');
        if (seen.has(key)) throw new Error('Conflicting duplicate in annual table.'); seen.add(key);
        const suggestion=requiredSuggestion(name,scope);
        rows.push({date,name,scope,state_code:code,kind:'gazetted',source_locator:`page ${page.page}, combined table row ${index+1}`,uncertainty:issue,
          classification_review:suggestion, suggested_kind:suggestion?'required':null,
          review_reason:suggestion?'Confirm mandatory paid-holiday classification against the applicable employment law.':issue});
      }
    }
  }
  if (!rows.length || !textLines(pages.at(-1).items).some(l=>/^catatan\s*:/i.test(l.text))) throw new Error('The complete annual table could not be verified. Manual review is required.');
  return {rows,metadata:{parser:parserVersion,document_role:'annual',page_count:pages.length,source_rows:ordinal,jurisdiction_entries:rows.length}};
}
function parseSupplement(pages,year,text) {
  if (!/PEMBERITAHUAN DI BAWAH SEKSYEN 8/.test(text) || !/Semenanjung Malaysia/.test(text)) throw new Error('Unsupported official document layout. The captured source remains available for manual review.');
  const page=pages.find(p=>textLines(p.items).some(l=>l.text.includes('sekiranya Hari Raya Puasa')));
  if (!page) throw new Error('Additional-holiday conditions could not be verified.');
  const lines=textLines(page.items),rows=[];
  for (const line of lines) {
    const match=line.text.match(new RegExp(`^\\(([a-z])\\) (\\d{1,2}) Mac ${year}, sekiranya Hari Raya Puasa jatuh pada (\\d{1,2}) Mac ${year}`));
    if (!match) continue;
    for (const code of stateOrder.filter(c=>!['MY-12','MY-13','MY-15'].includes(c))) rows.push({date:`${year}-03-${match[2].padStart(2,'0')}`,name:'Hari Kelepasan Am Tambahan Sempena Hari Raya Puasa',scope:'state',state_code:code,kind:'special',source_locator:`page ${page.page}, paragraph (${match[1]})`,uncertainty:`Conditional alternative: applies only if Hari Raya Puasa falls on ${match[3]} March ${year}. Confirm the observed date and statutory entitlement; do not publish both alternatives.`});
  }
  if (!rows.length) throw new Error('No supported additional-holiday clauses were extracted.');
  return {rows,metadata:{parser:parserVersion,document_role:'supplement',page_count:pages.length}};
}
