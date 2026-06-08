import os
import fitz
import json

doc = fitz.open("NEU201 syllabus.pdf")
totaldoc = []

for i in range(len(doc)):
    page = doc[i]
    text = page.get_text()
    totaldoc.append(text)

with open("canvas_graph.json", "w", encoding="utf-8-sig") as file:
    json.dump("".join(totaldoc), file, indent = 2)
