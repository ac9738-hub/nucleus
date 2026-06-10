const fs = require("fs");
const path = require("path");

const DEFAULT_THEME = "default";
const SETTINGS_FILE = "settings.json";
const THEME_NAME_PATTERN = /^[a-z0-9_-]+$/;
const FALLBACK_RENDERER_STYLESHEETS = ["styles.css", "app/synapse/synapse.css", "app/mail/mail.css"];
const FALLBACK_CANVAS_THEME = {
  criticalGradient: "linear-gradient(135deg, #0c1224 0%, #050916 100%)",
  mainInjectionPath: "injection.css",
  iframeInjectionPathsById: {
    preview_frame: "preview_frame.css",
    tool_content: "injection.css"
  }
};

function normalizeThemeName(value) {
  const name = String(value || "").trim().toLowerCase();
  return name || DEFAULT_THEME;
}

function isValidThemeName(value) {
  return THEME_NAME_PATTERN.test(String(value || ""));
}

function resolveThemeManifestPath(rootDir, themeName) {
  const name = normalizeThemeName(themeName);
  if (!isValidThemeName(name)) return null;
  return path.join(rootDir, "themes", name, "manifest.json");
}

function readThemeManifest(rootDir, themeName) {
  const manifestPath = resolveThemeManifestPath(rootDir, themeName);
  if (!manifestPath || !fs.existsSync(manifestPath)) return null;

  try {
    const manifestRaw = fs.readFileSync(manifestPath, "utf-8").replace(/^\uFEFF/, "");
    return manifestRaw.trim() ? JSON.parse(manifestRaw) : {};
  } catch (error) {
    console.error("Unable to read theme manifest:", manifestPath, error);
    return null;
  }
}

function normalizeThemeAssetPath(rootDir, relativePath) {
  const raw = String(relativePath || "").trim();
  if (!raw || raw.includes("\0")) return null;
  if (path.isAbsolute(raw)) return null;

  const normalized = path.posix.normalize(raw.replace(/\\/g, "/"));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    return null;
  }
  if (path.posix.extname(normalized).toLowerCase() !== ".css") {
    return null;
  }

  const root = path.resolve(rootDir);
  const absolutePath = path.resolve(rootDir, ...normalized.split("/"));
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
    return null;
  }

  return normalized;
}

function sanitizeStylesheetList(rootDir, stylesheets) {
  if (!Array.isArray(stylesheets)) return FALLBACK_RENDERER_STYLESHEETS;
  const safeStylesheets = stylesheets
    .map(stylesheet => normalizeThemeAssetPath(rootDir, stylesheet))
    .filter(Boolean);
  return safeStylesheets.length ? safeStylesheets : FALLBACK_RENDERER_STYLESHEETS;
}

function sanitizeIframeInjectionPaths(rootDir, pathsById) {
  const source = pathsById && typeof pathsById === "object"
    ? pathsById
    : FALLBACK_CANVAS_THEME.iframeInjectionPathsById;
  const sanitized = {};

  for (const [id, filename] of Object.entries(source)) {
    const safePath = normalizeThemeAssetPath(rootDir, filename);
    if (safePath) sanitized[id] = safePath;
  }

  return Object.keys(sanitized).length
    ? sanitized
    : { ...FALLBACK_CANVAS_THEME.iframeInjectionPathsById };
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
    return raw.trim() ? JSON.parse(raw) : null;
  } catch (error) {
    console.error("Unable to read JSON file:", filePath, error);
    return null;
  }
}

function readSettings(rootDir) {
  return readJsonFile(path.join(rootDir, SETTINGS_FILE)) || {};
}

// Persisted theme choice (user-selected at runtime). Returns null when unset.
function getStoredTheme(rootDir) {
  const settings = readSettings(rootDir);
  const theme = settings && settings.theme ? normalizeThemeName(settings.theme) : null;
  return theme;
}

// Writes the chosen theme into settings.json, preserving other settings.
function setStoredTheme(rootDir, themeName) {
  const normalized = normalizeThemeName(themeName);
  if (!isValidThemeName(normalized) || !readThemeManifest(rootDir, normalized)) {
    throw new Error(`Unknown or invalid theme: ${themeName}`);
  }
  const settings = readSettings(rootDir);
  settings.theme = normalized;
  fs.writeFileSync(path.join(rootDir, SETTINGS_FILE), JSON.stringify(settings, null, 2), "utf-8");
  return settings.theme;
}

// Lists installed themes (directories under themes/ that contain a manifest.json).
function listThemes(rootDir) {
  const themesDir = path.join(rootDir, "themes");
  let entries = [];
  try {
    entries = fs.readdirSync(themesDir, { withFileTypes: true });
  } catch (error) {
    return [{ name: DEFAULT_THEME, label: "Default" }];
  }

  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => isValidThemeName(name) && readThemeManifest(rootDir, name))
    .map(name => {
      const manifest = readJsonFile(path.join(themesDir, name, "manifest.json")) || {};
      const label = manifest.label
        || String(name).charAt(0).toUpperCase() + String(name).slice(1);
      return { name, label };
    });
}

function loadThemeManifest(rootDir, requestedTheme) {
  const themeName = normalizeThemeName(requestedTheme);
  const requestedManifest = readThemeManifest(rootDir, themeName);
  if (requestedManifest) {
    return { activeTheme: themeName, manifest: requestedManifest };
  }

  const fallbackManifest = readThemeManifest(rootDir, DEFAULT_THEME) || { name: DEFAULT_THEME };
  return { activeTheme: DEFAULT_THEME, manifest: fallbackManifest };
}

function getThemeSelection(rootDir) {
  const requested = process.env.NUCLEUS_THEME || getStoredTheme(rootDir) || DEFAULT_THEME;
  const { activeTheme, manifest } = loadThemeManifest(rootDir, requested);
  return {
    requestedTheme: normalizeThemeName(requested),
    activeTheme,
    manifest
  };
}

function getRendererStylesheets(rootDir) {
  const { manifest } = getThemeSelection(rootDir);
  return sanitizeStylesheetList(rootDir, manifest.rendererStylesheets);
}

function readThemeCss(rootDir, relativePath, fallback = "") {
  const safePath = normalizeThemeAssetPath(rootDir, relativePath);
  if (!safePath) return fallback;
  const absolutePath = path.join(rootDir, safePath);
  if (!fs.existsSync(absolutePath)) return fallback;
  return fs.readFileSync(absolutePath, "utf-8");
}

function getCanvasThemeConfig(rootDir) {
  const { manifest } = getThemeSelection(rootDir);
  const canvas = manifest.canvas || {};
  const mainInjectionPath = normalizeThemeAssetPath(rootDir, canvas.mainInjectionPath)
    || FALLBACK_CANVAS_THEME.mainInjectionPath;
  return {
    criticalGradient: canvas.criticalGradient || FALLBACK_CANVAS_THEME.criticalGradient,
    mainInjectionPath,
    iframeInjectionPathsById: sanitizeIframeInjectionPaths(rootDir, canvas.iframeInjectionPathsById)
  };
}

module.exports = {
  getThemeSelection,
  getRendererStylesheets,
  getCanvasThemeConfig,
  readThemeCss,
  getStoredTheme,
  setStoredTheme,
  listThemes
};
