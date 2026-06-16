import re

TEST_EVENT_KEYWORDS = {'test', 'exam', 'quiz', 'midterm'}

CANONICAL_TEST_EVENT_NAMES = {
    'midterm': 'Midterm',
    'final': 'Final',
    'quiz': 'Quiz',
    'exam': 'Exam',
}

PAST_YEAR_PATTERN = re.compile(
    r'(?:_|-|\b)(?:f|s|fall|spring|summer|winter)?\s*(?:19|20)\d{2}\b',
    re.IGNORECASE,
)
SOLUTION_PATTERN = re.compile(r'\b(?:sol|solution|solutions|answers?)\b', re.IGNORECASE)
REVIEW_MATERIAL_PATTERN = re.compile(
    r'\b(?:midterm|exam|final|quiz)\s*review\b|\breview\s*(?:session|questions|sheet|guide)\b',
    re.IGNORECASE,
)
NON_TEST_FINAL_PATTERN = re.compile(
    r'\bfinal\s+(?:project|paper|report|presentation|portfolio|essay|draft|submission)\b',
    re.IGNORECASE,
)
FINAL_TEST_PATTERN = re.compile(r'\bfinal\s+(?:exam|test|examination)\b', re.IGNORECASE)
MIDTERM_PATTERN = re.compile(r'\bmidterm\b', re.IGNORECASE)
QUIZ_PATTERN = re.compile(r'\bquiz\b', re.IGNORECASE)
EXAM_PATTERN = re.compile(r'\b(?:exam|test)\b', re.IGNORECASE)
FINAL_ALONE_PATTERN = re.compile(r'\bfinal\b', re.IGNORECASE)
REVIEW_EVENT_PATTERN = re.compile(
    r'\b(?:midterm|exam|final|quiz)\s+review\b|\breview\s+session\b',
    re.IGNORECASE,
)
NEGATED_TEST_PATTERN = re.compile(
    r'(?:\(|^|[\s:/-])no\s+(midterm|final|quiz|exam|test)s?\)?',
    re.IGNORECASE,
)
WEEK_NUMBER_PATTERN = re.compile(r'\bweek\s+(\d+)\b', re.IGNORECASE)
QUIZZES_EXAMS_MODULE_PATTERN = re.compile(r'\bquizzes?\s*/?\s*exams?\b', re.IGNORECASE)
SYLLABUS_EXAM_LINE_PATTERN = re.compile(
    r'(?P<label>(?:midterm|final(?:\s+exam)?|(?<!\w)quiz(?:es)?(?:\s+\d+)?(?!\w)|(?<!\w)exam(?:\s+\d+)?(?!\w)))'
    r'(?:\s+on)?\s*'
    r'(?:[:：\-–—]\s*)?'
    r'(?P<date>'
    r'\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?'
    r'|\w+\s+\d{1,2},?\s+\d{4}'
    r'|\w+\s+\d{1,2}(?!\d)'
    r')',
    re.IGNORECASE,
)

MONTH_NAME_IN_DATE = re.compile(
    r'\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|'
    r'jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b',
    re.IGNORECASE,
)
NUMERIC_DATE_IN_TEXT = re.compile(r'\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?')


def is_plausible_exam_date_text(date_text):
    text = str(date_text or '').strip()
    if not text or '%' in text:
        return False
    if re.fullmatch(r'\d{1,2}', text):
        return False
    if re.match(r'^(?:exam|quiz|zes|midterm|final)\b', text, re.IGNORECASE):
        return False
    if NUMERIC_DATE_IN_TEXT.search(text):
        return True
    if MONTH_NAME_IN_DATE.search(text) and re.search(r'\d', text):
        return True
    return False

def is_schedulable_date(value):
    text = str(value or '').strip()
    if len(text) != 20:
        return False
    if text[4] != '-' or text[7] != '-' or text[10] != 'T' or text[13] != ':' or text[16] != ':' or text[19] != 'Z':
        return False
    for index in (0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18):
        if text[index] < '0' or text[index] > '9':
            return False
    return True


def _event_field(event, field, default=''):
    if isinstance(event, dict):
        return event.get(field, default)
    return getattr(event, field, default)


def _set_event_field(event, field, value):
    if isinstance(event, dict):
        event[field] = value
    else:
        setattr(event, field, value)


def event_needs_date(event):
    startdate = _event_field(event, 'startdate', '')
    enddate = _event_field(event, 'enddate', '')
    return not is_schedulable_date(startdate) and not is_schedulable_date(enddate)


def backfill_event_date(event, date_text, *, normalize_date_fn=None, prefer='startdate'):
    if not event or not event_needs_date(event):
        return False
    normalize = normalize_date_fn or (lambda value: value)
    normalized = normalize(date_text)
    if not is_schedulable_date(normalized):
        return False
    if prefer == 'enddate' and not is_schedulable_date(_event_field(event, 'enddate', '')):
        _set_event_field(event, 'enddate', normalized)
        return True
    if not is_schedulable_date(_event_field(event, 'startdate', '')):
        _set_event_field(event, 'startdate', normalized)
        return True
    return False


def format_exam_assignments_for_hints(assignments):
    lines = []
    for assignment in assignments or []:
        name = getattr(assignment, 'name', '') if not isinstance(assignment, dict) else assignment.get('name', '')
        if not str(name or '').strip():
            continue
        if normalize_event_type('', name) != 'test':
            continue
        duedate = getattr(assignment, 'duedate', '') if not isinstance(assignment, dict) else (
            assignment.get('duedate', '') or assignment.get('due_at', '')
        )
        unlockdate = getattr(assignment, 'unlockdate', '') if not isinstance(assignment, dict) else assignment.get('unlockdate', '')
        date_text = duedate or unlockdate
        if date_text:
            lines.append(f"{name}: {date_text}")
        else:
            lines.append(str(name))
    return '\n'.join(lines)


PROSE_EXAM_PATTERN = re.compile(
    r'\b(?P<label>midterm(?:\s+exam)?|final(?:\s+exam)?)\b'
    r'(?P<middle>[^.!?]{0,250}?)'
    r'(?P<date>(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+'
    r'(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})',
    re.IGNORECASE | re.DOTALL,
)
BREAK_MODULE_PATTERN = re.compile(
    r'\b(?:thanksgiving|spring break|reading period|recess)\b',
    re.IGNORECASE,
)


def extract_prose_exam_hints(other_text=''):
    hints = []
    seen = set()
    for match in PROSE_EXAM_PATTERN.finditer(str(other_text or '')):
        label = match.group('label').strip()
        date_text = match.group('date').strip()
        if not is_plausible_exam_date_text(date_text):
            continue
        canonical = canonical_test_event_name(label)
        key = (canonical.casefold(), date_text.casefold())
        if key in seen:
            continue
        seen.add(key)
        hints.append({
            'name': canonical,
            'date_text': date_text,
            'type': 'test',
        })
    return hints


def build_snapshot_exam_text(snapshot):
    if not isinstance(snapshot, dict):
        return ''
    course = snapshot.get('course') or {}
    parts = [str(course.get('syllabus_body') or '').strip()]
    for assignment in snapshot.get('assignments') or []:
        description = assignment.get('description') if isinstance(assignment, dict) else ''
        if description:
            parts.append(str(description))
    for body in (snapshot.get('page_bodies') or {}).values():
        if body:
            parts.append(str(body))
    return build_syllabus_exam_text(other='\n'.join(part for part in parts if part), assignments=snapshot.get('assignments'))


def build_syllabus_exam_text(classtimes='', other='', assignments=None):
    parts = [
        str(classtimes or '').strip(),
        str(other or '').strip(),
        format_exam_assignments_for_hints(assignments),
    ]
    return '\n'.join(part for part in parts if part)


def strip_negated_test_phrases(text):
    return NEGATED_TEST_PATTERN.sub(' ', str(text or ''))


def test_keyword_is_negated(combined, keyword):
    keyword = str(keyword or '').casefold().strip()
    if not keyword:
        return False
    for match in NEGATED_TEST_PATTERN.finditer(str(combined or '')):
        negated = str(match.group(1) or '').casefold().strip()
        if negated == keyword or negated.rstrip('s') == keyword.rstrip('s'):
            return True
    return False


def normalize_event_type(eventtype='', name=''):
    combined = f"{eventtype or ''} {name or ''}".casefold().strip()
    if not combined:
        return ''

    if REVIEW_EVENT_PATTERN.search(combined):
        return 'review'

    if NON_TEST_FINAL_PATTERN.search(combined):
        normalized = str(eventtype or '').strip().casefold()
        if normalized in {'lecture', 'office_hours', 'lab', 'presentation', 'deadline', 'review', 'other'}:
            return normalized
        return 'deadline'

    test_combined = strip_negated_test_phrases(combined)

    if MIDTERM_PATTERN.search(test_combined) and not test_keyword_is_negated(combined, 'midterm'):
        return 'test'
    if QUIZ_PATTERN.search(test_combined) and not test_keyword_is_negated(combined, 'quiz'):
        return 'test'
    if FINAL_TEST_PATTERN.search(test_combined) and not test_keyword_is_negated(combined, 'final'):
        return 'test'
    if FINAL_ALONE_PATTERN.search(test_combined) and not test_keyword_is_negated(combined, 'final'):
        return 'test'
    if EXAM_PATTERN.search(test_combined) and not test_keyword_is_negated(combined, 'exam'):
        return 'test'

    lowered_type = str(eventtype or '').strip().casefold()
    type_aliases = {
        'lecture': 'lecture',
        'class': 'lecture',
        'office hour': 'office_hours',
        'office hours': 'office_hours',
        'office_hours': 'office_hours',
        'lab': 'lab',
        'presentation': 'presentation',
        'deadline': 'deadline',
        'review': 'review',
        'other': 'other',
    }
    for key, value in type_aliases.items():
        if key in combined or lowered_type == key:
            return value

    return str(eventtype or '').strip() or 'other'


def canonical_test_event_name(name='', eventtype=''):
    text = str(name or '').casefold()
    if MIDTERM_PATTERN.search(text):
        return CANONICAL_TEST_EVENT_NAMES['midterm']
    if FINAL_TEST_PATTERN.search(text) or (
        FINAL_ALONE_PATTERN.search(text) and not NON_TEST_FINAL_PATTERN.search(text)
    ):
        return CANONICAL_TEST_EVENT_NAMES['final']
    if QUIZ_PATTERN.search(text):
        return CANONICAL_TEST_EVENT_NAMES['quiz']
    if EXAM_PATTERN.search(text) or normalize_event_type(eventtype, name) == 'test':
        return CANONICAL_TEST_EVENT_NAMES['exam']
    return str(name or '').strip()


def classify_study_material_filename(filename='', filetype=''):
    explicit = str(filetype or '').strip().casefold()
    if explicit == 'study_material':
        target = infer_event_target_from_filename(filename)
        return {
            'filetype': 'study_material',
            'target_event': target,
            'is_past_exam': is_past_exam_filename(filename),
            'is_review_material': bool(REVIEW_MATERIAL_PATTERN.search(str(filename or ''))),
        }

    name = str(filename or '')
    lowered = name.casefold()
    if not lowered:
        return None

    target = infer_event_target_from_filename(name)
    is_review = bool(REVIEW_MATERIAL_PATTERN.search(name)) or (
        _filename_contains(name, 'review') and target is not None
    )
    if not target and not is_review:
        return None

    return {
        'filetype': 'study_material',
        'target_event': target or infer_event_target_from_filename(name.replace('review', 'midterm')),
        'is_past_exam': is_past_exam_filename(name),
        'is_review_material': is_review,
    }


def _filename_contains(text, token):
    return token in str(text or '').casefold()


def infer_event_target_from_filename(filename):
    text = str(filename or '').casefold()
    if _filename_contains(text, 'midterm'):
        return CANONICAL_TEST_EVENT_NAMES['midterm']
    if _filename_contains(text, 'final') and not NON_TEST_FINAL_PATTERN.search(text):
        if _filename_contains(text, 'final exam') or _filename_contains(text, 'final test') or _filename_contains(text, 'final'):
            return CANONICAL_TEST_EVENT_NAMES['final']
    if _filename_contains(text, 'quiz'):
        return CANONICAL_TEST_EVENT_NAMES['quiz']
    if _filename_contains(text, 'exam') or _filename_contains(text, 'test'):
        return CANONICAL_TEST_EVENT_NAMES['exam']
    return None


def is_past_exam_filename(filename):
    text = str(filename or '')
    if PAST_YEAR_PATTERN.search(text):
        return True
    if SOLUTION_PATTERN.search(text):
        return True
    return False


def event_names_match(left='', right=''):
    left_text = str(left or '').casefold().strip()
    right_text = str(right or '').casefold().strip()
    if not left_text or not right_text:
        return False
    if left_text == right_text:
        return True
    left_canonical = canonical_test_event_name(left)
    right_canonical = canonical_test_event_name(right)
    if left_canonical and right_canonical and left_canonical.casefold() == right_canonical.casefold():
        return True
    return left_text in right_text or right_text in left_text


def extract_syllabus_exam_hints(other_text=''):
    hints = []
    seen = set()
    for source in (extract_prose_exam_hints(other_text),):
        for hint in source:
            key = (hint['name'].casefold(), hint['date_text'].casefold())
            if key in seen:
                continue
            seen.add(key)
            hints.append(hint)
    for match in SYLLABUS_EXAM_LINE_PATTERN.finditer(str(other_text or '')):
        label = match.group('label').strip()
        date_text = match.group('date').strip()
        if not is_plausible_exam_date_text(date_text):
            continue
        canonical = canonical_test_event_name(label)
        key = (canonical.casefold(), date_text.casefold())
        if key in seen:
            continue
        seen.add(key)
        hints.append({
            'name': canonical,
            'date_text': date_text,
            'type': 'test',
        })
    return hints


def promote_logged_events(
    courseid,
    logged_events,
    add_event_fn,
    add_exam_fn,
    remove_promoted=True,
    *,
    event_nodes=None,
    find_event_fn=None,
    normalize_date_fn=None,
):
    promoted = 0
    backfilled = 0
    remaining = []
    for entry in logged_events or []:
        if not isinstance(entry, dict):
            if not remove_promoted:
                remaining.append(entry)
            continue
        eventname = str(entry.get('eventname') or '').strip()
        if not eventname:
            remaining.append(entry)
            continue
        eventtype = normalize_event_type(entry.get('type', ''), eventname)
        canonical_name = canonical_test_event_name(eventname, eventtype) if eventtype == 'test' else eventname
        dependencies = entry.get('dependencies', []) or []
        kwargs = {
            'startdate': entry.get('startdate', ''),
            'enddate': entry.get('enddate', ''),
            'gradepercentage': entry.get('gradepercentage', ''),
            'description': entry.get('description', ''),
        }
        lookup_name = canonical_name if eventtype == 'test' else eventname
        existing = find_best_event_for_target(event_nodes, lookup_name)
        if not existing and find_event_fn:
            existing = find_event_fn(courseid, eventname=lookup_name)
        date_text = kwargs['startdate'] or kwargs['enddate']
        if existing and date_text and backfill_event_date(
            existing,
            date_text,
            normalize_date_fn=normalize_date_fn,
        ):
            backfilled += 1
            promoted += 1
            if not remove_promoted:
                remaining.append(entry)
            continue
        if eventtype == 'test':
            add_exam_fn(
                courseid,
                canonical_name,
                kwargs['startdate'],
                kwargs['enddate'],
                kwargs['gradepercentage'],
                kwargs['description'],
                dependencies,
            )
        else:
            add_event_fn(
                courseid,
                eventname,
                kwargs['startdate'],
                kwargs['enddate'],
                kwargs['gradepercentage'],
                kwargs['description'],
                eventtype,
                dependencies,
            )
        promoted += 1
        if not remove_promoted:
            remaining.append(entry)
    return promoted, remaining, backfilled


def link_study_material_to_event(graph_edges, event_id, file_id, source='heuristic', metadata=None):
    if not event_id or not file_id:
        return False
    return graph_edges.add_edge(
        'event',
        event_id,
        'file',
        file_id,
        'requires_reading',
        confidence=0.9 if source == 'heuristic' else 0.85,
        source=source,
        metadata=metadata or {},
    )


def find_best_event_for_target(events, target_name):
    target = str(target_name or '').strip()
    if not target:
        return None

    exact = []
    canonical = []
    partial = []
    for event in events or []:
        name = getattr(event, 'name', '') if not isinstance(event, dict) else event.get('name', '')
        event_id = getattr(event, 'eventid', '') if not isinstance(event, dict) else event.get('eventid', '')
        event_type = getattr(event, 'type', '') if not isinstance(event, dict) else event.get('type', '')
        if str(name).casefold() == target.casefold():
            exact.append((event, event_id))
            continue
        if canonical_test_event_name(name, event_type).casefold() == target.casefold():
            canonical.append((event, event_id))
            continue
        if event_names_match(name, target):
            partial.append((event, event_id))

    for bucket in (exact, canonical, partial):
        if bucket:
            return bucket[0][0]
    return None


def apply_study_material_heuristics(courseid, file_nodes, event_nodes, graph_edges, set_file_type_fn, find_event_fn, add_exam_fn=None):
    linked = 0
    typed = 0
    created = 0
    events = list(event_nodes or [])

    for file_node in (file_nodes or {}).values():
        filename = getattr(file_node, 'name', '') if not isinstance(file_node, dict) else file_node.get('name', '')
        file_id = getattr(file_node, 'fileid', '') if not isinstance(file_node, dict) else file_node.get('fileid', '')
        current_type = getattr(file_node, 'type', '') if not isinstance(file_node, dict) else file_node.get('type', '')
        classification = classify_study_material_filename(filename, current_type)
        if not classification:
            continue

        if set_file_type_fn and not current_type:
            set_file_type_fn(file_node, classification['filetype'])
            typed += 1

        target = classification.get('target_event')
        if not target:
            continue

        event = find_best_event_for_target(events, target)
        if not event and find_event_fn:
            event = find_event_fn(courseid, eventname=target)
            if event and event not in events:
                events.append(event)

        if not event and add_exam_fn and (
            classification.get('is_past_exam') or classification.get('is_review_material')
        ):
            add_exam_fn(
                courseid,
                target,
                '',
                '',
                '',
                f'Inferred from study material: {filename}',
                [],
            )
            created += 1
            if find_event_fn:
                event = find_event_fn(courseid, eventname=target)
            if not event:
                event = find_best_event_for_target(events, target)
            if event and event not in events:
                events.append(event)

        if not event:
            continue

        event_id = getattr(event, 'eventid', '') if not isinstance(event, dict) else event.get('eventid', '')
        if link_study_material_to_event(
            graph_edges,
            event_id,
            file_id,
            metadata={
                'reason': 'study_material_filename',
                'target_event': target,
                'is_past_exam': classification.get('is_past_exam'),
                'is_review_material': classification.get('is_review_material'),
            },
        ):
            linked += 1

    return {'typed': typed, 'linked': linked, 'created': created}


def merge_duplicate_test_events(events, update_event_fn):
    merged = 0
    canonical_map = {}
    for event in list(events or []):
        event_type = getattr(event, 'type', '') if not isinstance(event, dict) else event.get('type', '')
        name = getattr(event, 'name', '') if not isinstance(event, dict) else event.get('name', '')
        if normalize_event_type(event_type, name) != 'test':
            continue
        canonical = canonical_test_event_name(name, event_type)
        if not canonical:
            continue
        if canonical.casefold() not in canonical_map:
            canonical_map[canonical.casefold()] = event
            continue
        primary = canonical_map[canonical.casefold()]
        secondary = event
        if update_event_fn:
            update_event_fn(primary, secondary)
        merged += 1
    return merged


def finalize_course_events(
    courseid,
    *,
    event_nodes,
    file_nodes,
    logged_events,
    graph_edges,
    syllabus_other='',
    syllabus_exam_text='',
    add_event_fn,
    add_exam_fn,
    find_event_fn,
    update_event_fn,
    set_file_type_fn,
    normalize_date_fn=None,
    get_assignments_fn=None,
    on_backfill=None,
    on_syllabus_hint=None,
    on_assignment_exam=None,
):
    stats = {
        'promoted_logged_events': 0,
        'study_materials_typed': 0,
        'study_materials_linked': 0,
        'duplicates_merged': 0,
        'syllabus_events_created': 0,
        'exam_assignment_events_created': 0,
        'events_inferred_from_materials': 0,
        'dates_backfilled_from_syllabus': 0,
        'dates_backfilled_from_assignments': 0,
        'dates_backfilled_from_logged': 0,
    }

    exam_text = syllabus_exam_text or syllabus_other

    promoted, remaining, logged_backfilled = promote_logged_events(
        courseid,
        logged_events,
        add_event_fn,
        add_exam_fn,
        remove_promoted=True,
        event_nodes=event_nodes,
        find_event_fn=find_event_fn,
        normalize_date_fn=normalize_date_fn,
    )
    stats['promoted_logged_events'] = promoted
    stats['dates_backfilled_from_logged'] = logged_backfilled
    logged_events[:] = remaining

    for hint in extract_syllabus_exam_hints(exam_text):
        existing = find_best_event_for_target(event_nodes, hint['name'])
        startdate = normalize_date_fn(hint['date_text']) if normalize_date_fn else hint['date_text']
        if existing:
            existing_start = _event_field(existing, 'startdate', '')
            if backfill_event_date(existing, hint['date_text'], normalize_date_fn=normalize_date_fn):
                stats['dates_backfilled_from_syllabus'] += 1
                action = 'backfilled'
                if on_backfill:
                    on_backfill(
                        courseid,
                        _event_field(existing, 'name', hint['name']),
                        _event_field(existing, 'startdate', startdate),
                        'syllabus_hint',
                    )
            elif is_schedulable_date(existing_start):
                action = 'skipped_already_dated'
            elif not is_schedulable_date(startdate):
                action = 'skipped_unparseable_date'
            else:
                action = 'skipped_no_backfill'
            if on_syllabus_hint:
                on_syllabus_hint(
                    courseid,
                    hint['name'],
                    hint['date_text'],
                    startdate,
                    action,
                )
            continue
        if not is_schedulable_date(startdate):
            if on_syllabus_hint:
                on_syllabus_hint(
                    courseid,
                    hint['name'],
                    hint['date_text'],
                    startdate,
                    'skipped_unparseable_date',
                )
            continue
        action = 'created'
        if on_syllabus_hint:
            on_syllabus_hint(
                courseid,
                hint['name'],
                hint['date_text'],
                startdate,
                action,
            )
        add_exam_fn(
            courseid,
            hint['name'],
            startdate,
            '',
            '',
            f"Extracted from syllabus: {hint['name']} ({hint['date_text']})",
            [],
        )
        stats['syllabus_events_created'] += 1

    assignment_stats = create_events_from_exam_assignments(
        courseid,
        event_nodes,
        add_exam_fn,
        find_event_fn,
        get_assignments_fn=get_assignments_fn,
        normalize_date_fn=normalize_date_fn,
        on_backfill=on_backfill,
        on_assignment_exam=on_assignment_exam,
    )
    stats['exam_assignment_events_created'] = assignment_stats['created']
    stats['dates_backfilled_from_assignments'] = assignment_stats['backfilled']

    stats['duplicates_merged'] = merge_duplicate_test_events(event_nodes, update_event_fn)

    material_stats = apply_study_material_heuristics(
        courseid,
        file_nodes,
        event_nodes,
        graph_edges,
        set_file_type_fn,
        find_event_fn,
        add_exam_fn=add_exam_fn,
    )
    stats['study_materials_typed'] = material_stats['typed']
    stats['study_materials_linked'] = material_stats['linked']
    stats['events_inferred_from_materials'] = material_stats.get('created', 0)
    return stats


MODULE_MATCH_STOPWORDS = {
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is', 'it',
    'module', 'materials', 'material', 'content', 'items', 'resources', 'the', 'this', 'to',
    'with', 'week', 'class', 'course', 'canvas',
}

MODULE_MATCH_THRESHOLD = 0.75


def _module_event_tokens(text):
    return {
        token
        for token in re.findall(r'[a-z0-9]+', str(text or '').casefold())
        if token and token not in MODULE_MATCH_STOPWORDS
    }


def score_module_event_match(module_name, event_name, event_type=''):
    module_text = str(module_name or '').casefold().strip()
    event_text = str(event_name or '').casefold().strip()
    if not module_text or not event_text:
        return 0.0

    if event_names_match(module_name, event_name):
        return 1.0

    module_week = WEEK_NUMBER_PATTERN.search(module_text)
    event_week = WEEK_NUMBER_PATTERN.search(event_text)
    if module_week and event_week and module_week.group(1) == event_week.group(1):
        return 0.9

    if QUIZZES_EXAMS_MODULE_PATTERN.search(module_text):
        if normalize_event_type(event_type, event_name) == 'test':
            return 0.85

    module_canonical = canonical_test_event_name(module_name)
    event_canonical = canonical_test_event_name(event_name, event_type)
    if module_canonical and event_canonical and module_canonical.casefold() == event_canonical.casefold():
        return 0.95

    if 'review session' in module_text and normalize_event_type(event_type, event_name) in {'test', 'review'}:
        module_target = infer_event_target_from_filename(module_name) or CANONICAL_TEST_EVENT_NAMES['midterm']
        event_target = canonical_test_event_name(event_name, event_type)
        if module_target and event_target and module_target.casefold() == event_target.casefold():
            return 0.9

    if 'review' in module_text and normalize_event_type(event_type, event_name) in {'test', 'review'}:
        module_target = infer_event_target_from_filename(module_name)
        event_target = canonical_test_event_name(event_name, event_type)
        if module_target and event_target and module_target.casefold() == event_target.casefold():
            return 0.9

    module_tokens = _module_event_tokens(module_text)
    event_tokens = _module_event_tokens(event_text)
    if module_tokens and event_tokens:
        overlap = module_tokens & event_tokens
        if overlap:
            score = len(overlap) / max(len(module_tokens), len(event_tokens))
            if overlap & {'midterm', 'final', 'exam', 'quiz', 'test', 'review'}:
                return max(score, 0.8)
            if score >= 0.5:
                return score

    if module_text in event_text or event_text in module_text:
        return 0.8

    return 0.0


def find_best_event_for_module(module_name, events):
    best_event = None
    best_score = 0.0
    for event in events or []:
        event_name = getattr(event, 'name', '') if not isinstance(event, dict) else event.get('name', '')
        event_type = getattr(event, 'type', '') if not isinstance(event, dict) else event.get('type', '')
        score = score_module_event_match(module_name, event_name, event_type)
        if score > best_score:
            best_score = score
            best_event = event
    if best_score >= MODULE_MATCH_THRESHOLD:
        return best_event, best_score
    return None, best_score


def _group_module_items(module_order_hints):
    grouped = {}
    for item_id, hint in (module_order_hints or {}).items():
        if not isinstance(hint, dict):
            continue
        module_id = str(hint.get('moduleId') or '').strip()
        if not module_id:
            continue
        grouped.setdefault(module_id, []).append((str(item_id), hint))
    return grouped


def _resolve_module_file_id(file_nodes, content_id, item_id):
    content_id = str(content_id or '').strip()
    item_id = str(item_id or '').strip()
    if content_id and content_id in file_nodes:
        return content_id
    if item_id and item_id in file_nodes:
        return item_id
    for file_id, file_node in (file_nodes or {}).items():
        node_id = getattr(file_node, 'fileid', '') if not isinstance(file_node, dict) else file_node.get('fileid', '')
        if str(node_id) in {content_id, item_id}:
            return str(file_id)
    return content_id or item_id


def link_module_item_to_event(graph_edges, event_id, target_type, target_id, module_id='', module_name='', item_type='', source='module-heuristic', metadata=None):
    if not event_id or not target_id:
        return False
    relation = 'requires_reading' if target_type == 'file' else 'requires'
    edge_metadata = {
        'moduleId': module_id,
        'moduleName': module_name,
        'itemType': item_type,
        **(metadata or {}),
    }
    return graph_edges.add_edge(
        'event',
        event_id,
        target_type,
        target_id,
        relation,
        confidence=0.85,
        source=source,
        metadata=edge_metadata,
    )


def link_module_items_to_events(
    courseid,
    course_modules,
    module_order_hints,
    event_nodes,
    file_nodes,
    graph_edges,
    find_assignment_fn,
):
    stats = {
        'modules_matched': 0,
        'module_items_linked': 0,
        'module_files_linked': 0,
        'module_assignments_linked': 0,
    }
    if not course_modules or not event_nodes:
        return stats

    items_by_module = _group_module_items(module_order_hints)

    for module_id, module in (course_modules or {}).items():
        module_name = ''
        if isinstance(module, dict):
            module_name = str(module.get('name') or '').strip()
        else:
            module_name = str(module or '').strip()
        if not module_name:
            continue

        matched_event, score = find_best_event_for_module(module_name, event_nodes)
        if not matched_event:
            continue

        stats['modules_matched'] += 1
        event_id = getattr(matched_event, 'eventid', '') if not isinstance(matched_event, dict) else matched_event.get('eventid', '')
        event_name = getattr(matched_event, 'name', '') if not isinstance(matched_event, dict) else matched_event.get('name', '')

        for item_id, hint in items_by_module.get(str(module_id), []):
            item_type = str(hint.get('itemType') or '').casefold()
            content_id = str(hint.get('contentId') or item_id or '').strip()
            if not content_id:
                continue

            if item_type in {'file', 'page'}:
                file_id = _resolve_module_file_id(file_nodes, content_id, item_id)
                if not file_id:
                    continue
                if link_module_item_to_event(
                    graph_edges,
                    event_id,
                    'file',
                    file_id,
                    module_id=str(module_id),
                    module_name=module_name,
                    item_type=item_type,
                    metadata={'matchScore': score, 'eventName': event_name},
                ):
                    stats['module_items_linked'] += 1
                    stats['module_files_linked'] += 1
                continue

            if item_type == 'assignment' and find_assignment_fn:
                assignment = find_assignment_fn(courseid, canvasAssignmentId=content_id)
                if not assignment:
                    assignment = find_assignment_fn(courseid, assignmentNodeId=content_id)
                if not assignment:
                    assignment = find_assignment_fn(courseid, canvasAssignmentId=item_id)
                if not assignment:
                    assignment = find_assignment_fn(courseid, assignmentNodeId=item_id)
                if not assignment:
                    continue
                assignment_id = getattr(assignment, 'assignmentid', '') if not isinstance(assignment, dict) else assignment.get('assignmentid', '')
                if not assignment_id:
                    continue
                if link_module_item_to_event(
                    graph_edges,
                    event_id,
                    'assignment',
                    assignment_id,
                    module_id=str(module_id),
                    module_name=module_name,
                    item_type=item_type,
                    metadata={'matchScore': score, 'eventName': event_name},
                ):
                    stats['module_items_linked'] += 1
                    stats['module_assignments_linked'] += 1

    return stats


def backfill_course_modules_from_hints(course_modules, module_order_hints):
    modules = dict(course_modules or {})
    for hint in (module_order_hints or {}).values():
        if not isinstance(hint, dict):
            continue
        module_id = str(hint.get('moduleId') or '').strip()
        module_name = str(hint.get('moduleName') or '').strip()
        if not module_id:
            continue
        existing = modules.get(module_id, {})
        if not isinstance(existing, dict):
            existing = {'moduleId': module_id, 'name': str(existing or '').strip()}
        modules[module_id] = {
            'moduleId': module_id,
            'name': module_name or existing.get('name', ''),
            'position': int(existing.get('position', hint.get('position', 0) or 0)),
        }
    return modules


def create_events_from_exam_assignments(
    courseid,
    event_nodes,
    add_exam_fn,
    find_event_fn,
    get_assignments_fn=None,
    normalize_date_fn=None,
    on_backfill=None,
    on_assignment_exam=None,
):
    created = 0
    backfilled = 0
    assignments = get_assignments_fn(courseid) if get_assignments_fn else []
    for assignment in assignments or []:
        name = getattr(assignment, 'name', '') if not isinstance(assignment, dict) else assignment.get('name', '')
        if not str(name or '').strip():
            continue
        if NON_TEST_FINAL_PATTERN.search(str(name)):
            if on_assignment_exam:
                on_assignment_exam(courseid, name, '', '', 'skipped_non_exam_final')
            continue
        if normalize_event_type('', name) != 'test':
            if on_assignment_exam:
                on_assignment_exam(courseid, name, '', '', 'skipped_not_test')
            continue
        canonical = canonical_test_event_name(name)
        if not canonical:
            if on_assignment_exam:
                on_assignment_exam(courseid, name, '', '', 'skipped_no_canonical')
            continue
        existing = find_best_event_for_target(event_nodes, canonical)
        if not existing and find_event_fn:
            existing = find_event_fn(courseid, eventname=canonical)
        duedate = getattr(assignment, 'duedate', '') if not isinstance(assignment, dict) else assignment.get('duedate', '')
        unlockdate = getattr(assignment, 'unlockdate', '') if not isinstance(assignment, dict) else assignment.get('unlockdate', '')
        gradepercentage = getattr(assignment, 'gradepercentage', '') if not isinstance(assignment, dict) else assignment.get('gradepercentage', '')
        startdate = duedate or unlockdate
        if normalize_date_fn:
            startdate = normalize_date_fn(startdate) or startdate
        if existing:
            existing_start = _event_field(existing, 'startdate', '')
            if startdate and backfill_event_date(existing, startdate, normalize_date_fn=normalize_date_fn):
                backfilled += 1
                action = 'backfilled'
                if on_backfill:
                    on_backfill(
                        courseid,
                        _event_field(existing, 'name', canonical),
                        _event_field(existing, 'startdate', startdate),
                        'assignment',
                    )
            elif is_schedulable_date(existing_start):
                action = 'skipped_already_dated'
            elif not startdate:
                action = 'skipped_no_assignment_date'
            elif not is_schedulable_date(startdate):
                action = 'skipped_unparseable_date'
            else:
                action = 'skipped_no_backfill'
            if on_assignment_exam:
                on_assignment_exam(courseid, name, canonical, startdate, action)
            continue
        action = 'created' if is_schedulable_date(startdate) else 'created_undated'
        if on_assignment_exam:
            on_assignment_exam(courseid, name, canonical, startdate, action)
        add_exam_fn(
            courseid,
            canonical,
            startdate,
            '',
            gradepercentage,
            f'Inferred from assignment: {name}',
            [],
        )
        created += 1
        if find_event_fn:
            event = find_event_fn(courseid, eventname=canonical)
            if event and event not in (event_nodes or []):
                event_nodes.append(event)
    return {'created': created, 'backfilled': backfilled}
