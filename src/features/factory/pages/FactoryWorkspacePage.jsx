import { Profiler } from "react";
import FactoryPerformanceDiagnostics from "../components/FactoryPerformanceDiagnostics.jsx";
import { traceFactoryCommit } from "../utils/factoryRuntimePerformance.js";
import FactoryWorkspaceRuntime from "./FactoryWorkspaceRuntime.jsx";
import FactoryRecipeFailureDiagnostics from "../components/FactoryRecipeFailureDiagnostics.jsx";

// The route registry owns this shell; the runtime owns shared legacy coordination.
export default function FactoryWorkspacePage(props) {
  return <><Profiler id="factory" onRender={traceFactoryCommit}><FactoryWorkspaceRuntime {...props} /></Profiler><FactoryRecipeFailureDiagnostics auth={props.auth} /><FactoryPerformanceDiagnostics route={props.initialTab} /></>;
}
