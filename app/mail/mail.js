// Native Mail app renderer.
// Gmail-style split inbox: folder sidebar, message list + reading pane, floating compose.
(function () {
  "use strict";

  const MAIL_ICONS = {
    inbox: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8l7 5 7-5v11zm-7-7L5 6h14l-7 5z"/></svg>',
    campus_events: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>',
    secondary: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>',
    starred: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>',
    sent: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',
    drafts: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
    spam: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
    compose: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>',
    archive: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/></svg>',
    delete: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
    markUnread: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0l-8 5-8-5h16zm0 12H4V8l8 5 8-5v10z"/></svg>',
    markRead: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>',
    reply: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>',
    replyAll: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 8V5l-7 7 7 7v-3l-4-4 4-4zm6 1V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>',
    forward: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 8V4l8 8-8 8v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
    attachment: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>',
    menu: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
    minimize: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 13H5v-2h14v2z"/></svg>',
    expand: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>',
    contacts: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>'
  };

  function renderIcon(name) {
    return MAIL_ICONS[name] || "";
  }

  function getMailFolders(state) {
    if (state.view && Array.isArray(state.view.folders) && state.view.folders.length) {
      return state.view.folders;
    }
    return (window.NucleusMailFolders && window.NucleusMailFolders.MAIL_FOLDERS) || [];
  }

  function folderTitle(state) {
    if (state.searchQuery) return `Search: ${state.searchQuery}`;
    const folder = getMailFolders(state).find(item => item.id === state.folder);
    return folder ? folder.label : "Inbox";
  }

  function parseSender(fromValue) {
    const raw = String(fromValue || "").trim();
    if (!raw) return "Unknown sender";
    const named = raw.match(/^(.+?)\s*<[^>]+>$/);
    if (named) return named[1].replace(/^["']|["']$/g, "").trim() || raw;
    return raw;
  }

  function formatDetailDate(message) {
    return message.dateLabel || message.date || "";
  }

  function getSelectedIds(state) {
    return Array.isArray(state.selectedIds) ? state.selectedIds : [];
  }

  function isAllSelected(state) {
    if (!state.messages.length) return false;
    const ids = getSelectedIds(state);
    return ids.length > 0 && ids.length === state.messages.length;
  }

  function isSomeSelected(state) {
    const ids = getSelectedIds(state);
    return ids.length > 0 && ids.length < state.messages.length;
  }

  function folderUnreadCount(folder, labelStats) {
    if (!labelStats || !folder.labelId) return 0;
    const stats = labelStats[folder.labelId];
    if (!stats) return 0;
    if (folder.id === "inbox" || folder.id === "secondary") return stats.messagesUnread || 0;
    return stats.messagesUnread || 0;
  }

  function renderSidebar(state) {
    const labelStats = state.view && state.view.labelStats ? state.view.labelStats : {};
    const collapsed = Boolean(state.sidebarCollapsed);

    const items = getMailFolders(state).map(folder => {
      const active = folder.id === state.folder ? " is-active" : "";
      const unread = folderUnreadCount(folder, labelStats);
      const count = unread > 0 && (folder.id === "inbox" || folder.id === "drafts" || folder.id === "spam")
        ? `<span class="mail-nav-count">${unread}</span>`
        : "";
      const iconName = folder.icon || folder.id;
      return (
        `<button type="button" class="mail-nav-item${active}" data-mail-folder="${escapeHtml(folder.id)}" title="${escapeHtml(folder.label)}">` +
        `<span class="mail-nav-icon" aria-hidden="true">${renderIcon(iconName)}</span>` +
        `<span class="mail-nav-label">${escapeHtml(folder.label)}</span>${count}</button>`
      );
    }).join("");

    const account = state.view && state.view.profile && state.view.profile.emailAddress
      ? `<p class="mail-account" title="${escapeHtml(state.view.profile.emailAddress)}">${escapeHtml(state.view.profile.emailAddress)}</p>`
      : "";

    const contactsOpen = Boolean(state.contactsPanelOpen);
    const contactsSection = state.folder === "inbox" && !state.searchQuery
      ? (
        '<div class="mail-sidebar-contacts">' +
        `<button type="button" class="mail-sidebar-contacts-toggle${contactsOpen ? " is-open" : ""}" data-mail-contacts-toggle aria-expanded="${contactsOpen}">` +
        `<span class="mail-nav-icon" aria-hidden="true">${renderIcon("contacts")}</span>` +
        '<span class="mail-nav-label">Priority contacts</span>' +
        `<span class="mail-sidebar-chevron" aria-hidden="true">${contactsOpen ? "▾" : "▸"}</span>` +
        "</button>" +
        `<div class="mail-sidebar-contacts-body${contactsOpen ? " is-open" : ""}" data-mail-sidebar-contacts>${contactsOpen ? renderContactsPanel(state, true) : ""}</div>` +
        "</div>"
      )
      : "";

    return (
      `<aside class="mail-sidebar${collapsed ? " is-collapsed" : ""}" aria-label="Mail folders">` +
      '<div class="mail-brand">' +
      `<button type="button" class="mail-menu-button" data-mail-sidebar-toggle aria-label="Toggle sidebar">${renderIcon("menu")}</button>` +
      '<span class="mail-brand-mark" aria-hidden="true"></span>' +
      `<div class="mail-brand-copy"><h2>Mail</h2>${account}</div>` +
      "</div>" +
      `<button type="button" class="mail-compose-button" data-mail-compose title="Compose new message">` +
      `<span class="mail-compose-icon" aria-hidden="true">${renderIcon("compose")}</span>` +
      '<span class="mail-compose-label">Compose</span></button>' +
      `<nav class="mail-nav">${items}</nav>` +
      contactsSection +
      "</aside>"
    );
  }

  function renderListToolbar(state) {
    const selectedIds = getSelectedIds(state);
    const hasSelection = selectedIds.length > 0;
    const allSelected = isAllSelected(state);
    const someSelected = isSomeSelected(state);
    const checkboxState = allSelected ? " checked" : "";
    const indeterminateAttr = someSelected ? ' data-mail-select-indeterminate="true"' : "";

    if (hasSelection) {
      return (
        '<div class="mail-list-toolbar is-selection-mode" data-mail-list-toolbar>' +
        `<label class="mail-select-all" title="Select all">` +
        `<input type="checkbox" data-mail-select-all${checkboxState}${indeterminateAttr} aria-label="Select all messages">` +
        `<span class="mail-selection-count">${selectedIds.length} selected</span></label>` +
        '<div class="mail-list-toolbar-actions">' +
        `<button type="button" class="mail-tool-button" data-mail-bulk-archive title="Archive">${renderIcon("archive")}</button>` +
        `<button type="button" class="mail-tool-button" data-mail-bulk-spam title="Report spam">${renderIcon("spam")}</button>` +
        `<button type="button" class="mail-tool-button" data-mail-bulk-delete title="Delete">${renderIcon("delete")}</button>` +
        `<button type="button" class="mail-tool-button" data-mail-bulk-read title="Mark as read">${renderIcon("markRead")}</button>` +
        `<button type="button" class="mail-tool-button" data-mail-bulk-unread title="Mark as unread">${renderIcon("markUnread")}</button>` +
        "</div></div>"
      );
    }

    return (
      '<div class="mail-list-toolbar" data-mail-list-toolbar>' +
      `<label class="mail-select-all" title="Select all">` +
      `<input type="checkbox" data-mail-select-all${checkboxState}${indeterminateAttr} aria-label="Select all messages"></label>` +
      '<div class="mail-list-toolbar-actions">' +
      `<button type="button" class="mail-tool-button" data-mail-refresh title="Refresh">${renderIcon("refresh")}</button>` +
      "</div></div>"
    );
  }

  function renderEventChip(event) {
    if (!event) return "";
    const label = event.dateLabel || event.date || event.type || "event";
    const typeLabel = String(event.type || "event").replace(/_/g, " ");
    return (
      `<span class="mail-event-chip mail-event-chip-${escapeHtml(event.type || "reminder")}" title="${escapeHtml(event.title || typeLabel)}">` +
      `<span class="mail-event-chip-type">${escapeHtml(typeLabel)}</span>` +
      (label ? `<span class="mail-event-chip-date">${escapeHtml(label)}</span>` : "") +
      "</span>"
    );
  }

  function renderMessageEvents(message) {
    const events = Array.isArray(message && message.events) ? message.events : [];
    if (!events.length) return "";
    return `<div class="mail-message-events">${events.map(renderEventChip).join("")}</div>`;
  }

  function renderRowEvents(message) {
    const events = Array.isArray(message && message.events) ? message.events : [];
    if (!events.length) return "";
    return `<span class="mail-row-events">${renderEventChip(events[0])}</span>`;
  }

  function renderRowHoverActions(message) {
    const inTrash = Array.isArray(message.labelIds) && message.labelIds.includes("TRASH");
    return (
      '<span class="mail-row-hover-actions">' +
      `<button type="button" class="mail-row-action" data-mail-row-archive="${escapeHtml(message.id)}" title="Archive">${renderIcon("archive")}</button>` +
      (inTrash
        ? `<button type="button" class="mail-row-action" data-mail-row-delete="${escapeHtml(message.id)}" title="Delete forever">${renderIcon("delete")}</button>`
        : `<button type="button" class="mail-row-action" data-mail-row-trash="${escapeHtml(message.id)}" title="Delete">${renderIcon("delete")}</button>`) +
      `<button type="button" class="mail-row-action" data-mail-row-read="${escapeHtml(message.id)}" title="${message.unread ? "Mark read" : "Mark unread"}">${message.unread ? renderIcon("markRead") : renderIcon("markUnread")}</button>` +
      "</span>"
    );
  }

  function renderMailRow(message, state) {
    const selected = state.selectedId && message.id === state.selectedId ? " is-selected" : "";
    const checked = getSelectedIds(state).includes(message.id) ? " is-checked" : "";
    const unread = message.unread ? " is-unread" : " is-read";
    const starred = message.starred ? " is-starred" : "";
    const attachment = message.hasAttachments
      ? `<span class="mail-row-attachment" title="${message.attachmentCount || 1} attachment(s)" aria-label="Has attachments">${renderIcon("attachment")}</span>`
      : "";
    return (
      `<article class="mail-row${unread}${starred}${selected}${checked}" data-mail-id="${escapeHtml(message.id)}" data-mail-thread="${escapeHtml(message.threadId)}" tabindex="0" role="button">` +
      `<label class="mail-row-checkbox" onclick="event.stopPropagation()"><input type="checkbox" data-mail-select="${escapeHtml(message.id)}"${checked ? " checked" : ""} aria-label="Select message"></label>` +
      `<button type="button" class="mail-row-star-button" data-mail-star="${escapeHtml(message.id)}" aria-label="${message.starred ? "Unstar" : "Star"}">${message.starred ? "★" : "☆"}</button>` +
      `<span class="mail-row-sender">${escapeHtml(message.sender || parseSender(message.from) || "Unknown")}</span>` +
      `<span class="mail-row-subject-line">` +
      `<span class="mail-row-subject">${escapeHtml(message.subject || "(no subject)")}</span>` +
      `<span class="mail-row-snippet">${escapeHtml(message.snippet || "")}</span>` +
      attachment +
      renderRowEvents(message) +
      "</span>" +
      renderRowHoverActions(message) +
      `<time class="mail-row-date">${escapeHtml(message.dateLabel || message.date || "")}</time>` +
      "</article>"
    );
  }

  function renderListPanel(state) {
    if (state.loading && !state.messages.length) {
      return (
        '<div class="mail-list-panel-inner">' +
        renderListToolbar(state) +
        '<div class="mail-list"><div class="mail-empty"><div class="mail-spinner" aria-hidden="true"></div><h3>Loading mail</h3><p>Fetching messages from Gmail...</p></div></div>' +
        "</div>"
      );
    }

    if (state.error && !state.messages.length) {
      return (
        '<div class="mail-list-panel-inner">' +
        renderListToolbar(state) +
        `<div class="mail-list"><div class="mail-error"><h3>Unable to load mail</h3><p>${escapeHtml(state.error)}</p>` +
        '<button type="button" class="mail-primary-button" data-mail-refresh>Try again</button></div></div>' +
        "</div>"
      );
    }

    if (!state.messages.length) {
      return (
        '<div class="mail-list-panel-inner">' +
        renderListToolbar(state) +
        '<div class="mail-list"><div class="mail-empty"><h3>No messages</h3><p>This folder is empty.</p></div></div>' +
        "</div>"
      );
    }

    const loadMore = state.nextPageToken
      ? `<div class="mail-load-more"><button type="button" class="mail-primary-button" data-mail-load-more ${state.loadingMore ? "disabled" : ""}>${state.loadingMore ? "Loading..." : "Load more"}</button></div>`
      : "";

    return (
      '<div class="mail-list-panel-inner">' +
      renderListToolbar(state) +
      '<div class="mail-list" data-mail-list>' +
      state.messages.map(message => renderMailRow(message, state)).join("") +
      loadMore +
      "</div></div>"
    );
  }

  function renderAttachments(message) {
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    if (!attachments.length) return "";
    const chips = attachments.map(item => (
      `<span class="mail-attachment-chip" title="${escapeHtml(item.filename)}">` +
      `${renderIcon("attachment")}<span>${escapeHtml(item.filename)}</span>` +
      (item.sizeLabel ? `<span class="mail-attachment-size">${escapeHtml(item.sizeLabel)}</span>` : "") +
      "</span>"
    )).join("");
    return `<div class="mail-attachments">${chips}</div>`;
  }

  const SAFE_MAIL_HTML_TAGS = new Set([
    "a", "abbr", "b", "blockquote", "br", "caption", "code", "col", "colgroup",
    "dd", "del", "div", "dl", "dt", "em", "h1", "h2", "h3", "h4", "h5", "h6",
    "hr", "i", "li", "ol", "p", "pre", "s", "small", "span", "strong", "sub",
    "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul"
  ]);
  const DROP_MAIL_HTML_TAGS = new Set([
    "base", "button", "embed", "form", "iframe", "input", "link", "math", "meta",
    "object", "script", "select", "slot", "style", "svg", "template", "textarea"
  ]);
  const SAFE_MAIL_GLOBAL_ATTRS = new Set(["aria-label", "dir", "lang", "title"]);
  const SAFE_MAIL_TAG_ATTRS = {
    a: new Set(["href"]),
    col: new Set(["span"]),
    td: new Set(["colspan", "rowspan"]),
    th: new Set(["colspan", "rowspan", "scope"])
  };

  function isSafeMailUrl(value, options = {}) {
    const raw = String(value || "").trim();
    if (!raw) return false;
    if (/[\u0000-\u001f\u007f]/.test(raw)) return false;
    const lowered = raw.toLowerCase();
    if (lowered.startsWith("#")) return true;
    if (options.allowMailto && lowered.startsWith("mailto:")) return true;
    try {
      const parsed = new URL(raw, "https://mail.local/");
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (_) {
      return false;
    }
  }

  function isSafeNumericAttr(value) {
    const raw = String(value || "").trim();
    return /^\d{1,4}$/.test(raw);
  }

  function sanitizeMailElementAttributes(element, tagName) {
    const tagAttrs = SAFE_MAIL_TAG_ATTRS[tagName] || new Set();
    Array.from(element.attributes || []).forEach(attribute => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (name.startsWith("on") || name === "style" || name === "srcdoc") {
        element.removeAttribute(attribute.name);
        return;
      }
      if (name === "href") {
        if (tagName === "a" && isSafeMailUrl(value, { allowMailto: true })) {
          element.setAttribute("rel", "noreferrer noopener");
          element.setAttribute("target", "_blank");
        } else {
          element.removeAttribute(attribute.name);
        }
        return;
      }
      if ((name === "colspan" || name === "rowspan" || name === "span") && !isSafeNumericAttr(value)) {
        element.removeAttribute(attribute.name);
        return;
      }
      if (!SAFE_MAIL_GLOBAL_ATTRS.has(name) && !tagAttrs.has(name)) {
        element.removeAttribute(attribute.name);
      }
    });
  }

  function sanitizeMailNode(node) {
    if (!node) return;
    if (node.nodeType === 8) {
      node.remove();
      return;
    }
    if (node.nodeType !== 1) return;

    const tagName = String(node.tagName || "").toLowerCase();
    if (DROP_MAIL_HTML_TAGS.has(tagName)) {
      node.remove();
      return;
    }

    Array.from(node.childNodes || []).forEach(sanitizeMailNode);

    if (!SAFE_MAIL_HTML_TAGS.has(tagName)) {
      const parent = node.parentNode;
      if (!parent) {
        node.remove();
        return;
      }
      while (node.firstChild) {
        parent.insertBefore(node.firstChild, node);
      }
      node.remove();
      return;
    }

    sanitizeMailElementAttributes(node, tagName);
  }

  function sanitizeMailHtml(html) {
    const raw = String(html || "");
    if (!raw) return "";
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      return escapeHtml(raw);
    }
    const template = document.createElement("template");
    template.innerHTML = raw;
    Array.from(template.content.childNodes || []).forEach(sanitizeMailNode);
    return template.innerHTML;
  }

  function renderMessageBody(message) {
    if (!message) return "";
    if (message.bodyHtml) {
      return `<div class="mail-message-body mail-message-body-html">${sanitizeMailHtml(message.bodyHtml)}</div>`;
    }
    if (message.bodyText) {
      return `<pre class="mail-message-body mail-message-body-text">${escapeHtml(message.bodyText)}</pre>`;
    }
    return `<div class="mail-message-body mail-message-body-empty">${escapeHtml(message.snippet || "No message body.")}</div>`;
  }

  function renderThreadMessage(message, state) {
    const isActive = state.selectedId === message.id;
    const sender = parseSender(message.from);
    return (
      `<article class="mail-thread-message${isActive ? " is-active" : ""}" data-mail-thread-msg="${escapeHtml(message.id)}">` +
      '<header class="mail-thread-message-header">' +
      `<button type="button" class="mail-thread-message-toggle" data-mail-thread-toggle="${escapeHtml(message.id)}">` +
      `<span class="mail-thread-sender">${escapeHtml(sender)}</span>` +
      `<span class="mail-thread-date">${escapeHtml(formatDetailDate(message))}</span>` +
      `<span class="mail-thread-chevron" aria-hidden="true">${isActive ? "▾" : "▸"}</span>` +
      "</button></header>" +
      (isActive
        ? `<div class="mail-thread-message-body">` +
          '<div class="mail-detail-meta">' +
          `<div><span class="mail-meta-label">From</span><span>${escapeHtml(message.from || "")}</span></div>` +
          `<div><span class="mail-meta-label">To</span><span>${escapeHtml(message.to || "")}</span></div>` +
          (message.cc ? `<div><span class="mail-meta-label">Cc</span><span>${escapeHtml(message.cc)}</span></div>` : "") +
          "</div>" +
          renderAttachments(message) +
          renderMessageBody(message) +
          "</div>"
        : "") +
      "</article>"
    );
  }

  function renderDetailActions(message) {
    const inTrash = Array.isArray(message.labelIds) && message.labelIds.includes("TRASH");
    const inSpam = Array.isArray(message.labelIds) && message.labelIds.includes("SPAM");
    return (
      '<div class="mail-detail-actions">' +
      `<button type="button" class="mail-tool-button" data-mail-reply title="Reply">${renderIcon("reply")}<span>Reply</span></button>` +
      `<button type="button" class="mail-tool-button" data-mail-reply-all title="Reply all">${renderIcon("replyAll")}<span>Reply all</span></button>` +
      `<button type="button" class="mail-tool-button" data-mail-forward title="Forward">${renderIcon("forward")}<span>Forward</span></button>` +
      `<button type="button" class="mail-tool-button" data-mail-star-detail="${escapeHtml(message.id)}" title="${message.starred ? "Unstar" : "Star"}">${message.starred ? "★" : "☆"}</button>` +
      `<button type="button" class="mail-tool-button" data-mail-unread-toggle title="${message.unread ? "Mark read" : "Mark unread"}">${message.unread ? renderIcon("markRead") : renderIcon("markUnread")}</button>` +
      (inTrash
        ? `<button type="button" class="mail-tool-button" data-mail-restore title="Restore">${renderIcon("archive")}<span>Restore</span></button>` +
          `<button type="button" class="mail-tool-button mail-danger-button" data-mail-delete title="Delete forever">${renderIcon("delete")}<span>Delete</span></button>`
        : inSpam
          ? `<button type="button" class="mail-tool-button" data-mail-not-spam title="Not spam">${renderIcon("inbox")}<span>Not spam</span></button>` +
            `<button type="button" class="mail-tool-button mail-danger-button" data-mail-delete title="Delete forever">${renderIcon("delete")}<span>Delete</span></button>`
          : `<button type="button" class="mail-tool-button" data-mail-archive title="Archive">${renderIcon("archive")}<span>Archive</span></button>` +
            `<button type="button" class="mail-tool-button" data-mail-spam title="Report spam">${renderIcon("spam")}<span>Spam</span></button>` +
            `<button type="button" class="mail-tool-button mail-danger-button" data-mail-trash title="Delete">${renderIcon("delete")}<span>Delete</span></button>`) +
      "</div>"
    );
  }

  function renderReadingPanel(state) {
    if (state.detailLoading && !state.selectedMessage) {
      return (
        '<div class="mail-reading-panel" data-mail-reading-panel>' +
        '<div class="mail-reading-view"><div class="mail-detail-empty"><div class="mail-spinner" aria-hidden="true"></div><h3>Loading message</h3></div></div>' +
        "</div>"
      );
    }

    if (!state.selectedId) {
      return (
        '<div class="mail-reading-panel" data-mail-reading-panel>' +
        '<div class="mail-reading-view"><div class="mail-reading-empty">' +
        `<span class="mail-reading-empty-icon" aria-hidden="true">${renderIcon("inbox")}</span>` +
        "<h3>Select a message to read</h3><p>Choose an email from the list to view it here.</p></div></div>" +
        "</div>"
      );
    }

    const message = state.selectedMessage;
    if (!message) {
      return (
        '<div class="mail-reading-panel" data-mail-reading-panel>' +
        '<div class="mail-reading-view"><div class="mail-detail-empty"><h3>Unable to open email</h3><p>This message could not be loaded.</p></div></div>' +
        "</div>"
      );
    }

    const threadMessages = Array.isArray(state.threadMessages) && state.threadMessages.length > 1
      ? state.threadMessages
      : [message];
    const threadBody = threadMessages.length > 1
      ? `<div class="mail-thread">${threadMessages.map(item => renderThreadMessage(item, state)).join("")}</div>`
      : (
        '<div class="mail-detail-single">' +
        renderAttachments(message) +
        renderMessageBody(message) +
        "</div>"
      );

    const sender = parseSender(message.from);
    return (
      '<div class="mail-reading-panel" data-mail-reading-panel>' +
      '<div class="mail-reading-view">' +
      '<header class="mail-detail-header">' +
      '<div class="mail-detail-titleblock">' +
      `<h2 class="mail-detail-subject">${escapeHtml(message.subject || "(no subject)")}</h2>` +
      '<div class="mail-detail-line1">' +
      `<span class="mail-detail-sender">${escapeHtml(sender)}</span>` +
      `<time class="mail-detail-date">${escapeHtml(formatDetailDate(message))}</time>` +
      "</div></div>" +
      renderDetailActions(message) +
      '<div class="mail-detail-meta">' +
      `<div><span class="mail-meta-label">From</span><span>${escapeHtml(message.from || "")}</span></div>` +
      `<div><span class="mail-meta-label">To</span><span>${escapeHtml(message.to || "")}</span></div>` +
      (message.cc ? `<div><span class="mail-meta-label">Cc</span><span>${escapeHtml(message.cc)}</span></div>` : "") +
      "</div></header>" +
      renderMessageEvents(message) +
      `<div class="mail-detail-body">${threadBody}</div>` +
      '<footer class="mail-detail-footer">' +
      `<button type="button" class="mail-primary-button" data-mail-reply>${renderIcon("reply")} Reply</button>` +
      `<button type="button" class="mail-tool-button" data-mail-reply-all>${renderIcon("replyAll")} Reply all</button>` +
      `<button type="button" class="mail-tool-button" data-mail-forward>${renderIcon("forward")} Forward</button>` +
      "</footer></div></div>"
    );
  }

  function renderContentPane(state) {
    const readingOpen = Boolean(state.selectedId || state.detailLoading);
    return (
      `<div class="mail-content-split${readingOpen ? " has-reading" : ""}" data-mail-content-split>` +
      `<div class="mail-list-panel" data-mail-list-panel>${renderListPanel(state)}</div>` +
      renderReadingPanel(state) +
      "</div>"
    );
  }

  function renderComposePanel(state) {
    const compose = state.compose;
    if (!compose) return "";

    const minimized = Boolean(compose.minimized);
    const title = compose.mode === "reply"
      ? "Reply"
      : compose.mode === "replyAll"
        ? "Reply all"
        : compose.mode === "forward"
          ? "Forward"
          : "New message";

    const showCcBcc = Boolean(compose.showCcBcc || compose.cc || compose.bcc);

    return (
      `<div class="mail-compose-dock${minimized ? " is-minimized" : ""}" data-mail-compose-dock>` +
      '<section class="mail-compose-panel" role="dialog" aria-label="Compose message">' +
      '<header class="mail-compose-header">' +
      `<h2>${escapeHtml(title)}</h2>` +
      '<div class="mail-compose-header-actions">' +
      `<button type="button" class="mail-compose-header-btn" data-mail-compose-minimize title="${minimized ? "Expand" : "Minimize"}">${minimized ? renderIcon("expand") : renderIcon("minimize")}</button>` +
      `<button type="button" class="mail-compose-header-btn" data-mail-compose-close title="Discard">${renderIcon("close")}</button>` +
      "</div></header>" +
      (minimized ? "" : (
        '<form class="mail-compose-form" data-mail-compose-form>' +
        `<label class="mail-compose-field"><span>To</span><input type="text" name="to" value="${escapeHtml(compose.to)}" required autocomplete="off"></label>` +
        (showCcBcc
          ? `<label class="mail-compose-field"><span>Cc</span><input type="text" name="cc" value="${escapeHtml(compose.cc)}" autocomplete="off"></label>` +
            `<label class="mail-compose-field"><span>Bcc</span><input type="text" name="bcc" value="${escapeHtml(compose.bcc)}" autocomplete="off"></label>`
          : `<button type="button" class="mail-compose-cc-toggle" data-mail-compose-cc-toggle>Cc/Bcc</button>`) +
        `<label class="mail-compose-field"><span>Subject</span><input type="text" name="subject" value="${escapeHtml(compose.subject)}" required autocomplete="off"></label>` +
        `<label class="mail-compose-field mail-compose-body-field"><span>Message</span><textarea name="body" rows="10" required>${escapeHtml(compose.body)}</textarea></label>` +
        '<div class="mail-compose-actions">' +
        `<button type="submit" class="mail-compose-send" data-mail-send-button ${state.sending ? "disabled" : ""}>${state.sending ? "Sending..." : "Send"}</button>` +
        '<button type="button" class="mail-compose-discard" data-mail-compose-close>Discard</button>' +
        "</div></form>"
      )) +
      "</section></div>"
    );
  }

  function shellClassName(state) {
    const classes = ["mail-shell"];
    if (state.loading) classes.push("is-loading");
    if (state.sidebarCollapsed) classes.push("is-sidebar-collapsed");
    if (state.selectedId || state.detailLoading) classes.push("has-reading-pane");
    if (state.compose) classes.push("has-compose");
    if (getSelectedIds(state).length) classes.push("has-selection");
    return classes.join(" ");
  }

  function renderToolbar(state) {
    const title = folderTitle(state);
    const count = state.messages.length;
    const hasSearch = Boolean(state.searchQuery);
    return (
      '<header class="mail-toolbar">' +
      '<div class="mail-toolbar-search-wrap">' +
      `<span class="mail-search-icon" aria-hidden="true">${renderIcon("search")}</span>` +
      `<input class="mail-search" type="search" placeholder="Search mail" aria-label="Search mail" data-mail-search value="${escapeHtml(state.searchQuery || "")}">` +
      (hasSearch ? '<button type="button" class="mail-search-clear" data-mail-search-clear aria-label="Clear search">×</button>' : "") +
      "</div>" +
      '<div class="mail-toolbar-meta">' +
      `<h1 data-mail-toolbar-title>${escapeHtml(title)}${count ? ` <span class="mail-toolbar-count">(${count})</span>` : ""}</h1>` +
      "</div>" +
      '<div class="mail-toolbar-actions">' +
      '<span class="mail-shortcuts-hint" title="Keyboard shortcuts: j/k navigate, r reply, a reply all, e archive, # delete, c compose, / search">?</span>' +
      "</div></header>"
    );
  }

  function renderStatus(state) {
    if (!state.statusMessage) return "";
    return `<div class="mail-status" data-mail-status role="status">${escapeHtml(state.statusMessage)}</div>`;
  }

  function getContactsData(state) {
    return state.contactsData || { contacts: {}, chats: {}, routedMessageIds: [] };
  }

  function getContactsUi(state) {
    return state.contactsUi || {};
  }

  function getContactLabel(contact, email) {
    if (contact && (contact.label || contact.name)) return contact.label || contact.name;
    return email || "Contact";
  }

  function getContactInitial(label) {
    const trimmed = String(label || "").trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
  }

  function getLatestChatEntry(entries) {
    if (!Array.isArray(entries) || !entries.length) return null;
    return entries[entries.length - 1];
  }

  function getChatPreview(entry) {
    if (!entry) return "No messages yet";
    const prefix = entry.direction === "outgoing" ? "You: " : "";
    if (entry.summaryStatus === "pending") return `${prefix}Summarizing latest email...`;
    if (entry.summary) return `${prefix}${entry.summary}`;
    return `${prefix}${entry.snippet || entry.subject || "New email"}`;
  }

  function renderChatBubble(entry) {
    const outgoing = entry.direction === "outgoing";
    const status = entry.summaryStatus || "pending";
    const body = status === "ready"
      ? (entry.summary || entry.snippet || entry.subject || (outgoing ? "Sent message" : "New email"))
      : status === "failed"
        ? (entry.summary || entry.snippet || entry.subject || "Summary unavailable.")
        : "Summarizing email...";
    let bodyClass = outgoing ? " is-outgoing" : "";
    if (!outgoing && status === "pending") bodyClass += " is-pending";
    if (!outgoing && status === "failed") bodyClass += " is-failed";

    const dateLabel = entry.dateLabel || entry.date || "";
    const messageId = escapeHtml(entry.messageId);

    return (
      `<div class="mail-chat-message${outgoing ? " is-outgoing" : ""}">` +
      `<button type="button" class="mail-chat-bubble${bodyClass}" data-mail-chat-bubble="${messageId}">` +
      `<span class="mail-chat-bubble-text">${escapeHtml(body)}</span>` +
      `<span class="mail-chat-bubble-foot">${escapeHtml(entry.subject || "(no subject)")}</span>` +
      "</button>" +
      '<div class="mail-chat-meta">' +
      (dateLabel ? `<time class="mail-chat-date">${escapeHtml(dateLabel)}</time>` : "") +
      `<button type="button" class="mail-chat-reply-button" data-mail-chat-reply="${messageId}" title="Reply" aria-label="Reply">↩</button>` +
      "</div></div>"
    );
  }

  function renderContactListItem(email, data) {
    const contact = data.contacts[email];
    const label = getContactLabel(contact, email);
    const entries = Array.isArray(data.chats[email]) ? data.chats[email] : [];
    const latest = getLatestChatEntry(entries);
    const preview = getChatPreview(latest);
    const count = entries.length;
    const badge = count ? `<span class="mail-contacts-row-count">${count}</span>` : "";

    return (
      `<button type="button" class="mail-contacts-row" data-mail-contact-row="${escapeHtml(email)}">` +
      `<span class="mail-contacts-avatar" aria-hidden="true">${escapeHtml(getContactInitial(label))}</span>` +
      '<span class="mail-contacts-row-copy">' +
      `<span class="mail-contacts-row-top"><strong>${escapeHtml(label)}</strong>${badge}</span>` +
      `<span class="mail-contacts-row-preview">${escapeHtml(preview)}</span>` +
      "</span></button>"
    );
  }

  function renderContactsListView(state, data, ui, compact) {
    const contactEmails = Object.keys(data.contacts || {});
    const addFormOpen = Boolean(ui.addContactOpen);
    const rows = contactEmails.map(email => renderContactListItem(email, data)).join("");

    return (
      `<div class="mail-contacts-list-view${compact ? " is-compact" : ""}" data-mail-contacts-list-view>` +
      (!compact ? (
        '<header class="mail-contacts-header">' +
        '<div class="mail-contacts-heading"><h3>Priority contacts</h3></div>' +
        '<div class="mail-contacts-header-actions">' +
        (addFormOpen ? "" : '<button type="button" class="mail-contacts-add-button" data-mail-contacts-add>Add</button>') +
        "</div></header>"
      ) : (
        '<div class="mail-contacts-compact-header">' +
        (addFormOpen ? "" : '<button type="button" class="mail-contacts-add-button" data-mail-contacts-add>+ Add contact</button>') +
        "</div>"
      )) +
      `<form class="mail-contacts-add-form${addFormOpen ? " is-open" : ""}" data-mail-contacts-add-form>` +
      '<input type="email" name="email" placeholder="Email" required data-mail-contacts-email-input>' +
      '<input type="text" name="name" placeholder="Name (optional)" data-mail-contacts-name-input>' +
      '<button type="submit" class="mail-contacts-add-button">Save</button>' +
      '<button type="button" class="mail-icon-button" data-mail-contacts-add-cancel>Cancel</button>' +
      "</form>" +
      (contactEmails.length
        ? `<div class="mail-contacts-list" data-mail-contacts-list>${rows}</div>`
        : '<div class="mail-contacts-empty">Add contacts to route matching senders into quick chat threads.</div>') +
      "</div>"
    );
  }

  function renderContactsThreadView(state, data, ui) {
    const activeEmail = ui.activeContactEmail;
    const contact = activeEmail ? data.contacts[activeEmail] : null;
    const label = getContactLabel(contact, activeEmail);
    const activeChat = activeEmail && data.chats[activeEmail] ? data.chats[activeEmail] : [];
    const bubbles = activeChat.length
      ? activeChat.map(entry => renderChatBubble(entry)).join("")
      : '<div class="mail-contacts-thread-empty">No routed emails yet.</div>';

    return (
      '<div class="mail-contacts-thread-view" data-mail-contacts-thread-view>' +
      '<header class="mail-contacts-thread-header">' +
      '<button type="button" class="mail-contacts-back-button" data-mail-contacts-back aria-label="Back">←</button>' +
      `<span class="mail-contacts-avatar is-thread" aria-hidden="true">${escapeHtml(getContactInitial(label))}</span>` +
      '<div class="mail-contacts-thread-title">' +
      `<strong>${escapeHtml(label)}</strong>` +
      `<span>${escapeHtml(activeEmail || "")}</span>` +
      "</div></header>" +
      `<div class="mail-contacts-thread" data-mail-contacts-thread>${bubbles}</div>` +
      '<footer class="mail-contacts-compose-bar">' +
      `<button type="button" class="mail-contacts-compose-button" data-mail-contacts-compose="${escapeHtml(activeEmail || "")}">Compose</button>` +
      "</footer></div>"
    );
  }

  function renderContactsPanel(state, compact) {
    const data = getContactsData(state);
    const ui = getContactsUi(state);
    const threadOpen = Boolean(ui.threadOpen && ui.activeContactEmail && data.contacts[ui.activeContactEmail]);

    return (
      '<section class="mail-contacts-panel" data-mail-contacts-panel>' +
      '<div class="mail-contacts-body" data-mail-contacts-body>' +
      (threadOpen ? renderContactsThreadView(state, data, ui) : renderContactsListView(state, data, ui, compact)) +
      "</div></section>"
    );
  }

  function renderChatDetailOverlay(state) {
    const ui = getContactsUi(state);
    if (!ui.chatDetailOpen && !ui.chatDetailLoading) return "";

    if (ui.chatDetailLoading) {
      return (
        '<div class="mail-chat-detail-overlay" data-mail-chat-detail-overlay>' +
        '<section class="mail-chat-detail-panel" role="dialog" aria-label="Email details">' +
        '<header class="mail-chat-detail-header"><h2>Opening email</h2><button type="button" class="mail-icon-button" data-mail-chat-detail-close>Close</button></header>' +
        '<div class="mail-chat-detail-loading">Loading full email...</div>' +
        "</section></div>"
      );
    }

    const message = ui.chatDetailMessage;
    if (!message) return "";

    const sender = parseSender(message.from);
    return (
      '<div class="mail-chat-detail-overlay" data-mail-chat-detail-overlay>' +
      '<section class="mail-chat-detail-panel" role="dialog" aria-label="Email details">' +
      '<header class="mail-chat-detail-header">' +
      `<div><h2>${escapeHtml(message.subject || "(no subject)")}</h2>` +
      `<p class="mail-chat-detail-from">${escapeHtml(sender)} · ${escapeHtml(formatDetailDate(message))}</p></div>` +
      '<button type="button" class="mail-icon-button" data-mail-chat-detail-close>Close</button>' +
      "</header>" +
      '<div class="mail-chat-detail-meta">' +
      `<div><span class="mail-meta-label">To</span><span>${escapeHtml(message.to || "")}</span></div>` +
      (message.cc ? `<div><span class="mail-meta-label">Cc</span><span>${escapeHtml(message.cc)}</span></div>` : "") +
      "</div>" +
      renderAttachments(message) +
      '<div class="mail-chat-detail-body">' + renderMessageBody(message) + "</div>" +
      "</section></div>"
    );
  }

  function renderMailApp(tab, mailState) {
    const state = mailState || {};
    return (
      `<section class="${shellClassName(state)}" data-mail-app>` +
      renderSidebar(state) +
      '<main class="mail-main">' +
      renderToolbar(state) +
      renderStatus(state) +
      '<div class="mail-content" data-mail-content>' +
      `<div class="mail-content-pane" data-mail-content-pane>${renderContentPane(state)}</div>` +
      "</div></main>" +
      '<div data-mail-compose-host>' + renderComposePanel(state) + "</div>" +
      '<div data-mail-chat-detail-host>' + renderChatDetailOverlay(state) + "</div>" +
      "</section>"
    );
  }

  function getMailRoot() {
    const view = document.getElementById("view");
    return view ? view.querySelector("[data-mail-app]") : null;
  }

  function patchMailShellState(root, state) {
    root.className = shellClassName(state);
  }

  function patchMailToolbar(root, state) {
    const title = root.querySelector("[data-mail-toolbar-title]");
    if (title) {
      const label = folderTitle(state);
      const count = state.messages.length;
      title.innerHTML = `${escapeHtml(label)}${count ? ` <span class="mail-toolbar-count">(${count})</span>` : ""}`;
    }
    const search = root.querySelector("[data-mail-search]");
    if (search && document.activeElement !== search) {
      search.value = state.searchQuery || "";
    }
    const clearBtn = root.querySelector("[data-mail-search-clear]");
    if (clearBtn) {
      clearBtn.style.display = state.searchQuery ? "" : "none";
    }
  }

  function patchMailStatus(root, state) {
    let status = root.querySelector("[data-mail-status]");
    if (!state.statusMessage) {
      if (status) status.remove();
      return;
    }
    if (!status) {
      const toolbar = root.querySelector(".mail-toolbar");
      if (!toolbar) return;
      toolbar.insertAdjacentHTML("afterend", renderStatus(state));
      return;
    }
    status.textContent = state.statusMessage;
  }

  function patchMailContent(root, state) {
    patchMailShellState(root, state);
    const host = root.querySelector("[data-mail-content-pane]");
    if (host) host.innerHTML = renderContentPane(state);
  }

  function patchMailList(root, state) {
    const panel = root.querySelector("[data-mail-list-panel]");
    if (panel) {
      panel.innerHTML = renderListPanel(state);
      return;
    }
    patchMailContent(root, state);
  }

  function patchMailReading(root, state) {
    const panel = root.querySelector("[data-mail-reading-panel]");
    if (panel) {
      panel.outerHTML = renderReadingPanel(state);
    } else {
      patchMailContent(root, state);
    }
    patchMailShellState(root, state);
  }

  function patchMailCompose(root, state) {
    const host = root.querySelector("[data-mail-compose-host]");
    if (!host) return;
    host.innerHTML = renderComposePanel(state);
  }

  function scrollMailContactsThreadToBottom(root) {
    const thread = root ? root.querySelector("[data-mail-contacts-thread]") : null;
    if (!thread) return;
    requestAnimationFrame(() => {
      thread.scrollTop = thread.scrollHeight;
    });
  }

  function patchMailContacts(root, state) {
    const sidebarBody = root.querySelector("[data-mail-sidebar-contacts]");
    if (sidebarBody) {
      sidebarBody.classList.toggle("is-open", Boolean(state.contactsPanelOpen));
      sidebarBody.innerHTML = state.contactsPanelOpen ? renderContactsPanel(state, true) : "";
    }

    const toggle = root.querySelector("[data-mail-contacts-toggle]");
    if (toggle) {
      toggle.classList.toggle("is-open", Boolean(state.contactsPanelOpen));
      toggle.setAttribute("aria-expanded", state.contactsPanelOpen ? "true" : "false");
      const chevron = toggle.querySelector(".mail-sidebar-chevron");
      if (chevron) chevron.textContent = state.contactsPanelOpen ? "▾" : "▸";
    }

    const ui = getContactsUi(state);
    if (ui.threadOpen) scrollMailContactsThreadToBottom(root);
  }

  function patchMailChatDetail(root, state) {
    const host = root.querySelector("[data-mail-chat-detail-host]");
    if (!host) return;
    host.innerHTML = renderChatDetailOverlay(state);
  }

  function patchMailSidebar(root, state) {
    const sidebar = root.querySelector(".mail-sidebar");
    if (!sidebar) return;
    sidebar.classList.toggle("is-collapsed", Boolean(state.sidebarCollapsed));
    const activeFolder = state.folder || "inbox";
    sidebar.querySelectorAll("[data-mail-folder]").forEach(button => {
      button.classList.toggle("is-active", button.dataset.mailFolder === activeFolder);
    });
    const labelStats = state.view && state.view.labelStats ? state.view.labelStats : {};
    getMailFolders(state).forEach(folder => {
      const button = sidebar.querySelector(`[data-mail-folder="${folder.id}"]`);
      if (!button) return;
      const unread = folderUnreadCount(folder, labelStats);
      let count = button.querySelector(".mail-nav-count");
      if (unread > 0 && (folder.id === "inbox" || folder.id === "drafts" || folder.id === "spam")) {
        if (!count) {
          button.insertAdjacentHTML("beforeend", `<span class="mail-nav-count">${unread}</span>`);
        } else {
          count.textContent = String(unread);
        }
      } else if (count) {
        count.remove();
      }
    });
  }

  function patchMailRow(root, message, state) {
    const row = root.querySelector(`.mail-row[data-mail-id="${message.id}"]`);
    if (!row) return;
    const replacement = renderMailRow(message, state);
    const wrap = document.createElement("div");
    wrap.innerHTML = replacement;
    const next = wrap.firstElementChild;
    if (next) row.replaceWith(next);
  }

  function patchMailListToolbar(root, state) {
    const toolbar = root.querySelector("[data-mail-list-toolbar]");
    if (!toolbar) return;
    toolbar.outerHTML = renderListToolbar(state);
    const indeterminate = root.querySelector("[data-mail-select-indeterminate]");
    const selectAll = root.querySelector("[data-mail-select-all]");
    if (selectAll && indeterminate) {
      selectAll.indeterminate = true;
    } else if (selectAll) {
      selectAll.indeterminate = false;
    }
  }

  function patchMailView(state, scope) {
    const root = getMailRoot();
    if (!root) return false;

    const patch = scope || "all";

    if (patch === "full" || patch === "all") {
      patchMailShellState(root, state);
      patchMailToolbar(root, state);
      patchMailStatus(root, state);
      patchMailContent(root, state);
      patchMailCompose(root, state);
      patchMailContacts(root, state);
      patchMailChatDetail(root, state);
      patchMailSidebar(root, state);
      return true;
    }

    if (patch === "toolbar") {
      patchMailToolbar(root, state);
      return true;
    }

    if (patch === "shell") patchMailShellState(root, state);
    if (patch === "status") patchMailStatus(root, state);
    if (patch === "list") {
      patchMailList(root, state);
      patchMailListToolbar(root, state);
    }
    if (patch === "list-toolbar") patchMailListToolbar(root, state);
    if (patch === "reading" || patch === "content") patchMailReading(root, state);
    if (patch === "compose") patchMailCompose(root, state);
    if (patch === "contacts") patchMailContacts(root, state);
    if (patch === "chat-detail") patchMailChatDetail(root, state);
    if (patch === "sidebar") patchMailSidebar(root, state);
    return true;
  }

  function handleMailClick(event) {
    if (event.target.matches("[data-mail-chat-detail-overlay]") && typeof closeMailChatDetail === "function") {
      closeMailChatDetail();
      return;
    }

    const target = event.target.closest(
      "[data-mail-folder], [data-mail-refresh], [data-mail-compose], [data-mail-contacts-toggle], [data-mail-sidebar-toggle], " +
      "[data-mail-contacts-add], [data-mail-contacts-add-cancel], [data-mail-contacts-back], [data-mail-contacts-compose], " +
      "[data-mail-contact-row], [data-mail-chat-reply], [data-mail-chat-bubble], [data-mail-chat-detail-close], " +
      "[data-mail-star], [data-mail-star-detail], [data-mail-reply], [data-mail-reply-all], [data-mail-forward], " +
      "[data-mail-archive], [data-mail-trash], [data-mail-spam], [data-mail-not-spam], [data-mail-restore], [data-mail-delete], " +
      "[data-mail-unread-toggle], [data-mail-compose-close], [data-mail-compose-minimize], [data-mail-compose-cc-toggle], " +
      "[data-mail-select-all], [data-mail-bulk-archive], [data-mail-bulk-spam], [data-mail-bulk-delete], [data-mail-bulk-read], " +
      "[data-mail-bulk-unread], [data-mail-load-more], [data-mail-search-clear], [data-mail-thread-toggle], " +
      "[data-mail-row-archive], [data-mail-row-trash], [data-mail-row-delete], [data-mail-row-read], " +
      ".mail-row[data-mail-id], .mail-shortcuts-hint"
    );
    if (!target) return;

    if (target.matches(".mail-shortcuts-hint") && typeof showMailShortcutsHelp === "function") {
      showMailShortcutsHelp();
      return;
    }

    if (target.matches("[data-mail-sidebar-toggle]") && typeof toggleMailSidebar === "function") {
      toggleMailSidebar();
      return;
    }

    if (target.matches("[data-mail-contacts-toggle]") && typeof toggleMailContactsPanel === "function") {
      toggleMailContactsPanel();
      return;
    }

    if (target.matches("[data-mail-compose-minimize]") && typeof toggleMailComposeMinimize === "function") {
      toggleMailComposeMinimize();
      return;
    }

    if (target.matches("[data-mail-compose-cc-toggle]") && typeof toggleMailComposeCcBcc === "function") {
      toggleMailComposeCcBcc();
      return;
    }

    if (target.matches("[data-mail-select-all]")) return;

    if (target.matches("[data-mail-bulk-archive]") && typeof bulkArchiveMessages === "function") {
      bulkArchiveMessages();
      return;
    }

    if (target.matches("[data-mail-bulk-spam]") && typeof bulkSpamMessages === "function") {
      bulkSpamMessages();
      return;
    }

    if (target.matches("[data-mail-bulk-delete]") && typeof bulkDeleteMessages === "function") {
      bulkDeleteMessages();
      return;
    }

    if (target.matches("[data-mail-bulk-read]") && typeof bulkMarkMessagesRead === "function") {
      bulkMarkMessagesRead(true);
      return;
    }

    if (target.matches("[data-mail-bulk-unread]") && typeof bulkMarkMessagesRead === "function") {
      bulkMarkMessagesRead(false);
      return;
    }

    if (target.matches("[data-mail-load-more]") && typeof loadMoreMailMessages === "function") {
      loadMoreMailMessages();
      return;
    }

    if (target.matches("[data-mail-search-clear]") && typeof loadMailView === "function") {
      loadMailView({ q: "", keepSelection: false });
      return;
    }

    if (target.matches("[data-mail-thread-toggle]") && typeof toggleThreadMessage === "function") {
      toggleThreadMessage(target.dataset.mailThreadToggle);
      return;
    }

    if (target.matches("[data-mail-row-archive]") && typeof archiveMessageById === "function") {
      event.preventDefault();
      event.stopPropagation();
      archiveMessageById(target.dataset.mailRowArchive);
      return;
    }

    if (target.matches("[data-mail-row-trash]") && typeof trashMessageById === "function") {
      event.preventDefault();
      event.stopPropagation();
      trashMessageById(target.dataset.mailRowTrash);
      return;
    }

    if (target.matches("[data-mail-row-delete]") && typeof deleteMessageById === "function") {
      event.preventDefault();
      event.stopPropagation();
      deleteMessageById(target.dataset.mailRowDelete);
      return;
    }

    if (target.matches("[data-mail-row-read]") && typeof toggleUnreadById === "function") {
      event.preventDefault();
      event.stopPropagation();
      toggleUnreadById(target.dataset.mailRowRead);
      return;
    }

    if (target.matches("[data-mail-contacts-add]") && typeof toggleMailContactsAddForm === "function") {
      toggleMailContactsAddForm(true);
      return;
    }

    if (target.matches("[data-mail-contacts-add-cancel]") && typeof toggleMailContactsAddForm === "function") {
      toggleMailContactsAddForm(false);
      return;
    }

    if (target.matches("[data-mail-contacts-back]") && typeof closeMailContactThread === "function") {
      closeMailContactThread();
      return;
    }

    if (target.matches("[data-mail-contacts-compose]") && typeof openMailComposeToContact === "function") {
      openMailComposeToContact(target.dataset.mailContactsCompose);
      return;
    }

    if (target.matches("[data-mail-contact-row]") && typeof setActiveMailContact === "function") {
      setActiveMailContact(target.dataset.mailContactRow);
      return;
    }

    if (target.matches("[data-mail-chat-reply]") && typeof replyToChatEntry === "function") {
      event.preventDefault();
      event.stopPropagation();
      replyToChatEntry(target.dataset.mailChatReply);
      return;
    }

    if (target.matches("[data-mail-chat-bubble]") && typeof openMailChatDetail === "function") {
      openMailChatDetail(target.dataset.mailChatBubble);
      return;
    }

    if (target.matches("[data-mail-chat-detail-close]") && typeof closeMailChatDetail === "function") {
      closeMailChatDetail();
      return;
    }

    if (target.matches("[data-mail-folder]") && typeof loadMailView === "function") {
      loadMailView({ folder: target.dataset.mailFolder, q: "", keepSelection: false });
      return;
    }

    if (target.matches("[data-mail-refresh]") && typeof refreshMailInbox === "function") {
      refreshMailInbox();
      return;
    }

    if (target.matches("[data-mail-compose]") && typeof openMailCompose === "function") {
      openMailCompose({ mode: "new" });
      return;
    }

    if (target.matches("[data-mail-star], [data-mail-star-detail]")) {
      event.preventDefault();
      event.stopPropagation();
      const id = target.dataset.mailStar || target.dataset.mailStarDetail;
      if (id && typeof toggleMailStar === "function") toggleMailStar(id);
      return;
    }

    if (target.matches("[data-mail-reply]") && typeof replyToSelectedMessage === "function") {
      replyToSelectedMessage("reply");
      return;
    }

    if (target.matches("[data-mail-reply-all]") && typeof replyToSelectedMessage === "function") {
      replyToSelectedMessage("replyAll");
      return;
    }

    if (target.matches("[data-mail-forward]") && typeof replyToSelectedMessage === "function") {
      replyToSelectedMessage("forward");
      return;
    }

    if (target.matches("[data-mail-archive]") && typeof archiveSelectedMessage === "function") {
      archiveSelectedMessage();
      return;
    }

    if (target.matches("[data-mail-spam]") && typeof spamSelectedMessage === "function") {
      spamSelectedMessage();
      return;
    }

    if (target.matches("[data-mail-not-spam]") && typeof notSpamSelectedMessage === "function") {
      notSpamSelectedMessage();
      return;
    }

    if (target.matches("[data-mail-trash]") && typeof trashSelectedMessage === "function") {
      trashSelectedMessage();
      return;
    }

    if (target.matches("[data-mail-restore]") && typeof restoreSelectedMessage === "function") {
      restoreSelectedMessage();
      return;
    }

    if (target.matches("[data-mail-delete]") && typeof deleteSelectedMessage === "function") {
      deleteSelectedMessage();
      return;
    }

    if (target.matches("[data-mail-unread-toggle]") && typeof toggleSelectedUnread === "function") {
      toggleSelectedUnread();
      return;
    }

    if (target.matches("[data-mail-compose-close]") && typeof closeMailCompose === "function") {
      closeMailCompose();
      return;
    }

    if (target.matches(".mail-row[data-mail-id]")) {
      if (event.target.closest("[data-mail-star], [data-mail-select], .mail-row-checkbox, .mail-row-hover-actions")) return;
      if (typeof openMailMessage === "function") openMailMessage(target.dataset.mailId);
    }
  }

  function handleMailChange(event) {
    const selectAll = event.target.matches("[data-mail-select-all]") ? event.target : null;
    if (selectAll && typeof toggleSelectAllMessages === "function") {
      toggleSelectAllMessages(selectAll.checked);
      return;
    }

    const rowSelect = event.target.matches("[data-mail-select]") ? event.target : null;
    if (rowSelect && typeof toggleMessageSelection === "function") {
      toggleMessageSelection(rowSelect.dataset.mailSelect, rowSelect.checked);
    }
  }

  function handleMailKeydown(event) {
    if (event.target.matches("[data-mail-search]")) return;
    if (event.target.closest("[data-mail-compose-form]")) return;
    if (event.target.matches("input, textarea, select")) return;

    const row = event.target.closest(".mail-row[data-mail-id]");
    if (row && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      if (typeof openMailMessage === "function") openMailMessage(row.dataset.mailId);
      return;
    }

    if (typeof handleMailShortcut === "function") {
      handleMailShortcut(event);
    }
  }

  function handleMailSearchKeydown(event) {
    if (!event.target.matches("[data-mail-search]")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (typeof loadMailView === "function") loadMailView({ q: "", keepSelection: false });
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (typeof loadMailView === "function") {
      loadMailView({ q: event.target.value.trim(), keepSelection: false });
    }
  }

  function handleMailContactsSubmit(event) {
    const form = event.target.closest("[data-mail-contacts-add-form]");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    if (typeof addMailContactFromForm === "function") {
      addMailContactFromForm({
        email: String(data.get("email") || "").trim(),
        name: String(data.get("name") || "").trim()
      });
    }
  }

  function handleMailComposeSubmit(event) {
    const form = event.target.closest("[data-mail-compose-form]");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    const body = String(data.get("body") || "").trim();
    const htmlBody = body.includes("<") ? body : body.replace(/\n/g, "<br>");
    const compose = (typeof mailState !== "undefined" && mailState.compose) ? mailState.compose : {};
    if (typeof sendMailCompose === "function") {
      sendMailCompose({
        to: String(data.get("to") || "").trim(),
        cc: String(data.get("cc") || "").trim(),
        bcc: String(data.get("bcc") || "").trim(),
        subject: String(data.get("subject") || "").trim(),
        body: htmlBody,
        inReplyTo: compose.inReplyTo || "",
        references: compose.references || "",
        threadId: compose.threadId || ""
      });
    }
  }

  function handleMailMouseOver(event) {
    const row = event.target.closest(".mail-row[data-mail-id]");
    if (!row || !row.dataset.mailId) return;
    if (typeof queueMailPrefetch === "function") {
      queueMailPrefetch([row.dataset.mailId]);
    }
  }

  function mountMailControllerIfNeeded(viewEl, activeTab) {
    if (!viewEl || !activeTab || activeTab.type !== "mailtab") return;

    const root = viewEl.querySelector("[data-mail-app]");
    if (!root || root.dataset.mailBound === "true") return;

    root.dataset.mailBound = "true";
    root.addEventListener("mouseover", handleMailMouseOver);
    root.addEventListener("click", handleMailClick);
    root.addEventListener("change", handleMailChange);
    root.addEventListener("keydown", handleMailKeydown);
    root.addEventListener("keydown", handleMailSearchKeydown);
    root.addEventListener("submit", handleMailContactsSubmit);
    root.addEventListener("submit", handleMailComposeSubmit);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      renderMailApp,
      mountMailControllerIfNeeded,
      patchMailView,
      patchMailRow,
      getMailRoot,
      sanitizeMailHtml
    };
  }

  if (typeof window !== "undefined") {
    window.nucleusMailApp = {
      renderMailApp,
      mountMailControllerIfNeeded,
      patchMailView,
      patchMailRow,
      getMailRoot,
      sanitizeMailHtml
    };
  }
})();
