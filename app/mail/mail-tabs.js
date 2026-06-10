// Renderer Mail tab controller.
// Functionality: owns mail UI state, loads Gmail data through IPC, and patches
// the mail DOM in place instead of rerendering the whole workspace.

let mailState = {
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
    visible = visible.filter(message => message.inboxCategory !== "non_academic");
    visible = visible.filter(message => !routedIds.has(message.id));
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

function bindMailInboxDelta() {
  if (mailInboxDeltaUnsubscribe || !window.nucleus || typeof window.nucleus.on !== "function") {
    return;
  }
  mailInboxDeltaUnsubscribe = window.nucleus.on("mail:inbox_delta", payload => {
    handleInboxDelta(payload);
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
    }
  } catch (_) {
    mailWatchStarted = false;
  }
}

function handleInboxDelta(delta) {
  if (!delta) return;
  const active = isMailTabActive();

  // historyId aged out of Gmail's window: resync from scratch.
  if (delta.reset) {
    if (active && (mailState.folder === "inbox" || mailState.folder === "secondary") && !mailState.searchQuery) {
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

  const onInbox = (mailState.folder === "inbox" || mailState.folder === "secondary") && !mailState.searchQuery;
  let freshMessages = [];

  if (onInbox) {
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

    if (changed) applyContactRoutingToInbox();
  }

  if (changed) {
    syncMailStateToTab();
    if (active) {
      updateMailUI("list");
      updateMailUI("sidebar");
    }
  }

  if (freshMessages.length) {
    if (active) {
      const count = freshMessages.length;
      setMailStatus(count === 1 ? "1 new message" : `${count} new messages`);
      syncMailContactsFromInbox(mailState.allMessages);
    }
  }
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
  if (!keepSelection) {
    mailState.selectedId = null;
    mailState.selectedMessage = null;
  }
  syncMailStateToTab();
  updateMailUI("full");

  try {
    await ensureMailAuthReady();
    bindMailContactsUpdates();
    bindMailInboxDelta();
    ensureMailWatchStarted();
    await loadMailContactsState();
    const result = await window.nucleus.getMailView({ folder, q });
    if (!result || !result.ok) {
      throw new Error((result && result.error) || "Unable to load mail.");
    }

    mailState.view = result.view;
    mailState.allMessages = sortMailByReceivedDate(
      result.view && Array.isArray(result.view.messages) ? result.view.messages : []
    );
    mailState.messages = mailState.allMessages.slice();

    if ((folder === "inbox" || folder === "secondary") && !q) {
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
  mailState.detailLoading = true;
  mailState.compose = null;
  syncMailStateToTab();
  updateMailUI("content");

  try {
    const result = await window.nucleus.getMailMessage({ id });
    if (!result || !result.ok) {
      throw new Error((result && result.error) || "Unable to open message.");
    }

    mailState.selectedMessage = result.message;
    if (result.message && result.message.unread && typeof window.nucleus.modifyMail === "function") {
      const modified = await window.nucleus.modifyMail({ id, remove: ["UNREAD"] });
      if (modified && modified.ok && modified.message) {
        updateMessageInList(modified.message);
        mailState.selectedMessage = { ...mailState.selectedMessage, unread: false };
        const root = window.nucleusMailApp && window.nucleusMailApp.getMailRoot
          ? window.nucleusMailApp.getMailRoot()
          : null;
        if (root && window.nucleusMailApp.patchMailRow) {
          window.nucleusMailApp.patchMailRow(root, modified.message, mailState);
        }
      }
    }
  } catch (error) {
    setMailStatus(error && error.message ? error.message : String(error));
    mailState.selectedId = null;
    mailState.selectedMessage = null;
  } finally {
    mailState.detailLoading = false;
    syncMailStateToTab();
    updateMailUI("content");
  }
}

function closeMailMessage() {
  mailState.selectedId = null;
  mailState.selectedMessage = null;
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
    replyToId: options.replyToId || ""
  };
  updateMailUI("compose");
}

function closeMailCompose() {
  mailState.compose = null;
  mailState.sending = false;
  updateMailUI("compose");
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
  await syncTabs();
  await syncActiveTab();
  render();
  await ensureMailLoaded(false);
  if (mailState.selectedId && !mailState.selectedMessage) {
    await openMailMessage(mailState.selectedId);
  }
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
  await syncTabs();
  await syncActiveTab();
  render();
  await ensureMailLoaded(true);
}

bindMailContactsUpdates();
bindMailInboxDelta();
