"""Optional OCR helpers for PDF figures and raster image files.

Uses pytesseract when installed; otherwise returns empty text so callers can fall
back to placeholders. Disable with NUCLEUS_OCR=0.
"""
from __future__ import annotations

import io
import os
import shutil


def ocr_enabled() -> bool:
    if str(os.getenv('NUCLEUS_OCR', '1')).strip().lower() in {'0', 'false', 'no', 'off'}:
        return False
    try:
        import pytesseract  # noqa: F401
    except ModuleNotFoundError:
        return False
    return bool(shutil.which('tesseract'))


def _clean_ocr_text(text: str, min_chars: int = 3) -> str:
    cleaned = ' '.join(str(text or '').split()).strip()
    if len(cleaned) < min_chars:
        return ''
    return cleaned


def ocr_image_bytes(image_bytes: bytes, min_chars: int = 3) -> str:
    if not image_bytes or not ocr_enabled():
        return ''
    try:
        from PIL import Image
        import pytesseract
    except ModuleNotFoundError:
        return ''
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            rgb = image.convert('RGB')
            text = pytesseract.image_to_string(rgb)
    except Exception:
        return ''
    return _clean_ocr_text(text, min_chars=min_chars)


def ocr_fitz_pixmap(pix, min_chars: int = 3) -> str:
    if pix is None or not ocr_enabled():
        return ''
    try:
        import fitz
    except ModuleNotFoundError:
        return ''
    try:
        working = pix
        if working.n - working.alpha >= 4:
            working = fitz.Pixmap(fitz.csRGB, working)
        return ocr_image_bytes(working.tobytes('png'), min_chars=min_chars)
    except Exception:
        return ''


def ocr_image_file(path, min_chars: int = 3) -> str:
    path = str(path or '')
    if not path:
        return ''
    try:
        with open(path, 'rb') as handle:
            return ocr_image_bytes(handle.read(), min_chars=min_chars)
    except OSError:
        return ''


def ocr_pdf_page_image_block(page, bbox, min_chars: int = 3) -> str:
    if page is None or not ocr_enabled():
        return ''
    try:
        import fitz
    except ModuleNotFoundError:
        return ''
    try:
        rect = fitz.Rect(bbox)
        if rect.is_empty or rect.width < 12 or rect.height < 12:
            return ''
        pix = page.get_pixmap(clip=rect, matrix=fitz.Matrix(2, 2), alpha=False)
        return ocr_fitz_pixmap(pix, min_chars=min_chars)
    except Exception:
        return ''
