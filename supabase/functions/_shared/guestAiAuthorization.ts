type PermissionClient = { rpc: (name: string, args: { permission_code: string }) => PromiseLike<{ data: unknown; error: unknown }> };

// Called with the authenticated caller client, never a service-role client.
export async function hasGuestAiPermission(client: PermissionClient, developer = false): Promise<boolean> {
  for (const code of developer ? ["guest_ai.access", "guest_ai.developer"] : ["guest_ai.access"]) {
    try {
      const { data, error } = await client.rpc("current_user_has_permission", { permission_code: code });
      if (error || data !== true) return false;
    } catch { return false; }
  }
  return true;
}
