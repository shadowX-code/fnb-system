import assert from 'node:assert/strict';

// Independent input is the authorized Finance Costs chart in operational mode,
// captured for this outlet and the same rolling window as the saved Assistant answer.
export function checkFinanceCostTrend(e,reply,s) {
 assert.equal(s.capture.method,'admin_view');
 assert(['cost_trend_6m','cost_trend_12m'].includes(s.scope.measure));
 const trend=e.cost_trend,months=s.scope.measure==='cost_trend_6m'?6:12;
 assert(s.scope.outlet_id&&s.outlet_name);assert.equal(trend.outlet.id,s.scope.outlet_id);assert.equal(trend.outlet.name,s.outlet_name);
 assert(reply.toLowerCase().includes(s.outlet_name.toLowerCase()));
 assert.equal(s.scope.compare_year,null);assert.equal(s.scope.compare_month,null);
 assert.equal(s.provider,'feedx_reporting');assert.equal(trend.currency,'MYR');assert.equal(trend.labour,'unavailable');assert.equal(trend.window_months,months);
 assert.equal(s.chart_rows.length,months);assert.equal(trend.months.length,months);
 const lines=reply.split('\n').map(line=>line.trim());
 assert(lines.some(line=>/^\|\s*(?:month|月份|bulan)\s*\|\s*(?:purchase-based COGS|采购口径成本|Kos berasaskan belian)\s*\|\s*(?:recorded OPEX|已记录营运费用|Belanja operasi direkod)\s*\|$/iu.test(line)));
 assert(!lines.filter(line=>!line.startsWith('|')).some(line=>/(?:RM|MYR|令吉)\s*-?\d|\d\s*(?:ringgit|令吉)/iu.test(line)),'Unexpected separate monetary claim');
 assert.match(reply,/labour is not separately classified|没有单独核算的人工成本|kos buruh tidak diasingkan/iu);
 const shown=lines.filter(line=>/^\|\s*\d{4}-\d{2}\s*\|/u.test(line));
 assert.equal(shown.length,months);
 for(let i=0;i<months;i++){
  const row=s.chart_rows[i],position=s.scope.year*12+s.scope.month-months+i;
  const period=Math.floor(position/12)+'-'+String(position%12+1).padStart(2,'0');
  assert.equal(row.period,period);assert.equal(row.labour,null);
  assert([row.cogs,row.opex].every(value=>value===null||Number.isFinite(value)));
  assert.deepEqual(trend.months[i],{period,purchase_based_cogs:row.cogs,recorded_opex:row.opex});
  const cells=shown[i].slice(1,-1).split('|').map(s=>s.trim());
  assert.equal(cells.length,3);assert.equal(cells[0],period);
  for(const [index,amount] of [[1,row.cogs],[2,row.opex]]){
   if(amount===null)assert.match(cells[index],/^(?:unavailable|tiada data|无可用数据)$/iu);
   else {assert.match(cells[index],/^RM-?\d+(?:\.\d{2})?$/u);assert.equal(Number(cells[index].slice(2)),Number(amount.toFixed(2)));}
  }
 }
}
