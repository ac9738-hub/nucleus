// Native Canvas DOM section → preload URL lists (pure functions).
// Dependencies: context-index pickWeeklyWeeks; canvas-preload-planner normalizeCanvasUrl

const { pickWeeklyWeeks } = require('../context-index')
const { normalizeCanvasUrl } = require('./canvas-preload-planner')
const { isCanvasPreloadableUrl } = require('./canvas-preload-dom')

function pushUrl(out, seen, url, options = {}) {
  const normalized = normalizeCanvasUrl(url)
  if (!normalized || seen.has(normalized)) return
  if (!isCanvasPreloadableUrl(normalized, { allowedHosts: options.allowedHosts })) return
  seen.add(normalized)
  out.push(normalized)
}

function courseBucket(canvasData, bucketName, courseId) {
  const bucket = canvasData && canvasData[bucketName]
  if (!bucket) return bucketName === 'module_items' ? {} : []
  const value = bucket[courseId] || bucket[String(courseId)]
  if (bucketName === 'module_items') return value && typeof value === 'object' ? value : {}
  return Array.isArray(value) ? value : []
}

function weekMaterialUrls(week, out, seen, limit, pushOptions = {}) {
  if (!week || out.length >= limit) return
  for (const assignment of week.assignments || []) {
    pushUrl(out, seen, assignment.url || assignment.html_url, pushOptions)
    if (out.length >= limit) return
  }
  for (const file of week.files || []) {
    pushUrl(out, seen, file.url || file.canvaspreviewurl || file.downloadurl, pushOptions)
    if (out.length >= limit) return
  }
  for (const entry of week.events || []) {
    const event = entry && (entry.event || entry)
    pushUrl(out, seen, event && (event.url || event.html_url), pushOptions)
    if (out.length >= limit) return
  }
  for (const group of week.moduleGroups || []) {
    for (const assignment of group.assignments || []) {
      pushUrl(out, seen, assignment.url || assignment.html_url, pushOptions)
      if (out.length >= limit) return
    }
    for (const file of group.files || []) {
      pushUrl(out, seen, file.url || file.canvaspreviewurl || file.downloadurl, pushOptions)
      if (out.length >= limit) return
    }
  }
}

function collectNativeSectionUrls(canvasData, options = {}) {
  const courseId = String(options.courseId || '')
  const section = String(options.courseSection || 'homepage')
  const limit = Math.max(1, Number(options.limit) || 3)
  const nowMs = options.nowMs == null ? Date.now() : options.nowMs
  const pushOptions = { allowedHosts: options.allowedHosts }
  const urls = []
  const seen = new Set()

  if (!courseId) return urls

  if (section === 'weekly') {
    const weeks = courseBucket(canvasData, 'weekly_schedule', courseId)
    if (Array.isArray(weeks)) {
      const { current, next } = pickWeeklyWeeks(weeks, nowMs)
      weekMaterialUrls(current, urls, seen, limit, pushOptions)
      if (urls.length < limit) weekMaterialUrls(next, urls, seen, limit, pushOptions)
    }
    return urls.slice(0, limit)
  }

  if (section === 'assignments') {
    const assignments = courseBucket(canvasData, 'assignments', courseId)
      .slice()
      .sort((left, right) => Date.parse(left.due_at || 0) - Date.parse(right.due_at || 0))
    for (const assignment of assignments) {
      pushUrl(urls, seen, assignment.html_url || assignment.url, pushOptions)
      if (urls.length >= limit) break
    }
    return urls
  }

  if (section === 'files') {
    for (const file of courseBucket(canvasData, 'file', courseId)) {
      pushUrl(urls, seen, file.url || file.previewurl || file.canvaspreviewurl, pushOptions)
      if (urls.length >= limit) break
    }
    return urls
  }

  if (section === 'modules') {
    const moduleItems = courseBucket(canvasData, 'module_items', courseId)
    for (const items of Object.values(moduleItems)) {
      for (const item of items || []) {
        pushUrl(urls, seen, item.html_url || item.url, pushOptions)
        if (urls.length >= limit) break
      }
      if (urls.length >= limit) break
    }
    return urls
  }

  if (section === 'homepage' || section === 'home') {
    const assignments = courseBucket(canvasData, 'assignments', courseId)
    const horizon = nowMs + 14 * 24 * 60 * 60 * 1000
    const dueSoon = assignments
      .filter(row => {
        const dueMs = Date.parse(row.due_at || '')
        return !Number.isNaN(dueMs) && dueMs >= nowMs - 86400000 && dueMs <= horizon
      })
      .sort((left, right) => Date.parse(left.due_at) - Date.parse(right.due_at))
    for (const assignment of dueSoon) {
      pushUrl(urls, seen, assignment.html_url || assignment.url, pushOptions)
      if (urls.length >= limit) break
    }
  }

  return urls.slice(0, limit)
}

module.exports = {
  collectNativeSectionUrls,
  pushUrl
}
