const GRADESCOPE_ORIGIN = 'https://www.gradescope.com'

function buildGradescopeHeaders(auth) {
  const headers = {
    Accept: 'text/html,application/json',
    'User-Agent': 'nucleus-gradescope-client'
  }
  if (auth && auth.cookie) {
    headers.Cookie = auth.cookie
  }
  if (auth && auth.csrf) {
    headers['X-CSRF-Token'] = auth.csrf
  }
  return headers
}

async function fetchGradescopeHtml(path, auth) {
  const response = await fetch(`${auth.origin || GRADESCOPE_ORIGIN}${path}`, {
    method: 'GET',
    headers: buildGradescopeHeaders(auth)
  })
  if (!response.ok) {
    throw new Error(`Gradescope request failed ${response.status} for ${path}`)
  }
  return response.text()
}

function parseCourseLinks(html) {
  const links = []
  const pattern = /href="(\/courses\/\d+)"/g
  let match = pattern.exec(html)
  while (match) {
    links.push(`${GRADESCOPE_ORIGIN}${match[1]}`)
    match = pattern.exec(html)
  }
  return Array.from(new Set(links))
}

function parseAssignmentsFromCourseHtml(html, courseUrl) {
  const assignments = []
  const rowPattern = /<tr[^>]*data-assignment-id="(\d+)"[^>]*>[\s\S]*?<\/tr>/g
  let match = rowPattern.exec(html)
  while (match) {
    const row = match[0]
    const id = match[1]
    const titleMatch = row.match(/class="assignment-name"[^>]*>([\s\S]*?)<\/a>/i)
    const dueMatch = row.match(/class="submission-time"[^>]*>([\s\S]*?)<\/span>/i)
    const statusMatch = row.match(/class="submission-status"[^>]*>([\s\S]*?)<\/span>/i)
    assignments.push({
      id,
      title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : `Assignment ${id}`,
      dueText: dueMatch ? dueMatch[1].replace(/<[^>]+>/g, '').trim() : '',
      status: statusMatch ? statusMatch[1].replace(/<[^>]+>/g, '').trim().toLowerCase() : 'unknown',
      courseUrl,
      url: `${courseUrl}/assignments/${id}`
    })
    match = rowPattern.exec(html)
  }
  return assignments
}

async function syncGradescopeCourses(auth) {
  const accountHtml = await fetchGradescopeHtml('/account', auth)
  const courseLinks = parseCourseLinks(accountHtml)
  const courses = []

  for (const courseUrl of courseLinks) {
    const courseHtml = await fetchGradescopeHtml(courseUrl.replace(auth.origin || GRADESCOPE_ORIGIN, ''), auth)
    const titleMatch = courseHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    const assignments = parseAssignmentsFromCourseHtml(courseHtml, courseUrl)
    courses.push({
      url: courseUrl,
      title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : courseUrl,
      assignments
    })
  }

  return {
    synced_at: new Date().toISOString(),
    courses
  }
}

module.exports = {
  syncGradescopeCourses,
  parseAssignmentsFromCourseHtml
}
