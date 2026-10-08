import { useEffect, useState } from 'react';
import { navigateAdminRoute } from '../../app/routeOwnership.js';

// Ephemeral presentation intent only. Live and simulated trees never exchange financial evidence.
let intent = null;
export function openOverviewAnalysis(dataset, outlet) {
  intent = {view:outlet?'Profit Drivers':'Outlets',demo:dataset.demo, month:dataset.period.start.slice(0,7), scope:outlet ? {kind:'outlet',id:outlet.id,legalEntityId:outlet.legalEntityId} : dataset.scope, at:Date.now()};
  navigateAdminRoute('finance_analysis');
}
export function useOverviewAnalysisIntent(demo, enabled = true) {
  const [initial] = useState(() => enabled && intent?.demo === demo && Date.now()-intent.at<60000 ? intent : null);
  useEffect(() => {if(initial && intent===initial)intent=null;},[initial]);
  return initial;
}
