const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  getCanvasThemeConfig,
  getRendererStylesheets,
  getThemeSelection,
  readThemeCss,
  setStoredTheme
} = require("../theme-manager");

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function withTempRoot(testFn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nucleus-theme-test-"));
  try {
    return testFn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeTheme(root, name, manifest) {
  writeFile(
    path.join(root, "themes", name, "manifest.json"),
    typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2)
  );
}

function writeDefaultTheme(root) {
  writeTheme(root, "default", {
    name: "default",
    rendererStylesheets: ["themes/default/styles.css"],
    canvas: {
      criticalGradient: "linear-gradient(#000, #111)",
      mainInjectionPath: "themes/default/injection.css",
      iframeInjectionPathsById: {
        preview_frame: "themes/default/preview_frame.css"
      }
    }
  });
  writeFile(path.join(root, "themes", "default", "styles.css"), "body { color: white; }");
  writeFile(path.join(root, "themes", "default", "injection.css"), ".canvas { color: white; }");
  writeFile(path.join(root, "themes", "default", "preview_frame.css"), ".preview { color: white; }");
}

withTempRoot(root => {
  writeDefaultTheme(root);
  writeTheme(root, "broken", "{ invalid json");
  writeFile(path.join(root, "settings.json"), JSON.stringify({ theme: "broken" }, null, 2));

  const selection = getThemeSelection(root);
  assert.strictEqual(selection.activeTheme, "default");
  assert.deepStrictEqual(getRendererStylesheets(root), ["themes/default/styles.css"]);
});

withTempRoot(root => {
  writeDefaultTheme(root);
  writeTheme(root, "broken", "{ invalid json");
  writeFile(path.join(root, "settings.json"), JSON.stringify({ theme: "default" }, null, 2));

  assert.throws(() => setStoredTheme(root, "../broken"), /Unknown or invalid theme/);
  assert.throws(() => setStoredTheme(root, "broken"), /Unknown or invalid theme/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, "settings.json"), "utf8")).theme, "default");
});

withTempRoot(root => {
  writeDefaultTheme(root);
  writeFile(path.join(root, "secret.css"), "SECRET");
  writeFile(path.join(root, "secret.txt"), "SECRET");
  writeFile(path.join(root, "themes", "default", "safe.css"), "SAFE");

  assert.strictEqual(readThemeCss(root, "themes/default/safe.css", "fallback"), "SAFE");
  assert.strictEqual(readThemeCss(root, "../secret.css", "fallback"), "fallback");
  assert.strictEqual(readThemeCss(root, "/tmp/secret.css", "fallback"), "fallback");
  assert.strictEqual(readThemeCss(root, "secret.txt", "fallback"), "fallback");
});

withTempRoot(root => {
  writeDefaultTheme(root);
  writeTheme(root, "evil", {
    name: "evil",
    rendererStylesheets: [
      "../secret.css",
      "themes/evil/styles.css",
      "themes/evil/secret.txt"
    ],
    canvas: {
      criticalGradient: "linear-gradient(#222, #333)",
      mainInjectionPath: "../secret.css",
      iframeInjectionPathsById: {
        preview_frame: "themes/evil/preview_frame.css",
        tool_content: "../secret.css"
      }
    }
  });
  writeFile(path.join(root, "themes", "evil", "styles.css"), "body { color: red; }");
  writeFile(path.join(root, "themes", "evil", "preview_frame.css"), ".preview { color: red; }");
  writeFile(path.join(root, "settings.json"), JSON.stringify({ theme: "evil" }, null, 2));

  assert.deepStrictEqual(getRendererStylesheets(root), ["themes/evil/styles.css"]);
  assert.deepStrictEqual(getCanvasThemeConfig(root), {
    criticalGradient: "linear-gradient(#222, #333)",
    mainInjectionPath: "injection.css",
    iframeInjectionPathsById: {
      preview_frame: "themes/evil/preview_frame.css"
    }
  });
});

console.log("theme-manager tests passed");
