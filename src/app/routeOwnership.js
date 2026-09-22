import { moduleRegistry, moduleWorkspace, viewPermission } from "../../config/modules.ts";

// Existing hash aliases remain the runtime compatibility owner. The route
// contract defines the future pathname taxonomy but does not change URL writes.
export const legacyRouteRedirects = Object.freeze({
  guest_ai_device_console: "guest_ai_developer",
  "duty-roster": "crew_roster",
  outlet_duty_roster: "crew_roster",
  // Pre-reset Learning navigation used this name. Keep old saved links on the
  // canonical Onboarding page rather than falling through to another route.
  crew_onboarding: "crew_learning",
  crew_operation_templates: "crew_operations",
  crew_growth_people: "crew_growth",
  crew_growth_reviews: "crew_growth",
  crew_performance_reviews: "crew_performance",
  crew_reward_cycles: "crew_reward",
});

export function canonicalRouteId(routeId = "") {
  const normalized = String(routeId).replace(/^#/, "").split("/")[0];
  return legacyRouteRedirects[normalized] ?? normalized;
}

const productQueryStateByRouteId = Object.freeze({
  "purchase-comparison": [{ key: "supplier" }],
  inventory_groups: [{ key: "date", aliases: ["stockCheckDate"] }],
  inventory_stock_check: [{ key: "date", aliases: ["stockCheckDate"] }],
});

const canonicalPathByModuleId = Object.freeze({
  "sp-dashboard": "/restaurant/sales-purchase/dashboard",
  employee_compliance: "/people/food-handling-compliance",
  roles: "/people/roles",
  factory_finished_goods: "/factory/warehouse/finished-goods",
  factory_finished_goods_dispatch: "/factory/warehouse/dispatch",
  factory_product_movements: "/factory/warehouse/product-movements",
  factory_product_stock_check: "/factory/warehouse/stock-check",
  factory_internal_transfer: "/factory/warehouse/internal-transfers",
  factory_raw_receiving: "/factory/raw-materials/receiving",
  factory_raw_inventory: "/factory/raw-materials/inventory",
  factory_raw_movements: "/factory/raw-materials/movements",
  factory_raw_stock_check: "/factory/raw-materials/stock-check",
  factory_mesti_cleaning: "/factory/mesti/cleaning-area",
  factory_mesti_equipment_cleaning: "/factory/mesti/cleaning-equipment",
  factory_product_recipes: "/factory/master-data/product-recipes",
  factory_production_sop: "/factory/master-data/production-sops",
  factory_equipment: "/factory/master-data/equipment",
  factory_storage_locations: "/factory/master-data/storage-locations",
  factory_suppliers: "/factory/master-data/suppliers",
  factory_customers: "/factory/master-data/customers",
  crew_dashboard: "/crew/workforce/dashboard",
  crew_employees: "/crew/workforce/employees",
  crew_attendance: "/crew/workforce/attendance",
  crew_roster: "/crew/workforce/roster",
  crew_leave: "/crew/workforce/leave",
  crew_operations: "/crew/operations",
  crew_cash_checkout: "/crew/operations/cash-checkout",
  crew_learning: "/crew/learning",
  crew_journeys: "/crew/learning/journeys",
  crew_progress: "/crew/learning/progress",
  crew_sop_library: "/crew/learning/sops",
  crew_growth: "/crew/growth/overview",
  crew_growth_skills: "/crew/growth/skills",
  crew_performance: "/crew/performance",
  crew_customer_feedback: "/crew/performance/customer-feedback",
  crew_reward: "/crew/reward/overview",
});

function routeDomain(module) {
  if (moduleWorkspace(module) === "crew") return "crew";
  const path = canonicalPathByModuleId[module.id] ?? module.route;
  if (path.startsWith("/people/")) return "people";
  if (path.startsWith("/system/")) return "system";
  if (moduleWorkspace(module) === "factory") return "factory";
  return "restaurant";
}

function canonicalPathForModule(module) {
  const override = canonicalPathByModuleId[module.id];
  if (override) return override;
  const sourcePath = module.route.replace(/\/+$/, "") || "/";
  const domain = routeDomain(module);
  if (domain === "people" || domain === "system" || domain === "factory") return sourcePath;
  if (sourcePath === "/overview/dashboard") return "/restaurant/dashboard";
  if (sourcePath.startsWith("/overview/")) return `/restaurant/${sourcePath.slice("/overview/".length)}`;
  return `/restaurant${sourcePath}`;
}

function routeOwnership(module) {
  return Object.freeze({
    moduleId: module.id,
    workspace: moduleWorkspace(module),
    domain: routeDomain(module),
    surface: "admin",
    permission: module.permissions.view ? viewPermission(module.id) : null,
  });
}

function queryStateFor(moduleId) {
  return (productQueryStateByRouteId[moduleId] ?? []).map((entry) => Object.freeze({
    key: entry.key,
    aliases: Object.freeze([entry.key, ...(entry.aliases ?? [])]),
  }));
}

function legacyHashAliasesFor(routeId, pattern) {
  const aliases = Object.entries(legacyRouteRedirects)
    .filter(([, targetRouteId]) => targetRouteId === routeId)
    .map(([alias]) => `#${alias}`);
  return Object.freeze([`#${pattern}`, ...aliases]);
}

function moduleRouteDefinition(module) {
  const routeId = module.id;
  return Object.freeze({
    id: routeId,
    routeId,
    canonicalPath: canonicalPathForModule(module),
    pathPattern: canonicalPathForModule(module),
    legacyHashPattern: routeId,
    legacyHashAliases: legacyHashAliasesFor(routeId, routeId),
    params: Object.freeze([]),
    query: Object.freeze(queryStateFor(routeId)),
    ownership: routeOwnership(module),
  });
}

function nestedRouteDefinition({ id, routeId, pathPattern, legacyHashPattern, params }) {
  const module = moduleRegistry.find((candidate) => candidate.id === routeId);
  if (!module) throw new Error(`Route contract requires module ${routeId}.`);
  return Object.freeze({
    id,
    routeId,
    canonicalPath: pathPattern,
    pathPattern,
    legacyHashPattern,
    legacyHashAliases: legacyHashAliasesFor(routeId, legacyHashPattern),
    params: Object.freeze(params),
    query: Object.freeze(queryStateFor(routeId)),
    ownership: routeOwnership(module),
  });
}

function crewMobileRouteDefinition({ id, screen, path, legacyPath = path, growthInitialView, aliases = [] }) {
  const canonicalHash = `#${legacyPath}`;
  return Object.freeze({
    id,
    routeId: id,
    canonicalPath: `/${path}`,
    pathPattern: `/${path}`,
    legacyHashPattern: legacyPath,
    legacyHashAliases: Object.freeze([canonicalHash, ...aliases]),
    params: Object.freeze([]),
    query: Object.freeze([]),
    ownership: Object.freeze({
      moduleId: null,
      workspace: "crew",
      domain: "crew",
      surface: "crew-mobile",
      permission: null,
    }),
    crewState: Object.freeze({ screen, ...(growthInitialView ? { growthInitialView } : {}) }),
  });
}

// Guest AI, public Feedback, and auth/recovery callbacks keep their independent
// route owners. Every routable Admin workspace module and Crew Mobile screen is
// represented here; subsets below only control which runtime may consume it.
const contractModules = moduleRegistry.filter((module) => {
  const workspace = moduleWorkspace(module);
  return module.routable !== false
    && (workspace === "restaurant" || workspace === "factory" || workspace === "crew")
    && !legacyRouteRedirects[module.id];
});

const moduleDefinitions = contractModules.map(moduleRouteDefinition);
const nestedDefinitions = [
  nestedRouteDefinition({
    id: "legal-entities-contract-templates",
    routeId: "legal-entities",
    pathPattern: "/people/legal-entities/:legalEntityId/contract-templates",
    legacyHashPattern: "legal-entities/:legalEntityId/contract-templates",
    params: ["legalEntityId"],
  }),
  nestedRouteDefinition({ id: "roles-new", routeId: "roles", pathPattern: "/people/roles/new", legacyHashPattern: "roles/new", params: [] }),
  nestedRouteDefinition({ id: "roles-edit", routeId: "roles", pathPattern: "/people/roles/:roleId/edit", legacyHashPattern: "roles/:roleId/edit", params: ["roleId"] }),
  nestedRouteDefinition({ id: "roles-detail", routeId: "roles", pathPattern: "/people/roles/:roleId", legacyHashPattern: "roles/:roleId", params: ["roleId"] }),
  nestedRouteDefinition({ id: "crew-operations-instance", routeId: "crew_operations", pathPattern: "/crew/operations/instances/:instanceId", legacyHashPattern: "crew_operations/instance/:instanceId", params: ["instanceId"] }),
];

const crewMobileDefinitions = [
  crewMobileRouteDefinition({ id: "crew-mobile-home", screen: "home", path: "crew/home", aliases: ["#crew"] }),
  crewMobileRouteDefinition({ id: "crew-mobile-notifications", screen: "notifications", path: "crew/notifications" }),
  crewMobileRouteDefinition({ id: "crew-mobile-learn", screen: "learn", path: "crew/learn" }),
  crewMobileRouteDefinition({ id: "crew-mobile-reward", screen: "reward", path: "crew/reward" }),
  crewMobileRouteDefinition({ id: "crew-mobile-growth", screen: "growth", path: "crew/growth", growthInitialView: "overview" }),
  crewMobileRouteDefinition({ id: "crew-mobile-growth-performance", screen: "growth", path: "crew/growth/performance", growthInitialView: "performance" }),
  crewMobileRouteDefinition({ id: "crew-mobile-me", screen: "me", path: "crew/me" }),
  crewMobileRouteDefinition({ id: "crew-mobile-attendance", screen: "attendance", path: "crew/me/attendance" }),
  crewMobileRouteDefinition({ id: "crew-mobile-cash-checkout", screen: "cash-checkout", path: "crew/me/cash-checkout" }),
  crewMobileRouteDefinition({ id: "crew-mobile-leave", screen: "leave", path: "crew/me/leave" }),
  crewMobileRouteDefinition({ id: "crew-mobile-assets", screen: "assets", path: "crew/me/assets" }),
  crewMobileRouteDefinition({ id: "crew-mobile-employment-records", screen: "employment-records", path: "crew/me/employment-records" }),
  crewMobileRouteDefinition({ id: "crew-mobile-employment-documents", screen: "employment-documents", path: "crew/me/employment-records/contracts" }),
  crewMobileRouteDefinition({ id: "crew-mobile-compliance", screen: "compliance", path: "crew/me/employment-records/food-handling-compliance", legacyPath: "crew/me/employment-records/documents-compliance", aliases: ["#crew/me/compliance"] }),
  crewMobileRouteDefinition({ id: "crew-mobile-disciplinary", screen: "disciplinary", path: "crew/me/employment-records/warnings-notices", legacyPath: "crew/me/employment-records/warnings", aliases: ["#crew/me/warnings"] }),
  crewMobileRouteDefinition({ id: "crew-mobile-tasks", screen: "operations", path: "crew/tasks" }),
  crewMobileRouteDefinition({ id: "crew-mobile-schedule", screen: "schedule", path: "crew/schedule" }),
];

// Parameterized definitions must win before their parent module definition.
export const feedxRouteDefinitions = Object.freeze([...nestedDefinitions, ...crewMobileDefinitions, ...moduleDefinitions]);
export const adminRouteDefinitions = Object.freeze(feedxRouteDefinitions.filter((definition) => definition.ownership.surface === "admin"));

const definitionsById = new Map(feedxRouteDefinitions.map((definition) => [definition.id, definition]));
const defaultDefinitionByRouteId = new Map(moduleDefinitions.map((definition) => [definition.routeId, definition]));

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function normalizePath(value) {
  const raw = String(value ?? "").split("?")[0].replace(/^https?:\/\/[^/]+/i, "");
  if (!raw || raw === "/") return "/";
  return `/${raw.replace(/^\/+|\/+$/g, "")}`;
}

function splitHash(hash) {
  const raw = String(hash ?? "").replace(/^#/, "");
  const [path = "", query = ""] = raw.split("?", 2);
  return { path: path.replace(/^\/+|\/+$/g, ""), query };
}

function patternMatch(pattern, value) {
  const names = [];
  const expression = pattern.split("/").map((part) => {
    if (part.startsWith(":")) { names.push(part.slice(1)); return "([^/]+)"; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("/");
  const match = new RegExp(`^${expression}$`).exec(value);
  if (!match) return null;
  return Object.fromEntries(names.map((name, index) => [name, safeDecode(match[index + 1])]));
}

function ownedQuery(definition, rawQuery, fallbackQuery = "") {
  const source = rawQuery instanceof URLSearchParams ? rawQuery : new URLSearchParams(String(rawQuery || "").replace(/^\?/, ""));
  const fallback = fallbackQuery instanceof URLSearchParams ? fallbackQuery : new URLSearchParams(String(fallbackQuery || "").replace(/^\?/, ""));
  return Object.fromEntries(definition.query.flatMap((entry) => {
    const value = [source, fallback]
      .flatMap((params) => entry.aliases.map((key) => params.get(key)))
      .find((candidate) => candidate !== null && candidate !== "");
    return value === undefined ? [] : [[entry.key, value]];
  }));
}

function withQuery(path, definition, query = {}) {
  const params = new URLSearchParams();
  definition.query.forEach((entry) => {
    const value = query?.[entry.key];
    if (value !== undefined && value !== null && String(value) !== "") params.set(entry.key, String(value));
  });
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function buildPattern(pattern, params = {}) {
  let missing = false;
  const path = pattern.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_match, name) => {
    const value = params[name];
    if (value === undefined || value === null || value === "") { missing = true; return ""; }
    return encodeURIComponent(String(value));
  });
  return missing ? null : path;
}

function resolution(definition, params, query, source) {
  return Object.freeze({ definition, definitionId: definition.id, routeId: definition.routeId, params: Object.freeze(params), query: Object.freeze(query), source });
}

export function getAdminRouteDefinition(id = "") {
  const direct = definitionsById.get(id);
  if (direct?.ownership.surface === "admin") return direct;
  return defaultDefinitionByRouteId.get(canonicalRouteId(id)) ?? null;
}

export function getFeedxRouteDefinition(id = "") {
  const direct = definitionsById.get(id);
  if (direct) return direct;
  return defaultDefinitionByRouteId.get(canonicalRouteId(id)) ?? null;
}

export function resolveCanonicalPath(pathname = "/", search = "") {
  const [pathWithoutQuery, inlineQuery = ""] = String(pathname).split("?", 2);
  const path = normalizePath(pathWithoutQuery);
  const rawQuery = search || inlineQuery;
  for (const definition of feedxRouteDefinitions) {
    const params = patternMatch(definition.pathPattern, path);
    if (params) return resolution(definition, params, ownedQuery(definition, rawQuery), "pathname");
  }
  return null;
}

export function resolveLegacyHash(hash = "", search = "") {
  const { path, query } = splitHash(hash);
  if (!path) return null;
  for (const definition of [...nestedDefinitions, ...crewMobileDefinitions]) {
    const patterns = [definition.legacyHashPattern, ...definition.legacyHashAliases.map((alias) => alias.replace(/^#/, ""))];
    for (const pattern of patterns) {
      const params = patternMatch(pattern, path);
      if (params) return resolution(definition, params, ownedQuery(definition, query, search), "legacy-hash");
    }
  }
  const routeId = canonicalRouteId(path.split("/")[0]);
  const definition = defaultDefinitionByRouteId.get(routeId);
  return definition ? resolution(definition, {}, ownedQuery(definition, query, search), "legacy-hash") : null;
}

export function resolveAdminLocation({ pathname = "/", search = "", hash = "" } = {}) {
  // Hashes remain the runtime navigation authority through Phase 2. A direct
  // canonical pathname resolves only when no recognized Admin/Factory hash is
  // present, which keeps reload/back-forward correct after existing hash writes.
  const legacy = resolveLegacyHash(hash, search);
  if (legacy?.definition.ownership.surface === "admin") return legacy;
  if (legacy) return null;
  const canonical = resolveCanonicalPath(pathname, search);
  return canonical?.definition.ownership.surface === "admin" ? canonical : null;
}

export function canonicalPathForRoute(id, params = {}, query = {}) {
  const definition = getFeedxRouteDefinition(id);
  if (!definition) return null;
  const path = buildPattern(definition.pathPattern, params);
  return path ? withQuery(path, definition, query) : null;
}

export function legacyHashForRoute(id, params = {}, query = {}) {
  const definition = getFeedxRouteDefinition(id);
  if (!definition) return null;
  const path = buildPattern(definition.legacyHashPattern, params);
  return path ? `#${withQuery(path, definition, query)}` : null;
}

export function crewMobileRouteForState({ screen, growthInitialView = "overview" } = {}) {
  return crewMobileDefinitions.find((definition) => (
    definition.crewState.screen === screen
    && (screen !== "growth" || definition.crewState.growthInitialView === growthInitialView)
  )) ?? getFeedxRouteDefinition("crew-mobile-home");
}

export function resolveCrewMobileHash(hash = "") {
  const route = resolveLegacyHash(hash);
  return route?.definition.ownership.surface === "crew-mobile" ? route : null;
}
