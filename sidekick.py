"""Sidekick agent process.

Functionality: streams user prompts to the LLM, emits text/tool calls as
newline-delimited JSON for agent-process.js, and exposes workspace/Canvas tools.
Dependencies: Anthropic/OpenAI/Ollama clients and main.js tool responses.
"""
from anthropic import Anthropic
from openai import OpenAI
from dotenv import load_dotenv
from context_format import format_context_snapshot
from text_sanitize import clean_surrogates
from sidekick_context import (
    build_claude_system_prompt,
    build_grounding_instructions,
    build_stage_one_instructions,
    count_retrieved_entries,
    format_active_retrieval_slots,
    inject_call_context_into_messages,
)
from sidekick_router import SidekickRoute, choose_model_route, classify_message
import json
import sys
import os
import base64
import re


load_dotenv()
claude_client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
deepseek_client = OpenAI(api_key = os.environ.get("DEEP_SEEK_API_KEY"), base_url="https://api.deepseek.com")

MAX_ATTACHMENT_TEXT_CHARS = 60000


def _parse_tool_input(raw):
    text = str(raw or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except (json.JSONDecodeError, TypeError, ValueError):
        return {"_parse_error": True, "_raw": text[:500]}

system_prompt = (
    "You are LUMI, a helpful assistant for a student organization app called Nucleus. "
    "You have full control over in-app actions. if you call a tool summarize what you did. If not just answer whatever is asked with no extra commentary. Always call a tool if it can help accomplish the user's goal. If you have already addressed a user message in a previous response, do not address it again in future responses. Only address new user messages that have not yet been addressed. "
    "For academic and course-content questions (lectures, readings, problem sets, exams, concepts from class), base answers on retrieved Canvas passages and live course context — not general knowledge. When context is missing or insufficient, call retrieve_user_context with a focused search query before answering. Cite inline [R#] and [C#] labels for every course-specific claim drawn from those sources. "
    "For deliverables the student should keep (study guides, slides, charts, tables, flashcards, LaTeX worksheets, formatted notes), use create_artifact or update_artifact instead of pasting long formatted output in chat. "
    "Do not use markdown formatting."
)
runtime_system_context = ""
runtime_call_context = ""
runtime_course_graph_context = ""
runtime_rag_context = ""
runtime_screen_context = ""
runtime_context_snapshot = None
runtime_route = SidekickRoute.FALLBACK.value
runtime_require_citations = False
runtime_grounding_labels = {"retrieval": [], "screen": []}
runtime_retrieval_attempted = False
runtime_retrieval_empty = False
runtime_problem_query = False
runtime_academic_query = False
runtime_grounded_explain = False
runtime_active_slots = []
runtime_stage = 2
runtime_stage_mode = ""
stage_one_handoff_tool_ids = set()
DEEPSEEK_CHAT_MODEL = os.environ.get("SIDEKICK_DEEPSEEK_MODEL", "deepseek-chat")
CLAUDE_MODEL = os.environ.get("SIDEKICK_CLAUDE_MODEL", "claude-sonnet-4-6")
runtime_answer_mode = "grounded"
runtime_claude_model = CLAUDE_MODEL
ALLOWED_CLAUDE_MODELS = {
    "claude-sonnet-4-6",
    "claude-opus-4-8",
    "claude-haiku-4-5-20251001",
}
ALLOWED_DEEPSEEK_MODELS = {
    "deepseek-chat",
    "deepseek-reasoner",
}
GENERAL_MODE_SYSTEM_SUFFIX = (
    "The student selected General answer mode. Answer from broad knowledge and the live app "
    "snapshot. Do not call retrieve_user_context or invent course-specific Canvas material. "
    "Cite on-screen [C#] labels only when quoting visible UI text; do not use [R#] labels."
)
TOOL_USE_SILENCE_SUFFIX = (
    " When you need tools, call them immediately without writing planning notes, reasoning, "
    "or interim explanations. The student only sees your final answer after tools finish."
)
CITE_LABEL_PATTERN = re.compile(r"\[(?:C|R)\d+\]")
chat_history = []

CONTINUE_SIDEKICK_TOOL = {
    "name": "continue_sidekick",
    "description": (
        "Escalate to stage 2 when stage-1 context is insufficient. "
        "mode wait_for_context: search Canvas and answer with grounded citations. "
        "mode tool_use: enable full in-app tools (tasks, tabs, navigation, artifacts)."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "mode": {
                "type": "string",
                "enum": ["wait_for_context", "tool_use"],
                "description": (
                    "wait_for_context loads retrieved Canvas passages before answering. "
                    "tool_use enables full Nucleus tool actions."
                ),
            },
            "reason": {
                "type": "string",
                "description": "Brief reason for escalation (optional).",
            },
        },
        "required": ["mode"],
    },
}

STAGE_ONE_TOOLS = [CONTINUE_SIDEKICK_TOOL]

tools = [
    {
        "name": "add_task",
        "description": (
            "Add a new task to the user's task list. "
            "Priority weight should be between 1 and 10."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "task_name": {
                    "type": "string",
                    "description": "The name of the task."
                },
                "project_name": {
                    "type": "string",
                    "description": "The id of the project this task belongs to. Leave blank if unknown."
                },
                "priority_weight": {
                    "type": "number",
                    "description": "Priority between 1 (lowest) and 10 (highest)."
                },
                "prerequisites": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of task ids that must be completed first."
                }
            },
            "required": ["task_name", "priority_weight"]
        }
    },
    {
        "name": "open_browser_window",
        "description": (
            "Open a browser tab inside a Nucleus workspace. "
            "Use this when the user asks to open a non-Canvas website, document link, or search in a workspace. "
            "Do not use this for Canvas URLs; use open_canvas_tab for Canvas."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL or search text to open."
                },
                "workspaceid": {
                    "type": "string",
                    "description": "The id of the workspace where the browser tab should open."
                }
            },
            "required": ["url", "workspaceid"]
        }
    },
    {
        "name": "open_canvas_tab",
        "description": (
            "Open Canvas inside a dedicated Nucleus Canvas tab using the app's saved Canvas authentication. "
            "Use this for Canvas pages, Canvas files, Canvas assignments, Canvas preview URLs, or retrieved Canvas context URLs."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The Canvas URL to open. Leave blank to open the Canvas app dashboard."
                },
                "workspaceid": {
                    "type": "string",
                    "description": "The id of the workspace where the Canvas tab should open."
                },
                "courseId": {
                    "type": "string",
                    "description": "Optional Canvas course id, if known."
                }
            },
            "required": ["workspaceid"]
        }
    },
    {
        "name": "get_all_workspaces",
        "description": "Return all current Nucleus workspaces, including their ids and names.",
        "input_schema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "get_workspace_ids_by_name",
        "description": (
            "Find workspace ids by a workspace name or partial name. "
            "Use this before tools that require workspaceid when the user gives a human-readable workspace name."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "workspace_name": {
                    "type": "string",
                    "description": "The full or partial workspace name to search for."
                }
            },
            "required": ["workspace_name"]
        }
    },
    {
        "name": "create_workspace",
        "description": "Create a Nucleus workspace. Returns only the created workspace id, name, and description.",
        "input_schema": {
            "type": "object",
            "properties": {
                "workspaceid": {
                    "type": "string",
                    "description": "Stable workspace id, lowercase with hyphens."
                },
                "name": {
                    "type": "string",
                    "description": "Human-readable workspace name."
                },
                "description": {
                    "type": "string",
                    "description": "Short workspace description."
                }
            },
            "required": ["workspaceid", "name"]
        }
    },
    {
        "name": "delete_workspace",
        "description": "Delete a Nucleus workspace by id.",
        "input_schema": {
            "type": "object",
            "properties": {
                "workspaceid": {
                    "type": "string",
                    "description": "Workspace id to delete."
                }
            },
            "required": ["workspaceid"]
        }
    },
    {
        "name": "list_open_tabs",
        "description": "List open Nucleus tabs compactly, optionally for one workspace. Returns tab id, type, label, workspace id, URL, course id, and active flag.",
        "input_schema": {
            "type": "object",
            "properties": {
                "workspaceid": {
                    "type": "string",
                    "description": "Optional workspace id to filter tabs."
                }
            }
        }
    },
    {
        "name": "focus_tab",
        "description": "Focus an existing Nucleus tab by tab id.",
        "input_schema": {
            "type": "object",
            "properties": {
                "tabid": {
                    "type": "string",
                    "description": "Tab id to focus."
                }
            },
            "required": ["tabid"]
        }
    },
    {
        "name": "close_tab",
        "description": "Close an existing Nucleus tab by tab id. Center workspace tabs cannot be closed.",
        "input_schema": {
            "type": "object",
            "properties": {
                "tabid": {
                    "type": "string",
                    "description": "Tab id to close."
                }
            },
            "required": ["tabid"]
        }
    },
    {
        "name": "navigate_tab",
        "description": "Navigate an existing browser or Canvas tab to a URL or search query.",
        "input_schema": {
            "type": "object",
            "properties": {
                "tabid": {
                    "type": "string",
                    "description": "Tab id to navigate."
                },
                "url": {
                    "type": "string",
                    "description": "URL or search text."
                }
            },
            "required": ["tabid", "url"]
        }
    },
    {
        "name": "list_canvas_courses",
        "description": "List saved Canvas courses compactly. Returns course id, name, course code, and short description only.",
        "input_schema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "list_canvas_assignments",
        "description": "List saved Canvas assignments compactly, optionally filtered by course id. Returns id, name, course id, due date, URL, and short description only.",
        "input_schema": {
            "type": "object",
            "properties": {
                "courseid": {
                    "type": "string",
                    "description": "Optional Canvas course id."
                },
                "limit": {
                    "type": "number",
                    "description": "Maximum number of compact items to return. Defaults to 80 and caps at 200."
                }
            }
        }
    },
    {
        "name": "list_canvas_files",
        "description": "List saved Canvas files compactly, optionally filtered by course id. Returns id, name, course id, URL, and short description only.",
        "input_schema": {
            "type": "object",
            "properties": {
                "courseid": {
                    "type": "string",
                    "description": "Optional Canvas course id."
                },
                "limit": {
                    "type": "number",
                    "description": "Maximum number of compact items to return. Defaults to 80 and caps at 200."
                }
            }
        }
    },
    {
        "name": "list_canvas_modules",
        "description": "List saved Canvas modules compactly, optionally filtered by course id. Returns id, name, course id, position, and short description only.",
        "input_schema": {
            "type": "object",
            "properties": {
                "courseid": {
                    "type": "string",
                    "description": "Optional Canvas course id."
                },
                "limit": {
                    "type": "number",
                    "description": "Maximum number of compact items to return. Defaults to 80 and caps at 200."
                }
            }
        }
    },
    {
        "name": "refresh_canvas_data",
        "description": "Fetch Canvas data using saved Canvas authentication and save it to local Canvas data files. Returns compact counts only.",
        "input_schema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "retrieve_user_context",
        "description": (
            "Search the student's saved Canvas course material using semantic retrieval (RAG). "
            "Use when you need lecture notes, slides, problem statements, syllabus prose, exam topics, "
            "formulas, definitions, or other course content that is not already in the live app snapshot "
            "or active retrieval slots. For problem-solving help, set problem_query true so retrieval "
            "prioritizes linked concepts, examples, and course notation. "
            "Returns a slot id and cite labels; full passage text is injected into Active retrieval slots "
            "in the system prompt. Cite those labels when you use the passages."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Focused search query describing what Canvas material to find."
                },
                "course_id": {
                    "type": "string",
                    "description": "Optional Canvas course id to narrow the search. Defaults to the student's current course focus."
                },
                "grounded": {
                    "type": "boolean",
                    "description": "Set true for explanation-style queries that need more source passages. Defaults to false."
                },
                "problem_query": {
                    "type": "boolean",
                    "description": "Set true when searching for a specific problem, exercise, or pset question. Defaults to false."
                },
                "keep": {
                    "type": "boolean",
                    "description": "When true (default), keep this retrieval slot active for the rest of the turn. When false, use results once without adding to active slots."
                },
                "replace_slots": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional slot ids to remove before adding this retrieval (e.g. replace stale prefetch)."
                },
                "keep_slots": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional allowlist of existing slot ids to retain; drops other active slots."
                },
                "max_chunks": {
                    "type": "integer",
                    "description": "Optional cap on chunks returned for this retrieval (default 12)."
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "create_artifact",
        "description": (
            "Create a student-specific artifact the user can preview, edit, and download. "
            "Supported types: docx (Word), pptx (slides), latex (.tex), chart, graph, table, html, flashcards. "
            "Use flashcards for term/definition decks from the Canvas graph (from_graph + course_id) or explicit card lists."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Short artifact title shown in the artifact panel."
                },
                "type": {
                    "type": "string",
                    "enum": ["docx", "pptx", "latex", "chart", "graph", "table", "html", "flashcards"],
                    "description": "Artifact format."
                },
                "workspace_id": {
                    "type": "string",
                    "description": "Optional workspace id to associate with this artifact."
                },
                "course_id": {
                    "type": "string",
                    "description": "Optional Canvas course id for course-specific artifacts."
                },
                "description": {
                    "type": "string",
                    "description": "One-line summary of the artifact."
                },
                "content": {
                    "type": "object",
                    "description": (
                        "Type-specific payload. flashcards: {from_graph?, course_id?, node_types?, concept_ids?, max_cards?, cards:[{front,back,hint?,tags?,deck?}]}; "
                        "docx: {sections:[{heading, paragraphs[], bullets[]}]}; "
                        "pptx: {slides:[{title, bullets[]}]}; latex: {source}; "
                        "chart: {chart_type, labels[], datasets:[{label, values[]}]}; "
                        "graph: {nodes:[{id, label}], edges:[{from, to}]}; "
                        "table: {headers[], rows[][]}; html: {html, css?}."
                    )
                }
            },
            "required": ["title", "type", "content"]
        }
    },
    {
        "name": "update_artifact",
        "description": "Update an existing student artifact by id. Rebuilds preview and download files.",
        "input_schema": {
            "type": "object",
            "properties": {
                "artifact_id": {
                    "type": "string",
                    "description": "Artifact id returned by create_artifact or list_artifacts."
                },
                "title": {
                    "type": "string",
                    "description": "Optional new title."
                },
                "description": {
                    "type": "string",
                    "description": "Optional new summary."
                },
                "content": {
                    "type": "object",
                    "description": "Replacement type-specific content payload."
                }
            },
            "required": ["artifact_id", "content"]
        }
    },
    {
        "name": "list_artifacts",
        "description": "List saved student artifacts, optionally filtered by workspace or course.",
        "input_schema": {
            "type": "object",
            "properties": {
                "workspace_id": {"type": "string"},
                "course_id": {"type": "string"},
                "type": {"type": "string"},
                "limit": {"type": "number"}
            }
        }
    },
    {
        "name": "get_artifact",
        "description": "Fetch metadata for one artifact by id.",
        "input_schema": {
            "type": "object",
            "properties": {
                "artifact_id": {"type": "string"}
            },
            "required": ["artifact_id"]
        }
    },
    {
        "name": "open_artifact",
        "description": "Open an artifact in the current workspace as a new tab and show preview in LUMI. Prompts for workspace if none is active.",
        "input_schema": {
            "type": "object",
            "properties": {
                "artifact_id": {"type": "string"}
            },
            "required": ["artifact_id"]
        }
    }
]

def _message_text_from_prompt(prompt):
    if not prompt:
        return ""
    last = prompt[-1]
    if not isinstance(last, dict):
        return str(last or "")
    content = last.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
        return " ".join(part for part in parts if part).strip()
    return str(content or "")


def _normalize_answer_mode(value):
    return "general" if str(value or "").strip().lower() == "general" else "grounded"


def _normalize_claude_model(value):
    model = str(value or "").strip()
    if model in ALLOWED_CLAUDE_MODELS:
        return model
    if model in ALLOWED_DEEPSEEK_MODELS:
        return model
    return CLAUDE_MODEL


def _is_deepseek_model(model=None):
    resolved = str(model if model is not None else runtime_claude_model or "").strip()
    return resolved in ALLOWED_DEEPSEEK_MODELS


def _claude_model_id():
    model = _normalize_claude_model(runtime_claude_model)
    if _is_deepseek_model(model):
        return CLAUDE_MODEL
    return model


def _deepseek_model_id():
    model = _normalize_claude_model(runtime_claude_model)
    if model in ALLOWED_DEEPSEEK_MODELS:
        return model
    return DEEPSEEK_CHAT_MODEL


def _is_grounded_mode():
    return _normalize_answer_mode(runtime_answer_mode) == "grounded"


def _tools_for_stage(stage):
    if stage == 1:
        return STAGE_ONE_TOOLS
    if not _is_grounded_mode():
        return [tool for tool in tools if tool.get("name") != "retrieve_user_context"]
    return tools


def _system_prompt_for_mode(*, include_tools=False):
    if _is_grounded_mode():
        if include_tools:
            return system_prompt + TOOL_USE_SILENCE_SUFFIX
        return (
            "You are LUMI, a helpful assistant for a student organization app called Nucleus. "
            "Answer using the live app context and retrieved Canvas context when relevant. "
            "For academic or course-content questions, ground factual claims in those sources and "
            "cite inline [R#] and [C#] labels — do not invent course material or rely on general "
            "knowledge when course passages are available. "
            "Do not call tools. Respond concisely and directly. Do not use markdown formatting."
        )
    base = (
        "You are LUMI, a helpful assistant for a student organization app called Nucleus. "
        "You have full control over in-app actions. If you call a tool summarize what you did. "
        "If not just answer whatever is asked with no extra commentary. Always call a tool if it "
        "can help accomplish the user's goal. "
        "For deliverables the student should keep (study guides, slides, charts, tables, flashcards, "
        "LaTeX worksheets, formatted notes), use create_artifact or update_artifact instead of "
        "pasting long formatted output in chat. "
        "Do not use markdown formatting. "
        + GENERAL_MODE_SYSTEM_SUFFIX
    )
    if include_tools:
        return base + TOOL_USE_SILENCE_SUFFIX
    return (
        base
        + " Do not call tools. Respond concisely and directly."
    )


def _resolve_route(message_text, *, route_hint="", has_attachments=False):
    hinted = str(route_hint or runtime_route or "").strip().lower()
    if hinted in {route.value for route in SidekickRoute}:
        return SidekickRoute(hinted)
    decision = classify_message(message_text, has_attachments=has_attachments)
    resolved = choose_model_route(decision)
    print(
        f"[sidekick] route={resolved.value} confidence={decision.confidence:.2f} "
        f"reason={decision.reason} retrieval={decision.needs_retrieval}",
        file=sys.stderr,
    )
    return resolved


def _apply_layered_context(snapshot):
    global runtime_call_context, runtime_course_graph_context, runtime_rag_context, runtime_screen_context
    if not isinstance(snapshot, dict):
        return
    runtime_call_context = clean_surrogates(str(snapshot.get("callContext") or ""))
    runtime_course_graph_context = clean_surrogates(str(snapshot.get("courseGraphContext") or ""))
    runtime_rag_context = clean_surrogates(str(snapshot.get("ragContext") or ""))
    runtime_screen_context = clean_surrogates(str(snapshot.get("screenContext") or ""))


def _apply_retrieval_session(snapshot):
    global runtime_grounding_labels, runtime_active_slots
    if not isinstance(snapshot, dict):
        return
    _apply_layered_context(snapshot)
    labels = snapshot.get("groundingLabels")
    if isinstance(labels, dict):
        runtime_grounding_labels = labels
    slots = snapshot.get("activeSlots")
    runtime_active_slots = slots if isinstance(slots, list) else []
    if runtime_call_context.strip():
        print(
            "[sidekick] retrieval session updated "
            f"({len(runtime_call_context)} chars, "
            f"{len(runtime_active_slots)} slots)",
            file=sys.stderr,
        )


def _apply_stage_continue_payload(payload):
    global runtime_call_context, runtime_grounding_labels, runtime_active_slots
    global runtime_require_citations, runtime_retrieval_attempted, runtime_retrieval_empty
    global runtime_problem_query, runtime_academic_query, runtime_grounded_explain
    global runtime_stage, runtime_stage_mode, runtime_answer_mode, runtime_claude_model
    if not isinstance(payload, dict):
        return
    runtime_answer_mode = _normalize_answer_mode(payload.get("answerMode"))
    runtime_claude_model = _normalize_claude_model(payload.get("sidekickModel"))
    runtime_stage = 2
    runtime_stage_mode = clean_surrogates(str(payload.get("mode") or ""))
    runtime_require_citations = bool(payload.get("requireCitations"))
    runtime_retrieval_attempted = bool(payload.get("retrievalAttempted"))
    runtime_retrieval_empty = bool(payload.get("retrievalEmpty"))
    runtime_problem_query = bool(payload.get("problemQuery"))
    runtime_grounded_explain = bool(payload.get("groundedExplain"))
    runtime_academic_query = bool(
        payload.get("academicQuery")
        or runtime_problem_query
        or runtime_grounded_explain
    )
    labels = payload.get("groundingLabels")
    runtime_grounding_labels = labels if isinstance(labels, dict) else {"retrieval": [], "screen": []}
    session = payload.get("retrievalSession")
    if isinstance(session, dict):
        _apply_retrieval_session(session)
    else:
        _apply_layered_context(payload)
        runtime_active_slots = []
    print(
        "[sidekick] stage 2 continue "
        f"mode={runtime_stage_mode or 'unknown'} "
        f"context={len(runtime_call_context)} chars",
        file=sys.stderr,
    )


def _build_dynamic_system_prompt(*, include_tools_instructions=False, stage=2):
    snapshot_context = format_context_snapshot(runtime_context_snapshot) if runtime_context_snapshot else ""
    answer_mode = runtime_answer_mode
    if stage == 1:
        base = _system_prompt_for_mode(include_tools=True) + " " + build_stage_one_instructions(
            answer_mode=answer_mode
        )
        grounding = build_grounding_instructions(
            screen_labels=(runtime_grounding_labels or {}).get("screen") or [],
            academic_query=runtime_academic_query if _is_grounded_mode() else False,
            problem_query=runtime_problem_query if _is_grounded_mode() else False,
            answer_mode=answer_mode,
        )
        return clean_surrogates(
            build_claude_system_prompt(
                base,
                course_graph_context=runtime_course_graph_context if _is_grounded_mode() else "",
                rag_context=runtime_rag_context if _is_grounded_mode() else "",
                screen_context=runtime_screen_context if _is_grounded_mode() else "",
                call_context=runtime_call_context if _is_grounded_mode() else "",
                snapshot_context=snapshot_context,
                runtime_system_context=runtime_system_context,
                grounding_instructions=grounding,
            )
        )
    base = _system_prompt_for_mode(include_tools=include_tools_instructions)
    labels = runtime_grounding_labels if isinstance(runtime_grounding_labels, dict) else {}
    grounding = build_grounding_instructions(
        require_citations=runtime_require_citations if _is_grounded_mode() else False,
        retrieval_labels=labels.get("retrieval") or [],
        screen_labels=labels.get("screen") or [],
        retrieval_attempted=runtime_retrieval_attempted if _is_grounded_mode() else False,
        retrieval_empty=runtime_retrieval_empty if _is_grounded_mode() else False,
        problem_query=runtime_problem_query if _is_grounded_mode() else False,
        academic_query=runtime_academic_query if _is_grounded_mode() else False,
        active_slots=runtime_active_slots if _is_grounded_mode() else [],
        answer_mode=answer_mode,
    )
    slot_context = format_active_retrieval_slots(runtime_active_slots) if _is_grounded_mode() else ""
    return clean_surrogates(
        build_claude_system_prompt(
            base,
            course_graph_context=runtime_course_graph_context if _is_grounded_mode() else "",
            rag_context=runtime_rag_context if _is_grounded_mode() else "",
            screen_context=runtime_screen_context if _is_grounded_mode() else "",
            call_context=runtime_call_context if _is_grounded_mode() else "",
            snapshot_context=snapshot_context,
            runtime_system_context=runtime_system_context,
            extra_suffix=slot_context,
            grounding_instructions=grounding,
        )
    )


def answer_has_citations(text):
    return bool(CITE_LABEL_PATTERN.search(str(text or "")))


def repair_missing_citations(full_text):
    if not runtime_require_citations or answer_has_citations(full_text):
        return full_text
    labels = runtime_grounding_labels if isinstance(runtime_grounding_labels, dict) else {}
    retrieval = [str(label) for label in (labels.get("retrieval") or []) if label]
    screen = [str(label) for label in (labels.get("screen") or []) if label]
    if not retrieval and not screen:
        return full_text
    label_text = ", ".join(retrieval + screen)
    try:
        response = deepseek_client.chat.completions.create(
            model=DEEPSEEK_CHAT_MODEL,
            messages=clean_surrogates([
                {
                    "role": "system",
                    "content": (
                        "Rewrite the student's answer to include inline cite labels exactly as given. "
                        "Place each label at the end of the sentence that uses that source. "
                        "Output only the rewritten answer."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Available cite labels: {label_text}\n\nAnswer to rewrite:\n{full_text}",
                },
            ]),
            max_tokens=900,
        )
        repaired = str(response.choices[0].message.content or "").strip()
        if repaired and answer_has_citations(repaired):
            print("[sidekick] citation repair applied", file=sys.stderr)
            return repaired
    except Exception as error:
        print(f"[sidekick] citation repair failed: {error}", file=sys.stderr)
    return full_text


def emit_text_response(full_text, *, allow_repair=True):
    text = str(full_text or "")
    if allow_repair:
        text = repair_missing_citations(text)
        if text != full_text and text:
            print(json.dumps({"type": "replace", "text": text}), flush=True)
            return text
    return text


def run_classifier(prompt, *, route_hint="", has_attachments=False):
    message_text = _message_text_from_prompt(prompt)
    route = _resolve_route(message_text, route_hint=route_hint, has_attachments=has_attachments)
    if _is_deepseek_model():
        run_deepseek(prompt=chat_history, route=route)
        return
    if not _is_grounded_mode() and route in {SidekickRoute.CHAT, SidekickRoute.DATA}:
        run_deepseek(prompt=chat_history, route=route)
        return
    # Academic queries need retrieve_user_context; route to Claude (tools enabled).
    if runtime_academic_query or route in {SidekickRoute.TOOL, SidekickRoute.FALLBACK}:
        runclaude(prompt=chat_history)
        return
    run_deepseek(prompt=chat_history, route=route)


def _deepseek_request_kwargs(model_id):
    kwargs = {"model": model_id, "stream": True, "max_tokens": 1000}
    if model_id == "deepseek-reasoner":
        kwargs["extra_body"] = {"thinking": {"type": "disabled"}}
    return kwargs


def _finalize_claude_turn(*, full_text, tool_calls, stage):
    """Build assistant history; only expose text to the UI on non-tool turns."""
    parsed_tools = []
    for tool in (tool_calls or {}).values():
        parsed = dict(tool)
        parsed["input"] = _parse_tool_input(parsed.get("input"))
        parsed_tools.append(parsed)

    assistant_content = []
    user_visible_text = ""
    total_tools_called = []

    if parsed_tools:
        for tool in parsed_tools:
            if stage == 1 and tool.get("name") == "continue_sidekick":
                stage_one_handoff_tool_ids.add(tool["id"])
            assistant_content.append({
                "type": "tool_use",
                "id": tool["id"],
                "name": tool["name"],
                "input": tool["input"],
            })
            total_tools_called.append({
                "type": "tool",
                "name": tool["name"],
                "input": tool["input"],
                "id": tool["id"],
            })
    elif full_text:
        user_visible_text = full_text
        assistant_content.append({"type": "text", "text": full_text})

    return assistant_content, total_tools_called, user_visible_text


def _emit_user_visible_text(full_text, *, allow_repair=True):
    text = str(full_text or "")
    if not text.strip():
        return ""
    final_text = emit_text_response(text, allow_repair=allow_repair)
    print(json.dumps(final_text), flush=True)
    return final_text


def run_deepseek(prompt, *, route=SidekickRoute.DATA):
    model_id = _deepseek_model_id()
    print(f"py: running deepseek ({model_id}) route={route.value}", file=sys.stderr)
    system_prompt_text = _build_dynamic_system_prompt(include_tools_instructions=False)
    openai_messages = [{"role": "system", "content": system_prompt_text}]
    for message in prompt or []:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        content = message.get("content")
        if role not in {"user", "assistant"}:
            continue
        if isinstance(content, list):
            text_parts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text_parts.append(str(block.get("text") or ""))
            openai_messages.append({"role": role, "content": "\n".join(text_parts).strip() or "(empty)"})
        else:
            openai_messages.append({"role": role, "content": str(content or "")})

    full_text = ""
    request_kwargs = _deepseek_request_kwargs(model_id)
    request_kwargs["messages"] = clean_surrogates(openai_messages)
    response = deepseek_client.chat.completions.create(**request_kwargs)

    for chunk in response:
        delta = chunk.choices[0].delta if chunk.choices else None
        if not delta:
            continue
        if getattr(delta, "reasoning_content", None):
            continue
        if not delta.content:
            continue
        full_text += delta.content

    if full_text:
        final_text = emit_text_response(full_text, allow_repair=True)
        _emit_user_visible_text(final_text, allow_repair=False)
        chat_history.append({"role": "assistant", "content": final_text})
    print(json.dumps({"type": "done"}), flush=True)


def run_stage_one(prompt):
    print("[sidekick] running stage 1 triage", file=sys.stderr)
    runclaude(prompt=prompt, active_tools=STAGE_ONE_TOOLS, stage=1)


def runclaude(prompt, *, active_tools=None, stage=2):
    print(f"py: running claude stage={stage} mode={runtime_answer_mode}: {prompt}", file=sys.stderr)
    active_tools = _tools_for_stage(stage) if active_tools is None else active_tools
    tool_calls = {}
    full_text = ""
    model_messages = clean_surrogates(list(prompt or []))
    dynamic_system_prompt = _build_dynamic_system_prompt(
        include_tools_instructions=(stage >= 2),
        stage=stage,
    )
    if runtime_call_context.strip():
        print(
            "[sidekick] injecting callContext into Claude prompt "
            f"({len(runtime_call_context)} chars, "
            f"{count_retrieved_entries(runtime_call_context)} entries)",
            file=sys.stderr,
        )
    response = claude_client.messages.create(
        model=_claude_model_id(),
        max_tokens=1000,
        system=dynamic_system_prompt,
        messages=model_messages,
        tools=active_tools,
        stream=True
    )

    for event in response:
        if event.type == "content_block_start":
            if event.content_block.type == "tool_use":
                tool_calls[event.index] = {
                    "id": event.content_block.id,
                    "name": event.content_block.name,
                    "input": ""
                }
            # remove the else block entirely

        elif event.type == "content_block_delta":
            if event.delta.type == "text_delta":
                full_text += event.delta.text
            elif event.delta.type == "input_json_delta":
                if event.index in tool_calls:
                    tool_calls[event.index]["input"] += event.delta.partial_json

        elif event.type == "message_stop":
            assistant_content, total_tools_called, user_visible_text = _finalize_claude_turn(
                full_text=full_text,
                tool_calls=tool_calls,
                stage=stage,
            )

            if total_tools_called:
                if assistant_content:
                    chat_history.append({
                        "role": "assistant",
                        "content": assistant_content,
                    })
                print(json.dumps(total_tools_called), flush=True)
            else:
                final_text = ""
                if user_visible_text.strip():
                    final_text = emit_text_response(user_visible_text, allow_repair=True)
                if final_text and assistant_content and assistant_content[0].get("type") == "text":
                    assistant_content[0]["text"] = final_text
                if assistant_content:
                    chat_history.append({
                        "role": "assistant",
                        "content": assistant_content,
                    })
                if final_text:
                    print(json.dumps(final_text), flush=True)
                print(json.dumps({"type": "done"}), flush=True)


def attachment_to_content_blocks(attachment):
    if not isinstance(attachment, dict):
        return []

    name = str(attachment.get("name") or "Attachment")
    media_type = str(attachment.get("type") or "application/octet-stream")
    kind = str(attachment.get("kind") or "metadata")
    note = str(attachment.get("note") or "")
    size = attachment.get("size", "")
    blocks = []

    if kind == "image" and attachment.get("data"):
        blocks.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": attachment.get("data")
            }
        })
        blocks.append({
            "type": "text",
            "text": f"Attached screenshot/image: {name}"
        })
        return blocks

    if kind == "document" and attachment.get("data") and media_type == "application/pdf":
        try:
            import fitz
            pdf_bytes = base64.b64decode(attachment.get("data"))
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            pages = [page.get_text() for page in doc]
            doc.close()
            blocks.append({
                "type": "text",
                "text": (
                    f"Attached PDF: {name}\n"
                    f"Extracted text:\n{('\\n'.join(pages))[:MAX_ATTACHMENT_TEXT_CHARS]}"
                )
            })
        except Exception as error:
            blocks.append({
                "type": "text",
                "text": f"Attached PDF: {name}. Could not extract text: {error}"
            })
        return blocks

    if kind == "text":
        text = str(attachment.get("text") or "")
        blocks.append({
            "type": "text",
            "text": (
                f"Attached text file: {name}\n"
                f"Media type: {media_type}\n"
                f"Content:\n{text[:MAX_ATTACHMENT_TEXT_CHARS]}"
            )
        })
        return blocks

    blocks.append({
        "type": "text",
        "text": f"Attached file metadata: {name} ({media_type}, {size} bytes). {note}".strip()
    })
    return blocks


def message_payload_to_text_and_content(payload):
    if isinstance(payload, str):
        return payload, payload

    if not isinstance(payload, dict):
        text = str(payload or "")
        return text, text

    text = str(payload.get("text") or "")
    attachments = payload.get("attachments") if isinstance(payload.get("attachments"), list) else []
    content = []
    if text:
        content.append({"type": "text", "text": text})
    for attachment in attachments:
        content.extend(attachment_to_content_blocks(attachment))

    if not content:
        content.append({"type": "text", "text": "User sent empty attachments."})
    return text, content


def _tool_response_is_stage_handoff(tool_use_id):
    tool_id = str(tool_use_id or "")
    if not tool_id or tool_id not in stage_one_handoff_tool_ids:
        return False
    stage_one_handoff_tool_ids.discard(tool_id)
    return True


def run_service():
    for line in sys.stdin:
        print(line, file=sys.stderr )
        line = json.loads(line)
        if line[0] == "tool_response":
            tool_use_id = line[1]
            chat_history.append({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": clean_surrogates(line[2]),
                }],
            })
            if _tool_response_is_stage_handoff(tool_use_id):
                print("[sidekick] stage 1 handoff acknowledged; waiting for stage_continue", file=sys.stderr)
                continue
            if _is_deepseek_model():
                run_deepseek(prompt=chat_history)
            else:
                runclaude(prompt=chat_history)
        elif line[0] == "tool_response_batch":
            batch = line[1] if len(line) > 1 and isinstance(line[1], list) else []
            tool_results = []
            pending_handoff = False
            for entry in batch:
                if not isinstance(entry, list) or len(entry) < 3:
                    continue
                tool_use_id = entry[1]
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": clean_surrogates(entry[2]),
                })
                if str(tool_use_id or "") in stage_one_handoff_tool_ids:
                    pending_handoff = True
            if tool_results:
                chat_history.append({"role": "user", "content": tool_results})
                if pending_handoff:
                    for result in tool_results:
                        _tool_response_is_stage_handoff(result.get("tool_use_id"))
                    print("[sidekick] stage 1 handoff acknowledged; waiting for stage_continue", file=sys.stderr)
                    continue
                if _is_deepseek_model():
                    run_deepseek(prompt=chat_history)
                else:
                    runclaude(prompt=chat_history)
        elif line[0] == "stage_continue":
            _apply_stage_continue_payload(line[1] if len(line) > 1 else {})
            if _is_deepseek_model():
                run_deepseek(prompt=chat_history)
            else:
                runclaude(prompt=chat_history, stage=2)
        elif line[0] == "retrieval_session":
            _apply_retrieval_session(line[1] if len(line) > 1 else {})
        elif line[0] == "message":
            message_text, message_content = message_payload_to_text_and_content(line[1])
            global runtime_system_context, runtime_call_context, runtime_route
            global runtime_require_citations, runtime_grounding_labels, runtime_context_snapshot
            global runtime_retrieval_attempted, runtime_retrieval_empty, runtime_problem_query
            global runtime_academic_query, runtime_grounded_explain, runtime_active_slots
            global runtime_stage, runtime_stage_mode, runtime_answer_mode, runtime_claude_model
            stage_one_handoff_tool_ids.clear()
            runtime_stage = 1
            runtime_stage_mode = ""
            if isinstance(line[1], dict):
                runtime_answer_mode = _normalize_answer_mode(line[1].get("answerMode"))
                runtime_claude_model = _normalize_claude_model(line[1].get("sidekickModel"))
                runtime_system_context = clean_surrogates(str(line[1].get("systemContext") or ""))
                runtime_call_context = clean_surrogates(str(line[1].get("callContext") or ""))
                runtime_route = clean_surrogates(str(line[1].get("route") or SidekickRoute.FALLBACK.value))
                runtime_require_citations = bool(line[1].get("requireCitations"))
                runtime_retrieval_attempted = bool(line[1].get("retrievalAttempted"))
                runtime_retrieval_empty = bool(line[1].get("retrievalEmpty"))
                runtime_problem_query = bool(line[1].get("problemQuery")) and _is_grounded_mode()
                runtime_grounded_explain = bool(line[1].get("groundedExplain")) and _is_grounded_mode()
                runtime_academic_query = bool(
                    line[1].get("academicQuery")
                    or runtime_problem_query
                    or runtime_grounded_explain
                ) and _is_grounded_mode()
                labels = line[1].get("groundingLabels")
                runtime_grounding_labels = labels if isinstance(labels, dict) else {"retrieval": [], "screen": []}
                session = line[1].get("retrievalSession")
                if isinstance(session, dict):
                    _apply_retrieval_session(session)
                else:
                    runtime_active_slots = []
                snapshot = line[1].get("contextSnapshot")
                runtime_context_snapshot = clean_surrogates(snapshot) if isinstance(snapshot, dict) else None
                if runtime_call_context.strip():
                    print(
                        "[sidekick] callContext received from main "
                        f"({len(runtime_call_context)} chars, "
                        f"{count_retrieved_entries(runtime_call_context)} entries)",
                        file=sys.stderr,
                    )
                else:
                    print("[sidekick] callContext empty (no retrieval results)", file=sys.stderr)
            else:
                runtime_system_context = ""
                runtime_call_context = ""
                runtime_route = SidekickRoute.FALLBACK.value
                runtime_require_citations = False
                runtime_grounding_labels = {"retrieval": [], "screen": []}
                runtime_retrieval_attempted = False
                runtime_retrieval_empty = False
                runtime_problem_query = False
                runtime_academic_query = False
                runtime_grounded_explain = False
                runtime_active_slots = []
                runtime_answer_mode = "grounded"
                runtime_claude_model = CLAUDE_MODEL
                runtime_context_snapshot = None
            chat_history.append({"role": "user", "content": clean_surrogates(message_content)})
            has_attachments = (
                isinstance(line[1], dict)
                and isinstance(line[1].get("attachments"), list)
                and len(line[1]["attachments"]) > 0
            )
            payload_stage = 1
            if isinstance(line[1], dict):
                try:
                    payload_stage = int(line[1].get("stage") or 1)
                except (TypeError, ValueError):
                    payload_stage = 1
            if payload_stage == 1 and not _is_deepseek_model():
                run_stage_one(prompt=chat_history)
            else:
                run_classifier(
                    prompt=[{"role": "user", "content": message_text}],
                    route_hint=runtime_route,
                    has_attachments=has_attachments,
                )


if __name__ == "__main__":
    run_service()
