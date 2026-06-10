// Task ranking helper.
// Functionality: scores tasks from due date, grade weight, effort, dependencies,
// and task type; renderer/render.js uses it to order task cards.
// Dependencies: browser global window.TaskOptimizer or CommonJS module export.
const Config = {
  K_BASE: 0.25,
  K_SCALE: 0.80,

  T_BASE: 1.5,
  T_SCALE: 8.0,

  W_URGENCY: 0.50,
  W_IMPORTANCE: 0.30,
  W_EFFORT: 0.10,
  W_DEPENDENCY: 0.10,

  EXTERNAL_K: 0.60,
  EXTERNAL_THRESHOLD: 1.0,

  STUDY_TASK_MULTIPLIER: 0.85,

  MAX_EFFORT_HOURS: 15.0
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

function startOfToday() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function daysUntilDue(dueDate) {
  const date = parseDate(dueDate);
  if (!date) return 0;

  const dueDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(Math.ceil((dueDay - startOfToday()) / msPerDay), 0);
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

function getDependencyCount(task) {
  if (Number.isFinite(task.dependency_count)) return task.dependency_count;
  if (Number.isFinite(task.dependencyCount)) return task.dependencyCount;
  if (Array.isArray(task.dependencies)) return task.dependencies.length;
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

function calcUrgency(days, gradeWeight, taskType = "academic", cfg = Config) {
  let k;
  let threshold;

  if (["external", "email", "admin"].includes(taskType)) {
    k = cfg.EXTERNAL_K;
    threshold = cfg.EXTERNAL_THRESHOLD;
  } else {
    k = cfg.K_BASE + (cfg.K_SCALE * gradeWeight);
    threshold = cfg.T_BASE + (cfg.T_SCALE * gradeWeight);
  }

  const score = 10.0 / (1.0 + Math.exp(k * (days - threshold)));
  return round(score);
}

function calcImportance(gradeWeight) {
  return round(Math.min(gradeWeight * 20.0, 10.0));
}

function calcEffort(estimatedHours, cfg = Config) {
  if (estimatedHours <= 0) return 0.0;

  const raw = Math.sqrt(estimatedHours / cfg.MAX_EFFORT_HOURS) * 10.0;
  return round(Math.min(raw, 10.0));
}

function calcDependency(dependencyCount) {
  if (dependencyCount <= 0) return 0.0;

  const raw = (1 - Math.exp(-0.5 * dependencyCount)) * 10.0;
  return round(Math.min(raw, 10.0));
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
    raw_score: 0,
    priority_score: 0,
    status: "done",
    task
  };
}

function calcPriority(task, cfg = Config) {
  if (task.status === "done") return zeroScore(task);

  const gradeWeight = getGradeWeight(task);
  const days = daysUntilDue(task.due_date ?? task.dueDate ?? task.due);
  const estimatedHours = getEstimatedHours(task);
  const dependencyCount = getDependencyCount(task);
  const taskType = getTaskType(task);

  const urgency = calcUrgency(days, gradeWeight, taskType, cfg);
  const importance = calcImportance(gradeWeight);
  const effort = calcEffort(estimatedHours, cfg);
  const dependency = calcDependency(dependencyCount);
  const studyMultiplier = isStudyTask(task, taskType) ? cfg.STUDY_TASK_MULTIPLIER : 1.0;
  const rawScore = (
    urgency * cfg.W_URGENCY +
    importance * cfg.W_IMPORTANCE +
    effort * cfg.W_EFFORT +
    dependency * cfg.W_DEPENDENCY
  ) * studyMultiplier;

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

  return scores.sort((a, b) => b.raw_score - a.raw_score);
}

function orderTasks(tasks, cfg = Config) {
  return rankTasks(tasks, cfg);
}

const TaskOptimizer = {
  Config,
  calcUrgency,
  calcImportance,
  calcEffort,
  calcDependency,
  calcPriority,
  rankTasks,
  orderTasks
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = TaskOptimizer;
}

if (typeof window !== "undefined") {
  window.TaskOptimizer = TaskOptimizer;
}
