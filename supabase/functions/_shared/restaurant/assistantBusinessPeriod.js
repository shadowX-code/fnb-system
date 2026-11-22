// Relative calendar periods use the outlet business calendar.
export function malaysiaPeriod(value, now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-MY',{year:'numeric',month:'numeric',
  timeZone:'Asia/Kuala_Lumpur'}).formatToParts(now).map(({type,value})=>[type,Number(value)]));
 const year=parts.year-(value==='previous_year'?1:0);
 if(value==='year'||value==='previous_year')return {from:year+'-01-01',to:year+'-12-31',year};
 const offset=Number(value==='previous_month');
 const start=new Date(Date.UTC(parts.year,parts.month-1-offset,1));
 const end=new Date(Date.UTC(parts.year,parts.month-offset,0));
 return {from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10),year:start.getUTCFullYear()};
}

export function relativeBusinessPeriod(writing){
 const phrase=writing.trim().replace(/[?!.。！]$/u,'');
 if(/^(?:this year|current year|tahun ini|今年|本年)$/iu.test(phrase))return 'year';
 if(/^(?:last year|previous year|tahun lepas|去年|上年)$/iu.test(phrase))return 'previous_year';
 if(/^(?:this month|current month|bulan ini|本月|这个月|這個月)$/iu.test(phrase))return 'month';
 if(/^(?:last month|previous month|bulan lepas|上月|上个月|上個月)$/iu.test(phrase))return 'previous_month';
 return null;
}
