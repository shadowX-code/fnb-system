import { createContext, useMemo } from "react";

export const FactoryPermissionsContext = createContext(null);

export function FactoryPermissionsProvider({ permissionSet, can, onPermissionDenied, children }) {
  const value = useMemo(
    () => ({ permissionSet, can, onPermissionDenied }),
    [permissionSet, can, onPermissionDenied],
  );

  return <FactoryPermissionsContext.Provider value={value}>{children}</FactoryPermissionsContext.Provider>;
}
