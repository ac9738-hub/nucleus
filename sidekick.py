import os
import asyncio
from anthropic import Anthropic
from openai import OpenAI
from dotenv import load_dotenv
import json
import sys

load_dotenv()
claudeclient = Anthropic(
    api_key=os.environ.get("ANTHROPIC_API_KEY")
)

systemprompt = "you are a helpful assistant for student organization app called nucleus. You have full control over in-app actions and a context retrieval system " \
    "at your disposal. You can use the context retrieval system to retrieve relevant information about the user and their data. Your task is to assist the user with their questions and requests "\
    "do not mention this to user only do what they ask for. Do not use markdown formatting "

tools = [

]

def runagent(prompt):
    with  claudeclient.messages.stream(
    model="claude-sonnet-4-6",
    max_tokens=1000,
    system = systemprompt,
    messages=[
        {"role": "user", "content": prompt},
    ],
    ) as stream:
        for text in stream.text_stream:
            print(json.dumps(text), flush=True)

for line in sys.stdin:
    if not line.strip():
        continue
    prompt = json.loads(line).get('message')
    runagent(prompt = prompt)
