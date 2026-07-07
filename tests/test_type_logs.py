#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.parse.file_types import get_file_type_profile, pass1_tool_names_for_profile  # noqa: E402
from canvas_parser.parse.type_logs import (  # noqa: E402
    append_type_extraction,
    handle_type_specific_tool,
    is_type_specific_log_tool,
)


class TypeLogTests(unittest.TestCase):
    class FakeFile:
        def __init__(self):
            self.typeExtractions = {}

    def test_literary_profile_has_literary_tools(self):
        profile = get_file_type_profile('literary_work')
        tools = pass1_tool_names_for_profile(profile)
        self.assertIn('log_literary_character', tools)
        self.assertIn('log_literary_theme', tools)
        self.assertNotIn('add_concept_node', tools)
        self.assertNotIn('log_detail', tools)

    def test_log_literary_character(self):
        file_node = self.FakeFile()
        result = handle_type_specific_tool(
            'log_literary_character',
            {
                'name': 'Elizabeth Bennet',
                'role': 'protagonist',
                'description': 'Witty observer of social manners.',
                'pageid': 'p1',
            },
            {'fileid': '123', 'pageid': 'p1'},
            file_node,
        )
        self.assertEqual(result['status'], 'logged')
        chars = file_node.typeExtractions['literary']['characters']
        self.assertEqual(chars[0]['name'], 'Elizabeth Bennet')
        self.assertEqual(chars[0]['sourceFileId'], '123')

    def test_log_literary_plot_event(self):
        file_node = self.FakeFile()
        handle_type_specific_tool(
            'log_literary_plot_event',
            {
                'eventname': 'First meeting',
                'description': 'They clash at the ball.',
                'involved_characters': ['Elizabeth', 'Darcy'],
            },
            {'fileid': '99'},
            file_node,
        )
        events = file_node.typeExtractions['literary']['plot_events']
        self.assertEqual(events[0]['eventname'], 'First meeting')
        self.assertEqual(len(events[0]['involved_characters']), 2)

    def test_is_type_specific_log_tool(self):
        self.assertTrue(is_type_specific_log_tool('log_literary_theme'))
        self.assertFalse(is_type_specific_log_tool('log_detail'))


    def test_lecture_slides_profile_tools(self):
        profile = get_file_type_profile('lecture_slides')
        tools = pass1_tool_names_for_profile(profile)
        self.assertIn('log_lecture_slide', tools)
        self.assertNotIn('add_concept_node', tools)

    def test_syllabus_week_log(self):
        file_node = self.FakeFile()
        handle_type_specific_tool(
            'log_syllabus_week',
            {
                'weekNumber': 3,
                'topic': 'Thermodynamics',
                'readings': ['Ch 4', 'Ch 5'],
            },
            {'fileid': '42'},
            file_node,
        )
        weeks = file_node.typeExtractions['syllabus']['weeks']
        self.assertEqual(weeks[0]['weekNumber'], 3)

    def test_textbook_section_log(self):
        file_node = self.FakeFile()
        result = handle_type_specific_tool(
            'log_textbook_section',
            {'sectionNumber': '2.3', 'title': 'Matrix Products', 'summary': 'Multiplying matrices.'},
            {'fileid': '7'},
            file_node,
        )
        self.assertEqual(result['label'], 'Matrix Products')


if __name__ == '__main__':
    unittest.main()
