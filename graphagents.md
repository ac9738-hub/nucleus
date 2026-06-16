# Graph + RAG agent iteration

## Problem statement

Nucleus answers student questions by retrieving nodes from `canvas_graph.json` and injecting them into the sidekick agent as `callContext`. The graph is built by `parser.py` from Canvas courses (syllabi, assignments, files, module pages, concepts, problems, events). Retrieval runs in `vector_retreival.py` and is invoked from `main.js` on every user message (agent mode) and every in-app search (browser mode).

**The gap is not missing Canvas data in most cases; it is incomplete graph coverage, weak embeddings, and retrieval that ranks the wrong node types.** A user asking “when is the CHM 201 exam?” should surface exam/event nodes and syllabus prose — not unrelated problem sets. A search for “lecture slides” should return `file` nodes, not only assignments whose descriptions mention a filename.

Ground truth for this loop lives in `RAG_ground_truth.json` (20 queries × top-5 retrieved nodes). A miss means retrieval or the underlying graph failed to surface information that exists in Canvas — not that the answer is unknowable.

**Primary goal:** improve **graph completeness**, **embedding coverage**, and **retrieval ranking/expansion** so search and agent queries return the right node types from the right courses.

**Secondary goal:** improve how `sidekick.py` uses retrieved context (prompt structure, tool routing) once retrieval quality is measurable.

**Target (iteration 1):** establish a repeatable RAG eval harness and raise aggregate recall@5 on `RAG_ground_truth.json` without course- or query-specific hacks.

---

## Agent tasks

The graph/RAG cloud agent is responsible for the full path from parsed Canvas data to useful retrieved context. Work in this order unless a miss clearly points elsewhere.

### Task 1 — Diagnose retrieval misses

For each query in `RAG_ground_truth.json` (or a fresh run of `scripts/build_rag_ground_truth.py`):

1. Run retrieval with **production settings** (semantic cutoff enabled).
2. Compare live top-5 to the ground-truth snapshot (or to human-judged “should retrieve”).
3. Classify the miss:

| Miss class | Symptom | Likely fix area |
| ---------- | ------- | --------------- |
| **Graph gap** | Correct content never entered `canvas_graph.json` | `parser.py`, `llm_parse.py`, fetch/enrichment |
| **Embedding gap** | Node exists but has no `embedded.name` / `embedded.description` | `parser.py` embedding pass, re-parse |
| **Ranking gap** | Node is embedded and in pool but scored below cutoff or below top-k | `vector_retreival.py` scoring, intent routing, course pool |
| **Expansion gap** | Correct startpoint found but neighbors (concept, file, event) not expanded | `node_neighbors`, `expand_startpoints` |
| **Mode gap** | Correct node type filtered out by `browser` vs `agent` mode rules | mode-specific filters in `expand_startpoints` |
| **Agent-use gap** | Retrieval is fine but sidekick ignores or misreads `callContext` | `sidekick.py`, `formatRetrievalContext` in `main.js` |

Always locate the **source in Canvas** (syllabus body, assignment description, module file, page HTML) before changing code.

### Task 2 — Improve graph ingestion (upstream)

When the miss is a **graph gap** or **embedding gap**:

1. Confirm the source exists in `canvas_data.json` or on-disk PDFs under `canvasfiles/`.
2. Check whether `parser.py` / `llm_parse.py` batches included that source type (syllabus, assignment, page, module_item, file).
3. Fix traversal or prompts so the content becomes a typed node with embeddings.
4. Rebuild `canvas_graph.json` (full parser run or targeted re-parse).
5. Re-run RAG ground-truth builder and eval.

Do **not** patch retrieval to compensate for nodes the parser never created unless the parser path is genuinely unreachable in this iteration.

### Task 3 — Improve retrieval (downstream)

When the miss is **ranking**, **expansion**, or **mode** class:

1. Edit `vector_retreival.py` — query preparation, intent classification, course pool selection, score combination, neighbor expansion, mode filters.
2. Prefer changes that apply to **intent categories** (exam, deadline, syllabus, concept, practice) not individual queries.
3. Run `python scripts/build_rag_ground_truth.py` after edits (requires `OPENAI_API_KEY`).
4. Compare recall@5 / nDCG@5 against the previous baseline report.

Key production behaviors to preserve unless intentionally changing them:

- **Agent mode** (`main.js` → `senduserprompt`): `mode: 'agent'`, default `k=3`, full node-type expansion, results formatted as `callContext` for `sidekick.py`.
- **Search mode** (`openEngineSearchInTab`): `mode: 'browser'`, up to 12 internal candidates, expands to **file and assignment** nodes only, shown alongside Brave web results.
- **Semantic cutoff:** `RETRIEVAL_SEMANTIC_SCORE_CUTOFF = 0.45` — nodes below this are dropped from startpoints in production (ground-truth builder disables this to always record top-5).

### Task 4 — Run eval and report

After logic changes:

```bash
# Regenerate ground truth from live graph + retrieval (optional; commits snapshot)
python scripts/build_rag_ground_truth.py

# Quick manual probe
python -c "from vector_retreival import retreive, serialize_startpoint; \
  r=retreive('When is the CHM 201 exam?', k=5, mode='agent'); \
  print([serialize_startpoint(x)['name'] for x in r[:5]])"

# Parser/graph tests if graph extraction changed
python -m pytest tests/test_finalize_events.py -q
```

Write iteration notes to the **Iteration log** section at the bottom of this file (accuracy deltas, miss classes fixed, rejected changes).

### Task 5 — Sidekick integration (later iterations)

Once retrieval recall@5 is stable:

- Ensure `callContext` node types match what the model can act on (URLs, due dates, course ids).
- Reduce hardcoded syllabus injection in `sidekick.py` in favor of graph-retrieved syllabus nodes.
- Align classifier routing (TOOL_ACTION / APP_DATA_REQUEST / GENERAL_CHAT) with graph-backed answers.

Iteration 1 should **measure retrieval first**; sidekick prompt edits are out of scope unless retrieval is already correct for that query class.

---

## Pipeline

```
Canvas LMS
    ↓ fetch (canvas_data.json, canvasfiles/)
parser.py + llm_parse.py
    ↓ concepts, problems, events, files, syllabi, edges, embeddings
canvas_graph.json
    ↓ load + rank (vector_retreival.py)
Retrieved startpoints (+ neighbors)
    ↓ formatRetrievalContext (main.js)
callContext → sidekick.py → user-facing answer / tools
```

| Stage | File | Role |
| ----- | ---- | ---- |
| Ingest | `parser.py`, `canvas_parser/weekly_iteration/llm_parse.py` | LLM passes extract nodes and relationships |
| Finalize events | `canvas_parser/graph/events.py` | Date/type normalization for exams, deadlines, office hours |
| Persist | `canvas_graph.json` | Versioned graph store (~19 courses in current snapshot) |
| Retrieve | `vector_retreival.py` | Embed query, score nodes, expand neighbors, serialize |
| Agent bridge | `main.js` | Spawns retrieval subprocess; attaches `callContext` to agent payload |
| Agent | `sidekick.py` | Claude tools + retrieved context |
| Eval GT | `RAG_ground_truth.json` | 10 search + 10 agent queries with top-5 results |
| GT builder | `scripts/build_rag_ground_truth.py` | Regenerates GT from live graph |

---

## Terms

### Graph nodes

| Term | Meaning |
| ---- | ------- |
| **concept** | Top-level knowledge unit for a course; links to details, examples, problems, prerequisite concepts |
| **detail** | Sub-point of a concept (definition, mechanism, policy clause) |
| **example** | Worked example or illustration attached to a concept |
| **problem** | Practice or assignment problem; links to concepts and assignments |
| **assignment** | Canvas assignment (due date, description, submission URL); stored under syllabus |
| **event** | Calendar-like item: exam, quiz, office hours, lecture, deadline, review session |
| **file** | PDF or study material; may link to concepts/problems; may contain `pages[].blocks[]` text |
| **syllabus** | Per-course syllabus node with grading policy, schedule hints, nested assignments |
| **learningBlock** | PDF block span linked to a concept (viewport-aware context pipeline) |
| **edge** | Typed relationship (e.g. `event --requires_reading--> file`) |

### Retrieval

| Term | Meaning |
| ---- | ------- |
| **startpoint** | Top-scoring node(s) before neighbor expansion |
| **neighbor expansion** | Pull related concepts, files, problems, assignments from graph adjacency |
| **browser mode** | Search-bar retrieval; files and assignments only |
| **agent mode** | Chat retrieval; all node types + expansion |
| **raw mode** | Startpoints only, no expansion (debug) |
| **course pool** | Subset of courses searched after course-level embedding + keyword match |
| **intent** | Query class: `deadline`, `exam`, `assignment`, `practice`, `concept`, `syllabus`, `general` — appends context phrase to embedding text |
| **semantic score** | Dot product of query embedding vs node `embedded.name` or `embedded.description` |
| **fuzzy score** | Token overlap / partial string match on course-scoped node name |
| **course score** | Course catalog embedding + keyword match (`semantic_fuzzy`) |
| **similarity** | Combined rank: semantic + fuzzy + course (see `combine_retrieval_scores`) |
| **semantic cutoff** | Production filter at 0.45; nodes below are excluded from startpoints |
| **callContext** | Plain-text block of retrieved nodes injected into the sidekick user message |

### Eval

| Term | Meaning |
| ---- | ------- |
| **RAG ground truth** | `RAG_ground_truth.json` — frozen query → top-5 node list |
| **recall@k** | Fraction of human-expected relevant nodes found in top-k |
| **nDCG@k** | Rank-aware score rewarding relevant nodes near the top |
| **search query** | Short keyword query mimicking Nucleus search bar (`browser` mode) |
| **agent query** | Natural-language question mimicking sidekick chat (`agent` mode) |

### Agent (sidekick)

| Term | Meaning |
| ---- | ------- |
| **contextSnapshot** | Structured live UI state (tabs, visible PDF blocks, workspace layout) |
| **systemContext** | Ad-hoc text context (region capture, caller extras) |
| **classifier** | Routes messages toward tool-action (Claude), app-data (DeepSeek), or general chat |
| **tool_action** | Mutating app state — tasks, workspaces, open Canvas tab |

---

## Anti-overfitting guardrails

These apply to **all** graph and retrieval changes. Violations invalidate the iteration even if eval scores rise.

### Do not

- Add **ground-truth query strings** or paraphrases as hardcoded branches (e.g. `if "CHM 201 syllabus" in query`).
- Add **ground-truth node ids**, assignment ids, file ids, or event ids as pinned results.
- Add **course-specific score boosts** (e.g. always rank course `15160` first for chemistry).
- Add **title literals from `RAG_ground_truth.json`** as exact-match shortcuts (e.g. boosting `"Excel Prelab"` for syllabus queries).
- Encode **calendar dates tied to one course** as retrieval anchors (e.g. “October 9 midterm” → ASA344 only).
- Special-case the **10 GT queries** in production code; they are eval fixtures only.
- Fix a miss by **fabricating nodes** not traceable to Canvas source material.
- Disable semantic cutoff globally to inflate scores without improving ranking quality.

### Do

- Fix **general intent routing** (exam queries prefer `event` + syllabus; syllabus queries prefer `syllabus` + policy files).
- Improve **batch coverage** so missing node types get parsed and embedded.
- Use **structural signals**: node type, due date proximity, event type, module name patterns, submission type.
- Tune **thresholds and weights** with documented rationale across many queries, not one GT row.
- Add **eval metrics** that sample beyond the 10+10 GT queries (held-out query set, iteration 2).
- Prefer **embedding text enrichment** (include course code, node type, module path in embedded fields) over query-specific rules.

### Acceptable borderline patterns

- Intent keyword lists (`INTENT_KEYWORDS`, `INTENT_CONTEXT`) — already generalized.
- Course pool thresholds (`COURSE_SEMANTIC_FUZZY_STRONG_THRESHOLD`) — global tuning knobs.
- Node-type filters in browser mode — product constraint, not GT overfit.
- Fuzzy stopword lists and query prefix stripping — general NLP hygiene.

When in doubt, ask: **would this rule help a new course and a new query with the same intent?** If no, reject it.

---

## Cloud agent setup

### Secrets

| Variable | Required? | Notes |
| -------- | --------- | ----- |
| `OPENAI_API_KEY` | **Yes** | Query + course embeddings in `vector_retreival.py` |
| `DEEP_SEEK_API_KEY` | For graph rebuild | Parser LLM passes when fixing ingestion |
| `ANTHROPIC_API_KEY` | Optional | Sidekick integration tests |
| `CANVAS_AUTH_COOKIE` | For refresh | Re-fetch Canvas when graph is stale |

### Bootstrap artifacts

| Artifact | Location | Committed? |
| -------- | -------- | ---------- |
| Parsed graph | `canvas_graph.json` | Yes (large) |
| Course catalog | `canvas_data.json` | Yes |
| RAG ground truth | `RAG_ground_truth.json` | Yes |
| GT builder | `scripts/build_rag_ground_truth.py` | Yes |
| PDF files | `canvasfiles/` | Partial / local |

### Update script (cloud VM)

```bash
pip install -r requirements.txt 2>/dev/null || pip install openai numpy python-dotenv 2>/dev/null || true
```

### Suggested cloud agent prompt

> Read `graphagents.md`. Improve RAG retrieval quality against `RAG_ground_truth.json` by fixing graph gaps, embedding gaps, and ranking/expansion — in that priority order. Do not add query-specific or course-specific literals.
>
> 1. Run retrieval diagnostics on all 20 GT queries (production cutoff ON).
> 2. For each miss, classify: graph / embedding / ranking / expansion / mode / agent-use.
> 3. Fix upstream parser/embedding issues before tuning scores.
> 4. Edit `vector_retreival.py` with general intent and node-type patterns only.
> 5. Regenerate GT: `python scripts/build_rag_ground_truth.py`
> 6. Run `python -m pytest tests/test_finalize_events.py -q` if graph extraction changed.
> 7. Log results in the Iteration log below.
> 8. Stop when recall@5 improves measurably OR fixes require overfitting guardrail violations.

---

## Where to edit

| Area | File |
| ---- | ---- |
| Parser LLM passes | `parser.py` |
| Parser batch coverage | `canvas_parser/weekly_iteration/llm_parse.py` |
| Event extraction | `canvas_parser/graph/events.py` |
| Retrieval scoring & expansion | `vector_retreival.py` |
| Agent context formatting | `main.js` (`formatRetrievalContext`, `vectorRetrieval`) |
| Sidekick consumption | `sidekick.py` |
| RAG GT generation | `scripts/build_rag_ground_truth.py` |
| Graph analysis | `scripts/analyze_graph.py` |
| Local retrieval probe | `canvas_vector_tester.js` |

---

## First iteration ideas

Baseline observations from initial `RAG_ground_truth.json` (2026-06-16):

| Issue | Example | Proposed direction |
| ----- | ------- | ------------------ |
| **Assignment-heavy results** | “CHM 201 syllabus” → problem sets, not syllabus PDF | Boost `syllabus` nodes and `file` nodes with syllabus keywords when intent = `syllabus`; ensure syllabus PDFs are embedded |
| **Event nodes absent** | “When is the CHM 201 exam?” → problem sets | When intent = `exam` or `deadline`, include `event` bucket in rank pass; boost dated events over undated assignments |
| **Office hours miss** | “Office hours for MAT 201” → PSETs | Parse and embed `office_hours` events; intent keyword `office hour` → event type filter |
| **File underrepresentation in browser mode** | “ECO 101 lecture slides” → homework assignments | Embed file names from module items; include `files[]` in browser expansion when query mentions slides/notes/PDF |
| **Low embedding coverage** | ART102 returns only 4 assignments | Audit nodes missing `embedded`; re-run embedding pass in parser |
| **Course pool bleed** | “tariffs” briefly matched wrong course | Tighten moderate pool when keyword match is strong; require course token overlap |
| **Production cutoff drops valid hits** | GT uses cutoff=0; prod returns `[]` for some queries | Separate “score improvement” from “cutoff tuning”; document per-intent cutoff if needed |
| **Concept/practice path unused** | “What concepts on MAT 201 midterm?” → QUIZ assignment | Expand from exam events via `requires_reading` edges to linked files/concepts |
| **Agent never sees PDF blocks** | Retrieval returns metadata only | Iteration 2: attach top block text from `learningBlocks` / file pages to `callContext` |
| **No eval script yet** | Manual JSON diff only | Add `scripts/eval_rag.py`: recall@5, nDCG@5, per-intent breakdown, production vs full-rank |

### Iteration 1 scope (recommended)

1. **Ship `scripts/eval_rag.py`** — compare live retrieval (cutoff ON) to `RAG_ground_truth.json`; print per-query and aggregate metrics.
2. **Embedding audit** — count nodes per type with/without `embedded`; re-embed gaps via parser hook or batch script.
3. **Intent → node-type priors** — general additive boosts for `exam`→event, `syllabus`→syllabus/file, `practice`→problem/example (not query-specific).
4. **Event ingestion** — ensure dated exams/office hours from syllabus prose reach `events[]` with embeddings (coordinate with `events.py` if needed).
5. **Re-run GT + eval** — record recall@5 delta in iteration log.

### Out of scope for iteration 1

- Sidekick prompt rewrites and classifier changes.
- Replacing vector search with BM25-only or full LLM reranker.
- Committing new GT query literals to production retrieval code.
- End-to-end LLM-judged answer quality (iteration 2+).

---

## Iteration log

### 2026-06-16 — Bootstrap

**Artifacts:** Created `RAG_ground_truth.json` (10 search + 10 agent queries, top-5 each) and `scripts/build_rag_ground_truth.py`.

**Baseline findings (qualitative):**

- Most search and agent queries return **assignments only**; files, events, and syllabus nodes rarely appear in top-5.
- Several agent queries that should hit **events** (exam date, office hours) rank problem sets instead.
- Browser and agent modes share scoring but differ in expansion filters; browser is assignment-heavy by design.
- Production semantic cutoff (0.45) would return **empty** results for queries that GT captures with cutoff disabled — scoring headroom is a first-class problem.

**Next iteration:** Implement `scripts/eval_rag.py`, embedding coverage audit, intent→node-type priors in `vector_retreival.py`.
