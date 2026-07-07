# Parser academic file types

Each course file is classified from a **filename + ~2.8k char snippet** before pass 1.
Profiles live in `canvas_parser/parse/file_types.py`.

| Type | Pass 2 | Concepts | Skill |
| --- | --- | --- | --- |
| [Course syllabus](syllabus.md) | no | no | [skill](../../.cursor/skills/parser-file-type-syllabus/SKILL.md) |
| [Assignment / homework sheet](assignment_sheet.md) | yes | no | [skill](../../.cursor/skills/parser-file-type-assignment_sheet/SKILL.md) |
| [Past / current exam paper](past_exam.md) | no | no | [skill](../../.cursor/skills/parser-file-type-past_exam/SKILL.md) |
| [Exam solutions / answer key](exam_solution.md) | no | no | [skill](../../.cursor/skills/parser-file-type-exam_solution/SKILL.md) |
| [Review / study guide](review_sheet.md) | yes | yes | [skill](../../.cursor/skills/parser-file-type-review_sheet/SKILL.md) |
| [Lecture slides](lecture_slides.md) | yes | yes | [skill](../../.cursor/skills/parser-file-type-lecture_slides/SKILL.md) |
| [Lecture notes (prose)](lecture_notes.md) | yes | yes | [skill](../../.cursor/skills/parser-file-type-lecture_notes/SKILL.md) |
| [Textbook chapter](textbook_chapter.md) | yes | yes | [skill](../../.cursor/skills/parser-file-type-textbook_chapter/SKILL.md) |
| [Research article](research_article.md) | yes | yes | [skill](../../.cursor/skills/parser-file-type-research_article/SKILL.md) |
| [Literary work](literary_work.md) | no | no | [skill](../../.cursor/skills/parser-file-type-literary_work/SKILL.md) |
| [Humanities reading](humanities_reading.md) | no | no | [skill](../../.cursor/skills/parser-file-type-humanities_reading/SKILL.md) |
| [Problem set / worksheet](problem_set.md) | yes | no | [skill](../../.cursor/skills/parser-file-type-problem_set/SKILL.md) |
| [Lab handout](lab_handout.md) | yes | yes | [skill](../../.cursor/skills/parser-file-type-lab_handout/SKILL.md) |
| [Reference / formula sheet](reference_sheet.md) | no | no | [skill](../../.cursor/skills/parser-file-type-reference_sheet/SKILL.md) |
| [Administrative / orientation](administrative.md) | no | no | [skill](../../.cursor/skills/parser-file-type-administrative/SKILL.md) |
| [Discussion / seminar prompt](discussion_prompt.md) | no | no | [skill](../../.cursor/skills/parser-file-type-discussion_prompt/SKILL.md) |
| [Code / technical document](code_technical.md) | yes | yes | [skill](../../.cursor/skills/parser-file-type-code_technical/SKILL.md) |
| [Generic content](generic_content.md) | yes | yes | [skill](../../.cursor/skills/parser-file-type-generic_content/SKILL.md) |

## Master skill

`.cursor/skills/parser-academic-file-types/SKILL.md` — routing index for all types.
