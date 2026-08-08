import { useContext } from "react";
import { FactoryPermissionsContext } from "../context/FactoryPermissionsContext.jsx";

export default function useFactoryPermissions() {
  const context = useContext(FactoryPermissionsContext);
  if (!context) throw new Error("useFactoryPermissions must be used within FactoryPermissionsProvider");
  return context;
}
