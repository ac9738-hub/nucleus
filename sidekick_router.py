"""Fast sidekick intent routing — pick model tier without an LLM call."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum


class SidekickRoute(str, Enum):
    TOOL = "tool"  # Claude — app mutations + tool calls
    DATA = "data"  # DeepSeek — app / Canvas reads from injected context
    CHAT = "chat"  # DeepSeek — general knowledge, no retrieval
    FALLBACK = "fallback"  # Claude — low-confidence safety path


@dataclass(frozen=True)
class RouteDecision:
    route: SidekickRoute
    confidence: float
    needs_retrieval: bool
    reason: str
    grounded_explain: bool = False
    problem_query: bool = False


@dataclass(frozen=True)
class RouteContextHints:
    has_course_focus: bool = False
    has_screen_chunks: bool = False


TOOL_VERB_PATTERN = re.compile(
    r"\b("
    r"create|add|delete|remove|open|close|focus|navigate|schedule|mark|move|update|refresh|"
    r"make|set|rename|duplicate|build|generate|draft"
    r")\b",
    re.I,
)
APP_DATA_PATTERN = re.compile(
    r"\b("
    r"my tasks?|assignments? due|what(?:'s| is) due|deadlines?|upcoming|grades?|"
    r"classes today|show my|list my|how am i doing|due tomorrow|due this week|"
    r"canvas courses?|my courses?"
    r")\b",
    re.I,
)
CANVAS_CONTENT_PATTERN = re.compile(
    r"\b("
    r"syllabus|lecture|slides?|readings?|exam|midterm|final|pset|problem sets?|"
    r"homework|notes on|study guide|module|office hours?|section|quiz|quizzes|diagnostic"
    r")\b",
    re.I,
)
SCHEDULE_QUERY_PATTERN = re.compile(
    r"\b(when(?:'s| is)|what(?:'s| is) due|due date|how long until)\b",
    re.I,
)
QUIZ_ASSIGNMENT_PATTERN = re.compile(
    r"\b(quiz|quizzes|diagnostic|assignment|assignments|pset|problem sets?|homework|tests?)\b",
    re.I,
)
COURSE_CODE_PATTERN = re.compile(r"\b[A-Z]{2,4}\s*\d{3}[A-Z]?\b", re.I)
MY_SCHEDULE_PATTERN = re.compile(r"\bmy\b", re.I)
GENERAL_CHAT_PATTERN = re.compile(
    r"\b("
    r"explain|what is|what are|how does|how do|why|define|summarize|help me understand|"
    r"tell me about|difference between|compare"
    r")\b",
    re.I,
)
SCREEN_PATTERN = re.compile(
    r"\b("
    r"on my screen|this page|what(?:'s| is) (?:here|visible|showing)|"
    r"currently (?:on|viewing)|what am i looking at"
    r")\b",
    re.I,
)
COURSE_HINT_PATTERN = re.compile(r"\b(course|canvas|class)\b", re.I)
PROBLEM_QUERY_PATTERN = re.compile(
    r"\b("
    r"help me (?:with|on|solve)|"
    r"i(?:'m| am) stuck(?: on)?|"
    r"how (?:do|can|should) i (?:solve|approach|start|do|work)|"
    r"(?:walk|talk) me through|"
    r"(?:give me )?(?:a )?hint(?: for)?|"
    r"solve (?:this|the|problem|question|exercise)|"
    r"(?:practice |worked )?(?:problem|exercise|question)\s*#?\d+|"
    r"(?:problem|question|exercise)\s*#?\d+|"
    r"pset\s*\d+\s*(?:q|question|problem)\s*\d+|"
    r"approach (?:this|the) (?:problem|question)"
    r")\b",
    re.I,
)


def is_grounded_explanation(text: str) -> bool:
    return bool(GENERAL_CHAT_PATTERN.search(str(text or "")))


def is_problem_query(text: str) -> bool:
    return bool(PROBLEM_QUERY_PATTERN.search(str(text or "")))


def needs_retrieval(
    route: SidekickRoute,
    text: str,
    *,
    hints: RouteContextHints | None = None,
) -> bool:
    lowered = str(text or "").strip()
    hints = hints or RouteContextHints()
    if not lowered:
        return False
    if route is SidekickRoute.TOOL:
        return False
    if is_problem_query(lowered):
        return True
    if route is SidekickRoute.CHAT:
        if not is_grounded_explanation(lowered):
            return False
        # Always retrieve for explanation-style queries so answers can ground in course material.
        return True
    if route is SidekickRoute.DATA:
        if SCREEN_PATTERN.search(lowered):
            return False
        if SCHEDULE_QUERY_PATTERN.search(lowered) and MY_SCHEDULE_PATTERN.search(lowered):
            return False
        if APP_DATA_PATTERN.search(lowered) and not CANVAS_CONTENT_PATTERN.search(lowered):
            return False
        return bool(
            CANVAS_CONTENT_PATTERN.search(lowered)
            or COURSE_HINT_PATTERN.search(lowered)
        )
    if route is SidekickRoute.FALLBACK:
        if len(lowered.split()) <= 4 and not (
            CANVAS_CONTENT_PATTERN.search(lowered)
            or COURSE_HINT_PATTERN.search(lowered)
            or is_problem_query(lowered)
        ):
            return False
        return True


def classify_message(
    text: str,
    *,
    has_attachments: bool = False,
    hints: RouteContextHints | None = None,
) -> RouteDecision:
    hints = hints or RouteContextHints()
    lowered = str(text or "").strip()
    if not lowered:
        return RouteDecision(
            SidekickRoute.FALLBACK,
            0.0,
            False,
            "empty_message",
        )

    if has_attachments:
        if TOOL_VERB_PATTERN.search(lowered):
            return RouteDecision(
                SidekickRoute.TOOL,
                0.95,
                False,
                "attachment_with_tool_verb",
            )
        return RouteDecision(
            SidekickRoute.FALLBACK,
            0.7,
            False,
            "attachment_review",
        )

    if SCREEN_PATTERN.search(lowered):
        return RouteDecision(
            SidekickRoute.DATA,
            0.88,
            False,
            "screen_context",
        )

    if SCHEDULE_QUERY_PATTERN.search(lowered) and MY_SCHEDULE_PATTERN.search(lowered):
        route = SidekickRoute.DATA
        return RouteDecision(
            route,
            0.86,
            needs_retrieval(route, lowered, hints=hints),
            "personal_schedule",
        )

    tool_hits = len(TOOL_VERB_PATTERN.findall(lowered))
    app_hit = bool(APP_DATA_PATTERN.search(lowered))
    canvas_hit = bool(CANVAS_CONTENT_PATTERN.search(lowered))
    general_hit = bool(GENERAL_CHAT_PATTERN.search(lowered))
    problem_hit = is_problem_query(lowered)

    if problem_hit and not (tool_hits and not app_hit):
        route = SidekickRoute.CHAT
        return RouteDecision(
            route,
            min(0.88, 0.72 + (0.08 if canvas_hit else 0) + (0.06 if hints.has_course_focus else 0)),
            needs_retrieval(route, lowered, hints=hints),
            "problem_solve",
            problem_query=True,
        )

    if general_hit and is_grounded_explanation(lowered):
        route = SidekickRoute.CHAT
        return RouteDecision(
            route,
            min(0.9, 0.75),
            needs_retrieval(route, lowered, hints=hints),
            "grounded_explain",
            grounded_explain=True,
            problem_query=problem_hit,
        )

    if tool_hits and not app_hit:
        confidence = min(0.96, 0.62 + tool_hits * 0.15)
        return RouteDecision(
            SidekickRoute.TOOL,
            confidence,
            False,
            "tool_verbs",
        )

    if app_hit or canvas_hit:
        confidence = min(0.94, 0.58 + (0.18 if app_hit else 0) + (0.16 if canvas_hit else 0))
        route = SidekickRoute.DATA
        return RouteDecision(
            route,
            confidence,
            needs_retrieval(route, lowered, hints=hints),
            "app_or_canvas_data",
        )

    if SCHEDULE_QUERY_PATTERN.search(lowered) and (
        MY_SCHEDULE_PATTERN.search(lowered)
        or COURSE_CODE_PATTERN.search(lowered)
        or QUIZ_ASSIGNMENT_PATTERN.search(lowered)
    ):
        route = SidekickRoute.DATA
        confidence = 0.86 if MY_SCHEDULE_PATTERN.search(lowered) else 0.78
        return RouteDecision(
            route,
            confidence,
            needs_retrieval(route, lowered, hints=hints),
            "schedule_query",
        )

    return RouteDecision(
        SidekickRoute.FALLBACK,
        0.35,
        needs_retrieval(SidekickRoute.FALLBACK, lowered, hints=hints),
        "low_confidence",
    )


def choose_model_route(decision: RouteDecision, *, min_confidence: float = 0.55) -> SidekickRoute:
    """Escalate uncertain routes to Claude."""
    if decision.route is SidekickRoute.FALLBACK:
        return SidekickRoute.FALLBACK
    if decision.confidence < min_confidence:
        return SidekickRoute.FALLBACK
    return decision.route
