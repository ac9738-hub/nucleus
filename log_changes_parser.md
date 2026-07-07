# Parser issues (do not fix here — teaching pipeline only)

Logged while evaluating Synapse Learn teaching-block quality for **CHI103** (15222), **NEU201** (15237), and **ECO101** (20959). Consumer-side sequencing fixes were applied in `synapse_teaching.py`, `synapse_teaching_sections.py`, and `schedule/learning_blocks.py`.

## NEU201 — Fundamentals of Neuroscience (15237)

| Issue | Impact | Suggested parser fix |
| --- | --- | --- |
| ~588 concepts extracted with few/no `moduleOrderHints` | Curriculum fell back to **alphabetical** concept order (ACh before membrane physiology) instead of Week 1→12 lecture flow | Attach `moduleOrderHints` from Canvas Week N modules when concepts come from weekly lecture/precept PDFs |
| Many near-duplicate concept/section names: `(Alternate)`, `(duplicate)`, `(from Precept)`, `(source 3380687)` | 136 pseudo-section groups; redundant lessons | Dedupe or merge variant detail nodes during concept finalization |
| `should_prefer_concept_curriculum` chose full concept dump over ~28 page-block units | 689-lesson curriculum dominated by unordered concepts | Improve `documentOrder` on concepts from lecture PDF page sequence (fileId + pageNumber + yRatio) |
| Syllabus node has almost no `other` prose (link-only) | Misses course arc: excitability → synapses → circuits → perception/action/emotion/memory | Parse `NEU201 syllabus.pdf` body into syllabus `other` + schedule events |
| Concepts like "Active Note-Taking", grade statistics | Logistics mixed into teachable units | Classify/logistics concepts separately from content concepts |

**Course flow (from Canvas):** Week 1–12 modules; problem sets, quizzes, precept PDFs, lecture slides. Topics progress from cellular neuroscience through systems (vision, audition, motor, memory, emotion).

## CHI103 — Intensive Elementary Chinese (15222)

| Issue | Impact | Suggested parser fix |
| --- | --- | --- |
| Homepage/syllabus concepts include **instructor names** as first learning blocks | Curriculum opened with staff bios instead of Pinyin/textbook setup | Do not emit person-name concepts from homepage tables unless tagged administrative |
| Learning blocks ordered before textbooks in graph | Textbooks should precede weekly lesson work | Order blocks: syllabus → resources (Pinyin, textbooks) → Week 1…14 |
| Sparse `moduleOrderHints` on weekly review/schedule PDFs | Holistic subheaders used for sequencing instead of parsed lesson structure | Parse weekly schedule PDFs (`CHI103-weekN-schedule.pdf`, review sheets) into dated section concepts |

**Course flow (from Canvas):** Syllabus → semester schedule → course resources (Pinyin, character site, Pleco) → Week 1…14 (schedules, Oh China lessons, character exercises, quizzes) → slides/audio supplements.

## ECO101 — Introduction to Macroeconomics (20959)

| Issue | Impact | Suggested parser fix |
| --- | --- | --- |
| **No parsed concepts/blocks** from 22 lecture notes + 23 lecture slides in Canvas modules | Curriculum was syllabus homework list + 2 videos (16 lessons) | Run file pass on `ECO101_Lecture*_Notes_*.pdf` and slide PDFs; emit concepts with lecture-number `documentOrder` |
| Syllabus assignments used as only structured source | Homework 1–9 + exams all bucketed in Week 1 | Syllabus assignment list is logistics; lecture modules are the content spine |
| No `moduleOrderHints` in graph | Module-fallback could not run without canvas_data bridge | Populate hints from `ECO 101 Lecture Notes/Slides` module item order |

**Course flow (from Canvas):** Course Resources (syllabus) → Lecture Notes (L1–L22) → Lecture Slides (L1–L23) → Assignments → Exams → Precepts → Videos.

## Infra note

`canvas_graph.json` was not present in the workspace during this iteration; evaluation used `.cache/weekly_iteration/graph_eval.json` (Princeton weekly GT courses only — **no concepts/files for 15222, 15237, or 20959**) plus live `canvas_data.json` module structure. Consumer-side fallbacks in `synapse_teaching.py` now build lecture/week spines from Canvas modules when the graph is empty.

## Consumer-side fixes applied (2026-06-21)

| Course | Before | After |
| --- | --- | --- |
| CHI103 | Instructor names first; file names as section groups | Syllabus → resources → Week 1–14; module-based sections |
| NEU201 | 689 unordered concepts (when graph populated) / alphabetical modules | 21 lecture slides in Week 1–12 order (PS keys/quizzes filtered) |
| ECO101 | 16 syllabus homework items in Week 1 | 47+ lecture notes/slides spine; homework after content |

Remaining parser dependency: NEU201 still needs parsed lecture PDF concepts for sub-lecture teaching units once graph includes course files.

## Consumer iteration 2 (2026-06-21)

- Fixed reader audio ordering (Oh China / Trip to China L1→L10 vocabulary then text).
- Richer canvas-module teaching snippets from lecture filenames (+NEU/ECO context depth).
- Filtered spreadsheet data files from ECO101 curriculum.
- Eval artifact refreshed: `.cache/teaching_eval.json`.

## Consumer iteration 3 (2026-06-21)

- ECO101 notes/slides interleaved by lecture number (L1 notes → L1 slides → L2 notes …).
- CHI103 module subheaders enriched with week/setup-aware teaching context; section groups use parent module (not subheader title).
- Subheader thin-context count target: 0 after enrichment pass in `enrich_lesson_metadata`.

## Consumer iteration 4 (2026-06-21) — document-order sequencing + lecture sections

Fixes in `synapse_teaching_sections.py` (no parser changes):

- **Document order within a file:** `lesson_canvas_sort_key` now sorts page-block concepts by `_lesson_document_order` (file-sequence rank → page number → y-position → sequenceIndex) instead of falling back to `name.casefold()`. ECO101 lecture concepts previously scrambled alphabetically (e.g. "Aggregate output…" before "All of the data…") now follow PDF page order (p3 → p14 → p16 …).
- **Numeric file ordering:** `_filename_sequence_rank` parses `Lecture N` from filenames so `Lecture 2` precedes `Lecture 10` (not string order).
- **Lecture spine:** parallel `… Lecture Notes` / `… Lecture Slides` modules are merged by lecture number via `LECTURE_SPINE_TIER`; within each lecture, Notes (track 0) precede Slides (track 1), each in page order.
- **Stable lecture sections:** `_lecture_section_label` groups both tracks of a lecture under `Lecture N`, replacing the broken alternating `Week 1` (notes) / `Week 12` (slides) labels. Guard added in the weekly-assign loop so a lecture lesson's weekly match can't drag `current_section` onto an unrelated week. Same label applied in the no-weekly sequential path.
- Tests added: `test_lesson_canvas_sort_key_orders_concepts_by_page_not_name`, `test_lesson_canvas_sort_key_orders_files_by_lecture_then_page`, `test_lecture_modules_group_by_lecture_number` (38 passing).

### Parser issue still outstanding (do NOT fix here)

| Issue | Evidence | Suggested parser fix |
| --- | --- | --- |
| **Math/ligature mojibake** in extracted PDF text | ECO101 Lecture 3 concepts: `in∩¼éuenced` (influenced), `a∩¼Çect` (affect), `K Γêù` (K*), `Kt+1 = Kt = K Γêù` | PDF text extraction is decoding ligatures (`fi`/`ff`/`fl`) and math glyphs (`∗`, `−`) with the wrong codepage; normalize to Unicode (NFKC) and map private-use/symbol glyphs at extraction time |
| CJK mojibake on CHI103 (logged earlier) | Garbled hanzi in concept names | Same root cause: enforce UTF-8 + glyph mapping in the file text pass |

These are extraction-layer defects; the teaching pipeline preserves whatever text the parser emits.

## Consumer iteration 5 (2026-06-21) — coherent module sections (no thrashing)

Fix in `synapse_teaching_sections.py` (no parser changes):

- **Stable module sections:** `resolve_lesson_section_group` now keeps every file of a recognized Canvas module (Week N, Course slides, Audio material, Course resource, exam/assignment modules) under that module's single section. Previously a "Course slides" repository thrashed `Course slides → Week 2 → Course slides → Week 3 …` because individual review PDFs (e.g. `CHI103 F24 Review week3.pdf`) matched a weekly-schedule row and were yanked out of their module while neighbors fell back to the module label.
- **Section propagation:** the assign loop was simplified so the resolved section becomes the running `current_section`; later lessons in the same file (and orphan files that only match a week through one lesson) inherit it instead of re-deriving a different weekly bucket per lesson. This removed the separate post-resolve weekly override and the lecture special-case (now subsumed).

Validation across the three eval courses (local-file hydration):

| Course | Sections after fix |
| --- | --- |
| CHI103 | Course Syllabus → Course resource → Introduction of Pinyin → Week 2…14 → Course slides (each once, in order; no thrashing) |
| ECO101 | Course Resources → Lecture 1…24 (held) |
| NEU201 | Week 1…12 (held) |

Tests: `tests/test_synapse_teaching.py` 38 passed. (`tests/test_synapse_teaching_holdout.py::test_holdout_eval_production_graph` fails in this workspace because the local `canvas_graph.json` was built for the Princeton weekly-GT set and contains none of the 8 holdout course IDs — `courseCount == 0`; unrelated to section/order logic.)

### Remaining curriculum quality is parser-bound

| Course | lessons | thinContext | duplicateNames | Root cause (parser, not pipeline) |
| --- | --- | --- | --- | --- |
| ECO101 | 256 | 253 | 59 | Page blocks capture slide/notes **headings only** (~41 chars), no body; same heading appears in both Notes and Slides PDFs |
| CHI103 | 91 | 59 | 46 | Over-extraction of `Problem N` from vocabulary/exercise lists; repeated `练习 (exercise)` headers; CJK + math mojibake |
| NEU201 | 31 | 0 | 0 | No local files → section-only spine; needs parsed lecture-PDF concepts |

Pipeline-side ordering and sectioning are now correct; further gains require deeper/cleaner parser extraction (context body, glyph normalization, problem-vs-content classification).

## Consumer iteration 6 (2026-06-21) — cross-track concept dedupe

Fix in `synapse_teaching.py` (`_dedupe_within_section`, no parser changes):

- Parallel `Lecture Notes` / `Lecture Slides` PDFs repeat the same heading inside one lecture (e.g. ECO101 Lecture 2 `We then define the GDP Deflator as` in both the Notes p15 and Slides p17). After section groups are assigned, identical `concept`/`example` headings within the **same sectionGroup** are collapsed to one lesson, keeping the **richer** teaching context.
- Guards against over-merging: only `concept`/`example` types with names ≥12 chars are eligible. `problem`/`section` lessons and short generic labels (`Step 1`, `Problem 1`) are never merged, because identical names there denote distinct items from different source files. Same long name in two different sections (different lectures/weeks) is preserved.

| Course | lessons before → after | duplicateNames before → after |
| --- | --- | --- |
| ECO101 | 256 → **202** | 59 → **5** |
| CHI103 | 91 → 91 (unchanged) | 46 → 46 (correctly protected: distinct `Problem N` + per-week exercise headers) |

ECO101 Lecture 2 after: all unique Notes concepts + only the unique Slides concepts ("Consider two possibilities", "Compare with", "Given a series for Pt we have", …); the 4 redundant slide repeats removed.

Tests: `tests/test_synapse_teaching.py` 40 passed (added `test_dedupe_within_section_collapses_cross_track_concepts`, `test_dedupe_within_section_keeps_generic_and_cross_section`).

## Consumer iteration 7 (2026-06-21) — content-derived titles for numbered-list lessons

**Parser root cause (logged, not fixed):** the page-block extractor classifies *every numbered list item* as a `problem` named `Problem N`, where `N` is just the list number on the page. Probe of CHI103's 57 "problem" lessons shows they are almost all **not problems**: syllabus entries (`1. Textbooks:`), grammar points (`10. (1) 虽然…(但是/可是)…`), schedule/assignment steps (`2. Character Sheet: Lesson 5 …`), pinyin rules, logistics (`1. Lecture 上课 Monday–Friday`), and pure noise (`Exercise4`). The real text is in `teachingContext`; the title `Problem 10` is meaningless. Suggested parser fix: classify numbered list items as content (grammar/vocab/assignment), not `problem`, and title them from their text.

**Consumer fix (`synapse_teaching.py`, `_humanize_generic_lesson_name`, presentation-only):** at the end of `build_curriculum` (after enrich/grounding, so all internal matching still uses the parser label), any lesson whose name is a generic placeholder (`Problem N`, `Exercise N`, `Step N`, `Question N`, `Part N`, bare number) is retitled from the first clause of its `teachingContext` (leading enumerator stripped, ≤80 chars). Original label kept in `parserLabel`. Type/interaction/ids unchanged — no reclassification. Skips when context is thin or would just echo the placeholder.

| Course | duplicateNames before → after | generic `Problem N` titles before → after | lessons |
| --- | --- | --- | --- |
| CHI103 | 46 → **0** | 57 → **0** | 91 (unchanged; no content dropped) |
| ECO101 | 5 → 5 | 0 → 0 | 202 (unchanged) |
| NEU201 | 0 → 0 | 0 → 0 | 31 (unchanged) |

CHI103 examples after: `Submit Your Work: Submit the following on Canvas …`, `Create a Poster: Using the final image …`, `VP+(是)很有意义/没有意义(的) …… is meaningful/meaningless`, `Subj. 把…寄给 … to send by mailing`; bare section names `1`/`2` → `part 1`/`part 2`.

Tests: `tests/test_synapse_teaching.py` 43 passed (added `test_humanize_generic_lesson_name_uses_context`, `_leaves_real_titles`, `_skips_when_context_thin`).

Note: titles still carry CJK/math mojibake from PDF extraction (iteration-4 parser issue) — the relabel surfaces the real content but cannot repair the encoding.

## Consumer iteration 8 (2026-06-21) — drop class-meeting logistics noise

**Parser root cause (logged, not fixed):** the syllabus pass extracts class-section meeting rows as teaching lessons. CHI103's curriculum opened with five non-teaching cards — `(C01): 9:00 am - 9:50 am Classroom: Frist 228`, `(C02): 10:00 am …`, `(C02A) … Classroom: TBD`, `(C03) …`, `(C03A) …`. Suggested parser fix: tag syllabus schedule/section rows as `administrative`, not teachable content.

**Consumer fix (`synapse_teaching.py`, `_is_administrative_noise` + `CLASS_MEETING_NOISE`):** before resort/section assignment, drop lessons whose name is a class-section meeting time (section code + clock time, e.g. `(C01): 9:00 am`). Pattern is general (no course literals) and deliberately narrow — requires both a section code and a clock time — so real titles, lecture names, and grammar content are preserved.

| Course | lessons before → after | thinContext before → after |
| --- | --- | --- |
| CHI103 | 91 → **86** (−5 logistics) | 59 → **54** |
| ECO101 | 202 → 202 | unchanged |
| NEU201 | 31 → 31 | unchanged |

CHI103 now opens: Course Syllabus (Textbooks / Audio materials / Web materials) → Course resource → Introduction of Pinyin → Week 2…14 → Course slides.

Tests: `tests/test_synapse_teaching.py` 44 passed (added `test_administrative_noise_filters_class_meeting_times`).

> **Reverted in overfitting review (2026-06-21):** iteration 8's `CLASS_MEETING_NOISE` / `_is_administrative_noise` filter was removed. Its leading-`c` pattern encoded an institution-specific "C##" section-code convention, only ever fired on one course, and was content *removal* (the riskiest heuristic class on unseen courses). CHI103 returns to 91 lessons; the five `(C01)…` class-meeting rows are restored as plain `read` content (no longer mislabeled as problems thanks to iteration 10). The parser issue (syllabus schedule rows extracted as teaching content) remains logged above for a parser-side `administrative` tag.

## Consumer iteration 9 (2026-06-21) — strip leading enumerator junk from titles

Probe of lesson names across the three courses (`leading-number-junk`, `leading-lowercase-frag`, `very-short`):

| Course | leading-number junk | leading-lowercase frag | very short (<5) |
| --- | --- | --- | --- |
| CHI103 | 0 | 0 | 1 (`汉字练习` — valid) |
| ECO101 | 5 | 10 | 0 |
| NEU201 | 0 | 0 | 0 |

**Consumer fix (`synapse_teaching.py`, `_strip_leading_enumerator`, presentation-only):** in the same final pass as the relabel, a bare leading list number on an otherwise-real title is removed. Guards: 1–3 digit enumerator only (4-digit years protected), a punctuation + trailing space required, and the remainder must be ≥6 chars, so real titles are never truncated.

ECO101 results:
- `20 : Section 1` → `Section 1`
- `3 , Chapter 18: section 18-1` → `Chapter 18: section 18-1`
- `1: A proportional tax on labor income at rate τ.` → `A proportional tax on labor income at rate τ.` (and the `2:`/`3:` siblings)

Tests: `tests/test_synapse_teaching.py` 46 passed (added `test_strip_leading_enumerator_cleans_titles`, `test_strip_leading_enumerator_protects_years_and_short_remainders`).

### Parser issues still outstanding (do NOT fix here)

| Issue | Evidence (ECO101) | Suggested parser fix |
| --- | --- | --- |
| **Heading starts mid-word** | `s include public education (both K-12 and college)…`, `s of variables that move positively with GDP`, `or equivalently` (10 lessons) | Block/heading boundary detection cuts inside a word (drops the leading token, e.g. `service` → `s`); anchor heading starts at token boundaries |
| **Ligature normalization** | `ﬁre`, `signiﬁcance`, `deﬁne` (U+FB01 `ﬁ`), plus earlier cp1252 mojibake (`∩¼ü`) | NFKC-normalize extracted PDF text (`ﬁ`→`fi`) and force UTF-8 decode |
| **Glued words** | `policeand ﬁre`, `themacroeconomy`, `followingwe` | Insert space at extraction when glyph spacing is lost between words |

These are extraction-layer defects; the consumer pipeline cannot reconstruct the missing characters/spaces.

## Consumer iteration 10 (2026-06-21) — interaction reflects solvability, not just type

**Parser root cause (logged, not fixed):** numbered list items are typed `problem`, and `enrich_lesson_metadata` mapped *every* `problem` to `interaction='answer'` (a "solve this" prompt). CHI103 therefore presented all 57 of its misclassified grammar notes / syllabus rows / assignment instructions as problems to solve.

**Consumer fix (`synapse_teaching.py`, `_problem_is_solvable` + `PROBLEM_SOLVE_SIGNAL`):** a `problem` lesson keeps `interaction='answer'` only when it is actually solvable — it has a matched answer key or steps, or its title/statement contains an explicit solve verb or question (`find`, `calculate`, `prove`, `what is`, `?`, …). Otherwise it falls back to `interaction='read'`. Type/classification untouched; this only changes how the consumer presents the lesson.

| Course | `answer` interactions before → after | note |
| --- | --- | --- |
| CHI103 | 57 → **3** | 83/86 now `read`; remaining are question-pattern grammar notes + 1 minor `find` false positive |
| ECO101 | (all problems) → **4** | genuine discussion questions kept (`Q1: Who would benefit more …?`); 18 examples stay `example` |
| NEU201 | 0 → 0 | section/lecture titles, unchanged |

Demo fixture problem (`Problem 4: compute the product`) stays `answer` via the `compute` signal — `test_curriculum_includes_examples_and_problems_fixture` still passes.

Tests: `tests/test_synapse_teaching.py` 47 passed (added `test_problem_interaction_downgrades_non_solvable`).

## Consumer iteration 11 (2026-06-21) — integrity sweep + post-relabel dedupe

Holistic integrity probe across the three curricula (empty names, in-section duplicate names, section contiguity, file-split): all clean except **ECO101 had 4 in-section duplicate names**. Diagnosis:

- `Q1: Who would benefit more …?` / `Q2: …` (Lecture 7) — type `problem`, present in both the lecture's Notes and Slides. They were named `Problem 1`/`Problem 2` (9 chars, under the dedupe length guard) **at dedupe time**, then relabeled to the long `Q1:`/`Q2:` titles afterward, so the first dedupe pass could not see them.
- `Step 1:` (Lecture 3) and `We will` (Lecture 9) — 7-char generic/fragment names, intentionally protected by the length guard.

**Consumer fixes (`synapse_teaching.py`):**
1. `_DEDUPE_SECTION_TYPES` now includes `problem` (was `concept`/`example` only) — a discussion question duplicated across a lecture's notes and slides collapses, while short generic `Problem N` names stay protected by the ≥12-char guard.
2. Added a **second `_dedupe_within_section` pass after relabeling**, so cross-track duplicates that only become identical once retitled (the `Q1`/`Q2` case) are merged. ECO101 in-section duplicates 4 → 2 (remaining two are the protected 7-char fragments).

Tests: `tests/test_synapse_teaching.py` 48 passed (added `test_dedupe_within_section_collapses_cross_track_problems`).

Integrity summary (final): no empty names; sections contiguous; no real file splits; CHI103/NEU201 in-section duplicates 0; ECO101 2 (protected short fragments). The remaining `We will` fragment is the mid-phrase-truncation parser issue (iteration 9).
