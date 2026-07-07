"""Unit tests for vector retrieval scoring helpers (no OpenAI calls)."""
import sys
import types

import numpy as np

if not hasattr(sys.stdin, "reconfigure"):
    sys.stdin = types.SimpleNamespace(reconfigure=lambda **kwargs: None)

from vector_retreival import (
    assignment_exam_like,
    assignment_pset_like,
    browser_allowed_types,
    browser_file_query_boost,
    browser_syllabus_query_boost,
    classify_query_intent,
    course_code_filename_penalty,
    course_code_match_score,
    enrich_catalog_entry_from_graph,
    event_concept_neighbors,
    extract_course_codes_from_query,
    file_is_primary_pset_solution,
    intent_type_adjustment,
    node_ranking_text,
    passes_retrieval_cutoff,
    query_ranking_adjustment,
    week_query_file_boost,
    _format_problem_steps,
    problem_context_fields,
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


def test_browser_syllabus_boost():
    assert browser_syllabus_query_boost("CHM 201 syllabus", "syllabus") > 0.0
    assert browser_syllabus_query_boost("CHM 201 syllabus", "assignment") == 0.0


def test_browser_allowed_types_for_syllabus():
    assert "syllabus" in browser_allowed_types("browser", "syllabus")
    assert "syllabus" not in browser_allowed_types("browser", "general")


def test_week_query_file_boost():
    file_node = DummyNode(name="Week 3 Lecture Slides.pdf")
    assert week_query_file_boost("CHI 108 course slides for week 3", "file", file_node) > 0.0
    other_file = DummyNode(name="Week 5 Lecture Slides.pdf")
    assert week_query_file_boost("CHI 108 course slides for week 3", "file", other_file) == 0.0


def test_type_extraction_boosts_file_ranking_text():
    node = DummyNode(
        name="Course Syllabus.pdf",
        typeExtractions={
            "syllabus": {
                "weeks": [{"weekNumber": 2, "topic": "Linear Algebra", "readings": ["Strang 2.1"]}],
            },
        },
    )
    text = node_ranking_text("file", node, "123")
    assert "Linear Algebra" in text


def test_type_extraction_query_boost_on_file():
    from canvas_parser.content.type_extraction_retrieval import type_extraction_query_boost

    node = DummyNode(
        name="Lecture 3 Slides.pdf",
        academicFileType="lecture_slides",
        typeExtractions={
            "lecture": {
                "slides": [{"slideOrder": 7, "title": "Eigenvalues", "summary": "Diagonalization"}],
            },
        },
    )
    boost = type_extraction_query_boost("slide 7 eigenvalues", "file", node)
    assert boost > 0.25


def test_event_concept_neighbors_resolves_covered_concepts(monkeypatch):
    concept = DummyNode(conceptid="abc123", name="Eigenvalues", courseid="123")
    import vector_retreival as vr

    monkeypatch.setattr(vr, "allnodes", {"concepts": [concept]})
    event = DummyNode(
        courseid="123",
        dependencies=[],
        coveredConcepts=[{"name": "Eigenvalues", "conceptid": "abc123"}],
    )
    neighbors = event_concept_neighbors(event)
    assert len(neighbors) == 1
    assert neighbors[0][0] == "concept"
    assert neighbors[0][1] is concept


def test_extract_course_codes_from_query():
    codes = extract_course_codes_from_query("CHM 201 syllabus")
    assert "chm 201" in codes
    assert "chm201" in codes


def test_course_code_match_score():
    entry = {
        "name": "CHM201_F2024 General Chemistry I syllabus",
        "keyword_name": "CHM201 general chemistry syllabus",
        "course_codes": ["chm 201", "chm201"],
    }
    assert course_code_match_score("CHM 201 syllabus", entry) >= 0.95


def test_narrow_course_pool_prefers_focus():
    from vector_retreival import narrow_course_pool

    pool, mode = narrow_course_pool({"100", "200", "300"}, ["200"], pool_mode="moderate")
    assert pool == {"200"}
    assert mode == "focus"


def test_should_skip_fast_rank():
    from vector_retreival import should_skip_fast_rank

    assert should_skip_fast_rank(True, "agent", 0.01, 0.1)
    assert not should_skip_fast_rank(True, "agent", 0.5, 0.1)
    assert not should_skip_fast_rank(True, "agent", 0.01, 0.5)
    assert not should_skip_fast_rank(False, "agent", 0.01, 0.1)
    assert should_skip_fast_rank(
        True, "agent", 0.08, 0.9, pool_mode="focus", intent="general"
    )
    assert not should_skip_fast_rank(
        True, "agent", 0.08, 0.9, pool_mode="focus", intent="deadline"
    )


def test_fast_rank_limits_focus_pool():
    from vector_retreival import AGENT_FOCUS_MAX_HEAP_POPS, AGENT_FOCUS_MAX_RANK_NODES, fast_rank_limits

    max_rank, max_pops = fast_rank_limits("focus", {"200"}, True, "agent")
    assert max_rank == AGENT_FOCUS_MAX_RANK_NODES
    assert max_pops == AGENT_FOCUS_MAX_HEAP_POPS


def test_focus_embed_prefilter_enabled():
    from vector_retreival import focus_embed_prefilter_enabled

    assert focus_embed_prefilter_enabled(True, "agent", {"200"}, "focus")
    assert focus_embed_prefilter_enabled(True, "agent", {"200", "201"}, "moderate")
    assert not focus_embed_prefilter_enabled(True, "agent", {"200", "201", "202"}, "moderate")
    assert not focus_embed_prefilter_enabled(True, "agent", {"200"}, "all")


def test_quick_fuzzy_prefilter_score():
    from vector_retreival import fuzzy_query_terms, quick_fuzzy_prefilter_score

    terms = fuzzy_query_terms("office hours NEU 201")
    assert quick_fuzzy_prefilter_score(terms, "Office Hours - Professor Boulanger") >= 0.3


def test_batch_node_embedding_similarities():
    from vector_retreival import batch_node_embedding_similarities

    class Dummy:
        embedded = {"name": np.array([1.0, 0.0], dtype=np.float32)}

    scores = batch_node_embedding_similarities(np.array([1.0, 0.0], dtype=np.float32), [Dummy(), Dummy()])
    assert scores.shape == (2,)
    assert float(scores[0]) == 1.0


def test_select_vector_prefilter_indices():
    from vector_retreival import select_vector_prefilter_indices

    semantic = np.array([0.1, 0.9, 0.2, 0.8, 0.05], dtype=np.float32)
    has_embedding = np.array([True, True, True, True, False], dtype=bool)
    texts = ["a", "b", "c", "d", "office hours schedule"]
    indices = select_vector_prefilter_indices(
        semantic,
        has_embedding,
        prefilter_limit=2,
        query_terms=["office", "hours"],
        ranking_texts=texts,
        unembedded_limit=2,
    )
    assert indices[:2] == [1, 3]
    assert 4 in indices


def test_collect_pool_retrieval_rows_filters_browser_types():
    from vector_retreival import BROWSER_RANK_NODE_TYPES, collect_pool_retrieval_rows

    rows = collect_pool_retrieval_rows(None, browser_rank_types=BROWSER_RANK_NODE_TYPES)
    assert rows["entries"]
    assert all(nodetype in BROWSER_RANK_NODE_TYPES for nodetype, _, _ in rows["entries"])


def test_focus_scan_helpers():
    from vector_retreival import (
        focus_quick_scan_limit,
        focus_scan_type_order,
        should_stop_focus_quick_scan,
    )

    assert focus_scan_type_order("deadline")[0] == "event"
    assert focus_scan_type_order("general", grounded=True)[0] == "concept"
    assert focus_quick_scan_limit({"200"}) == 750
    assert focus_quick_scan_limit({"200", "201"}) == 1200
    assert not should_stop_focus_quick_scan(700, [(0.2, 0, object())], 750)
    assert should_stop_focus_quick_scan(750, [(0.2, 0, object())] * 140, 750)


def test_retrieval_cache_key_stable():
    from vector_retreival import get_cached_retrieval, retrieval_cache_key, store_cached_retrieval

    key = retrieval_cache_key(
        "Explain neurons",
        k=5,
        mode="agent",
        fast=True,
        grounded=True,
        focus_course_ids=["200", "100"],
    )
    assert "100,200" in key
    assert get_cached_retrieval(key) is None
    store_cached_retrieval(key, [{"type": "concept"}])
    assert get_cached_retrieval(key) == [{"type": "concept"}]


def test_warm_retrieval(monkeypatch):
    from vector_retreival import warm_retrieval

    monkeypatch.setattr("vector_retreival.get_course_embeddings", lambda catalog=None: {"1": object()})
    monkeypatch.setattr("vector_retreival.COURSE_CATALOG", {"1": {"name": "Demo"}})
    info = warm_retrieval()
    assert info["ok"] is True
    assert info["courses"] == 1


def test_classify_material_intent():
    assert classify_query_intent("ECO 101 lecture slides") == "material"


def test_passes_retrieval_cutoff_with_course_match():
    node = DummyNode(name="Problem Set 1")
    assert passes_retrieval_cutoff(
        semantic_similarity=0.0,
        fuzzy_similarity=0.3,
        course_similarity=0.9,
        intent="assignment",
        nodetype="assignment",
        node=node,
    )


def test_assignment_pset_like():
    assert assignment_pset_like("PSET 1")
    assert assignment_pset_like("Problem Set 2")
    assert not assignment_pset_like("Exam 1")


def test_query_ranking_pset_boost():
    node = DummyNode(name="PSET 1")
    boost = query_ranking_adjustment("MAT 202 linear algebra pset", "assignment", "assignment", node, "browser")
    assert boost > 0.2


def test_query_ranking_exam_penalty_on_pset():
    node = DummyNode(name="Problem Set 8")
    penalty = query_ranking_adjustment("When is the CHM 201 exam?", "deadline", "assignment", node, "agent")
    assert penalty < 0


def test_course_code_filename_penalty():
    wrong_course = DummyNode(name="NEU201_FinalPractice.pdf")
    assert course_code_filename_penalty("CHM 201 practice exam", "file", wrong_course) < 0
    same_course = DummyNode(name="CHM201_practice_exam.pdf")
    assert course_code_filename_penalty("CHM 201 practice exam", "file", same_course) == 0.0


def test_browser_allowed_types_for_exam():
    assert "event" in browser_allowed_types("browser", "exam")


def test_file_is_primary_pset_solution():
    assert file_is_primary_pset_solution("MAT202-PSET-1Solutions.pdf", "MAT 202 linear algebra pset")
    assert file_is_primary_pset_solution("MAT202F2025_PSET1_Solutions.pdf", "MAT 202 linear algebra pset")
    assert not file_is_primary_pset_solution("MAT202F2025_PSET11_Solutions.PDF", "MAT 202 linear algebra pset")
    assert not file_is_primary_pset_solution("MAT202F2025_PSET2_Solution.pdf", "MAT 202 linear algebra pset")


def test_drop_slot_protects_top_homework():
    from vector_retreival import drop_slot_for_promotion

    top = [
        {"type": "assignment", "node": DummyNode(name="Homework 1"), "similarity": 3.9},
        {"type": "assignment", "node": DummyNode(name="Homework 3"), "similarity": 3.8},
        {"type": "assignment", "node": DummyNode(name="Final Exam"), "similarity": 3.7},
    ]
    kept = drop_slot_for_promotion(top, "What ECO 101 homework is due soon?", "deadline")
    names = [getattr(item["node"], "name", "") for item in kept]
    assert "Homework 1" in names
    assert len(kept) == 2


def test_enrich_catalog_entry_from_graph():
    file_node = DummyNode(name="CHM201_F2024 General Chemistry I syllabus.pdf")
    nodes = {
        "files": {"15160": {"f1": file_node}},
        "syllabi": {"15160": DummyNode(other="")},
    }
    entry = enrich_catalog_entry_from_graph("15160", {"name": "Canvas 15160", "keyword_name": "canvas 15160"}, nodes)
    assert "chm 201" in entry["course_codes"]
    assert "CHM201" in entry["keyword_name"]


def test_format_problem_steps():
    steps = _format_problem_steps([
        "Set up the characteristic polynomial",
        {"text": "Solve for lambda"},
    ])
    assert steps == [
        "1. Set up the characteristic polynomial",
        "2. Solve for lambda",
    ]


def test_problem_context_fields_without_graph_links():
    node = DummyNode(
        name="Problem 2",
        steps=["Differentiate", "Simplify"],
        answer="42",
        incomingConceptNodeIds=[],
        outgoingConceptNodeIds=[],
        assignmentNodeIds=[],
    )
    fields = problem_context_fields(node)
    assert fields["steps"] == ["1. Differentiate", "2. Simplify"]
    assert fields["hasOfficialAnswer"] is True
    assert fields["relatedConcepts"] == []
    assert fields["relatedAssignments"] == []


def test_reconstruct_nodes_missing_graph(tmp_path, monkeypatch):
    import vector_retreival as vr

    missing = tmp_path / "missing_graph.json"
    nodes = vr.reconstruct_nodes(missing)
    assert nodes["concepts"] == []
    assert nodes["files"] == {}
    assert nodes["syllabi"] == {}
