// Native Canvas dashboard renderer.
// Functionality: renders Canvas course cards and delegates course detail pages
// to app/canvas/course.js templates.
// Dependencies: loaded after course.js by index.html; renderer/render.js invokes
// window.nucleusCanvasApp.renderCanvasApp for native Canvas tabs.

const CANVAS_COURSE_CARD_COLORS = [
  "#0374B5", "#8B1C62", "#E67E22", "#27AE60", "#8E44AD", "#C0392B", "#16A085", "#2980B9"
]

function canvasCourseCardColor(course, index = 0) {
  const courseId = Number(course && course.id)
  const seed = Number.isFinite(courseId) ? courseId : index
  return CANVAS_COURSE_CARD_COLORS[Math.abs(seed) % CANVAS_COURSE_CARD_COLORS.length]
}

function canvasCourseCardInitials(course) {
  const label = String(course && (course.course_code || course.name) || "Course").trim()
  const parts = label.split(/[\s/\-_]+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase()
  }
  return label.slice(0, 2).toUpperCase()
}

function canvasCourseImageUrl(course) {
  return String(course && (course.image_download_url || course.image_url) || "").trim()
}

function renderCanvasCourseCard(course, index) {
  const imageUrl = canvasCourseImageUrl(course)
  const color = canvasCourseCardColor(course, index)
  const initials = canvasCourseCardInitials(course)
  const termLabel = course && course.term && course.term.name
    ? course.term.name
    : (course.workflow_state || "available")

  return `
    <article
      class="nui-card nui-card-interactive project-card canvas-course-card"
      data-canvas-course-id="${escapeHtml(course.id)}"
      tabindex="0"
      role="button"
      aria-label="Open ${escapeHtml(course.name || "course")}"
    >
      <div class="canvas-course-card-media" style="--canvas-course-color: ${escapeHtml(color)}">
        ${imageUrl
          ? `<img
              class="canvas-course-card-image is-hidden"
              data-canvas-course-image="${escapeHtml(course.id)}"
              data-src="${escapeHtml(imageUrl)}"
              alt=""
            >`
          : ""}
        <div class="canvas-course-card-fallback" aria-hidden="true">${escapeHtml(initials)}</div>
      </div>
      <div class="canvas-course-card-body">
        <h3>${escapeHtml(course.name || "Untitled course")}</h3>
        <p>${escapeHtml(course.course_code || termLabel)}</p>
      </div>
    </article>
  `
}

function renderCanvasAppDashboard(canvasData = {}) {
  const courses = Array.isArray(canvasData.courses)
    ? canvasData.courses.filter(course => course && course.id && course.workflow_state !== "deleted")
    : []

  if (!courses.length) {
    return `
      <header>
        <h1>Canvas</h1>
        <p>Connect Canvas to load courses, files, modules, and assignments.</p>
      </header>
      <section class="workspace-panel">
        <div>
          <h2>Canvas</h2>
          <p>Authentication will start when this app opens.</p>
        </div>
      </section>
    `
  }

  return `
    <header>
      <h1>Canvas</h1>
      <p>${courses.length} courses loaded.</p>
    </header>
    <section class="project-section">
      <div class="section-heading">
        <h2>Courses</h2>
        <span>${courses.length}</span>
      </div>
      <div class="project-grid canvas-course-grid">
        ${courses.map((course, index) => renderCanvasCourseCard(course, index)).join("")}
      </div>
    </section>
  `
}

function renderCanvasCourseDashboard(courseId, canvasData = {}, activeSection = "assignments") {
  const course = canvasData && Array.isArray(canvasData.courses)
    ? canvasData.courses.find(item => String(item.id) === String(courseId))
    : null

  if (!course) {
    return `
      <button type="button" class="course-back-button" data-back-to-canvas-app>Back to Canvas</button>
      <section class="project-section">
        <div class="course-empty">This Canvas course was not found in the loaded data.</div>
      </section>
    `
  }

  if (!window.nucleusCourseTemplates) {
    return `
      <button type="button" class="course-back-button" data-back-to-canvas-app>Back to Canvas</button>
      <section class="project-section">
        <div class="course-empty">The course template script did not load.</div>
      </section>
    `
  }

  return `
    <button type="button" class="course-back-button" data-back-to-canvas-app>Back to Canvas</button>
    ${window.nucleusCourseTemplates.createCourseHtmlTemplate(course, canvasData, activeSection)}
  `
}

function renderCanvasApp(tab, canvasData = {}) {
  if (tab && tab.courseId) {
    return renderCanvasCourseDashboard(tab.courseId, canvasData, tab.courseSection || "assignments")
  }
  return renderCanvasAppDashboard(canvasData)
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    canvasCourseCardColor,
    canvasCourseCardInitials,
    canvasCourseImageUrl,
    renderCanvasCourseCard,
    renderCanvasApp,
    renderCanvasAppDashboard,
    renderCanvasCourseDashboard
  }
}

if (typeof window !== "undefined") {
  window.nucleusCanvasApp = {
    renderCanvasApp,
    renderCanvasAppDashboard,
    renderCanvasCourseDashboard
  }
}
