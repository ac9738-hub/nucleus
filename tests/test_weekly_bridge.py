import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.weekly.bridge import build_weekly_schedules, canvas_data_to_snapshot


def _minimal_canvas_data():
    return {
        'courses': [{
            'id': 1,
            'course_code': 'CHM 201',
            'name': 'General Chemistry I Fall 2024',
            'start_at': '2024-08-26T04:00:00Z',
            'syllabus_body': '<p>Exam 1 (Midterm): October 10, 2024</p>',
        }],
        'assignments': {
            '1': [{
                'id': 'a1',
                'name': 'Problem Set 1',
                'due_at': '2024-09-13T03:59:59Z',
                'published': True,
                'submission_types': ['online_upload'],
            }],
        },
        'file': {'1': []},
        'modules': {'1': [{'id': 'm1', 'name': 'Week 1', 'position': 1}]},
        'module_items': {
            '1': {
                'm1': [{
                    'id': 'i1',
                    'type': 'File',
                    'content_id': '10',
                    'position': 1,
                    'title': 'Week 1 schedule.pdf',
                }],
            },
        },
        'pages': {'1': []},
    }


def test_canvas_data_to_snapshot_maps_file_bucket():
    canvas_data = _minimal_canvas_data()
    snapshot = canvas_data_to_snapshot(canvas_data['courses'][0], canvas_data)
    assert snapshot['course']['id'] == 1
    assert snapshot['assignments'][0]['name'] == 'Problem Set 1'
    assert snapshot['files'] == []
    assert 'm1' in snapshot['module_items']


def test_build_weekly_schedules_returns_course_keyed_weeks():
    canvas_data = _minimal_canvas_data()
    schedules = build_weekly_schedules(canvas_data, graph=None, use_graph=False)
    assert '1' in schedules
    assert schedules['1'][0]['name'].startswith('Week')


def test_build_weekly_schedules_cli_shape_from_fixtures():
    fixture_path = ROOT / 'fixtures' / 'weekly_iteration' / 'snapshots_gt.json'
    if not fixture_path.is_file():
        return
    snapshots = json.loads(fixture_path.read_text(encoding='utf-8'))
    canvas_data = {
        'courses': [snapshot['course'] for snapshot in snapshots],
        'assignments': {},
        'file': {},
        'modules': {},
        'module_items': {},
        'pages': {},
    }
    for snapshot in snapshots:
        course_id = str(snapshot['course']['id'])
        canvas_data['assignments'][course_id] = snapshot.get('assignments') or []
        canvas_data['file'][course_id] = snapshot.get('files') or []
        canvas_data['modules'][course_id] = snapshot.get('modules') or []
        canvas_data['module_items'][course_id] = snapshot.get('module_items') or {}
        canvas_data['pages'][course_id] = snapshot.get('pages') or []
    schedules = build_weekly_schedules(canvas_data, graph=None, use_graph=False)
    assert schedules
    first_course = next(iter(schedules.values()))
    assert first_course[0]['files'] is not None
