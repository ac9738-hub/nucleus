#!/usr/bin/env python3
"""Evaluate heuristic file-type classification and section extraction."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.content.teaching_blocks import (  # noqa: E402
    extract_teaching_units_from_pages,
    teaching_labels_match,
)
from canvas_parser.parse.file_types import (  # noqa: E402
    build_classification_snippet,
    heuristic_classify,
    normalize_file_type_id,
)
from parser import build_pdf_pages, folder, normalize_file_pages  # noqa: E402

FIXTURE_ROOT = ROOT / 'fixtures' / 'heuristic_parse'
DEFAULT_REPORT = ROOT / '.cache' / 'heuristic_parse' / 'report.json'


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def local_pdf_path(file_id: str) -> Path | None:
    fid = str(file_id)
    direct = folder / fid
    if direct.is_file():
        return direct
    for suffix in ('.pdf', '.PDF'):
        candidate = folder / f'{fid}{suffix}'
        if candidate.is_file():
            return candidate
    return None


def load_pages(entry: dict) -> list[dict]:
    file_id = str(entry.get('fileId') or '')
    pdf_path = local_pdf_path(file_id)
    if not pdf_path:
        return []
    try:
        return normalize_file_pages(build_pdf_pages(str(pdf_path), file_id), file_id)
    except Exception:
        return []


def section_recall(expected: list[str], predicted: list[str]) -> tuple[int, int]:
    if not expected:
        return 0, 0
    hit = 0
    for label in expected:
        if any(teaching_labels_match(label, pred) for pred in predicted):
            hit += 1
    return hit, len(expected)


def eval_manifest(manifest: dict, thresholds: dict) -> dict:
    files = manifest.get('files') or []
    type_total = 0
    type_hit = 0
    heur_only = 0
    heur_eligible = 0
    section_num = 0
    section_den = 0
    misses: list[dict] = []

    for entry in files:
        expected = normalize_file_type_id(str(entry.get('expectedFileType') or ''))
        if not expected:
            continue
        filename = str(entry.get('filename') or '')
        pages = load_pages(entry)
        snippet = build_classification_snippet(pages=pages) if pages else ''
        pred, conf = heuristic_classify(filename=filename, snippet=snippet)
        pred = normalize_file_type_id(pred)
        type_total += 1
        if pred == expected:
            type_hit += 1
        else:
            misses.append({
                'fileId': entry.get('fileId'),
                'filename': filename,
                'expected': expected,
                'heuristic': pred,
                'confidence': conf,
            })
        heur_eligible += 1
        if conf >= float(thresholds.get('heuristicThreshold', 0.82)):
            heur_only += 1

        expected_sections = entry.get('expectedSections') or []
        if expected_sections and pages:
            predicted = [
                str(unit.get('name') or unit.get('label') or '').strip()
                for unit in extract_teaching_units_from_pages(pages)
                if unit.get('name') or unit.get('label')
            ]
            hit, total = section_recall(expected_sections, predicted)
            section_num += hit
            section_den += total

    type_acc = type_hit / type_total if type_total else 1.0
    heur_cov = heur_only / heur_eligible if heur_eligible else 1.0
    sec_recall = section_num / section_den if section_den else 1.0
    llm_rate = 1.0 - heur_cov

    passed = (
        type_acc >= thresholds['fileTypeAccuracy']
        and heur_cov >= thresholds['fileTypeHeuristicCoverage']
        and (section_den == 0 or sec_recall >= thresholds['sectionRecall'])
        and llm_rate <= thresholds['llmClassifyRateMax']
    )

    return {
        'split': manifest.get('split'),
        'fileCount': len(files),
        'labeledFileCount': type_total,
        'fileTypeAccuracy': round(type_acc, 4),
        'heuristicCoverage': round(heur_cov, 4),
        'llmClassifyRate': round(llm_rate, 4),
        'sectionRecall': round(sec_recall, 4) if section_den else None,
        'sectionLabeledFiles': section_den,
        'passed': passed,
        'missesSample': misses[:12],
    }


def eval_textbook(thresholds: dict) -> dict | None:
    manifest_path = FIXTURE_ROOT / 'textbook' / 'manifest.json'
    if not manifest_path.is_file():
        return None
    manifest = load_json(manifest_path)
    chapters = []
    for chapter in manifest.get('chapters') or []:
        path = ROOT / str(chapter.get('path') or '')
        if not path.is_file():
            continue
        text = path.read_text(encoding='utf-8').strip()
        if 'PASTE_CHAPTER_TEXT_HERE' in text or len(text) < 200:
            chapters.append({**chapter, 'status': 'awaiting_paste', 'sectionRecall': None})
            continue
        pages = [{'pageNumber': 1, 'text': text, 'blocks': []}]
        predicted = [
            str(unit.get('label') or '').strip()
            for unit in extract_teaching_units_from_pages(pages)
            if unit.get('label')
        ]
        expected = chapter.get('expectedSections') or []
        hit, total = section_recall(expected, predicted) if expected else (0, 0)
        chapters.append({
            'chapterId': chapter.get('chapterId'),
            'status': 'ready' if expected else 'needs_section_labels',
            'sectionRecall': round(hit / total, 4) if total else None,
            'predictedSectionsSample': predicted[:15],
        })
    return {'chapters': chapters}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--holdout', action='store_true', help='Eval holdout only')
    parser.add_argument('--textbook', action='store_true', help='Include textbook chapter eval')
    parser.add_argument('-o', '--output', type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()

    profile = load_json(FIXTURE_ROOT / 'profile.json')
    thresholds = profile.get('thresholds') or {}
    thresholds['heuristicThreshold'] = 0.82

    splits = []
    if args.holdout:
        splits.append('holdout')
    else:
        splits.extend(['insample', 'holdout'])

    results = {}
    for split in splits:
        path = FIXTURE_ROOT / split / 'manifest.json'
        if not path.is_file():
            print(f'Missing {path} — run scripts/build_heuristic_parse_fixtures.py', file=sys.stderr)
            return 1
        results[split] = eval_manifest(load_json(path), thresholds)

    report = {
        'thresholds': thresholds,
        'splits': results,
        'passed': all(row['passed'] for row in results.values()),
    }
    if args.textbook or not args.holdout:
        textbook = eval_textbook(thresholds)
        if textbook:
            report['textbook'] = textbook

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')

    for split, row in results.items():
        print(
            f'{split}: type_acc={row["fileTypeAccuracy"]:.1%} '
            f'heur_cov={row["heuristicCoverage"]:.1%} '
            f'section_recall={row["sectionRecall"]} PASS={row["passed"]}'
        )
    print(f'Overall PASS={report["passed"]}')
    print(f'Report: {args.output}')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
