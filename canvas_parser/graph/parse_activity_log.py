"""Human-readable markdown log of parser activity per course."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import os
import threading


_lock = threading.Lock()
_log_path: Path | None = None
_course_names: dict[str, str] = {}
_started_at: str | None = None


def _enabled() -> bool:
    return _log_path is not None


def init_parse_activity_log(root_dir: Path | None = None, log_path: str | Path | None = None) -> Path | None:
    global _log_path, _started_at, _course_names

    raw = log_path or os.getenv('PARSER_ACTIVITY_LOG', '').strip()
    if not raw:
        return None

    root = Path(root_dir or Path(__file__).resolve().parents[2])
    path = Path(raw)
    if not path.is_absolute():
        path = root / path
    path.parent.mkdir(parents=True, exist_ok=True)

    _log_path = path
    _started_at = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    _course_names = {}

    header = (
        f"# Parser activity log\n\n"
        f"Started: {_started_at}\n\n"
        f"---\n\n"
    )
    path.write_text(header, encoding='utf-8')
    return path


def set_course_display_name(courseid: str, name: str) -> None:
    if not name:
        return
    _course_names[str(courseid or '').strip()] = str(name).strip()


def _course_heading(courseid: str) -> str:
    cid = str(courseid or '').strip()
    label = _course_names.get(cid) or cid
    if label != cid:
        return f"## Course {cid} — {label}\n\n"
    return f"## Course {cid}\n\n"


def _append_block(courseid: str, section: str, line: str) -> None:
    if not _enabled() or not line:
        return
    with _lock:
        text = _log_path.read_text(encoding='utf-8') if _log_path.is_file() else ''
        marker = f"<!-- course:{courseid} -->"
        if marker not in text:
            text += marker + '\n' + _course_heading(courseid)
        section_marker = f"<!-- course:{courseid}:{section} -->"
        if section_marker not in text:
            text += section_marker + '\n'
            text += f"### {section}\n\n"
        text += line.rstrip() + '\n'
        _log_path.write_text(text, encoding='utf-8')


def record_batch_start(courseid: str, batch_type: str, count: int) -> None:
    if not _enabled():
        return
    _append_block(
        courseid,
        'Parse batches',
        f"- Started `{batch_type}` batch ({count} item{'s' if count != 1 else ''})",
    )


def record_file_parsed(courseid: str, batch_type: str, fileid: str, name: str = '') -> None:
    label = name or fileid or 'unknown'
    _append_block(
        courseid,
        'Files parsed',
        f"- `{batch_type}` **{label}** (id={fileid})",
    )


def record_file_classification(courseid: str, fileid: str, type_id: str, confidence: float = 0.0) -> None:
    pct = f"{confidence * 100:.0f}%" if confidence else ''
    suffix = f" ({pct})" if pct else ''
    _append_block(
        courseid,
        'File classifications',
        f"- `{fileid}` → **{type_id}**{suffix}",
    )


def record_type_extraction(
    courseid: str,
    fileid: str,
    tool_name: str,
    category: str,
    label: str,
) -> None:
    _append_block(
        courseid,
        'Type-specific extractions',
        f"- `{fileid}` **{tool_name}** [{category}]: {label}",
    )


def record_parse_cost(courseid: str, fileid: str, filename: str, cost_summary: dict) -> None:
    from canvas_parser.parse.parse_cost import format_cost_summary

    label = filename or fileid or 'unknown'
    line = f"- `{fileid}` **{label}** — {format_cost_summary(cost_summary)}"
    _append_block(courseid, 'Parse costs', line)


def record_object_created(courseid: str, kind: str, name: str, detail: str = '') -> None:
    extra = f" — {detail}" if detail else ''
    _append_block(
        courseid,
        'Objects created',
        f"- **{kind}**: {name or '(unnamed)'}{extra}",
    )


def record_link_action(courseid: str, description: str) -> None:
    _append_block(courseid, 'Linking actions', f"- {description}")


def record_tool_call(courseid: str, tool_name: str, arguments: dict | None, result=None, file_label: str = '') -> None:
    if not _enabled():
        return
    args = arguments or {}
    prefix = f"[{file_label}] " if file_label else ''

    create_tools = {
        'add_concept_node': ('concept', args.get('conceptname', '')),
        'add_detail_node': ('detail', args.get('detailname', '')),
        'add_example_node': ('example', args.get('examplename', '')),
        'add_problem_node': ('problem', args.get('problemname', '')),
        'add_assignment_node': ('assignment', args.get('assignmentname', '')),
        'add_event_node': ('event', args.get('eventname', '')),
        'add_exam_node': ('exam', args.get('examname', '')),
        'add_syllabus': ('syllabus', 'course syllabus'),
        'add_file_node': ('file node', args.get('filename', '')),
        'add_learning_block': ('learning block', args.get('conceptNodeId', '')),
    }
    if tool_name in create_tools:
        kind, name = create_tools[tool_name]
        detail = ''
        if tool_name in {'add_event_node', 'add_exam_node'} and args.get('startdate'):
            detail = f"date {args.get('startdate')}"
        elif tool_name == 'add_assignment_node' and args.get('duedate'):
            detail = f"due {args.get('duedate')}"
        record_object_created(courseid, kind, str(name or ''), detail)
        return

    if tool_name == 'link_file_to_event':
        event = args.get('eventname') or args.get('eventNodeId') or 'event'
        file_ref = args.get('fileid') or file_label or 'current file'
        record_link_action(courseid, f"{prefix}Linked file `{file_ref}` → event **{event}**")
        return

    if tool_name == 'update_assignment_node':
        record_link_action(
            courseid,
            f"{prefix}Updated assignment **{args.get('assignmentname') or args.get('assignmentNodeId', '')}**",
        )
        return

    if tool_name == 'update_event_node':
        record_link_action(
            courseid,
            f"{prefix}Updated event **{args.get('eventname') or args.get('eventNodeId', '')}**",
        )
        return

    if tool_name.startswith('log_'):
        logged = tool_name[4:]
        name = (
            args.get('detailname')
            or args.get('examplename')
            or args.get('problemname')
            or args.get('assignmentname')
            or args.get('eventname')
            or args.get('examname')
            or logged
        )
        _append_block(courseid, 'Logged for pass 2', f"- `{logged}`: {name}")


def finish_run(extra_lines: list[str] | None = None) -> None:
    if not _enabled():
        return
    finished = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    with _lock:
        text = _log_path.read_text(encoding='utf-8')
        text += f"\n---\n\nFinished: {finished}\n"
        if extra_lines:
            for line in extra_lines:
                text += line.rstrip() + '\n'
        _log_path.write_text(text, encoding='utf-8')
