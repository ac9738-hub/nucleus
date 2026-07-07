"""Type-specific pass-1 log tools and handlers (literary, research, humanities, etc.)."""

from __future__ import annotations

TYPE_LOG_TOOL_PREFIX = 'log_type_'
LITERARY_LOG_PREFIX = 'log_literary_'
RESEARCH_LOG_PREFIX = 'log_article_'
HUMANITIES_LOG_PREFIX = 'log_reading_'
DISCUSSION_LOG_PREFIX = 'log_discussion_'
LECTURE_LOG_PREFIX = 'log_lecture_'
TEXTBOOK_LOG_PREFIX = 'log_textbook_'
SYLLABUS_LOG_PREFIX = 'log_syllabus_'

LITERARY_TOOL_NAMES = (
    'log_literary_character',
    'log_literary_theme',
    'log_literary_plot_event',
    'log_literary_setting',
    'log_literary_symbol',
)

RESEARCH_TOOL_NAMES = (
    'log_article_claim',
    'log_article_method',
    'log_article_finding',
    'log_article_key_term',
)

HUMANITIES_TOOL_NAMES = (
    'log_reading_thesis',
    'log_reading_argument',
    'log_reading_key_term',
    'log_reading_section',
)

DISCUSSION_TOOL_NAMES = (
    'log_discussion_question',
)

LECTURE_TOOL_NAMES = (
    'log_lecture_slide',
    'log_lecture_objective',
    'log_lecture_key_term',
)

TEXTBOOK_TOOL_NAMES = (
    'log_textbook_section',
    'log_textbook_definition',
    'log_textbook_theorem',
)

SYLLABUS_TOOL_NAMES = (
    'log_syllabus_week',
    'log_syllabus_policy',
    'log_syllabus_textbook',
)

TYPE_EXTRA_TOOLS_BY_FILE_TYPE = {
    'literary_work': LITERARY_TOOL_NAMES,
    'research_article': RESEARCH_TOOL_NAMES,
    'humanities_reading': HUMANITIES_TOOL_NAMES,
    'discussion_prompt': DISCUSSION_TOOL_NAMES,
    'lecture_slides': LECTURE_TOOL_NAMES,
    'lecture_notes': LECTURE_TOOL_NAMES,
    'textbook_chapter': TEXTBOOK_TOOL_NAMES,
    'syllabus': SYLLABUS_TOOL_NAMES,
}

TYPE_BUCKET_BY_TOOL = {
    'log_literary_character': ('literary', 'characters'),
    'log_literary_theme': ('literary', 'themes'),
    'log_literary_plot_event': ('literary', 'plot_events'),
    'log_literary_setting': ('literary', 'settings'),
    'log_literary_symbol': ('literary', 'symbols'),
    'log_article_claim': ('research', 'claims'),
    'log_article_method': ('research', 'methods'),
    'log_article_finding': ('research', 'findings'),
    'log_article_key_term': ('research', 'key_terms'),
    'log_reading_thesis': ('humanities', 'theses'),
    'log_reading_argument': ('humanities', 'arguments'),
    'log_reading_key_term': ('humanities', 'key_terms'),
    'log_reading_section': ('humanities', 'sections'),
    'log_discussion_question': ('discussion', 'questions'),
    'log_lecture_slide': ('lecture', 'slides'),
    'log_lecture_objective': ('lecture', 'objectives'),
    'log_lecture_key_term': ('lecture', 'key_terms'),
    'log_textbook_section': ('textbook', 'sections'),
    'log_textbook_definition': ('textbook', 'definitions'),
    'log_textbook_theorem': ('textbook', 'theorems'),
    'log_syllabus_week': ('syllabus', 'weeks'),
    'log_syllabus_policy': ('syllabus', 'policies'),
    'log_syllabus_textbook': ('syllabus', 'textbooks'),
}


def _tool(name, description, properties, required=None):
    return {
        'type': 'function',
        'function': {
            'name': name,
            'description': description,
            'parameters': {
                'type': 'object',
                'properties': properties,
                'required': required or [],
                'additionalProperties': False,
            },
        },
    }


def _pageid_prop():
    return {'pageid': {'type': 'string', 'description': 'Page id from [[PAGE ...]] header when known.'}}


TYPE_SPECIFIC_TOOL_DEFS = [
    _tool(
        'log_literary_character',
        'Log a character appearing in this literary work (fiction/poetry/drama). Not course staff.',
        {
            'name': {'type': 'string', 'description': 'Character name as used in the text.'},
            'role': {'type': 'string', 'description': 'Role in the story (protagonist, narrator, foil, etc.).'},
            'traits': {'type': 'string', 'description': 'Short trait summary from the text.'},
            'description': {'type': 'string', 'description': 'What the text shows about this character.'},
            **_pageid_prop(),
        },
        required=['name'],
    ),
    _tool(
        'log_literary_theme',
        'Log a theme, motif, or recurring idea in this literary work.',
        {
            'theme': {'type': 'string', 'description': 'Theme or motif label.'},
            'description': {'type': 'string', 'description': 'How the text develops this theme — cite specific content.'},
            **_pageid_prop(),
        },
        required=['theme', 'description'],
    ),
    _tool(
        'log_literary_plot_event',
        'Log an in-story plot event (scene turn, conflict, revelation). NOT a course calendar event.',
        {
            'eventname': {'type': 'string', 'description': 'Short label for the plot beat.'},
            'description': {'type': 'string', 'description': 'What happens in the narrative.'},
            'involved_characters': {
                'type': 'array',
                'items': {'type': 'string'},
                'description': 'Character names involved.',
            },
            **_pageid_prop(),
        },
        required=['eventname', 'description'],
    ),
    _tool(
        'log_literary_setting',
        'Log a place, time period, or social setting in the literary work.',
        {
            'setting': {'type': 'string', 'description': 'Place or time setting label.'},
            'description': {'type': 'string', 'description': 'Details from the text about this setting.'},
            **_pageid_prop(),
        },
        required=['setting'],
    ),
    _tool(
        'log_literary_symbol',
        'Log a symbol, image, or recurring object with implied meaning.',
        {
            'symbol': {'type': 'string', 'description': 'The symbol or image.'},
            'meaning': {'type': 'string', 'description': 'Interpretation supported by the text.'},
            **_pageid_prop(),
        },
        required=['symbol', 'meaning'],
    ),
    _tool(
        'log_article_claim',
        'Log a central claim or hypothesis from a research article.',
        {
            'claim': {'type': 'string', 'description': 'Claim statement.'},
            'evidence': {'type': 'string', 'description': 'Evidence or reasoning given in the paper.'},
            **_pageid_prop(),
        },
        required=['claim'],
    ),
    _tool(
        'log_article_method',
        'Log a method, dataset, or experimental design from a research article.',
        {
            'method': {'type': 'string', 'description': 'Method name or design label.'},
            'description': {'type': 'string', 'description': 'What was done — from the paper.'},
            **_pageid_prop(),
        },
        required=['method', 'description'],
    ),
    _tool(
        'log_article_finding',
        'Log a reported result or finding from a research article.',
        {
            'finding': {'type': 'string', 'description': 'Result headline.'},
            'description': {'type': 'string', 'description': 'Quantitative or qualitative detail from the paper.'},
            **_pageid_prop(),
        },
        required=['finding', 'description'],
    ),
    _tool(
        'log_article_key_term',
        'Log a domain-specific term defined or used centrally in a research article.',
        {
            'term': {'type': 'string', 'description': 'Term as used in the paper.'},
            'definition': {'type': 'string', 'description': 'Definition or usage from the paper.'},
            **_pageid_prop(),
        },
        required=['term', 'definition'],
    ),
    _tool(
        'log_reading_thesis',
        'Log the main thesis or central argument of a humanities essay/reading.',
        {
            'thesis': {'type': 'string', 'description': 'Thesis statement.'},
            'description': {'type': 'string', 'description': 'Supporting context from the text.'},
            **_pageid_prop(),
        },
        required=['thesis'],
    ),
    _tool(
        'log_reading_argument',
        'Log a sub-argument or rhetorical move in a humanities reading.',
        {
            'argument': {'type': 'string', 'description': 'Argument label or summary.'},
            'supports': {'type': 'string', 'description': 'What evidence or reasoning supports it.'},
            **_pageid_prop(),
        },
        required=['argument'],
    ),
    _tool(
        'log_reading_key_term',
        'Log a defined term or concept from a humanities/philosophy reading.',
        {
            'term': {'type': 'string', 'description': 'Term label.'},
            'definition': {'type': 'string', 'description': 'How the author defines or uses it.'},
            **_pageid_prop(),
        },
        required=['term', 'definition'],
    ),
    _tool(
        'log_discussion_question',
        'Log a discussion or response prompt question from a seminar handout.',
        {
            'question': {'type': 'string', 'description': 'The discussion question verbatim or paraphrased closely.'},
            'context': {'type': 'string', 'description': 'Reading passage or topic it refers to.'},
            **_pageid_prop(),
        },
        required=['question'],
    ),
    _tool(
        'log_reading_section',
        'Log a major section or heading in a humanities reading (preserves document order).',
        {
            'sectionOrder': {'type': 'integer', 'description': '1-based order in the document.'},
            'title': {'type': 'string', 'description': 'Section or chapter heading.'},
            'summary': {'type': 'string', 'description': 'One-sentence summary of the section argument.'},
            **_pageid_prop(),
        },
        required=['sectionOrder', 'title'],
    ),
    _tool(
        'log_lecture_slide',
        'Log one slide or slide group in deck order (critical for lecture sequencing and retrieval).',
        {
            'slideOrder': {'type': 'integer', 'description': 'Slide number or sequential order in the deck.'},
            'title': {'type': 'string', 'description': 'Slide title or topic line.'},
            'summary': {'type': 'string', 'description': 'Main teaching point on this slide.'},
            **_pageid_prop(),
        },
        required=['slideOrder', 'title'],
    ),
    _tool(
        'log_lecture_objective',
        'Log a learning objective stated on the slide deck.',
        {
            'objective': {'type': 'string', 'description': 'Learning objective text.'},
            'slideOrder': {'type': 'integer', 'description': 'Slide where it appears, if known.'},
            **_pageid_prop(),
        },
        required=['objective'],
    ),
    _tool(
        'log_lecture_key_term',
        'Log a defined term on a slide (glossary entry — use alongside add_concept_node for deep content).',
        {
            'term': {'type': 'string', 'description': 'Term as shown on the slide.'},
            'definition': {'type': 'string', 'description': 'Definition from the slide.'},
            'slideOrder': {'type': 'integer', 'description': 'Slide order where defined.'},
            **_pageid_prop(),
        },
        required=['term', 'definition'],
    ),
    _tool(
        'log_textbook_section',
        'Log a textbook section/chapter heading (preserves hierarchy and reading order).',
        {
            'sectionNumber': {'type': 'string', 'description': 'Section label (e.g. 2.3, Chapter 4).'},
            'title': {'type': 'string', 'description': 'Section title.'},
            'summary': {'type': 'string', 'description': 'What this section covers.'},
            **_pageid_prop(),
        },
        required=['sectionNumber', 'title'],
    ),
    _tool(
        'log_textbook_definition',
        'Log a formal definition box or bolded definition in a textbook section.',
        {
            'term': {'type': 'string', 'description': 'Defined term.'},
            'definition': {'type': 'string', 'description': 'Definition text.'},
            'sectionNumber': {'type': 'string', 'description': 'Hosting section number.'},
            **_pageid_prop(),
        },
        required=['term', 'definition'],
    ),
    _tool(
        'log_textbook_theorem',
        'Log a theorem, lemma, proposition, or rule with its statement.',
        {
            'name': {'type': 'string', 'description': 'Theorem/lemma name or number.'},
            'statement': {'type': 'string', 'description': 'Full statement from the text.'},
            'sectionNumber': {'type': 'string', 'description': 'Hosting section number.'},
            **_pageid_prop(),
        },
        required=['name', 'statement'],
    ),
    _tool(
        'log_syllabus_week',
        'Log one week or unit row from the syllabus schedule (ordering + readings).',
        {
            'weekNumber': {'type': 'integer', 'description': 'Week or unit index.'},
            'topic': {'type': 'string', 'description': 'Topics covered that week.'},
            'startDate': {'type': 'string', 'description': 'Week start date if listed.'},
            'endDate': {'type': 'string', 'description': 'Week end date if listed.'},
            'readings': {
                'type': 'array',
                'items': {'type': 'string'},
                'description': 'Assigned readings for the week.',
            },
            **_pageid_prop(),
        },
        required=['weekNumber', 'topic'],
    ),
    _tool(
        'log_syllabus_policy',
        'Log a course policy (attendance, late work, collaboration, grading rules).',
        {
            'policyType': {'type': 'string', 'description': 'Policy category label.'},
            'text': {'type': 'string', 'description': 'Policy text from the syllabus.'},
            **_pageid_prop(),
        },
        required=['policyType', 'text'],
    ),
    _tool(
        'log_syllabus_textbook',
        'Log a required or recommended textbook/resource from the syllabus.',
        {
            'title': {'type': 'string', 'description': 'Book or resource title.'},
            'author': {'type': 'string', 'description': 'Author if listed.'},
            'required': {'type': 'boolean', 'description': 'True if required, false if recommended.'},
            'isbnOrUrl': {'type': 'string', 'description': 'ISBN, URL, or publisher info.'},
            **_pageid_prop(),
        },
        required=['title'],
    ),
]

TYPE_SPECIFIC_TOOLS_BY_NAME = {
    tool['function']['name']: tool for tool in TYPE_SPECIFIC_TOOL_DEFS
}

TYPE_SPECIFIC_PASS1_INSTRUCTIONS = {
    'literary_work': (
        'LITERARY EXTRACTION — use ONLY these literary tools (not add_concept_node or log_detail):\n'
        '- log_literary_character for each significant character\n'
        '- log_literary_theme for themes/motifs supported by the text\n'
        '- log_literary_plot_event for in-story plot beats (NOT course exams)\n'
        '- log_literary_setting for places/time/social context\n'
        '- log_literary_symbol for recurring symbols/images\n'
        'Extract only what appears in this text. Include pageid when available. '
        'Do not invent analysis beyond what the passage supports.'
    ),
    'research_article': (
        'RESEARCH ARTICLE EXTRACTION:\n'
        '- log_article_claim for main claims/hypotheses\n'
        '- log_article_method for methods/design\n'
        '- log_article_finding for reported results\n'
        '- log_article_key_term for defined jargon\n'
        'Skip abstract boilerplate and references. No STEM concept graph.'
    ),
    'humanities_reading': (
        'HUMANITIES READING EXTRACTION:\n'
        '- log_reading_thesis for the central thesis\n'
        '- log_reading_argument for major supporting arguments\n'
        '- log_reading_key_term for defined terms\n'
        'Do not use add_concept_node or log_problem.'
    ),
    'discussion_prompt': (
        'DISCUSSION PROMPT EXTRACTION:\n'
        '- log_discussion_question for each prompt question\n'
        'add_file_node first. No concept graph.'
    ),
    'lecture_slides': (
        'LECTURE SLIDE EXTRACTION (pass 1 only — no add_concept_node / log_detail):\n'
        '- log_lecture_slide for EVERY slide in order (slideOrder + title + summary) — required\n'
        '- log_lecture_objective for stated learning objectives\n'
        '- log_lecture_key_term for on-slide definitions (glossary)\n'
        '- log_problem for slide exercises when present. Always include pageid.'
    ),
    'lecture_notes': (
        'LECTURE NOTES EXTRACTION (pass 1 only — same structure tools as slide decks):\n'
        '- log_lecture_slide for each major section (slideOrder = section index)\n'
        '- log_lecture_objective and log_lecture_key_term when present\n'
        '- log_problem for exercises. Do not use add_concept_node or log_detail.'
    ),
    'textbook_chapter': (
        'TEXTBOOK CHAPTER EXTRACTION (pass 1 only — no add_concept_node / log_detail deferral):\n'
        '- log_textbook_section for every section heading (sectionNumber + title)\n'
        '- log_textbook_definition for formal definitions\n'
        '- log_textbook_theorem for theorems/lemmas/rules\n'
        '- log_problem for end-of-section exercises. Always include pageid.'
    ),
    'syllabus': (
        'SYLLABUS EXTRACTION (use WITH add_syllabus / add_assignment_node / add_exam_node):\n'
        '- log_syllabus_week for each week/unit schedule row (weekNumber, topic, readings)\n'
        '- log_syllabus_policy for attendance, late work, collaboration, grading policies\n'
        '- log_syllabus_textbook for required/recommended texts\n'
        'Still call add_exam_node for every dated exam and add_assignment_node for graded work.'
    ),
}


def extra_tool_names_for_type(type_id):
    return TYPE_EXTRA_TOOLS_BY_FILE_TYPE.get(str(type_id or ''), ())


def type_specific_tools_for_type(type_id):
    names = extra_tool_names_for_type(type_id)
    return [TYPE_SPECIFIC_TOOLS_BY_NAME[name] for name in names if name in TYPE_SPECIFIC_TOOLS_BY_NAME]


def type_specific_pass1_instructions(type_id):
    return TYPE_SPECIFIC_PASS1_INSTRUCTIONS.get(str(type_id or ''), '')


def is_type_specific_log_tool(tool_name):
    return str(tool_name or '') in TYPE_BUCKET_BY_TOOL


def append_type_extraction(file_node, tool_name, row):
    if not file_node:
        return
    bucket = TYPE_BUCKET_BY_TOOL.get(str(tool_name or ''))
    if not bucket:
        return
    group, category = bucket
    store = getattr(file_node, 'typeExtractions', None)
    if not isinstance(store, dict):
        store = {}
        file_node.typeExtractions = store
    group_store = store.setdefault(group, {})
    group_store.setdefault(category, []).append(row)


def build_type_log_row(tool_name, arguments, filemeta):
    args = dict(arguments or {})
    pageid = str(args.pop('pageid', '') or (filemeta or {}).get('pageid') or '').strip()
    row = {key: value for key, value in args.items() if value not in (None, '', [])}
    if pageid:
        row['pageid'] = pageid
    row['sourceFileId'] = str((filemeta or {}).get('fileid') or '')
    row['logTool'] = tool_name
    return row


def _type_log_label(row, category):
    for key in (
        'title', 'name', 'term', 'theme', 'topic', 'objective', 'policyType',
        'question', 'claim', 'theorem', 'eventname', 'symbol', 'setting',
    ):
        value = row.get(key)
        if value:
            return str(value)
    if row.get('sectionNumber') not in (None, ''):
        return f"Section {row['sectionNumber']}"
    if row.get('weekNumber') not in (None, ''):
        return f"Week {row['weekNumber']}"
    if row.get('slideOrder') not in (None, ''):
        return f"Slide {row['slideOrder']}"
    if row.get('sectionOrder') not in (None, ''):
        return f"Section {row['sectionOrder']}"
    return category


def handle_type_specific_tool(name, arguments, filemeta, current_file):
    row = build_type_log_row(name, arguments, filemeta)
    append_type_extraction(current_file, name, row)
    category = TYPE_BUCKET_BY_TOOL.get(name, ('', ''))[1]
    label = _type_log_label(row, category)
    return {
        'status': 'logged',
        'tool': name,
        'category': category,
        'label': label,
    }
