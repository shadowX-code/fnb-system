export type AuditModule =
  | "authentication"
  | "access-control"
  | "people"
  | "sales"
  | "purchases"
  | "operations";

export const auditModuleLabels: Record<AuditModule, string> = {
  authentication: "Authentication",
  "access-control": "System",
  people: "People",
  sales: "Sales",
  purchases: "Purchases",
  operations: "Operations",
};

export const trackedAuditActions: Record<AuditModule, string[]> = {
  authentication: [
    "login_success",
    "login_failed",
    "logout",
    "password_reset",
    "invite_sent",
    "verification_completed",
  ],
  "access-control": [
    "role_created",
    "role_updated",
    "permission_changed",
    "outlet_access_changed",
    "employee_access_enabled",
    "employee_access_disabled",
  ],
  people: [
    "employee_created",
    "employee_updated",
    "employment_status_changed",
    "position_changed",
    "department_changed",
  ],
  sales: [
    "sales_created",
    "sales_updated",
    "sales_deleted",
    "sales_import_completed",
    "sales_import_failed",
    "tax_setting_updated",
    "sales_channel_updated",
  ],
  purchases: [
    "purchase_created",
    "purchase_updated",
    "purchase_approved",
    "purchase_deleted",
    "supplier_updated",
    "purchase_category_updated",
    "purchase_import_completed",
    "purchase_import_failed",
  ],
  operations: [
    "outlet_updated",
    "data_import",
    "export_download",
    "data_health_action",
  ],
};

export const ignoredAuditActions = [
  "page_view",
  "dropdown_click",
  "tab_switch",
  "search",
  "modal_open",
  "passive_navigation",
];

export const auditActionLabels: Record<string, string> = Object.fromEntries(
  Object.values(trackedAuditActions)
    .flat()
    .map((action) => [
      action,
      action
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
    ]),
);

export function getAuditModuleLabel(module: string) {
  return auditModuleLabels[module as AuditModule] ?? module;
}

export function getAuditActionLabel(action: string) {
  return auditActionLabels[action] ?? action;
}

export function shouldTrackAuditAction(module: AuditModule, action: string) {
  return trackedAuditActions[module]?.includes(action) ?? false;
}
