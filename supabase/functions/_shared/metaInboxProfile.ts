// Minimal official User Profile API reads; no demographics, customer merges or persistence.
export function profileFields(channel: string) {
  if (channel === "instagram") return "name,username,profile_pic";
  if (channel === "facebook") return "first_name,last_name,profile_pic";
  throw new Error("profile_channel_unavailable");
}
export function sanitizeInboxProfile(
  value: Record<string, unknown>,
  channel: string,
) {
  const text = (v: unknown) =>
    typeof v === "string"
      ? v
          .replace(/[\u0000-\u001f\u007f]/g, "")
          .trim()
          .slice(0, 160) || null
      : null;
  const name =
    channel === "instagram"
      ? text(value.name)
      : text(
          [text(value.first_name), text(value.last_name)]
            .filter(Boolean)
            .join(" "),
        );
  const handle = channel === "instagram" ? text(value.username) : null;
  let avatar = null;
  try {
    const url = new URL(String(value.profile_pic));
    if (
      url.protocol === "https:" &&
      ["fbcdn.net", "cdninstagram.com", "fbsbx.com"].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      ) &&
      !url.searchParams.has("access_token")
    )
      avatar = url.href;
  } catch {}
  return {
    display_name: name,
    handle,
    avatar_url: avatar,
    source: "meta_user_profile",
    available: Boolean(name || handle || avatar),
  };
}
