#!/usr/bin/env python3
"""Tests for sidekick retrieved-context injection."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sidekick_context import (  # noqa: E402
    build_claude_system_prompt,
    build_grounding_instructions,
    build_stage_one_instructions,
    count_retrieved_entries,
    format_active_retrieval_slots,
    inject_call_context_into_messages,
)


SAMPLE_CALL_CONTEXT = (
    "\n\nRetrieved Canvas context:\n"
    "1. [event] Final Exam (evt-1)\n"
    "Dec 15 in-person final\n"
    "Course: CHM 201 (123)\n\n"
    "Use this retrieved context when it is relevant to the user's question."
)


class SidekickCallContextTests(unittest.TestCase):
    def test_inject_appends_to_string_user_content(self):
        messages = [{"role": "user", "content": "When is the final exam?"}]
        merged = inject_call_context_into_messages(messages, SAMPLE_CALL_CONTEXT)
        self.assertEqual(len(merged), 1)
        blocks = merged[0]["content"]
        self.assertEqual(len(blocks), 2)
        self.assertEqual(blocks[0]["text"], "When is the final exam?")
        self.assertIn("Retrieved Canvas context", blocks[1]["text"])

    def test_inject_appends_to_block_user_content(self):
        messages = [{
            "role": "user",
            "content": [
                {"type": "text", "text": "Find the syllabus"},
                {"type": "text", "text": "Attached PDF: notes.pdf"},
            ],
        }]
        merged = inject_call_context_into_messages(messages, SAMPLE_CALL_CONTEXT)
        blocks = merged[0]["content"]
        self.assertEqual(len(blocks), 3)
        self.assertIn("Retrieved Canvas context", blocks[-1]["text"])

    def test_inject_skips_non_user_tail(self):
        messages = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi"},
        ]
        self.assertEqual(
            inject_call_context_into_messages(messages, SAMPLE_CALL_CONTEXT),
            messages,
        )

    def test_system_prompt_includes_call_context(self):
        prompt = build_claude_system_prompt(
            "Base instructions",
            call_context=SAMPLE_CALL_CONTEXT,
            snapshot_context="Active tab: Canvas",
        )
        self.assertIn("Base instructions", prompt)
        self.assertIn("Live app context", prompt)
        self.assertIn("Active tab: Canvas", prompt)
        self.assertIn("Retrieved Canvas context", prompt)

    def test_count_retrieved_entries(self):
        self.assertEqual(count_retrieved_entries(SAMPLE_CALL_CONTEXT), 1)

    def test_grounding_instructions_require_labels(self):
        text = build_grounding_instructions(
            require_citations=True,
            retrieval_labels=["R1", "R2"],
            screen_labels=["C1"],
        )
        self.assertIn("Grounding rules", text)
        self.assertIn("Include at least one inline [R#]", text)
        self.assertIn("On-screen labels available: C1", text)

    def test_system_prompt_layer_order_for_caching(self):
        prompt = build_claude_system_prompt(
            "Base instructions",
            course_graph_context="Course graph: Chain rule",
            rag_context="Retrieved Canvas passages:\n[R1] entropy",
            screen_context="On-screen source chunks:\n[C1] visible",
            snapshot_context="Active tab: Canvas",
        )
        base_idx = prompt.index("Base instructions")
        graph_idx = prompt.index("Course graph: Chain rule")
        rag_idx = prompt.index("[R1] entropy")
        live_idx = prompt.index("Active tab: Canvas")
        screen_idx = prompt.index("[C1] visible")
        self.assertTrue(base_idx < graph_idx < rag_idx < live_idx < screen_idx)

    def test_grounding_instructions_problem_query(self):
        text = build_grounding_instructions(problem_query=True)
        self.assertIn("problem-solving request", text)
        self.assertIn("course graph block", text)
        self.assertIn("do not invent course material", text)

    def test_grounding_instructions_academic_query(self):
        text = build_grounding_instructions(academic_query=True)
        self.assertIn("academic or course-content question", text)
        self.assertIn("retrieve_user_context", text)

    def test_grounding_instructions_empty_retrieval(self):
        text = build_grounding_instructions(
            retrieval_attempted=True,
            retrieval_empty=True,
            problem_query=True,
        )
        self.assertIn("returned no matching Canvas material", text)
        self.assertIn("Do not fabricate", text)

    def test_format_active_retrieval_slots(self):
        text = format_active_retrieval_slots([
            {"id": "prefetch", "query": "syllabus", "labels": ["R1", "R2"], "chunkCount": 2},
            {"id": "ret-1", "query": "midterm", "labels": ["R3"], "chunkCount": 1},
        ])
        self.assertIn("Active retrieval slots", text)
        self.assertIn("prefetch", text)
        self.assertIn("labels=[R1, R2]", text)

    def test_grounding_instructions_active_slots(self):
        text = build_grounding_instructions(
            active_slots=[{"id": "ret-1", "labels": ["R1"]}],
            retrieval_labels=["R1"],
        )
        self.assertIn("Active retrieval slot ids: ret-1", text)

    def test_stage_one_instructions(self):
        text = build_stage_one_instructions()
        self.assertIn("Stage 1 triage", text)
        self.assertIn("wait_for_context", text)


if __name__ == "__main__":
    unittest.main()
