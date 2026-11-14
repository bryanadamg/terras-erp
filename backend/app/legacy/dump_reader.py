"""Read the legacy ERP's MySQL Administrator dump without loading MySQL.

The dump writes one row per line (` (v1,v2,...),`), each table's rows after a
`-- Dumping data for table `x`` marker, so a table is a byte range of the file
and a row is one line. Indexing the 11 GB file takes ~10 s; reading one table
seeks straight to it. stdlib only: this runs on a laptop with `python3 -I`.
"""
from __future__ import annotations

import re
from typing import Iterator

_MARK = b"-- Dumping data for table `"
_TOKEN = re.compile(r"'((?:[^'\\]|\\.|'')*)'|(NULL)|([-+0-9.eE]+)")
_ESCAPES = {"0": "\0", "n": "\n", "r": "\r", "t": "\t", "Z": "\x1a"}
_ESC = re.compile(r"\\(.)|''")


def _unescape(s: str) -> str:
    return _ESC.sub(lambda m: "'" if m.group(1) is None else _ESCAPES.get(m.group(1), m.group(1)), s)


def index_tables(dump_path: str) -> dict[str, tuple[int, int]]:
    """Table name -> (start, end) byte offsets of its data section."""
    marks: list[tuple[str, int]] = []
    pos = 0
    with open(dump_path, "rb") as f:
        for line in f:
            if line.startswith(_MARK):
                marks.append((line[len(_MARK):].split(b"`", 1)[0].decode(), pos))
            pos += len(line)
    ends = [m[1] for m in marks[1:]] + [pos]
    return {name: (start, end) for (name, start), end in zip(marks, ends)}


def iter_rows(dump_path: str, start: int, end: int) -> Iterator[dict[str, str | float | None]]:
    cols: list[str] = []
    with open(dump_path, "rb") as f:
        f.seek(start)
        pos = start
        for raw in f:
            pos += len(raw)
            if pos > end:
                break
            if raw.startswith(b"INSERT INTO"):
                cols = re.findall(r"`(\w+)`", raw.split(b" VALUES", 1)[0].decode())[1:]
            elif raw.startswith(b" (") and cols:
                line = raw.decode("utf-8").rstrip()
                body = line[2:line.rfind(")")]
                vals: list[str | float | None] = []
                for m in _TOKEN.finditer(body):
                    s, null, num = m.groups()
                    vals.append(None if null else float(num) if num is not None else _unescape(s))
                yield dict(zip(cols, vals))
