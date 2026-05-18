import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone


CANVAS_API_LIMIT = 100


def load_env_file():
    """Load simple KEY=VALUE pairs from .env without requiring python-dotenv."""
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(env_path):
        return

    with open(env_path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key.strip(), value)


def success(**payload):
    return {"ok": True, **payload}


def failure(message):
    return {"ok": False, "error": message}


def get_canvas_base_url(payload):
    base_url = payload.get("base_url") or os.environ.get("CANVAS_BASE_URL")
    if not base_url:
        raise ValueError("Missing CANVAS_BASE_URL, for example https://school.instructure.com")
    return base_url.rstrip("/")


def get_canvas_access_token(payload):
    token = payload.get("access_token") or os.environ.get("CANVAS_ACCESS_TOKEN")
    if not token:
        raise ValueError("Missing CANVAS_ACCESS_TOKEN")
    return token


def canvas_request(url, access_token=None, method="GET", form=None):
    headers = {"Accept": "application/json"}
    body = None

    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    if form is not None:
        body = urllib.parse.urlencode(form).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"

    request = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            text = response.read().decode("utf-8")
            data = json.loads(text) if text else {}
            return data, response.headers
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8")
        message = text or error.reason
        raise RuntimeError(f"Canvas API error {error.code}: {message}")


def get_next_page_url(headers):
    link_header = headers.get("Link")
    if not link_header:
        return None

    for link in link_header.split(","):
        link = link.strip()
        if 'rel="next"' not in link:
            continue

        start = link.find("<")
        end = link.find(">")
        if start != -1 and end != -1:
            return link[start + 1:end]

    return None


def canvas_get_all(base_url, access_token, endpoint, params=None):
    params = params or {}
    params.setdefault("per_page", CANVAS_API_LIMIT)

    query = urllib.parse.urlencode(params, doseq=True)
    url = f"{base_url}/api/v1/{endpoint.lstrip('/')}"
    if query:
        url = f"{url}?{query}"

    items = []
    while url:
        page, headers = canvas_request(url, access_token=access_token)
        if isinstance(page, list):
            items.extend(page)
        else:
            items.append(page)
        url = get_next_page_url(headers)

    return items


def exchange_auth_code(payload):
    """Exchange an OAuth auth code for Canvas access and refresh tokens."""
    base_url = get_canvas_base_url(payload)
    auth_code = payload.get("auth_code") or os.environ.get("CANVAS_AUTH_CODE")
    client_id = payload.get("client_id") or os.environ.get("CANVAS_CLIENT_ID")
    client_secret = payload.get("client_secret") or os.environ.get("CANVAS_CLIENT_SECRET")
    redirect_uri = payload.get("redirect_uri") or os.environ.get("CANVAS_REDIRECT_URI")

    missing = [
        name for name, value in {
            "CANVAS_AUTH_CODE": auth_code,
            "CANVAS_CLIENT_ID": client_id,
            "CANVAS_CLIENT_SECRET": client_secret,
            "CANVAS_REDIRECT_URI": redirect_uri,
        }.items()
        if not value
    ]
    if missing:
        raise ValueError(f"Missing OAuth values: {', '.join(missing)}")

    token_url = f"{base_url}/login/oauth2/token"
    token_data, _headers = canvas_request(
        token_url,
        method="POST",
        form={
            "grant_type": "authorization_code",
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "code": auth_code,
        },
    )

    return success(
        message="Auth code exchanged. Save token.access_token as CANVAS_ACCESS_TOKEN in .env.",
        token={
            "access_token": token_data.get("access_token"),
            "refresh_token": token_data.get("refresh_token"),
            "expires_in": token_data.get("expires_in"),
            "token_type": token_data.get("token_type"),
        },
    )


def simplify_course(course):
    return {
        "id": course.get("id"),
        "name": course.get("name") or course.get("course_code"),
        "course_code": course.get("course_code"),
        "workflow_state": course.get("workflow_state"),
    }


def simplify_assignment(assignment, course):
    return {
        "id": assignment.get("id"),
        "course_id": course.get("id"),
        "course_name": course.get("name"),
        "name": assignment.get("name"),
        "due_at": assignment.get("due_at"),
        "points_possible": assignment.get("points_possible"),
        "html_url": assignment.get("html_url"),
    }


def simplify_todo(todo):
    assignment = todo.get("assignment") or {}
    course = todo.get("course") or {}

    return {
        "type": todo.get("type"),
        "course_id": course.get("id"),
        "course_name": course.get("name"),
        "assignment_id": assignment.get("id"),
        "title": assignment.get("name") or todo.get("title"),
        "due_at": assignment.get("due_at"),
        "html_url": assignment.get("html_url") or todo.get("html_url"),
    }


def sync_canvas(payload):
    """Fetch active courses, upcoming assignments, and Canvas todo items."""
    base_url = get_canvas_base_url(payload)
    access_token = get_canvas_access_token(payload)

    raw_courses = canvas_get_all(
        base_url,
        access_token,
        "courses",
        {
            "enrollment_state": "active",
            "include[]": ["term", "total_scores"],
        },
    )
    courses = [simplify_course(course) for course in raw_courses if course.get("id")]

    max_courses = int(payload.get("max_courses") or 12)
    assignment_bucket = payload.get("assignment_bucket", "upcoming")
    assignments = []

    for course in courses[:max_courses]:
        try:
            raw_assignments = canvas_get_all(
                base_url,
                access_token,
                f"courses/{course['id']}/assignments",
                {"bucket": assignment_bucket},
            )
            assignments.extend(
                simplify_assignment(assignment, course)
                for assignment in raw_assignments
                if assignment.get("id")
            )
        except RuntimeError as error:
            assignments.append({
                "course_id": course["id"],
                "course_name": course["name"],
                "error": str(error),
            })

    todos = [
        simplify_todo(todo)
        for todo in canvas_get_all(base_url, access_token, "users/self/todo")
    ]

    return success(
        source=base_url,
        synced_at=datetime.now(timezone.utc).isoformat(),
        courses=courses,
        assignments=assignments,
        todos=todos,
    )


def build_canvas(payload):
    title = payload.get("title", "Untitled canvas")
    workspace = payload.get("workspace", "Nucleus")

    return success(
        canvas={
            "title": title,
            "workspace": workspace,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "nodes": [
                {
                    "id": "start",
                    "type": "note",
                    "text": f"Canvas scaffold for {title}",
                }
            ],
            "edges": [],
        }
    )


def handle(payload):
    action = payload.get("action", "build_canvas")

    if action == "build_canvas":
        return build_canvas(payload)
    if action == "exchange_auth_code":
        return exchange_auth_code(payload)
    if action == "sync_canvas":
        return sync_canvas(payload)

    raise ValueError(f"Unknown action: {action}")


def main():
    load_env_file()

    try:
        raw_input = "" if sys.stdin.isatty() else sys.stdin.read()
        payload = json.loads(raw_input) if raw_input.strip() else {
            "action": "build_canvas",
            "title": "Direct Run",
            "workspace": "Nucleus",
        }
    except Exception as error:
        print(json.dumps(failure(str(error))))
        sys.exit(1)
    
    if payload.get("base_url") or os.environ.get("CANVAS_BASE_URL"):
        sysurl = get_canvas_base_url(payload=payload)

    print(sysurl)
    



if __name__ == "__main__":
    main()
