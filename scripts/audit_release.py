"""Fail releases with common accidental local data or credential inclusions."""

import re
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
files = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
forbidden = re.compile(
    r"(?:/Users/[^/\s]+/|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,})"
)
errors = []
for name in filter(None, files):
    path = root / name
    if path.suffix in {".db", ".sqlite", ".key", ".log", ".env"} or path.name in {
        "admin.token",
        "master.key",
    }:
        errors.append(name + ": local state file")
    if path.name == "audit_release.py":
        continue
    text = path.read_text(errors="replace")
    if forbidden.search(text):
        errors.append(name + ": possible local path or credential")
if not files or files == [""]:
    errors.append("No tracked files to audit; stage the intended release first.")
if errors:
    print("\n".join(errors), file=sys.stderr)
    raise SystemExit(1)
print("Release file audit passed:", len(list(filter(None, files))), "tracked files")
