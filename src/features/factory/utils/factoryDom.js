export function focusVisibleFactoryRowField(field, rowId) {
  setTimeout(() => {
    const nodes = [...document.querySelectorAll(`[data-factory-row-field="${field}"]`)];
    const node = nodes.find((candidate) => candidate.dataset.rowId === rowId && candidate.offsetParent !== null)
      || nodes.find((candidate) => candidate.dataset.rowId === rowId);
    node?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    node?.focus?.({ preventScroll: true });
  }, 0);
}
