"""Held-out RAG query specs — not used in QUERY_SPECS (in-sample GT).

Courses and phrasing differ from scripts/build_rag_ground_truth.py QUERY_SPECS.
Expected nodes verified against canvas_graph.json (2026-06-16).
"""

HOLDOUT_QUERY_SPECS: list[dict] = [
    {
        "query": "COS 217 programming assignment",
        "mode": "browser",
        "intent": "assignment",
        "answer": "COS 217 (Intro to Programming Systems) programming assignments.",
        "expected": [
            {
                "type": "assignment",
                "name": "Assignment 1: A De-Comment Program",
                "courseid": "20690",
                "id": "d99a855cf3835133",
            },
        ],
    },
    {
        "query": "ART 102 architecture syllabus",
        "mode": "browser",
        "intent": "syllabus",
        "answer": "ART 102 course homepage or syllabus file.",
        "expected": [
            {
                "type": "file",
                "name": "ART102-ARC102_F2025 An Introduction to the History of Architecture homepage",
                "courseid": "18857",
                "id": "homepage-18857",
            },
        ],
    },
    {
        "query": "STAT 104 problem set",
        "mode": "browser",
        "intent": "assignment",
        "answer": "STAT 104 problem set assignments.",
        "expected": [
            {
                "type": "assignment",
                "name": "Problem Set 1",
                "courseid": "154725",
                "id": "28def3903eabc991",
            },
        ],
    },
    {
        "query": "NEU 201 neuroscience syllabus",
        "mode": "browser",
        "intent": "syllabus",
        "answer": "NEU 201 Fundamentals of Neuroscience syllabus PDF.",
        "expected": [
            {
                "type": "file",
                "name": "NEU201-PSY258_F2024 Fundamentals of Neuroscience syllabus",
                "courseid": "15237",
                "id": "course-syllabus-15237",
            },
        ],
    },
    {
        "query": "ECON 10B macroeconomics readings",
        "mode": "browser",
        "intent": "material",
        "answer": "ECON 10B course syllabus / homepage with reading list.",
        "expected": [
            {
                "type": "file",
                "name": "ECON 10B: Principles of Economics (Macroeconomics) syllabus",
                "courseid": "143716",
                "id": "course-syllabus-143716",
            },
        ],
    },
    {
        "query": "When is the COS 217 midterm?",
        "mode": "agent",
        "intent": "deadline",
        "answer": "COS 217 midterm event or related assignment.",
        "expected": [
            {"type": "event", "name": "Midterm", "courseid": "20690", "id": "Midtermeventid"},
        ],
    },
    {
        "query": "What are the office hours for NEU 201?",
        "mode": "agent",
        "intent": "syllabus",
        "answer": "NEU 201 office hours events or syllabus.",
        "expected": [
            {
                "type": "event",
                "name": "Office Hours - Isha Gore",
                "courseid": "15237",
                "id": "Office Hours - Isha Goreeventid",
            },
        ],
    },
    {
        "query": "When is ECON 10B problem set 1 due?",
        "mode": "agent",
        "intent": "deadline",
        "answer": "ECON 10B Problem Set 1 assignment with due date.",
        "expected": [
            {
                "type": "assignment",
                "name": "Problem Set 1 (PS1)",
                "courseid": "143716",
                "id": "799068907d457286",
            },
        ],
    },
    {
        "query": "When is the ART 102 midterm?",
        "mode": "agent",
        "intent": "deadline",
        "answer": "ART 102 midterm event or take-home exam assignment.",
        "expected": [
            {"type": "event", "name": "Midterm", "courseid": "18857", "id": "Midtermeventid"},
            {
                "type": "assignment",
                "name": "Midterm take-home exam",
                "courseid": "18857",
                "id": "b37a616ab6db937a",
            },
        ],
    },
    {
        "query": "Where are CHI 103 week 2 materials?",
        "mode": "agent",
        "intent": "material",
        "answer": "CHI 103 Week 2 quiz assignment or course homepage.",
        "expected": [
            {"type": "assignment", "name": "Week 2小考", "courseid": "15222", "id": "f6c7ae4fadefe999"},
            {
                "type": "file",
                "name": "CHI103_F2024 Intensive Elementary Chinese homepage",
                "courseid": "15222",
                "id": "homepage-15222",
            },
        ],
    },
]
