function sameTabId(left, right) {
  return String(left) === String(right)
}

function isWebContentTab(tab) {
  return tab && (tab.type === "browsertab" || (tab.type === "canvastab" && tab.canvasMode === "browser"))
}

function normalizeFrameUrl(value) {
  if (!value) return ""
  try {
    return new URL(value).href
  } catch (_error) {
    return String(value)
  }
}

function isLikelyDownloadUrl(value) {
  if (!value) return false
  let url
  try {
    url = new URL(value)
  } catch (_error) {
    return false
  }

  const pathname = url.pathname.toLowerCase()
  const search = url.searchParams
  const filename = pathname.split("/").pop() || ""
  const fileExtensionPattern = /\.(pdf|docx?|pptx?|xlsx?|csv|zip|png|jpe?g|gif|webp|mp4|mov|mp3|wav|txt)$/i

  return (
    search.has("download") ||
    pathname.endsWith("/download") ||
    pathname.includes("/download/") ||
    pathname.includes("/attachments/") ||
    fileExtensionPattern.test(filename)
  )
}

function getFrameSnapshotName(frame, index) {
  const url = frame && frame.url ? frame.url : "frame"
  const frameName = frame && frame.name ? frame.name : ""
  const label = frameName || url
  const safeLabel = String(label)
    .replace(/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "frame"

  return `${String(index).padStart(2, "0")}-${safeLabel}.html`
}

function normalizeBrowserUrl(value) {
  const text = String(value || "").trim()
  if (!text) {
    return "https://www.google.com"
  }
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(text)) {
    return text
  }
  if (text.includes(".") && !text.includes(" ")) {
    return "https://" + text
  }
  return "https://www.google.com/search?q=" + encodeURIComponent(text)
}

module.exports = {
  getFrameSnapshotName,
  isLikelyDownloadUrl,
  isWebContentTab,
  normalizeBrowserUrl,
  normalizeFrameUrl,
  sameTabId
}
