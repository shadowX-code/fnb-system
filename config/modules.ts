export type ModuleAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "deactivate"
  | "approve"
  | "export"
  | "import"
  | "upload"
  | "manage"
  | "review"
  | "audit"
  | "submit"
  | "receive"
  | "complete"
  | "cancel"
  | "enable_login"
  | "reset_password";

export type AppModule = {
  id: string;
  section: string;
  label: string;
  route: string;
  icon?: string;
  sidebar: boolean;
  permissions: Partial<Record<ModuleAction, boolean>>;
};

export const permissionActionOrder: ModuleAction[] = [
  "view",
  "create",
  "edit",
  "delete",
  "deactivate",
  "enable_login",
  "reset_password",
  "approve",
  "review",
  "audit",
  "submit",
  "receive",
  "complete",
  "cancel",
  "manage",
  "import",
  "upload",
  "export",
];

export const permissionActionLabels: Record<ModuleAction, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  deactivate: "Deactivate",
  enable_login: "Enable Login",
  reset_password: "Reset Password",
  approve: "Approve",
  review: "Review",
  audit: "Audit",
  submit: "Submit",
  receive: "Receive",
  complete: "Complete",
  cancel: "Cancel",
  manage: "Manage",
  import: "Import",
  upload: "Upload",
  export: "Export",
};

export const moduleSectionOrder = ["Overview", "Sales", "Purchases", "Operations", "Inventory Control", "People", "System"];

export const moduleRegistry: AppModule[] = [
  {
    id: "dashboard",
    section: "Overview",
    label: "Dashboard",
    route: "/overview/dashboard",
    icon: "dashboard",
    sidebar: true,
    permissions: { view: true },
  },
  {
    id: "outlet-pnl",
    section: "Overview",
    label: "Outlet P&L",
    route: "/overview/outlet-pnl",
    icon: "outlet-pnl",
    sidebar: true,
    permissions: { view: true, export: true },
  },
  {
    id: "sp-dashboard",
    section: "Overview",
    label: "S&P Dashboard",
    route: "/sp-dashboard",
    icon: "dashboard",
    sidebar: true,
    permissions: { view: true },
  },
  {
    id: "product_analytics",
    section: "Overview",
    label: "Product Analytics",
    route: "/product-analytics",
    icon: "product-analytics",
    sidebar: true,
    permissions: { view: true, upload: true, export: true, manage: true },
  },
  {
    id: "sales-input",
    section: "Sales",
    label: "Sales Input",
    route: "/sales/input",
    icon: "sales-input",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, delete: true },
  },
  {
    id: "sales-comparison",
    section: "Overview",
    label: "Sales Comparison",
    route: "/sales/comparison",
    icon: "sales-comparison",
    sidebar: true,
    permissions: { view: true, export: true },
  },
  {
    id: "sales-channels",
    section: "Sales",
    label: "Sales Channels",
    route: "/sales/channels",
    icon: "settings",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, delete: true },
  },
  {
    id: "tax-settings",
    section: "Sales",
    label: "Tax Settings",
    route: "/sales/tax-settings",
    icon: "settings",
    sidebar: true,
    permissions: { view: true, edit: true },
  },
  {
    id: "purchase-input",
    section: "Purchases",
    label: "Purchase Input",
    route: "/purchases/input",
    icon: "purchase-input",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, delete: true, approve: true },
  },
  {
    id: "purchase-comparison",
    section: "Overview",
    label: "Purchase Comparison",
    route: "/purchases/comparison",
    icon: "purchase-comparison",
    sidebar: true,
    permissions: { view: true, export: true },
  },
  {
    id: "suppliers",
    section: "Purchases",
    label: "Suppliers",
    route: "/purchases/suppliers",
    icon: "suppliers",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, delete: true },
  },
  {
    id: "purchase-categories",
    section: "Purchases",
    label: "Purchase Categories",
    route: "/purchases/categories",
    icon: "settings",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, delete: true },
  },
  {
    id: "employees",
    section: "People",
    label: "Employees",
    route: "/people/employees",
    icon: "users",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, deactivate: true, enable_login: true, reset_password: true },
  },
  {
    id: "job-positions",
    section: "People",
    label: "Job Positions",
    route: "/people/job-positions",
    icon: "job-positions",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, delete: true },
  },
  {
    id: "departments",
    section: "People",
    label: "Departments",
    route: "/people/departments",
    icon: "departments",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, delete: true },
  },
  {
    id: "roles",
    section: "People",
    label: "Roles & Permissions",
    route: "/system/roles",
    icon: "roles",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, delete: true },
  },
  {
    id: "operating-expenses",
    section: "Operations",
    label: "Operating Expenses",
    route: "/operations/operating-expenses",
    icon: "operating-expenses",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, delete: true },
  },
  {
    id: "duty-roster",
    section: "Operations",
    label: "Duty Roster",
    route: "/operations/duty-roster",
    icon: "duty-roster",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, delete: true, manage: true, export: true },
  },
  {
    id: "asset_tracking",
    section: "Operations",
    label: "Asset Tracking",
    route: "/operations/asset-tracking",
    icon: "asset-tracking",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, delete: true, manage: true, export: true },
  },
  {
    id: "inventory_dashboard",
    section: "Inventory Control",
    label: "Dashboard",
    route: "/inventory/dashboard",
    icon: "inventory-control",
    sidebar: true,
    permissions: { view: true },
  },
  {
    id: "inventory_master",
    section: "Inventory Control",
    label: "Master Inventory",
    route: "/inventory/master",
    icon: "inventory-master",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, delete: true, import: true, export: true },
  },
  {
    id: "inventory_categories",
    section: "Inventory Control",
    label: "Inventory Categories",
    route: "/inventory/categories",
    icon: "purchase-categories",
    sidebar: false,
    permissions: { view: true, create: true, edit: true, delete: true },
  },
  {
    id: "inventory_uoms",
    section: "Inventory Control",
    label: "Inventory UOMs",
    route: "/inventory/uoms",
    icon: "settings",
    sidebar: false,
    permissions: { view: true, create: true, edit: true, delete: true },
  },
  {
    id: "inventory_par_levels",
    section: "Inventory Control",
    label: "Par Levels",
    route: "/inventory/par-levels",
    icon: "inventory-master",
    sidebar: true,
    permissions: { view: true, edit: true, export: true },
  },
  {
    id: "inventory_groups",
    section: "Inventory Control",
    label: "Stock Check Groups",
    route: "/inventory/groups",
    icon: "inventory-groups",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, delete: true },
  },
  {
    id: "inventory_stock_check",
    section: "Inventory Control",
    label: "Stock Check",
    route: "/inventory/stock-check",
    icon: "inventory-stock-check",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, review: true, audit: true, export: true },
  },
  {
    id: "inventory_orders",
    section: "Inventory Control",
    label: "Purchase Orders",
    route: "/inventory/purchase-orders",
    icon: "inventory-orders",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, submit: true, receive: true, complete: true, cancel: true, export: true },
  },
  {
    id: "inventory_movements",
    section: "Inventory Control",
    label: "Inventory Movements",
    route: "/inventory/movements",
    icon: "inventory-movements",
    sidebar: true,
    permissions: { view: true, create: true, export: true },
  },
  {
    id: "inventory_waste",
    section: "Inventory Control",
    label: "Waste & Variance",
    route: "/inventory/waste",
    icon: "inventory-waste",
    sidebar: true,
    permissions: { view: true, create: true, manage: true, export: true },
  },
  {
    id: "inventory_recipes",
    section: "Inventory Control",
    label: "Recipes & Usage",
    route: "/inventory/recipes",
    icon: "inventory-recipes",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, delete: true, manage: true, export: true },
  },
  {
    id: "outlets",
    section: "Operations",
    label: "Outlets",
    route: "/operations/outlets",
    icon: "outlets",
    sidebar: true,
    permissions: { view: true, create: true, edit: true, delete: true },
  },
  {
    id: "alerts",
    section: "Overview",
    label: "Alerts & Insights",
    route: "/operations/alerts",
    icon: "alerts",
    sidebar: true,
    permissions: { view: true, manage: true },
  },
  {
    id: "outlet_duty_roster",
    section: "Overview",
    label: "Outlet Duty Roster",
    route: "/outlet-duty-roster",
    icon: "duty-roster",
    sidebar: true,
    permissions: { view: true, export: true },
  },
  {
    id: "data-import",
    section: "Operations",
    label: "Data Import",
    route: "/operations/data-import",
    icon: "data-import",
    sidebar: true,
    permissions: { view: true, import: true },
  },
  {
    id: "data-health",
    section: "Operations",
    label: "Data Health",
    route: "/operations/data-health",
    icon: "data-health",
    sidebar: true,
    permissions: { view: true },
  },
  {
    id: "audit-logs",
    section: "System",
    label: "Audit Logs",
    route: "/system/audit-logs",
    icon: "audit-logs",
    sidebar: true,
    permissions: { view: true, export: true },
  },
];

export function permissionPrefix(moduleId: string) {
  return moduleId.replace(/-/g, "_");
}

export function permissionCode(moduleId: string, action: ModuleAction) {
  return `${permissionPrefix(moduleId)}.${action}`;
}

export function viewPermission(moduleId: string) {
  return permissionCode(moduleId, "view");
}

export function enabledActions(module: AppModule) {
  return permissionActionOrder.filter((action) => module.permissions[action]);
}

export function getModuleById(moduleId: string) {
  return moduleRegistry.find((module) => module.id === moduleId);
}

export function getModuleLabel(moduleId: string) {
  return getModuleById(moduleId)?.label ?? moduleId;
}

export function getPermissionDefinitions() {
  return moduleRegistry.flatMap((module) =>
    enabledActions(module).map((action) => ({
      code: permissionCode(module.id, action),
      module: module.label,
      section: module.section,
      action,
      description: `${permissionActionLabels[action]} ${module.label}.`,
    })),
  );
}

export function getPermissionGroups() {
  const groups = moduleRegistry.reduce((groups, module) => {
    const actions = Object.fromEntries(
      enabledActions(module).map((action) => [
        action,
        {
          label: `${permissionActionLabels[action]} ${module.label}`,
          codes: action === "view" ? [permissionCode(module.id, action)] : [permissionCode(module.id, "view"), permissionCode(module.id, action)],
        },
      ]),
    );
    const group = groups.find((item) => item.label === module.section);
    const row = { key: module.id, label: module.label, actions };
    if (group) group.modules.push(row);
    else groups.push({ label: module.section, modules: [row] });
    return groups;
  }, [] as Array<{ label: string; modules: Array<{ key: string; label: string; actions: Record<string, { label: string; codes: string[] }> }> }>);

  return groups.sort((a, b) => moduleSectionOrder.indexOf(a.label) - moduleSectionOrder.indexOf(b.label));
}

export function getSidebarSections() {
  const sections = moduleRegistry
    .filter((module) => module.sidebar)
    .reduce((sections, module) => {
      const section = sections.find((item) => item.label === module.section);
      const item = { id: module.id, label: module.label };
      if (section) section.items.push(item);
      else sections.push({ label: module.section, items: [item] });
      return sections;
    }, [] as Array<{ label: string; items: Array<{ id: string; label: string }> }>);

  return sections.sort((a, b) => moduleSectionOrder.indexOf(a.label) - moduleSectionOrder.indexOf(b.label));
}

export function getAuditScopes() {
  return moduleRegistry.map((module) => ({
    id: module.id,
    label: module.label,
    section: module.section,
  }));
}
