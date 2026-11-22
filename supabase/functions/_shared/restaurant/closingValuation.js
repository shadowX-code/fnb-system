import {AssistantError} from '../assistantError.js';

// Reporting rolls up Inventory's published revisions. Legacy publications may
// have no attested item counts, but a known count must agree with their status.
export function verifyClosingCoverage({valuation_status:status,valued_item_count:valued,total_item_count:total}){
 const validCount=value=>value==null||(Number.isSafeInteger(value)&&value>=0);
 if(!['complete','partial'].includes(status)||!validCount(valued)||!validCount(total)||
   valued!=null&&total!=null&&(valued>total||(status==='complete')!==(valued===total)))
  throw new AssistantError('business_read_unavailable',503);
}
