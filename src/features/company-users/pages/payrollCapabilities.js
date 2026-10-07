// UI projection only. Server commands enforce the same action plus existing scope/lifecycle.
export const payrollActionCodes = ["setup", "statutory", "prepare", "review_time", "treat_ph", "adjust", "configure", "configure_holidays", "publish_holidays", "record_payment"];
export function payrollCapabilities(hasPermission) {
  const result = Object.fromEntries(payrollActionCodes.map(action => [action, hasPermission(`payroll.${action}`)]));
  result.recalculate = payrollActionCodes.filter(action => action !== "record_payment").some(action => result[action]);
  result.syncTime = result.prepare || result.review_time;
  return result;
}
