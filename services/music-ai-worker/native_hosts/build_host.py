#!/usr/bin/env python3
"""Build a single checksum-bound executable native host zipapp.

The archive is reproducible: sources are normalised to LF bytes, members are
stored uncompressed in sorted order with the fixed ZIP epoch timestamp and
fixed permissions, so the same committed files give the same SHA-256 on
Windows, Linux and inside the image build (zipapp.create_archive would stamp
the builder's local time). That checksum is what the approved host registry
(`approved_native_hosts.json`) pins.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import os
import zipfile
from pathlib import Path

ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)
INTERPRETER = b"#!/usr/bin/env python3\n"
ENTRY_POINTS = {"vst3": "pedalboard_vst3_host.py", "sfz": "sfizz_track_model_host.py"}
# Shared protocol code bundled beside the entry point, relative to native_hosts/.
SHARED_SOURCES = {
    "vst3": ("common.py",),
    "sfz": ("common.py", "../sfizz_instrument_map.py"),
}


def normalised_source(path: Path) -> bytes:
    return path.read_bytes().replace(b"\r\n", b"\n")


def host_archive(kind: str) -> bytes:
    root = Path(__file__).resolve().parent
    members: dict[str, bytes] = {}
    members["__main__.py"] = normalised_source(root / ENTRY_POINTS[kind]).replace(
        b'sys.path.insert(0, str(Path(__file__).resolve().parent))\n', b""
    )
    for shared in SHARED_SOURCES[kind]:
        source = (root / shared).resolve()
        members[source.name] = normalised_source(source)
    buffer = io.BytesIO()
    buffer.write(INTERPRETER)
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        for name in sorted(members):
            info = zipfile.ZipInfo(name, date_time=ZIP_EPOCH)
            info.compress_type = zipfile.ZIP_STORED
            # ZipInfo stamps the builder's OS into "version made by" (0 on
            # Windows, 3 on Unix); pin it, or the same sources hash differently
            # on the operator's machine and inside the image build.
            info.create_system = 3
            info.create_version = 20
            info.extract_version = 20
            info.external_attr = 0o644 << 16
            archive.writestr(info, members[name])
    return buffer.getvalue()


def build_host(kind: str, output: Path) -> str:
    data = host_archive(kind)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(data)
    os.chmod(output, 0o755)
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=tuple(ENTRY_POINTS))
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    print(build_host(args.kind, args.output))


if __name__ == "__main__":
    main()
