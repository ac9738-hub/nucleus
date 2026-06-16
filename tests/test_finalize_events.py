import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.graph.edges import GraphEdgeStore
from canvas_parser.graph.events import (
    backfill_event_date,
    build_syllabus_exam_text,
    canonical_test_event_name,
    classify_study_material_filename,
    create_events_from_exam_assignments,
    event_needs_date,
    extract_prose_exam_hints,
    extract_syllabus_exam_hints,
    finalize_course_events,
    is_schedulable_date,
    normalize_event_type,
    promote_logged_events,
)


class FakeEvent:
    def __init__(self, name, eventid='', eventtype='', startdate='', enddate='', gradepercentage='', description='', dependencies=None):
        self.name = name
        self.eventid = eventid or f"{name}eventid"
        self.type = eventtype
        self.startdate = startdate
        self.enddate = enddate
        self.gradepercentage = gradepercentage
        self.description = description
        self.dependencies = dependencies or []


class FakeAssignment:
    def __init__(self, name, duedate='', unlockdate='', gradepercentage=''):
        self.name = name
        self.duedate = duedate
        self.unlockdate = unlockdate
        self.gradepercentage = gradepercentage


def normalize_iso_date(value):
    text = str(value or '').strip()
    if not text:
        return ''
    if is_schedulable_date(text):
        return text
    if len(text) == 10 and text[4] == '-' and text[7] == '-':
        return f'{text}T00:00:00Z'
    if text.count('/') == 2:
        month, day, year = text.split('/')
        if len(year) == 2:
            year = f'20{year}'
        return f'{year}-{int(month):02d}-{int(day):02d}T00:00:00Z'
    return text


class FakeFile:
    def __init__(self, fileid, name, filetype=''):
        self.fileid = fileid
        self.name = name
        self.type = filetype


def test_normalize_event_type_handles_review_and_final_project():
    assert normalize_event_type('review', 'Midterm Review Session') == 'review'
    assert normalize_event_type('', 'Midterm') == 'test'
    assert normalize_event_type('', 'Final Exam') == 'test'
    assert normalize_event_type('', 'Final Project') == 'deadline'
    assert normalize_event_type('', 'Final') == 'test'
    assert normalize_event_type('', 'Week 6: Midterms/Spring Break (No Midterm)') == 'other'


def test_normalize_event_type_respects_negated_test_keywords():
    assert normalize_event_type('', 'No Midterm This Week') == 'other'
    assert normalize_event_type('', 'Spring Break (No Final)') == 'other'


def test_classify_study_material_filename_detects_past_midterm():
    result = classify_study_material_filename('Midterm_F2011.pdf')
    assert result is not None
    assert result['filetype'] == 'study_material'
    assert result['target_event'] == 'Midterm'
    assert result['is_past_exam'] is True


def test_classify_study_material_filename_detects_review_sheet():
    result = classify_study_material_filename('MidtermReviewSessionQuestions-Fall2025.pdf')
    assert result is not None
    assert result['target_event'] == 'Midterm'
    assert result['is_review_material'] is True


def test_promote_logged_events_creates_test_event():
    created = []

    def add_event_fn(courseid, name, startdate, enddate, gradepercentage, description, eventtype, dependencies):
        created.append(('event', name, eventtype))

    def add_exam_fn(courseid, name, startdate, enddate, gradepercentage, description, dependencies):
        created.append(('exam', name))

    logged = [{
        'eventname': 'Midterm Exam 1',
        'startdate': '2025-03-10',
        'type': 'test',
        'dependencies': [],
    }]
    promoted, remaining, backfilled = promote_logged_events('101', logged, add_event_fn, add_exam_fn)
    assert promoted == 1
    assert remaining == []
    assert backfilled == 0
    assert created[0] == ('exam', 'Midterm')


def test_finalize_course_events_links_study_material_and_creates_missing_event():
    events = []
    files = {'f1': FakeFile('f1', 'Midterm_F2011.pdf')}
    logged = []
    graph_edges = GraphEdgeStore()

    def add_event_fn(courseid, name, startdate, enddate, gradepercentage, description, eventtype, dependencies):
        event = FakeEvent(name, eventtype=eventtype)
        events.append(event)
        return event.eventid

    def add_exam_fn(courseid, name, startdate, enddate, gradepercentage, description, dependencies):
        event = FakeEvent(name, eventtype='test')
        events.append(event)
        return event.eventid

    def find_event_fn(courseid, eventNodeId=None, eventname=None):
        for event in events:
            if eventname and event.name.casefold() == str(eventname).casefold():
                return event
        return None

    def set_file_type(file_node, filetype):
        file_node.type = filetype

    stats = finalize_course_events(
        '101',
        event_nodes=events,
        file_nodes=files,
        logged_events=logged,
        graph_edges=graph_edges,
        syllabus_other='Midterm: 3/10/2025',
        add_event_fn=add_event_fn,
        add_exam_fn=add_exam_fn,
        find_event_fn=find_event_fn,
        update_event_fn=lambda primary, secondary: None,
        set_file_type_fn=set_file_type,
        normalize_date_fn=normalize_iso_date,
    )

    assert stats['study_materials_linked'] == 1
    assert stats['syllabus_events_created'] == 1
    assert files['f1'].type == 'study_material'
    assert len(graph_edges.edges) == 1
    assert graph_edges.edges[0]['relation'] == 'requires_reading'
    assert graph_edges.edges[0]['fromType'] == 'event'
    assert graph_edges.edges[0]['toType'] == 'file'


def test_finalize_course_events_infers_event_from_study_material_without_syllabus():
    events = []
    files = {'f1': FakeFile('f1', 'Midterm_F2011.pdf')}
    graph_edges = GraphEdgeStore()

    def add_exam_fn(courseid, name, startdate, enddate, gradepercentage, description, dependencies):
        event = FakeEvent(name, eventtype='test')
        events.append(event)
        return event.eventid

    def find_event_fn(courseid, eventNodeId=None, eventname=None):
        for event in events:
            if eventname and event.name.casefold() == str(eventname).casefold():
                return event
        return None

    stats = finalize_course_events(
        '101',
        event_nodes=events,
        file_nodes=files,
        logged_events=[],
        graph_edges=graph_edges,
        syllabus_other='',
        add_event_fn=lambda *args, **kwargs: '',
        add_exam_fn=add_exam_fn,
        find_event_fn=find_event_fn,
        update_event_fn=lambda primary, secondary: None,
        set_file_type_fn=lambda file_node, filetype: setattr(file_node, 'type', filetype),
        normalize_date_fn=lambda value: value,
    )

    assert stats['events_inferred_from_materials'] == 1
    assert stats['study_materials_linked'] == 1
    assert events[0].name == 'Midterm'


def test_extract_syllabus_exam_hints():
    hints = extract_syllabus_exam_hints('Midterm: 3/10/2025\nFinal Exam: 5/12/2025')
    names = {hint['name'] for hint in hints}
    assert 'Midterm' in names
    assert 'Final' in names


def test_extract_prose_exam_hints():
    text = (
        'The midterm will be a take-home assignment due on Friday, October 10, at 5pm. '
        'The final exam will be conducted in person on Monday, December 15, 4:00pm-7:00pm.'
    )
    hints = extract_prose_exam_hints(text)
    labels = {hint['name'] for hint in hints}
    dates = {hint['date_text'] for hint in hints}
    assert 'Midterm' in labels
    assert 'Final' in labels
    assert 'Friday, October 10' in dates
    assert 'Monday, December 15' in dates


def test_canonical_test_event_name():
    assert canonical_test_event_name('Midterm Exam 1') == 'Midterm'
    assert canonical_test_event_name('Final Examination') == 'Final'


def test_score_module_event_match():
    from canvas_parser.graph.events import score_module_event_match

    assert score_module_event_match('Midterm Review Materials', 'Midterm', 'test') >= 0.75
    assert score_module_event_match('Week 3 Readings', 'Midterm', 'test') < 0.75
    assert score_module_event_match('Week 4', 'Week 4 Lecture: Intro', 'lecture') >= 0.75
    assert score_module_event_match('Quizzes/Exams', 'Midterm', 'test') >= 0.75
    assert score_module_event_match('Review Session', 'Midterm', 'test') >= 0.75


def test_link_module_items_to_events_links_files_and_assignments():
    from canvas_parser.graph.events import link_module_items_to_events

    class Assignment:
        def __init__(self, assignmentid, canvasAssignmentId=''):
            self.assignmentid = assignmentid
            self.canvasAssignmentId = canvasAssignmentId

    events = [FakeEvent('Midterm', eventid='midterm-event', eventtype='test')]
    files = {'file-1': FakeFile('file-1', 'Review Sheet.pdf')}
    graph_edges = GraphEdgeStore()
    course_modules = {
        'module-1': {'moduleId': 'module-1', 'name': 'Midterm Review'},
    }
    module_order_hints = {
        'item-1': {'moduleId': 'module-1', 'itemType': 'file', 'contentId': 'file-1'},
        'item-2': {'moduleId': 'module-1', 'itemType': 'assignment', 'contentId': 'canvas-assign-1'},
    }

    def find_assignment_fn(courseid, assignmentNodeId=None, assignmentname=None, canvasAssignmentId=None):
        if canvasAssignmentId == 'canvas-assign-1':
            return Assignment('assign-1', 'canvas-assign-1')
        if assignmentNodeId == 'assign-1':
            return Assignment('assign-1')
        return None

    stats = link_module_items_to_events(
        '101',
        course_modules,
        module_order_hints,
        events,
        files,
        graph_edges,
        find_assignment_fn,
    )

    assert stats['modules_matched'] == 1
    assert stats['module_items_linked'] == 2
    assert len(graph_edges.edges) == 2
    relations = {(edge['toType'], edge['toId'], edge['relation']) for edge in graph_edges.edges}
    assert ('file', 'file-1', 'requires_reading') in relations
    assert ('assignment', 'assign-1', 'requires') in relations


def test_create_events_from_exam_assignments():
    from canvas_parser.graph.events import create_events_from_exam_assignments

    class Assignment:
        def __init__(self, name, duedate=''):
            self.name = name
            self.duedate = duedate
            self.unlockdate = ''
            self.gradepercentage = ''

    events = []
    created = []

    def add_exam_fn(courseid, name, startdate, enddate, gradepercentage, description, dependencies):
        event = FakeEvent(name, eventtype='test')
        events.append(event)
        created.append(name)
        return event.eventid

    def find_event_fn(courseid, eventNodeId=None, eventname=None):
        for event in events:
            if eventname and event.name.casefold() == str(eventname).casefold():
                return event
        return None

    count = create_events_from_exam_assignments(
        '101',
        events,
        add_exam_fn,
        find_event_fn,
        get_assignments_fn=lambda courseid: [FakeAssignment('MIDTERM EXAM', '2025-03-10T00:00:00Z')],
        normalize_date_fn=normalize_iso_date,
    )

    assert count['created'] == 1
    assert created == ['Midterm']
    assert events[0].name == 'Midterm'


def test_finalize_course_events_does_not_infer_generic_quiz_without_strong_signal():
    events = []
    files = {'f1': FakeFile('f1', 'Quiz_Study_Guide.pdf')}
    graph_edges = GraphEdgeStore()
    created = []

    def add_exam_fn(courseid, name, startdate, enddate, gradepercentage, description, dependencies):
        created.append(name)
        event = FakeEvent(name, eventtype='test')
        events.append(event)
        return event.eventid

    stats = finalize_course_events(
        '101',
        event_nodes=events,
        file_nodes=files,
        logged_events=[],
        graph_edges=graph_edges,
        syllabus_other='',
        add_event_fn=lambda *args, **kwargs: '',
        add_exam_fn=add_exam_fn,
        find_event_fn=lambda *args, **kwargs: None,
        update_event_fn=lambda primary, secondary: None,
        set_file_type_fn=lambda file_node, filetype: setattr(file_node, 'type', filetype),
        normalize_date_fn=lambda value: value,
    )

    assert stats['events_inferred_from_materials'] == 0
    assert created == []


def test_finalize_course_events_skips_unparseable_syllabus_hint():
    events = []
    file_nodes = {}

    def add_exam_fn(courseid, examname, startdate, enddate, gradepercentage, description, dependencies):
        events.append(FakeEvent(examname, eventtype='test', startdate=startdate, enddate=enddate, description=description))

    stats = finalize_course_events(
        '15160',
        event_nodes=events,
        file_nodes=file_nodes,
        logged_events=[],
        graph_edges=GraphEdgeStore(),
        syllabus_exam_text='3 Quizzes 45%, Final 40%',
        add_event_fn=lambda *args, **kwargs: None,
        add_exam_fn=add_exam_fn,
        find_event_fn=lambda *args, **kwargs: None,
        update_event_fn=lambda *args, **kwargs: None,
        set_file_type_fn=lambda *args, **kwargs: None,
        normalize_date_fn=lambda value: value,
    )
    assert stats['syllabus_events_created'] == 0
    assert events == []


def test_finalize_course_events_backfills_undated_event_from_syllabus_hint():
    events = [FakeEvent('Midterm', eventtype='test', startdate='')]
    graph_edges = GraphEdgeStore()

    stats = finalize_course_events(
        '101',
        event_nodes=events,
        file_nodes={},
        logged_events=[],
        graph_edges=graph_edges,
        syllabus_exam_text='Midterm: 3/10/2025',
        add_event_fn=lambda *args, **kwargs: '',
        add_exam_fn=lambda *args, **kwargs: '',
        find_event_fn=lambda *args, **kwargs: events[0],
        update_event_fn=lambda primary, secondary: None,
        set_file_type_fn=lambda file_node, filetype: None,
        normalize_date_fn=normalize_iso_date,
    )

    assert stats['dates_backfilled_from_syllabus'] == 1
    assert stats['syllabus_events_created'] == 0
    assert events[0].startdate == '2025-03-10T00:00:00Z'


def test_finalize_course_events_does_not_overwrite_existing_event_date():
    events = [FakeEvent('Midterm', eventtype='test', startdate='2025-01-01T00:00:00Z')]
    graph_edges = GraphEdgeStore()

    stats = finalize_course_events(
        '101',
        event_nodes=events,
        file_nodes={},
        logged_events=[],
        graph_edges=graph_edges,
        syllabus_exam_text='Midterm: 3/10/2025',
        add_event_fn=lambda *args, **kwargs: '',
        add_exam_fn=lambda *args, **kwargs: '',
        find_event_fn=lambda *args, **kwargs: events[0],
        update_event_fn=lambda primary, secondary: None,
        set_file_type_fn=lambda file_node, filetype: None,
        normalize_date_fn=normalize_iso_date,
    )

    assert stats['dates_backfilled_from_syllabus'] == 0
    assert events[0].startdate == '2025-01-01T00:00:00Z'


def test_finalize_course_events_backfills_undated_event_from_assignment():
    events = [FakeEvent('Midterm', eventtype='test', startdate='')]
    graph_edges = GraphEdgeStore()

    stats = finalize_course_events(
        '101',
        event_nodes=events,
        file_nodes={},
        logged_events=[],
        graph_edges=graph_edges,
        syllabus_exam_text='',
        add_event_fn=lambda *args, **kwargs: '',
        add_exam_fn=lambda *args, **kwargs: '',
        find_event_fn=lambda *args, **kwargs: events[0],
        update_event_fn=lambda primary, secondary: None,
        set_file_type_fn=lambda file_node, filetype: None,
        normalize_date_fn=normalize_iso_date,
        get_assignments_fn=lambda courseid: [FakeAssignment('MIDTERM EXAM', '2025-03-10T00:00:00Z')],
    )

    assert stats['dates_backfilled_from_assignments'] == 1
    assert stats['exam_assignment_events_created'] == 0
    assert events[0].startdate == '2025-03-10T00:00:00Z'


def test_create_events_from_exam_assignments_skips_final_project():
    events = []

    def add_exam_fn(courseid, name, startdate, enddate, gradepercentage, description, dependencies):
        events.append(FakeEvent(name, eventtype='test'))
        return f'{name}-id'

    result = create_events_from_exam_assignments(
        '101',
        events,
        add_exam_fn,
        lambda *args, **kwargs: None,
        get_assignments_fn=lambda courseid: [FakeAssignment('Final Project', '2025-05-01T00:00:00Z')],
        normalize_date_fn=normalize_iso_date,
    )

    assert result == {'created': 0, 'backfilled': 0}
    assert events == []


def test_build_syllabus_exam_text_includes_classtimes_and_assignments():
    text = build_syllabus_exam_text(
        'Midterm on March 10, 2025',
        'Grading policy details',
        [FakeAssignment('Final Exam', '2025-05-12T00:00:00Z')],
    )
    assert 'Midterm on March 10, 2025' in text
    assert 'Final Exam: 2025-05-12T00:00:00Z' in text


def test_event_needs_date_and_backfill_event_date():
    undated = FakeEvent('Midterm', eventtype='test', startdate='')
    dated = FakeEvent('Final', eventtype='test', startdate='2025-05-12T00:00:00Z')

    assert event_needs_date(undated) is True
    assert event_needs_date(dated) is False
    assert backfill_event_date(undated, '2025-03-10T00:00:00Z', normalize_date_fn=normalize_iso_date) is True
    assert undated.startdate == '2025-03-10T00:00:00Z'
    assert backfill_event_date(dated, '2025-03-10T00:00:00Z', normalize_date_fn=normalize_iso_date) is False
