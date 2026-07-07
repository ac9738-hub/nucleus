// Renderer Mail tab controller.
// Functionality: owns mail UI state, loads Gmail data through IPC, and patches
// the mail DOM in place instead of rerendering the whole workspace.

var mailState = {
  loading: false,
  detailLoading: false,
  sending: false,
  error: null,
  initialized: false,
  folder: "inbox",
  searchQuery: "",
  view: null,
  messages: [],
  allMessages: [],
  selectedId: null,
  selectedMessage: null,
  selectedIds: [],
  threadMessages: [],
  nextPageToken: "",
  loadingMore: false,
  sidebarCollapsed: false,
  contactsPanelOpen: false,
  compose: null,
  statusMessage: "",
  contactsData: {
    contacts: {},
    chats: {},
    routedMessageIds: []
  },
  contactsUi: {
    activeContactEmail: null,
    threadOpen: false,
    addContactOpen: false,
    chatDetailOpen: false,
    chatDetailLoading: false,
    chatDetailMessage: null
  }
};

let mailLoadPromise = null;
let mailStatusTimer = null;
let mailContactsUnsubscribe = null;
let mailInboxDeltaUnsubscribe = null;
let mailWatchStarted = false;
const mailDetailCache = new Map();
const mailPrefetchQueued = new Set();

function getActiveMailTab() {
  const activeTab = typeof getActiveTab === "function" ? getActiveTab() : null;
  return activeTab && activeTab.type === "mailtab" ? activeTab : null;
}

function isMailTabActive() {
  const tab = getActiveMailTab();
  return Boolean(tab && state.top === "workspace" && sameTabId(state.activeTabId, tab.id));
}

function syncMailStateToTab() {
  const tab = getActiveMailTab();
  if (!tab) return;
  tab.mailFolder = mailState.folder;
  tab.mailSearch = mailState.searchQuery;
  tab.mailSelectedId = mailState.selectedId;
}

function restoreMailStateFromTab(tab) {
  if (!tab || tab.type !== "mailtab") return;
  mailState.folder = tab.mailFolder || "inbox";
  mailState.searchQuery = tab.mailSearch || "";
  mailState.selectedId = tab.mailSelectedId || null;
  mailState.selectedMessage = null;
  mailState.compose = null;
}

function updateMailUI(scope) {
  if (isMailTabActive() && window.nucleusMailApp && typeof window.nucleusMailApp.patchMailView === "function") {
    const patched = window.nucleusMailApp.patchMailView(mailState, scope || "all");
    if (patched) return;
  }
  if (typeof render === "function") render();
}

function setMailStatus(message) {
  mailState.statusMessage = String(message || "");
  updateMailUI("status");
  if (mailStatusTimer) clearTimeout(mailStatusTimer);
  if (!message) return;
  mailStatusTimer = setTimeout(() => {
    if (mailState.statusMessage === message) {
      mailState.statusMessage = "";
      updateMailUI("status");
    }
    mailStatusTimer = null;
  }, 2400);
}

function updateMessageInList(message) {
  if (!message || !message.id) return;
  const allIndex = mailState.allMessages.findIndex(item => item.id === message.id);
  if (allIndex >= 0) {
    mailState.allMessages[allIndex] = { ...mailState.allMessages[allIndex], ...message };
  }
  const index = mailState.messages.findIndex(item => item.id === message.id);
  if (index >= 0) {
    mailState.messages[index] = { ...mailState.messages[index], ...message };
  }
}

function sortMailByReceivedDate(messages) {
  const list = Array.isArray(messages) ? messages.slice() : [];
  list.sort((a, b) => {
    const left = Number(a && a.receivedAtMs) || 0;
    const right = Number(b && b.receivedAtMs) || 0;
    return right - left;
  });
  return list;
}

function removeMessageFromList(id) {
  mailState.allMessages = mailState.allMessages.filter(item => item.id !== id);
  mailState.messages = mailState.messages.filter(item => item.id !== id);
}

function getRoutedMessageIdSet() {
  const ids = mailState.contactsData && Array.isArray(mailState.contactsData.routedMessageIds)
    ? mailState.contactsData.routedMessageIds
    : [];
  return new Set(ids);
}

function applyContactRoutingToInbox() {
  const routedIds = getRoutedMessageIdSet();
  const source = Array.isArray(mailState.allMessages) ? mailState.allMessages : mailState.messages;
  let visible = source.filter(Boolean);
  if (mailState.folder === "inbox" && !mailState.searchQuery) {
    visible = visible.filter(message => message.inboxCategory === "academic");
    visible = visible.filter(message => !routedIds.has(message.id));
  } else if (mailState.folder === "campus_events" && !mailState.searchQuery) {
    visible = visible.filter(message => message.inboxCategory === "campus_events");
  } else if (mailState.folder === "secondary" && !mailState.searchQuery) {
    visible = visible.filter(message => message.inboxCategory === "non_academic");
  }
  mailState.messages = sortMailByReceivedDate(visible);
}

function ensureActiveContactSelection() {
  const contacts = mailState.contactsData && mailState.contactsData.contacts
    ? mailState.contactsData.contacts
    : {};
  const emails = Object.keys(contacts);
  if (!emails.length) {
    mailState.contactsUi.activeContactEmail = null;
    mailState.contactsUi.threadOpen = false;
    return;
  }
  if (
    mailState.contactsUi.activeContactEmail
    && !contacts[mailState.contactsUi.activeContactEmail]
  ) {
    mailState.contactsUi.activeContactEmail = null;
    mailState.contactsUi.threadOpen = false;
  }
}

async function loadMailContactsState() {
  if (!window.nucleus || typeof window.nucleus.getMailContacts !== "function") {
    return;
  }
  const result = await window.nucleus.getMailContacts();
  if (result && result.ok && result.contacts) {
    mailState.contactsData = result.contacts;
    ensureActiveContactSelection();
  }
}

async function syncMailContactsFromInbox(messages) {
  if (!window.nucleus || typeof window.nucleus.syncMailContacts !== "function") {
    return;
  }
  const result = await window.nucleus.syncMailContacts({
    messages: Array.isArray(messages) ? messages : []
  });
  if (result && result.ok && result.contacts) {
    mailState.contactsData = result.contacts;
    ensureActiveContactSelection();
    applyContactRoutingToInbox();
    updateMailUI("contacts");
    updateMailUI("list");
  }
}

function toggleMailContactsAddForm(open) {
  mailState.contactsUi.addContactOpen = open !== false;
  updateMailUI("contacts");
}

async function addMailContactFromForm(payload = {}) {
  if (!window.nucleus || typeof window.nucleus.addMailContact !== "function") {
    setMailStatus("Mail contacts bridge is not available.");
    return;
  }

  const email = String(payload.email || "").trim();
  const name = String(payload.name || "").trim();
  if (!email) {
    setMailStatus("Enter an email address for the contact.");
    return;
  }

  const result = await window.nucleus.addMailContact({ email, name });
  if (!result || !result.ok) {
    setMailStatus((result && result.error) || "Unable to add contact.");
    return;
  }

  mailState.contactsData = result.contacts;
  mailState.contactsUi.addContactOpen = false;
  mailState.contactsUi.activeContactEmail = email.toLowerCase();
  mailState.contactsUi.threadOpen = true;
  ensureActiveContactSelection();

  if (mailState.folder === "inbox" && !mailState.searchQuery && mailState.allMessages.length) {
    await syncMailContactsFromInbox(mailState.allMessages);
  } else {
    updateMailUI("contacts");
  }

  setMailStatus(`Saved contact ${email}.`);
}

function setActiveMailContact(email) {
  mailState.contactsUi.activeContactEmail = String(email || "").trim().toLowerCase() || null;
  mailState.contactsUi.threadOpen = Boolean(mailState.contactsUi.activeContactEmail);
  mailState.contactsUi.addContactOpen = false;
  updateMailUI("contacts");
}

function closeMailContactThread() {
  mailState.contactsUi.threadOpen = false;
  updateMailUI("contacts");
}

function openMailComposeToContact(email) {
  const recipient = String(email || mailState.contactsUi.activeContactEmail || "").trim().toLowerCase();
  if (!recipient) {
    setMailStatus("Select a contact before composing.");
    return;
  }
  openMailCompose({ mode: "new", to: recipient });
}

function replyToChatEntry(messageId) {
  const email = mailState.contactsUi.activeContactEmail;
  if (!email) {
    setMailStatus("Select a contact before replying.");
    return;
  }

  const chats = mailState.contactsData && mailState.contactsData.chats ? mailState.contactsData.chats : {};
  const entries = Array.isArray(chats[email]) ? chats[email] : [];
  const entry = entries.find(item => item && item.messageId === messageId) || null;

  const baseSubject = entry && entry.subject ? entry.subject : "";
  const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`.trim();

  openMailCompose({
    mode: "reply",
    to: email,
    subject: subject || "Re:",
    threadId: entry ? entry.threadId || "" : "",
    replyToId: messageId
  });
}

async function openMailChatDetail(messageId) {
  if (!messageId || !window.nucleus || typeof window.nucleus.getMailMessage !== "function") return;

  mailState.contactsUi.chatDetailOpen = true;
  mailState.contactsUi.chatDetailLoading = true;
  mailState.contactsUi.chatDetailMessage = null;
  updateMailUI("chat-detail");

  try {
    const result = await window.nucleus.getMailMessage({ id: messageId });
    if (!result || !result.ok) {
      throw new Error((result && result.error) || "Unable to open email.");
    }
    mailState.contactsUi.chatDetailMessage = result.message;
  } catch (error) {
    setMailStatus(error && error.message ? error.message : String(error));
    mailState.contactsUi.chatDetailOpen = false;
    mailState.contactsUi.chatDetailMessage = null;
  } finally {
    mailState.contactsUi.chatDetailLoading = false;
    updateMailUI("chat-detail");
  }
}

function closeMailChatDetail() {
  mailState.contactsUi.chatDetailOpen = false;
  mailState.contactsUi.chatDetailLoading = false;
  mailState.contactsUi.chatDetailMessage = null;
  updateMailUI("chat-detail");
}

function bindMailContactsUpdates() {
  if (mailContactsUnsubscribe || !window.nucleus || typeof window.nucleus.on !== "function") {
    return;
  }
  mailContactsUnsubscribe = window.nucleus.on("mail:contacts_updated", payload => {
    if (!isMailTabActive() || !payload || !payload.contacts) return;
    mailState.contactsData = payload.contacts;
    ensureActiveContactSelection();
    applyContactRoutingToInbox();
    updateMailUI("contacts");
    updateMailUI("list");
  });
}

function isPrimaryInboxMessage(message) {
  return Boolean(message && message.inboxCategory === "academic");
}

function isCampusEventsMessage(message) {
  return Boolean(message && message.inboxCategory === "campus_events");
}

function isSecondaryInboxMessage(message) {
  return Boolean(message && message.inboxCategory === "non_academic");
}

function messageMatchesMailFolder(message, folder, searchQuery) {
  if (searchQuery) return true;
  if (folder === "campus_events") return isCampusEventsMessage(message);
  if (folder === "secondary") return isSecondaryInboxMessage(message);
  if (folder === "inbox") return isPrimaryInboxMessage(message);
  return false;
}

function bindMailInboxDelta() {
  if (mailInboxDeltaUnsubscribe || !window.nucleus || typeof window.nucleus.on !== "function") {
    return;
  }
  mailInboxDeltaUnsubscribe = window.nucleus.on("mail:inbox_delta", payload => {
    handleInboxDelta(payload).catch(error => {
      console.warn("Mail inbox delta failed:", error);
    });
  });
}

async function ensureMailWatchStarted() {
  if (mailWatchStarted || !window.nucleus || typeof window.nucleus.startMailWatch !== "function") {
    return;
  }
  mailWatchStarted = true;
  try {
    const result = await window.nucleus.startMailWatch({ intervalMs: 15000 });
    if (!result || !result.ok) {
      mailWatchStarted = false;
      console.warn(
        "Mail watch did not start:",
        result && result.error ? result.error : "unknown error"
      );
    }
  } catch (error) {
    mailWatchStarted = false;
    console.warn("Unable to start mail watch:", error);
  }
}

async function syncMailWatchLifecycle() {
  if (isMailTabActive()) {
    await ensureMailWatchStarted();
    return;
  }
  if (!mailWatchStarted || !window.nucleus || typeof window.nucleus.stopMailWatch !== "function") {
    return;
  }
  try {
    await window.nucleus.stopMailWatch();
  } catch (error) {
    console.warn("Unable to stop mail watch:", error);
  }
  mailWatchStarted = false;
}

async function handleInboxDelta(delta) {
  if (!delta) return;
  const active = isMailTabActive();

  // historyId aged out of Gmail's window: resync from scratch.
  if (delta.reset) {
    if (active && (mailState.folder === "inbox" || mailState.folder === "secondary" || mailState.folder === "campus_events") && !mailState.searchQuery) {
      refreshMailInbox();
    } else {
      mailState.initialized = false;
    }
    return;
  }

  let changed = false;

  if (delta.labelStats && mailState.view) {
    mailState.view.labelStats = delta.labelStats;
    changed = true;
  }

  const onInboxView = (mailState.folder === "inbox" || mailState.folder === "secondary" || mailState.folder === "campus_events") && !mailState.searchQuery;
  let freshMessages = [];

  const added = Array.isArray(delta.added) ? delta.added : [];
  if (added.length) {
    const existing = new Set(mailState.allMessages.map(item => item.id));
    freshMessages = added.filter(item => item && item.id && !existing.has(item.id));
    if (freshMessages.length) {
      mailState.allMessages = sortMailByReceivedDate(freshMessages.concat(mailState.allMessages));
      changed = true;
    }
  }

  const removedIds = Array.isArray(delta.removedIds) ? delta.removedIds : [];
  if (removedIds.length) {
    const removeSet = new Set(removedIds);
    const before = mailState.allMessages.length;
    mailState.allMessages = mailState.allMessages.filter(item => !removeSet.has(item.id));
    mailState.allMessages = sortMailByReceivedDate(mailState.allMessages);
    if (mailState.allMessages.length !== before) changed = true;
    if (mailState.selectedId && removeSet.has(mailState.selectedId)) {
      mailState.selectedId = null;
      mailState.selectedMessage = null;
      if (active) updateMailUI("reading");
    }
  }

  const primaryFresh = freshMessages.filter(isPrimaryInboxMessage);
  if (primaryFresh.length) {
    await syncMailContactsFromInbox(primaryFresh);
  }

  if (changed && onInboxView) {
    applyContactRoutingToInbox();
  }

  if (changed) {
    syncMailStateToTab();
    if (active) {
      updateMailUI("list");
      updateMailUI("sidebar");
    }
  }

  if (active && onInboxView && freshMessages.length) {
    const routedIds = getRoutedMessageIdSet();
    const visibleFresh = freshMessages.filter(message => {
      if (!messageMatchesMailFolder(message, mailState.folder, mailState.searchQuery)) return false;
      if (mailState.folder === "inbox" && routedIds.has(message.id)) return false;
      return true;
    });
    if (visibleFresh.length) {
      const count = visibleFresh.length;
      setMailStatus(count === 1 ? "1 new message" : `${count} new messages`);
    }
  }
}

function buildMailPreviewFromList(id) {
  const summary = mailState.messages.find(item => item.id === id)
    || mailState.allMessages.find(item => item.id === id);
  if (!summary) return null;
  return {
    ...summary,
    bodyHtml: summary.bodyHtml || `<p>${escapeMailPreviewText(summary.snippet || "")}</p>`,
    bodyText: summary.bodyText || String(summary.snippet || ""),
    attachments: Array.isArray(summary.attachments) ? summary.attachments : [],
    preview: true
  };
}

function escapeMailPreviewText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rememberMailDetail(message) {
  if (!message || !message.id) return;
  mailDetailCache.set(message.id, message);
}

function queueMailPrefetch(ids = []) {
  if (!window.nucleus || typeof window.nucleus.prefetchMailMessages !== "function") return;
  const unique = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))]
    .filter(id => !mailDetailCache.has(id) && !mailPrefetchQueued.has(id));
  if (!unique.length) return;
  unique.forEach(id => mailPrefetchQueued.add(id));
  void window.nucleus.prefetchMailMessages({ ids: unique, limit: 24 }).finally(() => {
    unique.forEach(id => mailPrefetchQueued.delete(id));
  });
}

function prefetchVisibleMailMessages() {
  queueMailPrefetch(mailState.messages.slice(0, 20).map(item => item.id));
}

async function markMailMessageRead(id) {
  if (!id || !window.nucleus || typeof window.nucleus.modifyMail !== "function") return;
  const modified = await window.nucleus.modifyMail({ id, remove: ["UNREAD"] });
  if (!modified || !modified.ok || !modified.message) return;
  updateMessageInList(modified.message);
  if (mailState.selectedMessage && mailState.selectedMessage.id === id) {
    mailState.selectedMessage = { ...mailState.selectedMessage, unread: false };
  }
  if (Array.isArray(mailState.threadMessages)) {
    mailState.threadMessages = mailState.threadMessages.map(item =>
      item.id === id ? { ...item, unread: false } : item
    );
  }
  const root = window.nucleusMailApp && window.nucleusMailApp.getMailRoot
    ? window.nucleusMailApp.getMailRoot()
    : null;
  if (root && window.nucleusMailApp.patchMailRow) {
    window.nucleusMailApp.patchMailRow(root, modified.message, mailState);
  }
}

async function loadMailThreadInBackground(threadId, selectedId) {
  if (!threadId || !window.nucleus || typeof window.nucleus.getMailThread !== "function") return;
  try {
    const threadResult = await window.nucleus.getMailThread({ threadId });
    if (!threadResult || !threadResult.ok || !threadResult.thread || !Array.isArray(threadResult.thread.messages)) {
      return;
    }
    if (mailState.selectedId !== selectedId) return;
    mailState.threadMessages = threadResult.thread.messages;
    threadResult.thread.messages.forEach(rememberMailDetail);
    syncMailStateToTab();
    updateMailUI("content");
  } catch (_) {}
}

async function ensureMailAuthReady() {
  if (!window.nucleus || typeof window.nucleus.ensureMailAuth !== "function") {
    throw new Error("Mail bridge is not available.");
  }
  const auth = await window.nucleus.ensureMailAuth();
  if (!auth || !auth.ok) {
    throw new Error((auth && auth.error) || "Gmail authentication failed.");
  }
}

async function loadMailView(options = {}) {
  if (!window.nucleus || typeof window.nucleus.getMailView !== "function") {
    mailState.error = "Mail bridge is not available.";
    mailState.initialized = true;
    updateMailUI("list");
    return;
  }

  const folder = options.folder != null ? options.folder : mailState.folder;
  const q = options.q != null ? options.q : mailState.searchQuery;
  const keepSelection = Boolean(options.keepSelection);

  mailState.loading = true;
  mailState.error = null;
  mailState.folder = folder;
  mailState.searchQuery = q;
  if (!options.pageToken) {
    mailState.nextPageToken = "";
  }
  if (!keepSelection) {
    mailState.selectedId = null;
    mailState.selectedMessage = null;
    mailState.threadMessages = [];
    mailState.selectedIds = [];
  }
  syncMailStateToTab();
  updateMailUI("full");

  try {
    await ensureMailAuthReady();
    bindMailContactsUpdates();
    bindMailInboxDelta();
    ensureMailWatchStarted();
    await loadMailContactsState();
    const result = await window.nucleus.getMailView({ folder, q, pageToken: options.pageToken || "" });
    if (!result || !result.ok) {
      throw new Error((result && result.error) || "Unable to load mail.");
    }

    mailState.view = result.view;
    mailState.nextPageToken = result.view && result.view.nextPageToken ? result.view.nextPageToken : "";
    mailState.allMessages = sortMailByReceivedDate(
      result.view && Array.isArray(result.view.messages) ? result.view.messages : []
    );
    mailState.messages = mailState.allMessages.slice();

    if ((folder === "inbox" || folder === "secondary" || folder === "campus_events") && !q) {
      await syncMailContactsFromInbox(mailState.allMessages);
    } else {
      applyContactRoutingToInbox();
    }
    if (keepSelection && mailState.selectedId) {
      const stillExists = mailState.messages.some(item => item.id === mailState.selectedId);
      if (!stillExists) {
        mailState.selectedId = null;
        mailState.selectedMessage = null;
      }
    }
    mailState.error = null;
  } catch (error) {
    mailState.error = error && error.message ? error.message : String(error);
    mailState.view = null;
    mailState.allMessages = [];
    mailState.messages = [];
  } finally {
    mailState.loading = false;
    mailState.initialized = true;
    syncMailStateToTab();
    updateMailUI("full");
    prefetchVisibleMailMessages();
  }
}

async function ensureMailLoaded(force = false) {
  if (!force && mailState.initialized && mailState.view) {
    return;
  }
  if (mailLoadPromise && !force) {
    return mailLoadPromise;
  }

  mailLoadPromise = loadMailView({ keepSelection: !force }).finally(() => {
    mailLoadPromise = null;
  });
  return mailLoadPromise;
}

async function openMailMessage(id) {
  if (!id || !window.nucleus || typeof window.nucleus.getMailMessage !== "function") return;

  mailState.selectedId = id;
  mailState.compose = null;

  const cached = mailDetailCache.get(id) || buildMailPreviewFromList(id);
  if (cached) {
    mailState.selectedMessage = cached;
    mailState.detailLoading = !cached.bodyHtml && !cached.bodyText;
    mailState.threadMessages = cached.threadId ? [cached] : [];
    syncMailStateToTab();
    updateMailUI("content");
  } else {
    mailState.selectedMessage = null;
    mailState.detailLoading = true;
    mailState.threadMessages = [];
    syncMailStateToTab();
    updateMailUI("content");
  }

  try {
    const result = await window.nucleus.getMailMessage({ id });
    if (!result || !result.ok) {
      throw new Error((result && result.error) || "Unable to open message.");
    }

    rememberMailDetail(result.message);
    mailState.selectedMessage = result.message;
    mailState.detailLoading = false;

    if (result.message && result.message.threadId) {
      void loadMailThreadInBackground(result.message.threadId, id);
    }

    syncMailStateToTab();
    updateMailUI("content");

    if (result.message && result.message.unread) {
      void markMailMessageRead(id);
    }
  } catch (error) {
    if (!mailState.selectedMessage) {
      setMailStatus(error && error.message ? error.message : String(error));
      mailState.selectedId = null;
      mailState.selectedMessage = null;
      mailState.threadMessages = [];
    } else {
      setMailStatus(error && error.message ? error.message : String(error));
    }
  } finally {
    mailState.detailLoading = false;
    syncMailStateToTab();
    updateMailUI("content");
  }
}

function closeMailMessage() {
  mailState.selectedId = null;
  mailState.selectedMessage = null;
  mailState.threadMessages = [];
  syncMailStateToTab();
  updateMailUI("content");
}

function openMailCompose(options = {}) {
  mailState.compose = {
    mode: options.mode || "new",
    to: options.to || "",
    cc: options.cc || "",
    bcc: options.bcc || "",
    subject: options.subject || "",
    body: options.body || "",
    inReplyTo: options.inReplyTo || "",
    references: options.references || "",
    threadId: options.threadId || "",
    replyToId: options.replyToId || "",
    minimized: false,
    showCcBcc: Boolean(options.cc || options.bcc)
  };
  updateMailUI("compose");
}

function closeMailCompose() {
  mailState.compose = null;
  mailState.sending = false;
  updateMailUI("compose");
}

function toggleMailComposeMinimize() {
  if (!mailState.compose) return;
  mailState.compose.minimized = !mailState.compose.minimized;
  updateMailUI("compose");
}

function toggleMailComposeCcBcc() {
  if (!mailState.compose) return;
  mailState.compose.showCcBcc = true;
  updateMailUI("compose");
}

function toggleMailSidebar() {
  mailState.sidebarCollapsed = !mailState.sidebarCollapsed;
  updateMailUI("sidebar");
  updateMailUI("shell");
}

function toggleMailContactsPanel() {
  mailState.contactsPanelOpen = !mailState.contactsPanelOpen;
  updateMailUI("contacts");
  updateMailUI("sidebar");
}

function parseAddressList(value) {
  return String(value || "")
    .split(",")
    .map(item => extractMailAddress(item.trim()))
    .filter(Boolean);
}

function buildReplyAllRecipients(message) {
  const selfEmail = mailState.view && mailState.view.profile
    ? String(mailState.view.profile.emailAddress || "").toLowerCase()
    : "";
  const recipients = new Set();
  parseAddressList(message.from).forEach(addr => recipients.add(addr.toLowerCase()));
  parseAddressList(message.to).forEach(addr => recipients.add(addr.toLowerCase()));
  parseAddressList(message.cc).forEach(addr => recipients.add(addr.toLowerCase()));
  if (selfEmail) recipients.delete(selfEmail);
  return [...recipients].join(", ");
}

function replyToSelectedMessage(mode = "reply") {
  const message = mailState.selectedMessage;
  if (!message) return;

  const subject = /^re:/i.test(message.subject || "")
    ? message.subject
    : `Re: ${message.subject || ""}`;
  const plainBody = message.bodyText || message.snippet || "";

  if (mode === "forward") {
    openMailCompose({
      mode: "forward",
      subject: /^fwd:/i.test(message.subject || "") ? message.subject : `Fwd: ${message.subject || ""}`,
      body: `\n\n---------- Forwarded message ----------\nFrom: ${message.from || ""}\nDate: ${message.date || ""}\nSubject: ${message.subject || ""}\n\n${plainBody}`
    });
    return;
  }

  if (mode === "replyAll") {
    openMailCompose({
      mode: "replyAll",
      to: buildReplyAllRecipients(message),
      cc: "",
      subject,
      body: `\n\nOn ${message.date || ""}, ${message.from || ""} wrote:\n${plainBody}`,
      inReplyTo: message.messageId || "",
      references: message.references ? `${message.references} ${message.messageId || ""}`.trim() : (message.messageId || ""),
      threadId: message.threadId || "",
      replyToId: message.id,
      showCcBcc: true
    });
    return;
  }

  openMailCompose({
    mode: "reply",
    to: extractMailAddress(message.from),
    subject,
    body: `\n\nOn ${message.date || ""}, ${message.from || ""} wrote:\n${plainBody}`,
    inReplyTo: message.messageId || "",
    references: message.references ? `${message.references} ${message.messageId || ""}`.trim() : (message.messageId || ""),
    threadId: message.threadId || "",
    replyToId: message.id
  });
}

function extractMailAddress(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/<([^>]+)>/);
  return match ? match[1] : raw;
}

async function sendMailCompose(formData) {
  if (!window.nucleus || typeof window.nucleus.sendMail !== "function") return;

  mailState.sending = true;
  updateMailUI("compose");

  try {
    const result = await window.nucleus.sendMail({
      to: formData.to,
      cc: formData.cc,
      bcc: formData.bcc,
      subject: formData.subject,
      body: formData.body,
      inReplyTo: formData.inReplyTo,
      references: formData.references,
      threadId: formData.threadId
    });

    if (!result || !result.ok) {
      throw new Error((result && result.error) || "Unable to send message.");
    }

    mailState.compose = null;
    mailState.sending = false;
    updateMailUI("compose");
    setMailStatus("Message sent.");

    if (result.contacts) {
      mailState.contactsData = result.contacts;
      ensureActiveContactSelection();
      updateMailUI("contacts");
    }

    if (mailState.folder === "sent") {
      await loadMailView({ folder: mailState.folder, q: mailState.searchQuery, keepSelection: false });
    }
  } catch (error) {
    mailState.sending = false;
    updateMailUI("compose");
    setMailStatus(error && error.message ? error.message : String(error));
  }
}

async function toggleMailStar(id) {
  const message = mailState.messages.find(item => item.id === id)
    || (mailState.selectedMessage && mailState.selectedMessage.id === id ? mailState.selectedMessage : null);
  if (!message || !window.nucleus || typeof window.nucleus.modifyMail !== "function") return;

  const changes = message.starred ? { remove: ["STARRED"] } : { add: ["STARRED"] };
  const result = await window.nucleus.modifyMail({ id, ...changes });
  if (!result || !result.ok) {
    setMailStatus((result && result.error) || "Unable to update star.");
    return;
  }

  updateMessageInList(result.message);
  if (mailState.selectedMessage && mailState.selectedMessage.id === id) {
    mailState.selectedMessage = { ...mailState.selectedMessage, starred: result.message.starred };
    updateMailUI("reading");
  }

  const root = window.nucleusMailApp && window.nucleusMailApp.getMailRoot
    ? window.nucleusMailApp.getMailRoot()
    : null;
  if (root && window.nucleusMailApp.patchMailRow) {
    window.nucleusMailApp.patchMailRow(root, result.message, mailState);
  }
}

async function archiveSelectedMessage() {
  const id = mailState.selectedId;
  if (!id || !window.nucleus || typeof window.nucleus.modifyMail !== "function") return;

  const result = await window.nucleus.modifyMail({ id, remove: ["INBOX"] });
  if (!result || !result.ok) {
    setMailStatus((result && result.error) || "Unable to archive message.");
    return;
  }

  removeMessageFromList(id);
  closeMailMessage();
  updateMailUI("list");
  setMailStatus("Message archived.");
}

async function trashSelectedMessage() {
  const id = mailState.selectedId;
  if (!id || !window.nucleus || typeof window.nucleus.trashMail !== "function") return;

  const result = await window.nucleus.trashMail({ id });
  if (!result || !result.ok) {
    setMailStatus((result && result.error) || "Unable to move message to trash.");
    return;
  }

  removeMessageFromList(id);
  closeMailMessage();
  updateMailUI("list");
  setMailStatus("Message moved to trash.");
}

async function restoreSelectedMessage() {
  const id = mailState.selectedId;
  if (!id || !window.nucleus || typeof window.nucleus.untrashMail !== "function") return;

  const result = await window.nucleus.untrashMail({ id });
  if (!result || !result.ok) {
    setMailStatus((result && result.error) || "Unable to restore message.");
    return;
  }

  removeMessageFromList(id);
  closeMailMessage();
  updateMailUI("list");
  setMailStatus("Message restored.");
}

async function deleteSelectedMessage() {
  const id = mailState.selectedId;
  if (!id || !window.nucleus || typeof window.nucleus.deleteMail !== "function") return;

  const result = await window.nucleus.deleteMail({ id });
  if (!result || !result.ok) {
    setMailStatus((result && result.error) || "Unable to delete message.");
    return;
  }

  removeMessageFromList(id);
  closeMailMessage();
  updateMailUI("list");
  setMailStatus("Message deleted.");
}

async function toggleSelectedUnread() {
  const message = mailState.selectedMessage;
  if (!message || !window.nucleus || typeof window.nucleus.modifyMail !== "function") return;

  const changes = message.unread ? { remove: ["UNREAD"] } : { add: ["UNREAD"] };
  const result = await window.nucleus.modifyMail({ id: message.id, ...changes });
  if (!result || !result.ok) {
    setMailStatus((result && result.error) || "Unable to update read state.");
    return;
  }

  updateMessageInList(result.message);
  mailState.selectedMessage = { ...mailState.selectedMessage, unread: result.message.unread };
  updateMailUI("reading");

  const root = window.nucleusMailApp && window.nucleusMailApp.getMailRoot
    ? window.nucleusMailApp.getMailRoot()
    : null;
  if (root && window.nucleusMailApp.patchMailRow) {
    window.nucleusMailApp.patchMailRow(root, result.message, mailState);
  }
}

async function refreshMailInbox() {
  const selectedId = mailState.selectedId;
  await loadMailView({
    folder: mailState.folder,
    q: mailState.searchQuery,
    keepSelection: Boolean(selectedId)
  });
  if (selectedId) {
    await openMailMessage(selectedId);
  }
}

function toggleMessageSelection(id, checked) {
  const set = new Set(mailState.selectedIds || []);
  if (checked) set.add(id);
  else set.delete(id);
  mailState.selectedIds = [...set];
  updateMailUI("list");
  updateMailUI("list-toolbar");
}

function toggleSelectAllMessages(checked) {
  mailState.selectedIds = checked ? mailState.messages.map(item => item.id) : [];
  updateMailUI("list");
  updateMailUI("list-toolbar");
}

function clearMessageSelection() {
  mailState.selectedIds = [];
  updateMailUI("list");
  updateMailUI("list-toolbar");
}

async function modifyMessagesBulk(ids, changes) {
  if (!window.nucleus || typeof window.nucleus.modifyMail !== "function") return [];
  const results = [];
  for (const id of ids) {
    try {
      const result = await window.nucleus.modifyMail({ id, ...changes });
      if (result && result.ok) results.push(result.message);
    } catch (_) {}
  }
  return results;
}

async function bulkArchiveMessages() {
  const ids = mailState.selectedIds || [];
  if (!ids.length) return;
  await modifyMessagesBulk(ids, { remove: ["INBOX"] });
  ids.forEach(removeMessageFromList);
  clearMessageSelection();
  if (ids.includes(mailState.selectedId)) closeMailMessage();
  updateMailUI("list");
  setMailStatus(ids.length === 1 ? "Message archived." : `${ids.length} messages archived.`);
}

async function bulkSpamMessages() {
  const ids = mailState.selectedIds || [];
  if (!ids.length) return;
  await modifyMessagesBulk(ids, { add: ["SPAM"], remove: ["INBOX"] });
  ids.forEach(removeMessageFromList);
  clearMessageSelection();
  if (ids.includes(mailState.selectedId)) closeMailMessage();
  updateMailUI("list");
  setMailStatus(ids.length === 1 ? "Message marked as spam." : `${ids.length} messages marked as spam.`);
}

async function bulkDeleteMessages() {
  const ids = mailState.selectedIds || [];
  if (!ids.length) return;
  const inTrash = mailState.folder === "trash";
  for (const id of ids) {
    if (inTrash && window.nucleus.deleteMail) {
      await window.nucleus.deleteMail({ id });
    } else if (window.nucleus.trashMail) {
      await window.nucleus.trashMail({ id });
    }
    removeMessageFromList(id);
  }
  clearMessageSelection();
  if (ids.includes(mailState.selectedId)) closeMailMessage();
  updateMailUI("list");
  setMailStatus(inTrash ? "Messages deleted." : "Messages moved to trash.");
}

async function bulkMarkMessagesRead(read = true) {
  const ids = mailState.selectedIds || [];
  if (!ids.length) return;
  const changes = read ? { remove: ["UNREAD"] } : { add: ["UNREAD"] };
  const updated = await modifyMessagesBulk(ids, changes);
  updated.forEach(updateMessageInList);
  clearMessageSelection();
  updateMailUI("list");
  setMailStatus(read ? "Marked as read." : "Marked as unread.");
}

async function archiveMessageById(id) {
  if (!id || !window.nucleus || typeof window.nucleus.modifyMail !== "function") return;
  const result = await window.nucleus.modifyMail({ id, remove: ["INBOX"] });
  if (!result || !result.ok) {
    setMailStatus((result && result.error) || "Unable to archive message.");
    return;
  }
  removeMessageFromList(id);
  if (mailState.selectedId === id) closeMailMessage();
  updateMailUI("list");
  setMailStatus("Message archived.");
}

async function trashMessageById(id) {
  if (!id || !window.nucleus || typeof window.nucleus.trashMail !== "function") return;
  const result = await window.nucleus.trashMail({ id });
  if (!result || !result.ok) {
    setMailStatus((result && result.error) || "Unable to delete message.");
    return;
  }
  removeMessageFromList(id);
  if (mailState.selectedId === id) closeMailMessage();
  updateMailUI("list");
  setMailStatus("Message moved to trash.");
}

async function deleteMessageById(id) {
  if (!id || !window.nucleus || typeof window.nucleus.deleteMail !== "function") return;
  const result = await window.nucleus.deleteMail({ id });
  if (!result || !result.ok) {
    setMailStatus((result && result.error) || "Unable to delete message.");
    return;
  }
  removeMessageFromList(id);
  if (mailState.selectedId === id) closeMailMessage();
  updateMailUI("list");
  setMailStatus("Message deleted.");
}

async function toggleUnreadById(id) {
  const message = mailState.messages.find(item => item.id === id);
  if (!message || !window.nucleus || typeof window.nucleus.modifyMail !== "function") return;
  const changes = message.unread ? { remove: ["UNREAD"] } : { add: ["UNREAD"] };
  const result = await window.nucleus.modifyMail({ id, ...changes });
  if (!result || !result.ok) return;
  updateMessageInList(result.message);
  const root = window.nucleusMailApp && window.nucleusMailApp.getMailRoot
    ? window.nucleusMailApp.getMailRoot()
    : null;
  if (root && window.nucleusMailApp.patchMailRow) {
    window.nucleusMailApp.patchMailRow(root, result.message, mailState);
  }
}

async function spamSelectedMessage() {
  const id = mailState.selectedId;
  if (!id || !window.nucleus || typeof window.nucleus.modifyMail !== "function") return;
  const result = await window.nucleus.modifyMail({ id, add: ["SPAM"], remove: ["INBOX"] });
  if (!result || !result.ok) {
    setMailStatus((result && result.error) || "Unable to mark as spam.");
    return;
  }
  removeMessageFromList(id);
  closeMailMessage();
  updateMailUI("list");
  setMailStatus("Message marked as spam.");
}

async function notSpamSelectedMessage() {
  const id = mailState.selectedId;
  if (!id || !window.nucleus || typeof window.nucleus.modifyMail !== "function") return;
  const result = await window.nucleus.modifyMail({ id, remove: ["SPAM"], add: ["INBOX"] });
  if (!result || !result.ok) {
    setMailStatus((result && result.error) || "Unable to move out of spam.");
    return;
  }
  removeMessageFromList(id);
  closeMailMessage();
  updateMailUI("list");
  setMailStatus("Message moved to inbox.");
}

function toggleThreadMessage(id) {
  if (!id) return;
  mailState.selectedId = id;
  const threadMsg = Array.isArray(mailState.threadMessages)
    ? mailState.threadMessages.find(item => item.id === id)
    : null;
  if (threadMsg) {
    mailState.selectedMessage = threadMsg;
    updateMailUI("reading");
    return;
  }
  openMailMessage(id);
}

async function loadMoreMailMessages() {
  if (!mailState.nextPageToken || mailState.loadingMore) return;
  if (!window.nucleus || typeof window.nucleus.getMailView !== "function") return;

  mailState.loadingMore = true;
  updateMailUI("list");

  try {
    const result = await window.nucleus.getMailView({
      folder: mailState.folder,
      q: mailState.searchQuery,
      pageToken: mailState.nextPageToken
    });
    if (!result || !result.ok) {
      throw new Error((result && result.error) || "Unable to load more messages.");
    }
    const incoming = sortMailByReceivedDate(
      result.view && Array.isArray(result.view.messages) ? result.view.messages : []
    );
    const existing = new Set(mailState.allMessages.map(item => item.id));
    const fresh = incoming.filter(item => item && item.id && !existing.has(item.id));
    mailState.allMessages = sortMailByReceivedDate(mailState.allMessages.concat(fresh));
    mailState.nextPageToken = result.view && result.view.nextPageToken ? result.view.nextPageToken : "";
    applyContactRoutingToInbox();
  } catch (error) {
    setMailStatus(error && error.message ? error.message : String(error));
  } finally {
    mailState.loadingMore = false;
    updateMailUI("list");
  }
}

function getVisibleMessageIndex() {
  if (!mailState.selectedId) return -1;
  return mailState.messages.findIndex(item => item.id === mailState.selectedId);
}

function openMessageAtOffset(offset) {
  const index = getVisibleMessageIndex();
  const nextIndex = index < 0 ? (offset > 0 ? 0 : mailState.messages.length - 1) : index + offset;
  if (nextIndex < 0 || nextIndex >= mailState.messages.length) return;
  openMailMessage(mailState.messages[nextIndex].id);
}

function showMailShortcutsHelp() {
  setMailStatus("Shortcuts: j/k navigate · r reply · a reply all · f forward · e archive · # trash · c compose · / search · Esc close");
}

function handleMailShortcut(event) {
  const key = event.key;
  if (key === "/" && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    const root = window.nucleusMailApp && window.nucleusMailApp.getMailRoot
      ? window.nucleusMailApp.getMailRoot()
      : null;
    const search = root ? root.querySelector("[data-mail-search]") : null;
    if (search) search.focus();
    return;
  }

  if (key === "Escape") {
    if (mailState.compose) {
      closeMailCompose();
      return;
    }
    if (mailState.selectedIds && mailState.selectedIds.length) {
      clearMessageSelection();
      return;
    }
    if (mailState.selectedId) {
      closeMailMessage();
      return;
    }
    return;
  }

  if (mailState.compose) return;

  if (key === "c" && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    openMailCompose({ mode: "new" });
    return;
  }

  if (key === "j") {
    event.preventDefault();
    openMessageAtOffset(1);
    return;
  }

  if (key === "k") {
    event.preventDefault();
    openMessageAtOffset(-1);
    return;
  }

  if (!mailState.selectedMessage) return;

  if (key === "r" && !event.shiftKey) {
    event.preventDefault();
    replyToSelectedMessage("reply");
    return;
  }

  if (key === "a" || (key === "r" && event.shiftKey)) {
    event.preventDefault();
    replyToSelectedMessage("replyAll");
    return;
  }

  if (key === "f") {
    event.preventDefault();
    replyToSelectedMessage("forward");
    return;
  }

  if (key === "e") {
    event.preventDefault();
    archiveSelectedMessage();
    return;
  }

  if (key === "#" || key === "Delete") {
    event.preventDefault();
    trashSelectedMessage();
    return;
  }

  if (key === "u") {
    event.preventDefault();
    toggleSelectedUnread();
  }
}

async function openMailAppTab(workspaceId = getBrowserWorkspaceId()) {
  const existing = state.tabs.find(tab => tab.type === "mailtab" && tab.workspaceId === workspaceId);
  const tab = existing || {
    id: `mail:${workspaceId}`,
    type: "mailtab",
    workspaceId,
    label: "Mail",
    mailFolder: "inbox",
    mailSearch: "",
    mailSelectedId: null
  };

  if (!existing) {
    state.tabs.push(tab);
  }

  restoreMailStateFromTab(tab);
  rememberActiveWorkspaceTab();
  state.top = "workspace";
  state.activeWorkspaceId = workspaceId;
  state.activeTabId = tab.id;
  state.activeTabByWorkspace[workspaceId] = tab.id;
  render();
  queueTabSyncAfterRender();
  ensureMailLoaded(false).catch(error => {
    console.error("Unable to load mail after opening tab:", error);
  }).then(async () => {
    if (mailState.selectedId && !mailState.selectedMessage) {
      await openMailMessage(mailState.selectedId);
    }
  });
}

async function openMailAppInExistingTab(tabId) {
  const tab = state.tabs.find(item => sameTabId(item.id, tabId));
  if (!tab) return;

  tab.type = "mailtab";
  tab.label = "Mail";
  tab.url = "";
  tab.injection = null;
  tab.loading = false;
  tab.mailFolder = tab.mailFolder || "inbox";
  tab.mailSearch = tab.mailSearch || "";
  tab.mailSelectedId = null;

  restoreMailStateFromTab(tab);
  mailState.initialized = false;
  mailState.view = null;

  rememberActiveWorkspaceTab();
  state.top = "workspace";
  state.activeWorkspaceId = tab.workspaceId;
  state.activeTabId = tab.id;
  state.activeTabByWorkspace[tab.workspaceId] = tab.id;
  render();
  queueTabSyncAfterRender();
  ensureMailLoaded(true).catch(error => {
    console.error("Unable to load mail after converting tab:", error);
  });
}

bindMailContactsUpdates();
bindMailInboxDelta();
