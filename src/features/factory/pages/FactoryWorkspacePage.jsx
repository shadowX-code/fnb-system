import FactoryWorkspaceRuntime from "./FactoryWorkspaceRuntime.jsx";
import FactoryRecipeFailureDiagnostics from "../components/FactoryRecipeFailureDiagnostics.jsx";

// The route registry owns this shell; the runtime owns shared legacy coordination.
export default function FactoryWorkspacePage(props) {
  return <><FactoryWorkspaceRuntime {...props} /><FactoryRecipeFailureDiagnostics auth={props.auth} /></>;
}
