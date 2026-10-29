export const gatewayEndpointPath = "/functions/v1/factory-mesti-mcp";

// Explicit deployment boundaries; request headers never select the project or probe destination.
const deployments = {
  "https://ujkzdaaadnvcfayuldmh.supabase.co": ["https://fnb-system-staging.vercel.app", "http://localhost:5173"],
  "https://oyfobxdoyfuzsodogpgs.supabase.co": ["https://os.feedx.my"],
};
export function externalAgentEnvironment(url = "") {
  const base = url.replace(/\/$/, "");
  const origins = deployments[base];
  return origins ? { endpoint: base + gatewayEndpointPath, origins } : null;
}
