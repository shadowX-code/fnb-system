/**
 * Keeps Job Orders mutation refreshes bound to the latest shared-listing
 * actions without making the bridge itself a changing dependency.
 */
export function createJobOrdersListingBridge(retryRef, updateLoadedSnapshotRef) {
  return {
    bind({ retry, updateLoadedSnapshot } = {}) {
      retryRef.current = retry;
      updateLoadedSnapshotRef.current = updateLoadedSnapshot;
    },
    retry: (...args) => retryRef.current?.(...args),
    updateLoadedSnapshot: (...args) => updateLoadedSnapshotRef.current?.(...args),
  };
}
