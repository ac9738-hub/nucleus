// Native Synapse app renderer + chat controller.
// Functionality: renders the Synapse dashboard (conversation list) and single
// conversation pages, and provides mountSynapseChat() which wires the composer,
// streams assistant deltas into the thread, and keeps an in-memory transcript.
// Dependencies: loaded after app/synapse/chat.js by index.html. The controller
// talks to the main process through an injected { send, on } bridge (defaults to
// window.nucleus). Your renderer (render.js) handles native tab routing and
// calls window.nucleusSynapseApp.renderSynapseApp for the Synapse tab.
(function () {
  "use strict";

  function templates() {
    return (typeof window !== "undefined" && window.nucleusSynapseTemplates) || null;
  }

  function escapeHtml(value) {
    var t = templates();
    if (t) return t.escapeHtml(value);
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getConversations(state) {
    var convos = state && Array.isArray(state.conversations) ? state.conversations : [];
    return convos.filter(function (c) { return c && c.id; });
  }

  function lastMessagePreview(conversation) {
    var messages = conversation && Array.isArray(conversation.messages) ? conversation.messages : [];
    if (!messages.length) return "No messages yet.";
    var last = messages[messages.length - 1];
    var text = String(last.content || "").replace(/\s+/g, " ").trim();
    return text.length > 120 ? text.slice(0, 117) + "..." : text || "No messages yet.";
  }

  function renderSynapseSidebar(conversations, activeId, collapsed) {
    var items = conversations.map(function (convo) {
      var active = String(convo.id) === String(activeId) ? " is-active" : "";
      return (
        '<button type="button" class="synapse-conversation-card synapse-history-item' + active + '" data-synapse-conversation-id="' + escapeHtml(convo.id) + '">' +
        '<span class="synapse-history-title">' + escapeHtml(convo.title || "Untitled conversation") + "</span>" +
        '<span class="synapse-history-preview">' + escapeHtml(lastMessagePreview(convo)) + "</span>" +
        "</button>"
      );
    }).join("");

    return (
      '<aside class="synapse-sidebar" aria-label="Past chats">' +
      '<div class="synapse-sidebar-head">' +
      '<div class="synapse-brand">' +
      '<span class="synapse-brand-mark" aria-hidden="true"></span>' +
      "<div>" +
      "<h2>Synapse</h2>" +
      '<p class="synapse-brand-tagline">AI conversations</p>' +
      "</div>" +
      "</div>" +
      '<button type="button" class="synapse-sidebar-toggle" data-synapse-toggle-sidebar aria-label="Hide chat history">&lsaquo;</button>' +
      "</div>" +
      '<button type="button" class="synapse-new-chat-button" data-synapse-new-conversation><span class="synapse-new-chat-icon" aria-hidden="true">+</span>New chat</button>' +
      '<div class="synapse-history-list">' + (items || '<div class="synapse-history-empty">No past chats yet.</div>') + "</div>" +
      "</aside>" +
      (collapsed
        ? '<button type="button" class="synapse-sidebar-rail" data-synapse-toggle-sidebar aria-label="Show chat history">Chats</button>'
        : "")
    );
  }

  function findConversation(state, conversationId) {
    var conversations = getConversations(state);
    return conversations.find(function (c) { return String(c.id) === String(conversationId); }) || conversations[0] || null;
  }

  function renderSynapseChatPage(tab, state) {
    var t = templates();
    if (!t) {
      return '<section class="workspace-panel"><div><h2>Synapse</h2><p>The Synapse template script did not load.</p></div></section>';
    }

    var conversations = getConversations(state);
    var conversation = findConversation(state, tab && tab.conversationId);
    if (!conversation) {
      conversation = { id: "", title: "New conversation", model: t.DEFAULT_MODEL, messages: [] };
    }

    var collapsed = Boolean(tab && tab.synapseSidebarCollapsed);
    return (
      '<section class="synapse-shell' + (collapsed ? " is-sidebar-collapsed" : "") + '">' +
      renderSynapseSidebar(conversations, conversation.id, collapsed) +
      '<main class="synapse-main">' +
      t.createChatHtmlTemplate(conversation) +
      "</main>" +
      "</section>"
    );
  }

  function renderSynapseApp(tab, state) {
    return renderSynapseChatPage(tab || {}, state || {});
  }

  // ---------------------------------------------------------------------------
  // Chat controller: wires the composer + streams replies into the thread.
  // Call this after renderSynapseChatPage()'s HTML is in the DOM.
  //
  //   mountSynapseChat(viewRoot, {
  //     conversationId,                 // string
  //     initialMessages: [...],         // [{ role, content }] for context
  //     bridge: window.nucleus,         // must expose send + on (see README)
  //     onUserMessage(msg) {},          // persist hook
  //     onAssistantMessage(msg) {}      // persist hook
  //   })
  //
  // Returns { destroy } so you can tear listeners down on tab switch.
  // ---------------------------------------------------------------------------
  function mountSynapseChat(viewRoot, options) {
    var opts = options || {};
    var t = templates();
    var root = viewRoot && viewRoot.querySelector ? viewRoot : (typeof document !== "undefined" ? document : null);
    if (!root || !t) return { destroy: function () {} };

    var thread = root.querySelector("[data-synapse-thread]");
    var form = root.querySelector("[data-synapse-send]");
    var input = root.querySelector("[data-synapse-input]");
    var modelSelect = root.querySelector("[data-synapse-model]");
    var sendButton = root.querySelector("[data-synapse-send-button]");
    if (!thread || !form || !input) return { destroy: function () {} };

    var bridge = opts.bridge || (typeof window !== "undefined" ? window.nucleus : null);
    var conversationId = opts.conversationId || "";
    var messages = Array.isArray(opts.initialMessages) ? opts.initialMessages.slice() : [];
    var sending = false;
    var disposed = false;

    function scrollToBottom() {
      thread.scrollTop = thread.scrollHeight;
    }

    function clearEmptyState() {
      var empty = thread.querySelector(".synapse-thread-empty");
      if (empty) empty.remove();
    }

    function autoGrow() {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 200) + "px";
    }

    function appendMessage(message) {
      clearEmptyState();
      var wrap = document.createElement("div");
      wrap.innerHTML = t.renderMessage(message);
      var node = wrap.firstElementChild;
      if (node) {
        thread.appendChild(node);
        scrollToBottom();
      }
      return node;
    }

    // Streaming assistant bubble. Text is appended as plain text while streaming
    // (so partial code fences never reparse), then reformatted once on finalize.
    function beginAssistant() {
      clearEmptyState();
      var node = document.createElement("div");
      node.className = "synapse-msg synapse-msg-assistant synapse-streaming";
      node.setAttribute("data-synapse-role", "assistant");
      node.innerHTML =
        '<div class="synapse-msg-meta"><span class="synapse-msg-role">Synapse</span></div>' +
        '<div class="synapse-msg-text"></div>' +
        '<span class="synapse-cursor" aria-hidden="true"></span>';
      thread.appendChild(node);
      scrollToBottom();
      return {
        node: node,
        textEl: node.querySelector(".synapse-msg-text"),
        buffer: ""
      };
    }

    function pushDelta(handle, delta) {
      if (!handle || !delta) return;
      handle.buffer += delta;
      handle.textEl.appendChild(document.createTextNode(delta));
      scrollToBottom();
    }

    function finalizeAssistant(handle, finalText) {
      if (!handle) return "";
      var text = typeof finalText === "string" && finalText.length ? finalText : handle.buffer;
      handle.textEl.innerHTML = t.formatContent(text);
      handle.node.classList.remove("synapse-streaming");
      var cursor = handle.node.querySelector(".synapse-cursor");
      if (cursor) cursor.remove();
      scrollToBottom();
      return text;
    }

    function failAssistant(handle, errorText) {
      if (!handle) return;
      handle.node.classList.remove("synapse-streaming");
      handle.node.classList.add("synapse-error");
      handle.textEl.textContent = errorText || "Something went wrong.";
      var cursor = handle.node.querySelector(".synapse-cursor");
      if (cursor) cursor.remove();
      scrollToBottom();
    }

    function setSending(value) {
      sending = value;
      input.disabled = value;
      if (sendButton) sendButton.disabled = value;
    }

    function makeRequestId() {
      return "syn_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    }

    function submit() {
      if (sending || disposed) return;
      var text = String(input.value || "").trim();
      if (!text) return;
      if (!bridge || typeof bridge.send !== "function") {
        appendMessage({ role: "assistant", content: "No Synapse bridge is wired. See app/synapse/README.md." });
        return;
      }

      var model = modelSelect ? modelSelect.value : t.DEFAULT_MODEL;
      var userMessage = { role: "user", content: text, createdAt: Date.now() };

      appendMessage(userMessage);
      messages.push({ role: "user", content: text });
      if (typeof opts.onUserMessage === "function") opts.onUserMessage(userMessage);

      input.value = "";
      autoGrow();
      setSending(true);

      var assistant = beginAssistant();
      var requestId = makeRequestId();

      // Live token stream from the main process.
      var unsubscribe = null;
      if (bridge && typeof bridge.on === "function") {
        unsubscribe = bridge.on("synapse:response-chunk", function (payload) {
          if (!payload || payload.requestId !== requestId) return;
          pushDelta(assistant, payload.delta || "");
        });
      }

      function cleanup() {
        if (typeof unsubscribe === "function") unsubscribe();
        setSending(false);
      }

      Promise.resolve(
        bridge.send({
          requestId: requestId,
          conversationId: conversationId,
          model: model,
          messages: messages.slice()
        })
      ).then(function (result) {
        if (disposed) { cleanup(); return; }
        if (result && result.ok === false) {
          failAssistant(assistant, result.error || "The model request failed.");
          cleanup();
          return;
        }
        var finalText = result && typeof result.text === "string" ? result.text : assistant.buffer;
        finalizeAssistant(assistant, finalText);
        messages.push({ role: "assistant", content: finalText });
        if (typeof opts.onAssistantMessage === "function") {
          opts.onAssistantMessage({ role: "assistant", content: finalText, createdAt: Date.now() });
        }
        cleanup();
      }).catch(function (error) {
        if (disposed) { cleanup(); return; }
        failAssistant(assistant, (error && error.message) || "The model request failed.");
        cleanup();
      });
    }

    function onSubmit(event) {
      event.preventDefault();
      submit();
    }

    function onKeydown(event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    }

    form.addEventListener("submit", onSubmit);
    input.addEventListener("keydown", onKeydown);
    input.addEventListener("input", autoGrow);
    autoGrow();
    scrollToBottom();

    return {
      destroy: function () {
        disposed = true;
        form.removeEventListener("submit", onSubmit);
        input.removeEventListener("keydown", onKeydown);
        input.removeEventListener("input", autoGrow);
      }
    };
  }

  var api = {
    renderSynapseApp: renderSynapseApp,
    renderSynapseSidebar: renderSynapseSidebar,
    renderSynapseChatPage: renderSynapseChatPage,
    mountSynapseChat: mountSynapseChat
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.nucleusSynapseApp = api;
  }
})();
