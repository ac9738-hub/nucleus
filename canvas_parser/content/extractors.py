import json
from pathlib import Path


PARSEABLE_MIME_TYPES = {
    'application/pdf': 'pdf',
    'text/plain': 'text',
    'text/markdown': 'text',
    'application/json': 'json',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
}


def detect_extractor(content_type='', filename=''):
    mime = str(content_type or '').casefold().split(';')[0].strip()
    if mime in PARSEABLE_MIME_TYPES:
        return PARSEABLE_MIME_TYPES[mime]

    suffix = Path(str(filename or '')).suffix.casefold()
    mapping = {
        '.pdf': 'pdf',
        '.txt': 'text',
        '.md': 'text',
        '.json': 'json',
        '.docx': 'docx',
        '.pptx': 'pptx',
        '.ipynb': 'ipynb',
    }
    return mapping.get(suffix, '')


def extract_text_from_file(path, extractor_kind, build_pdf_pages=None):
    path = Path(path)
    if not path.exists():
        return {'text': '', 'pages': []}

    if extractor_kind == 'pdf' and build_pdf_pages:
        pages = build_pdf_pages(str(path))
        text = '\n\n'.join(page.get('text', '') for page in pages if page.get('text'))
        return {'text': text, 'pages': pages}

    if extractor_kind in {'text', 'json'}:
        text = path.read_text(encoding='utf-8', errors='replace')
        return {'text': text, 'pages': []}

    if extractor_kind == 'docx':
        try:
            from docx import Document
        except ModuleNotFoundError:
            return {'text': '', 'pages': []}
        document = Document(str(path))
        text = '\n'.join(paragraph.text for paragraph in document.paragraphs if paragraph.text)
        return {'text': text, 'pages': []}

    if extractor_kind == 'pptx':
        try:
            from pptx import Presentation
        except ModuleNotFoundError:
            return {'text': '', 'pages': []}
        presentation = Presentation(str(path))
        chunks = []
        for slide_index, slide in enumerate(presentation.slides, start=1):
            slide_text = []
            for shape in slide.shapes:
                text = getattr(shape, 'text', '')
                if text:
                    slide_text.append(text)
            if slide_text:
                chunks.append(f"Slide {slide_index}\n" + '\n'.join(slide_text))
        text = '\n\n'.join(chunks)
        return {'text': text, 'pages': []}

    if extractor_kind == 'ipynb':
        try:
            notebook = json.loads(path.read_text(encoding='utf-8', errors='replace'))
        except (json.JSONDecodeError, OSError):
            return {'text': '', 'pages': []}
        chunks = []
        for cell in notebook.get('cells', []):
            source = cell.get('source', [])
            if isinstance(source, list):
                source = ''.join(source)
            if source:
                chunks.append(str(source))
        return {'text': '\n\n'.join(chunks), 'pages': []}

    return {'text': '', 'pages': []}
