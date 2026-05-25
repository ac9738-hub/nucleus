function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDate(value) {
  if (!value) return "No due date";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return "Unknown size";

  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function getCourseBucket(canvasData, bucketName, courseId) {
  const bucket = canvasData && canvasData[bucketName];
  if (!bucket) return [];

  const value = bucket[courseId] || bucket[String(courseId)];
  return Array.isArray(value) ? value : [];
}

function renderEmptyState(label) {
  return `<div class="course-empty">No ${escapeHtml(label)} found.</div>`;
}

function renderAssignments(assignments) {
  if (!assignments.length) return renderEmptyState("assignments");

  return assignments.map(assignment => {
    const description = stripHtml(assignment.description).slice(0, 160);
    return `
      <article class="course-item course-assignment">
        <div class="course-item-main">
          <a class="course-item-title" href="${escapeHtml(assignment.html_url || "#")}">${escapeHtml(assignment.name || "Untitled assignment")}</a>
          <p>${escapeHtml(description || "No description provided.")}</p>
        </div>
        <div class="course-item-meta">
          <span>${escapeHtml(formatDate(assignment.due_at))}</span>
          <span>${escapeHtml(assignment.points_possible ?? "0")} pts</span>
        </div>
      </article>
    `;
  }).join("");
}

function renderModules(modules) {
  if (!modules.length) return renderEmptyState("modules");

  return modules.map(module => `
    <article class="course-item course-module">
      <div class="course-item-main">
        <a class="course-item-title" href="${escapeHtml(module.items_url || "#")}">${escapeHtml(module.name || "Untitled module")}</a>
        <p>${escapeHtml(module.state || "available")}</p>
      </div>
      <div class="course-item-meta">
        <span>${escapeHtml(module.items_count ?? 0)} items</span>
        <span>${module.published === false ? "Unpublished" : "Published"}</span>
      </div>
    </article>
  `).join("");
}

function renderFiles(files) {
  if (!files.length) return renderEmptyState("files");

  return files.map(file => `
    <article class="course-item course-file">
      <div class="course-item-main">
        <a class="course-item-title" href="${escapeHtml(file.url || "#")}">${escapeHtml(file.display_name || file.filename || "Untitled file")}</a>
        <p>${escapeHtml(file["content-type"] || file.mime_class || "file")}</p>
      </div>
      <div class="course-item-meta">
        <span>${escapeHtml(formatFileSize(file.size))}</span>
        <span>${file.locked_for_user ? "Locked" : "Available"}</span>
      </div>
    </article>
  `).join("");
}

function createCourseHtmlTemplate(course, canvasData = {}) {
  const courseId = course && course.id;
  const assignments = getCourseBucket(canvasData, "assignments", courseId);
  const modules = getCourseBucket(canvasData, "modules", courseId);
  const files = getCourseBucket(canvasData, "file", courseId);

  return `
    <section class="course-page" data-course-id="${escapeHtml(courseId)}">
      <header class="course-hero">
        <div>
          <span class="course-code">${escapeHtml(course.course_code || "Canvas")}</span>
          <h1>${escapeHtml(course.name || "Untitled course")}</h1>
          <p>${escapeHtml(course.workflow_state || "available")} / ${escapeHtml(course.default_view || "course")}</p>
        </div>
        <div class="course-summary">
          <span><strong>${assignments.length}</strong> assignments</span>
          <span><strong>${modules.length}</strong> modules</span>
          <span><strong>${files.length}</strong> files</span>
        </div>
      </header>

      <nav class="course-tabs">
        <a href="#assignments">Assignments</a>
        <a href="#modules">Modules</a>
        <a href="#files">Files</a>
      </nav>

      <section class="course-section" id="assignments">
        <h2>Assignments</h2>
        <div class="course-list">${renderAssignments(assignments)}</div>
      </section>

      <section class="course-section" id="modules">
        <h2>Modules</h2>
        <div class="course-list">${renderModules(modules)}</div>
      </section>

      <section class="course-section" id="files">
        <h2>Files</h2>
        <div class="course-list">${renderFiles(files)}</div>
      </section>
    </section>
  `;
}

function createAllCourseHtmlTemplates(canvasData = {}) {
  const courses = Array.isArray(canvasData.courses) ? canvasData.courses : [];
  return courses.map(course => ({
    courseId: course.id,
    html: createCourseHtmlTemplate(course, canvasData)
  }));
}

if (typeof module !== "undefined") {
  module.exports = {
    createCourseHtmlTemplate,
    createAllCourseHtmlTemplates
  };
}

if (typeof window !== "undefined") {
  window.nucleusCourseTemplates = {
    createCourseHtmlTemplate,
    createAllCourseHtmlTemplates
  };
}
