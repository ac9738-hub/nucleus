# Task optimizer iteration

Eval harness for ranking Canvas and workspace tasks. Mirrors the weekly schedule iteration loop: fixture scenarios, structured miss report, algorithm versions.

## Evaluate

```bash
npm run eval:task-optimizer
# or
node task_optimizer_iteration/run.js
node --test tests/task_optimizer_iteration.test.js
```

Report: `.cache/task_optimizer/report.json` (primary + holdout + overfitting audit)

Holdout only: `.cache/task_optimizer/report_holdout.json`

Fixtures:

- `fixtures/task_optimizer/scenarios_gt.json` — primary regression set
- `fixtures/task_optimizer/scenarios_holdout.json` — unseen dates/tasks for generalization

Bootstrap from live tasks:

```bash
node scripts/build_task_optimizer_fixtures.js --export .cache/task_optimizer/tasks_export.json
node scripts/build_task_optimizer_fixtures.js --graph canvas_graph.json
```

## Where to edit

| Area | File |
| --- | --- |
| Scoring / ranking | `taskoptimizer.js` |
| Study section split + progress | `study-sections.js` |
| Task progress persistence | `data-store.js` (`updateStudySectionProgress`) |
| Algorithm wrapper + version label | `task_optimizer_iteration/algorithm.js` |
| Pairwise / Kendall eval | `task_optimizer_iteration/evaluate.js` |
| CLI + report | `task_optimizer_iteration/run.js` |
| Scenario fixtures | `fixtures/task_optimizer/scenarios_gt.json` |
| Holdout fixtures | `fixtures/task_optimizer/scenarios_holdout.json` |
| Overfitting audit | `task_optimizer_iteration/overfitting.js` |

## Overfitting guardrails

Do **not** add primary-fixture task IDs, course names, or tuned constants chosen to match a single scenario literal.

Each eval run checks:

| Audit | What it catches |
| --- | --- |
| Literal scan | Primary fixture IDs/titles hardcoded in `taskoptimizer.js` |
| Date-shift invariance | Ranking unchanged when all dates shift +14 days |
| Monotonic due-date pairs | Equal grade weight → earlier due wins |
| Parameter robustness | Reports accuracy when `IMMINENCE_ONE`, `W_PROXIMITY`, or study horizon removed |
| Holdout set | Separate fixture with generic titles and September reference date |

Pass criteria (default): primary 100%, holdout 100%, overfitting audit pass (risk: low).

## Scenario tiers

- **baseline** — primary regression scenarios (must pass every iteration)
- **holdout** — unseen generic scenarios; not used to tune constants
- **stretch** — optional harder constraints (legacy tier)

---

## Iteration log

### 2026-06-17 — Iteration 0 (harness)

Built `task_optimizer_iteration/` module, five fixture scenarios from current task field shapes (`make_canvas_tasks`, `data-store`, sidekick admin tasks), and **v1** algorithm (= original weighted sigmoid in `taskoptimizer.js`).

| Tier | Accuracy |
| --- | --- |
| Baseline | **100%** |
| Stretch | **50%** |
| Aggregate | **70%** |

Stretch misses (v1):

| Scenario | Miss | Root cause |
| --- | --- | --- |
| external_admin_burst | admin hold < low-weight draft | `priority_weight` ignored; effort on small admin tasks |
| completed_tasks_sink | quiz < lab (1d vs 2d) | Grade-weight importance outweighed 1-day urgency gap |
| dependency_heavy_pset | PSET ranked first | Raw effort + dependency dominated before deadline proximity |

### 2026-06-17 — Iteration 1 (v2_deadline_aware)

**Eval command:** `node task_optimizer_iteration/run.js`

| Tier | v1 | v2 | Δ |
| --- | --- | --- | --- |
| Baseline | 100% | **100%** | — |
| Stretch | 50% | **100%** | +50 |
| Aggregate | 70% | **100%** | +30 |

**Changes in `taskoptimizer.js`:**

| Change | Purpose |
| --- | --- |
| `Config.REFERENCE_DATE` | Deterministic eval dates (unchanged in production) |
| `calcImportance` + `priority_weight` fallback | External/admin/email tasks use sidekick priority when grade weight is 0 (cap 6) |
| `calcDeadlineProximityBonus` | `(10 − days) × W_PROXIMITY` rewards nearer deadlines |
| `calcEffort` / `calcDependency` urgency + day scaling | Large far-deadline PSETs no longer outrank due-tomorrow check-ins |
| `IMMINENCE_ONE` urgency boost | Assignments due ≤1 day rank above nearby study blocks |
| `STUDY_PENALTY_AFTER_DAYS` | Study multiplier only when due >3 days out |
| Sort tie-break | Equal raw scores → earlier due date wins |

**Algorithm label:** `v2_deadline_aware` (`task_optimizer_iteration/algorithm.js`)

**Tests:** 7 passed (`tests/task_optimizer_iteration.test.js`)

**Follow-up:** Promoted former stretch scenarios to baseline after v2 hit 100% aggregate.

**Next iteration candidates:**

1. Promote stretch scenarios to baseline-only set once stable across live task exports
2. Use `priority_weight` for manual workspace tasks (not only external types)
3. Pairwise eval from auto-generated exports via `scripts/build_task_optimizer_fixtures.js`

### 2026-06-17 — Iteration 2 (v3_generalized_priority + overfitting audit)

**Eval command:** `node task_optimizer_iteration/run.js`

**Overfitting review (v2 carry-over):**

| Change | Verdict |
| --- | --- |
| `IMMINENCE_ONE` on all due ≤1 day tasks | **Replaced** — also boosted study tasks; submission-only imminence instead |
| `priority_weight` external-only | **Kept external-only in importance**; manual uses tie-break at equal due date |
| `W_PROXIMITY`, `EFFORT_DAY_SCALE`, caps | **Acceptable** — structural deadline/effort scaling |
| Primary fixture literals in code | **None found** |

**Added infra:**

| Area | Files | Change |
| --- | --- | --- |
| Holdout set | `fixtures/task_optimizer/scenarios_holdout.json` | Generic tasks, Sept 2026 reference date |
| Overfitting audit | `task_optimizer_iteration/overfitting.js` | Literal scan, date-shift, monotonic pairs, parameter robustness |
| Report | `task_optimizer_iteration/run.js` | Primary + holdout + audit in one report |

**Algorithm v3 changes (`taskoptimizer.js`):**

| Change | Purpose |
| --- | --- |
| `isSubmissionTask` + submission-only imminence | Due-tomorrow assignments beat nearby study blocks |
| `priority_weight` sort tie-break | Same deadline → higher sidekick priority wins (manual tasks only at tie) |

| Set | v2 | v3 |
| --- | --- | --- |
| Primary | 100% | **100%** |
| Holdout | n/a | **100%** |
| Overfitting audit | n/a | **PASS (low risk)** |

**Parameter robustness note:** Removing `IMMINENCE_ONE` or `W_PROXIMITY` drops primary aggregate below 85%. That sensitivity is expected for deadline-aware ranking — not evidence of fixture literal overfit.

**Tests:** 10 passed (`tests/task_optimizer_iteration.test.js`)

**Next iteration candidates:**

1. Live-task export holdout via `scripts/build_task_optimizer_fixtures.js --graph`
2. Auto-generated pairwise constraints from exports (do not tune constants against them)
3. Soften coupling between proximity and imminence if robustness report blocks future changes

### 2026-06-17 — Iteration 3 (v4_study_sections)

**Eval command:** `node task_optimizer_iteration/run.js`

**User requirement:** Study tasks are multi-session; split into sections, track progress, and factor remaining work into ranking.

**Added:**

| Area | Files | Change |
| --- | --- | --- |
| Section planner | `study-sections.js` | Build sections from learning blocks → concepts → files; track `studyProgress.completedSectionIds` |
| Canvas tasks | `app/canvas/api.js` | Emit `studySections` + empty `studyProgress` on study tasks |
| Persistence | `data-store.js` | `updateStudySectionProgress(taskId, sectionId, status)` |
| Ranking | `taskoptimizer.js` | Scale effort/dependency/raw score by remaining section fraction; zero score when all sections done |
| Study importance | `taskoptimizer.js` | `STUDY_IMPORTANCE_FAR` discounts exam weight when study due >1 day out (keeps due-tomorrow submissions ahead) |
| Section split | `study-sections.js` | Estimate-only study tasks split into ~1.25h sessions when no blocks/concepts/files |

**Algorithm v4 behavior:**

- Remaining sections reduce effort and dependency weight proportionally
- Partial progress applies an additional dampening factor on study raw score
- Completed section sets behave like finished tasks (sink below active work)
- Fresh study (all sections pending) ranks above mostly-complete study at equal due date/weight

| Set | v3 | v4 |
| --- | --- | --- |
| Primary | 100% | **100%** (6 scenarios) |
| Holdout | 100% | **100%** (6 scenarios) |
| Overfitting audit | PASS | **PASS** |

**Overfitting review:** Section IDs in fixtures are generic (`sec-1`, `topic-a`); ranking rules use `remainingFraction` and section counts only — no course-specific literals.

**Tests:** 14 passed (`tests/study-sections.test.js`, `tests/task_optimizer_iteration.test.js`)

**Next iteration candidates:**

1. Surface `next_study_section` in task cards / sidekick context
2. IPC hook for `updateStudySectionProgress` from renderer
3. Auto-advance section progress from file/concept coverage in parser graph
