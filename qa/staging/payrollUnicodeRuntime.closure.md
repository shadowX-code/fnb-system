# Unicode Payslip runtime closure — 27 September 2026

## Root cause and release boundary

The old cold request downloaded/decompressed/hashed 17,773,132 bytes of variable
font, parsed its full character/variation tables, embedded the entire font and
compressed it during PDF serialization. A full static test produced 6,455,110
PDF bytes; the pdf-lib/fontkit request-time subset path produced incorrect glyph
output. The deployed original path reproduced HTTP 546 CPU-limit failure.

The fix retains the existing Edge gateway and one A4 layout/projection. FontTools
4.66.0 release preparation instantiates weight 400 and creates 211 deterministic
Unicode-block shards covering all 30,890 original mapped characters. Each shard
has a verified size/SHA-256. Runtime loads only required shards and uses full
embedding of those small, prebuilt fonts; no runtime font subsetting, external
font URL, retries, new infrastructure or document-limit migration is introduced.
Missing source-font coverage fails closed. Previous immutable artifacts remain
unchanged. Both Draft and Final call the same render function.

## Authenticated canonical Staging evidence

Gateway deployed to `ujkzdaaadnvcfayuldmh`. Eight consecutive Admin Draft renders
between 12:08:00–12:12:18 UTC returned HTTP 200: seven first-render/cold isolates
and one warm render. No CPU-limit failure in this window. Cold metrics:

| Document | PDF bytes | Font bytes | Load ms | Parse/embed ms | Layout ms | Serialize ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Chinese Monthly (first) | 728501 | 1092988 | 663 | 14 | 43 | 175 |
| Chinese Monthly (cold repeat) | 728501 | 1092988 | 393 | 13 | 38 | 175 |
| Chinese Monthly (cold repeat) | 728501 | 1092988 | 149 | 13 | 38 | 173 |
| Latin Monthly | 19593 | 26348 | 451 | 6 | 46 | 37 |
| Latin Hourly | 19061 | 26348 | 121 | 7 | 35 | 26 |
| Latin Hourly (cold repeat) | 19061 | 26348 | 91 | 7 | 36 | 27 |
| Latin Hourly (cold repeat) | 19061 | 26348 | 81 | 6 | 34 | 27 |

Chrome PDF viewer and downloaded PDF inspection confirmed Latin, Chinese
employer/employee/workplace glyphs and RM values. All pages are A4
595.28 × 841.89 points. Monthly shows allowance and statutory lines; Hourly shows
2.00 hours × RM20.00 and correctly keeps unresolved Net Pay unavailable.

No employee, calculation, Finalize or existing artifact mutation was necessary.
The earlier disposable Unicode Draft employee/employer remain retired; this
verification reused its approved Draft evidence plus existing QA Draft reads.
No new sessions or Final artifacts were created.

## Focused local contracts and compatibility

Monthly/Hourly/Draft/Final canonical renderer, deterministic retry bytes, Unicode
pagination, complete release-font coverage, unsupported-character rejection and
sub-5-MiB representative size pass. Long Unicode output is 482,089 bytes.
Original renderer layout/content and financial projection remain shared.
Existing document authority, upload-without-overwrite, stored-byte hash check,
final artifact RPC and post-render reauthorization are unchanged.

The deployed database actually retains the earlier 16-MiB artifact schema cap;
the fix neither changes nor relies on it. Every tested PDF is below even the
original 5-MiB boundary. No applied migration is rewritten; the exact existing
66-migration release manifest remains unchanged.
