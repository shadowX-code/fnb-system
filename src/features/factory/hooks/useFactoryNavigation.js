import { useContext } from "react";
import { FactoryNavigationContext } from "../context/FactoryNavigationContext.jsx";

export default function useFactoryNavigation() {
  const context = useContext(FactoryNavigationContext);
  if (!context) throw new Error("useFactoryNavigation must be used within FactoryNavigationProvider");
  return context;
}
