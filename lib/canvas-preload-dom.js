// Canvas DOM link extraction for preload — respects injection.css hidden chrome.
;(function () {
'use strict'

// Mirrors injection.css "GLOBAL: CANVAS NAVIGATION" (display: none regions).
const CANVAS_HIDDEN_LINK_ANCESTOR_SELECTORS = [
  '#global_nav',
  '#left-side',
  '#section-tabs',
  '#module_navigation_target',
  '#sequence_footer',
  '.module-sequence-padding',
  '.module-sequence-footer',
  '[aria-label="Module Navigation"]',
  '[aria-label="Previous Module Item"]',
  '[aria-label="Next Module Item"]',
  '#panoramaAccessibilityInjectionContainer',
  '#panoramaAccessibilityDraggable',
  '#panoramaAccessibilityFloatButton',
  '[id*="panoramaAccessibility"]',
  '.ic-app-nav-toggle-and-crumbs',
  '.ic-app-header',
  '.ic-app-header__main-navigation',
  '.ic-app-header__menu-list',
  '.ic-app-header__menu-list-item',
  '.ic-app-header__logomark',
  '.ic-app-header__logomark-container',
  '.ic-app-course-menu',
  '.ic-app-course-menu__content',
  '.ic-app-course-menu__menu',
  '.navigation-tray-container',
  '#breadcrumbs',
  '.ic-app-crumbs'
].join(', ')

const CANVAS_CHROME_PATH_PATTERN = /^\/courses\/\d+(?:\/(?:assignments|modules|grades|users|discussion_topics|quizzes|settings|announcements|files|groups|outcomes|analytics|statistics|conferences|collaborations|external_tools|wiki|pages))?\/?$/
const CANVAS_PAGES_INDEX_PATTERN = /^\/courses\/\d+\/pages\/?$/i
const CANVAS_NAV_PAGE_PATTERN = /^\/courses\/\d+\/pages\/(?:front_page|index)\/?$/i
const CANVAS_DEEP_CONTENT_PATTERN = /^\/courses\/\d+\/.+/

const EXTERNAL_CANVAS_NAVIGATION_HOSTS = new Set([
  'community.canvaslms.com',
  'canvas.instructure.com',
  'status.instructure.com',
  'www.instructure.com',
  'canvaslms.com',
  'help.instructure.com',
  'community.instructure.com'
])

function normalizePathname(url) {
  try {
    return new URL(String(url || '').trim()).pathname.replace(/\/+$/, '') || '/'
  } catch (_error) {
    return ''
  }
}

function isCanvasNavigationPageUrl(url) {
  const path = normalizePathname(url)
  if (!path) return false
  return CANVAS_PAGES_INDEX_PATTERN.test(path) || CANVAS_NAV_PAGE_PATTERN.test(path)
}

function isCanvasExternalNavigationHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase()
  if (!host) return true
  if (EXTERNAL_CANVAS_NAVIGATION_HOSTS.has(host)) return true
  if (host.startsWith('community.') && (host.endsWith('.canvaslms.com') || host.endsWith('.instructure.com'))) {
    return true
  }
  return false
}

function isCanvasExternalNavigationUrl(url) {
  try {
    return isCanvasExternalNavigationHost(new URL(String(url || '').trim()).hostname)
  } catch (_error) {
    return true
  }
}

function normalizeAllowedHosts(allowedHosts) {
  if (!allowedHosts) return []
  const list = Array.isArray(allowedHosts) ? allowedHosts : [allowedHosts]
  return list.map(entry => String(entry || '').trim().toLowerCase()).filter(Boolean)
}

function isAllowedCanvasInstitutionHost(url, allowedHosts) {
  let parsed
  try {
    parsed = new URL(String(url || '').trim())
  } catch (_error) {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  if (isCanvasExternalNavigationHost(host)) return false
  const allowed = normalizeAllowedHosts(allowedHosts)
  if (!allowed.length) return true
  return allowed.some(entry => host === entry || host.endsWith(`.${entry}`))
}

function isCanvasDeepContentUrl(url) {
  const path = normalizePathname(url)
  if (!path) return false
  return CANVAS_DEEP_CONTENT_PATTERN.test(path)
}

function isCanvasChromeUrl(url) {
  const path = normalizePathname(url)
  if (!path) return false
  return CANVAS_CHROME_PATH_PATTERN.test(path)
}

function isCanvasDownloadUrl(url) {
  const text = String(url || '').trim()
  if (!text) return false
  if (text.includes('/download') || text.includes('download_frd=1')) return true
  try {
    const parsed = new URL(text)
    if (parsed.searchParams.has('download')) return true
    if (parsed.searchParams.has('download_frd')) return true
    if (/\/download\/?$/i.test(parsed.pathname)) return true
  } catch (_error) {
    return false
  }
  return false
}

function canvasPreloadUrlKey(url) {
  const text = String(url || '').trim()
  if (!text || !/^https?:/i.test(text) || isCanvasDownloadUrl(text)) return ''
  try {
    const parsed = new URL(text)
    const courseMatch = parsed.pathname.match(/^\/courses\/(\d+)/)
    if (!courseMatch) {
      parsed.hash = ''
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
      return parsed.href
    }

    const courseId = courseMatch[1]

    const filePathMatch = parsed.pathname.match(/^\/courses\/\d+\/files\/(\d+)/)
    if (filePathMatch && !/\/download\/?$/i.test(parsed.pathname)) {
      return `/courses/${courseId}/files/${filePathMatch[1]}`
    }

    if (/^\/courses\/\d+\/files\/?$/i.test(parsed.pathname)) {
      const previewId = parsed.searchParams.get('preview')
      if (previewId) {
        return `/courses/${courseId}/files/${previewId}`
      }
    }

    const submissionMatch = parsed.pathname.match(
      /^(\/courses\/\d+\/assignments\/\d+\/submissions\/\d+)/i
    )
    if (submissionMatch) {
      return submissionMatch[1]
    }

    parsed.hash = ''
    if (parsed.searchParams.get('wrap') === '1') {
      parsed.searchParams.delete('wrap')
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    const search = parsed.searchParams.toString()
    parsed.search = search ? `?${search}` : ''
    return parsed.pathname + parsed.search
  } catch (_error) {
    return ''
  }
}

function canonicalCanvasPreloadUrl(url) {
  const text = String(url || '').trim()
  if (!text || !/^https?:/i.test(text) || isCanvasDownloadUrl(text)) return ''
  const key = canvasPreloadUrlKey(text)
  if (!key) return ''
  try {
    const parsed = new URL(text)
    if (key.startsWith('http')) return key
    return `${parsed.protocol}//${parsed.host}${key}`
  } catch (_error) {
    return ''
  }
}

function canvasPreloadUrlsMatch(left, right) {
  const a = canvasPreloadUrlKey(left)
  const b = canvasPreloadUrlKey(right)
  return Boolean(a && b && a === b)
}

function isCanvasPreloadableUrl(url, options = {}) {
  const text = String(url || '').trim()
  if (!text || !/^https?:/i.test(text)) return false
  if (isCanvasDownloadUrl(text)) return false
  if (isCanvasExternalNavigationUrl(text)) return false
  if (!isAllowedCanvasInstitutionHost(text, options.allowedHosts)) return false
  if (isCanvasChromeUrl(text)) return false
  if (isCanvasNavigationPageUrl(text)) return false
  if (!isCanvasDeepContentUrl(text)) return false
  return true
}

function buildExtractVisibleCanvasLinksScript(limit) {
  const cap = Math.max(1, Number(limit) || 20)
  const hiddenSelectors = JSON.stringify(CANVAS_HIDDEN_LINK_ANCESTOR_SELECTORS)
  return `(() => {
    const HIDDEN_ANCESTORS = ${hiddenSelectors};
    const CHROME_PATH = ${CANVAS_CHROME_PATH_PATTERN.toString()};

    function isHiddenCanvasControlLink(node) {
      if (!node || !node.closest) return true;
      if (node.closest(HIDDEN_ANCESTORS)) return true;
      let el = node;
      while (el && el !== document.documentElement) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return true;
        el = el.parentElement;
      }
      return false;
    }

    function isCanvasChromeHref(href) {
      try {
        const path = new URL(href).pathname.replace(/\\/+$/, '') || '/';
        return CHROME_PATH.test(path);
      } catch (_error) {
        return false;
      }
    }

    function isDownloadHref(href) {
      if (!href) return true;
      if (href.includes('/download') || href.includes('download_frd=1')) return true;
      try {
        const parsed = new URL(href);
        if (parsed.searchParams.has('download')) return true;
        if (parsed.searchParams.has('download_frd')) return true;
        if (/\\/download\\/?$/i.test(parsed.pathname)) return true;
      } catch (_error) {
        return true;
      }
      return false;
    }

    function isExternalNavigationHost(hostname) {
      const host = String(hostname || '').trim().toLowerCase();
      const blocked = ${JSON.stringify([...EXTERNAL_CANVAS_NAVIGATION_HOSTS])};
      if (!host || blocked.includes(host)) return true;
      if (host.startsWith('community.') && (host.endsWith('.canvaslms.com') || host.endsWith('.instructure.com'))) {
        return true;
      }
      return false;
    }

    function isNavigationPageHref(href) {
      try {
        const path = new URL(href).pathname.replace(/\\/+$/, '') || '/';
        if (/^\\/courses\\/\\d+\\/pages\\/?$/i.test(path)) return true;
        if (/^\\/courses\\/\\d+\\/pages\\/(?:front_page|index)\\/?$/i.test(path)) return true;
      } catch (_error) {
        return true;
      }
      return false;
    }

    function isDeepCourseContentHref(href) {
      try {
        const path = new URL(href).pathname.replace(/\\/+$/, '') || '/';
        return /^\\/courses\\/\\d+\\/.+/.test(path);
      } catch (_error) {
        return false;
      }
    }

    function isPreloadableHref(href) {
      if (!href || !/^https?:/i.test(href)) return false;
      if (isDownloadHref(href)) return false;
      try {
        const parsed = new URL(href);
        if (isExternalNavigationHost(parsed.hostname)) return false;
      } catch (_error) {
        return false;
      }
      if (isCanvasChromeHref(href)) return false;
      if (isNavigationPageHref(href)) return false;
      if (!isDeepCourseContentHref(href)) return false;
      return true;
    }

    const current = new URL(window.location.href);
    const seen = new Set();
    const links = [];
    const nodes = Array.from(document.querySelectorAll('a[href]'));

    for (const node of nodes) {
      if (isHiddenCanvasControlLink(node)) continue;

      let href = '';
      try {
        href = new URL(node.getAttribute('href'), current.href).href;
      } catch (_error) {
        continue;
      }

      if (!href || seen.has(href)) continue;
      if (!/^https?:/i.test(href)) continue;
      if (node.getAttribute('href') === '#') continue;
      if (!isPreloadableHref(href)) continue;

      seen.add(href);
      links.push(href);
      if (links.length >= ${cap}) break;
    }

    return links;
  })()`
}

const api = {
  CANVAS_HIDDEN_LINK_ANCESTOR_SELECTORS,
  CANVAS_CHROME_PATH_PATTERN,
  CANVAS_PAGES_INDEX_PATTERN,
  CANVAS_NAV_PAGE_PATTERN,
  EXTERNAL_CANVAS_NAVIGATION_HOSTS,
  isCanvasChromeUrl,
  isCanvasNavigationPageUrl,
  isCanvasExternalNavigationUrl,
  isCanvasExternalNavigationHost,
  isAllowedCanvasInstitutionHost,
  isCanvasDeepContentUrl,
  isCanvasDownloadUrl,
  canvasPreloadUrlKey,
  canonicalCanvasPreloadUrl,
  canvasPreloadUrlsMatch,
  isCanvasPreloadableUrl,
  buildExtractVisibleCanvasLinksScript
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api
}
if (typeof globalThis !== 'undefined') {
  globalThis.nucleusCanvasPreloadDom = api
}
if (typeof window !== 'undefined') {
  window.nucleusCanvasPreloadDom = api
}
})()
