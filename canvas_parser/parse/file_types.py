"""Academic file-type taxonomy, heuristics, and pass routing for the Canvas parser."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Literal

from canvas_parser.graph.events import (
    classify_study_material_filename,
    infer_event_target_from_filename,
    is_past_exam_filename,
)
from canvas_parser.parse.type_logs import (
    extra_tool_names_for_type,
    type_specific_pass1_instructions,
)

SNIPPET_MAX_CHARS = int(os.getenv('PARSER_CLASSIFY_SNIPPET_CHARS', '2800'))
FORCE_LLM_CLASSIFY = os.getenv('PARSER_FORCE_LLM_CLASSIFY', '0').strip().casefold() in {'1', 'true', 'on', 'yes'}
HEURISTIC_CONFIDENCE_THRESHOLD = float(os.getenv('PARSER_CLASSIFY_HEURISTIC_THRESHOLD', '0.82'))

KeywordMode = Literal['off', 'auto', 'always']
NodeFiletype = Literal['content', 'study_material', 'assignment']

ALL_FILE_TYPE_IDS = (
    'syllabus',
    'assignment_sheet',
    'past_exam',
    'exam_solution',
    'review_sheet',
    'lecture_slides',
    'lecture_notes',
    'textbook_chapter',
    'research_article',
    'literary_work',
    'humanities_reading',
    'problem_set',
    'lab_handout',
    'reference_sheet',
    'administrative',
    'discussion_prompt',
    'code_technical',
    'generic_content',
)

CLASSIFY_TYPE_DESCRIPTIONS = {
    'syllabus': 'Course syllabus: schedule, grading, policies, assignment list, exam dates.',
    'assignment_sheet': 'Homework/problem-set handout with tasks due for submission.',
    'past_exam': 'Past or current exam paper, test, quiz sheet (often with honor code header).',
    'exam_solution': 'Answer key, worked solutions, or grading rubric for an exam.',
    'review_sheet': 'Exam review, drill, or study guide tied to a test (not the exam itself).',
    'lecture_slides': 'Slide deck: short bullets, lecture N, chapter headings, figures.',
    'lecture_notes': 'Prose lecture notes or handout explaining course material (not slides).',
    'textbook_chapter': 'Textbook section/chapter reading assigned for class.',
    'research_article': 'Peer-reviewed journal article or preprint (abstract, methods, results).',
    'literary_work': 'Fiction, poetry, drama, or primary literary text — not STEM teaching.',
    'humanities_reading': 'Non-fiction essay, philosophy, history, or cultural reading (not lab STEM).',
    'problem_set': 'Problem set / worksheet focused on exercises (PS, HW, pset).',
    'lab_handout': 'Lab manual, protocol, pre-lab, or experiment instructions.',
    'reference_sheet': 'Formula sheet, periodic table appendix, notation reference (no teaching narrative).',
    'administrative': 'Orientation, logistics, course selection, policy — no course content.',
    'discussion_prompt': 'Seminar/precept discussion questions or response prompts.',
    'code_technical': 'Code listing, API doc, algorithm writeup, technical spec with code blocks.',
    'generic_content': 'Fallback when no other type fits.',
}


PASS1_TOOL_NAMES = (
    'get_all_assignment_names',
    'get_assignmentid_by_name',
    'add_concept_node',
    'add_syllabus',
    'add_file_node',
    'add_assignment_node',
    'add_event_node',
    'add_exam_node',
    'log_detail',
    'log_example',
    'log_problem',
    'log_assignment',
    'log_event',
    'log_external_resource',
    'log_concept_prerequisite',
)


@dataclass(frozen=True)
class FileTypeProfile:
    type_id: str
    label: str
    extract_concepts: bool = True
    extract_problems: bool = True
    extract_events: bool = True
    link_to_events: bool = False
    pass2: bool = True
    teaching_outline: bool = True
    keyword_extract: KeywordMode = 'auto'
    node_filetype: NodeFiletype = 'content'
    pass1_instructions: str = ''
    pass1_tool_blocklist: tuple[str, ...] = ()
    doc_path: str = ''


def _profile(**kwargs) -> FileTypeProfile:
    type_id = kwargs['type_id']
    return FileTypeProfile(
        doc_path=f'docs/parser_file_types/{type_id}.md',
        **kwargs,
    )


FILE_TYPE_PROFILES: dict[str, FileTypeProfile] = {
    'syllabus': _profile(
        type_id='syllabus',
        label='Course syllabus',
        extract_concepts=False,
        extract_problems=False,
        extract_events=True,
        pass2=False,
        teaching_outline=False,
        keyword_extract='off',
        node_filetype='content',
        pass1_tool_blocklist=('add_concept_node', 'log_detail', 'log_example', 'log_problem', 'log_concept_prerequisite'),
        pass1_instructions=(
            'This file is a SYLLABUS. Call add_syllabus, add_assignment_node, add_exam_node/add_event_node, '
            'AND log_syllabus_week for each schedule row, log_syllabus_policy for policies, '
            'log_syllabus_textbook for required texts. Do NOT extract teaching concepts.'
        ),
    ),
    'assignment_sheet': _profile(
        type_id='assignment_sheet',
        label='Assignment / homework sheet',
        extract_concepts=False,
        extract_problems=True,
        extract_events=False,
        pass2=False,
        pass1_tool_blocklist=('add_concept_node', 'log_detail', 'log_example', 'log_concept_prerequisite', 'add_syllabus'),
        pass1_instructions=(
            'This is an ASSIGNMENT SHEET. Call add_assignment_node and log_problem for each task in this pass. '
            'Put referenced file names in lookingfor/filechildren. Do not build a concept map.'
        ),
    ),
    'past_exam': _profile(
        type_id='past_exam',
        label='Past / current exam paper',
        extract_concepts=False,
        extract_problems=False,
        extract_events=True,
        link_to_events=True,
        pass2=False,
        teaching_outline=False,
        keyword_extract='auto',
        node_filetype='study_material',
        pass1_tool_blocklist=(
            'add_concept_node', 'log_detail', 'log_example', 'log_problem',
            'log_concept_prerequisite', 'add_syllabus', 'add_learning_block',
        ),
        pass1_instructions=(
            'This is an EXAM PAPER. Call add_file_node with filetype=study_material. '
            'link_file_to_event to Midterm/Final/Quiz/Exam using dates or filename. '
            'Do NOT extract concepts or teaching blocks from exam questions.'
        ),
    ),
    'exam_solution': _profile(
        type_id='exam_solution',
        label='Exam solutions / answer key',
        extract_concepts=False,
        extract_problems=False,
        extract_events=False,
        link_to_events=True,
        pass2=False,
        teaching_outline=False,
        keyword_extract='off',
        node_filetype='study_material',
        pass1_tool_blocklist=(
            'add_concept_node', 'log_detail', 'log_example', 'log_problem',
            'log_concept_prerequisite', 'add_syllabus',
        ),
        pass1_instructions=(
            'This is an EXAM SOLUTION or ANSWER KEY. add_file_node(filetype=study_material) and '
            'link_file_to_event when the parent exam is identifiable. No concept extraction.'
        ),
    ),
    'review_sheet': _profile(
        type_id='review_sheet',
        label='Review / study guide',
        extract_concepts=True,
        extract_problems=True,
        extract_events=False,
        link_to_events=True,
        pass2=False,
        keyword_extract='auto',
        node_filetype='study_material',
        pass1_instructions=(
            'This is REVIEW/STUDY material for an exam. add_file_node(filetype=study_material), '
            'link_file_to_event, and extract key topics with add_concept_node and log_detail in this pass — '
            'complete lightweight concept extraction without deferring to pass 2.'
        ),
    ),
    'lecture_slides': _profile(
        type_id='lecture_slides',
        label='Lecture slides',
        extract_concepts=True,
        extract_problems=True,
        extract_events=False,
        pass2=False,
        teaching_outline=True,
        keyword_extract='auto',
        pass1_tool_blocklist=('add_concept_node', 'log_detail', 'log_example', 'log_concept_prerequisite'),
        pass1_instructions=(
            'This is LECTURE SLIDES. Complete extraction in pass 1 using type-specific tools only: '
            'log_lecture_slide for every slide (slideOrder, title, summary), log_lecture_objective for objectives, '
            'log_lecture_key_term for on-slide definitions, and log_problem for exercises. '
            'Do not use add_concept_node or log_detail — slide promote builds concepts from log_lecture_slide rows.'
        ),
    ),
    'lecture_notes': _profile(
        type_id='lecture_notes',
        label='Lecture notes (prose)',
        extract_concepts=True,
        extract_problems=True,
        pass2=False,
        teaching_outline=True,
        keyword_extract='auto',
        pass1_tool_blocklist=('add_concept_node', 'log_detail', 'log_example', 'log_concept_prerequisite'),
        pass1_instructions=(
            'This is LECTURE NOTES. Log each major section with log_lecture_slide (slideOrder = section index), '
            'log_lecture_objective and log_lecture_key_term when present, and log_problem for exercises — '
            'all in pass 1. Do not defer with add_concept_node or log_detail.'
        ),
    ),
    'textbook_chapter': _profile(
        type_id='textbook_chapter',
        label='Textbook chapter',
        extract_concepts=True,
        extract_problems=True,
        pass2=False,
        teaching_outline=True,
        keyword_extract='auto',
        pass1_tool_blocklist=('add_concept_node', 'log_detail', 'log_example', 'log_concept_prerequisite'),
        pass1_instructions=(
            'This is a TEXTBOOK CHAPTER. Use log_textbook_section for each section, '
            'log_textbook_definition and log_textbook_theorem for formal items, and log_problem for exercises — '
            'complete in pass 1. Do not defer with add_concept_node or log_detail.'
        ),
    ),
    'research_article': _profile(
        type_id='research_article',
        label='Research article',
        extract_concepts=True,
        extract_problems=False,
        extract_events=False,
        pass2=False,
        teaching_outline=False,
        keyword_extract='auto',
        pass1_tool_blocklist=('log_problem', 'add_concept_node', 'log_detail', 'log_example'),
        pass1_instructions=(
            'This is a RESEARCH ARTICLE. add_file_node first. Use log_article_claim, log_article_method, '
            'log_article_result, log_article_figure, log_article_finding, and log_article_key_term '
            'for structured article metadata in pass 1. Skip bibliographic boilerplate.'
        ),
    ),
    'literary_work': _profile(
        type_id='literary_work',
        label='Literary work',
        extract_concepts=False,
        extract_problems=False,
        extract_events=False,
        pass2=False,
        teaching_outline=False,
        keyword_extract='off',
        pass1_tool_blocklist=(
            'add_concept_node', 'log_detail', 'log_example', 'log_problem',
            'log_concept_prerequisite', 'add_learning_block', 'add_syllabus',
        ),
        pass1_instructions=(
            'This is a LITERARY WORK (fiction/poetry/drama). Call add_file_node(filetype=content) first. '
            'Then extract story-specific metadata with log_literary_* tools only — characters, themes, '
            'in-story plot events, settings, and symbols. Do NOT use add_concept_node, log_detail, log_event, '
            'or course exam tools.'
        ),
    ),
    'humanities_reading': _profile(
        type_id='humanities_reading',
        label='Humanities reading',
        extract_concepts=False,
        extract_problems=False,
        extract_events=False,
        pass2=False,
        teaching_outline=False,
        keyword_extract='auto',
        pass1_tool_blocklist=(
            'add_concept_node', 'log_detail', 'log_example', 'log_problem',
            'log_concept_prerequisite', 'add_learning_block', 'log_event', 'add_exam_node',
        ),
        pass1_instructions=(
            'This is a HUMANITIES READING. Log log_reading_section for each major section (ordered), '
            'log_reading_thesis, log_reading_argument, log_reading_key_term. No STEM concept graph.'
        ),
    ),
    'problem_set': _profile(
        type_id='problem_set',
        label='Problem set / worksheet',
        extract_concepts=False,
        extract_problems=True,
        extract_events=False,
        pass2=False,
        teaching_outline=False,
        pass1_tool_blocklist=('add_concept_node', 'log_detail', 'log_example', 'log_concept_prerequisite', 'add_syllabus'),
        pass1_instructions=(
            'This is a PROBLEM SET. log_problem for every question with steps/answer when shown — complete in pass 1. '
            'add_assignment_node if it maps to a named assignment. Minimal or no concept nodes.'
        ),
    ),
    'lab_handout': _profile(
        type_id='lab_handout',
        label='Lab handout',
        extract_concepts=True,
        extract_problems=True,
        extract_events=False,
        pass2=False,
        pass1_instructions=(
            'This is a LAB HANDOUT. add_concept_node for equipment/safety topics; '
            'log_detail for protocol steps; log_problem for analysis questions — all in pass 1.'
        ),
    ),
    'reference_sheet': _profile(
        type_id='reference_sheet',
        label='Reference / formula sheet',
        extract_concepts=False,
        extract_problems=False,
        extract_events=False,
        pass2=False,
        teaching_outline=False,
        keyword_extract='off',
        node_filetype='study_material',
        pass1_tool_blocklist=(
            'add_concept_node', 'log_detail', 'log_example', 'log_problem',
            'log_concept_prerequisite', 'add_learning_block', 'add_syllabus',
        ),
        pass1_instructions=(
            'This is a REFERENCE SHEET (formulas, tables). add_file_node(filetype=study_material) only. '
            'No concept extraction.'
        ),
    ),
    'administrative': _profile(
        type_id='administrative',
        label='Administrative / orientation',
        extract_concepts=False,
        extract_problems=False,
        extract_events=True,
        pass2=False,
        teaching_outline=False,
        keyword_extract='off',
        pass1_tool_blocklist=(
            'add_concept_node', 'log_detail', 'log_example', 'log_problem',
            'log_concept_prerequisite', 'add_learning_block',
        ),
        pass1_instructions=(
            'This is ADMINISTRATIVE (orientation, logistics, course selection). add_file_node only. '
            'log_event only for dated orientation sessions if explicit.'
        ),
    ),
    'discussion_prompt': _profile(
        type_id='discussion_prompt',
        label='Discussion / seminar prompt',
        extract_concepts=False,
        extract_problems=False,
        extract_events=False,
        pass2=False,
        teaching_outline=False,
        keyword_extract='auto',
        pass1_tool_blocklist=(
            'add_concept_node', 'log_example', 'log_problem',
            'log_concept_prerequisite', 'add_learning_block', 'log_event',
        ),
        pass1_instructions=(
            'This is a DISCUSSION PROMPT. add_file_node first, then log_discussion_question for each prompt. '
            'Optional log_reading_key_term for defined readings vocabulary.'
        ),
    ),
    'code_technical': _profile(
        type_id='code_technical',
        label='Code / technical document',
        extract_concepts=True,
        extract_problems=True,
        pass2=False,
        teaching_outline=True,
        keyword_extract='auto',
        pass1_instructions=(
            'This is CODE/TECHNICAL material. add_concept_node for APIs/algorithms; log_example for code samples; '
            'log_problem for exercises — complete in pass 1. Preserve function/class names from the text.'
        ),
    ),
    'generic_content': _profile(
        type_id='generic_content',
        label='Generic content',
        extract_concepts=True,
        extract_problems=True,
        pass2=False,
        teaching_outline=False,
        keyword_extract='auto',
        pass1_instructions=(
            'Unclassified file — use default teaching extraction rules conservatively in a single pass. '
            'Prefer add_concept_node and log_detail in pass 1; do not defer detail extraction.'
        ),
    ),
}

SYLLABUS_PATTERN = re.compile(r'\bsyllabus\b|\bgrading\b.*\bpercent\b|\bcourse policies\b', re.I)
EXAM_HEADER_PATTERN = re.compile(
    r'your name:.*precept|honor code pledge|closed book.*exam|this is a .{0,20}exam',
    re.I | re.S,
)
ANSWER_KEY_PATTERN = re.compile(r'answer key|solution manual|worked solutions|grading rubric', re.I)
LECTURE_SLIDE_PATTERN = re.compile(r'\blecture\s*\d|\bslides?\b|^\s*[-•●]\s', re.I | re.M)
LITERARY_PATTERN = re.compile(
    r'\bchapter\s+(one|two|iii|1)\b|\b(?:novel|poem|stanza|act\s+[ivx]+)\b|said\s+\w+[,.]',
    re.I,
)
RESEARCH_PATTERN = re.compile(r'\babstract\b.*\b(introduction|methods|results)\b|\bdoi:\s*10\.|\barxiv:', re.I | re.S)
ADMIN_PATTERN = re.compile(r'orientation workshop|course selection|prospective.*major|logistics', re.I)
PS_PATTERN = re.compile(r'\bproblem set\b|\bpset\b|\b(?:hw|homework)\s*\d|\bworksheet\b', re.I)
LAB_PATTERN = re.compile(r'\blab\s*(?:manual|protocol|handout|report)\b|\bpre-?lab\b', re.I)
CODE_PATTERN = re.compile(r'\b(?:def |class |#include|public static void|function\s+\w+\()', re.I)
DISCUSSION_PATTERN = re.compile(r'discussion question|response paper|precept prompt|write a short essay', re.I)
AUTHOR_TITLE_FILENAME = re.compile(
    r"^[\w\s\u0080-\uFFFF'’.-]+,\s+[\w\s\u0080-\uFFFF'’:\-().]+\.(?:pdf|docx?|txt)$",
    re.I,
)
AUTHOR_DASH_TITLE_FILENAME = re.compile(
    r"^[\w\s\u0080-\uFFFF'’.-]{2,}\s+-\s+.+",
    re.I,
)
CHAPTER_READING_FILENAME = re.compile(r',\s*(?:chapter|ch\.?)\s*\d+', re.I)
READING_FILENAME_PATTERN = re.compile(r'\b(?:reading|readings|article|essay|seminar)\b', re.I)
AUTHOR_YEAR_FILENAME = re.compile(r"^[A-Za-z][A-Za-z\-']+_\d{4}(?:\.[A-Za-z0-9]+)?$", re.I)
PREFIXED_AUTHOR_YEAR_FILENAME = re.compile(
    r"^[A-Za-z]+\d*_[A-Za-z][A-Za-z\-']+_\d{4}(?:\.[A-Za-z0-9]+)?$",
    re.I,
)
QUIZ_FILENAME_PATTERN = re.compile(r'\b(?:quiz|q\d+)\b', re.I)
Q_NUMBER_YEAR_FILENAME = re.compile(r'\bQ\d+\b.*\b20\d{2}\b', re.I)
EXAMPLE_EXAM_FILENAME = re.compile(r'\bexample[_\s-]*exam', re.I)
EXPLAINER_FILENAME_PATTERN = re.compile(r'\b(?:explained|explainer|overview)\b', re.I)
PROBLEM_SET_FILENAME = re.compile(r'\bproblem\s*set\b', re.I)
PS_ANSWER_KEY_FILENAME = re.compile(
    r'\bproblem\s*set\b.*\bkey\b|\bkey\b.*\bproblem\s*set\b',
    re.I,
)
STUDY_TIPS_FILENAME = re.compile(
    r'\bhow to do well\b|\bstudy tips\b|\bcourse logistics\b',
    re.I,
)
SCREENSHOT_FILENAME = re.compile(r'\bscreenshot\b', re.I)
SLIDE_FILENAME_PATTERN = re.compile(
    r'\b(?:lecture|lec)\s*\d|[_\s-]slides?\b|\bprecepts?_\d+_lecture\b',
    re.I,
)
COURSE_TOPIC_FILENAME = re.compile(r'^[A-Z]{2,4}\d{2,3}_[A-Za-z]', re.I)
GRADE_CURVE_PATTERN = re.compile(r'\bgrade\s*curves?\b|\bgrading\s*curves?\b', re.I)
PRECEPT_LINK_FILENAME = re.compile(r'\bprecept', re.I)


def build_classification_snippet(*, pages=None, prompt_text='', max_chars=None):
    max_chars = SNIPPET_MAX_CHARS if max_chars is None else max_chars
    if pages:
        chunks = []
        total = 0
        for page in pages:
            header = (
                f"[[PAGE {page.get('pageNumber')} | pageid={page.get('pageid')}]]"
            )
            body = str(page.get('text') or '').strip()
            piece = f"{header}\n{body}".strip()
            if total + len(piece) > max_chars:
                remaining = max_chars - total
                if remaining > 200:
                    chunks.append(piece[:remaining])
                break
            chunks.append(piece)
            total += len(piece) + 2
            if total >= max_chars:
                break
        return '\n\n'.join(chunks)
    text = str(prompt_text or '').strip()
    return text[:max_chars]


def heuristic_classify(*, filename='', snippet='', pages=None):
    name = str(filename or '')
    text = str(snippet or '')
    combined = f'{name}\n{text}'.casefold()

    study = classify_study_material_filename(name)
    if study and study.get('is_past_exam') and EXAM_HEADER_PATTERN.search(text):
        return 'past_exam', 0.92
    if study and ANSWER_KEY_PATTERN.search(name):
        return 'exam_solution', 0.9
    if study and study.get('is_review_material'):
        return 'review_sheet', 0.88
    if study and EXAM_HEADER_PATTERN.search(text):
        return 'past_exam', 0.85

    if PS_ANSWER_KEY_FILENAME.search(name):
        return 'exam_solution', 0.9
    if PROBLEM_SET_FILENAME.search(name):
        return 'problem_set', 0.9
    if STUDY_TIPS_FILENAME.search(name):
        return 'administrative', 0.86
    if SCREENSHOT_FILENAME.search(name):
        return 'administrative', 0.85

    filename_suggests_slides = bool(SLIDE_FILENAME_PATTERN.search(name))
    if not filename_suggests_slides and SYLLABUS_PATTERN.search(combined) and 'syllabus' in combined:
        return 'syllabus', 0.9

    scores: dict[str, float] = {}
    if EXAM_HEADER_PATTERN.search(text):
        scores['past_exam'] = 0.8
    if ANSWER_KEY_PATTERN.search(combined):
        scores['exam_solution'] = 0.85
    if LECTURE_SLIDE_PATTERN.search(combined):
        scores['lecture_slides'] = 0.75
    if PS_PATTERN.search(combined):
        scores['problem_set'] = 0.8
    if LAB_PATTERN.search(combined):
        scores['lab_handout'] = 0.78
    if RESEARCH_PATTERN.search(text):
        scores['research_article'] = 0.82
    if LITERARY_PATTERN.search(text) and not re.search(r'\b(?:theorem|equation|matrix|reaction)\b', text, re.I):
        scores['literary_work'] = 0.7
    if ADMIN_PATTERN.search(combined):
        scores['administrative'] = 0.85
    if DISCUSSION_PATTERN.search(combined):
        scores['discussion_prompt'] = 0.75
    if CODE_PATTERN.search(text):
        scores['code_technical'] = 0.72
    if re.search(r'\bchapter\s+\d+\b', combined) and re.search(r'\b(reading|textbook|pp?\.\s*\d)', combined):
        scores['textbook_chapter'] = 0.68

    if 'lecture' in combined and 'slide' in combined:
        scores['lecture_slides'] = max(scores.get('lecture_slides', 0), 0.88)
    if filename_suggests_slides:
        scores['lecture_slides'] = max(scores.get('lecture_slides', 0), 0.92)
    if 'lecture' in combined and 'notes' in combined:
        scores['lecture_notes'] = 0.8
    if re.search(r'\bformula sheet\b|\bperiodic table\b|\bconstants\b.*\battached\b', combined):
        scores['reference_sheet'] = 0.8
    if GRADE_CURVE_PATTERN.search(combined):
        scores['administrative'] = max(scores.get('administrative', 0), 0.88)
    if EXPLAINER_FILENAME_PATTERN.search(name):
        scores['lecture_notes'] = max(scores.get('lecture_notes', 0), 0.72)

    filename_stripped = name.strip()
    if AUTHOR_YEAR_FILENAME.match(filename_stripped):
        scores['research_article'] = max(scores.get('research_article', 0), 0.86)
    if PREFIXED_AUTHOR_YEAR_FILENAME.match(filename_stripped):
        scores['research_article'] = max(scores.get('research_article', 0), 0.86)
    if EXAMPLE_EXAM_FILENAME.search(name):
        scores['exam_solution'] = max(scores.get('exam_solution', 0), 0.88)
    if QUIZ_FILENAME_PATTERN.search(name) and infer_event_target_from_filename(name):
        scores['past_exam'] = max(scores.get('past_exam', 0), 0.84)
    if Q_NUMBER_YEAR_FILENAME.search(name):
        scores['past_exam'] = max(scores.get('past_exam', 0), 0.83)
    if COURSE_TOPIC_FILENAME.match(filename_stripped):
        scores['lecture_slides'] = max(scores.get('lecture_slides', 0), 0.84)
    name_for_ps = re.sub(r'[_-]+', ' ', name)
    if PRECEPT_LINK_FILENAME.search(name):
        if PS_PATTERN.search(name_for_ps):
            scores['problem_set'] = max(scores.get('problem_set', 0), 0.86)
        else:
            scores['discussion_prompt'] = max(scores.get('discussion_prompt', 0), 0.82)
    if AUTHOR_TITLE_FILENAME.match(filename_stripped):
        scores['humanities_reading'] = max(scores.get('humanities_reading', 0), 0.86)
    elif AUTHOR_DASH_TITLE_FILENAME.match(filename_stripped):
        scores['humanities_reading'] = max(scores.get('humanities_reading', 0), 0.85)
    elif CHAPTER_READING_FILENAME.search(filename_stripped) and ',' in filename_stripped:
        scores['humanities_reading'] = max(scores.get('humanities_reading', 0), 0.84)
    elif READING_FILENAME_PATTERN.search(filename_stripped) and not LECTURE_SLIDE_PATTERN.search(filename_stripped):
        scores['humanities_reading'] = max(scores.get('humanities_reading', 0), 0.80)

    if not scores:
        return 'generic_content', 0.35

    best_type = max(scores, key=scores.get)
    return best_type, scores[best_type]


def normalize_file_type_id(type_id):
    raw = str(type_id or '').strip().casefold().replace('-', '_').replace(' ', '_')
    aliases = {
        'exam': 'past_exam',
        'exam_paper': 'past_exam',
        'answer_key': 'exam_solution',
        'study_guide': 'review_sheet',
        'slides': 'lecture_slides',
        'homework': 'assignment_sheet',
        'pset': 'problem_set',
        'reading': 'humanities_reading',
        'fiction': 'literary_work',
        'orientation': 'administrative',
    }
    raw = aliases.get(raw, raw)
    if raw in FILE_TYPE_PROFILES:
        return raw
    return 'generic_content'


def get_file_type_profile(type_id):
    return FILE_TYPE_PROFILES.get(normalize_file_type_id(type_id), FILE_TYPE_PROFILES['generic_content'])


def profile_skips_llm_pass1_for_cost(profile: FileTypeProfile) -> bool:
    """Link/file-node profiles where heuristic extract + finalize replaces pass1 (llm-cost)."""
    return not profile.extract_concepts and not profile.extract_problems


def resolve_file_type_profile(*, filename='', snippet='', pages=None, llm_type_id='', llm_confidence=0.0):
    heuristic_type, heuristic_conf = heuristic_classify(filename=filename, snippet=snippet, pages=pages)
    if llm_type_id:
        llm_type = normalize_file_type_id(llm_type_id)
        if llm_confidence >= heuristic_conf or heuristic_conf < HEURISTIC_CONFIDENCE_THRESHOLD:
            return get_file_type_profile(llm_type), llm_type, max(llm_confidence, heuristic_conf), 'llm'
    if heuristic_conf >= HEURISTIC_CONFIDENCE_THRESHOLD and not FORCE_LLM_CLASSIFY:
        return get_file_type_profile(heuristic_type), heuristic_type, heuristic_conf, 'heuristic'
    if llm_type_id:
        llm_type = normalize_file_type_id(llm_type_id)
        return get_file_type_profile(llm_type), llm_type, llm_confidence, 'llm'
    return get_file_type_profile(heuristic_type), heuristic_type, heuristic_conf, 'heuristic'


def should_run_llm_classification(heuristic_confidence, *, resolved_type=''):
    if FORCE_LLM_CLASSIFY:
        return True
    typed = normalize_file_type_id(str(resolved_type or ''))
    if typed and typed != 'generic_content' and heuristic_confidence >= 0.65:
        return False
    return heuristic_confidence < HEURISTIC_CONFIDENCE_THRESHOLD


def build_classify_system_prompt():
    lines = [
        'You classify academic course files from a filename and short text snippet.',
        'Call classify_course_file_type exactly once with the best type_id and confidence 0-1.',
        'Do not extract teaching content. Do not respond with free text.',
        '',
        'Allowed type_id values:',
    ]
    for type_id in ALL_FILE_TYPE_IDS:
        lines.append(f'- {type_id}: {CLASSIFY_TYPE_DESCRIPTIONS[type_id]}')
    return '\n'.join(lines)


def build_classify_user_message(*, filename, snippet, heuristic_type, heuristic_confidence):
    return (
        f'Filename: {filename or "unknown"}\n'
        f'Heuristic guess: {heuristic_type} (confidence {heuristic_confidence:.2f})\n\n'
        f'Text snippet (first pages only):\n{snippet}'
    )


def build_pass1_system_for_profile(base_system, profile: FileTypeProfile):
    type_block = type_specific_pass1_instructions(profile.type_id)
    parts = [
        base_system,
        '',
        f'FILE TYPE: {profile.label} ({profile.type_id})',
        profile.pass1_instructions,
    ]
    if type_block:
        parts.extend(['', type_block])
    return '\n'.join(parts)


def pass1_tool_names_for_profile(profile: FileTypeProfile):
    blocked = set(profile.pass1_tool_blocklist or ())
    names = [name for name in PASS1_TOOL_NAMES if name not in blocked]
    for extra in extra_tool_names_for_type(profile.type_id):
        if extra not in names:
            names.append(extra)
    return names


def profile_uses_keyword_extract(profile: FileTypeProfile):
    mode = profile.keyword_extract
    if mode == 'off':
        return False
    if mode == 'always':
        return True
    return True


CLASSIFY_COURSE_FILE_TYPE_TOOL = {
    'type': 'function',
    'function': {
        'name': 'classify_course_file_type',
        'description': 'Identify the academic file type from filename and snippet before extraction.',
        'parameters': {
            'type': 'object',
            'properties': {
                'type_id': {
                    'type': 'string',
                    'enum': list(ALL_FILE_TYPE_IDS),
                    'description': 'Best matching academic file type.',
                },
                'confidence': {
                    'type': 'number',
                    'description': 'Confidence from 0 to 1.',
                },
                'rationale': {
                    'type': 'string',
                    'description': 'One short sentence explaining the classification.',
                },
            },
            'required': ['type_id', 'confidence'],
            'additionalProperties': False,
        },
    },
}
