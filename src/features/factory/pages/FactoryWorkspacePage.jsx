import FactoryWorkspaceRuntime from "./FactoryWorkspaceRuntime.jsx";

// The route registry owns this shell; the runtime owns shared legacy coordination.
export default function FactoryWorkspacePage(props) {
  return <FactoryWorkspaceRuntime {...props} />;
}
