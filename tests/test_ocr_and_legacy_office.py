#!/usr/bin/env python3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.content.extractors import detect_extractor, extract_text_from_file  # noqa: E402
from canvas_parser.content.legacy_office import _extract_utf16_le_strings, extract_legacy_office_text  # noqa: E402
from canvas_parser.content.ocr import ocr_enabled, ocr_image_bytes  # noqa: E402


class OcrAndLegacyOfficeTests(unittest.TestCase):
    def test_detect_extractor_accepts_legacy_and_image_types(self):
        self.assertEqual(detect_extractor('application/msword', 'notes.doc'), 'doc')
        self.assertEqual(detect_extractor('application/vnd.ms-powerpoint', 'slides.ppt'), 'ppt')
        self.assertEqual(detect_extractor('image/png', 'diagram.png'), 'image')

    def test_extract_utf16_le_strings(self):
        payload = 'Hello'.encode('utf-16-le') + b'\x00\x00' + 'World'.encode('utf-16-le')
        strings = _extract_utf16_le_strings(payload, min_length=4)
        self.assertIn('Hello', strings)
        self.assertIn('World', strings)

    def test_extract_legacy_office_text_without_olefile(self):
        with tempfile.NamedTemporaryFile(suffix='.ppt', delete=False) as handle:
            handle.write(b'not-an-ole-file')
            path = Path(handle.name)
        try:
            self.assertEqual(extract_legacy_office_text(path), '')
        finally:
            path.unlink(missing_ok=True)

    def test_ocr_image_bytes_when_enabled(self):
        fake_tesseract = mock.MagicMock()
        fake_tesseract.image_to_string.return_value = 'Axis label'
        fake_image = mock.MagicMock()
        fake_image.__enter__.return_value.convert.return_value = object()
        fake_pil = mock.MagicMock()
        fake_pil.Image.open.return_value = fake_image
        with mock.patch('canvas_parser.content.ocr.ocr_enabled', return_value=True), \
             mock.patch.dict('sys.modules', {'PIL': fake_pil, 'pytesseract': fake_tesseract}):
            text = ocr_image_bytes(b'fake-png-bytes')
        self.assertEqual(text, 'Axis label')

    def test_image_extractor_falls_back_without_ocr(self):
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as handle:
            handle.write(b'\x89PNG\r\n')
            path = Path(handle.name)
        try:
            with mock.patch('canvas_parser.content.ocr.ocr_image_file', return_value=''):
                extracted = extract_text_from_file(path, 'image')
            self.assertIn('[Image file:', extracted['text'])
        finally:
            path.unlink(missing_ok=True)


if __name__ == '__main__':
    unittest.main()
