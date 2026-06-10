const fs = require("fs");
const path = require("path");

const DEFAULT_THEME = "default";
const SETTINGS_FILE = "settings.json";

function normalizeThemeName(value) {
  const name = String(value || "").trim().toLowerCase();
  return name || DEFAULT_THEME;
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
  const settings = readSettings(rootDir);
  settings.theme = normalizeThemeName(themeName);
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
    .filter(name => fs.existsSync(path.join(themesDir, name, "manifest.json")))
    .map(name => {
      const manifest = readJsonFile(path.join(themesDir, name, "manifest.json")) || {};
      const label = manifest.label
        || String(name).charAt(0).toUpperCase() + String(name).slice(1);
      return { name, label };
    });
}

function loadThemeManifest(rootDir, requestedTheme) {
  const themeName = normalizeThemeName(requestedTheme);
  const requestedPath = path.join(rootDir, "themes", themeName, "manifest.json");
  const fallbackPath = path.join(rootDir, "themes", DEFAULT_THEME, "manifest.json");
  const manifestPath = fs.existsSync(requestedPath) ? requestedPath : fallbackPath;
  // Strip a leading UTF-8 BOM (\uFEFF) before parsing; Windows editors often add
  // one to JSON files, which makes JSON.parse throw "Unexpected token".
  const manifestRaw = fs.readFileSync(manifestPath, "utf-8").replace(/^\uFEFF/, "");
  const manifest = JSON.parse(manifestRaw);
  const activeTheme = fs.existsSync(requestedPath) ? themeName : DEFAULT_THEME;
  return { activeTheme, manifest };
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
  return Array.isArray(manifest.rendererStylesheets)
    ? manifest.rendererStylesheets
    : ["styles.css", "app/synapse/synapse.css", "app/mail/mail.css"];
}

function readThemeCss(rootDir, relativePath, fallback = "") {
  if (!relativePath) return fallback;
  const absolutePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) return fallback;
  return fs.readFileSync(absolutePath, "utf-8");
}

function getCanvasThemeConfig(rootDir) {
  const { manifest } = getThemeSelection(rootDir);
  const canvas = manifest.canvas || {};
  return {
    criticalGradient: canvas.criticalGradient || "linear-gradient(135deg, #0c1224 0%, #050916 100%)",
    mainInjectionPath: canvas.mainInjectionPath || "injection.css",
    iframeInjectionPathsById: canvas.iframeInjectionPathsById || {
      preview_frame: "preview_frame.css",
      tool_content: "injection.css"
    }
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
