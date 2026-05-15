import { getPermissionDefinitions, permissionCode } from "../../../../config/modules.ts";

export const defaultRoles = [
  { id: "role-owner", name: "owner", description: "Company owner with full FeedX access.", is_system_role: true, is_active: true },
  { id: "role-admin", name: "admin", description: "System administrator with full operational access.", is_system_role: true, is_active: true },
  { id: "role-manager", name: "manager", description: "Outlet or area manager with sales and purchase access.", is_system_role: true, is_active: true },
  { id: "role-supervisor", name: "supervisor", description: "Shift supervisor with operational visibility.", is_system_role: true, is_active: true },
  { id: "role-cashier", name: "cashier", description: "Front counter user.", is_system_role: true, is_active: true },
  { id: "role-kitchen", name: "kitchen", description: "Kitchen operations user.", is_system_role: true, is_active: true },
  { id: "role-purchaser", name: "purchaser", description: "Purchase and supplier control user.", is_system_role: true, is_active: true },
  { id: "role-finance", name: "finance", description: "Finance review and approval user.", is_system_role: true, is_active: true },
  { id: "role-hr", name: "hr", description: "HR and employee management user.", is_system_role: true, is_active: true },
  { id: "role-staff", name: "staff", description: "Basic employee access.", is_system_role: true, is_active: true },
];

export const defaultPermissions = getPermissionDefinitions();

export const rolePermissionMatrix = {
  owner: defaultPermissions.map((permission) => permission.code),
  admin: defaultPermissions.map((permission) => permission.code),
  manager: [
    permissionCode("dashboard", "view"),
    permissionCode("sales-input", "view"),
    permissionCode("sales-input", "create"),
    permissionCode("sales-input", "edit"),
    permissionCode("sales-comparison", "view"),
    permissionCode("purchase-input", "view"),
    permissionCode("purchase-input", "create"),
    permissionCode("purchase-input", "edit"),
    permissionCode("purchase-comparison", "view"),
    permissionCode("outlets", "view"),
    permissionCode("suppliers", "view"),
    permissionCode("employees", "view"),
    permissionCode("employees", "edit"),
    permissionCode("employees", "enable_login"),
  ],
  cashier: [permissionCode("dashboard", "view"), permissionCode("sales-input", "view"), permissionCode("sales-input", "create")],
  kitchen: [permissionCode("dashboard", "view"), permissionCode("purchase-input", "view")],
  staff: [permissionCode("dashboard", "view")],
};

export const allPermissionCodes = defaultPermissions.map((permission) => permission.code);
