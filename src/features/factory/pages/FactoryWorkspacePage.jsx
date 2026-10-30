import { Profiler } from "react";
import FactoryPerformanceDiagnostics from "../components/FactoryPerformanceDiagnostics.jsx";
import { traceFactoryCommit } from "../utils/factoryRuntimePerformance.js";
import FactoryWorkspaceRuntime from "./FactoryWorkspaceRuntime.jsx";

// The route registry owns this shell; the runtime owns shared legacy coordination.
export default function FactoryWorkspacePage(props) {
  return <><Profiler id="factory" onRender={traceFactoryCommit}><FactoryWorkspaceRuntime {...props} /></Profiler><FactoryPerformanceDiagnostics route={props.initialTab} /></>;
}
