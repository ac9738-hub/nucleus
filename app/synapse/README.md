# Synapse

An LLM workspace app for Nucleus, built to mirror the `app/canvas/` pattern.
Renders a chat-first surface with a closeable past-chat sidebar using the Nucleus
design tokens. Synapse is a renderer-only app (no `WebContentsView`), so it
behaves like Canvas's *native* mode: its own tab type, drawn into `#view`.

```
app/synapse/
  chat.js          renderer: chat templates       -> window.nucleusSynapseTemplates
  synapse.js       renderer: chat shell + controller-> window.nucleusSynapseApp
  synapse-tabs.js  renderer: tab plumbing + store  (synapseState, openSynapseAppTab, ...)
  client.js        main process: LLM wrapper        -> createSynapseClient()
  synapse.css      styles (uses :root tokens from styles.css)
  assets/synapse_icon.png
  README.md
```

## Why it wasn't showing up

Dropping the folder in registers nothing. Three places in your renderer only
know `"canvas"`, so Synapse is invisible until you add it to each:

- `renderAppsDashboard()` in `render.js` hardcodes an apps array with only Canvas.
- `renderView()` + its click handlers in `render.js` only branch on canvas tabs.
- the `engine:open-app-in-tab` listener in `app.js` only acts on `app === "canvas"`.

The good news: `main.js` already turns `nucleus://app/synapse` into an
`engine:open-app-in-tab` signal with `app: "synapse"` for free. No main.js
change is needed for *launching*; you only handle that signal in the renderer.

---

## The edits

### 1. `index.html` — load styles + the three renderer scripts

In `<head>`, after `styles.css`:

```html
<link rel="stylesheet" href="app/synapse/synapse.css">
```

Right after the two canvas `<script>` lines (and before the renderer scripts):

```html
<script src="app/synapse/chat.js"></script>
<script src="app/synapse/synapse.js"></script>
<script src="app/synapse/synapse-tabs.js"></script>
```

### 2. `render.js` — show Synapse in the Apps grid

Replace the `apps` array at the top of `renderAppsDashboard()` and make the card
template drive the open-hook + icon from the app object:

```js
function renderAppsDashboard() {
  const apps = [
    { id: "canvas-app",  name: "Canvas",  open: "data-open-canvas-app",  icon: "app/canvas/assets/canvas_icon.png",  iconClass: "canvas-app-icon" },
    { id: "synapse-app", name: "Synapse", open: "data-open-synapse-app", icon: "app/synapse/assets/synapse_icon.png", iconClass: "synapse-app-icon" }
  ];

  return `
    <header>
      <h1>Apps</h1>
      <p>${getGreeting()}. Open native apps inside your workspace.</p>
    </header>
    <section class="project-section">
      <div class="section-heading">
        <h2>Apps</h2>
        <span>${apps.length}</span>
      </div>
      <div class="app-grid">
        ${apps.map(app => `
          <article class="app-launch-card" ${app.open}="true" tabindex="0" role="button" aria-label="Open ${app.name}">
            <div class="app-icon ${app.iconClass}" aria-hidden="true">
              <img src="${app.icon}" alt="">
            </div>
            <span class="app-name">${app.name}</span>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}
```

### 3. `render.js` — render the Synapse tab + wire its buttons

Add a branch in `renderView()`, right after the canvas branch:

```js
  } else if (activeTab.type === "synapsetab") {
    view.innerHTML = window.nucleusSynapseApp
      ? window.nucleusSynapseApp.renderSynapseApp(activeTab, synapseState)
      : `<section class="workspace-panel"><div><h2>Synapse</h2><p>The Synapse app script did not load.</p></div></section>`;
```

In the same function's handler section (next to the `data-open-canvas-app` /
`data-canvas-course-id` blocks), add:

```js
  view.querySelectorAll("[data-open-synapse-app]").forEach(card => {
    const openSynapse = () => openSynapseAppTab(getBrowserWorkspaceId());
    card.addEventListener("click", () => activateAppIcon(card, openSynapse));
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activateAppIcon(card, openSynapse); }
    });
  });

  view.querySelectorAll("[data-synapse-toggle-sidebar]").forEach(button => {
    button.addEventListener("click", () => {
      const activeTab = getActiveTab();
      if (activeTab && activeTab.type === "synapsetab") {
        activeTab.synapseSidebarCollapsed = !activeTab.synapseSidebarCollapsed;
        syncTabs();
        render();
      }
    });
  });

  view.querySelectorAll("[data-synapse-new-conversation]").forEach(card => {
    const open = () => {
      const activeTab = getActiveTab();
      const convo = createSynapseConversation();
      if (activeTab && activeTab.type === "synapsetab") {
        activeTab.conversationId = convo.id;
        syncTabs();
        render();
      } else {
        openSynapseAppTab(getBrowserWorkspaceId(), convo.id);
      }
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
  });

  view.querySelectorAll(".synapse-conversation-card[data-synapse-conversation-id]").forEach(card => {
    const open = () => {
      const id = card.dataset.synapseConversationId;
      const activeTab = getActiveTab();
      if (activeTab && activeTab.type === "synapsetab") {
        activeTab.conversationId = id;
        syncTabs();
        render();
      } else {
        openSynapseAppTab(getBrowserWorkspaceId(), id);
      }
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
  });
```

Finally, mount the streaming controller. As the **last line of `renderView()`**:

```js
  mountSynapseControllerIfNeeded(view, activeTab);
```

(It always tears down the previous controller first, so leaving Synapse cleans
up the stream listener. Synapse tabs auto-create or reuse a conversation, so the
chat composer is the default surface.)

### 4. `app.js` — handle the launcher signal

Replace the existing `engine:open-app-in-tab` listener:

```js
  window.nucleus.on('engine:open-app-in-tab', payload => {
    if (!payload || !payload.tabId) return;
    if (payload.app === "canvas") {
      openCanvasAppInExistingTab(payload.tabId);
    } else if (payload.app === "synapse") {
      openSynapseAppInExistingTab(payload.tabId);
    }
  });
```

### 5. `engine.html` — launcher tile (optional, for the new-tab page)

Inside `.app-grid`, next to the Canvas tile:

```html
<a class="app-link" href="nucleus://app/synapse" aria-label="Open Synapse">
  <span class="app-icon" aria-hidden="true">
    <img src="app/synapse/assets/synapse_icon.png" alt="">
  </span>
  <span class="app-name">Synapse</span>
</a>
```

### 6. `preload.js` + `main.js` — the Claude call

`preload.js`, add to the `nucleus` bridge:

```js
synapseSend: (payload) => ipcRenderer.invoke('synapse:send', payload),
```

`main.js`, near the other requires + client setup:

```js
const { createSynapseClient } = require('./app/synapse/client')
const synapseClient = createSynapseClient({ getApiKey: () => process.env.ANTHROPIC_API_KEY })
```

`main.js`, alongside the other `ipcMain.handle(...)` calls:

```js
ipcMain.handle('synapse:send', async (event, payload) => {
  const requestId = payload && payload.requestId
  const sender = event.sender
  return synapseClient.send(payload, {
    onDelta: (delta) => sender.send('synapse:response-chunk', { requestId, delta })
  })
})
```

`ANTHROPIC_API_KEY` is already in your `.env`. Default model is
`claude-sonnet-4-6`; override per request (the picker does) or set `SYNAPSE_MODEL`.

---

## After wiring

Open the header **Apps** tab → you'll see a Synapse tile next to Canvas. Click it
→ a real chat page opens in a `synapsetab`. Past chats live in the left sidebar,
the sidebar can be closed/reopened, and messages stream in. The
`nucleus://app/synapse` engine tile (step 5) opens it from the new-tab page too.

## Notes

- **Tab type:** Synapse uses `type: "synapsetab"`, which is not a web-content tab,
  so `main.js` renders no native view and `#view` stays visible. `isWebContentTab`
  already returns false for it — no change needed there.
- **State:** `synapse-tabs.js` keeps `synapseState = { conversations: [...] }` in
  renderer memory and appends turns via the controller callbacks. Move it into
  `data-store.js` when you want persistence across restarts.
- **Routing:** `client.js` → `route()` always returns Anthropic + the requested
  model for now. Branch there later; the renderer/IPC contract won't change.
- **Mid-stream re-render caveat:** an external `render()` (e.g. a `tasks:update`
  while a reply is streaming) rebuilds `#view` and interrupts the visible stream.
  The request still completes in main; persisting the final turn across that case
  is a follow-up once `synapseState` lives in your data store.

## Renderer ⇄ main contract

- `window.nucleus.synapseSend(payload)` → `{ ok: true, text }` or `{ ok: false, error }`
  - `payload = { requestId, conversationId, model, messages: [{role, content}] }`
- `'synapse:response-chunk'` event → `{ requestId, delta }` (one per streamed chunk)
