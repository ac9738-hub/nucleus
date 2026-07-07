"""Format structured render-context snapshots for the sidekick system prompt."""


def _format_snapshot_scroll(scroll):
    if not isinstance(scroll, dict):
        return ""
    y = int(round(float(scroll.get("y") or 0)))
    viewport = int(round(float(scroll.get("viewportHeight") or 0)))
    content = int(round(float(scroll.get("contentHeight") or 0)))
    ratio = scroll.get("ratio")
    ratio_text = f", {round(float(ratio) * 100, 1)}%" if isinstance(ratio, (int, float)) else ""
    return f"scrollY={y}, viewport={viewport}, content={content}{ratio_text}"


def _format_index_week(week):
    if not isinstance(week, dict):
        return ""
    label = week.get("weekLabel") or "Week"
    date_range = week.get("dateRange") or ""
    header = f"{label} ({date_range})" if date_range else str(label)
    parts = [header]
    for key, title in (("assignments", "Assignments"), ("files", "Files"), ("events", "Events")):
        items = week.get(key) if isinstance(week.get(key), list) else []
        names = [str(item) for item in items if item]
        if names:
            parts.append(f"{title}: " + "; ".join(names))
    return "\n  ".join(parts)


def _format_index_section(index):
    if not isinstance(index, dict):
        return []

    lines = ["Indexed app state:"]

    courses = index.get("courses") if isinstance(index.get("courses"), list) else []
    if courses:
        course_bits = []
        for course in courses:
            if not isinstance(course, dict):
                continue
            code = course.get("code") or ""
            name = course.get("name") or course.get("id") or ""
            course_bits.append(f"{code} {name}".strip() if code else str(name))
        if course_bits:
            lines.append("Courses: " + ", ".join(course_bits[:20]))

    focus = index.get("focus")
    if isinstance(focus, dict):
        focus_bits = []
        if focus.get("courseId"):
            focus_bits.append(f"course {focus.get('courseId')}")
        if focus.get("courseSection"):
            focus_bits.append(f"section {focus.get('courseSection')}")
        if focus.get("nativePage"):
            focus_bits.append(f"page {focus.get('nativePage')}")
        file_info = focus.get("file") if isinstance(focus.get("file"), dict) else {}
        if file_info.get("filename"):
            pages = file_info.get("pageNumbers") if isinstance(file_info.get("pageNumbers"), list) else []
            page_text = f" p.{','.join(str(p) for p in pages)}" if pages else ""
            focus_bits.append(f"file {file_info.get('filename')}{page_text}")
        concepts = focus.get("concepts") if isinstance(focus.get("concepts"), list) else []
        if concepts:
            focus_bits.append("concepts: " + "; ".join(str(name) for name in concepts[:8]))
        if focus_bits:
            lines.append("Focus: " + ", ".join(focus_bits))

    due_soon = index.get("dueSoon") if isinstance(index.get("dueSoon"), list) else []
    if due_soon:
        lines.append(f"Due soon ({len(due_soon)}):")
        for item in due_soon[:16]:
            if not isinstance(item, dict):
                continue
            due = item.get("due_at") or ""
            name = item.get("name") or "Untitled"
            courseid = item.get("courseid") or ""
            lines.append(f"- [{courseid}] {name} — due {due}")

    tasks = index.get("tasks") if isinstance(index.get("tasks"), list) else []
    if tasks:
        lines.append(f"Tasks ({len(tasks)}):")
        for task in tasks[:20]:
            if not isinstance(task, dict):
                continue
            title = task.get("title") or "Untitled"
            due = task.get("due") or ""
            course = task.get("course") or ""
            suffix = f" ({course}, due {due})" if due or course else ""
            lines.append(f"- {title}{suffix}")

    weekly = index.get("weekly") if isinstance(index.get("weekly"), dict) else {}
    if weekly:
        lines.append("Weekly schedule (focus courses):")
        for courseid, entry in weekly.items():
            if not isinstance(entry, dict):
                continue
            lines.append(f"- Course {courseid}:")
            current = entry.get("current")
            if isinstance(current, dict):
                lines.append("  Current:\n  " + _format_index_week(current))
            nxt = entry.get("next")
            if isinstance(nxt, dict):
                lines.append("  Next:\n  " + _format_index_week(nxt))

    return lines


def _format_screen_chunks(screen):
    if not isinstance(screen, dict):
        return []
    chunks = screen.get("chunks") if isinstance(screen.get("chunks"), list) else []
    if not chunks:
        return []

    lines = [
        "On-screen source chunks (cite inline as [C#] when answering about visible content):",
    ]
    chars = len(lines[0])
    for chunk in chunks[:32]:
        if not isinstance(chunk, dict):
            continue
        cite = str(chunk.get("citeLabel") or "").strip()
        text = str(chunk.get("text") or "").strip()
        if not cite or not text:
            continue
        source = chunk.get("source") if isinstance(chunk.get("source"), dict) else {}
        meta_bits = []
        if source.get("fileid"):
            meta_bits.append(f"file={source.get('fileid')}")
        if source.get("pageNumber") not in (None, ""):
            meta_bits.append(f"p.{source.get('pageNumber')}")
        if source.get("tag"):
            meta_bits.append(str(source.get("tag")))
        meta = f" ({', '.join(meta_bits)})" if meta_bits else ""
        line = f"[{cite}]{meta} {text[:420]}"
        if chars + len(line) > 7600:
            lines.append("… (additional on-screen chunks omitted)")
            break
        lines.append(line)
        chars += len(line)
    return lines


def _format_screen_section(screen):
    if not isinstance(screen, dict):
        return []
    lines = ["On-screen content:"]
    title = screen.get("title") or ""
    url = screen.get("url") or ""
    if title:
        lines.append(f"Title: {title}")
    if url:
        lines.append(f"URL: {url}")
    scroll = screen.get("scroll") if isinstance(screen.get("scroll"), dict) else {}
    if scroll:
        lines.append(_format_snapshot_scroll(scroll))
    canvas = screen.get("canvas") if isinstance(screen.get("canvas"), dict) else None
    if canvas:
        if canvas.get("filename"):
            lines.append(f"Canvas file: {canvas.get('filename')}")
        concept_names = [
            str(item.get("name") or "")
            for item in (canvas.get("concepts") or [])
            if isinstance(item, dict) and item.get("name")
        ]
        if concept_names:
            lines.append("Visible concepts: " + "; ".join(concept_names[:8]))
    chunk_lines = _format_screen_chunks(screen)
    if chunk_lines:
        lines.append("")
        lines.extend(chunk_lines)
    return lines


def format_context_snapshot(snapshot):
    if not isinstance(snapshot, dict):
        return ""
    lines = ["Live app context (structured snapshot):"]

    app = snapshot.get("app") or {}
    surface = snapshot.get("surface") or {}
    nav_bits = []
    if app.get("top"):
        nav_bits.append(f"mode={app.get('top')}")
    if app.get("activeSection"):
        nav_bits.append(f"section={app.get('activeSection')}")
    if app.get("activeWorkspaceId"):
        nav_bits.append(f"workspace={app.get('activeWorkspaceId')}")
    if nav_bits:
        lines.append("Navigation: " + ", ".join(nav_bits))
    if surface.get("description"):
        lines.append(f"Currently rendered: {surface.get('description')}")
    surface_meta = []
    if surface.get("courseId"):
        surface_meta.append(f"course {surface.get('courseId')}")
    if surface.get("courseSection"):
        surface_meta.append(f"section {surface.get('courseSection')}")
    if surface.get("nativePage"):
        surface_meta.append(f"page {surface.get('nativePage')}")
    if surface.get("url"):
        surface_meta.append(f"url {surface.get('url')}")
    if surface_meta:
        lines.append("Surface: " + ", ".join(surface_meta))

    layout = snapshot.get("layout") or {}
    ai_panel = layout.get("aiPanel") or {}
    lines.append(
        "Layout: workspace sidebar "
        + ("collapsed" if layout.get("workspaceSidebarCollapsed") else "expanded")
        + ", assistant panel "
        + ("minimized" if ai_panel.get("minimized") else "open")
    )

    workspaces = snapshot.get("workspaces") or {}
    open_workspaces = workspaces.get("open") if isinstance(workspaces.get("open"), list) else []
    if open_workspaces:
        names = []
        for workspace in open_workspaces:
            if not isinstance(workspace, dict):
                continue
            name = workspace.get("name") or workspace.get("id") or ""
            count = len(workspace.get("openTabIds") or [])
            marker = "*" if workspace.get("id") == workspaces.get("active") else ""
            names.append(f"{marker}{name} ({count} tabs)")
        if names:
            lines.append(f"Workspaces ({len(names)}): " + ", ".join(names))

    active_tab = snapshot.get("activeTab")
    if isinstance(active_tab, dict):
        url = f" — {active_tab.get('url')}" if active_tab.get("url") else ""
        meta = []
        if active_tab.get("courseId"):
            meta.append(f"course: {active_tab.get('courseId')}")
        if active_tab.get("canvasMode"):
            meta.append(f"mode: {active_tab.get('canvasMode')}")
        if active_tab.get("courseSection"):
            meta.append(f"section: {active_tab.get('courseSection')}")
        if active_tab.get("canvasNativePage"):
            meta.append(f"page: {active_tab.get('canvasNativePage')}")
        meta_text = f" ({', '.join(meta)})" if meta else ""
        lines.append(
            f"Active tab: [{active_tab.get('type','')}] \"{active_tab.get('label','')}\"{url}{meta_text}"
        )
    else:
        lines.append("Active tab: none (home / launcher)")

    tabs = snapshot.get("tabs") if isinstance(snapshot.get("tabs"), list) else []
    lines.append(f"Open tabs ({len(tabs)}):")
    for tab in tabs:
        if not isinstance(tab, dict):
            continue
        flag = "* " if tab.get("active") else "  "
        meta = []
        if tab.get("workspaceId"):
            meta.append(f"ws: {tab.get('workspaceId')}")
        if tab.get("canvasMode"):
            meta.append(f"mode: {tab.get('canvasMode')}")
        if tab.get("courseId"):
            meta.append(f"course: {tab.get('courseId')}")
        if tab.get("courseSection"):
            meta.append(f"section: {tab.get('courseSection')}")
        meta_text = f" ({', '.join(meta)})" if meta else ""
        url = f" — {tab.get('url')}" if tab.get("url") else ""
        lines.append(f"{flag}[{tab.get('type','')}] \"{tab.get('label','')}\"{url}{meta_text}")

    index_lines = _format_index_section(snapshot.get("index"))
    if index_lines:
        lines.append("")
        lines.extend(index_lines)

    screen_lines = _format_screen_section(snapshot.get("screen"))
    if screen_lines:
        lines.append("")
        lines.extend(screen_lines)

    return "\n".join(lines)
