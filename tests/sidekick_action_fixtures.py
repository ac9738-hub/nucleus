"""Sidekick action-query fixtures — workspace opens, deadlines, quizzes, explain."""

from __future__ import annotations

from dataclasses import dataclass

from sidekick_router import RouteContextHints, SidekickRoute


@dataclass(frozen=True)
class ActionQueryFixture:
    text: str
    expected_route: SidekickRoute
    expected_retrieval: bool
    category: str
    hints: RouteContextHints = RouteContextHints()


ACTION_FIXTURES: list[ActionQueryFixture] = [
    ActionQueryFixture(
        "can you open my CHM201 syllabus in biology workspace",
        SidekickRoute.TOOL,
        False,
        "workspace_open",
    ),
    ActionQueryFixture(
        "can you open MAT201 diagnostic quiz in new workspace?",
        SidekickRoute.TOOL,
        False,
        "workspace_open",
    ),
    ActionQueryFixture(
        "open the NEU201 syllabus in my neuroscience workspace",
        SidekickRoute.TOOL,
        False,
        "workspace_open",
    ),
    ActionQueryFixture(
        "when is my math final due",
        SidekickRoute.DATA,
        False,
        "personal_deadline",
    ),
    ActionQueryFixture(
        "when is my MAT202 quiz",
        SidekickRoute.DATA,
        False,
        "personal_deadline",
    ),
    ActionQueryFixture(
        "when's my ECON 101 problem set due",
        SidekickRoute.DATA,
        False,
        "personal_deadline",
    ),
    ActionQueryFixture(
        "what assignments are due tomorrow",
        SidekickRoute.DATA,
        False,
        "personal_deadline",
    ),
    ActionQueryFixture(
        "when is the CHM 201 midterm exam",
        SidekickRoute.DATA,
        True,
        "canvas_schedule_lookup",
    ),
    ActionQueryFixture(
        "when is the COS 217 midterm?",
        SidekickRoute.DATA,
        True,
        "canvas_schedule_lookup",
    ),
    ActionQueryFixture(
        "can you explain what dot product is?",
        SidekickRoute.CHAT,
        True,
        "general_explain",
    ),
    ActionQueryFixture(
        "explain what eigenvalues are",
        SidekickRoute.CHAT,
        True,
        "general_explain",
    ),
    ActionQueryFixture(
        "can you explain what dot product is?",
        SidekickRoute.CHAT,
        True,
        "grounded_explain",
        hints=RouteContextHints(has_course_focus=True),
    ),
    ActionQueryFixture(
        "explain the midterm topics for this course",
        SidekickRoute.CHAT,
        True,
        "grounded_explain",
        hints=RouteContextHints(has_course_focus=True),
    ),
    ActionQueryFixture(
        "how do I approach the chain rule problem on PSET 4",
        SidekickRoute.CHAT,
        True,
        "problem_solve",
    ),
    ActionQueryFixture(
        "help me with problem 2 about eigenvalues",
        SidekickRoute.CHAT,
        True,
        "problem_solve",
    ),
]
