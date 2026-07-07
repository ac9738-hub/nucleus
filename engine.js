// Local search result renderer.
// Functionality: calls Brave Search, mixes web/image/news/video results with
// Canvas vector retrieval results, and renders the file-backed engine page HTML.
// Dependencies: main.js calls searchweb/renderwebsearchresult; webassets/ holds
// result logos; app/canvas/assets provides Canvas branding.
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { escapeHtml } = require('./lib/dom-utils')
const assetCache = new Map()

function parseEnvValue(value) {
  const text = String(value || '').trim()
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return text
}

function loadEnv(envPath = path.join(__dirname, '.env')) {
  if (!fs.existsSync(envPath)) return {}

  const values = {}
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  lines.forEach(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return

    const index = trimmed.indexOf('=')
    if (index === -1) return

    const key = trimmed.slice(0, index).trim()
    const value = parseEnvValue(trimmed.slice(index + 1))
    values[key] = value

    if (!(key in process.env)) {
      process.env[key] = value
    }
  })

  return values
}

loadEnv()
const BRAVE_API_KEY = process.env.BRAVE_API_KEY || ''

function assetUrl(filename) {
  if (assetCache.has(filename)) return assetCache.get(filename)

  const filepath = path.join(__dirname, 'webassets', filename)
  if (!fs.existsSync(filepath)) return ''

  const url = pathToFileURL(filepath).href
  assetCache.set(filename, url)
  return url
}

function localAssetUrl(...parts) {
  const key = parts.join('/')
  if (assetCache.has(key)) return assetCache.get(key)

  const filepath = path.join(__dirname, ...parts)
  if (!fs.existsSync(filepath)) return ''

  const url = pathToFileURL(filepath).href
  assetCache.set(key, url)
  return url
}

function getBraveApiKey() {
  if (!BRAVE_API_KEY) {
    throw new Error('BRAVE_API_KEY is missing from .env')
  }
  return BRAVE_API_KEY
}

async function braveGet(endpoint, params = {}) {
  const url = new URL(`https://api.search.brave.com/res/v1/${endpoint}`)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value))
    }
  })

  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": getBraveApiKey()
    }
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Brave ${endpoint} failed ${response.status} ${response.statusText}: ${body.slice(0, 500)}`)
  }

  return response.json()
}

async function searchweb(query) {
  const q = String(query || "").trim()
  if (!q) {
    return { query: { original: "" }, web: { results: [] } }
  }

  const common = {
    q,
    country: "US",
    search_lang: "en",
    ui_lang: "en-US",
    safesearch: "moderate",
    spellcheck: "true"
  }

  const [webResult, imageResult, newsResult, videoResult] = await Promise.allSettled([
    braveGet("web/search", {
      ...common,
      count: 20,
      extra_snippets: "true",
      enable_rich_callback: 1
    }),
    braveGet("images/search", {
      ...common,
      count: 12,
      safesearch: "strict"
    }),
    braveGet("news/search", {
      ...common,
      count: 5,
      extra_snippets: "true"
    }),
    braveGet("videos/search", {
      ...common,
      count: 5
    })
  ])

  const web = webResult.status === "fulfilled" ? webResult.value : { web: { results: [] } }
  let rich = null
  const callbackKey = web && web.rich && web.rich.hint && web.rich.hint.callback_key
  if (callbackKey) {
    try {
      rich = await braveGet("web/rich", { callback_key: callbackKey })
    } catch (error) {
      rich = { error: error.message }
    }
  }

  return {
    ...web,
    images: imageResult.status === "fulfilled" ? imageResult.value : { error: imageResult.reason && imageResult.reason.message },
    news: newsResult.status === "fulfilled" ? newsResult.value : { error: newsResult.reason && newsResult.reason.message },
    richData: rich,
    videos: videoResult.status === "fulfilled" ? videoResult.value : { error: videoResult.reason && videoResult.reason.message },
    verticalErrors: [
      webResult.status === "rejected" ? webResult.reason.message : "",
      imageResult.status === "rejected" ? imageResult.reason.message : "",
      newsResult.status === "rejected" ? newsResult.reason.message : "",
      videoResult.status === "rejected" ? videoResult.reason.message : ""
    ].filter(Boolean)
  }
}

function getSearchResults(result) {
  return result && result.web && Array.isArray(result.web.results)
    ? result.web.results
    : []
}

function pickResults(value, keys = ["results"]) {
  if (!value) return []
  if (Array.isArray(value)) return value
  for (const key of keys) {
    if (value[key] && Array.isArray(value[key])) return value[key]
    if (value[key] && value[key].results && Array.isArray(value[key].results)) return value[key].results
  }
  if (value.results && Array.isArray(value.results)) return value.results
  return []
}

function hostFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "")
  } catch (_error) {
    return ""
  }
}

function thumbnailUrl(item) {
  if (!item) return ""
  if (typeof item.thumbnail === "string") return item.thumbnail
  if (item.thumbnail) {
    return item.thumbnail.src || item.thumbnail.url || item.thumbnail.original || ""
  }
  if (item.properties) {
    return item.properties.placeholder || item.properties.url || ""
  }
  return item.image || item.img || ""
}

function resultUrl(item) {
  return item && (item.url || item.page_url || item.source || (item.profile && item.profile.url) || "#")
}

function getInternalResults(result) {
  return Array.isArray(result && result.internalResults)
    ? result.internalResults
    : []
}

function internalResultUrl(item) {
  return item && (item.url || item.canvaspreviewurl || item.downloadurl || "#")
}

function internalCanvasRoute(item) {
  const url = internalResultUrl(item)
  if (!url || url === "#" || !/^https?:/i.test(String(url))) return "#"
  const route = new URL("nucleus://canvas")
  route.searchParams.set("url", url)
  if (item && item.courseid) route.searchParams.set("courseId", item.courseid)
  if (item && item.type) route.searchParams.set("type", item.type)
  if (item && item.id) route.searchParams.set("id", item.id)
  return route.href
}

function formatInternalType(value) {
  const text = String(value || "canvas").replace(/[_-]+/g, " ").trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Canvas"
}

function formatInternalMeta(item) {
  const parts = [formatInternalType(item && item.type)]
  if (item && (item.coursename || item.courseName)) {
    parts.push(item.coursename || item.courseName)
  } else if (item && item.courseid) {
    parts.push(`Course ${item.courseid}`)
  }
  if (item && item.duedate) parts.push(`Due ${item.duedate}`)
  return parts.filter(Boolean).join(" · ")
}

function cleanSnippet(value) {
  return escapeHtml(value || "")
    .replace(/&lt;strong&gt;/g, "<strong>")
    .replace(/&lt;\/strong&gt;/g, "</strong>")
}

function renderInternalSourceContext(item) {
  const source = item && item.source
  if (!source || typeof source !== "object" || item.type !== "file" || source.type !== "concept") return ""

  const name = String(source.name || source.id || "").replace(/\s+/g, " ").trim()
  const description = String(source.description || "").replace(/\s+/g, " ").trim()
  if (!name && !description) return ""

  return `
    <span class="internal-source-context">
      ${name ? `<span class="internal-source-title">${escapeHtml(name)}</span>` : ""}
      ${description ? `<span class="internal-source-description">${cleanSnippet(description.slice(0, 180))}</span>` : ""}
    </span>
  `
}

function scalarEntries(value, limit = 4) {
  if (!value || typeof value !== "object") return []
  return Object.entries(value)
    .filter(([_key, item]) => {
      return item !== null && item !== undefined && ["string", "number", "boolean"].includes(typeof item)
    })
    .slice(0, limit)
}

function findFeatureObject(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) {
      return value[0]
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value
    }
  }
  return null
}

function renderFeaturePanel(title, feature) {
  const target = findFeatureObject(feature && feature.result, feature && feature.data, feature)
  if (!target) return ""

  const internalLogo = assetUrl('internal_results_logo.png')
  const heading = target.title || target.name || title
  const description = target.description || target.subtitle || target.summary || target.answer || ""
  const image = thumbnailUrl(target)
  const url = resultUrl(target)
  const entries = scalarEntries(target)
    .filter(([key]) => !["title", "name", "description", "subtitle", "summary", "answer", "url"].includes(key))
    .map(([key, value]) => `
      <div class="fact-row">
        <span>${escapeHtml(key.replace(/_/g, " "))}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `).join("")

  if (!heading && !description && !entries && !image) return ""

  return `
    <section class="side-module">
      <div class="module-heading">
        ${internalLogo ? `<img src="${escapeHtml(internalLogo)}" alt="">` : ""}
        <h2>${escapeHtml(title)}</h2>
      </div>
      ${image ? `<img class="feature-image" src="${escapeHtml(image)}" alt="" loading="lazy">` : ""}
      ${heading ? `<div class="feature-name">${escapeHtml(heading)}</div>` : ""}
      ${description ? `<p class="feature-description">${cleanSnippet(description)}</p>` : ""}
      ${entries ? `<div class="fact-list">${entries}</div>` : ""}
      ${url && url !== "#" ? `<a class="feature-link" href="${escapeHtml(url)}">View source</a>` : ""}
    </section>
  `
}

function renderInternalResultsPanel(results) {
  if (!Array.isArray(results) || results.length === 0) return ""

  const canvasLogo = localAssetUrl('app', 'canvas', 'assets', 'canvas_icon.png')
  const internalLogo = assetUrl('internal_results_logo.png')
  const items = results.slice(0, 6).map(item => {
    const title = item.name || item.id || "Canvas result"
    const href = internalCanvasRoute(item)
    const meta = formatInternalMeta(item)
    const description = String(item.description || "").replace(/\s+/g, " ").trim()
    const sourceContext = renderInternalSourceContext(item)

    return `
      <a class="side-card internal-side-card" href="${escapeHtml(href)}"${href === "#" ? ' aria-disabled="true" tabindex="-1"' : ""}>
        <span class="canvas-thumb">
          ${canvasLogo ? `<img src="${escapeHtml(canvasLogo)}" alt="" loading="lazy">` : "C"}
        </span>
        <span class="side-card-copy">
          <span class="side-card-title">${escapeHtml(title)}</span>
          <span class="side-card-meta">${escapeHtml(meta || "Canvas")}</span>
          ${description ? `<span class="side-card-description">${cleanSnippet(description.slice(0, 150))}</span>` : ""}
          ${sourceContext}
        </span>
      </a>
    `
  }).join("")

  return `
    <section class="side-module" id="nucleus-internal-panel">
      <div class="module-heading">
        ${internalLogo ? `<img src="${escapeHtml(internalLogo)}" alt="">` : ""}
        <h2>Internal results</h2>
      </div>
      ${items}
    </section>
  `
}

function renderInternalEmptyPanel(message = "No Canvas matches found.") {
  const internalLogo = assetUrl('internal_results_logo.png')

  return `
    <section class="side-module" id="nucleus-internal-panel">
      <div class="module-heading">
        ${internalLogo ? `<img src="${escapeHtml(internalLogo)}" alt="">` : ""}
        <h2>Internal results</h2>
      </div>
      <p class="internal-empty-message">${escapeHtml(message)}</p>
    </section>
  `
}

function renderInternalPendingPanel() {
  const internalLogo = assetUrl('internal_results_logo.png')

  return `
    <section class="side-module internal-pending-panel" id="nucleus-internal-panel">
      <div class="module-heading">
        ${internalLogo ? `<img src="${escapeHtml(internalLogo)}" alt="">` : ""}
        <h2>Internal results</h2>
      </div>
      <div class="internal-loader-row" aria-live="polite">
        <span class="internal-loader" aria-hidden="true"></span>
        <span>
          <span class="internal-loader-title">Searching internal graph</span>
          <span class="internal-loader-meta">Matching Canvas nodes and concepts</span>
        </span>
      </div>
    </section>
  `
}

function buildAiOverview(results, query) {
  const points = results
    .flatMap(item => {
      const snippets = []
      if (item.description) snippets.push(item.description)
      if (Array.isArray(item.extra_snippets)) snippets.push(...item.extra_snippets)
      return snippets
    })
    .map(snippet => String(snippet || "").trim())
    .filter(Boolean)
    .slice(0, 3)

  if (points.length === 0) return ""
  const aiLogo = assetUrl('ai_overview.png')

  return `
    <section class="ai-overview">
      <div class="ai-overview-label">
        ${aiLogo ? `<img src="${escapeHtml(aiLogo)}" alt="">` : ""}
        <span>AI overview</span>
      </div>
      <p>${cleanSnippet(points[0])}</p>
      ${points.length > 1 ? `
        <ul>
          ${points.slice(1).map(point => `<li>${cleanSnippet(point)}</li>`).join("")}
        </ul>
      ` : ""}
      <div class="ai-overview-note">Generated from the top search result snippets for ${escapeHtml(query || "this search")}.</div>
    </section>
  `
}

function renderwebsearchresult(result, query = "", mode = "all") {
  const activeMode = ["all", "images", "news", "videos"].includes(mode) ? mode : "all"
  const results = getSearchResults(result)
  const internalResults = getInternalResults(result)
  const errorMessage = result && result.error ? String(result.error) : ""
  const verticalErrors = Array.isArray(result && result.verticalErrors) ? result.verticalErrors : []
  const internalError = result && result.internalError ? String(result.internalError) : ""
  const internalPending = Boolean(result && result.internalPending)
  const restoreScrollY = Number.isFinite(result && result.restoreScrollY) ? Math.max(0, Math.round(result.restoreScrollY)) : 0
  const images = pickResults(result && result.images, ["images", "results"]).slice(0, 8)
  const news = pickResults(result && result.news, ["news", "results"]).slice(0, 4)
  const videos = pickResults(result && result.videos, ["videos", "results"]).slice(0, 4)
  const alteredQuery = result && result.query && result.query.altered ? result.query.altered : ""
  const totalCount = results.length + internalResults.length + images.length + news.length + videos.length
  const webLogo = assetUrl('nucleus_engine_mark.svg')
  const featurePanel = internalResults.length
    ? renderInternalResultsPanel(internalResults)
    : internalPending
      ? renderInternalPendingPanel()
    : renderFeaturePanel(
        "Internal results",
        findFeatureObject(result && result.richData, result && result.infobox, result && result.knowledge_graph)
      )
  const aiOverview = buildAiOverview(results, query)

  const makeSearchUrl = type => `nucleus://search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}`
  const tabClass = type => type === activeMode ? "active" : ""
  const imageItems = images.slice(0, activeMode === "images" ? 24 : 4).map(item => {
    const url = resultUrl(item)
    const image = thumbnailUrl(item)
    if (!image) return ""
    return `
      <a class="image-tile" href="${escapeHtml(url)}">
        <img src="${escapeHtml(image)}" alt="${escapeHtml(item.title || "Search image")}" loading="lazy">
        <span>${escapeHtml(item.title || hostFromUrl(url) || "Image")}</span>
      </a>
    `
  }).filter(Boolean).join("")

  const imageResultItems = images.map(item => {
    const url = resultUrl(item)
    const image = thumbnailUrl(item)
    if (!image) return ""
    return `
      <a class="image-result" href="${escapeHtml(url)}">
        <img src="${escapeHtml(image)}" alt="${escapeHtml(item.title || "Search image")}" loading="lazy">
        <span class="image-result-title">${escapeHtml(item.title || hostFromUrl(url) || "Image")}</span>
        <span class="image-result-source">${escapeHtml(hostFromUrl(url) || url)}</span>
      </a>
    `
  }).filter(Boolean).join("")

  const newsItems = news.map(item => {
    const url = resultUrl(item)
    const image = thumbnailUrl(item)
    return `
      <a class="side-card" href="${escapeHtml(url)}">
        ${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : ""}
        <span class="side-card-title">${escapeHtml(item.title || url)}</span>
        <span class="side-card-meta">${escapeHtml(item.source || item.publisher || hostFromUrl(url))}</span>
      </a>
    `
  }).join("")

  const newsResultItems = news.map(item => {
    const url = resultUrl(item)
    const image = thumbnailUrl(item)
    return `
      <article class="vertical-result">
        ${image ? `<a class="vertical-thumb" href="${escapeHtml(url)}"><img src="${escapeHtml(image)}" alt="" loading="lazy"></a>` : ""}
        <div>
          <div class="result-source">
            <span class="favicon">${escapeHtml((hostFromUrl(url) || "?").slice(0, 1).toUpperCase())}</span>
            <span>
              <span class="result-site">${escapeHtml(item.source || item.publisher || hostFromUrl(url) || url)}</span>
              <span class="result-url">${escapeHtml(url)}</span>
            </span>
          </div>
          <a class="result-title" href="${escapeHtml(url)}">${cleanSnippet(item.title || url)}</a>
          <p>${cleanSnippet(item.description || "")}</p>
          ${item.age || item.date ? `<div class="vertical-meta">${escapeHtml(item.age || item.date)}</div>` : ""}
        </div>
      </article>
    `
  }).join("")

  const videoItems = videos.map(item => {
    const url = resultUrl(item)
    const image = thumbnailUrl(item)
    return `
      <a class="video-card" href="${escapeHtml(url)}">
        <span class="video-thumb">
          ${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : ""}
          <span class="play-badge">&#9658;</span>
        </span>
        <span class="video-copy">
          <span class="side-card-title">${escapeHtml(item.title || url)}</span>
          <span class="side-card-meta">${escapeHtml(item.creator || item.publisher || hostFromUrl(url))}</span>
        </span>
      </a>
    `
  }).join("")

  const videoResultItems = videos.map(item => {
    const url = resultUrl(item)
    const image = thumbnailUrl(item)
    return `
      <article class="vertical-result video-result">
        <a class="vertical-thumb video-large-thumb" href="${escapeHtml(url)}">
          ${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : ""}
          <span class="play-badge">&#9658;</span>
        </a>
        <div>
          <div class="result-source">
            <span class="favicon">${escapeHtml((hostFromUrl(url) || "?").slice(0, 1).toUpperCase())}</span>
            <span>
              <span class="result-site">${escapeHtml(item.creator || item.publisher || hostFromUrl(url) || url)}</span>
              <span class="result-url">${escapeHtml(url)}</span>
            </span>
          </div>
          <a class="result-title" href="${escapeHtml(url)}">${cleanSnippet(item.title || url)}</a>
          <p>${cleanSnippet(item.description || "")}</p>
          ${item.duration || item.age ? `<div class="vertical-meta">${escapeHtml([item.duration, item.age].filter(Boolean).join(" · "))}</div>` : ""}
        </div>
      </article>
    `
  }).join("")

  const resultItems = results.map(item => {
    const url = resultUrl(item)
    const host = hostFromUrl(url)
    const image = thumbnailUrl(item)
    const extraSnippets = Array.isArray(item.extra_snippets)
      ? item.extra_snippets.slice(0, 2)
      : []

    return `
      <article class="result-item">
        <div class="result-copy">
          <div class="result-source">
            <span class="favicon">
              ${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : escapeHtml((host || "?").slice(0, 1).toUpperCase())}
            </span>
            <span>
              <span class="result-site">${escapeHtml(item.profile && item.profile.name ? item.profile.name : host || url)}</span>
              <span class="result-url">${escapeHtml(url)}</span>
            </span>
          </div>
          <a class="result-title" href="${escapeHtml(url)}">${cleanSnippet(item.title || url)}</a>
          <p>${cleanSnippet(item.description || extraSnippets[0] || "")}</p>
          ${extraSnippets.length > 1 ? `<div class="extra-snippets">${extraSnippets.map(snippet => `<span>${cleanSnippet(snippet)}</span>`).join("")}</div>` : ""}
        </div>
      </article>
    `
  }).join("")

  const verticalContent = (() => {
    if (activeMode === "images") {
      return imageResultItems
        ? `<section class="image-results-grid">${imageResultItems}</section>`
        : `<div class="empty">No image results found.</div>`
    }
    if (activeMode === "news") {
      return newsResultItems
        ? `<section class="vertical-results-list">${newsResultItems}</section>`
        : `<div class="empty">No news results found.</div>`
    }
    if (activeMode === "videos") {
      return videoResultItems
        ? `<section class="vertical-results-list">${videoResultItems}</section>`
        : `<div class="empty">No video results found.</div>`
    }
    return `
      ${aiOverview}
      ${resultItems || `<div class="empty">No results found.</div>`}
      ${imageItems ? `<section class="module image-module"><h2>Images</h2><div class="image-row">${imageItems}</div></section>` : ""}
    `
  })()

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(query || "Search")} - Nucleus Engine</title>
  <style>
    /* Fallback palette: overridden at load by the app-wide :root token block
       injected from main.js (applyEngineThemeVars). */
    :root {
      color-scheme: dark;
      --bg: #050916;
      --bg-gradient:
        radial-gradient(circle at 18% 8%, rgba(117, 103, 216, 0.16), transparent 30%),
        radial-gradient(circle at 78% 12%, rgba(90, 169, 200, 0.1), transparent 32%),
        radial-gradient(circle at 52% 106%, rgba(199, 154, 84, 0.08), transparent 34%),
        linear-gradient(180deg, #070b18 0%, #05070f 100%);
      --surface: #0c1224;
      --surface-2: #151c34;
      --surface-soft: rgba(12, 18, 36, 0.72);
      --border: rgba(125, 139, 190, 0.34);
      --text: #f4f7ff;
      --text-dim: #aeb8dc;
      --text-mute: #6f7aa7;
      --accent: #7567d8;
      --link: #c8d2ff;
      --visited: #bfa8ff;
    }

    * { box-sizing: border-box; }

    body {
      background: var(--bg-gradient);
      background-attachment: fixed;
      background-position: 0% 0%, 100% 0%, 50% 100%, 50% 50%;
      background-size: 140% 140%, 150% 150%, 135% 135%, 100% 100%;
      color: var(--text);
      font-family: Arial, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      min-height: 100vh;
      text-align: left;
      animation: engineAmbientDrift 100s ease-in-out infinite alternate;
    }

    @keyframes engineAmbientDrift {
      0% {
        background-position: 0% 0%, 100% 0%, 50% 100%, 50% 50%;
      }

      50% {
        background-position: 7% 5%, 93% 7%, 48% 94%, 50% 50%;
      }

      100% {
        background-position: 13% 9%, 86% 12%, 54% 88%, 50% 50%;
      }
    }

    main {
      margin: 0;
      min-height: 100vh;
      padding: 0 clamp(18px, 5vw, 72px) 56px;
      text-align: center;
      width: 100%;
    }

    .search-header {
      backdrop-filter: blur(18px);
      background: rgba(15, 17, 23, 0.82);
      border-bottom: 1px solid rgba(87, 94, 116, 0.24);
      margin: 0 calc(-1 * clamp(18px, 5vw, 72px)) 18px;
      padding: 12px clamp(18px, 5vw, 72px) 0;
      position: sticky;
      text-align: center;
      top: 0;
      z-index: 20;
    }

    .brand {
      display: none;
      color: var(--text-mute);
      font-size: 11px;
      font-weight: 700;
      margin-bottom: 8px;
      text-transform: uppercase;
    }

    h1 {
      display: none;
      font-size: 22px;
      font-weight: 500;
      line-height: 1.25;
      margin: 0 0 9px;
    }

    .summary {
      display: none;
      color: var(--text-dim);
      font-size: 13px;
    }

    .spellcheck {
      color: var(--text-dim);
      font-size: 13px;
      margin-top: 6px;
    }

    .spellcheck a {
      color: var(--link);
      text-decoration: none;
    }

    .search-again {
      display: flex;
      gap: 10px;
      min-width: 0;
      width: min(820px, 100%);
    }

    .search-bar-row {
      align-items: center;
      display: flex;
      gap: 12px;
      max-width: 960px;
      width: min(960px, 100%);
    }

    .search-home-mark {
      align-items: center;
      border: 1px solid rgba(140, 131, 255, 0.22);
      border-radius: 50%;
      display: inline-flex;
      flex: 0 0 auto;
      height: 42px;
      justify-content: center;
      overflow: hidden;
      transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
      width: 42px;
    }

    .search-home-mark:hover,
    .search-home-mark:focus-visible {
      border-color: rgba(167, 139, 250, 0.58);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.16);
      outline: none;
      transform: translateY(-1px);
    }

    .search-home-mark img {
      height: 100%;
      object-fit: cover;
      width: 100%;
    }

    .search-again input {
      background: rgba(23, 26, 33, 0.78);
      border: 1px solid var(--border);
      border-radius: 999px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18);
      color: var(--text);
      flex: 1;
      font: inherit;
      font-size: 15px;
      height: 44px;
      outline: none;
      padding: 0 18px;
    }

    .search-again input:focus {
      border-color: var(--accent);
    }

    .search-again button {
      background: linear-gradient(135deg, #9f96ff, #6657e8);
      border: 0;
      border-radius: 999px;
      box-shadow: 0 12px 34px rgba(102, 87, 232, 0.28);
      color: #fff;
      cursor: pointer;
      font: inherit;
      font-size: 14px;
      font-weight: 650;
      min-width: 86px;
      padding: 0 16px;
    }

    .search-tabs {
      display: flex;
      gap: 20px;
      justify-content: center;
      margin: 12px 0 0;
    }

    .search-tabs a {
      color: var(--text-dim);
      font-size: 13px;
      padding-bottom: 9px;
      text-decoration: none;
    }

    .search-tabs .active {
      border-bottom: 2px solid var(--accent);
      color: var(--text);
    }

    .results-shell {
      display: grid;
      gap: 28px;
      grid-template-columns: minmax(0, 720px) minmax(260px, 360px);
      justify-content: center;
      padding-top: 2px;
      text-align: left;
    }

    .results-shell.vertical-shell {
      grid-template-columns: minmax(0, 1040px);
    }

    .result-list {
      display: grid;
      gap: 18px;
      margin-left: 0;
      margin-right: 0;
      max-width: none;
      text-align: left;
      width: 100%;
    }

    .result-item {
      background: rgba(17, 20, 28, 0.42);
      border: 1px solid transparent;
      border-radius: 10px;
      padding: 14px 16px;
      text-align: left;
      transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
    }

    .result-item:hover {
      background: rgba(23, 26, 33, 0.76);
      border-color: rgba(140, 131, 255, 0.2);
      transform: translateY(-1px);
    }

    .result-source {
      align-items: center;
      color: var(--text-dim);
      display: flex;
      gap: 10px;
      margin-bottom: 7px;
      min-width: 0;
    }

    .favicon {
      align-items: center;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 50%;
      color: var(--text-dim);
      display: inline-flex;
      flex: 0 0 auto;
      font-size: 11px;
      height: 26px;
      justify-content: center;
      overflow: hidden;
      width: 26px;
    }

    .favicon img {
      height: 100%;
      object-fit: cover;
      width: 100%;
    }

    .result-site {
      color: var(--text);
      display: block;
      font-size: 13px;
      line-height: 1.25;
    }

    .result-title {
      color: var(--link);
      display: inline-block;
      font-size: 19px;
      font-weight: 500;
      line-height: 1.35;
      margin-bottom: 6px;
      text-decoration: none;
    }

    .result-title:visited {
      color: var(--visited);
    }

    .result-title:hover {
      text-decoration: underline;
    }

    .result-url {
      color: var(--text-mute);
      display: block;
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .result-item p {
      color: #c2c7d4;
      font-size: 15px;
      line-height: 1.5;
      margin: 0;
    }

    .ai-overview {
      background:
        linear-gradient(135deg, rgba(140, 131, 255, 0.18), rgba(23, 26, 33, 0.72)),
        rgba(17, 20, 28, 0.72);
      border: 1px solid rgba(140, 131, 255, 0.28);
      border-radius: 12px;
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.22);
      padding: 16px 18px;
    }

    .ai-overview-label {
      align-items: center;
      color: #d7dcff;
      display: flex;
      font-size: 15px;
      font-weight: 600;
      gap: 9px;
      margin-bottom: 9px;
    }

    .ai-overview-label img,
    .module-heading img {
      border-radius: 50%;
      height: 60px;
      object-fit: cover;
      width: 60px;
    }

    .ai-overview p {
      color: #dfe3ef;
      font-size: 15px;
      line-height: 1.55;
      margin: 0;
    }

    .ai-overview ul {
      color: #c2c7d4;
      display: grid;
      font-size: 14px;
      gap: 7px;
      line-height: 1.45;
      margin: 10px 0 0;
      padding-left: 20px;
    }

    .ai-overview-note {
      color: var(--text-mute);
      font-size: 12px;
      margin-top: 12px;
    }

    .extra-snippets {
      color: var(--text-dim);
      display: grid;
      font-size: 14px;
      gap: 5px;
      line-height: 1.45;
      margin-top: 8px;
    }

    .module {
      border-top: 1px solid var(--border);
      margin-top: 8px;
      padding-top: 18px;
    }

    .module h2 {
      font-size: 19px;
      font-weight: 500;
      margin: 0 0 12px;
    }

    .image-row {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .image-results-grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    }

    .image-result {
      color: inherit;
      display: block;
      min-width: 0;
      text-decoration: none;
    }

    .image-result img {
      aspect-ratio: 1.16;
      background: var(--surface);
      border-radius: 12px;
      display: block;
      object-fit: cover;
      transition: transform 140ms ease, filter 140ms ease;
      width: 100%;
    }

    .image-result:hover img {
      filter: brightness(1.08);
      transform: translateY(-2px);
    }

    .image-result-title {
      color: var(--text);
      display: block;
      font-size: 13px;
      line-height: 1.3;
      margin-top: 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .image-result-source {
      color: var(--text-mute);
      display: block;
      font-size: 12px;
      margin-top: 3px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .image-tile {
      color: var(--text-dim);
      font-size: 12px;
      min-width: 0;
      text-decoration: none;
    }

    .image-tile img {
      aspect-ratio: 1.2;
      background: var(--surface);
      border-radius: 8px;
      display: block;
      margin-bottom: 6px;
      object-fit: cover;
      width: 100%;
    }

    .image-tile span {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .side-panel {
      display: grid;
      gap: 18px;
      min-width: 0;
    }

    .vertical-results-list {
      display: grid;
      gap: 18px;
    }

    .vertical-result {
      background: rgba(17, 20, 28, 0.42);
      border: 1px solid transparent;
      border-radius: 12px;
      display: grid;
      gap: 16px;
      grid-template-columns: 170px minmax(0, 1fr);
      padding: 14px;
      transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
    }

    .vertical-result:hover {
      background: rgba(23, 26, 33, 0.76);
      border-color: rgba(140, 131, 255, 0.2);
      transform: translateY(-1px);
    }

    .vertical-thumb {
      border-radius: 10px;
      display: block;
      min-height: 104px;
      overflow: hidden;
      position: relative;
    }

    .vertical-thumb img {
      height: 100%;
      min-height: 104px;
      object-fit: cover;
      width: 100%;
    }

    .video-large-thumb {
      aspect-ratio: 16 / 9;
      background: var(--surface);
    }

    .vertical-meta {
      color: var(--text-mute);
      font-size: 12px;
      margin-top: 8px;
    }

    .side-module {
      background: rgba(17, 20, 28, 0.54);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.18);
      padding: 12px;
    }

    .side-module h2 {
      font-size: 16px;
      font-weight: 500;
      margin: 0;
    }

    .internal-pending-panel {
      overflow: hidden;
      position: relative;
    }

    .internal-pending-panel::after {
      background: linear-gradient(90deg, transparent, rgba(125, 211, 252, 0.18), transparent);
      content: "";
      height: 1px;
      left: -40%;
      position: absolute;
      right: -40%;
      top: 0;
      transform: translateX(-35%);
      animation: internalSweep 1.8s ease-in-out infinite;
    }

    .internal-loader-row {
      align-items: center;
      display: flex;
      flex-direction: column;
      gap: 8px;
      justify-content: center;
      margin-top: 14px;
      min-height: 96px;
      text-align: center;
    }

    .internal-loader {
      aspect-ratio: 1;
      border: 2px solid rgba(148, 163, 184, 0.18);
      border-radius: 999px;
      box-shadow: 0 0 20px rgba(168, 85, 247, 0.16);
      display: block;
      position: relative;
      width: 24px;
    }

    .internal-loader::before {
      border: 2px solid transparent;
      border-right-color: #a855f7;
      border-top-color: #c084fc;
      border-radius: inherit;
      content: "";
      inset: -2px;
      position: absolute;
      animation: internalSpin 0.9s linear infinite;
    }

    .internal-loader::after {
      background: #c084fc;
      border-radius: 999px;
      box-shadow: 0 0 12px rgba(192, 132, 252, 0.75);
      content: "";
      height: 5px;
      left: 50%;
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 5px;
      animation: internalPulse 1.2s ease-in-out infinite;
    }

    .internal-loader-title,
    .internal-loader-meta {
      display: block;
      line-height: 1.35;
    }

    .internal-loader-title {
      color: var(--text);
      font-size: 13px;
      font-weight: 500;
    }

    .internal-loader-meta {
      color: var(--text-mute);
      font-size: 12px;
      margin-top: 2px;
    }

    @keyframes internalSpin {
      to {
        transform: rotate(360deg);
      }
    }

    @keyframes internalPulse {
      0%,
      100% {
        opacity: 0.5;
        transform: translate(-50%, -50%) scale(0.72);
      }
      50% {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
    }

    @keyframes internalSweep {
      0% {
        transform: translateX(-35%);
      }
      55%,
      100% {
        transform: translateX(35%);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      body,
      .internal-pending-panel::after,
      .internal-loader::before,
      .internal-loader::after {
        animation: none;
      }
    }

    .module-heading {
      align-items: center;
      display: flex;
      gap: 9px;
      margin-bottom: 9px;
    }

    .feature-image {
      aspect-ratio: 1.7;
      border-radius: 8px;
      display: block;
      margin-bottom: 9px;
      object-fit: cover;
      width: 100%;
    }

    .feature-description {
      color: #c2c7d4;
      font-size: 13px;
      line-height: 1.4;
      margin: 0 0 9px;
    }

    .feature-name {
      color: var(--text);
      font-size: 14px;
      font-weight: 500;
      line-height: 1.35;
      margin: -3px 0 6px;
    }

    .fact-list {
      border-top: 1px solid var(--border);
      display: grid;
      gap: 0;
      margin-top: 10px;
    }

    .fact-row {
      border-bottom: 1px solid var(--border);
      display: grid;
      gap: 10px;
      grid-template-columns: 110px minmax(0, 1fr);
      padding: 6px 0;
    }

    .fact-row span {
      color: var(--text-mute);
      font-size: 12px;
      text-transform: capitalize;
    }

    .fact-row strong {
      color: var(--text);
      font-size: 12px;
      font-weight: 500;
      overflow-wrap: anywhere;
    }

    .feature-link {
      color: var(--link);
      display: inline-block;
      font-size: 13px;
      margin-top: 12px;
      text-decoration: none;
    }

    .side-card,
    .video-card {
      color: inherit;
      display: grid;
      gap: 9px;
      grid-template-columns: 82px minmax(0, 1fr);
      padding: 10px 0;
      text-decoration: none;
    }

    .side-card + .side-card,
    .video-card + .video-card {
      border-top: 1px solid var(--border);
    }

    .internal-side-card {
      grid-template-columns: 42px minmax(0, 1fr);
    }

    .side-card img,
    .video-thumb img {
      aspect-ratio: 1.35;
      border-radius: 6px;
      display: block;
      object-fit: cover;
      width: 82px;
    }

    .side-card-title {
      color: var(--link);
      display: block;
      font-size: 13px;
      line-height: 1.35;
    }

    .side-card-description {
      color: #c2c7d4;
      display: block;
      font-size: 12px;
      line-height: 1.35;
      margin-top: 5px;
    }

    .internal-source-context {
      border-left: 2px solid rgba(148, 163, 184, 0.28);
      color: var(--text-mute);
      display: block;
      font-size: 11px;
      line-height: 1.35;
      margin: 7px 0 0 10px;
      padding-left: 9px;
    }

    .internal-source-title {
      color: #d3d7e2;
      display: block;
      font-weight: 600;
    }

    .internal-source-description {
      display: block;
      margin-top: 2px;
    }

    .canvas-thumb {
      align-items: center;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-dim);
      display: inline-flex;
      font-size: 14px;
      font-weight: 700;
      height: 42px;
      justify-content: center;
      overflow: hidden;
      width: 42px;
    }

    .canvas-thumb img {
      height: 100%;
      object-fit: cover;
      width: 100%;
    }

    .side-card-meta {
      color: var(--text-mute);
      display: block;
      font-size: 12px;
      margin-top: 4px;
    }

    .video-thumb {
      position: relative;
    }

    .play-badge {
      align-items: center;
      background: rgba(0, 0, 0, 0.68);
      border-radius: 50%;
      color: white;
      display: inline-flex;
      font-size: 10px;
      height: 24px;
      justify-content: center;
      left: 50%;
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 24px;
    }

    .empty {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 7px;
      color: var(--text-dim);
      padding: 18px;
      text-align: left;
    }

    .error {
      background: rgba(216, 90, 48, 0.12);
      border: 1px solid rgba(216, 90, 48, 0.45);
      border-radius: 7px;
      color: #ffd2c7;
      margin-bottom: 14px;
      padding: 14px 16px;
      text-align: left;
    }

    @media (max-width: 1050px) {
      .results-shell {
        grid-template-columns: minmax(0, 1fr);
      }

      .side-panel {
        display: grid;
      }
    }

    @media (max-width: 640px) {
      main {
        padding-left: 16px;
        padding-right: 16px;
      }

      .search-again {
        align-items: stretch;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
      }

      .search-again button {
        height: 40px;
      }

      .search-bar-row {
        align-items: start;
        gap: 9px;
      }

      .search-home-mark {
        height: 40px;
        width: 40px;
      }

      .image-row {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="search-header">
      ${alteredQuery ? `<div class="spellcheck">Showing results for <a href="nucleus://search?q=${encodeURIComponent(alteredQuery)}">${escapeHtml(alteredQuery)}</a></div>` : ""}
      <div class="search-bar-row">
        ${webLogo ? `<a class="search-home-mark" href="nucleus://engine" aria-label="Return to Nucleus Engine"><img src="${escapeHtml(webLogo)}" alt=""></a>` : ""}
        <form class="search-again" id="search-form">
          <input id="search-input" type="text" value="${escapeHtml(query)}" autocomplete="off">
          <button type="submit">Search</button>
        </form>
      </div>
      <nav class="search-tabs" aria-label="Search categories">
        <a class="${tabClass("all")}" href="${escapeHtml(makeSearchUrl("all"))}">All</a>
        <a class="${tabClass("images")}" href="${escapeHtml(makeSearchUrl("images"))}">Images</a>
        <a class="${tabClass("news")}" href="${escapeHtml(makeSearchUrl("news"))}">News</a>
        <a class="${tabClass("videos")}" href="${escapeHtml(makeSearchUrl("videos"))}">Videos</a>
      </nav>
    </section>
    <div class="results-shell ${activeMode === "all" ? "" : "vertical-shell"}">
      <section class="result-list">
        ${errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : ""}
        ${verticalErrors.map(message => `<div class="error">${escapeHtml(message)}</div>`).join("")}
        ${internalError ? `<div class="error">${escapeHtml(internalError)}</div>` : ""}
        ${verticalContent}
      </section>
      ${activeMode === "all" ? `<aside class="side-panel">
        ${featurePanel}
        ${newsItems ? `<section class="side-module"><h2>Top stories</h2>${newsItems}</section>` : ""}
        ${videoItems ? `<section class="side-module"><h2>Videos</h2>${videoItems}</section>` : ""}
      </aside>` : ""}
    </div>
  </main>
  <script>
    document.getElementById("search-form").addEventListener("submit", event => {
      event.preventDefault();
      const query = document.getElementById("search-input").value.trim();
      if (query) {
        window.location.href = "nucleus://search?q=" + encodeURIComponent(query) + "&type=${escapeHtml(activeMode)}";
      }
    });
    const restoreScrollY = ${JSON.stringify(restoreScrollY)};
    if (restoreScrollY > 0) {
      requestAnimationFrame(() => window.scrollTo(0, restoreScrollY));
    }
  </script>
</body>
</html>`
}

module.exports = {
  getBraveApiKey,
  loadEnv,
  renderInternalEmptyPanel,
  renderInternalResultsPanel,
  renderwebsearchresult,
  searchweb
}
