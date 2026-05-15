function normalizeOutletMode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function mapSelectedOutlets(selectedOutletIds, outlets) {
  return selectedOutletIds.map((outletId) => {
    const outlet = outlets.find((item) => item.id === outletId);
    return outlet ?? { id: outletId, name: outletId };
  });
}

export function normalizeRoleOutletAccess(role, outlets = []) {
  if (!role) return { mode: "none", outlets: [] };

  const selectedOutletIds = role.selectedOutletIds ?? role.selected_outlet_ids ?? [];
  const selectedOutletNames = role.selectedOutletNames ?? role.selected_outlets ?? [];
  const mode = normalizeOutletMode(role.outletAccess ?? role.outlet_access_type ?? role.outlet_access);

  if (["all", "all_outlets", "alloutlets"].includes(mode)) {
    return { mode: "all", outlets: [] };
  }

  if (selectedOutletIds.length) {
    return { mode: "selected", outlets: mapSelectedOutlets(selectedOutletIds, outlets) };
  }

  if (selectedOutletNames.length) {
    return {
      mode: "selected",
      outlets: selectedOutletNames.map((name) => ({ id: name, name })),
    };
  }

  if (["selected", "selected_outlets"].includes(mode)) {
    return { mode: "none", outlets: [] };
  }

  return { mode: "none", outlets: [] };
}

export function getRoleOutletAccessMode(role) {
  return normalizeRoleOutletAccess(role).mode;
}
