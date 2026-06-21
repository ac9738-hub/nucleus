// Task ranking helper.
// Functionality: scores tasks from due date, grade weight, effort, dependencies,
// and task type; renderer/render.js uses it to order task cards.
// Dependencies: browser global window.TaskOptimizer or CommonJS module export.
(function(root, factory) {
  const api = factory(
    typeof require === "function"
      ? require("./study-sections")
      : root && root.StudySections
  );

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root && typeof window !== "undefined") {
    root.TaskOptimizer = api;
  }
})(
  typeof window !== "undefined"
    ? window
    : (typeof globalThis !== "undefined" ? globalThis : null),
  function(StudySections) {
const Config = {
  K_BASE: 0.25,
  K_SCALE: 0.80,

  T_BASE: 1.5,
  T_SCALE: 8.0,

  W_URGENCY: 0.50,
  W_IMPORTANCE: 0.30,
  W_EFFORT: 0.10,
  W_DEPENDENCY: 0.10,
  W_PROXIMITY: 0.06,

  EXTERNAL_K: 0.60,
  EXTERNAL_THRESHOLD: 1.0,
  EXTERNAL_PRIORITY_CAP: 6.0,
  IMMINENCE_ONE: 1.12,

  STUDY_TASK_MULTIPLIER: 0.85,
  STUDY_PENALTY_AFTER_DAYS: 3,
  STUDY_PROGRESS_MIN_FRACTION: 0.08,
  STUDY_IMPORTANCE_FAR: 0.80,
  STUDY_SECTION_HOURS: 1.25,
  EFFORT_DAY_SCALE: 2.0,

  MAX_EFFORT_HOURS: 15.0,
  PROXIMITY_CAP: 10.0
};

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseDate(value) {
  if (!value || value === "No due date") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseExplicitOffsetDay(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T.*[+-]\d{2}:\d{2}$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    monthIndex: Number(match[2]) - 1,
    day: Number(match[3])
  };
}

function localDayParts(value) {
  const explicit = parseExplicitOffsetDay(value);
  if (explicit) return explicit;

  const date = parseDate(value);
  if (!date) return null;
  return {
    year: date.getFullYear(),
    monthIndex: date.getMonth(),
    day: date.getDate()
  };
}

function dayOrdinal(parts) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor(Date.UTC(parts.year, parts.monthIndex, parts.day) / msPerDay);
}

function resolveReferenceDay(referenceDate) {
  if (referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())) {
    return new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  }
  return startOfToday();
}

function startOfToday() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function daysUntilDue(dueDate, referenceDate) {
  const dueParts = localDayParts(dueDate);
  if (!dueParts) return 0;

  const refParts = localDayParts(referenceDate) || localDayParts(resolveReferenceDay(referenceDate));
  if (!refParts) return 0;

  return Math.max(dayOrdinal(dueParts) - dayOrdinal(refParts), 0);
}

function getGradeWeight(task) {
  if (Number.isFinite(task.gradeWeight)) return Math.min(Math.max(task.gradeWeight, 0), 1);
  if (Number.isFinite(task.grade_weight)) return Math.min(Math.max(task.grade_weight, 0), 1);

  const gradePercentage = Number(task.gradepercentage ?? task.gradePercentage);
  if (Number.isFinite(gradePercentage) && gradePercentage > 0) {
    return Math.min(gradePercentage / 100, 1);
  }

  const pointsPossible = Number(task.points_possible ?? task.pointsPossible);
  const courseTotalPts = Number(task.course_total_pts ?? task.courseTotalPts);
  if (Number.isFinite(pointsPossible) && Number.isFinite(courseTotalPts) && courseTotalPts > 0) {
    return Math.min(Math.max(pointsPossible / courseTotalPts, 0), 1);
  }

  return 0;
}

function getEstimatedHours(task) {
  const explicit = Number(task.estimated_hours ?? task.estimatedHours ?? task.estimated_hours);
  if (Number.isFinite(explicit)) return explicit;

  const estimate = task.estimate;
  if (typeof estimate === "number") return estimate;
  if (typeof estimate === "string") {
    const match = estimate.match(/(\d+(?:\.\d+)?)/);
    if (match) return Number(match[1]);
  }

  return 3.0;
}

function parseEstimateHours(task) {
  return getEstimatedHours(task);
}

function getDependencyCount(task) {
  if (Number.isFinite(task.dependency_count)) return task.dependency_count;
  if (Number.isFinite(task.dependencyCount)) return task.dependencyCount;
  if (Array.isArray(task.dependencies)) return task.dependencies.length;
  if (Array.isArray(task.submissionDependencies) && task.submissionDependencies.length) {
    return task.submissionDependencies.length;
  }
  if (Array.isArray(task.conceptRequirements) && task.conceptRequirements.length) {
    return task.conceptRequirements.length;
  }
  if (Array.isArray(task.problems)) return task.problems.length;
  return 0;
}

function getTaskType(task) {
  return task.task_type || task.taskType || task.type || "academic";
}

function isStudyTask(task, taskType) {
  const typeValue = String(taskType || getTaskType(task) || "").toLowerCase();
  const titleValue = String(task && (task.name || task.title) || "").toLowerCase();
  return typeValue.includes("study") || titleValue.includes("study");
}

function isExternalTaskType(taskType) {
  return ["external", "email", "admin"].includes(String(taskType || "").toLowerCase());
}

function isSubmissionTask(task, taskType) {
  if (isStudyTask(task, taskType)) return false;
  if (isExternalTaskType(taskType)) return false;
  return true;
}

function calcUrgency(days, gradeWeight, taskType = "academic", cfg = Config, options = {}) {
  let k;
  let threshold;

  if (isExternalTaskType(taskType)) {
    k = cfg.EXTERNAL_K;
    threshold = cfg.EXTERNAL_THRESHOLD;
  } else {
    k = cfg.K_BASE + (cfg.K_SCALE * gradeWeight);
    threshold = cfg.T_BASE + (cfg.T_SCALE * gradeWeight);
  }

  let score = 10.0 / (1.0 + Math.exp(k * (days - threshold)));
  if (days <= 1 && options.submissionImminence) {
    score *= cfg.IMMINENCE_ONE ?? 1.0;
  }
  return round(score);
}

function calcImportance(gradeWeight, task, taskType, cfg = Config) {
  const fromGrade = Math.min(gradeWeight * 20.0, 10.0);
  if (fromGrade > 0) return round(fromGrade);

  if (isExternalTaskType(taskType)) {
    const priorityWeight = Number(task?.priority_weight ?? task?.priorityWeight);
    if (Number.isFinite(priorityWeight) && priorityWeight > 0) {
      const cap = cfg.EXTERNAL_PRIORITY_CAP ?? 6.0;
      return round(Math.min(priorityWeight, cap));
    }
  }

  return 0.0;
}

function calcDeadlineProximityBonus(days, cfg = Config) {
  const cap = cfg.PROXIMITY_CAP ?? 10.0;
  const weight = cfg.W_PROXIMITY ?? 0.0;
  return round(Math.max(0, cap - Math.min(days, cap)) * weight);
}

function calcEffort(estimatedHours, urgency, days, cfg = Config) {
  if (estimatedHours <= 0) return 0.0;

  const raw = Math.sqrt(estimatedHours / cfg.MAX_EFFORT_HOURS) * 10.0;
  const capped = Math.min(raw, 10.0);
  const urgencyScale = urgency / 10.0;
  const dayScale = 1.0 / (1.0 + days / (cfg.EFFORT_DAY_SCALE ?? 2.0));
  return round(capped * urgencyScale * dayScale);
}

function calcDependency(dependencyCount, urgency, days, cfg = Config) {
  if (dependencyCount <= 0) return 0.0;

  const raw = (1 - Math.exp(-0.5 * dependencyCount)) * 10.0;
  const capped = Math.min(raw, 10.0);
  const urgencyScale = urgency / 10.0;
  const dayScale = 1.0 / (1.0 + days / (cfg.EFFORT_DAY_SCALE ?? 2.0));
  return round(capped * urgencyScale * dayScale);
}

function zeroScore(task) {
  return {
    task_id: task.id,
    name: task.name || task.title,
    course: task.course,
    days_until_due: 0,
    grade_weight: 0,
    urgency: 0,
    importance: 0,
    effort: 0,
    dependency: 0,
    proximity: 0,
    raw_score: 0,
    priority_score: 0,
    status: "done",
    task
  };
}

function getStudyProgressStats(task, taskType) {
  if (!isStudyTask(task, taskType)) return null;
  return StudySections.getStudyProgressStats(task);
}

function calcPriority(task, cfg = Config) {
  if (task.status === "done") return zeroScore(task);

  const gradeWeight = getGradeWeight(task);
  const taskType = getTaskType(task);
  const studyStats = getStudyProgressStats(task, taskType);
  if (studyStats?.isComplete) return zeroScore(task);

  const days = daysUntilDue(
    task.due_date ?? task.dueDate ?? task.due,
    cfg.REFERENCE_DATE
  );
  let estimatedHours = getEstimatedHours(task);
  let dependencyCount = getDependencyCount(task);
  const minFraction = cfg.STUDY_PROGRESS_MIN_FRACTION ?? 0.08;
  if (studyStats) {
    const remainingFraction = Math.max(
      studyStats.remainingFraction,
      studyStats.remaining ? minFraction : 0
    );
    estimatedHours *= remainingFraction;
    dependencyCount = studyStats.remaining;
  }

  const urgency = calcUrgency(days, gradeWeight, taskType, cfg, {
    submissionImminence: isSubmissionTask(task, taskType)
  });
  let importance = calcImportance(gradeWeight, task, taskType, cfg);
  if (isStudyTask(task, taskType) && days > 1) {
    importance = round(importance * (cfg.STUDY_IMPORTANCE_FAR ?? 0.85));
  }
  const effort = calcEffort(estimatedHours, urgency, days, cfg);
  const dependency = calcDependency(dependencyCount, urgency, days, cfg);
  const proximity = calcDeadlineProximityBonus(days, cfg);
  const studyMultiplier = isStudyTask(task, taskType) && days > (cfg.STUDY_PENALTY_AFTER_DAYS ?? 3)
    ? cfg.STUDY_TASK_MULTIPLIER
    : 1.0;
  let rawScore = (
    urgency * cfg.W_URGENCY +
    importance * cfg.W_IMPORTANCE +
    effort * cfg.W_EFFORT +
    dependency * cfg.W_DEPENDENCY +
    proximity
  ) * studyMultiplier;

  if (studyStats && studyStats.remainingFraction > 0 && studyStats.remainingFraction < 1) {
    rawScore *= Math.max(
      minFraction,
      0.35 + (0.65 * studyStats.remainingFraction)
    );
  }

  return {
    task_id: task.id,
    name: task.name || task.title,
    course: task.course,
    days_until_due: days,
    grade_weight: round(gradeWeight),
    urgency,
    importance,
    effort,
    dependency,
    proximity,
    study_sections_total: studyStats?.total ?? 0,
    study_sections_completed: studyStats?.completed ?? 0,
    study_remaining_fraction: studyStats ? round(studyStats.remainingFraction) : null,
    next_study_section: studyStats?.nextSection?.label ?? null,
    raw_score: round(rawScore),
    status: task.status || "not_started",
    task
  };
}

function rankTasks(tasks, cfg = Config) {
  const scores = tasks.map(task => calcPriority(task, cfg));
  const active = scores.filter(score => score.raw_score > 0);

  if (active.length) {
    const maxRaw = Math.max(...active.map(score => score.raw_score));
    const minRaw = Math.min(...active.map(score => score.raw_score));
    const range = maxRaw !== minRaw ? maxRaw - minRaw : 1.0;

    active.forEach(score => {
      score.priority_score = round(((score.raw_score - minRaw) / range) * 10.0, 2);
    });
  }

  scores.forEach(score => {
    if (!Number.isFinite(score.priority_score)) {
      score.priority_score = 0.0;
    }
  });

  return scores.sort((left, right) => {
    const scoreDelta = right.raw_score - left.raw_score;
    if (scoreDelta !== 0) return scoreDelta;
    if (left.days_until_due !== right.days_until_due) {
      return left.days_until_due - right.days_until_due;
    }

    const leftPriority = Number(left.task?.priority_weight ?? left.task?.priorityWeight ?? 0);
    const rightPriority = Number(right.task?.priority_weight ?? right.task?.priorityWeight ?? 0);
    if (leftPriority !== rightPriority) return rightPriority - leftPriority;

    return String(left.task_id).localeCompare(String(right.task_id));
  });
}

function orderTasks(tasks, cfg = Config) {
  return rankTasks(tasks, cfg);
}

const TaskOptimizer = {
  Config,
  resolveReferenceDay,
  isExternalTaskType,
  isSubmissionTask,
  calcUrgency,
  calcImportance,
  calcDeadlineProximityBonus,
  calcEffort,
  calcDependency,
  calcPriority,
  rankTasks,
  orderTasks
};

return TaskOptimizer;
});
