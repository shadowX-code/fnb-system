"""Build the Windows installer with NSIS. Supply a Staging publishable key file."""
from pathlib import Path
from shutil import copy2
from subprocess import run
from sys import argv
from tempfile import TemporaryDirectory

connector = Path(__file__).resolve().parent.parent
output = Path(argv[1]).resolve()
key_file = Path(argv[2])
if not key_file.read_text().strip().startswith("sb_publishable_"):
    raise ValueError("Use the Staging Supabase publishable key.")
with TemporaryDirectory() as temp:
    payload = Path(temp)
    sql = connector.parent / "autocount-aed-test-sql"
    sources = {
        "sync.ps1": connector / "sync.ps1",
        "provisioning.ps1": connector / "provisioning.ps1",
        "installer/staging-public-key.txt": key_file,
    }
    for group, root, files in (
        ("installer", connector / "installer", ("desktop.ps1", "worker.ps1", "device.ps1")),
        ("common", connector / "common", ("credentials.ps1", "accounting-read.ps1")),
        ("sql", sql, ("sql-read.ps1", "connection.ps1", "local-paths.ps1")),
    ):
        for file in files:
            sources[f"{group}/{file}"] = root / file
    for name, source in sources.items():
        target = payload / name
        target.parent.mkdir(parents=True, exist_ok=True)
        copy2(source, target)
    output.parent.mkdir(parents=True, exist_ok=True)
    run([
        "makensis", f"-DOUTPUT={output}", f"-DPAYLOAD={payload}", str(connector / "installer/Setup.nsi")
    ], check=True)
