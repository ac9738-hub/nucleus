"""Analyze event date coverage in canvas_graph.json.

Prefer the full pipeline checker:
  python scripts/check_event_pipeline.py
"""
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "canvas_graph.json"
data = json.loads(path.read_text(encoding="utf-8"))
events = data.get("events", [])


def is_iso(value):
    text = str(value or "").strip()
    return len(text) == 20 and text.endswith("Z") and text[4] == "-" and text[10] == "T"


empty = []
dated = []
invalid = []
for event in events:
    start = event.get("startdate") or ""
    end = event.get("enddate") or ""
    if not start and not end:
        empty.append(event)
    elif is_iso(start) or is_iso(end):
        dated.append(event)
    else:
        invalid.append(event)

by_course_empty = defaultdict(list)
by_source = Counter()
for event in empty:
    by_course_empty[event.get("courseid", "?")].append(event)
    desc = str(event.get("description") or "")
    if desc.startswith("Inferred from assignment"):
        by_source["inferred_assignment"] += 1
    elif desc.startswith("Inferred from study material"):
        by_source["inferred_study_material"] += 1
    elif desc.startswith("Extracted from syllabus"):
        by_source["extracted_syllabus"] += 1
    else:
        by_source["other_llm"] += 1

print("=== Event date summary ===")
print(f"total_events: {len(events)}")
print(f"fully_undated: {len(empty)} ({100 * len(empty) / max(len(events), 1):.1f}%)")
print(f"schedulable_dates: {len(dated)} ({100 * len(dated) / max(len(events), 1):.1f}%)")
print(f"non_iso_dates: {len(invalid)}")
print()
print("undated_by_source:")
for key, count in by_source.most_common():
    print(f"  {key}: {count}")
print()
print("undated_by_course (top 10):")
for cid, items in sorted(by_course_empty.items(), key=lambda x: -len(x[1]))[:10]:
    names = [e.get("name", "?") for e in items]
    print(f"  course {cid}: {len(items)} -> {names}")
print()
print("sample dated events:")
for event in dated[:6]:
    print(
        f"  course={event.get('courseid')} name={event.get('name')!r} "
        f"start={event.get('startdate')} desc={(event.get('description') or '')[:55]}"
    )
print()
print("=== All events ===")
for event in sorted(events, key=lambda item: (str(item.get("courseid", "")), str(item.get("name", "")))):
    start = event.get("startdate") or "-"
    start_display = start[:19] if start != "-" else "-"
    name = str(event.get("name", ""))[:28]
    print(
        f"{str(event.get('courseid', '')):>6} "
        f"{str(event.get('type', '?')):12} "
        f"{name:28} "
        f"start={start_display}"
    )

test_events = [event for event in events if event.get("type") == "test"]
test_dated = [
    event for event in test_events
    if is_iso(event.get("startdate")) or is_iso(event.get("enddate"))
]
test_undated = [
    event for event in test_events
    if not is_iso(event.get("startdate")) and not is_iso(event.get("enddate"))
]
print()
print("=== Test events only ===")
print(
    f"total: {len(test_events)}, dated: {len(test_dated)} "
    f"({100 * len(test_dated) / max(len(test_events), 1):.0f}%), undated: {len(test_undated)}"
)
