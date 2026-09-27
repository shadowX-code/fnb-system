# Payslip Unicode font

Release-controlled Noto Sans SC variable TrueType, from the Noto CJK project.
Original source: https://github.com/notofonts/noto-cjk/tree/main/Sans/Variable/TTF/Subset
SHA-256: `d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964`.

These are the same bytes used by renderer a4_v3. Before deploying the Edge function,
upload the gzip asset once into the private `payroll-renderer-assets` bucket at
`<SHA-256>.ttf.gz`. Never overwrite a published content-addressed asset.
Runtime generation decompresses the private release asset, verifies its hash and
never fetches an upstream font. No font URL is exposed to clients. Existing
immutable artifacts are not regenerated. Retain the accompanying SIL OFL license.
