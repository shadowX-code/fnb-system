import { createContext, useContext } from "react";
import { useDeviceSession } from "./useDeviceSession.js";

const GuestAiDeviceRuntimeContext = createContext(null);

// One runtime instance is shared by every Guest AI workspace page.  The
// serial/device protocol implementation remains the existing DeviceSession.
export function GuestAiDeviceRuntimeProvider({ children }) {
  const runtime = useDeviceSession();
  return <GuestAiDeviceRuntimeContext.Provider value={runtime}>{children}</GuestAiDeviceRuntimeContext.Provider>;
}

export function useGuestAiDeviceRuntime() {
  const runtime = useContext(GuestAiDeviceRuntimeContext);
  if (!runtime) throw new Error("GuestAiDeviceRuntimeProvider is required for Guest AI workspace pages.");
  return runtime;
}
