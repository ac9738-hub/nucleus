import json
from collections import Counter
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.extract.validate import validate_graph_state
from canvas_parser.graph.edges import GraphEdgeStore
from canvas_parser.graph.events import score_module_event_match

path = ROOT / 'canvas_graph.json'
state = json.loads(path.read_text(encoding='utf-8'))

events = state.get('events') or []
files = state.get('files') or {}
edges = state.get('edges') or []
logged_events = state.get('logged_events') or {}
course_modules = state.get('courseModules') or {}
module_hints = state.get('moduleOrderHints') or {}

print('=== GRAPH SUMMARY ===')
print('graph_version:', state.get('graph_version'))
print('events:', len(events))
print('concepts:', len(state.get('concepts') or []))
print('problems:', len(state.get('problems') or []))
print('edges:', len(edges))
print('courses with files:', len(files))
print('courses with modules:', len(course_modules))
print('courses with module hints:', len(module_hints))
print('logged_events courses:', {k: len(v) for k, v in logged_events.items() if v})

print('\n=== EVENT TYPES ===')
print(dict(Counter(e.get('type') or '(empty)' for e in events)))

print('\n=== EVENTS BY COURSE ===')
by_course = Counter(str(e.get('courseid', '')) for e in events)
for cid, count in by_course.most_common(15):
    print(f'  course {cid}: {count} events')

print('\n=== UNDATED TEST EVENTS ===')
for e in events:
    if (e.get('type') or '') == 'test' and not e.get('startdate') and not e.get('enddate'):
        print(f"  {e.get('courseid')} | {e.get('name')} | id={e.get('eventid')}")

print('\n=== LOGGED EVENTS (unpromoted) ===')
for cid, items in logged_events.items():
    for item in items or []:
        print(f"  course={cid} name={item.get('eventname')} type={item.get('type')}")

print('\n=== EDGE RELATIONS ===')
print(dict(Counter((e.get('fromType'), e.get('relation'), e.get('toType')) for e in edges)))

event_edges = [e for e in edges if e.get('fromType') == 'event']
print('\n=== EVENT EDGES ===', len(event_edges))
for e in event_edges[:25]:
    meta = e.get('metadata') or {}
    print(f"  {e.get('fromId')} --{e.get('relation')}--> {e.get('toType')}:{e.get('toId')} source={e.get('source')} module={meta.get('moduleName','')}")

print('\n=== MODULE MATCH CANDIDATES (unlinked modules) ===')
for cid, mods in course_modules.items():
    course_events = [e for e in events if str(e.get('courseid', '')) == str(cid)]
    if not course_events:
        continue
    items_by_module = {}
    for item_id, hint in (module_hints.get(cid) or {}).items():
        if isinstance(hint, dict) and hint.get('moduleId'):
            items_by_module.setdefault(str(hint['moduleId']), []).append(hint)
    for mid, mod in (mods or {}).items():
        name = (mod or {}).get('name', '')
        if not name:
            continue
        best = None
        best_score = 0
        for ev in course_events:
            s = score_module_event_match(name, ev.get('name', ''), ev.get('type', ''))
            if s > best_score:
                best_score = s
                best = ev
        linked = any(
            (e.get('metadata') or {}).get('moduleId') == str(mid)
            for e in event_edges
            if str(e.get('fromId', '')) == str((best or {}).get('eventid', ''))
        )
        item_count = len(items_by_module.get(str(mid), []))
        print(f"  course={cid} module={name!r} items={item_count} best={getattr(best,'get',lambda k: None)('name') if best else None} score={best_score:.2f} linked={linked}")

print('\n=== STUDY MATERIAL FILES ===')
sm_count = 0
for cid, course_files in files.items():
    for fid, f in (course_files or {}).items():
        if (f or {}).get('type') == 'study_material':
            sm_count += 1
print(' total study_material files:', sm_count)

print('\n=== VALIDATION WARNINGS ===')
store = GraphEdgeStore(edges)
warnings = validate_graph_state(state, store)
print('count:', len(warnings))
for w in warnings[:50]:
    print(' ', w)

print('\n=== ORPHAN EVENT EDGES ===')
event_ids = {e.get('eventid') for e in events}
file_ids = set()
for course_files in files.values():
    for fid, f in (course_files or {}).items():
        file_ids.add((f or {}).get('fileid') or fid)
assignments = set()
for syllabus in (state.get('syllabi') or {}).values():
    for a in syllabus.get('assignments') or []:
        if a.get('assignmentid'):
            assignments.add(str(a.get('assignmentid')))
for e in event_edges:
    if e.get('fromId') not in event_ids:
        print('  bad from event:', e)
    if e.get('toType') == 'file' and e.get('toId') not in file_ids:
        print('  missing file target:', e.get('toId'), 'from event', e.get('fromId'))
    if e.get('toType') == 'assignment' and str(e.get('toId')) not in assignments:
        print('  missing assignment target:', e.get('toId'), 'from event', e.get('fromId'))
