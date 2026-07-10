// Native Canvas course renderer.
// Functionality: renders course homepage/assignments/modules/files into the
// renderer DOM and normalizes Canvas API URLs into browser-safe links.
// Dependencies: app/canvas/dashboard.js calls the exported template helpers;
// renderer/render.js attaches navigation handlers to generated course links.
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

const SAFE_HOMEPAGE_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'dd', 'div', 'dl', 'dt',
  'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p',
  'pre', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'u', 'ul'
])

const DANGEROUS_HOMEPAGE_BLOCKS = /<\s*(script|style|iframe|object|embed|applet|svg|math|form|textarea|select|button|canvas|video|audio|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi
const DANGEROUS_HOMEPAGE_VOID_TAGS = /<\s*(?:base|link|meta|input|source|track|param)\b[^>]*\/?>/gi
const HOMEPAGE_TAG_PATTERN = /<[^>]*>/g
const HOMEPAGE_ATTR_PATTERN = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const SAFE_GLOBAL_HOMEPAGE_ATTRS = new Set([
  'align', 'aria-label', 'aria-describedby', 'aria-hidden', 'class', 'colspan',
  'height', 'id', 'role', 'rowspan', 'scope', 'title', 'width'
])

function sanitizeHomepageAttribute(tagName, name, rawValue) {
  const attrName = String(name || '').toLowerCase()
  if (!attrName || attrName.startsWith('on') || attrName === 'style' || attrName === 'srcdoc') {
    return ''
  }

  const value = rawValue == null ? '' : String(rawValue)
  if (tagName === 'a' && attrName === 'href') {
    const safeHref = sanitizeurl(value)
    return ` href="${escapeHtml(safeHref === '#' ? '#' : safeHref)}"`
  }

  if (tagName === 'img' && attrName === 'src') {
    const safeSrc = sanitizeurl(value)
    return safeSrc === '#' ? '' : ` src="${escapeHtml(safeSrc)}"`
  }

  if (tagName === 'img' && (attrName === 'alt' || attrName === 'title')) {
    return ` ${attrName}="${escapeHtml(value)}"`
  }

  if (SAFE_GLOBAL_HOMEPAGE_ATTRS.has(attrName)) {
    return ` ${attrName}="${escapeHtml(value)}"`
  }

  return ''
}

function sanitizeHomepageTag(tag) {
  const match = String(tag || '').match(/^<\s*(\/)?\s*([a-zA-Z][\w:-]*)([\s\S]*?)>$/)
  if (!match) return escapeHtml(tag)

  const closing = Boolean(match[1])
  const tagName = match[2].toLowerCase()
  if (!SAFE_HOMEPAGE_TAGS.has(tagName)) return ''
  if (closing) return `</${tagName}>`

  const rawAttrs = match[3] || ''
  const attrs = []
  rawAttrs.replace(HOMEPAGE_ATTR_PATTERN, (_attr, name, doubleQuoted, singleQuoted, bareValue) => {
    const rawValue = doubleQuoted ?? singleQuoted ?? bareValue ?? ''
    const sanitized = sanitizeHomepageAttribute(tagName, name, rawValue)
    if (sanitized) attrs.push(sanitized)
    return ''
  })

  return `<${tagName}${attrs.join('')}>`
}

function sanitizeCanvasHomepageHtml(html) {
  const source = String(html || '')
    .replace(DANGEROUS_HOMEPAGE_BLOCKS, '')
    .replace(DANGEROUS_HOMEPAGE_VOID_TAGS, '')

  let output = ''
  let cursor = 0
  source.replace(HOMEPAGE_TAG_PATTERN, (tag, offset) => {
    output += escapeHtml(source.slice(cursor, offset))
    output += sanitizeHomepageTag(tag)
    cursor = offset + tag.length
    return ''
  })
  output += escapeHtml(source.slice(cursor))
  return output.trim()
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

function renderWeeklyConcepts(concepts) {
  if (!concepts.length) return "";

  return `
    <div class="course-week-group">
      <h3 class="course-week-subheading">Concepts</h3>
      <div class="course-module-items">
        ${concepts.map(concept => `
          <div class="course-module-item course-week-concept-item">
            <span>${escapeHtml(concept.name || "Untitled concept")}</span>
            <small>Concept</small>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderWeeklyEvents(events) {
  if (!events.length) return "";

  return `
    <div class="course-week-group">
      <h3 class="course-week-subheading">Events</h3>
      <div class="course-week-events">
        ${events.map(entry => {
          const event = entry.event || {};
          const files = Array.isArray(entry.files) ? entry.files : [];
          const assignments = Array.isArray(entry.assignments) ? entry.assignments : [];
          const concepts = Array.isArray(entry.concepts) ? entry.concepts : [];
          const eventTypeLabel = entry.eventType ? String(entry.eventType).replace(/_/g, " ") : "Event";
          const dateRange = event.startdate || event.enddate
            ? [event.startdate, event.enddate].filter(Boolean).map(value => formatDate(value)).join(" – ")
            : "";
          return `
            <article class="course-week-event-card">
              <div class="course-week-event-head">
                <span class="course-week-event-title">${escapeHtml(event.name || "Untitled event")}</span>
                <span class="course-week-event-badge">${escapeHtml(eventTypeLabel)}</span>
              </div>
              ${dateRange ? `<span class="course-week-range">${escapeHtml(dateRange)}</span>` : ""}
              ${event.description ? `<p class="course-week-event-copy">${escapeHtml(event.description.slice(0, 220))}</p>` : ""}
              ${concepts.length || files.length || assignments.length ? `
                ${renderWeeklyConcepts(concepts)}
                ${renderWeeklyFiles(files)}
                ${renderWeeklyLoggedAssignments(assignments)}
              ` : `<span class="course-week-empty-note">No linked materials for this event</span>`}
            </article>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderWeeklyModuleGroups(moduleGroups) {
  if (!moduleGroups.length) return "";

  return `
    <div class="course-week-group">
      <h3 class="course-week-subheading">Modules</h3>
      <div class="course-week-module-groups">
        ${moduleGroups.map(group => `
          <article class="course-week-module-group">
            <h4 class="course-week-module-group-title">${escapeHtml(group.moduleName || "Module")}</h4>
            ${renderWeeklyFiles(Array.isArray(group.files) ? group.files : [])}
            ${renderWeeklyLoggedAssignments(Array.isArray(group.assignments) ? group.assignments : [])}
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

function renderWeeklySchedule(weeks) {
  if (!weeks.length) {
    return renderEmptyState("weekly schedule — sync Canvas and run the parser to log assignments");
  }

  return weeks.map(week => {
    const files = Array.isArray(week.files) ? week.files : [];
    const assignments = Array.isArray(week.assignments) ? week.assignments : [];
    const events = Array.isArray(week.events) ? week.events : [];
    const moduleGroups = Array.isArray(week.moduleGroups) ? week.moduleGroups : [];
    const isEmpty = !files.length && !assignments.length && !events.length && !moduleGroups.length;
    const classes = ["course-item", "course-module", "course-week"];
    if (week.isCurrentWeek) classes.push("course-week--current");
    if (isEmpty) classes.push("course-week--empty");

    return `
    <article class="${classes.join(" ")}">
      <div class="course-item-main">
        <span class="course-item-title">
          ${escapeHtml(week.weekLabel || "Week")}
          ${week.isCurrentWeek ? `<span class="course-week-current-badge">Current</span>` : ""}
        </span>
        ${week.dateRange ? `<span class="course-week-range">${escapeHtml(week.dateRange)}</span>` : ""}
        ${renderWeeklyEvents(events)}
        ${renderWeeklyModuleGroups(moduleGroups)}
        ${renderWeeklyFiles(files)}
        ${renderWeeklyLoggedAssignments(assignments)}
        ${isEmpty ? `<span class="course-week-empty-note">No files or assignments this week</span>` : ""}
      </div>
      <div class="course-item-meta">
        <span>${events.length} events</span>
        <span>${files.length} files</span>
        <span>${assignments.length} assignments</span>
      </div>
    </article>
  `;
  }).join("");
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

function normalizeHomepageBody(html) {
  const text = String(html || "").trim()
  if (!text) return ""

  const bodyMatch = text.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)
  if (bodyMatch) return bodyMatch[1].trim()

  if (/<html[\s>]/i.test(text)) {
    return text
      .replace(/<!doctype[^>]*>/gi, "")
      .replace(/<\/?html[^>]*>/gi, "")
      .replace(/<head[\s\S]*?<\/head>/gi, "")
      .replace(/<\/?body[^>]*>/gi, "")
      .trim()
  }

  return text
}

function getCourseFrontPage(canvasData, courseId) {
  const frontPages = canvasData && canvasData.front_pages
  if (!frontPages) return null
  const frontPage = frontPages[courseId] || frontPages[String(courseId)] || null
  if (!frontPage) return null

  const body = sanitizeCanvasHomepageHtml(normalizeHomepageBody(frontPage.body))
  if (body === String(frontPage.body || "").trim()) return frontPage
  return { ...frontPage, body }
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

function renderCourseSectionHtml(courseId, canvasData = {}, activeSection = "assignments") {
  const courses = canvasData && Array.isArray(canvasData.courses) ? canvasData.courses : [];
  const course = courses.find(item => String(item.id) === String(courseId));
  if (!course) return "";
  const assignments = getCourseBucket(canvasData, "assignments", course.id);
  const modules = getCourseBucket(canvasData, "modules", course.id);
  const moduleItems = getCourseMapBucket(canvasData, "module_items", course.id);
  const files = getCourseBucket(canvasData, "file", course.id);
  const frontPage = getCourseFrontPage(canvasData, course.id);
  const weeklySchedule = getWeeklySchedule(canvasData, course.id);
  const hasHomepage = Boolean(frontPage && frontPage.body);
  const validSections = hasHomepage
    ? ["homepage", "assignments", "weekly", "modules", "files"]
    : ["assignments", "weekly", "modules", "files"];
  const section = validSections.includes(activeSection)
    ? activeSection
    : hasHomepage
      ? "homepage"
      : "assignments";
  return renderCourseSection(section, assignments, modules, moduleItems, files, frontPage, weeklySchedule);
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
    createAllCourseHtmlTemplates,
    renderCourseSectionHtml,
    sanitizeCanvasHomepageHtml
  };
}

if (typeof window !== "undefined") {
  window.nucleusCourseTemplates = {
    createCourseHtmlTemplate,
    createAllCourseHtmlTemplates,
    renderCourseSectionHtml
  };
}
