"""Best-effort text extraction for legacy binary Office files (.doc, .ppt)."""
from __future__ import annotations

import re
from pathlib import Path


def _extract_utf16_le_strings(data: bytes, min_length: int = 4) -> list[str]:
    strings: list[str] = []
    seen: set[str] = set()
    index = 0
    while index < len(data) - 1:
        chars: list[str] = []
        cursor = index
        while cursor < len(data) - 1:
            code = data[cursor] | (data[cursor + 1] << 8)
            cursor += 2
            if code in (9, 10, 13) or 32 <= code < 127:
                chars.append(chr(code))
            else:
                break
        if len(chars) >= min_length:
            text = re.sub(r'\s+', ' ', ''.join(chars)).strip()
            if text and text not in seen:
                seen.add(text)
                strings.append(text)
        index = max(index + 1, cursor)
    return strings


def _read_ole_stream(path: Path, stream_names: tuple[str, ...]) -> bytes:
    try:
        import olefile
    except ModuleNotFoundError:
        return b''
    if not olefile.isOleFile(str(path)):
        return b''
    ole = olefile.OleFileIO(str(path))
    try:
        for stream_name in stream_names:
            if ole.exists(stream_name):
                return ole.openstream(stream_name).read()
    finally:
        ole.close()
    return b''


def extract_legacy_office_text(path, suffix: str = '') -> str:
    path = Path(path)
    suffix = str(suffix or path.suffix).casefold()
    if suffix == '.ppt':
        streams = ('PowerPoint Document', 'Current User')
    elif suffix == '.doc':
        streams = ('WordDocument',)
    else:
        return ''

    data = _read_ole_stream(path, streams)
    if not data:
        return ''
    strings = _extract_utf16_le_strings(data)
    if not strings:
        strings = _extract_utf16_le_strings(data, min_length=3)
    return '\n'.join(strings[:400])
