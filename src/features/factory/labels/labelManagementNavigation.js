import { navigateAdminRoute } from "../../../app/routeOwnership.js";
export function openLabelManagement(query = {}) {
  navigateAdminRoute("factory_label_management", {}, query);
}
export function readLabelManagementLocation() {
  const query = new URLSearchParams(window.location.search);
  return {
    section: ["products", "templates", "printers"].includes(
      query.get("section"),
    )
      ? query.get("section")
      : "products",
    sku: query.get("sku"),
    template: query.get("template"),
  };
}
