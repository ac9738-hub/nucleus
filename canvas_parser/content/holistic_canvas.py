"""Holistic Canvas content discovery for Synapse Learn (homepages, links, externals)."""
from __future__ import annotations

import json
import re
from html import unescape
from pathlib import Path

from canvas_parser.content.links import (
    extract_canvas_file_ids_from_html,
    extract_links_from_html,
)

ROOT = Path(__file__).resolve().parents[2]
CANVAS_DATA_PATH = ROOT / 'canvas_data.json'
CANVAS_HOMEPAGES_DIR = ROOT / 'app' / 'canvas' / 'canvas_homepages'
OUTSIDE_SOURCES_DIR = ROOT / 'outside_sources'
LOCAL_HYDRATE_PROBE_LIMIT = 8
MIN_PAGE_BODY_CHARS = 80
MIN_SEARCHTEXT_CHARS = 120

PDF_LINK_PATTERN = re.compile(
    r'<a\b[^>]*href=["\'][^"\']+\.pdf[^"\']*["\'][^>]*>(.*?)</a>',
    re.IGNORECASE | re.DOTALL,
)
CANVAS_HELP_BLOCK = re.compile(
    r'technical requirements for canvas|browser requirements for canvas|'
    r'canvas companion guide|field guide to canvas|get help|clear your browser',
    re.I,
)
GENERIC_EXTERNAL = re.compile(
    r'^(?:home|index|website|link|resource|external|click here)$',
    re.I,
)

_canvas_data_cache: dict | None = None


def load_canvas_data() -> dict:
    global _canvas_data_cache
    if _canvas_data_cache is not None:
        return _canvas_data_cache
    try:
        _canvas_data_cache = json.loads(CANVAS_DATA_PATH.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        _canvas_data_cache = {}
    return _canvas_data_cache


def _course_label(course_id: str, canvas_data: dict, graph: dict) -> str:
    for course in canvas_data.get('courses') or []:
        if not isinstance(course, dict):
            continue
        if str(course.get('id') or '') == str(course_id):
            return str(course.get('name') or course.get('course_code') or course_id)
    syllabi = graph.get('syllabi') or {}
    row = syllabi.get(str(course_id)) or {}
    return str(row.get('name') or course_id)


def _strip_themed_homepage_html(raw_html: str) -> str:
    text = str(raw_html or '')
    body_match = re.search(r'<body\b[^>]*>(.*)</body>', text, flags=re.IGNORECASE | re.DOTALL)
    if body_match:
        return body_match.group(1).strip()
    return text.strip()


def read_homepage_html(course_id: str, canvas_data: dict | None = None) -> tuple[str, str]:
    """Return (title, body_html) from disk cache or canvas_data front_pages."""
    course_id = str(course_id or '').strip()
    canvas_data = canvas_data if canvas_data is not None else load_canvas_data()
    title = _course_label(course_id, canvas_data, {})
    disk_path = CANVAS_HOMEPAGES_DIR / f'{course_id}.html'
    if disk_path.exists():
        return title, _strip_themed_homepage_html(disk_path.read_text(encoding='utf-8'))
    front_page = (canvas_data.get('front_pages') or {}).get(course_id) or {}
    body = str(front_page.get('body') or '').strip()
    if body:
        title = str(front_page.get('title') or title)
        return title, body
    return title, ''


def _canvas_data_bucket(canvas_data: dict, bucket_name: str, course_id: str):
    bucket = canvas_data.get(bucket_name) or {}
    if not isinstance(bucket, dict):
        return None
    rows = bucket.get(str(course_id))
    if rows is None and str(course_id).isdigit():
        rows = bucket.get(int(course_id))  # type: ignore[arg-type]
    return rows


def _module_items_for_course(course_id: str, canvas_data: dict) -> dict:
    rows = _canvas_data_bucket(canvas_data, 'module_items', course_id)
    return rows if isinstance(rows, dict) else {}


def _modules_for_course(course_id: str, canvas_data: dict) -> list[dict]:
    rows = _canvas_data_bucket(canvas_data, 'modules', course_id)
    return rows if isinstance(rows, list) else []


def _module_name_map(course_id: str, canvas_data: dict) -> dict[str, str]:
    names: dict[str, str] = {}
    for module in _modules_for_course(course_id, canvas_data):
        if isinstance(module, dict):
            names[str(module.get('id') or '')] = str(module.get('name') or '').strip()
    return names


def _module_position_map(course_id: str, canvas_data: dict) -> dict[str, int]:
    positions: dict[str, int] = {}
    for module in _modules_for_course(course_id, canvas_data):
        if not isinstance(module, dict):
            continue
        module_id = str(module.get('id') or '')
        if module_id:
            positions[module_id] = int(module.get('position') or 0)
    return positions


def collect_canvas_module_file_rows(course_id: str, canvas_data: dict | None = None) -> list[dict]:
    """File module items from canvas_data with titles and content IDs."""
    course_id = str(course_id or '').strip()
    canvas_data = canvas_data if canvas_data is not None else load_canvas_data()
    module_names = _module_name_map(course_id, canvas_data)
    module_positions = _module_position_map(course_id, canvas_data)
    rows: list[dict] = []
    module_rows = _module_items_for_course(course_id, canvas_data)
    if not isinstance(module_rows, dict):
        return rows

    for module_id, items in module_rows.items():
        if not isinstance(items, list):
            continue
        module_name = module_names.get(str(module_id), '')
        module_position = module_positions.get(str(module_id), 999)
        for item in items:
            if not isinstance(item, dict):
                continue
            if str(item.get('type') or '').lower() != 'file':
                continue
            title = str(item.get('title') or '').strip()
            content_id = str(item.get('content_id') or '').strip()
            if not title:
                continue
            rows.append({
                'kind': 'file',
                'title': title,
                'contentId': content_id,
                'moduleName': module_name,
                'modulePosition': module_position,
                'position': int(item.get('position') or 0),
            })
    rows.sort(
        key=lambda row: (
            int(row.get('modulePosition') or 999),
            int(row.get('position') or 0),
            str(row.get('moduleName') or '').casefold(),
        )
    )
    return rows


def collect_graph_module_resource_rows(course_id: str, graph: dict) -> list[dict]:
    """Module hints from graph when canvas_data module_items is sparse."""
    course_id = str(course_id or '').strip()
    hints = (graph.get('moduleOrderHints') or {}).get(course_id) or {}
    course_files = (graph.get('files') or {}).get(course_id) or {}
    if not isinstance(hints, dict):
        return []

    rows: list[dict] = []
    for hint_key, hint in sorted(
        ((key, value) for key, value in hints.items() if isinstance(value, dict)),
        key=lambda pair: (
            str(pair[1].get('moduleName') or ''),
            int(pair[1].get('position') or 0),
        ),
    ):
        item_type = str(hint.get('itemType') or '').lower()
        if item_type not in {'externalurl', 'externaltool', 'page'}:
            continue
        content_id = str(hint.get('contentId') or '').strip()
        module_name = str(hint.get('moduleName') or '').strip()
        file_node = course_files.get(str(hint_key)) or course_files.get(content_id) or {}
        title = str((file_node or {}).get('name') or module_name or content_id).strip()
        url = str(
            (file_node or {}).get('downloadurl')
            or (file_node or {}).get('canvaspreviewurl')
            or (file_node or {}).get('url')
            or ''
        ).strip()
        if not title or GENERIC_EXTERNAL.match(title):
            continue
        rows.append({
            'kind': 'external' if 'external' in item_type else 'page',
            'title': re.sub(r'\.(pdf|html?)$', '', title, flags=re.I).strip() or title,
            'url': url,
            'moduleName': module_name,
            'position': int(hint.get('position') or 0),
            'contentId': content_id or str(hint_key),
        })
    return rows


def collect_page_body_sources(
    course_id: str,
    graph: dict,
    canvas_data: dict | None = None,
) -> list[dict]:
    """HTML/text sources for module pages and external crawls."""
    course_id = str(course_id or '').strip()
    canvas_data = canvas_data if canvas_data is not None else load_canvas_data()
    sources: list[dict] = []
    seen: set[str] = set()

    def add_source(file_id: str, title: str, body_html: str, module_name: str = '') -> None:
        fid = str(file_id or '').strip()
        body = str(body_html or '').strip()
        if not fid or len(body) < MIN_PAGE_BODY_CHARS or fid in seen:
            return
        seen.add(fid)
        sources.append({
            'fileId': fid,
            'title': str(title or fid).strip(),
            'bodyHtml': body,
            'moduleName': module_name,
        })

    for page in _canvas_data_bucket(canvas_data, 'pages', course_id) or []:
        if not isinstance(page, dict):
            continue
        body = str(page.get('body') or '').strip()
        if not body:
            continue
        page_id = str(page.get('page_id') or page.get('url') or page.get('title') or '')
        file_id = f'page-{course_id}-{page_id}' if page_id else f'page-{course_id}-{len(sources)}'
        add_source(file_id, str(page.get('title') or 'Canvas page'), body)

    module_names = _module_name_map(course_id, canvas_data)
    for module_id, items in _module_items_for_course(course_id, canvas_data).items():
        if not isinstance(items, list):
            continue
        module_name = module_names.get(str(module_id), '')
        for item in items:
            if not isinstance(item, dict):
                continue
            if str(item.get('type') or '').lower() != 'page':
                continue
            body = str(item.get('body') or '').strip()
            content_id = str(item.get('content_id') or item.get('page_id') or item.get('id') or '')
            title = str(item.get('title') or 'Canvas page')
            file_id = f'page-{content_id}' if content_id else f'page-{course_id}-{item.get("id")}'
            add_source(file_id, title, body, module_name)

    course_files = (graph.get('files') or {}).get(course_id) or {}
    if isinstance(course_files, dict):
        for file_id, file_node in course_files.items():
            if not isinstance(file_node, dict):
                continue
            fid = str(file_id)
            if fid in seen:
                continue
            searchtext = str(file_node.get('searchtext') or '').strip()
            if len(searchtext) >= MIN_SEARCHTEXT_CHARS and fid.startswith('external-site-'):
                add_source(fid, str(file_node.get('name') or fid), searchtext)

    return sources


def collect_linked_canvas_file_ids(
    course_id: str,
    graph: dict,
    canvas_data: dict | None = None,
) -> list[str]:
    """Canvas file IDs referenced in homepage, assignments, and module items."""
    course_id = str(course_id or '').strip()
    canvas_data = canvas_data if canvas_data is not None else load_canvas_data()
    seen: set[str] = set()
    ordered: list[str] = []

    def add_many(ids) -> None:
        for file_id in ids:
            fid = str(file_id or '').strip()
            if fid and fid not in seen:
                seen.add(fid)
                ordered.append(fid)

    _, homepage_html = read_homepage_html(course_id, canvas_data)
    add_many(extract_canvas_file_ids_from_html(homepage_html))

    for assignment in _canvas_data_bucket(canvas_data, 'assignments', course_id) or []:
        if not isinstance(assignment, dict):
            continue
        add_many(extract_canvas_file_ids_from_html(str(assignment.get('description') or '')))

    module_rows = _module_items_for_course(course_id, canvas_data)
    if isinstance(module_rows, dict):
        for items in module_rows.values():
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                item_type = str(item.get('type') or '').lower()
                if item_type == 'file':
                    add_many([item.get('content_id')])
                elif item_type == 'page':
                    add_many(extract_canvas_file_ids_from_html(str(item.get('body') or '')))

    for row in collect_canvas_module_file_rows(course_id, canvas_data):
        add_many([row.get('contentId')])

    hints = (graph.get('moduleOrderHints') or {}).get(course_id) or {}
    if isinstance(hints, dict):
        for hint in hints.values():
            if not isinstance(hint, dict):
                continue
            if str(hint.get('itemType') or '').lower() == 'file':
                add_many([hint.get('contentId')])
    return ordered


def collect_module_resource_rows(
    course_id: str,
    canvas_data: dict | None = None,
    graph: dict | None = None,
) -> list[dict]:
    """External URLs, module pages, and subheaders from canvas_data (+ graph fallback)."""
    course_id = str(course_id or '').strip()
    canvas_data = canvas_data if canvas_data is not None else load_canvas_data()
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    module_names = _module_name_map(course_id, canvas_data)

    def append_row(row: dict) -> None:
        title = str(row.get('title') or '').strip()
        kind = str(row.get('kind') or 'link')
        if not title:
            return
        key = (kind, title.casefold())
        if key in seen:
            return
        seen.add(key)
        rows.append(row)

    module_rows = _module_items_for_course(course_id, canvas_data)
    if isinstance(module_rows, dict):
        for module_id, items in module_rows.items():
            if not isinstance(items, list):
                continue
            module_name = module_names.get(str(module_id), '')
            for item in items:
                if not isinstance(item, dict):
                    continue
                item_type = str(item.get('type') or '').lower()
                title = str(item.get('title') or item.get('name') or '').strip()
                if not title:
                    continue
                if item_type in {'externalurl', 'externaltool', 'external_url'}:
                    url = str(
                        item.get('external_url')
                        or item.get('url')
                        or item.get('html_url')
                        or ''
                    ).strip()
                    if not url or GENERIC_EXTERNAL.match(title):
                        continue
                    append_row({
                        'kind': 'external',
                        'title': title,
                        'url': url,
                        'moduleName': module_name,
                        'position': int(item.get('position') or 0),
                    })
                elif item_type == 'page':
                    url = str(item.get('html_url') or item.get('url') or '').strip()
                    append_row({
                        'kind': 'page',
                        'title': title,
                        'url': url,
                        'moduleName': module_name,
                        'position': int(item.get('position') or 0),
                        'contentId': str(item.get('content_id') or ''),
                    })
                elif item_type == 'subheader':
                    append_row({
                        'kind': 'subheader',
                        'title': title,
                        'url': '',
                        'moduleName': module_name,
                        'position': int(item.get('position') or 0),
                    })

    if graph:
        for row in collect_graph_module_resource_rows(course_id, graph):
            append_row(row)

    rows.sort(key=lambda row: (row.get('moduleName') or '', row.get('position') or 0))
    return rows


def extract_pdf_link_labels(html: str) -> list[str]:
    labels: list[str] = []
    seen: set[str] = set()
    for match in PDF_LINK_PATTERN.finditer(str(html or '')):
        label = re.sub(r'<[^>]+>', ' ', match.group(1))
        label = re.sub(r'\s+', ' ', unescape(label)).strip()
        label = re.sub(r'\s*&nbsp;.*$', '', label, flags=re.IGNORECASE).strip()
        if label and label.casefold() not in seen:
            seen.add(label.casefold())
            labels.append(label)
    return labels


def collect_assignment_pdf_labels(course_id: str, canvas_data: dict | None = None) -> list[dict]:
    course_id = str(course_id or '').strip()
    canvas_data = canvas_data if canvas_data is not None else load_canvas_data()
    rows: list[dict] = []
    seen: set[str] = set()
    for assignment in _canvas_data_bucket(canvas_data, 'assignments', course_id) or []:
        if not isinstance(assignment, dict):
            continue
        html = str(assignment.get('description') or '')
        assignment_name = str(assignment.get('name') or '').strip()
        for label in extract_pdf_link_labels(html):
            key = label.casefold()
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                'title': label,
                'assignmentName': assignment_name,
                'moduleName': assignment_name or 'Linked materials',
            })
    return rows


def _outside_source_markdown(course_id: str) -> list[dict]:
    course_dir = OUTSIDE_SOURCES_DIR / str(course_id)
    if not course_dir.is_dir():
        return []
    rows: list[dict] = []
    for path in sorted(course_dir.glob('*.md')):
        try:
            text = path.read_text(encoding='utf-8').strip()
        except OSError:
            continue
        if len(text) < 120:
            continue
        stem = path.stem
        title = re.sub(r'-[a-f0-9]{8,}$', '', stem, flags=re.I).replace('-', ' ').strip()
        rows.append({'title': title or stem, 'text': text, 'path': str(path)})
    return rows


def _outside_source_pdf_paths(course_id: str) -> list[Path]:
    pdf_dir = OUTSIDE_SOURCES_DIR / str(course_id) / 'pdfs'
    if not pdf_dir.is_dir():
        return []
    return sorted(path for path in pdf_dir.glob('*.pdf') if path.is_file())


def hydrate_page_body_sources(
    course_files: dict,
    course_id: str,
    sources: list[dict],
) -> int:
    from parser import build_html_body_pages, merge_file_pages, normalize_file_pages

    from canvas_parser.content.page_blocks import pages_missing_positioned_blocks

    hydrated = 0
    for source in sources:
        file_id = str(source.get('fileId') or '').strip()
        body_html = str(source.get('bodyHtml') or '').strip()
        title = str(source.get('title') or file_id)
        if not file_id or not body_html:
            continue
        file_node = course_files.get(file_id)
        if isinstance(file_node, dict):
            pages = file_node.get('pages') if isinstance(file_node.get('pages'), list) else []
            if pages and not pages_missing_positioned_blocks(pages):
                continue
        else:
            file_node = {'fileid': file_id, 'courseid': course_id, 'name': title}
        incoming = normalize_file_pages(
            build_html_body_pages(file_id, title, body_html),
            file_id,
        )
        if not incoming:
            continue
        existing_pages = file_node.get('pages') if isinstance(file_node.get('pages'), list) else []
        file_node['pages'] = merge_file_pages(existing_pages, incoming)
        file_node['fileid'] = file_id
        file_node['courseid'] = course_id
        file_node['name'] = title
        course_files[file_id] = file_node
        hydrated += 1
    return hydrated


def hydrate_searchtext_file_nodes(course_files: dict, course_id: str) -> int:
    from parser import build_document_pages_from_text, merge_file_pages, normalize_file_pages

    from canvas_parser.content.page_blocks import pages_missing_positioned_blocks

    hydrated = 0
    for file_id, file_node in list(course_files.items()):
        if not isinstance(file_node, dict):
            continue
        pages = file_node.get('pages') if isinstance(file_node.get('pages'), list) else []
        if pages and not pages_missing_positioned_blocks(pages):
            continue
        searchtext = str(file_node.get('searchtext') or '').strip()
        if len(searchtext) < MIN_SEARCHTEXT_CHARS:
            continue
        incoming = normalize_file_pages(
            build_document_pages_from_text(str(file_id), searchtext),
            str(file_id),
        )
        if not incoming:
            continue
        file_node['pages'] = merge_file_pages(pages, incoming)
        course_files[str(file_id)] = file_node
        hydrated += 1
    return hydrated


def hydrate_outside_source_pdfs(course_files: dict, course_id: str, *, max_files: int = 8) -> int:
    from canvas_parser.content.page_blocks import pages_missing_positioned_blocks
    from canvas_parser.index_on_read import extract_blocks_from_path
    from parser import merge_file_pages, normalize_file_pages

    hydrated = 0
    for index, pdf_path in enumerate(_outside_source_pdf_paths(course_id)):
        if hydrated >= max_files:
            break
        file_id = f'outside-{course_id}-{pdf_path.stem}'
        file_node = course_files.get(file_id)
        if isinstance(file_node, dict):
            pages = file_node.get('pages') if isinstance(file_node.get('pages'), list) else []
            if pages and not pages_missing_positioned_blocks(pages):
                continue
        else:
            file_node = {
                'fileid': file_id,
                'courseid': course_id,
                'name': pdf_path.name,
            }
        try:
            pages = extract_blocks_from_path(pdf_path, file_id, filename=pdf_path.name)
        except Exception:
            continue
        pages = normalize_file_pages(pages or [], file_id)
        if not pages or pages_missing_positioned_blocks(pages):
            continue
        existing_pages = file_node.get('pages') if isinstance(file_node.get('pages'), list) else []
        file_node['pages'] = merge_file_pages(existing_pages, pages)
        file_node['fileid'] = file_id
        file_node['courseid'] = course_id
        file_node['name'] = pdf_path.name
        course_files[file_id] = file_node
        hydrated += 1
    return hydrated


def module_file_title_map(course_id: str, canvas_data: dict | None = None) -> dict[str, str]:
    """Map Canvas file content IDs to module item titles."""
    mapping: dict[str, str] = {}
    for row in collect_canvas_module_file_rows(course_id, canvas_data):
        content_id = str(row.get('contentId') or '').strip()
        title = str(row.get('title') or '').strip()
        if content_id and title:
            mapping[content_id] = title
    return mapping


def hydrate_homepage_node(course_files: dict, course_id: str, canvas_data: dict | None = None) -> bool:
    from parser import build_html_body_pages, merge_file_pages, normalize_file_pages

    course_id = str(course_id or '').strip()
    homepage_id = f'homepage-{course_id}'
    file_node = course_files.get(homepage_id)
    if not isinstance(file_node, dict):
        file_node = {
            'fileid': homepage_id,
            'courseid': course_id,
            'name': f'{_course_label(course_id, canvas_data or load_canvas_data(), {})} homepage',
        }

    pages = file_node.get('pages') if isinstance(file_node.get('pages'), list) else []
    from canvas_parser.content.page_blocks import pages_missing_positioned_blocks
    if pages and not pages_missing_positioned_blocks(pages):
        return False

    title, body_html = read_homepage_html(course_id, canvas_data)
    if not body_html or len(body_html) < 40:
        return False

    incoming = normalize_file_pages(
        build_html_body_pages(homepage_id, title, body_html),
        homepage_id,
    )
    if not incoming:
        return False
    file_node['pages'] = merge_file_pages(pages, incoming)
    file_node['fileid'] = homepage_id
    file_node['courseid'] = course_id
    course_files[homepage_id] = file_node
    return True


def enrich_course_files_holistic(
    graph: dict,
    course_id: str,
    *,
    hydrate_local_files_fn,
) -> tuple[dict, dict]:
    """Patch in-memory course files with homepage HTML and linked local files."""
    course_id = str(course_id or '').strip()
    canvas_data = load_canvas_data()
    stats = {
        'homepageHydrated': False,
        'pageBodiesHydrated': 0,
        'searchtextHydrated': 0,
        'outsidePdfsHydrated': 0,
        'linkedFileCandidates': 0,
        'hydratedFiles': 0,
        'holisticLinkRows': 0,
        'outsideSourceRows': 0,
    }

    files = graph.setdefault('files', {})
    course_files = files.get(course_id)
    if not isinstance(course_files, dict):
        course_files = {}
    else:
        course_files = dict(course_files)
    files[course_id] = course_files

    stats['homepageHydrated'] = hydrate_homepage_node(course_files, course_id, canvas_data)

    page_sources = collect_page_body_sources(course_id, graph, canvas_data)
    stats['pageBodiesHydrated'] = hydrate_page_body_sources(course_files, course_id, page_sources)
    stats['searchtextHydrated'] = hydrate_searchtext_file_nodes(course_files, course_id)
    stats['outsidePdfsHydrated'] = hydrate_outside_source_pdfs(course_files, course_id)

    linked_ids = collect_linked_canvas_file_ids(course_id, graph, canvas_data)
    stats['linkedFileCandidates'] = len(linked_ids)

    if linked_ids and hydrate_local_files_fn:
        patched_graph = {**graph, 'files': {**files, course_id: course_files}}
        patched_graph, local_stats = hydrate_local_files_fn(
            patched_graph,
            course_id,
            file_id_filter=set(linked_ids),
        )
        course_files = (patched_graph.get('files') or {}).get(course_id) or course_files
        files[course_id] = course_files
        stats['hydratedFiles'] = local_stats.get('hydratedFiles', 0)
        stats['localHydrationAborted'] = local_stats.get('abortedEarly', False)

    stats['holisticLinkRows'] = len(collect_module_resource_rows(course_id, canvas_data, graph))
    stats['outsideSourceRows'] = len(_outside_source_markdown(course_id))
    return graph, stats


def build_holistic_link_lessons(
    course_id: str,
    canvas_data: dict | None = None,
    graph: dict | None = None,
    *,
    snippet_limit: int = 240,
    context_limit: int = 1200,
) -> list[dict]:
    course_id = str(course_id or '').strip()
    canvas_data = canvas_data if canvas_data is not None else load_canvas_data()
    graph = graph if isinstance(graph, dict) else {}
    lessons: list[dict] = []
    seen: set[str] = set()

    def append(
        kind: str,
        name: str,
        snippet: str,
        module_name: str = '',
        url: str = '',
        file_id: str = '',
    ) -> None:
        name = str(name or '').strip()
        if not name:
            return
        key = name.casefold()
        if key in seen:
            return
        if CANVAS_HELP_BLOCK.search(name) or CANVAS_HELP_BLOCK.search(snippet):
            return
        seen.add(key)
        context = snippet[:context_limit] if snippet else name
        lessons.append({
            'id': f'{course_id}:holistic:{kind}:{name}',
            'courseId': course_id,
            'type': 'section',
            'name': name,
            'snippet': snippet[:snippet_limit] if snippet else name[:snippet_limit],
            'teachingContext': context,
            'fileId': file_id,
            'filename': url or 'canvas_link',
            'pageNumber': None,
            'pageid': '',
            'sequenceIndex': len(lessons),
            'y0': None,
            'yRatio0': None,
            'moduleName': module_name or 'Linked resources',
            'source': f'canvas_{kind}',
        })

    for row in collect_module_resource_rows(course_id, canvas_data, graph):
        kind = row.get('kind') or 'link'
        title = str(row.get('title') or '')
        url = str(row.get('url') or '')
        module_name = str(row.get('moduleName') or '')
        if kind == 'subheader':
            append('subheader', title, f'Module section: {title}', module_name)
            continue
        snippet = f'Canvas module “{module_name}”. '
        if url:
            snippet += f'Review “{title}” ({url}).'
        else:
            snippet += f'Review “{title}”.'
        append(kind, title, snippet, module_name, url, str(row.get('contentId') or ''))

    for row in collect_assignment_pdf_labels(course_id, canvas_data):
        title = str(row.get('title') or '')
        assignment_name = str(row.get('assignmentName') or '')
        snippet = (
            f'Linked from assignment “{assignment_name}”. '
            f'Open “{title}” and connect it to the assignment topic.'
        )
        append('pdf_link', title, snippet, row.get('moduleName') or assignment_name)

    for row in _outside_source_markdown(course_id):
        title = str(row.get('title') or '')
        text = str(row.get('text') or '')
        append('outside_source', title, text, 'Outside sources', str(row.get('path') or ''))

    return lessons


def build_page_teaching_lessons(
    course_id: str,
    course_files: dict,
    *,
    snippet_limit: int = 240,
    context_limit: int = 1200,
    max_units: int = 120,
) -> list[dict]:
    """Teaching units extracted from hydrated HTML/text page nodes."""
    from canvas_parser.content.teaching_blocks import extract_teaching_units_from_pages

    course_id = str(course_id or '').strip()
    lessons: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for file_id, file_node in (course_files or {}).items():
        if not isinstance(file_node, dict):
            continue
        fid = str(file_id)
        if not (
            fid.startswith('page-')
            or fid.startswith('outside-')
            or fid.startswith('external-site-')
            or fid.startswith('homepage-')
        ):
            continue
        pages = file_node.get('pages') if isinstance(file_node.get('pages'), list) else []
        units = extract_teaching_units_from_pages(pages, max_units=max_units)
        filename = str(file_node.get('name') or fid)
        for unit in units:
            name = str(unit.get('name') or '').strip()
            if not name:
                continue
            key = (fid, name.casefold())
            if key in seen:
                continue
            seen.add(key)
            context_text = str(unit.get('contextText') or unit.get('snippet') or name)
            lessons.append({
                'id': f'{course_id}:{fid}:{unit.get("type", "unit")}:{name}',
                'courseId': course_id,
                'type': str(unit.get('type') or 'section'),
                'name': name,
                'snippet': context_text[:snippet_limit],
                'teachingContext': context_text[:context_limit],
                'contextText': context_text,
                'fileId': fid,
                'filename': filename,
                'pageNumber': unit.get('pageNumber'),
                'pageid': str(unit.get('pageid') or ''),
                'sequenceIndex': len(lessons),
                'y0': unit.get('y0'),
                'yRatio0': unit.get('yRatio0'),
                'moduleName': filename,
                'source': 'canvas_page_units',
            })
    return lessons
