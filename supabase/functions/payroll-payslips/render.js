// One Payroll-owned renderer. It accepts only the frozen employee-facing manifest.
export async function renderPayslip(manifest, { PDFDocument, StandardFonts, rgb, fontkit, unicodeFont }) {
  const pdf = await PDFDocument.create();
  const finalized = new Date(manifest.finalized_at);
  pdf.setCreationDate(finalized); pdf.setModificationDate(finalized);
  pdf.setTitle('Final Payslip'); pdf.setAuthor('FeedX Payroll');
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
    if (value == null || !Number.isFinite(Number(value))) throw new Error('Frozen payslip amount unavailable.');
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
  const heading = name => { ensure(50); y-=10; text(name,12,bold,teal); rule(); };
  const row = (label,amount,total=false) => {
    const lines=wrap(label,10,width-2*margin-125); ensure(lines.length*17+6);
    lines.forEach((line,index)=>page.drawText(line,{x:margin,y:y-index*17,size:10,font:total?bold:regular,color:ink}));
    const value=typeof amount==='string'?amount:money(amount);
    page.drawText(value,{x:width-margin-(total?bold:regular).widthOfTextAtSize(value,10),y,size:10,font:total?bold:regular,color:ink});
    y-=lines.length*17+6;
  };
  newPage();
  text(manifest.identity.employer,16,bold);
  if (manifest.identity.registration) text(`Registration: ${manifest.identity.registration}`,9,regular,muted);
  y-=12; text('FINAL PAYSLIP',22,bold,teal);
  const period = new Intl.DateTimeFormat('en-MY',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${manifest.period_start}T00:00:00Z`));
  text(period,12,bold); rule();
  text(`Employee: ${manifest.identity.employee_name}`);
  text(`Employee ID: ${manifest.identity.employee_code || 'Not recorded in finalized evidence'}`);
  if (manifest.identity.workplace) text(`Workplace: ${manifest.identity.workplace}`);
  text(`Period: ${manifest.period_start} - ${manifest.period_end}`,9,regular,muted);
  heading('Earnings');
  for (const line of manifest.earnings) row(line.label,line.amount);
  rule(); row('Gross Earnings',manifest.gross_earnings,true);
  heading('Deductions');
  for (const line of manifest.deductions) row(line.label,line.amount);
  for (const line of manifest.statutory) row(line.scheme==='pcb'?'PCB / MTD':`${line.scheme.toUpperCase()} Employee`,line.applicable===false?'N/A':line.amount);
  if (manifest.reimbursements?.length) { heading('Reimbursements'); for (const line of manifest.reimbursements) row(line.label,line.amount); }
  heading('Net Pay'); row('Net Pay',manifest.net_pay,true);
  y-=12; text('Payment settlement is recorded separately from this remuneration statement.',8,regular,muted);
  pdf.getPages().forEach((p,index)=>p.drawText(`Private and confidential | ${index+1} / ${pdf.getPageCount()}`,{x:margin,y:28,size:8,font:regular,color:muted}));
  return pdf.save();
}
