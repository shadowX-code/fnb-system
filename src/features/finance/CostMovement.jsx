import { FinanceDisclosure } from './FinanceVisualSystem.jsx';
import { financialSemantics, financialValue, growthValue, movementValue } from './presentation.js';

/** A shared spend / revenue / ratio comparison; direction is determined by cost intensity. */
export default function CostMovement({ row }) {
  return <div className={`finance-cost-movement is-${row.direction}`}>
    <div className="finance-cost-ratio-path"><span><small>Prior share</small><strong>{financialValue(row.previousRatio)}</strong></span><span aria-hidden="true">→</span><span><small>Current share</small><strong>{financialValue(row.currentRatio)}</strong></span><span className="finance-cost-ratio-effect"><strong>{movementValue(row.ratioMovement, 'percent')}</strong><small>{row.direction === 'pressure' ? 'Higher revenue share' : row.direction === 'improvement' ? 'Lower revenue share' : row.direction === 'stable' ? 'Broadly stable share' : 'Ratio comparison unavailable'}</small></span></div>
    <dl className="finance-cost-growth"><div><dt>Cost growth</dt><dd>{growthValue(row.growth)}</dd></div><div><dt>Revenue growth</dt><dd>{growthValue(row.revenueGrowth)}</dd></div><div><dt>EBITDA contribution</dt><dd>{movementValue({ value: row.contribution })}</dd></div></dl>
    <FinanceDisclosure label="Ratio & attribution basis"><p>Current share: {financialSemantics(row.currentRatio)} · {row.currentRatio.completeness}. Cost input: {financialSemantics(row.current)}; Revenue input: {financialSemantics(row.currentRevenue)}.</p><p>Prior share: {financialSemantics(row.previousRatio)} · {row.previousRatio.completeness}. Cost input: {financialSemantics(row.previous)}; Revenue input: {financialSemantics(row.previousRevenue)}.</p><p>{row.currentRatio.reason} {row.ratioMovement.reason}</p><p>Signed EBITDA contribution requires the supplied driver relationship to reconcile in both periods. Classified contributions also require complete parent coverage. Unavailable contribution is not zero.</p></FinanceDisclosure>
  </div>;
}
