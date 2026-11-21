const observedCount = value => Number.isSafeInteger(value) && value >= 0;
export const usageNumber = value => observedCount(value) ? value.toLocaleString() : '—';
const usd = new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:6});

export function formatVoiceDuration(seconds, missing = '—') {
 if (!observedCount(seconds)) return missing;
 const minutes = Math.floor(seconds / 60);
 const remainder = seconds % 60;
 return minutes ? `${minutes.toLocaleString()}m ${remainder}s` : `${remainder}s`;
}

export function formatVoiceCost(nanoUsd) {
 if (!observedCount(nanoUsd)) return 'Unavailable';
 if (nanoUsd > 0 && nanoUsd < 1000) return '< $0.000001';
 return usd.format(nanoUsd / 1e9);
}

export function voiceCostCoverage(session) {
 const state = ['estimated','partial'].includes(session.charge_status) && observedCount(session.estimated_cost_nano_usd)
  ? session.charge_status : 'unavailable';
 return {state, amount:formatVoiceCost(state==='unavailable'?null:session.estimated_cost_nano_usd)};
}
