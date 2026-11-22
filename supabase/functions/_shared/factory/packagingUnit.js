// Finished-product movements and balances are counted in packaging units in the warehouse register.
export function packagingTypeLabel(sku) {
  return sku?.packaging_type || sku?.package_type || 'Pack';
}
