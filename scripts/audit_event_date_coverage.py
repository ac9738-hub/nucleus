import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.graph.events import (
    build_syllabus_exam_text,
    canonical_test_event_name,
    extract_syllabus_exam_hints,
    event_names_match,
    find_best_event_for_target,
    is_schedulable_date,
    normalize_event_type,
)
from parser import infer_course_academic_year, normalize_date

data = json.loads((ROOT / "canvas_graph.json").read_text(encoding="utf-8"))
events = data.get("events", [])
syllabi = data.get("syllabi", {})


class FakeAssignment:
    def __init__(self, item):
        self.name = item.get("name", "")
        self.duedate = item.get("duedate", "")
        self.unlockdate = item.get("unlockdate", "")


class FakeEvent:
    def __init__(self, item):
        self.name = item.get("name", "")
        self.eventid = item.get("eventid", "")
        self.type = item.get("type", "")
        self.startdate = item.get("startdate", "")
        self.enddate = item.get("enddate", "")
        self.description = item.get("description", "")


def events_for_course(courseid):
    return [FakeEvent(item) for item in events if str(item.get("courseid", "")) == str(courseid)]


def event_is_dated(event):
    return is_schedulable_date(event.startdate) or is_schedulable_date(event.enddate)


def normalize_with_course(courseid, value, syllabus):
    year = infer_course_academic_year(courseid, syllabus, {})
    return normalize_date(value, default_year=year)


print("=== Assignment due_at -> event coverage ===")
assignment_gaps = []
assignment_ok = []
for courseid, syllabus in syllabi.items():
    course_events = events_for_course(courseid)
    for raw in syllabus.get("assignments", []) or []:
        assignment = FakeAssignment(raw)
        name = str(assignment.name or "").strip()
        if not name:
            continue
        if normalize_event_type("", name) != "test":
            continue
        canonical = canonical_test_event_name(name)
        if not canonical:
            continue
        due = assignment.duedate or assignment.unlockdate or ""
        if not is_schedulable_date(due):
            continue
        matched = find_best_event_for_target(course_events, canonical)
        if matched and event_is_dated(matched):
            assignment_ok.append((courseid, name, canonical, due, matched.startdate or matched.enddate))
        else:
            assignment_gaps.append({
                "courseid": courseid,
                "assignment": name,
                "canonical": canonical,
                "duedate": due,
                "event_exists": bool(matched),
                "event_name": getattr(matched, "name", None) if matched else None,
                "event_start": getattr(matched, "startdate", "") if matched else "",
            })

print(f"dated exam-like assignments with matching dated event: {len(assignment_ok)}")
print(f"dated exam-like assignments MISSING dated event: {len(assignment_gaps)}")
for gap in assignment_gaps:
    print(
        f"  GAP course={gap['courseid']} assignment={gap['assignment']!r} "
        f"due={gap['duedate']} event={gap['event_name']!r} event_start={gap['event_start']!r}"
    )
for ok in assignment_ok[:8]:
    print(f"  OK   course={ok[0]} assignment={ok[1]!r} -> event date={ok[4]}")

print()
print("=== Syllabus parseable date hints -> event coverage ===")
syllabus_gaps = []
syllabus_ok = []
syllabus_unparseable = []
for courseid, syllabus in syllabi.items():
    class SyllabusObj:
        pass
    s = SyllabusObj()
    s.classtimes = syllabus.get("classtimes", "")
    s.other = syllabus.get("other", "")
    s.assignments = [FakeAssignment(item) for item in (syllabus.get("assignments") or [])]
    exam_text = build_syllabus_exam_text(s.classtimes, s.other, s.assignments)
    course_events = events_for_course(courseid)
    hints = extract_syllabus_exam_hints(exam_text)
    if not hints:
        continue
    for hint in hints:
        normalized = normalize_with_course(courseid, hint["date_text"], s)
        if not is_schedulable_date(normalized):
            syllabus_unparseable.append((courseid, hint["name"], hint["date_text"]))
            continue
        matched = find_best_event_for_target(course_events, hint["name"])
        if matched and event_is_dated(matched):
            syllabus_ok.append((courseid, hint["name"], hint["date_text"], matched.startdate or matched.enddate))
        else:
            syllabus_gaps.append({
                "courseid": courseid,
                "hint_name": hint["name"],
                "hint_date_text": hint["date_text"],
                "normalized": normalized,
                "event_exists": bool(matched),
                "event_name": getattr(matched, "name", None) if matched else None,
                "event_start": getattr(matched, "startdate", "") if matched else "",
            })

print(f"parseable syllabus hints with matching dated event: {len(syllabus_ok)}")
print(f"parseable syllabus hints MISSING dated event: {len(syllabus_gaps)}")
print(f"syllabus hints with unparseable date text: {len(syllabus_unparseable)}")
for gap in syllabus_gaps:
    print(
        f"  GAP course={gap['courseid']} hint={gap['hint_name']!r} "
        f"date={gap['hint_date_text']!r} normalized={gap['normalized']} "
        f"event={gap['event_name']!r} event_start={gap['event_start']!r}"
    )
for bad in syllabus_unparseable[:10]:
    print(f"  UNPARSEABLE course={bad[0]} hint={bad[1]!r} date_text={bad[2]!r}")
for ok in syllabus_ok[:8]:
    print(f"  OK   course={ok[0]} hint={ok[1]!r} date={ok[2]!r} -> event date={ok[3]}")

print()
print("=== Summary ===")
if not assignment_gaps and not syllabus_gaps:
    print("All events backed by dated assignments or parseable syllabus hints appear dated.")
else:
    print("Some sources with dates did NOT produce dated events (see GAP lines above).")
