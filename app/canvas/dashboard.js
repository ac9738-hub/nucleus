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
      <div class="project-grid">
        ${courses.map(course => `
          <article class="project-card canvas-course-card" data-canvas-course-id="${escapeHtml(course.id)}" tabindex="0" role="button">
            <span class="project-chip">${escapeHtml(course.course_code || "Canvas")}</span>
            <h3>${escapeHtml(course.name || "Untitled course")}</h3>
            <p>${escapeHtml(course.workflow_state || "available")} / ${escapeHtml(course.default_view || "course")}</p>
            <span class="project-source">Canvas</span>
          </article>
        `).join("")}
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

if (typeof window !== "undefined") {
  window.nucleusCanvasApp = {
    renderCanvasApp,
    renderCanvasAppDashboard,
    renderCanvasCourseDashboard
  }
}
