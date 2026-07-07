const fs = require("fs");
const path = require("path");

const DEFAULT_THEME = "default";
const SETTINGS_FILE = "settings.json";

// Single source of truth for app-wide theme tokens. Every surface (app shell,
// engine, slate overlay, Canvas WebContentsViews, Canvas homepages, title bar)
// consumes these via `buildThemeVarsCss`. A theme manifest only needs to
// override the tokens it changes; anything missing falls back to these values.
// Keys are the literal CSS custom-property names (without the leading `--`).
const DEFAULT_PALETTE = {
  "bg": "#050916",
  "bg-gradient":
    "radial-gradient(circle at 18% 8%, rgba(117, 103, 216, 0.16), transparent 30%)," +
    "radial-gradient(circle at 78% 12%, rgba(90, 169, 200, 0.10), transparent 32%)," +
    "radial-gradient(circle at 52% 106%, rgba(199, 154, 84, 0.08), transparent 34%)," +
    "linear-gradient(180deg, #070b18 0%, #05070f 100%)",
  "surface": "#0c1224",
  "surface-2": "#151c34",
  "surface-3": "#232c4e",
  "surface-soft": "rgba(12, 18, 36, 0.72)",
  "border": "rgba(125, 139, 190, 0.18)",
  "border-strong": "rgba(125, 139, 190, 0.34)",
  "border-solid": "#3a4050",
  "text": "#f4f7ff",
  "text-dim": "#aeb8dc",
  "text-mute": "#6f7aa7",
  "text-on-accent": "#ffffff",
  "accent": "#7567d8",
  "accent-2": "#5aa9c8",
  "accent-3": "#55b89f",
  "accent-warm": "#c79a54",
  "accent-gradient": "linear-gradient(135deg, #7567d8, #596bc6)",
  "link": "#c8d2ff",
  "visited": "#bfa8ff",
  "scrollbar-thumb": "#343a48",
  "scrollbar-thumb-hover": "#4a5162",
  "canvas-gradient": "linear-gradient(135deg, #0c1224 0%, #050916 100%)",
  "title-bar": "#0c1224",
  "title-bar-symbol": "#f4f7ff",
  // RGB channel triplets so component styles can express any alpha via
  // rgba(var(--token-rgb), a). This is what makes deep theming app-wide.
  "accent-rgb": "117, 103, 216",
  "accent-2-rgb": "90, 169, 200",
  "accent-3-rgb": "85, 184, 159",
  "accent-warm-rgb": "199, 154, 84",
  "border-rgb": "125, 139, 190",
  "border-strong-rgb": "87, 94, 116",
  "bg-rgb": "5, 9, 22",
  "surface-rgb": "12, 18, 36",
  "surface-2-rgb": "21, 28, 52",
  "surface-3-rgb": "35, 44, 78",
  "shadow-rgb": "0, 0, 0",
  "white-rgb": "255, 255, 255"
};

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

// Merges a theme manifest's palette over DEFAULT_PALETTE so callers always get a
// complete token set. Unknown/missing themes fall back to the default palette.
function getThemePalette(rootDir) {
  const { manifest } = getThemeSelection(rootDir);
  return Object.assign({}, DEFAULT_PALETTE, manifest.palette || {});
}

function getThemeColorScheme(rootDir) {
  const { manifest } = getThemeSelection(rootDir);
  return manifest.colorScheme || "dark";
}

// Builds a `:root { ... }` CSS block from a palette + color scheme. This is the
// payload injected into every surface so a single palette drives the whole app.
function buildThemeVarsCss(palette, colorScheme) {
  const scheme = colorScheme ? `  color-scheme: ${colorScheme};\n` : "";
  const lines = Object.keys(palette || {})
    .map(key => `  --${key}: ${palette[key]};`)
    .join("\n");
  return `:root {\n${scheme}${lines}\n}`;
}

function getCanvasThemeConfig(rootDir) {
  const { manifest } = getThemeSelection(rootDir);
  const canvas = manifest.canvas || {};
  const palette = Object.assign({}, DEFAULT_PALETTE, manifest.palette || {});
  return {
    // Palette is the source of truth; manifest.canvas.criticalGradient is a
    // legacy fallback for themes that predate the palette block.
    criticalGradient: palette["canvas-gradient"]
      || canvas.criticalGradient
      || "linear-gradient(135deg, #0c1224 0%, #050916 100%)",
    mainInjectionPath: canvas.mainInjectionPath || "injection.css",
    iframeInjectionPathsById: canvas.iframeInjectionPathsById || {
      preview_frame: "preview_frame.css",
      tool_content: "injection.css"
    }
  };
}

// One consolidated object describing the active theme for every consumer
// (renderer bootstrap, IPC responses, main-process injections). varsCss is the
// ready-to-inject `:root` block so renderers never rebuild it themselves.
function getThemeRuntime(rootDir) {
  const { activeTheme, manifest } = getThemeSelection(rootDir);
  const palette = Object.assign({}, DEFAULT_PALETTE, manifest.palette || {});
  const colorScheme = manifest.colorScheme || "dark";
  return {
    name: activeTheme,
    colorScheme,
    palette,
    varsCss: buildThemeVarsCss(palette, colorScheme),
    rendererStylesheets: Array.isArray(manifest.rendererStylesheets)
      ? manifest.rendererStylesheets
      : ["styles.css", "app/synapse/synapse.css", "app/mail/mail.css"],
    canvas: getCanvasThemeConfig(rootDir)
  };
}

function buildCanvasSlateThemeCss(rootDir) {
  const { activeTheme } = getThemeSelection(rootDir);
  const palette = getThemePalette(rootDir);
  const colorScheme = getThemeColorScheme(rootDir);
  const canvas = getCanvasThemeConfig(rootDir);
  const slateCss = readThemeCss(rootDir, `themes/${activeTheme}/slate.css`, "");
  const varsCss = buildThemeVarsCss(palette, colorScheme);
  const gradient = canvas.criticalGradient
    || palette["canvas-gradient"]
    || "linear-gradient(135deg, #0c1224 0%, #050916 100%)";
  const surface = palette.surface || palette.bg || "#050916";
  const bridgeCss = `
:root {
  --slate-fill: ${gradient};
}
html, body {
  background: transparent !important;
}
.slate {
  background-color: ${surface};
  background-image: ${gradient};
}
`;
  return `${varsCss}\n${bridgeCss}\n${slateCss}`;
}

function buildCanvasCoverSlateUrl(rootDir) {
  const palette = getThemePalette(rootDir);
  const canvas = getCanvasThemeConfig(rootDir);
  const gradient = canvas.criticalGradient
    || palette["canvas-gradient"]
    || "linear-gradient(135deg, #0c1224 0%, #050916 100%)";
  const surface = palette.surface || palette.bg || "#050916";
  const css = buildCanvasSlateThemeCss(rootDir);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}
html,body{margin:0;height:100%;background:${surface};background-image:${gradient}}</style></head><body></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

module.exports = {
  getThemeSelection,
  getRendererStylesheets,
  getCanvasThemeConfig,
  getThemePalette,
  getThemeColorScheme,
  buildThemeVarsCss,
  buildCanvasSlateThemeCss,
  buildCanvasCoverSlateUrl,
  getThemeRuntime,
  readThemeCss,
  getStoredTheme,
  setStoredTheme,
  listThemes
};
