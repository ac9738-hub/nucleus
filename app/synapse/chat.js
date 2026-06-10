// Native Synapse chat templates.
// Functionality: renders a single conversation surface (thread + composer) and
// individual message bubbles into renderer DOM strings. Pure templating only --
// no IPC, no API calls.
// Dependencies: app/synapse/synapse.js calls the exported template helpers;
// renderer/render.js (yours) attaches the data-synapse-* handlers to the output.
(function () {
  "use strict";

  // Models verified against the current Claude API model IDs. The dateless
  // 4.6+ IDs are pinned snapshots, not evergreen aliases.
  var MODELS = [
    { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
    { id: "claude-opus-4-8", label: "Opus 4.8" },
    { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" }
  ];
  var DEFAULT_MODEL = "claude-sonnet-4-6";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTime(value) {
    if (!value) return "";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  // Light, safe formatting: fenced code blocks, inline code, and line breaks.
  // Everything is escaped first so model output can never inject markup.
  function formatContent(raw) {
    var text = String(raw == null ? "" : raw);
    var segments = text.split(/```/);
    var html = "";

    for (var i = 0; i < segments.length; i += 1) {
      var segment = segments[i];
      var isCode = i % 2 === 1;

      if (isCode) {
        var firstNewline = segment.indexOf("\n");
        var body = firstNewline === -1 ? segment : segment.slice(firstNewline + 1);
        html += '<pre class="synapse-code"><code>' + escapeHtml(body) + "</code></pre>";
        continue;
      }

      var escaped = escapeHtml(segment)
        .replace(/`([^`]+)`/g, '<code class="synapse-inline-code">$1</code>')
        .replace(/\n/g, "<br>");
      html += escaped;
    }

    return html;
  }

  function renderMessage(message) {
    if (!message || (message.role !== "user" && message.role !== "assistant")) return "";
    var roleLabel = message.role === "user" ? "You" : "Synapse";
    var time = formatTime(message.createdAt);

    return (
      '<div class="synapse-msg synapse-msg-' + message.role + '" data-synapse-role="' + message.role + '">' +
      '<div class="synapse-msg-meta"><span class="synapse-msg-role">' + escapeHtml(roleLabel) + "</span>" +
      (time ? '<span class="synapse-msg-time">' + escapeHtml(time) + "</span>" : "") +
      "</div>" +
      '<div class="synapse-msg-text">' + formatContent(message.content) + "</div>" +
      "</div>"
    );
  }

  function renderMessages(messages) {
    var list = Array.isArray(messages) ? messages : [];
    if (!list.length) {
      return (
        '<div class="synapse-thread-empty">' +
        '<div class="synapse-empty-hero">' +
        '<div class="synapse-empty-mark" aria-hidden="true"></div>' +
        "<h3>New conversation</h3>" +
        "<p>Ask anything. Synapse routes your message to a model and streams the reply.</p>" +
        "</div>" +
        "</div>"
      );
    }
    return list.map(renderMessage).join("");
  }

  function renderModelOptions(activeModel) {
    var selected = activeModel || DEFAULT_MODEL;
    return MODELS.map(function (model) {
      var isActive = model.id === selected ? " selected" : "";
      return '<option value="' + escapeHtml(model.id) + '"' + isActive + ">" + escapeHtml(model.label) + "</option>";
    }).join("");
  }

  // Full conversation surface. The data-synapse-* hooks are the contract your
  // renderer / controller binds to.
  function createChatHtmlTemplate(conversation) {
    var convo = conversation || {};
    var id = convo.id || "";
    var title = convo.title || "Untitled conversation";
    var model = convo.model || DEFAULT_MODEL;
    var messages = Array.isArray(convo.messages) ? convo.messages : [];

    return (
      '<section class="synapse-chat" data-synapse-conversation-id="' + escapeHtml(id) + '">' +
      '<header class="synapse-chat-header">' +
      "<div>" +
      '<span class="synapse-eyebrow">Synapse</span>' +
      "<h1>" + escapeHtml(title) + "</h1>" +
      "</div>" +
      '<label class="synapse-model-select">' +
      "<span>Model</span>" +
      '<select data-synapse-model>' + renderModelOptions(model) + "</select>" +
      "</label>" +
      "</header>" +

      '<div class="synapse-thread" data-synapse-thread role="log" aria-live="polite">' +
      renderMessages(messages) +
      "</div>" +

      '<form class="synapse-composer" data-synapse-send>' +
      '<div class="synapse-composer-field">' +
      '<textarea data-synapse-input rows="1" placeholder="Message Synapse..." autocomplete="off"></textarea>' +
      "</div>" +
      '<button type="submit" class="synapse-send-button" data-synapse-send-button>Send</button>' +
      "</form>" +
      "</section>"
    );
  }

  var api = {
    MODELS: MODELS,
    DEFAULT_MODEL: DEFAULT_MODEL,
    escapeHtml: escapeHtml,
    formatTime: formatTime,
    formatContent: formatContent,
    renderMessage: renderMessage,
    renderMessages: renderMessages,
    createChatHtmlTemplate: createChatHtmlTemplate
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.nucleusSynapseTemplates = api;
  }
})();
