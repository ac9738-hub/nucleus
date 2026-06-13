"""Post-parse checks for the event-dating pipeline."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from canvas_parser.graph.events import (
    build_syllabus_exam_text,
    canonical_test_event_name,
    event_needs_date,
    extract_syllabus_exam_hints,
    find_best_event_for_target,
    is_plausible_exam_date_text,
    is_schedulable_date,
    normalize_event_type,
)

EXAM_DATE_IN_TEXT = re.compile(
    r'(?:'
    r'\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|'
    r'jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
    r'\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?'
    r'|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?'
    r')',
    re.IGNORECASE,
)
SIGN_IN_WALL_MARKERS = (
    'sign in',
    'browser version is no longer supported',
    'requires google sign-in',
    'could not be extracted',
)
EXTERNAL_SYLLABUS_PREFIX = 'external-site-'


@dataclass
class Finding:
    severity: str
    category: str
    courseid: str
    message: str
    details: dict = field(default_factory=dict)


@dataclass
class EventPipelineReport:
    findings: list[Finding] = field(default_factory=list)
    stats: dict = field(default_factory=dict)

    @property
    def errors(self):
        return [item for item in self.findings if item.severity == 'error']

    @property
    def warnings(self):
        return [item for item in self.findings if item.severity == 'warning']

    def ok(self) -> bool:
        return not self.errors


class EventPipelineChecker:
    def __init__(
        self,
        graph: dict,
        *,
        canvas_data: Optional[dict] = None,
        normalize_date_fn: Optional[Callable[[str], str]] = None,
        infer_year_fn: Optional[Callable[[str, Any, dict], Optional[int]]] = None,
    ):
        self.graph = graph or {}
        self.canvas_data = canvas_data or {}
        self.normalize_date_fn = normalize_date_fn or (lambda value: value)
        self.infer_year_fn = infer_year_fn
        self.events = list(self.graph.get('events') or [])
        self.syllabi = dict(self.graph.get('syllabi') or {})
        self.files = dict(self.graph.get('files') or {})

    def run(self) -> EventPipelineReport:
        report = EventPipelineReport()
        self._check_summary_stats(report)
        self._check_non_iso_dates(report)
        self._check_undated_test_events(report)
        self._check_assignment_coverage(report)
        self._check_syllabus_hints(report)
        self._check_ingestion_gaps(report)
        self._check_file_text_vs_undated_events(report)
        return report

    def _add(self, report, severity, category, courseid, message, **details):
        report.findings.append(Finding(severity, category, str(courseid or ''), message, details))

    def _events_for_course(self, courseid):
        cid = str(courseid)
        return [event for event in self.events if str(event.get('courseid', '')) == cid]

    def _normalize_with_course(self, courseid, value, syllabus_dict):
        default_year = None
        if self.infer_year_fn:
            default_year = self.infer_year_fn(str(courseid), syllabus_dict, self.files.get(str(courseid), {}))
        if default_year is not None:
            return self.normalize_date_fn(value, default_year=default_year)
        return self.normalize_date_fn(value)

    def _check_summary_stats(self, report):
        test_events = [event for event in self.events if event.get('type') == 'test']
        dated_tests = [
            event for event in test_events
            if is_schedulable_date(event.get('startdate')) or is_schedulable_date(event.get('enddate'))
        ]
        report.stats = {
            'total_events': len(self.events),
            'test_events': len(test_events),
            'dated_test_events': len(dated_tests),
            'undated_test_events': len(test_events) - len(dated_tests),
            'test_date_rate': (
                round(len(dated_tests) / len(test_events), 3) if test_events else 1.0
            ),
            'courses_with_syllabus': len(self.syllabi),
        }

    def _check_non_iso_dates(self, report):
        for event in self.events:
            for field_name in ('startdate', 'enddate'):
                value = event.get(field_name) or ''
                if value and not is_schedulable_date(value):
                    self._add(
                        report,
                        'error',
                        'non_iso_date',
                        event.get('courseid', ''),
                        f"Event {event.get('name')!r} has non-ISO {field_name}={value!r}",
                        eventid=event.get('eventid'),
                        field=field_name,
                    )

    def _check_undated_test_events(self, report):
        for event in self.events:
            if event.get('type') != 'test':
                continue
            if not event_needs_date(event):
                continue
            source = classify_undated_source(event)
            self._add(
                report,
                'warning',
                'undated_test_event',
                event.get('courseid', ''),
                f"Undated test event {event.get('name')!r} ({source})",
                eventid=event.get('eventid'),
                source=source,
                description=(event.get('description') or '')[:200],
            )

    def _check_assignment_coverage(self, report):
        ok_count = 0
        for courseid, syllabus in self.syllabi.items():
            course_events = self._events_for_course(courseid)
            for raw in syllabus.get('assignments') or []:
                name = str(raw.get('name') or '').strip()
                if not name or normalize_event_type('', name) != 'test':
                    continue
                canonical = canonical_test_event_name(name)
                if not canonical:
                    continue
                due = raw.get('duedate') or raw.get('unlockdate') or ''
                if not is_schedulable_date(due):
                    continue
                matched = find_best_event_for_target(course_events, canonical)
                if matched and not event_needs_date(matched):
                    ok_count += 1
                    continue
                self._add(
                    report,
                    'error',
                    'assignment_date_gap',
                    courseid,
                    f"Dated assignment {name!r} missing dated {canonical!r} event",
                    assignment=name,
                    canonical=canonical,
                    duedate=due,
                    event_exists=bool(matched),
                    event_start=(matched or {}).get('startdate', ''),
                )
        report.stats['assignment_dated_ok'] = ok_count

    def _check_syllabus_hints(self, report):
        false_positives = 0
        gaps = 0
        ok = 0
        for courseid, syllabus in self.syllabi.items():
            exam_text = build_syllabus_exam_text(
                syllabus.get('classtimes', ''),
                syllabus.get('other', ''),
                syllabus.get('assignments') or [],
            )
            course_events = self._events_for_course(courseid)
            for hint in extract_syllabus_exam_hints(exam_text):
                date_text = hint.get('date_text', '')
                if not is_plausible_exam_date_text(date_text):
                    false_positives += 1
                    self._add(
                        report,
                        'warning',
                        'syllabus_hint_false_positive',
                        courseid,
                        f"Syllabus regex hint {hint.get('name')!r} with implausible date {date_text!r}",
                        hint_name=hint.get('name'),
                        date_text=date_text,
                    )
                    continue
                normalized = self._normalize_with_course(courseid, date_text, syllabus)
                if not is_schedulable_date(normalized):
                    false_positives += 1
                    self._add(
                        report,
                        'warning',
                        'syllabus_hint_unparseable',
                        courseid,
                        f"Parseable-looking hint {hint.get('name')!r} did not normalize: {date_text!r}",
                        hint_name=hint.get('name'),
                        date_text=date_text,
                    )
                    continue
                matched = find_best_event_for_target(course_events, hint.get('name'))
                if matched and not event_needs_date(matched):
                    ok += 1
                    continue
                gaps += 1
                self._add(
                    report,
                    'error',
                    'syllabus_hint_gap',
                    courseid,
                    f"Syllabus hint {hint.get('name')!r} ({date_text!r}) not reflected on dated event",
                    hint_name=hint.get('name'),
                    date_text=date_text,
                    normalized=normalized,
                    event_exists=bool(matched),
                )
        report.stats['syllabus_hints_ok'] = ok
        report.stats['syllabus_hint_gaps'] = gaps
        report.stats['syllabus_hint_false_positives'] = false_positives

    def _check_ingestion_gaps(self, report):
        canvas_syllabi = (self.canvas_data.get('syllabi') or {}) if self.canvas_data else {}
        for courseid in sorted(set(self.syllabi) | set(canvas_syllabi)):
            syllabus = self.syllabi.get(str(courseid), {})
            canvas_syllabus = canvas_syllabi.get(str(courseid), {})
            canvas_text = str(canvas_syllabus.get('syllabus_text') or '').strip()
            if not canvas_text:
                has_undated = any(
                    event.get('type') == 'test' and event_needs_date(event)
                    for event in self._events_for_course(courseid)
                )
                if has_undated:
                    self._add(
                        report,
                        'warning',
                        'ingestion_canvas_syllabus_empty',
                        courseid,
                        'Canvas syllabus_body empty but course has undated test events',
                    )

            other = str(syllabus.get('other') or '')
            if other and any(marker in other.casefold() for marker in SIGN_IN_WALL_MARKERS):
                self._add(
                    report,
                    'warning',
                    'ingestion_syllabus_auth_wall',
                    courseid,
                    'Syllabus text indicates sign-in / extraction failure',
                    snippet=other[:160],
                )

            for fileid in syllabus.get('filechildren') or []:
                file_node = (self.files.get(str(courseid)) or {}).get(str(fileid), {})
                if not file_node:
                    continue
                if str(fileid).startswith(EXTERNAL_SYLLABUS_PREFIX) and not (file_node.get('pages') or []):
                    self._add(
                        report,
                        'warning',
                        'ingestion_external_syllabus_empty',
                        courseid,
                        f"Syllabus external source {fileid} has no extracted pages",
                        fileid=fileid,
                        name=file_node.get('name', ''),
                    )

    def _check_file_text_vs_undated_events(self, report):
        for courseid, course_files in self.files.items():
            undated_tests = [
                event for event in self._events_for_course(courseid)
                if event.get('type') == 'test' and event_needs_date(event)
            ]
            if not undated_tests:
                continue
            corpus = collect_course_file_text(course_files)
            if not corpus:
                continue
            if not EXAM_DATE_IN_TEXT.search(corpus):
                continue
            for event in undated_tests:
                name = str(event.get('name') or '')
                if not name:
                    continue
                if name.casefold() not in corpus.casefold():
                    continue
                self._add(
                    report,
                    'warning',
                    'ingestion_text_date_missed',
                    courseid,
                    f"Undated {name!r} but course files contain exam-like dates near that event name",
                    eventid=event.get('eventid'),
                )


def classify_undated_source(event: dict) -> str:
    description = str(event.get('description') or '')
    if description.startswith('Inferred from assignment'):
        return 'assignment_no_due'
    if description.startswith('Extracted from syllabus'):
        return 'syllabus_hint_unparseable'
    if description.startswith('Inferred from study material'):
        return 'study_material_heuristic'
    return 'llm_or_unknown'


def collect_course_file_text(course_files: dict) -> str:
    chunks = []
    for file_node in (course_files or {}).values():
        if not isinstance(file_node, dict):
            continue
        chunks.append(str(file_node.get('searchtext') or ''))
        for page in file_node.get('pages') or []:
            if isinstance(page, dict):
                chunks.append(str(page.get('text') or ''))
    return '\n'.join(chunk for chunk in chunks if chunk)


def format_report(report: EventPipelineReport, *, max_findings_per_category: int = 20) -> str:
    lines = [
        '=== Event pipeline check ===',
        (
            f"test_events={report.stats.get('test_events', 0)} "
            f"dated={report.stats.get('dated_test_events', 0)} "
            f"undated={report.stats.get('undated_test_events', 0)} "
            f"rate={report.stats.get('test_date_rate', 0)}"
        ),
        f"errors={len(report.errors)} warnings={len(report.warnings)}",
        '',
    ]
    by_category: dict[str, list[Finding]] = {}
    for finding in report.findings:
        by_category.setdefault(finding.category, []).append(finding)

    for category in sorted(by_category):
        items = by_category[category]
        lines.append(f'--- {category} ({len(items)}) ---')
        for finding in items[:max_findings_per_category]:
            lines.append(
                f"  [{finding.severity}] course={finding.courseid} {finding.message}"
            )
        if len(items) > max_findings_per_category:
            lines.append(f"  ... and {len(items) - max_findings_per_category} more")
        lines.append('')

    if report.ok():
        lines.append('RESULT: PASS (no errors)')
    else:
        lines.append(f'RESULT: FAIL ({len(report.errors)} errors)')
    return '\n'.join(lines).rstrip() + '\n'


def load_graph(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def load_canvas_data(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding='utf-8'))


def check_event_pipeline(
    graph_path: Path,
    *,
    canvas_data_path: Optional[Path] = None,
    normalize_date_fn=None,
    infer_year_fn=None,
) -> EventPipelineReport:
    graph = load_graph(graph_path)
    canvas_data = load_canvas_data(canvas_data_path) if canvas_data_path else {}
    checker = EventPipelineChecker(
        graph,
        canvas_data=canvas_data,
        normalize_date_fn=normalize_date_fn,
        infer_year_fn=infer_year_fn,
    )
    return checker.run()


def main(argv=None) -> int:
    import argparse
    import sys

    root = Path(__file__).resolve().parents[2]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

    parser = argparse.ArgumentParser(description='Check event-dating pipeline output.')
    parser.add_argument('--graph', type=Path, default=root / 'canvas_graph.json')
    parser.add_argument('--canvas-data', type=Path, default=root / 'canvas_data.json')
    parser.add_argument('--fail-on', choices=('error', 'warning', 'never'), default='error')
    args = parser.parse_args(argv)

    normalize_date_fn = None
    infer_year_fn = None
    try:
        from parser import infer_course_academic_year, normalize_date

        def normalize_with_year(value, default_year=None):
            return normalize_date(value, default_year=default_year)

        def infer_year(courseid, syllabus_dict, file_nodes):
            class SyllabusObj:
                pass
            obj = SyllabusObj()
            obj.classtimes = syllabus_dict.get('classtimes', '')
            obj.other = syllabus_dict.get('other', '')
            obj.assignments = syllabus_dict.get('assignments') or []
            return infer_course_academic_year(courseid, obj, file_nodes)

        normalize_date_fn = normalize_with_year
        infer_year_fn = infer_year
    except ImportError:
        pass

    report = check_event_pipeline(
        args.graph,
        canvas_data_path=args.canvas_data,
        normalize_date_fn=normalize_date_fn,
        infer_year_fn=infer_year_fn,
    )
    print(format_report(report), end='')
    if args.fail_on == 'never':
        return 0
    if args.fail_on == 'warning':
        return 1 if report.findings else 0
    return 0 if report.ok() else 1


if __name__ == '__main__':
    raise SystemExit(main())
