export function stockEquivalent(quantity, unit, stockUnit, factor) {
  if (!stockUnit || !factor || stockUnit === unit || quantity == null || quantity === '') return '';
  const amount = Number(quantity) * Number(factor);
  return Number.isFinite(amount) ? `${amount.toLocaleString('en-MY', { maximumFractionDigits: 9 })} ${stockUnit}` : '';
}

export function quantityInPurchaseUnit(quantity, previousFactor = 1, nextFactor = 1) {
  if (quantity === '' || quantity == null) return '';
  const equivalent = Number(quantity) * (Number(previousFactor) || 1) / (Number(nextFactor) || 1);
  const rounded = Math.round(equivalent * 1000) / 1000;
  return Number.isFinite(rounded) && Math.abs(rounded - equivalent) < 0.000000001 ? rounded : '';
}
