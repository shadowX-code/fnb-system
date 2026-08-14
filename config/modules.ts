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
  | "adjust"
  | "finalize"
  | "publish"
  | "moderate"
  | "mark_paid"
  | "assess"
  | "certify"
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
  // Internal modules may supply data or modal workflows without being valid hash-route destinations.
  routable?: boolean;
  workspace?: "restaurant" | "factory" | "crew";
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
  "adjust",
  "finalize",
  "publish",
  "moderate",
  "mark_paid",
  "assess",
  "certify",
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
  adjust: "Adjust",
  finalize: "Finalize",
  publish: "Publish",
  moderate: "Moderate",
  mark_paid: "Mark Paid",
  assess: "Assess",
  certify: "Certify",
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

export type WorkspaceKey = "restaurant" | "factory" | "crew";

export const workspaceLabels: Record<WorkspaceKey, string> = {
  restaurant: "Restaurant",
  factory: "Factory",
  crew: "Crew",
};

export const moduleSectionOrder = [
  "Overview",
  "Sales",
  "Purchases",
  "Operations",
  "Inventory Control",
  "Factory",
  "Warehouse",
  "Raw Material",
  "Master Data",
  "People",
  "Workforce",
  "System",
  "Learning",
  "Growth",
  "Knowledge",
  "Performance",
  "Reward",
  "Documents",
];

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
    permissions: { view: true, create: true, edit: true, delete: true, import: true },
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
    permissions: { view: true, create: true, edit: true, delete: true, approve: true, import: true },
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
    label: "Supplier Categories",
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
    label: "Duty Roster (Legacy Route)",
    route: "/operations/duty-roster",
    icon: "duty-roster",
    sidebar: false,
    permissions: {},
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
    routable: false,
    permissions: { view: true, create: true, edit: true, delete: true },
  },
  {
    id: "inventory_uoms",
    section: "Inventory Control",
    label: "Inventory UOMs",
    route: "/inventory/uoms",
    icon: "settings",
    sidebar: false,
    routable: false,
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
    label: "Wastage",
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
    id: "recipe_intelligence",
    section: "Inventory Control",
    label: "Recipe Intelligence",
    route: "/inventory/recipe-intelligence",
    icon: "recipe-intelligence",
    sidebar: true,
    permissions: { view: true, manage: true },
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
    label: "Outlet Duty Roster (Legacy Route)",
    route: "/outlet-duty-roster",
    icon: "duty-roster",
    sidebar: false,
    permissions: {},
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
  {
    id: "factory_dashboard",
    section: "Factory",
    label: "Dashboard",
    route: "/factory/dashboard",
    icon: "factory-dashboard",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, export: true },
  },
  {
    id: "factory_production_planning",
    section: "Factory",
    label: "Production Planning",
    route: "/factory/production-planning",
    icon: "factory-production-planning",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, export: true },
  },
  {
    id: "factory_job_orders",
    section: "Factory",
    label: "Production Overview",
    route: "/factory/production-overview",
    icon: "factory-production-overview",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, create: true, edit: true, delete: true, cancel: true, complete: true, export: true },
  },
  {
    id: "factory_job_order_records",
    section: "Factory",
    label: "Job Order",
    route: "/factory/job-orders",
    icon: "factory-job-order-records",
    sidebar: true,
    workspace: "factory",
    permissions: {},
  },
  {
    id: "factory_production",
    section: "Factory",
    label: "Production Records",
    route: "/factory/production",
    icon: "factory-production",
    sidebar: false,
    workspace: "factory",
    permissions: { view: true, create: true, edit: true, complete: true, export: true },
  },
  {
    id: "factory_production_reports",
    section: "Factory",
    label: "Production Reports",
    route: "/factory/reports",
    icon: "factory-reports",
    sidebar: false,
    workspace: "factory",
    permissions: { view: true, export: true },
  },
  {
    id: "factory_batch_traceability",
    section: "Factory",
    label: "Batch Traceability",
    route: "/factory/batch-traceability",
    icon: "factory-batch-traceability",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, export: true },
  },
  {
    id: "factory_finished_goods",
    section: "Warehouse",
    label: "Finished Goods",
    route: "/factory/finished-goods",
    icon: "factory-finished-goods",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, create: true, edit: true, export: true },
  },
  {
    id: "factory_finished_goods_dispatch",
    section: "Warehouse",
    label: "Finished Goods Dispatch",
    route: "/factory/finished-goods-dispatch",
    icon: "factory-finished-goods-dispatch",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, create: true, edit: true, delete: true, complete: true, export: true },
  },
  {
    id: "factory_product_movements",
    section: "Warehouse",
    label: "Product Movements",
    route: "/factory/product-movements",
    icon: "factory-product-movements",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, export: true },
  },
  {
    id: "factory_product_stock_check",
    section: "Warehouse",
    label: "Product Stock Check",
    route: "/factory/product-stock-check",
    icon: "factory-product-stock-check",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, create: true, edit: true, submit: true, approve: true, export: true },
  },
  {
    id: "factory_raw_receiving",
    section: "Raw Material",
    label: "Raw Material Receiving",
    route: "/factory/raw-receiving",
    icon: "factory-raw-receiving",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, create: true, edit: true, delete: true, export: true },
  },
  {
    id: "factory_raw_inventory",
    section: "Raw Material",
    label: "Raw Material Inventory",
    route: "/factory/raw-inventory",
    icon: "factory-raw-inventory",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, create: true, edit: true, export: true },
  },
  {
    id: "factory_raw_movements",
    section: "Raw Material",
    label: "Raw Material Movements",
    route: "/factory/raw-movements",
    icon: "factory-raw-movements",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, export: true },
  },
  {
    id: "factory_raw_stock_check",
    section: "Raw Material",
    label: "Raw Material Stock Check",
    route: "/factory/raw-stock-check",
    icon: "factory-raw-stock-check",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, create: true, edit: true, delete: true, submit: true, approve: true, export: true },
  },
  {
    id: "factory_product_recipes",
    section: "Master Data",
    label: "Product Recipes",
    route: "/factory/product-recipes",
    icon: "factory-product-recipes",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, create: true, edit: true, delete: true, manage: true, export: true },
  },
  {
    id: "factory_production_sop",
    section: "Master Data",
    label: "Production SOP",
    route: "/factory/production-sop",
    icon: "factory-sop",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, create: true, edit: true, delete: true, manage: true, export: true },
  },
  {
    id: "factory_audit_logs",
    section: "System",
    label: "Audit Trail",
    route: "/factory/audit-logs",
    icon: "factory-audit-logs",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, export: true },
  },
  {
    id: "factory_storage_locations",
    section: "System",
    label: "Storage Locations",
    route: "/factory/storage-locations",
    icon: "factory-storage-locations",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, create: true, edit: true, delete: true, manage: true, export: true },
  },
  {
    id: "factory_suppliers",
    section: "System",
    label: "Suppliers",
    route: "/factory/suppliers",
    icon: "factory-suppliers",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, create: true, edit: true, delete: true, manage: true, export: true },
  },
  {
    id: "factory_customers",
    section: "System",
    label: "Customers",
    route: "/factory/customers",
    icon: "factory-customers",
    sidebar: true,
    workspace: "factory",
    permissions: { view: true, create: true, edit: true, delete: true, export: true },
  },
  {
    id: "crew_dashboard",
    section: "Overview",
    label: "Dashboard",
    route: "/crew/dashboard",
    icon: "crew-dashboard",
    sidebar: true,
    workspace: "crew",
    permissions: { view: true },
  },
  {
    id: "crew_employees",
    section: "Workforce",
    label: "Employees",
    route: "/crew/employees",
    icon: "crew-employees",
    sidebar: true,
    workspace: "crew",
    permissions: { view: true, manage: true },
  },
  {
    id: "crew_attendance",
    section: "Workforce",
    label: "Attendance",
    route: "/crew/attendance",
    icon: "crew-attendance",
    sidebar: true,
    workspace: "crew",
    permissions: { view: true, manage: true },
  },
  {
    id: "crew_roster",
    section: "Workforce",
    label: "Duty Roster",
    route: "/crew/roster",
    icon: "crew-roster",
    sidebar: true,
    workspace: "crew",
    permissions: { view: true, manage: true, publish: true },
  },
  {
    id: "crew_leave",
    section: "Workforce",
    label: "Leave Requests",
    route: "/crew/leave",
    icon: "crew-leave",
    sidebar: true,
    workspace: "crew",
    permissions: { view: true, review: true, manage: true },
  },
  {
    id: "crew_leave_balance",
    section: "Workforce",
    label: "Leave Balance",
    route: "/crew/leave/balances",
    sidebar: false,
    routable: false,
    workspace: "crew",
    permissions: { view: true, manage: true, adjust: true },
  },
  {
    id: "crew_leave_settings",
    section: "Workforce",
    label: "Leave Settings",
    route: "/crew/leave/settings",
    sidebar: false,
    routable: false,
    workspace: "crew",
    permissions: { manage: true },
  },
  {
    id: "crew_operations",
    section: "Operations",
    label: "Tasks",
    route: "/crew/operations",
    icon: "crew-operations",
    sidebar: true,
    workspace: "crew",
    permissions: { view: true, manage: true, review: true },
  },
  {
    id: "crew_operation_templates",
    section: "Operations",
    label: "Tasks",
    route: "/crew/operations/templates",
    icon: "crew-operation-templates",
    sidebar: false,
    workspace: "crew",
    permissions: {},
  },
  {
    id: "crew_learning",
    section: "Learning",
    label: "Onboarding",
    route: "/crew/learning",
    icon: "crew-learning",
    sidebar: true,
    workspace: "crew",
    permissions: { view: true, create: true, edit: true, manage: true },
  },
  {
    id: "crew_journeys",
    section: "Learning",
    label: "Journeys",
    route: "/crew/journeys",
    icon: "crew-learning",
    sidebar: false,
    workspace: "crew",
    permissions: { view: true, create: true, edit: true, manage: true },
  },
  {
    id: "crew_progress",
    section: "Learning",
    label: "Onboarding Progress",
    route: "/crew/progress",
    icon: "crew-learning",
    sidebar: false,
    workspace: "crew",
    permissions: { view: true },
  },
  {
    id: "crew_sop_library",
    section: "Learning",
    label: "SOP Library",
    route: "/crew/sops",
    icon: "crew-sops",
    sidebar: true,
    workspace: "crew",
    permissions: { view: true, create: true, edit: true, manage: true },
  },
  {
    id: "crew_growth",
    section: "Growth",
    label: "Growth Overview",
    route: "/crew/growth",
    icon: "crew-growth",
    sidebar: true,
    workspace: "crew",
    permissions: { view: true, manage: true, assess: true, certify: true },
  },
  {
    id: "crew_growth_skills",
    section: "Growth",
    label: "Skills",
    route: "/crew/growth/skills",
    icon: "crew-growth-skills",
    sidebar: true,
    workspace: "crew",
    permissions: {},
  },
  {
    id: "crew_growth_people",
    section: "Growth",
    label: "Crew Growth",
    route: "/crew/growth/crew",
    icon: "crew-growth-people",
    sidebar: false,
    workspace: "crew",
    permissions: {},
  },
  {
    id: "crew_growth_reviews",
    section: "Growth",
    label: "Certification Review",
    route: "/crew/growth/reviews",
    icon: "crew-growth-reviews",
    sidebar: true,
    workspace: "crew",
    permissions: {},
  },
  {
    id: "crew_performance",
    section: "Performance",
    label: "Performance Overview",
    route: "/crew/performance",
    icon: "crew-performance",
    sidebar: true,
    workspace: "crew",
    permissions: { view: true, review: true, finalize: true },
  },
  {
    id: "crew_performance_reviews",
    section: "Performance",
    label: "Reviews",
    route: "/crew/performance/reviews",
    icon: "crew-performance-reviews",
    sidebar: false,
    workspace: "crew",
    permissions: {},
  },
  {
    id: "crew_customer_feedback",
    section: "Performance",
    label: "Customer Feedback",
    route: "/crew/performance/feedback",
    icon: "crew-feedback",
    sidebar: true,
    workspace: "crew",
    permissions: { view: true, moderate: true },
  },
  {
    id: "crew_reward",
    section: "Reward",
    label: "Reward Overview",
    route: "/crew/reward",
    icon: "crew-reward",
    sidebar: true,
    workspace: "crew",
    permissions: { view: true, manage: true, finalize: true, mark_paid: true },
  },
  {
    id: "crew_reward_cycles",
    section: "Reward",
    label: "Reward Cycles",
    route: "/crew/reward/cycles",
    icon: "crew-reward-cycles",
    sidebar: false,
    workspace: "crew",
    permissions: {},
  },
];

export function moduleWorkspace(module: AppModule): WorkspaceKey {
  return module.workspace ?? "restaurant";
}

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
  const groups = moduleRegistry.filter((module) => enabledActions(module).length).reduce((groups, module) => {
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

export function getSidebarSections(workspace: WorkspaceKey = "restaurant") {
  const sections = moduleRegistry
    .filter((module) => module.sidebar && moduleWorkspace(module) === workspace)
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
