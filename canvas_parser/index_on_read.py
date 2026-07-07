"""Download-on-read block indexing for Canvas files not yet parsed locally.

Extracts positioned PDF/text blocks without running the full LLM parser pass,
persists them onto the file node in canvas_graph.json, and optionally deletes
the temporary download when the file was not already cached under canvasfiles/.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.content.extractors import detect_extractor, extract_text_from_file  # noqa: E402
from canvas_parser.content.file_retrieval_index import (  # noqa: E402
    index_file_node_for_retrieval,
    load_weekly_schedule,
)
from canvas_parser.content.page_blocks import pages_missing_positioned_blocks  # noqa: E402

EPHEMERAL_INDEX_DIR = ROOT / '.cache' / 'ephemeral_index'


def default_graph_path() -> Path:
    from parser import CANVAS_GRAPH_PATH  # noqa: WPS433

    return Path(CANVAS_GRAPH_PATH)


def local_canvasfile_path(file_id: str) -> Path:
    from parser import folder  # noqa: WPS433

    return Path(folder) / str(file_id)


def is_indexable_file(filename: str = '', content_type: str = '') -> bool:
    return bool(detect_extractor(content_type, filename))


def file_node_has_blocks(file_node: dict | None) -> bool:
    if not isinstance(file_node, dict):
        return False
    return not pages_missing_positioned_blocks(file_node.get('pages'))


def count_page_blocks(pages) -> int:
    total = 0
    for page in pages or []:
        if not isinstance(page, dict):
            continue
        blocks = page.get('blocks') if isinstance(page.get('blocks'), list) else []
        total += sum(1 for block in blocks if isinstance(block, dict) and block.get('text'))
    return total


def patch_graph_file_node(
    graph_path: Path,
    course_id: str,
    file_id: str,
    pages,
    metadata: dict | None = None,
) -> dict:
    from parser import atomic_write_json, merge_file_pages, normalize_file_pages  # noqa: WPS433

    graph_path = Path(graph_path)
    with graph_path.open('r', encoding='utf-8') as handle:
        graph = json.load(handle)

    files = graph.setdefault('files', {})
    course_files = files.setdefault(str(course_id), {})
    file_node = course_files.get(str(file_id))
    if not isinstance(file_node, dict):
        file_node = {}

    file_node['fileid'] = str(file_id)
    file_node['courseid'] = str(course_id)
    metadata = metadata if isinstance(metadata, dict) else {}
    for key in ('name', 'downloadurl', 'canvaspreviewurl', 'type'):
        value = metadata.get(key)
        if value:
            file_node[key] = value

    incoming_pages = normalize_file_pages(pages or [], str(file_id))
    existing_pages = file_node.get('pages') if isinstance(file_node.get('pages'), list) else []
    file_node['pages'] = merge_file_pages(existing_pages, incoming_pages)
    weekly = load_weekly_schedule(ROOT / 'canvas_data.json')
    index_file_node_for_retrieval(
        file_node,
        courseid=str(course_id),
        fileid=str(file_id),
        graph=graph,
        weekly_schedule=weekly,
    )
    course_files[str(file_id)] = file_node
    atomic_write_json(graph_path, graph)
    return file_node


def extract_blocks_from_path(
    filepath: Path,
    file_id: str,
    filename: str = '',
    content_type: str = '',
):
    from parser import build_pdf_pages, build_document_pages_from_text  # noqa: WPS433

    extractor_kind = detect_extractor(content_type, filename or filepath.name)
    if not extractor_kind:
        extractor_kind = 'pdf' if str(filepath).lower().endswith('.pdf') else ''
    if not extractor_kind:
        return []

    if extractor_kind == 'pdf':
        return build_pdf_pages(str(filepath), str(file_id))

    extracted = extract_text_from_file(
        filepath,
        extractor_kind,
        build_pdf_pages=build_pdf_pages,
        fileid=str(file_id),
    )
    pages = extracted.get('pages', []) if isinstance(extracted, dict) else []
    if pages:
        return pages
    text = extracted.get('text', '') if isinstance(extracted, dict) else ''
    if text:
        return build_document_pages_from_text(str(file_id), text)
    return []


def index_file_on_read(
    course_id: str,
    file_id: str,
    download_url: str,
    *,
    filename: str = '',
    content_type: str = '',
    canvas_preview_url: str = '',
    graph_path: Path | None = None,
    ephemeral: bool = True,
    persist: bool = True,
) -> dict:
    from parser import downloadtopath, normalize_file_pages  # noqa: WPS433

    course_id = str(course_id or '').strip()
    file_id = str(file_id or '').strip()
    download_url = str(download_url or '').strip()
    if not course_id or not file_id:
        return {'ok': False, 'error': 'courseId and fileId are required'}
    if not download_url:
        return {'ok': False, 'error': 'downloadUrl is required'}
    if not is_indexable_file(filename, content_type):
        return {'ok': False, 'error': 'file type is not indexable on read', 'skipped': True}

    graph_path = Path(graph_path or default_graph_path())
    existing_node = None
    if graph_path.exists():
        try:
            with graph_path.open('r', encoding='utf-8') as handle:
                graph = json.load(handle)
            existing_node = ((graph.get('files') or {}).get(course_id) or {}).get(file_id)
        except (OSError, json.JSONDecodeError):
            existing_node = None
    if file_node_has_blocks(existing_node):
        pages = existing_node.get('pages') if isinstance(existing_node, dict) else []
        return {
            'ok': True,
            'indexed': False,
            'alreadyIndexed': True,
            'pageCount': len(pages or []),
            'blockCount': count_page_blocks(pages),
        }

    cached_path = local_canvasfile_path(file_id)
    downloaded_to_ephemeral = False
    filepath = cached_path
    if not filepath.exists():
        EPHEMERAL_INDEX_DIR.mkdir(parents=True, exist_ok=True)
        filepath = EPHEMERAL_INDEX_DIR / str(file_id)
        if not downloadtopath(filepath, download_url):
            return {'ok': False, 'error': 'download failed', 'downloadUrl': download_url}
        downloaded_to_ephemeral = True

    try:
        pages = extract_blocks_from_path(filepath, file_id, filename=filename, content_type=content_type)
    except Exception as error:  # noqa: BLE001
        if downloaded_to_ephemeral and ephemeral:
            filepath.unlink(missing_ok=True)
        return {'ok': False, 'error': f'extract failed: {error}'}

    pages = normalize_file_pages(pages or [], str(file_id))
    if not pages or pages_missing_positioned_blocks(pages):
        if downloaded_to_ephemeral and ephemeral:
            filepath.unlink(missing_ok=True)
        return {'ok': False, 'error': 'no positioned blocks extracted'}

    metadata = {
        'name': filename,
        'downloadurl': download_url,
        'canvaspreviewurl': canvas_preview_url,
        'type': detect_extractor(content_type, filename) or 'pdf',
    }
    if persist:
        if not graph_path.exists():
            from canvas_parser.graph.upgrade import upgrade_graph_state
            from parser import atomic_write_json  # noqa: WPS433

            graph = upgrade_graph_state({})
            file_node = {
                'fileid': file_id,
                'courseid': course_id,
                **metadata,
                'pages': pages,
            }
            weekly = load_weekly_schedule(ROOT / 'canvas_data.json')
            index_file_node_for_retrieval(
                file_node,
                courseid=str(course_id),
                fileid=str(file_id),
                graph=graph,
                weekly_schedule=weekly,
            )
            graph.setdefault('files', {}).setdefault(course_id, {})[file_id] = file_node
            graph_path.parent.mkdir(parents=True, exist_ok=True)
            atomic_write_json(graph_path, graph)
        else:
            patch_graph_file_node(graph_path, course_id, file_id, pages, metadata)

    ephemeral_deleted = False
    if downloaded_to_ephemeral and ephemeral:
        filepath.unlink(missing_ok=True)
        ephemeral_deleted = True

    return {
        'ok': True,
        'indexed': True,
        'alreadyIndexed': False,
        'pageCount': len(pages),
        'blockCount': count_page_blocks(pages),
        'ephemeralDeleted': ephemeral_deleted,
        'usedCachedCanvasfile': not downloaded_to_ephemeral,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Index Canvas file blocks on read')
    parser.add_argument('--payload', default='-', help='JSON payload path or "-" for stdin')
    args = parser.parse_args(argv)

    if args.payload == '-':
        raw = sys.stdin.read()
    else:
        raw = Path(args.payload).read_text(encoding='utf-8')
    payload = json.loads(raw or '{}')

    result = index_file_on_read(
        payload.get('courseId') or payload.get('courseid') or '',
        payload.get('fileId') or payload.get('fileid') or '',
        payload.get('downloadUrl') or payload.get('downloadurl') or '',
        filename=str(payload.get('filename') or payload.get('name') or ''),
        content_type=str(payload.get('contentType') or payload.get('content_type') or ''),
        canvas_preview_url=str(payload.get('canvasPreviewUrl') or payload.get('canvaspreviewurl') or ''),
        graph_path=Path(payload['graphPath']) if payload.get('graphPath') else None,
        ephemeral=bool(payload.get('ephemeral', True)),
        persist=bool(payload.get('persist', True)),
    )
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    return 0 if result.get('ok') else 1


if __name__ == '__main__':
    raise SystemExit(main())
