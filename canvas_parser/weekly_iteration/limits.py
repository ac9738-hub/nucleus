"""Shared resource caps for weekly iteration and Canvas fetch."""

from __future__ import annotations

import os

# Canvas API pagination (per bucket / list endpoint).
MAX_PAGINATION_PAGES = int(os.getenv('CANVAS_MAX_PAGINATION_PAGES', '80'))
MAX_PAGINATION_ITEMS = int(os.getenv('CANVAS_MAX_PAGINATION_ITEMS', '8000'))
PER_PAGE = int(os.getenv('CANVAS_PER_PAGE', '100'))

# Page-body enrichment (one API call per module page).
MAX_PAGE_BODY_FETCHES = int(os.getenv('CANVAS_MAX_PAGE_BODY_FETCHES', '400'))

# Parser stdin batches (items per batch line sent to parser.py).
MAX_PARSER_BATCH_ITEMS = int(os.getenv('PARSER_MAX_BATCH_ITEMS', '50'))
