// One Payroll-owned A4 layout for transient Admin drafts and immutable finals.
export async function renderPayslip(manifest, { PDFDocument, StandardFonts, rgb, fontkit, unicodeFont }) {
  const pdf = await PDFDocument.create();
  const finalized = new Date(manifest.finalized_at);
  pdf.setCreationDate(finalized); pdf.setModificationDate(finalized);
  pdf.setTitle(manifest.draft ? 'Draft Payslip - Not Final' : 'Payslip'); pdf.setAuthor(manifest.identity.employer);
  let regular, bold;
  if (unicodeFont) {
    pdf.registerFontkit(fontkit);
    regular = await pdf.embedFont(unicodeFont, { subset: true }); bold = regular;
  } else {
    regular = await pdf.embedFont(StandardFonts.Helvetica);
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  }
  const width = 595.28, height = 841.89, margin = 48;
  let page, y;
  const ink = rgb(.06,.17,.19), muted = rgb(.28,.37,.39), teal = rgb(0,.43,.45);
  const money = value => {
    if (value == null) return '—';
    if (!Number.isFinite(Number(value))) throw new Error('Payslip amount unavailable.');
    return `RM ${Number(value).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const wrap = (value, size, available) => {
    const lines = []; let line = '';
    for (const character of String(value ?? '')) {
      if (character === '\n' || regular.widthOfTextAtSize(line + character, size) > available) { lines.push(line); line = character === '\n' ? '' : character; }
      else line += character;
    }
    lines.push(line); return lines;
  };
  const newPage = () => { page = pdf.addPage([width,height]); y = height-margin; };
  const ensure = heightNeeded => { if (y-heightNeeded<margin+24) newPage(); };
  const text = (value,size=10,font=regular,color=ink,available=width-2*margin) => {
    for (const line of wrap(value,size,available)) { ensure(size+7); page.drawText(line,{x:margin,y,size,font,color}); y-=size+7; }
  };
  const rule = () => { ensure(12); page.drawLine({start:{x:margin,y},end:{x:width-margin,y},thickness:.5,color:rgb(.8,.86,.86)}); y-=14; };
  const heading = name => { ensure(55); y-=6; text(name,11,bold,teal); rule(); };
  const row = (label,amount,total=false) => {
    const lines=wrap(label,10,width-2*margin-125); ensure(lines.length*14+4);
    lines.forEach((line,index)=>page.drawText(line,{x:margin,y:y-index*14,size:10,font:total?bold:regular,color:ink}));
    const value=typeof amount==='string'?amount:money(amount);
    page.drawText(value,{x:width-margin-(total?bold:regular).widthOfTextAtSize(value,10),y,size:10,font:total?bold:regular,color:ink});
    y-=lines.length*14+4;
  };
  newPage();
  text(manifest.identity.employer,16,bold);
  if (manifest.identity.registration) text(`Registration: ${manifest.identity.registration}`,9,regular,muted);
  y-=8; text('PAYSLIP',18,bold,teal);
  const period = new Intl.DateTimeFormat('en-MY',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${manifest.period_start}T00:00:00Z`));
  text(period,12,bold);
  if (manifest.draft) text('DRAFT · NOT FINAL',11,bold,teal);
  rule();
  text(`Employee: ${manifest.identity.employee_name}`);
  text(`Employee Code: ${manifest.identity.employee_code || '—'}`);
  if (manifest.identity.position) text(`Position: ${manifest.identity.position}`);
  if (manifest.identity.workplace) text(`Workplace: ${manifest.identity.workplace}`);
  if (manifest.pay_basis) text(`Pay Basis: ${manifest.pay_basis === 'hourly' ? 'Hourly' : 'Monthly'}`,9,regular,muted);
  y-=8;
  const totalDeductions=manifest.total_deductions ?? (manifest.net_pay == null ? null : Number(manifest.gross_earnings)+
    (manifest.reimbursements || []).reduce((sum,line)=>sum+Number(line.amount),0)-Number(manifest.net_pay));
  ensure(50);
  [['Gross Pay',manifest.gross_earnings],['Total Deductions',totalDeductions],['Net Pay',manifest.net_pay]].forEach(([label,value],index)=>{
    const x=margin+index*(width-2*margin)/3;
    page.drawText(label,{x,y,size:9,font:regular,color:muted});
    page.drawText(money(value),{x,y:y-19,size:index===2?15:12,font:bold,color:index===2?teal:ink});
  });y-=43;
  heading('Earnings');
  const earningRow=line=>{
    const units=line.minutes != null ? `${(Number(line.minutes)/60).toFixed(2)} h${line.rate != null ? ` x ${money(line.rate)}` : ''}${Number(line.multiplier)>1 ? ` x ${line.multiplier}` : ''}` : line.units != null ? String(line.units) : '';
    const labels=wrap(line.label,10,275), contexts=wrap(units,9,100);
    ensure(Math.max(labels.length,contexts.length)*14+4);
    labels.forEach((label,index)=>page.drawText(label,{x:margin,y:y-index*14,size:10,font:regular,color:ink}));
    contexts.forEach((label,index)=>page.drawText(label,{x:margin+285,y:y-index*14,size:9,font:regular,color:muted}));
    const value=money(line.amount);page.drawText(value,{x:width-margin-regular.widthOfTextAtSize(value,10),y,size:10,font:regular,color:ink});
    y-=Math.max(labels.length,contexts.length)*14+4;
  };
  ensure(24);
  page.drawText('DESCRIPTION',{x:margin,y,size:8,font:bold,color:muted});
  page.drawText('UNITS / RATE',{x:margin+285,y,size:8,font:bold,color:muted});
  page.drawText('AMOUNT',{x:width-margin-bold.widthOfTextAtSize('AMOUNT',8),y,size:8,font:bold,color:muted});
  y-=20;
  for (const line of manifest.earnings) earningRow(line);
  rule(); row('Gross Earnings',manifest.gross_earnings,true);
  heading('Deductions');
  for (const line of manifest.deductions) row(line.label,line.amount);
  for (const line of manifest.statutory) row(line.scheme==='pcb'?'PCB / MTD':`${line.scheme.toUpperCase()} Employee`,line.applicable===false?'N/A':line.amount);
  rule();row('Total Deductions',totalDeductions,true);
  if (manifest.reimbursements?.length) { heading('Reimbursements'); for (const line of manifest.reimbursements) row(line.label,line.amount); }
  heading('NET PAY'); row('Net Pay',manifest.net_pay,true);
  if (manifest.statutory.some(line=>line.employer_amount != null && line.scheme!=='pcb')) {
    heading('Employer Contributions');
    for (const line of manifest.statutory.filter(line=>line.scheme!=='pcb')) row(`${line.scheme.toUpperCase()} Employer`,line.applicable===false?'N/A':line.employer_amount);
    text('Employer contributions do not reduce Net Pay.',8,regular,muted);
  }
  y-=12;text(`${manifest.draft?'Calculated':'Finalized'} ${finalized.toISOString().slice(0,10)} · System-generated payroll document.`,8,regular,muted);
  pdf.getPages().forEach((p,index)=>p.drawText(`Private and confidential | ${index+1} / ${pdf.getPageCount()}`,{x:margin,y:28,size:8,font:regular,color:muted}));
  return pdf.save();
}
