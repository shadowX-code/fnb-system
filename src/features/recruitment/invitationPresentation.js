export function invitationAction(
  row,
  canManage,
  openingStatus,
  now = Date.now(),
) {
  if (
    !canManage ||
    [
      "hired",
      "rejected",
      "shortlisted",
      "final_interview",
      "needs_review",
      "interviewing",
    ].includes(row.stage)
  )
    return "review";
  const active =
    row.issued_at && !row.revoked_at && Date.parse(row.expires_at) > now;
  if (active) return "copy";
  return openingStatus === "open" ? "issue" : "review";
}
// Links are ephemeral: hash-only server tokens cannot be retrieved. A copied
// link must still belong to the current issuance, not an older revoked one.
export function currentInvitation(row, links) {
  const link = links[row.id];
  return link &&
    row.issued_at &&
    !row.revoked_at &&
    Date.parse(row.expires_at) > Date.now() &&
    Date.parse(row.expires_at) === Date.parse(link.expiresAt)
    ? link
    : null;
}
