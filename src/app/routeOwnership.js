import { moduleRegistry, moduleWorkspace, viewPermission } from "../../config/modules.ts";

// Existing hash aliases remain the runtime compatibility owner. Phase 1 also
// exposes them through the executable Admin/Factory route contract; it does
// not change any URL writes.
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

function routeDomain(module) {
  if (module.route.startsWith("/people/")) return "people";
  if (module.route.startsWith("/system/")) return "system";
  if (moduleWorkspace(module) === "factory") return "factory";
  return "restaurant";
}

function canonicalPathForModule(module) {
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

// Only Admin/Restaurant, People/System and Factory are part of this contract.
// Crew Mobile, public routes, Guest AI and auth callbacks retain their existing
// independent owners until a separately approved migration.
const contractModules = moduleRegistry.filter((module) => {
  const workspace = moduleWorkspace(module);
  return module.routable !== false
    && (workspace === "restaurant" || workspace === "factory")
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
  nestedRouteDefinition({ id: "roles-new", routeId: "roles", pathPattern: "/system/roles/new", legacyHashPattern: "roles/new", params: [] }),
  nestedRouteDefinition({ id: "roles-edit", routeId: "roles", pathPattern: "/system/roles/:roleId/edit", legacyHashPattern: "roles/:roleId/edit", params: ["roleId"] }),
  nestedRouteDefinition({ id: "roles-detail", routeId: "roles", pathPattern: "/system/roles/:roleId", legacyHashPattern: "roles/:roleId", params: ["roleId"] }),
];

// Parameterized definitions must win before their parent module definition.
export const adminRouteDefinitions = Object.freeze([...nestedDefinitions, ...moduleDefinitions]);

const definitionsById = new Map(adminRouteDefinitions.map((definition) => [definition.id, definition]));
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
  if (direct) return direct;
  return defaultDefinitionByRouteId.get(canonicalRouteId(id)) ?? null;
}

export function resolveCanonicalPath(pathname = "/", search = "") {
  const [pathWithoutQuery, inlineQuery = ""] = String(pathname).split("?", 2);
  const path = normalizePath(pathWithoutQuery);
  const rawQuery = search || inlineQuery;
  for (const definition of adminRouteDefinitions) {
    const params = patternMatch(definition.pathPattern, path);
    if (params) return resolution(definition, params, ownedQuery(definition, rawQuery), "pathname");
  }
  return null;
}

export function resolveLegacyHash(hash = "", search = "") {
  const { path, query } = splitHash(hash);
  if (!path) return null;
  for (const definition of nestedDefinitions) {
    const params = patternMatch(definition.legacyHashPattern, path);
    if (params) return resolution(definition, params, ownedQuery(definition, query, search), "legacy-hash");
  }
  const routeId = canonicalRouteId(path.split("/")[0]);
  const definition = defaultDefinitionByRouteId.get(routeId);
  return definition ? resolution(definition, {}, ownedQuery(definition, query, search), "legacy-hash") : null;
}

export function resolveAdminLocation({ pathname = "/", search = "", hash = "" } = {}) {
  // Hashes remain the runtime navigation authority through Phase 2. A direct
  // canonical pathname resolves only when no recognized Admin/Factory hash is
  // present, which keeps reload/back-forward correct after existing hash writes.
  return resolveLegacyHash(hash, search) ?? resolveCanonicalPath(pathname, search);
}

export function canonicalPathForRoute(id, params = {}, query = {}) {
  const definition = getAdminRouteDefinition(id);
  if (!definition) return null;
  const path = buildPattern(definition.pathPattern, params);
  return path ? withQuery(path, definition, query) : null;
}

export function legacyHashForRoute(id, params = {}, query = {}) {
  const definition = getAdminRouteDefinition(id);
  if (!definition) return null;
  const path = buildPattern(definition.legacyHashPattern, params);
  return path ? `#${withQuery(path, definition, query)}` : null;
}
