export function dispatchAllocationTotal(allocations = []) {
  return allocations.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0);
}
