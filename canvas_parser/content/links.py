import re
from html import unescape
from urllib.parse import urljoin, urlparse


PLATFORM_HINTS = (
    ('gradescope.com', 'gradescope'),
    ('instructure.com', 'canvas'),
    ('docs.google.com', 'google_docs'),
    ('drive.google.com', 'google_drive'),
    ('github.com', 'github'),
    ('youtube.com', 'youtube'),
    ('youtu.be', 'youtube'),
)


def detect_platform(url):
    host = (urlparse(url).netloc or '').casefold()
    for needle, platform in PLATFORM_HINTS:
        if needle in host:
            return platform
    return 'unknown'


def is_canvas_url(url):
    try:
        host = (urlparse(str(url or '')).netloc or '').casefold()
    except ValueError:
        return False
    return 'instructure.com' in host or host.endswith('.canvas') or host == 'canvas'


def extract_links_from_html(html, base_url=''):
    if not html:
        return []

    links = []
    seen = set()
    for match in re.finditer(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, flags=re.IGNORECASE | re.DOTALL):
        href = unescape(match.group(1).strip())
        if not href or href.startswith(('#', 'mailto:', 'tel:', 'javascript:', 'data:')):
            continue
        absolute = urljoin(base_url or '', href)
        if absolute in seen:
            continue
        seen.add(absolute)
        label = re.sub(r'<[^>]+>', ' ', match.group(2))
        label = re.sub(r'\s+', ' ', unescape(label)).strip()
        links.append({
            'url': absolute,
            'label': label,
            'platform': detect_platform(absolute),
        })
    return links


CANVAS_FILE_ID_PATTERNS = (
    re.compile(r'/files/(\d+)(?:/download)?', re.IGNORECASE),
    re.compile(r'[?&]preview=(\d+)', re.IGNORECASE),
    re.compile(r'data-api-endpoint="[^"]*/files/(\d+)', re.IGNORECASE),
)


def extract_canvas_file_id_from_url(url):
    source = str(url or '')
    if not source:
        return ''
    for pattern in CANVAS_FILE_ID_PATTERNS:
        match = pattern.search(source)
        if match:
            return str(match.group(1))
    return ''


def extract_canvas_file_ids_from_html(html):
    if not html:
        return []
    ids = set()
    patterns = (
        r'/files/(\d+)',
        r'preview=(\d+)',
        r'data-api-endpoint="[^"]*/files/(\d+)',
    )
    for pattern in patterns:
        for match in re.finditer(pattern, html, flags=re.IGNORECASE):
            ids.add(str(match.group(1)))
    return list(ids)
