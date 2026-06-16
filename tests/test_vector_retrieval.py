"""Unit tests for vector retrieval scoring helpers (no OpenAI calls)."""
import sys
import types

if not hasattr(sys.stdin, "reconfigure"):
    sys.stdin = types.SimpleNamespace(reconfigure=lambda **kwargs: None)

from vector_retreival import (
    assignment_exam_like,
    browser_file_query_boost,
    classify_query_intent,
    intent_type_adjustment,
    node_ranking_text,
)


class DummyNode:
    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)


def test_classify_exam_intent():
    assert classify_query_intent("When is the CHM 201 exam?") == "deadline"


def test_classify_syllabus_intent():
    assert classify_query_intent("CHM 201 syllabus") == "syllabus"
    assert classify_query_intent("What is the grading policy for CHM 201?") == "syllabus"
    assert classify_query_intent("What are the office hours for MAT 201?") == "syllabus"


def test_assignment_exam_like():
    assert assignment_exam_like("Final Exam")
    assert not assignment_exam_like("Problem Set 4")


def test_intent_boosts_event_over_assignment():
    event = DummyNode(name="Exam", description="Exam 1 date", type="test", startdate="2024-10-01T00:00:00Z")
    assignment = DummyNode(name="Problem Set 4", description="Textbook problems")
    event_score = intent_type_adjustment("exam", "event", event)
    assignment_penalty = intent_type_adjustment("exam", "assignment", assignment)
    assert event_score > assignment_penalty


def test_node_ranking_text_includes_type_phrase():
    node = DummyNode(name="Exam", description="Midterm exam", type="test", courseid="15160")
    text = node_ranking_text("event", node, "15160")
    assert "exam" in text.lower()
    assert "calendar" in text.lower()


def test_browser_file_boost():
    assert browser_file_query_boost("ECO 101 lecture slides", "file") > 0.0
    assert browser_file_query_boost("ECO 101 lecture slides", "assignment") == 0.0
