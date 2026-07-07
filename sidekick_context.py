"""Attach retrieved Canvas context to sidekick Claude prompts."""


def inject_call_context_into_messages(messages, call_context):
    """Append retrieved context as a text block on the latest user turn."""
    call_context = str(call_context or "").strip()
    if not call_context or not messages:
        return list(messages or [])

    last = messages[-1]
    if not isinstance(last, dict) or last.get("role") != "user":
        return list(messages)

    content = last.get("content")
    extra_block = {"type": "text", "text": call_context}
    if isinstance(content, str):
        merged = [{"type": "text", "text": content}, extra_block]
    elif isinstance(content, list):
        merged = content + [extra_block]
    else:
        merged = [extra_block]

    return list(messages[:-1]) + [{"role": "user", "content": merged}]


def build_claude_system_prompt(
    base_prompt,
    *,
    call_context="",
    course_graph_context="",
    rag_context="",
    screen_context="",
    snapshot_context="",
    runtime_system_context="",
    extra_suffix="",
    grounding_instructions="",
):
    """Merge context layers for cache-friendly prefix stability (stable → dynamic)."""
    parts = [str(base_prompt or "").strip()]
    if runtime_system_context and str(runtime_system_context).strip():
        parts.append(str(runtime_system_context).strip())
    if course_graph_context and str(course_graph_context).strip():
        parts.append(str(course_graph_context).strip())
    if rag_context and str(rag_context).strip():
        parts.append(str(rag_context).strip())
    elif call_context and str(call_context).strip() and not course_graph_context:
        parts.append(str(call_context).strip())
    if snapshot_context and str(snapshot_context).strip():
        parts.append("Live app context:\n" + str(snapshot_context).strip())
    if screen_context and str(screen_context).strip():
        parts.append(str(screen_context).strip())
    if grounding_instructions and str(grounding_instructions).strip():
        parts.append(str(grounding_instructions).strip())
    if extra_suffix and str(extra_suffix).strip():
        parts.append(str(extra_suffix).strip())
    return "\n\n".join(part for part in parts if part)


def build_grounding_instructions(
    *,
    require_citations=False,
    retrieval_labels=None,
    screen_labels=None,
    retrieval_attempted=False,
    retrieval_empty=False,
    problem_query=False,
    academic_query=False,
    active_slots=None,
    answer_mode="grounded",
):
    """Prompt the model to cite [R#]/[C#] labels when using injected source chunks."""
    if str(answer_mode or "").strip().lower() == "general":
        parts = [
            "General answer mode:",
            "Answer from broad knowledge and the live app snapshot. Canvas retrieval and [R#] "
            "citations are disabled.",
            "Do not call retrieve_user_context or present course-specific facts as if sourced "
            "from this student's Canvas.",
        ]
        screen_labels = [label for label in (screen_labels or []) if label]
        if screen_labels:
            parts.append(
                "On-screen [C#] labels may be cited only when quoting visible UI text: "
                + ", ".join(screen_labels[:24])
            )
        return "\n".join(parts)

    retrieval_labels = [label for label in (retrieval_labels or []) if label]
    screen_labels = [label for label in (screen_labels or []) if label]
    if (
        not require_citations
        and not retrieval_labels
        and not screen_labels
        and not retrieval_attempted
        and not problem_query
        and not academic_query
    ):
        return ""

    parts = [
        "Grounding rules:",
        "Course-specific facts (assignments, exams, lecture content, problem statements, "
        "grading policy, due dates, definitions taught in class) must come only from the "
        "live app context or retrieved Canvas passages below — do not invent course material "
        "or answer from general knowledge when course sources are expected.",
    ]
    if academic_query:
        parts.append(
            "This is an academic or course-content question. Prefer retrieved Canvas passages "
            "and on-screen source chunks over general knowledge. If the context below is thin, "
            "off-topic, or missing details you need, call retrieve_user_context with a focused "
            "search query before answering."
        )
    if problem_query:
        parts.append(
            "This is a problem-solving request. Use retrieved problem nodes, linked concepts, "
            "course formulas/definitions from the course graph block, and "
            "worked examples as your primary evidence. Match the course's notation, variable "
            "names, and step style from those sources — do not substitute a generic textbook method "
            "when the course teaches a different approach. Give hints and guiding questions first; "
            "do not reveal an official answer unless the student explicitly asks for the full "
            "solution and a retrieved source contains it."
        )
    if retrieval_attempted and retrieval_empty:
        parts.append(
            "Retrieval ran but returned no matching Canvas material for this question. "
            "Say clearly that you could not find relevant course content. Do not fabricate "
            "problem statements, solutions, or course-specific details. You may offer general "
            "study advice only if you label it as general knowledge with no cite labels."
        )
    parts.extend([
        "When your answer uses retrieved Canvas passages or on-screen source chunks, "
        "you MUST cite them inline using the exact labels shown (for example [R1], [C2]) "
        "at the end of the sentence that uses that source.",
        "Do not invent cite labels. If no provided chunk applies, answer without cite labels.",
    ])
    if require_citations:
        parts.append(
            "Source labels are available below. Include at least one inline [R#] and/or [C#] "
            "cite for every claim you take from those sources."
        )
    if retrieval_labels:
        parts.append("Retrieved labels available: " + ", ".join(retrieval_labels[:24]))
    if screen_labels:
        parts.append("On-screen labels available: " + ", ".join(screen_labels[:24]))
    active = [slot for slot in (active_slots or []) if isinstance(slot, dict) and slot.get("id")]
    if active:
        slot_ids = ", ".join(str(slot.get("id")) for slot in active[:12])
        parts.append(
            "Active retrieval slot ids: " + slot_ids + ". "
            "Use grounded source chunks and these labels; do not expect full passage text in tool results."
        )
    return "\n".join(parts)


def build_stage_one_instructions(*, answer_mode="grounded"):
    """Prompt for the fast stage-1 triage pass."""
    if str(answer_mode or "").strip().lower() == "general":
        return (
            "Stage 1 triage (General mode): answer immediately using general knowledge and the live "
            "app snapshot. Do not search Canvas or cite course materials. "
            "When the user wants in-app actions (tasks, workspaces, tabs, browser or Canvas "
            "navigation, artifacts, Canvas list/read tools), call continue_sidekick with "
            "mode tool_use only. "
            "Do not call continue_sidekick with wait_for_context in General mode. "
            "Stage 1 only exposes continue_sidekick — do not call any other tool."
        )
    return (
        "Stage 1 triage: answer immediately when the live app snapshot and on-screen source "
        "chunks are enough. Do not invent course material from general knowledge. "
        "When the user needs Canvas search, lecture or syllabus content, exam topics, problem "
        "statements, or grounded [R#]/[C#] citations, call continue_sidekick with "
        "mode wait_for_context. "
        "When the user wants in-app actions (tasks, workspaces, tabs, browser or Canvas "
        "navigation, artifacts, Canvas list/read tools), call continue_sidekick with "
        "mode tool_use. "
        "Stage 1 only exposes continue_sidekick — do not call any other tool."
    )


def count_retrieved_entries(call_context):
    """Count numbered retrieval entries produced by formatRetrievalContext."""
    return str(call_context or "").count("\n1. [")


def format_active_retrieval_slots(active_slots):
    """Summarize active retrieval slot metadata for the system prompt."""
    slots = [slot for slot in (active_slots or []) if isinstance(slot, dict) and slot.get("id")]
    if not slots:
        return ""
    lines = ["Active retrieval slots (passage text is in grounded source chunks above):"]
    for slot in slots[:12]:
        slot_id = str(slot.get("id") or "").strip()
        query = str(slot.get("query") or "").strip()
        labels = [label for label in (slot.get("labels") or []) if label]
        label_text = ", ".join(labels[:16])
        chunk_count = slot.get("chunkCount")
        meta = f"labels=[{label_text}]" if label_text else "labels=[]"
        if chunk_count is not None:
            meta += f" chunks={chunk_count}"
        if slot.get("truncated"):
            meta += " truncated"
        lines.append(f"- {slot_id}: {query or '(no query)'} ({meta})")
    return "\n".join(lines)
