"""Release preparation only; no font subsetting occurs in the PDF request path.

Requires fonttools==4.66.0. Every mapped source codepoint belongs to one shard.
The original source remains checked in with its license; artifacts are addressed
by their uncompressed SHA-256 and uploaded privately before the gateway release.
"""
import gzip
import hashlib
import io
import json
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[2]
folder = root / "supabase/functions/payroll-payslips/fonts"
source = gzip.decompress((folder / "NotoSansSC-VF.ttf.gz").read_bytes())
assert hashlib.sha256(source).hexdigest() == "d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964"
font = instantiateVariableFont(TTFont(io.BytesIO(source), recalcTimestamp=False), {"wght": 400}, inplace=True)
static = io.BytesIO()
font.save(static)
codepoints = sorted(font.getBestCmap())
groups = {}
for cp in codepoints:
    groups.setdefault(cp // 256, []).append(cp)
out = folder / "prepared"
out.mkdir(exist_ok=True)
shards = {}
for block, chars in groups.items():
    part = TTFont(io.BytesIO(static.getvalue()), recalcTimestamp=False)
    options = subset.Options()
    options.hinting = False
    options.layout_features = []
    worker = subset.Subsetter(options=options)
    worker.populate(unicodes=chars)
    worker.subset(part)
    assert set(part.getBestCmap()) == set(chars), "Preparation lost source glyphs"
    data = io.BytesIO()
    part.save(data)
    raw = data.getvalue()
    digest = hashlib.sha256(raw).hexdigest()
    (out / f"{digest}.ttf.gz").write_bytes(gzip.compress(raw, mtime=0))
    shards[str(block)] = {"sha256": digest, "size": len(raw), "codepoints": chars}
manifest = {"version": "noto-sc-400-shards-v1", "source_sha256": hashlib.sha256(source).hexdigest(), "codepoints": len(codepoints), "shards": shards}
(folder / "prepared.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
print(f"Prepared {len(shards)} shards preserving all {len(codepoints)} source codepoints")
