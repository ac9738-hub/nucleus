from anthropic import Anthropic
from dotenv import load_dotenv
import json
import sys
import os

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))
claude_api_key = os.environ.get("CLAUDE_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
if not claude_api_key:
    raise RuntimeError(
        "Missing Claude API key. Set CLAUDE_API_KEY or ANTHROPIC_API_KEY in .env or environment."
    )

client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

system_prompt = (
    "You are a helpful assistant for a student organization app called Nucleus. "
    "You have full control over in-app actions and a context retrieval system. "
    "Your task is to assist the user with their questions and requests. "
    "Do not mention your capabilities unprompted. Do not use markdown formatting."
)

tools = []

def runagent(prompt):
    with client.messages.stream(
        model="claude-sonnet-4-6",
        max_tokens=1000,
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}]
    ) as stream:
        for text in stream.text_stream:
            print(text, end="", flush=True)

    # newline after response so next JSON line is on its own line
    print("", flush=True)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        payload = json.loads(line)
    except json.JSONDecodeError as exc:
        print(f"Invalid JSON payload: {exc}", file=sys.stderr)
        continue

    prompt = payload.get("message") or payload.get("prompt")
    if prompt:
        runagent(prompt=prompt)
    else:
        print("No 'message' or 'prompt' field found in payload.", file=sys.stderr)