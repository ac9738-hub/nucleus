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
        lines.append(f"Active tab: [{active_tab.get('type','')}] \"{active_tab.get('label','')}\"{url}")
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
        meta_text = f" ({', '.join(meta)})" if meta else ""
        url = f" — {tab.get('url')}" if tab.get("url") else ""
        lines.append(f"{flag}[{tab.get('type','')}] \"{tab.get('label','')}\"{url}{meta_text}")

    screen = snapshot.get("screen")
    if isinstance(screen, dict):
        lines.append("")
        lines.append(f"On-screen content (source: {screen.get('source') or 'unknown'}):")
        if screen.get("url"):
            lines.append(f"URL: {screen.get('url')}")
        scroll_text = _format_snapshot_scroll(screen.get("scroll"))
        if scroll_text:
            lines.append(f"Viewport: {scroll_text}")
        canvas = screen.get("canvas")
        if isinstance(canvas, dict):
            if canvas.get("filename"):
                lines.append(f"File: {canvas.get('filename')} ({canvas.get('fileid','')})")
            pages = canvas.get("pages") if isinstance(canvas.get("pages"), list) else []
            page_nums = [str(p.get("pageNumber")) for p in pages if isinstance(p, dict) and p.get("pageNumber") is not None]
            if page_nums:
                lines.append("Visible pages: " + ", ".join(page_nums))
            for label in ("concepts", "details", "examples", "problems"):
                items = canvas.get(label) if isinstance(canvas.get(label), list) else []
                item_names = [str(i.get("name")) for i in items if isinstance(i, dict) and i.get("name")]
                if item_names:
                    lines.append(f"{label.capitalize()}: " + "; ".join(item_names[:8]))
        text_blocks = screen.get("text") if isinstance(screen.get("text"), list) else []
        if text_blocks:
            lines.append("Visible text:")
            for block in text_blocks[:24]:
                if not isinstance(block, dict) or not block.get("text"):
                    continue
                lines.append(f"- [{block.get('tag') or 'text'}] {block.get('text')}")
        else:
            lines.append("Visible text: (none captured)")

    return "\n".join(lines)
