#!/usr/bin/env python3
"""CLI entry point for event pipeline checks."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.check.event_pipeline import main

if __name__ == '__main__':
    raise SystemExit(main())
