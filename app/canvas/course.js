// Native Canvas course renderer.
// Functionality: renders course homepage/assignments/modules/files into the
// renderer DOM and normalizes Canvas API URLs into browser-safe links.
// Dependencies: app/canvas/dashboard.js calls the exported template helpers;
// renderer/render.js attaches navigation handlers to generated course links.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeurl(url) {
  if (!url) {
    return '#'
  }
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href
    }
  }
  catch {
    return '#'
  }
  return '#'
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

function getCourseMapBucket(canvasData, bucketName, courseId) {
  const bucket = canvasData && canvasData[bucketName];
  if (!bucket) return {};

  const value = bucket[courseId] || bucket[String(courseId)];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getCanvasModuleUrl(module) {
  if (module.html_url) return module.html_url;

  try {
    const url = new URL(module.items_url);
    const match = url.pathname.match(/\/api\/v1\/courses\/([^/]+)\/modules\/([^/]+)\/items/);
    if (match) {
      return `${url.origin}/courses/${match[1]}/modules#module_${match[2]}`;
    }
  } catch (_error) {
    return "#";
  }

  return "#";
}

function getModuleItemUrl(item) {
  if (item.html_url) return item.html_url;

  try {
    const url = new URL(item.url);
    const match = url.pathname.match(/\/api\/v1\/courses\/([^/]+)\/files\/([^/]+)/);
    if (match) {
      return `${url.origin}/courses/${match[1]}/files/${match[2]}`;
    }
  } catch (_error) {
    return "#";
  }

  return "#";
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

function renderModuleItems(items) {
  if (!items.length) return "";

  return `
    <div class="course-module-items">
      ${items.map(item => `
        <a class="course-module-item" href="${escapeHtml(getModuleItemUrl(item))}">
          <span>${escapeHtml(item.title || "Untitled item")}</span>
          <small>${escapeHtml(item.type || "Item")}</small>
        </a>
      `).join("")}
    </div>
  `;
}

function renderModules(modules, moduleItems = {}) {
  if (!modules.length) return renderEmptyState("modules");

  return modules.map(module => {
    const items = moduleItems[module.id] || moduleItems[String(module.id)] || [];
    return `
      <article class="course-item course-module">
        <div class="course-item-main">
          <a class="course-item-title" href="${escapeHtml(getCanvasModuleUrl(module))}">${escapeHtml(module.name || "Untitled module")}</a>
          <p>${escapeHtml(module.state || "available")}</p>
          ${renderModuleItems(Array.isArray(items) ? items : [])}
        </div>
        <div class="course-item-meta">
          <span>${escapeHtml(module.items_count ?? 0)} items</span>
          <span>${module.published === false ? "Unpublished" : "Published"}</span>
        </div>
      </article>
    `;
  }).join("");
}

function getWeeklySchedule(canvasData, courseId) {
  const schedule = canvasData && canvasData.weekly_schedule;
  if (!schedule) return [];

  const weeks = schedule[courseId] || schedule[String(courseId)];
  return Array.isArray(weeks) ? weeks : [];
}

function renderWeeklyFiles(files) {
  if (!files.length) return "";

  return `
    <div class="course-week-group">
      <h3 class="course-week-subheading">Files</h3>
      <div class="course-module-items">
        ${files.map(file => `
          <a class="course-module-item" href="${escapeHtml(sanitizeurl(file.url || file.canvaspreviewurl) || "#")}">
            <span>${escapeHtml(file.name || "Untitled file")}</span>
            <small>File</small>
          </a>
        `).join("")}
      </div>
    </div>
  `;
}

function renderWeeklyLoggedAssignments(assignments) {
  if (!assignments.length) return "";

  return `
    <div class="course-week-group">
      <h3 class="course-week-subheading">Assignments</h3>
      <div class="course-module-items">
        ${assignments.map(assignment => {
          const description = assignment.description ? assignment.description.slice(0, 140) : "";
          return `
            <a class="course-module-item course-week-assignment-item" href="${escapeHtml(sanitizeurl(assignment.url) || "#")}">
              <span>
                ${escapeHtml(assignment.name || "Untitled assignment")}
                ${description ? `<small class="course-week-assignment-copy">${escapeHtml(description)}</small>` : ""}
              </span>
              <small>${escapeHtml(formatDate(assignment.duedate))}</small>
            </a>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderWeeklySchedule(weeks) {
  if (!weeks.length) {
    return renderEmptyState("weekly schedule — sync Canvas and run the parser to log assignments");
  }

  return weeks.map(week => `
    <article class="course-item course-module course-week">
      <div class="course-item-main">
        <span class="course-item-title">${escapeHtml(week.weekLabel || "Week")}</span>
        ${renderWeeklyFiles(Array.isArray(week.files) ? week.files : [])}
        ${renderWeeklyLoggedAssignments(Array.isArray(week.assignments) ? week.assignments : [])}
      </div>
      <div class="course-item-meta">
        <span>${Array.isArray(week.files) ? week.files.length : 0} files</span>
        <span>${Array.isArray(week.assignments) ? week.assignments.length : 0} assignments</span>
      </div>
    </article>
  `).join("");
}

function renderFiles(files) {
  if (!files.length) return renderEmptyState("files");

  return files.map(file => `
    <article class="course-item course-file">
      <div class="course-item-main">
        <a class="course-item-title" href="${escapeHtml(sanitizeurl(file.previewurl) || sanitizeurl(file.html_url) || sanitizeurl(file.url) || "#")}">${escapeHtml(file.display_name || file.filename || "Untitled file")}</a>
        <p>${escapeHtml(file["content-type"] || file.mime_class || "file")}</p>
      </div>
      <div class="course-item-meta">
        <span>${escapeHtml(formatFileSize(file.size))}</span>
        <span>${file.locked_for_user ? "Locked" : "Available"}</span>
      </div>
    </article>
  `).join("");
}

function getCourseFrontPage(canvasData, courseId) {
  const frontPages = canvasData && canvasData.front_pages
  if (!frontPages) return null
  return frontPages[courseId] || frontPages[String(courseId)] || null
}

function renderCourseSection(section, assignments, modules, moduleItems, files, frontPage, weeklySchedule) {
  if (section === "homepage") {
    return `
      <section class="course-section course-homepage-section" data-course-section-page="homepage">
        <div class="course-homepage-content">
          ${frontPage && frontPage.body ? frontPage.body : renderEmptyState("homepage")}
        </div>
      </section>
    `
  }

  if (section === "modules") {
    return `
      <section class="course-section" data-course-section-page="modules">
        <h2>Modules</h2>
        <div class="course-list">${renderModules(modules, moduleItems)}</div>
      </section>
    `
  }

  if (section === "files") {
    return `
      <section class="course-section" data-course-section-page="files">
        <h2>Files</h2>
        <div class="course-list">${renderFiles(files)}</div>
      </section>
    `
  }

  if (section === "weekly") {
    return `
      <section class="course-section" data-course-section-page="weekly">
        <h2>Weekly</h2>
        <div class="course-list">${renderWeeklySchedule(weeklySchedule)}</div>
      </section>
    `
  }

  return `
    <section class="course-section" data-course-section-page="assignments">
      <h2>Assignments</h2>
      <div class="course-list">${renderAssignments(assignments)}</div>
    </section>
  `
}

function createCourseHtmlTemplate(course, canvasData = {}, activeSection = "assignments") {
  const courseId = course && course.id;
  const assignments = getCourseBucket(canvasData, "assignments", courseId);
  const modules = getCourseBucket(canvasData, "modules", courseId);
  const moduleItems = getCourseMapBucket(canvasData, "module_items", courseId);
  const files = getCourseBucket(canvasData, "file", courseId);
  const frontPage = getCourseFrontPage(canvasData, courseId);
  const weeklySchedule = getWeeklySchedule(canvasData, courseId);
  const hasHomepage = Boolean(frontPage && frontPage.body);
  const validSections = hasHomepage
    ? ["homepage", "assignments", "weekly", "modules", "files"]
    : ["assignments", "weekly", "modules", "files"];
  const section = validSections.includes(activeSection)
    ? activeSection
    : hasHomepage
      ? "homepage"
      : "assignments";

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
          <span><strong>${weeklySchedule.length}</strong> weeks</span>
          <span><strong>${modules.length}</strong> modules</span>
          <span><strong>${files.length}</strong> files</span>
        </div>
      </header>

      <nav class="course-tabs" aria-label="Course content">
        ${hasHomepage ? `<button type="button" class="${section === "homepage" ? "active" : ""}" data-course-section="homepage">Homepage</button>` : ""}
        <button type="button" class="${section === "assignments" ? "active" : ""}" data-course-section="assignments">Assignments</button>
        <button type="button" class="${section === "weekly" ? "active" : ""}" data-course-section="weekly">Weekly</button>
        <button type="button" class="${section === "modules" ? "active" : ""}" data-course-section="modules">Modules</button>
        <button type="button" class="${section === "files" ? "active" : ""}" data-course-section="files">Files</button>
      </nav>

      ${renderCourseSection(section, assignments, modules, moduleItems, files, frontPage, weeklySchedule)}
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
