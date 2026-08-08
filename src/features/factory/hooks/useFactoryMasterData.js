import { useContext } from "react";
import { FactoryMasterDataContext } from "../context/FactoryMasterDataContext.jsx";

export default function useFactoryMasterData() {
  const context = useContext(FactoryMasterDataContext);
  if (!context) throw new Error("useFactoryMasterData must be used within FactoryMasterDataProvider");
  return context;
}
