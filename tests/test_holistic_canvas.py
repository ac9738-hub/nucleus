"""Tests for holistic Canvas content discovery."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_read_homepage_html_from_disk():
    from canvas_parser.content.holistic_canvas import read_homepage_html

    sample = ROOT / 'app' / 'canvas' / 'canvas_homepages' / '20959.html'
    if not sample.exists():
        return
    title, body = read_homepage_html('20959')
    assert title
    assert 'Welcome' in body or 'Canvas' in body


def test_collect_module_external_resources():
    from canvas_parser.content.holistic_canvas import collect_module_resource_rows

    rows = collect_module_resource_rows('15222')
    kinds = {row.get('kind') for row in rows}
    assert 'external' in kinds or 'page' in kinds


def test_build_holistic_link_lessons_dedupes():
    from canvas_parser.content.holistic_canvas import build_holistic_link_lessons

    lessons = build_holistic_link_lessons('15222')
    names = [row.get('name') for row in lessons if row.get('name')]
    assert len(names) == len(set(name.casefold() for name in names))


def test_hydrate_homepage_node_adds_pages():
    from canvas_parser.content.holistic_canvas import hydrate_homepage_node, read_homepage_html

    sample = ROOT / 'app' / 'canvas' / 'canvas_homepages' / '20959.html'
    if not sample.exists():
        return
    _, body = read_homepage_html('20959')
    if not body:
        return
    course_files = {}
    assert hydrate_homepage_node(course_files, '20959')
    node = course_files.get('homepage-20959') or {}
    assert node.get('pages')


def test_collect_canvas_module_file_rows_orf245():
    from canvas_parser.content.holistic_canvas import collect_canvas_module_file_rows

    rows = collect_canvas_module_file_rows('20640')
    if not rows:
        return
    assert any('Syllabus' in str(row.get('moduleName') or '') for row in rows)
    assert any(str(row.get('title') or '').endswith('.pdf') for row in rows)


def test_hydrate_searchtext_external_site():
    from canvas_parser.content.holistic_canvas import hydrate_searchtext_file_nodes

    course_files = {
        'external-site-demo': {
            'fileid': 'external-site-demo',
            'name': 'External resource',
            'searchtext': 'Neurons transmit signals using action potentials and synaptic release. ' * 3,
        },
    }
    count = hydrate_searchtext_file_nodes(course_files, 'demo')
    assert count == 1
    assert course_files['external-site-demo'].get('pages')


def test_build_page_teaching_lessons_from_hydrated_text():
    from canvas_parser.content.holistic_canvas import (
        build_page_teaching_lessons,
        hydrate_searchtext_file_nodes,
    )

    course_files = {
        'external-site-demo': {
            'fileid': 'external-site-demo',
            'name': 'Neuroscience notes',
            'searchtext': (
                '2.1 Action Potentials\n\n'
                'Neurons fire when membrane potential crosses threshold. '
                'The action potential propagates down the axon to the synapse.'
            ),
        },
    }
    hydrated = hydrate_searchtext_file_nodes(course_files, 'demo')
    assert hydrated == 1
    assert course_files['external-site-demo'].get('pages')
    build_page_teaching_lessons('demo', course_files)


def test_module_file_title_map():
    from canvas_parser.content.holistic_canvas import module_file_title_map

    mapping = module_file_title_map('20640')
    if not mapping:
        return
    assert any('.pdf' in name for name in mapping.values())


def test_enrich_graph_adds_holistic_lessons_to_curriculum():
    from canvas_parser.synapse_teaching import build_curriculum, load_graph

    graph_path = ROOT / 'canvas_graph.json'
    if not graph_path.exists():
        return
    graph = load_graph(graph_path)
    lessons = build_curriculum(graph, '15222', max_lessons=300)
    sources = {row.get('source') for row in lessons}
    assert any(str(source).startswith('canvas_') for source in sources)
