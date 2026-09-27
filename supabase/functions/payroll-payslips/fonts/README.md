# Payslip Unicode font

Release-controlled Noto Sans SC variable TrueType, from the Noto CJK project.
Original source: https://github.com/notofonts/noto-cjk/tree/main/Sans/Variable/TTF/Subset
SHA-256: `d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964`.

`qa/staging/preparePayslipFonts.py` prepares static weight-400 Unicode shards with
fonttools 4.66.0 before release. `prepared.json` maps every one of the original
30,890 mapped codepoints to one of 211 shards. Preparation verifies complete
coverage, retains source timestamps, and uses deterministic gzip timestamps.
No document-specific or fixed language subset is used. Unsupported characters
outside the original source coverage fail closed, never render as blank glyphs.

Upload `prepared/` to the private `payroll-renderer-assets/prepared-v1/` prefix
before deploying the gateway. Every filename is the uncompressed SHA-256;
never overwrite a published content-addressed asset. The gateway downloads only
the required shards, verifies sizes and hashes, and embeds them without runtime
subsetting. No font URL is exposed to clients and no upstream font is fetched.
Existing immutable artifacts are not regenerated. Retain the SIL OFL license.
