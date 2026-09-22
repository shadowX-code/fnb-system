// Factory compatibility entry point. Shared Admin pagination is owned by components/tables.
export { default } from "../../../components/tables/AdminPagination.jsx";
export {
  AdminTableLoadState as FactoryTableLoadState,
  adminPageItems as factoryPageItems,
  useAdminClientPagination as useFactoryClientPagination,
  useAdminPagedQuery as useFactoryPagedQuery,
} from "../../../components/tables/AdminPagination.jsx";
