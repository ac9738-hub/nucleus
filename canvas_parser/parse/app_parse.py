"""App production parse: Lambda course orchestration from canvas_data.json."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.weekly_iteration.auth import apply_env_file, load_auth_from_env  # noqa: E402
from canvas_parser.weekly_iteration.llm_parse import PARSER_DONE_MARKER  # noqa: E402


def archive_live_graph(root: Path) -> Path | None:
    """Back up the active graph while leaving the live graph readable until replacement."""
    graph = root / 'canvas_graph.json'
    if not graph.is_file():
        return None
    archive_root = root / '.cache' / 'graph_archive'
    archive_root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    dest = archive_root / f'canvas_graph_{stamp}.json'
    shutil.copy2(str(graph), str(dest))
    tasks = root / 'canvas_graph_tasks.json'
    if tasks.is_file():
        shutil.copy2(str(tasks), archive_root / f'canvas_graph_tasks_{stamp}.json')
    print(f'parser backed up live graph -> {dest}', flush=True)
    return dest


def write_graph_atomic(root: Path, graph: dict[str, Any]) -> Path:
    target = root / 'canvas_graph.json'
    tmp = root / f'.canvas_graph.json.{os.getpid()}.tmp'
    tmp.write_text(json.dumps(graph, ensure_ascii=False), encoding='utf-8')
    tmp.replace(target)
    return target


async def run_app_parse(
    root: Path,
    *,
    placement: str,
    timeout_seconds: int = 7200,
    skip_archive: bool = False,
) -> dict[str, Any]:
    from canvas_parser.parse.balance_guard import preflight_deepseek_api
    from canvas_parser.parse.course_orchestrator import run_course_orchestrated_lambda
    from canvas_parser.parse.lambda_deploy import load_lambda_state
    from canvas_parser.parse.parse_trial import (
        apply_production_placement,
        normalize_placement,
        placement_needs_lambda,
    )
    from scripts.postprocess_parse_graph import postprocess_graph
    from scripts.run_full_reparse_canvas_data import load_batches

    normalized = normalize_placement(placement)
    if not placement_needs_lambda(normalized):
        raise ValueError(f'app_parse requires a Lambda placement, not {normalized!r}')

    if not skip_archive:
        archive_live_graph(root)

    apply_production_placement(normalized)
    auth = load_auth_from_env(root)
    batches, selected_ids = load_batches(root, princeton_only=False)
    if not batches:
        raise RuntimeError('No parser batches from canvas_data.json')

    worker = load_lambda_state(root)
    if not worker:
        raise RuntimeError('Lambda not deployed. Run: python scripts/setup_aws_lambda_parse.py deploy')

    preflight_deepseek_api(root)
    print(
        f'parser app parse: placement={normalized} courses={len(selected_ids)}',
        flush=True,
    )

    graph, meta = await run_course_orchestrated_lambda(
        batches,
        placement=normalized,
        worker=worker,
        auth=auth,
        production=True,
        timeout_seconds=timeout_seconds,
    )
    graph = postprocess_graph(graph, skip_volume_caps=False)
    write_graph_atomic(root, graph)

    if os.environ.get('PARSER_DEFER_FILE_EMBED') == '1':
        print('parser embedding deferred — run: python scripts/reembed_graph.py', flush=True)

    return {
        'placement': normalized,
        'courses': selected_ids,
        'meta': meta,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--from-canvas-data', action='store_true', help='Build batches from canvas_data.json')
    parser.add_argument(
        '--placement',
        default=os.environ.get('PARSER_PLACEMENT', 'local_download_lambda_parse'),
    )
    parser.add_argument('--timeout', type=int, default=int(os.environ.get('PARSER_TIMEOUT_SEC', '7200')))
    parser.add_argument('--skip-archive', action='store_true')
    args = parser.parse_args()

    if not args.from_canvas_data:
        print('app_parse requires --from-canvas-data', file=sys.stderr)
        return 2

    apply_env_file(ROOT / '.env')
    try:
        asyncio.run(
            run_app_parse(
                ROOT,
                placement=args.placement,
                timeout_seconds=args.timeout,
                skip_archive=args.skip_archive,
            )
        )
        print(PARSER_DONE_MARKER, flush=True)
        return 0
    except Exception as error:
        print(f'parser app parse failed: {error}', flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
