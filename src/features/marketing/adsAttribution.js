const numeric = (v) => typeof v === "string" && /^\d{1,30}$/.test(v);
const words = (v) =>
  String(v || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function campaignEvidence(report, brands = [], identities = []) {
  return (report?.configs?.campaigns || []).map((c) => {
    const ads = (report.configs.ads || []).filter(
      (a) => a.campaign_id === c.id,
    );
    const pages = [
      ...new Set(
        ads.map((a) => a.creative?.object_story_spec?.page_id).filter(numeric),
      ),
    ].sort();
    const instagram = [
      ...new Set(
        ads
          .map((a) => a.creative?.object_story_spec?.instagram_user_id)
          .filter(numeric),
      ),
    ].sort();
    const matched = [
      ...new Set(
        identities
          .filter((i) =>
            (i.channel === "facebook" ? pages : instagram).includes(
              i.account_id,
            ),
          )
          .map((i) => i.brand_id),
      ),
    ];
    const hints = brands
      .filter(
        (b) =>
          words(b.name).length > 2 &&
          ` ${words(c.name)} `.includes(` ${words(b.name)} `),
      )
      .map((b) => b.id);
    const conflict =
      pages.length > 1 || instagram.length > 1 || matched.length > 1;
    const key = conflict
      ? "conflict"
      : pages.length || instagram.length
        ? `identity:${pages.join(",")}:${instagram.join(",")}`
        : hints.length
          ? `suggestion:${hints.join(",")}`
          : "unresolved";
    return {
      ...c,
      evidence: { pages, instagram, matches: matched, hints, conflict, key },
    };
  });
}
export function attributionGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const e = row.evidence;
    if (!groups.has(e.key))
      groups.set(e.key, {
        key: e.key,
        rows: [],
        label: e.conflict
          ? "Conflicting identities — individual review"
          : e.pages.length || e.instagram.length
            ? `Page ${e.pages.join(", ") || "unavailable"} · Instagram ${e.instagram.join(", ") || "unavailable"}`
            : e.hints.length
              ? "Name suggestion — ownership unverified"
              : "Ownership unresolved",
        batchable: !e.conflict && Boolean(e.pages.length || e.instagram.length),
      });
    groups.get(e.key).rows.push(row);
  }
  return [...groups.values()];
}
