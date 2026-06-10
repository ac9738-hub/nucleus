"""Sidekick agent process.

Functionality: streams user prompts to the LLM, emits text/tool calls as
newline-delimited JSON for agent-process.js, and exposes workspace/Canvas tools.
Dependencies: Anthropic/OpenAI/Ollama clients and main.js tool responses.
"""
from anthropic import Anthropic
from ollama import chat
from openai import OpenAI
from ollama import ChatResponse
from dotenv import load_dotenv
from context_format import format_context_snapshot
import json
import sys
import os
import fitz
import base64


load_dotenv()
claude_client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
deepseek_client = OpenAI(api_key = os.environ.get("DEEP_SEEK_API_KEY"), base_url="https://api.deepseek.com")

hardcoded_syllabus = ""
MAX_ATTACHMENT_TEXT_CHARS = 60000


doc = fitz.open("NEU201 syllabus.pdf")

pages = []
for page in doc:
    pages.append(page.get_text())

hardcoded_syllabus = "\n".join(pages)

doc.close()

system_prompt = (
    "You are a helpful assistant for a student organization app called Nucleus. "
    "You have full control over in-app actions. if you call a tool summarize what you did. If not just answer whatever is asked with no extra commentary. Always call a tool if it can help accomplish the user's goal. If you have already addressed a user message in a previous response, do not address it again in future responses. Only address new user messages that have not yet been addressed"
    "Do not use markdown formatting."
)
context_only_system_prompt = (
    "You are a helpful assistant for a student organization app called Nucleus. "
    "Your task will most likely need in-app context. You have 2 options. call get_context, or respond"
)
runtime_system_context = ""
runtime_call_context = ""
runtime_context_snapshot = None
local_system_prompt = """
You are a routing classifier for the Nucleus student app.

Classify the user's message into EXACTLY ONE category.

A = TOOL_ACTION
Use TOOL_ACTION when the app must change something.
Examples:
- create a task
- edit a task
- delete a reminder
- add a course
- mark work complete
- schedule something

B= APP_DATA_REQUEST
Use APP_DATA_REQUEST when the user is asking for information stored in the app.
Examples:
- what assignments are due tomorrow
- show my tasks
- what classes do I have today
- how am I doing in calculus
- what deadlines are upcoming

C = GENERAL_CHAT
Use GENERAL_CHAT for:
- general knowledge questions
- casual conversation
- brainstorming
- explanations
- tutoring
- anything unrelated to stored app data or app actions

IMPORTANT RULES:
- If the app database must be READ -> B
- If the app database must be MODIFIED -> A
- Otherwise -> C

Reply with ONLY one Letter:
A
B
or
C
"""
chat_history = []

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
    }
]

classifyA = set(["add", "delete", "move", "open"])
classifyB = set(["my", "content", "lecture", "explain"])
classifyC = set([])
weights = {"add": 1, "delete": 1, "move": 1, "open": 1, "my": 0.5, "content": 0.5, "lecture": 0.8, "explain": 0.7}
def run_classifier(prompt):
    runclaude(prompt = chat_history)
    return

    splitprompt = prompt[0]["content"].split()
    setprompt = set(splitprompt)
    weightA, weightB, weightC = 0, 0, 0
    for word in (setprompt & classifyA):
        weightA += weights[word]
    for word in (setprompt & classifyB):
        weightB += weights[word]
    for word in (setprompt & classifyC):
        weightC += weights[word]

    if weightA >= weightB and weightA >= weightC:
        if weightA > 0.5:
            runclaude(prompt = chat_history)
            return
    elif weightB >= weightC:
        if weightB > 0.8:
            run_deepseek(prompt = prompt)
            return
    else:
        if weightC > 0.5:
            rerepo: ChatResponse = chat(model = 'gemma3', messages = [{"role": "system", "content": "respond concisely and directly"}] + prompt)
            # NEED TO ADD context memory for this response
            print(json.dumps(rerepo["message"]["content"]), file= sys.stderr)
            return
            
    localprompt = [{"role": "user", "content":"Classify: " + prompt[0]["content"] + "\nAnswer: "}]
    print(f"py: running classifier: {prompt[0]["content"]}", file=sys.stderr)
    response: ChatResponse = chat(model = 'llama3.2:1b', messages = [{"role": "system", "content": local_system_prompt}] + localprompt, options={"temperature": 0, "num_predict": 1})
    retext = response['message']['content']
    print(f'classifier classified as: {retext}', file = sys.stderr)
    if retext == "A":
        runclaude(prompt=prompt)
    elif retext == "B":
        run_deepseek(prompt = prompt)
    elif retext == "c":
        rerepo: ChatResponse = chat(model = 'gemma3', messages = [{"role": "system", "content": "respond concisely and directly"}] + prompt)
        # NEED TO ADD context memory for this response
        print(json.dumps(rerepo["message"]["content"]), file= sys.stderr)
        return



def run_deepseek(prompt):
    print(f"py: running deepseek: {prompt}", file=sys.stderr)
    response = deepseek_client.chat.completions.create(
        model="deepseek-v4-pro",
        messages=[{"role": "system", "content": context_only_system_prompt + prompt}],
        stream=True
    )
    tool_call = {"name": None, "arguments": ""}
    called_function = False

    for event in response:
        if event.type == "delta":
            delta = event.delta
            if "content" in delta:
                print(delta["content"], flush=True)
            if "function_call" in delta:
                called_function = True
                fc = delta["function_call"]
                if "name" in fc:
                    tool_call["name"] = fc["name"]
                if "arguments" in fc:
                    tool_call["arguments"] += fc["arguments"]

    if called_function:
        try:
            tool_call["arguments"] = json.loads(tool_call["arguments"])
        except json.JSONDecodeError:
            pass
        print(json.dumps(tool_call, ensure_ascii=False), flush=True)


def runclaude(prompt):
    print(f"py: running claude: {prompt}", file=sys.stderr)
    tool_calls = {}
    full_text = ""
    model_messages = prompt
    if runtime_call_context and model_messages:
        last = model_messages[-1]
        if isinstance(last, dict) and last.get("role") == "user":
            content = last.get("content")
            extra_block = {"type": "text", "text": runtime_call_context}
            if isinstance(content, str):
                merged = [{"type": "text", "text": content}, extra_block]
            elif isinstance(content, list):
                merged = content + [extra_block]
            else:
                merged = [extra_block]
            model_messages = model_messages[:-1] + [{"role": "user", "content": merged}]
    dynamic_system_prompt = system_prompt
    snapshot_context = format_context_snapshot(runtime_context_snapshot) if runtime_context_snapshot else ""
    live_context_parts = [part for part in (snapshot_context, runtime_system_context) if part]
    if live_context_parts:
        dynamic_system_prompt += "\n\nLive app context:\n" + "\n\n".join(live_context_parts)
    response = claude_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1000,
        system=dynamic_system_prompt + "\nThis is the syllabus for NEU 201:" + hardcoded_syllabus,
        messages=model_messages,
        tools=tools,
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
                full_text += event.delta.text  # accumulate, don't append to history yet
                print(json.dumps(event.delta.text), flush=True)
            elif event.delta.type == "input_json_delta":
                if event.index in tool_calls:
                    tool_calls[event.index]["input"] += event.delta.partial_json

        elif event.type == "message_stop":
            # build ONE assistant message containing everything
            assistant_content = []

            if full_text:
                assistant_content.append({
                    "type": "text",
                    "text": full_text
                })

            total_tools_called = []
            for tool in tool_calls.values():
                tool["input"] = json.loads(tool["input"]) if tool["input"] else {}
                assistant_content.append({
                    "type": "tool_use",
                    "id": tool["id"],
                    "name": tool["name"],
                    "input": tool["input"]
                })
                total_tools_called.append({
                    "type": "tool",
                    "name": tool["name"],
                    "input": tool["input"],
                    "id": tool["id"]
                })

            # ONE assistant message with all content
            if assistant_content:
                chat_history.append({
                    "role": "assistant",
                    "content": assistant_content
                })

            if total_tools_called:
                print(json.dumps(total_tools_called), flush=True)
            else:
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


for line in sys.stdin:
    print(line, file=sys.stderr )
    line = json.loads(line)  
    if line[0] == "tool_response":
        chat_history.append({"role": "user", "content": [{"type": "tool_result","tool_use_id": line[1], "content": line[2]}]})
        runclaude(prompt = chat_history)
    elif line[0] == "message":
        message_text, message_content = message_payload_to_text_and_content(line[1])
        if isinstance(line[1], dict):
            runtime_system_context = str(line[1].get("systemContext") or "")
            runtime_call_context = str(line[1].get("callContext") or "")
            snapshot = line[1].get("contextSnapshot")
            runtime_context_snapshot = snapshot if isinstance(snapshot, dict) else None
        else:
            runtime_system_context = ""
            runtime_call_context = ""
            runtime_context_snapshot = None
        chat_history.append({"role": "user","content": message_content })
        run_classifier(prompt = [{"role": "user", "content": message_text}])
