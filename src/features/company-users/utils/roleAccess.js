import { enabledActions, moduleRegistry, permissionCode } from "../../../../config/modules.ts";

const restaurantPermissionCodes = new Set(
  moduleRegistry
    .filter((module) => !module.workspace && !["People", "System"].includes(module.section))
    .flatMap((module) => enabledActions(module).map((action) => permissionCode(module.id, action))),
);

export function roleHasRestaurantPermissions(permissionCodes = []) {
  return permissionCodes.some((code) => restaurantPermissionCodes.has(code));
}

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

  if (role.outletScopeApplicable === false || (Array.isArray(role.permissions) && !roleHasRestaurantPermissions(role.permissions))) {
    return { mode: "none", outlets: [] };
  }

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
