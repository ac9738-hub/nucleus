// Native Mail app renderer.
// Functionality: Gmail-style split inbox (list + reading pane), with in-place
// DOM patches so mail actions avoid full workspace rerenders.
(function () {
  "use strict";

  const FOLDERS = [
    { id: "inbox", label: "Inbox", icon: "IN" },
    { id: "starred", label: "Starred", icon: "★" },
    { id: "sent", label: "Sent", icon: "→" },
    { id: "drafts", label: "Drafts", icon: "✎" },
    { id: "spam", label: "Spam", icon: "!" },
    { id: "trash", label: "Trash", icon: "⌫" }
  ];

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function folderTitle(state) {
    if (state.searchQuery) return `Search: ${state.searchQuery}`;
    const folder = FOLDERS.find(item => item.id === state.folder);
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

  function renderSidebar(state) {
    const labelStats = state.view && state.view.labelStats ? state.view.labelStats : {};
    const inboxUnread = labelStats.INBOX ? labelStats.INBOX.messagesUnread : 0;

    const items = FOLDERS.map(folder => {
      const active = folder.id === state.folder ? " is-active" : "";
      const count = folder.id === "inbox" && inboxUnread > 0
        ? `<span class="mail-nav-count">${inboxUnread}</span>`
        : "";
      return (
        `<button type="button" class="mail-nav-item${active}" data-mail-folder="${escapeHtml(folder.id)}">` +
        `<span class="mail-nav-icon" aria-hidden="true">${escapeHtml(folder.icon)}</span>` +
        `<span>${escapeHtml(folder.label)}</span>${count}</button>`
      );
    }).join("");

    const account = state.view && state.view.profile && state.view.profile.emailAddress
      ? `<p class="mail-account">${escapeHtml(state.view.profile.emailAddress)}</p>`
      : "";

    return (
      '<aside class="mail-sidebar" aria-label="Mail folders">' +
      '<div class="mail-brand">' +
      '<span class="mail-brand-mark" aria-hidden="true"></span>' +
      `<div><p class="mail-eyebrow">Nucleus Mail</p><h2>Gmail</h2>${account}</div>` +
      "</div>" +
      '<button type="button" class="mail-compose-button" data-mail-compose>Compose</button>' +
      `<nav class="mail-nav">${items}</nav>` +
      "</aside>"
    );
  }

  function renderMailRow(message, state) {
    const selected = state.selectedId && message.id === state.selectedId ? " is-selected" : "";
    const unread = message.unread ? " is-unread" : " is-read";
    const starred = message.starred ? " is-starred" : "";
    return (
      `<article class="mail-row${unread}${starred}${selected}" data-mail-id="${escapeHtml(message.id)}" data-mail-thread="${escapeHtml(message.threadId)}" tabindex="0" role="button">` +
      `<button type="button" class="mail-row-star-button" data-mail-star="${escapeHtml(message.id)}" aria-label="${message.starred ? "Unstar" : "Star"}">${message.starred ? "★" : "☆"}</button>` +
      `<span class="mail-row-sender">${escapeHtml(message.sender || parseSender(message.from) || "Unknown")}</span>` +
      `<span class="mail-row-subject">${escapeHtml(message.subject || "(no subject)")}</span>` +
      `<span class="mail-row-snippet">${escapeHtml(message.snippet || "")}</span>` +
      `<time class="mail-row-date">${escapeHtml(message.dateLabel || message.date || "")}</time>` +
      "</article>"
    );
  }

  function renderListPanel(state) {
    if (state.loading && !state.messages.length) {
      return '<div class="mail-list"><div class="mail-empty"><h3>Loading inbox</h3><p>Fetching messages from Gmail...</p></div></div>';
    }

    if (state.error && !state.messages.length) {
      return (
        `<div class="mail-list"><div class="mail-error"><h3>Unable to load mail</h3><p>${escapeHtml(state.error)}</p>` +
        '<button type="button" class="mail-icon-button" data-mail-refresh>Try again</button></div></div>'
      );
    }

    if (!state.messages.length) {
      return '<div class="mail-list"><div class="mail-empty"><h3>No messages</h3><p>This folder is empty.</p></div></div>';
    }

    return (
      '<div class="mail-list">' +
      '<div class="mail-list-header" aria-hidden="true"><span></span><span>From</span><span>Subject</span><span>Preview</span><span>Date</span></div>' +
      state.messages.map(message => renderMailRow(message, state)).join("") +
      "</div>"
    );
  }

  function renderMessageBody(message) {
    if (!message) return "";
    if (message.bodyHtml) {
      return `<div class="mail-message-body mail-message-body-html">${message.bodyHtml}</div>`;
    }
    if (message.bodyText) {
      return `<pre class="mail-message-body mail-message-body-text">${escapeHtml(message.bodyText)}</pre>`;
    }
    return `<div class="mail-message-body mail-message-body-empty">${escapeHtml(message.snippet || "No message body.")}</div>`;
  }

  function isReadingView(state) {
    return Boolean(state && (state.detailLoading || state.selectedId));
  }

  function renderBackButton() {
    return '<button type="button" class="mail-back-button" data-mail-back aria-label="Back to inbox">← Back</button>';
  }

  function renderDetailActions(message) {
    const inTrash = Array.isArray(message.labelIds) && message.labelIds.includes("TRASH");
    return (
      '<div class="mail-detail-actions">' +
      '<button type="button" class="mail-icon-button" data-mail-reply>Reply</button>' +
      '<button type="button" class="mail-icon-button" data-mail-forward>Forward</button>' +
      `<button type="button" class="mail-icon-button" data-mail-star-detail="${escapeHtml(message.id)}">${message.starred ? "Unstar" : "Star"}</button>` +
      `<button type="button" class="mail-icon-button" data-mail-unread-toggle>${message.unread ? "Mark read" : "Mark unread"}</button>` +
      (inTrash
        ? '<button type="button" class="mail-icon-button" data-mail-restore>Restore</button><button type="button" class="mail-icon-button mail-danger-button" data-mail-delete>Delete forever</button>'
        : '<button type="button" class="mail-icon-button" data-mail-archive>Archive</button><button type="button" class="mail-icon-button mail-danger-button" data-mail-trash>Trash</button>') +
      "</div>"
    );
  }

  function renderReadingPanel(state) {
    if (state.detailLoading) {
      return (
        '<div class="mail-reading-view">' +
        '<header class="mail-reading-header">' + renderBackButton() + "</header>" +
        '<div class="mail-reading-empty"><h3>Opening message</h3><p>Loading message content...</p></div>' +
        "</div>"
      );
    }

    if (!state.selectedMessage) {
      return (
        '<div class="mail-reading-view">' +
        '<header class="mail-reading-header">' + renderBackButton() + "</header>" +
        '<div class="mail-reading-empty"><h3>Unable to open message</h3><p>Go back and try another email.</p></div>' +
        "</div>"
      );
    }

    const message = state.selectedMessage;
    const sender = parseSender(message.from);

    return (
      '<div class="mail-reading-view">' +
      '<article class="mail-detail">' +
      '<header class="mail-detail-header">' +
      '<div class="mail-detail-top">' + renderBackButton() + renderDetailActions(message) + "</div>" +
      '<div class="mail-detail-titleblock">' +
      '<div class="mail-detail-line1">' +
      `<span class="mail-detail-sender">${escapeHtml(sender)}</span>` +
      `<time class="mail-detail-date">${escapeHtml(formatDetailDate(message))}</time>` +
      "</div>" +
      `<h2 class="mail-detail-subject">${escapeHtml(message.subject || "(no subject)")}</h2>` +
      "</div>" +
      '<div class="mail-detail-meta">' +
      `<div><span class="mail-meta-label">To</span><span>${escapeHtml(message.to || "")}</span></div>` +
      (message.cc ? `<div><span class="mail-meta-label">Cc</span><span>${escapeHtml(message.cc)}</span></div>` : "") +
      "</div></header>" +
      renderMessageBody(message) +
      "</article></div>"
    );
  }

  function renderContentPane(state) {
    if (isReadingView(state)) {
      return `<div class="mail-reading-panel" data-mail-reading-panel>${renderReadingPanel(state)}</div>`;
    }
    return `<div class="mail-list-panel" data-mail-list-panel>${renderListPanel(state)}</div>`;
  }

  function renderComposeOverlay(state) {
    const compose = state.compose;
    if (!compose) return "";

    const title = compose.mode === "reply"
      ? "Reply"
      : compose.mode === "forward"
        ? "Forward"
        : "Compose";

    return (
      '<div class="mail-compose-overlay" data-mail-compose-overlay>' +
      '<section class="mail-compose-panel" role="dialog" aria-label="Compose message">' +
      `<header class="mail-compose-header"><h2>${escapeHtml(title)}</h2><button type="button" class="mail-icon-button" data-mail-compose-close>Close</button></header>` +
      '<form class="mail-compose-form" data-mail-compose-form>' +
      `<label class="mail-compose-field"><span>To</span><input type="email" name="to" value="${escapeHtml(compose.to)}" required></label>` +
      `<label class="mail-compose-field"><span>Cc</span><input type="text" name="cc" value="${escapeHtml(compose.cc)}"></label>` +
      `<label class="mail-compose-field"><span>Bcc</span><input type="text" name="bcc" value="${escapeHtml(compose.bcc)}"></label>` +
      `<label class="mail-compose-field"><span>Subject</span><input type="text" name="subject" value="${escapeHtml(compose.subject)}" required></label>` +
      `<label class="mail-compose-field mail-compose-body-field"><span>Message</span><textarea name="body" rows="12" required>${escapeHtml(compose.body)}</textarea></label>` +
      '<div class="mail-compose-actions">' +
      `<button type="submit" class="mail-compose-button" data-mail-send-button ${state.sending ? "disabled" : ""}>${state.sending ? "Sending..." : "Send"}</button>` +
      '<button type="button" class="mail-icon-button" data-mail-compose-close>Cancel</button>' +
      "</div></form></section></div>"
    );
  }

  function shellClassName(state) {
    const classes = ["mail-shell"];
    if (state.loading) classes.push("is-loading");
    if (isReadingView(state)) classes.push("is-reading-view");
    return classes.join(" ");
  }

  function renderToolbar(state) {
    const title = folderTitle(state);
    const count = state.messages.length;
    return (
      '<header class="mail-toolbar">' +
      '<div class="mail-toolbar-copy">' +
      `<p class="mail-eyebrow">${state.searchQuery ? "Search" : "Primary"}</p>` +
      `<h1 data-mail-toolbar-title>${escapeHtml(title)}${count ? ` <span>(${count})</span>` : ""}</h1>` +
      "</div>" +
      '<div class="mail-toolbar-actions">' +
      `<input class="mail-search" type="search" placeholder="Search mail" aria-label="Search mail" data-mail-search value="${escapeHtml(state.searchQuery || "")}">` +
      '<button type="button" class="mail-icon-button" data-mail-refresh>Refresh</button>' +
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

    return (
      `<div class="mail-chat-message${outgoing ? " is-outgoing" : ""}">` +
      `<button type="button" class="mail-chat-bubble${bodyClass}" data-mail-chat-bubble="${escapeHtml(entry.messageId)}">` +
      `<span class="mail-chat-bubble-text">${escapeHtml(body)}</span>` +
      `<span class="mail-chat-bubble-foot">${escapeHtml(entry.subject || "(no subject)")} · ${escapeHtml(entry.dateLabel || entry.date || "")}</span>` +
      "</button></div>"
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
      `<span class="mail-contacts-row-email">${escapeHtml(email)}</span>` +
      `<span class="mail-contacts-row-preview">${escapeHtml(preview)}</span>` +
      "</span></button>"
    );
  }

  function renderContactsListView(state, data, ui) {
    const contactEmails = Object.keys(data.contacts || {});
    const addFormOpen = Boolean(ui.addContactOpen);
    const rows = contactEmails.map(email => renderContactListItem(email, data)).join("");

    return (
      '<div class="mail-contacts-list-view" data-mail-contacts-list-view>' +
      '<header class="mail-contacts-header">' +
      '<div class="mail-contacts-heading"><p class="mail-eyebrow">Priority chat</p><h2>Messages</h2></div>' +
      '<div class="mail-contacts-header-actions">' +
      (addFormOpen ? "" : '<button type="button" class="mail-contacts-add-button" data-mail-contacts-add>Add contact</button>') +
      "</div></header>" +
      `<form class="mail-contacts-add-form${addFormOpen ? " is-open" : ""}" data-mail-contacts-add-form>` +
      '<input type="email" name="email" placeholder="Email address" required data-mail-contacts-email-input>' +
      '<input type="text" name="name" placeholder="Name (optional)" data-mail-contacts-name-input>' +
      '<button type="submit" class="mail-contacts-add-button">Save</button>' +
      '<button type="button" class="mail-icon-button" data-mail-contacts-add-cancel>Cancel</button>' +
      "</form>" +
      (contactEmails.length
        ? `<div class="mail-contacts-list" data-mail-contacts-list>${rows}</div>`
        : '<div class="mail-contacts-empty">Add a saved contact to route matching Gmail senders into this chat box.</div>') +
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
      : '<div class="mail-contacts-thread-empty">No routed emails yet for this contact.</div>';

    return (
      '<div class="mail-contacts-thread-view" data-mail-contacts-thread-view>' +
      '<header class="mail-contacts-thread-header">' +
      '<button type="button" class="mail-contacts-back-button" data-mail-contacts-back aria-label="Back to contacts">←</button>' +
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

  function renderContactsPanel(state) {
    const data = getContactsData(state);
    const ui = getContactsUi(state);
    const threadOpen = Boolean(ui.threadOpen && ui.activeContactEmail && data.contacts[ui.activeContactEmail]);
    const panelClass = threadOpen ? " is-thread-open" : " is-list-open";

    return (
      '<section class="mail-contacts-panel' + panelClass + '" data-mail-contacts-panel>' +
      '<div class="mail-contacts-body" data-mail-contacts-body>' +
      (threadOpen ? renderContactsThreadView(state, data, ui) : renderContactsListView(state, data, ui)) +
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
      renderMessageBody(message) +
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
      renderContactsPanel(state) +
      '<div class="mail-content" data-mail-content>' +
      `<div class="mail-content-pane" data-mail-content-pane>${renderContentPane(state)}</div>` +
      "</div></main>" +
      '<div data-mail-compose-host>' + renderComposeOverlay(state) + "</div>" +
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
    if (!title) return;
    const label = folderTitle(state);
    const count = state.messages.length;
    title.innerHTML = `${escapeHtml(label)}${count ? ` <span>(${count})</span>` : ""}`;
    const search = root.querySelector("[data-mail-search]");
    if (search && document.activeElement !== search) {
      search.value = state.searchQuery || "";
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
    if (isReadingView(state)) return;
    const panel = root.querySelector("[data-mail-list-panel]");
    if (panel) {
      panel.innerHTML = renderListPanel(state);
      return;
    }
    patchMailContent(root, state);
  }

  function patchMailReading(root, state) {
    if (!isReadingView(state)) {
      patchMailContent(root, state);
      return;
    }
    const panel = root.querySelector("[data-mail-reading-panel]");
    if (panel) {
      panel.innerHTML = renderReadingPanel(state);
      patchMailShellState(root, state);
      return;
    }
    patchMailContent(root, state);
  }

  function patchMailCompose(root, state) {
    const host = root.querySelector("[data-mail-compose-host]");
    if (!host) return;
    host.innerHTML = renderComposeOverlay(state);
  }

  function scrollMailContactsThreadToBottom(root) {
    const thread = root ? root.querySelector("[data-mail-contacts-thread]") : null;
    if (!thread) return;
    requestAnimationFrame(() => {
      thread.scrollTop = thread.scrollHeight;
    });
  }

  function patchMailContacts(root, state) {
    const panel = root.querySelector("[data-mail-contacts-panel]");
    if (panel) {
      panel.outerHTML = renderContactsPanel(state);
    } else {
      const status = root.querySelector("[data-mail-status]");
      const anchor = status || root.querySelector(".mail-toolbar");
      if (anchor) {
        anchor.insertAdjacentHTML("afterend", renderContactsPanel(state));
      }
    }

    const ui = getContactsUi(state);
    if (ui.threadOpen) {
      scrollMailContactsThreadToBottom(root);
    }
  }

  function patchMailChatDetail(root, state) {
    const host = root.querySelector("[data-mail-chat-detail-host]");
    if (!host) return;
    host.innerHTML = renderChatDetailOverlay(state);
  }

  function patchMailSidebar(root, state) {
    const sidebar = root.querySelector(".mail-sidebar");
    if (!sidebar) return;
    const activeFolder = state.folder || "inbox";
    sidebar.querySelectorAll("[data-mail-folder]").forEach(button => {
      button.classList.toggle("is-active", button.dataset.mailFolder === activeFolder);
    });
    const labelStats = state.view && state.view.labelStats ? state.view.labelStats : {};
    const inboxUnread = labelStats.INBOX ? labelStats.INBOX.messagesUnread : 0;
    const inboxButton = sidebar.querySelector('[data-mail-folder="inbox"]');
    if (inboxButton) {
      let count = inboxButton.querySelector(".mail-nav-count");
      if (inboxUnread > 0) {
        if (!count) {
          inboxButton.insertAdjacentHTML("beforeend", `<span class="mail-nav-count">${inboxUnread}</span>`);
        } else {
          count.textContent = String(inboxUnread);
        }
      } else if (count) {
        count.remove();
      }
    }
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
    if (patch === "list") patchMailList(root, state);
    if (patch === "reading" || patch === "content") patchMailReading(root, state);
    if (patch === "compose") patchMailCompose(root, state);
    if (patch === "contacts") patchMailContacts(root, state);
    if (patch === "chat-detail") patchMailChatDetail(root, state);
    if (patch === "sidebar") patchMailSidebar(root, state);
    return true;
  }

  function handleMailClick(event) {
    const target = event.target.closest("[data-mail-folder], [data-mail-refresh], [data-mail-compose], [data-mail-back], [data-mail-contacts-add], [data-mail-contacts-add-cancel], [data-mail-contacts-back], [data-mail-contacts-compose], [data-mail-contact-row], [data-mail-chat-bubble], [data-mail-chat-detail-close], [data-mail-star], [data-mail-star-detail], [data-mail-reply], [data-mail-forward], [data-mail-archive], [data-mail-trash], [data-mail-restore], [data-mail-delete], [data-mail-unread-toggle], [data-mail-compose-close], .mail-row[data-mail-id]");
    if (!target) return;

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

    if (target.matches("[data-mail-chat-bubble]") && typeof openMailChatDetail === "function") {
      openMailChatDetail(target.dataset.mailChatBubble);
      return;
    }

    if (target.matches("[data-mail-chat-detail-close]") && typeof closeMailChatDetail === "function") {
      closeMailChatDetail();
      return;
    }

    if (target.matches("[data-mail-back]") && typeof closeMailMessage === "function") {
      closeMailMessage();
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

    if (target.matches("[data-mail-forward]") && typeof replyToSelectedMessage === "function") {
      replyToSelectedMessage("forward");
      return;
    }

    if (target.matches("[data-mail-archive]") && typeof archiveSelectedMessage === "function") {
      archiveSelectedMessage();
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
      if (event.target.closest("[data-mail-star]")) return;
      if (typeof openMailMessage === "function") openMailMessage(target.dataset.mailId);
    }
  }

  function handleMailKeydown(event) {
    const row = event.target.closest(".mail-row[data-mail-id]");
    if (!row) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (typeof openMailMessage === "function") openMailMessage(row.dataset.mailId);
    }
  }

  function handleMailSearchKeydown(event) {
    if (!event.target.matches("[data-mail-search]")) return;
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

  function handleMailComposeOverlayClick(event) {
    if (event.target.matches("[data-mail-compose-overlay]") && typeof closeMailCompose === "function") {
      closeMailCompose();
    }
  }

  function handleMailChatDetailOverlayClick(event) {
    if (event.target.matches("[data-mail-chat-detail-overlay]") && typeof closeMailChatDetail === "function") {
      closeMailChatDetail();
    }
  }

  function mountMailControllerIfNeeded(viewEl, activeTab) {
    if (!viewEl || !activeTab || activeTab.type !== "mailtab") return;

    const root = viewEl.querySelector("[data-mail-app]");
    if (!root || root.dataset.mailBound === "true") return;

    root.dataset.mailBound = "true";
    root.addEventListener("click", handleMailClick);
    root.addEventListener("keydown", handleMailKeydown);
    root.addEventListener("keydown", handleMailSearchKeydown);
    root.addEventListener("submit", handleMailContactsSubmit);
    root.addEventListener("submit", handleMailComposeSubmit);
    root.addEventListener("click", handleMailComposeOverlayClick);
    root.addEventListener("click", handleMailChatDetailOverlayClick);
  }

  if (typeof window !== "undefined") {
    window.nucleusMailApp = {
      renderMailApp,
      mountMailControllerIfNeeded,
      patchMailView,
      patchMailRow,
      getMailRoot
    };
  }
})();
