import { useEffect, useMemo, useState } from "react";
import { WebSerialDeviceAdapter } from "../adapters/WebSerialDeviceAdapter.js";
import { DeviceSession } from "./DeviceSession.js";
export function useDeviceSession() {
  const session = useMemo(() => new DeviceSession(new WebSerialDeviceAdapter()), []);
  const [snapshot, setSnapshot] = useState(session.snapshot);
  useEffect(() => session.subscribe(setSnapshot), [session]);
  useEffect(() => () => { session.disconnect(); }, [session]);
  return { session, snapshot, serialSupported: WebSerialDeviceAdapter.isSupported() };
}
