# Nucleus UI Polish — Implementation Plan

Phased rollout. **Stop and ask user after each phase** before continuing.

## Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Foundation & visual hierarchy (tokens, surfaces, typography) | **done** |
| 2 | Layout & navigation polish (header, sidebar, workspace tabs) | **done** |
| 3 | Center pane context controller | **done** |
| 4 | LUMI panel / composer polish | **done** |
| 5 | Feature module consistency (Mail, Synapse, Canvas) | **done** |
| 6 | Native view polish (crossfade, toolbar unification) | pending |

---

## Phase 5 — Feature Module Consistency

### Done (2026-06-30)
- Shared primitives in `lib/nucleus-ui.css`: `.nui-card`, `.nui-badge`, `.nui-segmented`
- Token audit: hardcoded purple/surface RGB → `var(--accent-rgb)` etc. in all `themes/*/mail.css`, `themes/*/synapse.css`, `app/mail/mail.css`, `app/synapse/synapse.css`
- `lib/feature-shell.css` — shared Mail + Synapse chrome (sidebar, compose, nav, composer)
- Context controller uses `nui-segmented` / `nui-badge` classes
- Canvas course cards use `nui-card nui-card-interactive`
- Removed compose-button `translateY` hover lifts
- Loaded via theme manifests + `index.html` (after synapse/mail CSS)

---

## Phase 1 — Foundation & Visual Hierarchy

**Goal:** Calmer shell, clearer reading order, less gradient noise.

### Done (2026-06-30)
- Semantic tokens: `--text-primary/secondary/tertiary`, `--surface-elevated/inset`, `--divider`, `--space-1`–`--space-6`
- Typography: body 14px, title 18px, base line-height 1.5
- Radius: 8 / 6 / 12 / 16px
- Softer borders and reduced bg-gradient radial opacity (~30%)
- Slower ambient drift (120s)
- Flattened: sidebar, home panels, stat cards, LUMI hero card (orbs + brand mark gradients kept)

---

## Phase 2 — Layout & Navigation Polish

### Done (2026-06-30)
- Header: lighter blur, `--divider` border, layout tokens (`--header-height`, `--titlebar-inset-end`)
- Primary tabs: pill segment control (`.primary-tabs-segment` wrapper in `index.html`)
- Sidebar: 40px workspace rows, 3px left accent on active, quieter section label
- Workspace page tabs: Chrome-style active merge, close button on hover only
- Profile footer: flat ChatGPT-style row (transparent card + inset hover)
- Heights unchanged (`--webcontent-top` still 124px) — no WebContentsView regression

---

## Phase 3 — Center Pane Context Controller

### Done (2026-06-30)
- `renderer/context-controller.js` — class scope checkboxes, soft/balanced/strict lock, stats row, tasks in progress
- `lib/context-controller.css` — styled panels, badges, segmented control (theme tokens)
- Extended `workspace-control-center.js` layout (context bar + stats + two-column grid)
- Wired to `patchWorkspaceSession` / `courseScope.primaryCourseIds` / `contextLock`
- Loaded via theme manifests + `index.html`

---

## Phase 4 — LUMI Panel

### Done (2026-06-30)
- `lib/lumi-panel.css` — flat panel, message bubbles, composer box, circular send, usage toast
- `lib/sidekick-composer.css` — compact ghost pill dropdowns
- `index.html` — composer box wrapper, usage toast, suggestion chips, send icon button
- `renderer/render.js` — send click handler, `showAiUsageToast` / `hideAiUsageToast`, `prompt:usage-warning` listener

---

## Phase 6 — Native View Polish

- Crossfade on WebContentsView ready
- Toolbar unification
- JS/CSS layout constant sync

**Files:** `main.js`, `preload.js`, `view-layout.js`

---

## Guardrails

- No React migration
- No hover translate/lift (ui-polish tests)
- Theme switch must work on shell + WebContentsViews
- One phase at a time; verify visually + run tests before next phase
