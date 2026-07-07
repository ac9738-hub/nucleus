// Synapse Learn Course — incremental teaching-block tutor.
(function () {
  "use strict";

  var MAX_BITES_PER_LESSON = 2;
  var BITE_MAX_TOKENS = 900;
  var QUESTION_MAX_TOKENS = 1200;

  function templates() {
    return (typeof window !== "undefined" && window.nucleusSynapseTemplates) || null;
  }

  function escape(value) {
    var t = templates();
    return t && typeof t.escapeHtml === "function" ? t.escapeHtml(value) : String(value || "");
  }

  function renderCoursePicker(courses, meta) {
    var info = meta || {};
    var options = (courses || []).map(function (course) {
      var label = course.label || course.name || course.id;
      return '<option value="' + escape(course.id) + '">' + escape(label) + "</option>";
    }).join("");
    var status = "";
    if (info.loading || info.pending) {
      status = '<p class="synapse-learn-picker-status">Loading courses from your Canvas graph…</p>';
    } else if (info.error) {
      status = '<p class="synapse-learn-picker-error">' + escape(info.error) + "</p>";
    } else if (!(courses || []).length) {
      status = '<p class="synapse-learn-picker-status">No courses with teaching blocks were found yet.</p>';
    }
    return (
      '<section class="synapse-learn-picker">' +
      '<div class="synapse-learn-picker-card">' +
      '<span class="synapse-eyebrow">Learn course</span>' +
      "<h2>Choose a course</h2>" +
      "<p>Synapse walks you through teaching blocks from your Canvas graph — a few rich bites per block.</p>" +
      status +
      '<label class="synapse-learn-course-select">' +
      "<span>Course</span>" +
      '<select data-synapse-learn-course' + (info.loading || info.pending ? " disabled" : "") + ">" +
      '<option value="">Select a course…</option>' +
      options +
      "</select>" +
      "</label>" +
      '<button type="button" class="synapse-learn-start-button" data-synapse-learn-start disabled>Start learning</button>' +
      "</div>" +
      "</section>"
    );
  }

  function isAnswerLesson(lesson) {
    return Boolean(lesson && (lesson.interaction === "answer" || lesson.type === "problem"));
  }

  function renderAnswerPanel() {
    return (
      '<div class="synapse-learn-answer" data-synapse-learn-answer-panel hidden>' +
      '<label class="synapse-learn-answer-label" for="synapse-learn-answer-input">Your answer</label>' +
      '<textarea id="synapse-learn-answer-input" class="synapse-learn-answer-input" data-synapse-learn-answer-input rows="3" placeholder="Work the problem, then check your answer…"></textarea>' +
      '<div class="synapse-learn-answer-actions">' +
      '<button type="button" class="synapse-learn-check-answer" data-synapse-learn-check-answer>Check answer</button>' +
      "</div>" +
      "</div>"
    );
  }

  function renderLearnShell(session) {
    var lesson = session && session.lesson ? session.lesson : null;
    var progress = lesson
      ? "Block " + (lesson.index + 1) + " of " + lesson.total
        + (lesson.sectionGroup ? " · " + escape(lesson.sectionGroup) : "")
        + " · " + escape(lesson.type) + ": " + escape(lesson.name)
      : "Loading…";
    var fileMeta = lesson && lesson.filename
      ? escape(lesson.filename) + (lesson.pageNumber != null ? " · p." + lesson.pageNumber : "")
      : "";

    return (
      '<section class="synapse-learn" data-synapse-learn-root>' +
      '<header class="synapse-learn-header">' +
      "<div>" +
      '<span class="synapse-eyebrow">Learn course</span>' +
      "<h1>" + escape(session.courseLabel || session.courseId || "Course") + "</h1>" +
      '<p class="synapse-learn-progress">' + progress + "</p>" +
      (fileMeta ? '<p class="synapse-learn-file">' + fileMeta + "</p>" : "") +
      "</div>" +
      '<div class="synapse-learn-actions">' +
      '<button type="button" class="synapse-learn-back" data-synapse-learn-back>Change course</button>' +
      '<button type="button" class="synapse-learn-next" data-synapse-learn-next>Next</button>' +
      "</div>" +
      "</header>" +
      '<div class="synapse-learn-track" aria-hidden="true">' +
      '<div class="synapse-learn-track-fill" data-synapse-learn-track style="width:' +
      (lesson && lesson.total ? Math.round(((lesson.index + 1) / lesson.total) * 100) : 0) +
      '%"></div>' +
      "</div>" +
      '<div class="synapse-thread synapse-learn-thread" data-synapse-learn-thread role="log" aria-live="polite"></div>' +
      renderAnswerPanel() +
      '<form class="synapse-composer synapse-learn-composer" data-synapse-learn-send>' +
      '<div class="synapse-composer-field">' +
      '<textarea data-synapse-learn-input rows="1" placeholder="' +
      (isAnswerLesson(lesson) ? "Ask a question about this problem…" : "Ask a question about this block…") +
      '" autocomplete="off"></textarea>' +
      "</div>" +
      '<button type="submit" class="synapse-send-button" data-synapse-learn-send-button>Ask</button>' +
      "</form>" +
      "</section>"
    );
  }

  function renderLearnMessage(message) {
    var tmpl = templates();
    if (!message || (message.role !== "user" && message.role !== "assistant")) return "";
    var roleLabel = message.role === "user" ? "You" : "Teacher";
    return (
      '<div class="synapse-msg synapse-msg-' + message.role + '" data-synapse-role="' + message.role + '">' +
      '<div class="synapse-msg-meta"><span class="synapse-msg-role">' + escape(roleLabel) + "</span></div>" +
      '<div class="synapse-msg-text">' +
      (tmpl && tmpl.formatContent ? tmpl.formatContent(message.content) : escape(message.content)) +
      "</div>" +
      "</div>"
    );
  }

  function parseCiteLabels(text) {
    var labels = [];
    var pattern = /\[C(\d+)\]/gi;
    var match;
    while ((match = pattern.exec(String(text || ""))) !== null) {
      var label = "C" + match[1];
      if (labels.indexOf(label) === -1) labels.push(label);
    }
    return labels;
  }

  function resolveLessonCitations(text, lesson) {
    var chunks = (lesson && lesson.groundingChunks) || [];
    if (!chunks.length) return [];
    var byLabel = {};
    chunks.forEach(function (chunk) {
      if (chunk && chunk.citeLabel) byLabel[chunk.citeLabel] = chunk;
    });
    return parseCiteLabels(text).map(function (label) {
      var chunk = byLabel[label];
      if (!chunk) return null;
      var source = chunk.source || {};
      return {
        citeLabel: label,
        chunkId: chunk.chunkId || "",
        text: String(chunk.text || "").slice(0, 220),
        fileid: source.fileid || lesson.fileId || "",
        pageNumber: source.pageNumber != null ? source.pageNumber : lesson.pageNumber,
        nodeType: source.nodeType || "",
        nodeId: source.nodeId || ""
      };
    }).filter(Boolean);
  }

  function renderCitationFootnotes(citations) {
    if (!citations || !citations.length) return "";
    var items = citations.map(function (cite) {
      var where = [];
      if (cite.fileid) where.push("file " + cite.fileid);
      if (cite.pageNumber != null) where.push("p." + cite.pageNumber);
      if (cite.nodeType && cite.nodeId) where.push(cite.nodeType + " " + cite.nodeId);
      var meta = where.length ? " (" + where.join(", ") + ")" : "";
      return (
        '<li><strong>[' + escape(cite.citeLabel) + ']</strong>' +
        meta + " " + escape(cite.text) + "</li>"
      );
    }).join("");
    return (
      '<div class="synapse-learn-citations">' +
      "<p class=\"synapse-learn-citations-title\">Sources</p>" +
      "<ul>" + items + "</ul>" +
      "</div>"
    );
  }

  function buildTeacherSystem(lesson, session, options) {
    var extra = options || {};
    var bites = (session && session.bites) || [];
    var isQuestion = Boolean(extra.isQuestion);
    var isAnswerCheck = Boolean(extra.isAnswerCheck);
    var groundingPrompt = String(lesson.groundingPrompt || "").trim();
    var fallbackContext = String(
      lesson.teachingContext || lesson.problemStatement || lesson.snippet || ""
    ).trim();
    var sourceMaterial = groundingPrompt || fallbackContext;
    var groundingLabels = Array.isArray(lesson.groundingLabels) ? lesson.groundingLabels : [];
    return (
      "You are Synapse Course Teacher inside the Nucleus student app.\n" +
      "Teach the current block in a chat-like flow — substantive but not a wall of text.\n\n" +
      "Current block: [" + lesson.type + "] " + lesson.name + "\n" +
      (lesson.sectionGroup ? "Section: " + lesson.sectionGroup + "\n" : "") +
      (lesson.moduleName ? "Module: " + lesson.moduleName + "\n" : "") +
      "Course: " + (session.courseLabel || session.courseId) + "\n" +
      (lesson.filename ? "File: " + lesson.filename + "\n" : "") +
      (lesson.pageNumber != null ? "Page: " + lesson.pageNumber + "\n" : "") +
      (isAnswerCheck && lesson.answerKey ? "Reference answer (for grading only): " + lesson.answerKey + "\n" : "") +
      (isAnswerCheck && lesson.problemSteps && lesson.problemSteps.length
        ? "Reference steps: " + lesson.problemSteps.join(" | ") + "\n"
        : "") +
      "\nGrounding rules:\n" +
      "- Course-specific facts must come only from the lesson source chunks below.\n" +
      "- When you use a source chunk, cite it inline as [C#] at the end of the sentence.\n" +
      (groundingLabels.length
        ? "- Available cite labels: " + groundingLabels.join(", ") + "\n"
        : "- No cite labels are available; stay within the provided source text and say when something is not covered.\n") +
      "- Do not invent cite labels or material beyond the sources.\n\n" +
      "Lesson source material:\n" +
      sourceMaterial + "\n\n" +
      "Rules:\n" +
      (isAnswerCheck
        ? "- The student submitted an answer attempt. Grade it against the source/reference material.\n" +
          "- Say what is correct, what is missing, and give one concrete hint if needed.\n" +
          "- Keep feedback to about 4-8 sentences; do not reveal more of the answer than needed.\n" +
          "- Do not advance to the next teaching bite.\n"
        : isQuestion
        ? "- The student asked a question. Answer clearly in one focused reply (about 4-8 sentences).\n" +
          "- You may use a short bullet list (max 3 bullets) when it helps explain steps or contrasts.\n" +
          "- Stay grounded in the lesson source chunks; cite [C#] labels when you use them.\n" +
          "- Say when the block does not cover something.\n" +
          "- Do not advance to the next teaching bite unless the student asks.\n"
        : isAnswerLesson(lesson)
        ? "- This is a practice problem block. Start by restating the problem briefly, then give one hint or setup bite.\n" +
          "- Do not give the full solution yet; the student should use the answer box.\n" +
          "- Default teaching bites: one solid mini-lesson (about 4-7 sentences, or 2 short paragraphs).\n" +
          "- End teaching bites with a short nudge like \"Try your answer below, or ask me anything.\"\n" +
          "- When you have fully covered this block, end with the token [BLOCK_DONE] on its own line.\n" +
          "- Bites already delivered for this block: " +
          (bites.length ? bites.join(" | ") : "(none yet)") +
          "\n"
        : "- Default teaching bites: one solid mini-lesson (about 4-7 sentences, or 2 short paragraphs).\n" +
          "- You may use at most 3 brief bullets when listing steps, definitions, or takeaways.\n" +
          "- Teach the next meaningful chunk of this block only; do not repeat prior bites.\n" +
          "- End teaching bites with a short nudge like \"Ask me anything, or click Next when ready.\"\n" +
          "- When you have fully covered this block, end with the token [BLOCK_DONE] on its own line.\n" +
          "- Bites already delivered for this block: " +
          (bites.length ? bites.join(" | ") : "(none yet)") +
          "\n")
    );
  }

  function bitePrompt(session) {
    var count = (session.bites || []).length;
    if (!count) {
      return "Begin this teaching block. Deliver the first substantial bite.";
    }
    return "Deliver the next substantial teaching bite for this block. Do not repeat prior bites.";
  }

  function internalMessage(content) {
    return { role: "user", content: content, internal: true };
  }

  function mountCourseTeacher(viewRoot, options) {
    var opts = options || {};
    var t = templates();
    var root = viewRoot && viewRoot.querySelector ? viewRoot : null;
    if (!root || !t) return { destroy: function () {} };

    var bridge = opts.bridge || (typeof window !== "undefined" ? window.nucleus : null);
    var session = {
      courseId: opts.courseId || "",
      courseLabel: opts.courseLabel || opts.courseId || "",
      lessons: Array.isArray(opts.lessons) ? opts.lessons.slice() : [],
      lessonIndex: 0,
      bites: [],
      blockMessages: [],
      lesson: null,
      blockDone: false
    };
    var disposed = false;
    var sending = false;
    var ui = {};

    function makeRequestId() {
      return "learn_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    }

    function currentLesson() {
      return session.lessons[session.lessonIndex] || null;
    }

    function bindUi() {
      ui.thread = root.querySelector("[data-synapse-learn-thread]");
      ui.answerPanel = root.querySelector("[data-synapse-learn-answer-panel]");
      ui.answerInput = root.querySelector("[data-synapse-learn-answer-input]");
      ui.checkAnswerButton = root.querySelector("[data-synapse-learn-check-answer]");
      ui.form = root.querySelector("[data-synapse-learn-send]");
      ui.input = root.querySelector("[data-synapse-learn-input]");
      ui.sendButton = root.querySelector("[data-synapse-learn-send-button]");
      ui.nextButton = root.querySelector("[data-synapse-learn-next]");
      ui.backButton = root.querySelector("[data-synapse-learn-back]");
      ui.track = root.querySelector("[data-synapse-learn-track]");
    }

    function updateAnswerPanel() {
      var show = isAnswerLesson(session.lesson);
      if (ui.answerPanel) {
        ui.answerPanel.hidden = !show;
      }
      if (ui.answerInput && !show) {
        ui.answerInput.value = "";
      }
    }

    var scrollPending = false;
    function scrollToBottom() {
      if (!ui.thread || scrollPending) return;
      scrollPending = true;
      requestAnimationFrame(function () {
        scrollPending = false;
        if (ui.thread) ui.thread.scrollTop = ui.thread.scrollHeight;
      });
    }

    function setSending(value) {
      sending = value;
      if (ui.input) ui.input.disabled = value;
      if (ui.sendButton) ui.sendButton.disabled = value;
      if (ui.nextButton) ui.nextButton.disabled = value;
    }

    function resizeComposer() {
      if (!ui.input) return;
      ui.input.style.height = "auto";
      ui.input.style.height = Math.min(ui.input.scrollHeight, 160) + "px";
    }

    function appendMessage(message) {
      if (!ui.thread) return null;
      var wrap = document.createElement("div");
      wrap.innerHTML = renderLearnMessage(message);
      var node = wrap.firstElementChild;
      if (node) {
        ui.thread.appendChild(node);
        scrollToBottom();
      }
      return node;
    }

    function beginAssistant() {
      var node = document.createElement("div");
      node.className = "synapse-msg synapse-msg-assistant synapse-streaming";
      node.setAttribute("data-synapse-role", "assistant");
      node.innerHTML =
        '<div class="synapse-msg-meta"><span class="synapse-msg-role">Teacher</span></div>' +
        '<div class="synapse-msg-text"></div>' +
        '<span class="synapse-cursor" aria-hidden="true"></span>';
      ui.thread.appendChild(node);
      scrollToBottom();
      return { node: node, textEl: node.querySelector(".synapse-msg-text"), buffer: "" };
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
      var cleaned = text.replace(/\s*\[BLOCK_DONE\]\s*$/i, "").trim();
      var citations = resolveLessonCitations(cleaned, session.lesson);
      handle.textEl.innerHTML = t.formatContent(cleaned);
      if (citations.length) {
        var footnotes = document.createElement("div");
        footnotes.innerHTML = renderCitationFootnotes(citations);
        var footnoteNode = footnotes.firstElementChild;
        if (footnoteNode) handle.textEl.appendChild(footnoteNode);
      }
      handle.node.classList.remove("synapse-streaming");
      var cursor = handle.node.querySelector(".synapse-cursor");
      if (cursor) cursor.remove();
      scrollToBottom();
      if (/\[BLOCK_DONE\]/i.test(text)) session.blockDone = true;
      return cleaned;
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

    function updateHeader() {
      var header = root.querySelector(".synapse-learn-header");
      if (!header || !session.lesson) return;
      var progress = header.querySelector(".synapse-learn-progress");
      var fileMeta = header.querySelector(".synapse-learn-file");
      if (progress) {
        var line =
          "Block " + (session.lesson.index + 1) + " of " + session.lesson.total;
        if (session.lesson.sectionGroup) line += " · " + session.lesson.sectionGroup;
        line += " · " + session.lesson.type + ": " + session.lesson.name;
        progress.textContent = line;
      }
      if (fileMeta) {
        fileMeta.textContent = session.lesson.filename
          ? session.lesson.filename + (session.lesson.pageNumber != null ? " · p." + session.lesson.pageNumber : "")
          : "";
      }
      if (ui.track && session.lesson.total) {
        ui.track.style.width = Math.round(((session.lesson.index + 1) / session.lesson.total) * 100) + "%";
      }
      if (ui.nextButton) {
        ui.nextButton.textContent = session.blockDone || session.bites.length >= MAX_BITES_PER_LESSON
          ? "Next block"
          : "Next bite";
      }
    }

    function resetBlockState() {
      session.bites = [];
      session.blockMessages = [];
      session.blockDone = false;
      session.lesson = currentLesson();
      if (ui.thread) ui.thread.innerHTML = "";
      updateHeader();
      updateAnswerPanel();
    }

    function buildModelMessages(extra) {
      var opts = extra || {};
      var rows = session.blockMessages.slice();
      if (opts.isQuestion) {
        rows = rows.filter(function (row) {
          return !row.internal;
        });
      }
      if (opts.isAnswerCheck) {
        rows = rows.filter(function (row) {
          return !row.internal;
        });
      }
      return rows.map(function (row) {
        return { role: row.role, content: row.content };
      });
    }

    function sendToModel(userText, options) {
      var extra = options || {};
      if (!bridge || typeof bridge.send !== "function") {
        return Promise.resolve({ ok: false, error: "Synapse bridge unavailable." });
      }
      if (!session.lesson) {
        return Promise.resolve({ ok: false, error: "No teaching block loaded." });
      }

      var messages = buildModelMessages(extra);
      if (userText) {
        messages.push({ role: "user", content: userText });
      }

      var requestId = makeRequestId();
      var assistant = beginAssistant();
      var unsubscribe = null;
      if (bridge && typeof bridge.on === "function") {
        unsubscribe = bridge.on("synapse:response-chunk", function (payload) {
          if (!payload || payload.requestId !== requestId) return;
          pushDelta(assistant, payload.delta || "");
        });
      }

      return Promise.resolve(
        bridge.send({
          requestId: requestId,
          conversationId: "learn:" + session.courseId,
          model: opts.model || t.DEFAULT_MODEL,
          maxTokens: extra.maxTokens || BITE_MAX_TOKENS,
          system: buildTeacherSystem(session.lesson, session, extra),
          messages: messages
        })
      ).then(function (result) {
        if (typeof unsubscribe === "function") unsubscribe();
        if (!result || result.ok === false) {
          failAssistant(assistant, (result && result.error) || "Request failed.");
          return result;
        }
        var finalText = typeof result.text === "string" ? result.text : assistant.buffer;
        var cleaned = finalizeAssistant(assistant, finalText);
        session.blockMessages.push({ role: "assistant", content: cleaned });
        if (!extra.isQuestion && cleaned) session.bites.push(cleaned);
        updateHeader();
        return result;
      }).catch(function (error) {
        if (typeof unsubscribe === "function") unsubscribe();
        failAssistant(assistant, (error && error.message) || "Request failed.");
        return { ok: false, error: (error && error.message) || "Request failed." };
      });
    }

    function startLessonBite() {
      if (sending || disposed || !session.lesson) return;
      setSending(true);
      session.blockMessages.push(internalMessage(bitePrompt(session)));
      sendToModel(null, { isQuestion: false, maxTokens: BITE_MAX_TOKENS }).finally(function () {
        setSending(false);
      });
    }

    function advanceBlock() {
      if (session.lessonIndex + 1 >= session.lessons.length) {
        appendMessage({
          role: "assistant",
          content: "You finished all teaching blocks for this course. Pick another course or review anything you liked."
        });
        if (ui.nextButton) ui.nextButton.disabled = true;
        return;
      }
      session.lessonIndex += 1;
      resetBlockState();
      startLessonBite();
    }

    function onNext() {
      if (sending || disposed) return;
      if (session.blockDone || session.bites.length >= MAX_BITES_PER_LESSON) {
        advanceBlock();
        return;
      }
      setSending(true);
      session.blockMessages.push(internalMessage(bitePrompt(session)));
      sendToModel(null, { isQuestion: false, maxTokens: BITE_MAX_TOKENS }).finally(function () {
        setSending(false);
      });
    }

    function onCheckAnswer() {
      if (sending || disposed || !ui.answerInput || !session.lesson) return;
      var attempt = String(ui.answerInput.value || "").trim();
      if (!attempt) return;
      appendMessage({ role: "user", content: "My answer: " + attempt, createdAt: Date.now() });
      session.blockMessages.push({ role: "user", content: "My answer: " + attempt });
      setSending(true);
      sendToModel(null, { isAnswerCheck: true, maxTokens: QUESTION_MAX_TOKENS }).finally(function () {
        setSending(false);
      });
    }

    function onAsk(event) {
      event.preventDefault();
      if (sending || disposed || !ui.input) return;
      var text = String(ui.input.value || "").trim();
      if (!text) return;
      appendMessage({ role: "user", content: text, createdAt: Date.now() });
      session.blockMessages.push({ role: "user", content: text });
      ui.input.value = "";
      resizeComposer();
      setSending(true);
      sendToModel(null, { isQuestion: true, maxTokens: QUESTION_MAX_TOKENS }).finally(function () {
        setSending(false);
      });
    }

    function onComposerKeydown(event) {
      if (!ui.input || event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      if (ui.form) ui.form.requestSubmit();
    }

    function onBack() {
      if (typeof opts.onExit === "function") opts.onExit();
    }

    bindUi();
    if (!session.lessons.length) {
      appendMessage({ role: "assistant", content: "No teaching blocks were found for this course yet." });
      if (ui.nextButton) ui.nextButton.disabled = true;
      return { destroy: function () { disposed = true; } };
    }

    resetBlockState();
    if (ui.form) ui.form.addEventListener("submit", onAsk);
    if (ui.input) {
      ui.input.addEventListener("input", resizeComposer);
      ui.input.addEventListener("keydown", onComposerKeydown);
      resizeComposer();
    }
    if (ui.checkAnswerButton) ui.checkAnswerButton.addEventListener("click", onCheckAnswer);
    if (ui.nextButton) ui.nextButton.addEventListener("click", onNext);
    if (ui.backButton) ui.backButton.addEventListener("click", onBack);
    startLessonBite();

    return {
      destroy: function () {
        disposed = true;
        if (ui.form) ui.form.removeEventListener("submit", onAsk);
        if (ui.input) {
          ui.input.removeEventListener("input", resizeComposer);
          ui.input.removeEventListener("keydown", onComposerKeydown);
        }
        if (ui.checkAnswerButton) ui.checkAnswerButton.removeEventListener("click", onCheckAnswer);
        if (ui.nextButton) ui.nextButton.removeEventListener("click", onNext);
        if (ui.backButton) ui.backButton.removeEventListener("click", onBack);
      }
    };
  }

  function mountCoursePicker(viewRoot, options) {
    var opts = options || {};
    var root = viewRoot && viewRoot.querySelector ? viewRoot : null;
    if (!root) return { destroy: function () {} };

    var select = root.querySelector("[data-synapse-learn-course]");
    var startButton = root.querySelector("[data-synapse-learn-start]");
    var disposed = false;

    function updateStartState() {
      if (!startButton || !select) return;
      var blocked = Boolean(opts.loading || opts.pending);
      startButton.disabled = blocked || !String(select.value || "").trim();
      if (select) select.disabled = blocked;
    }

    function onStart() {
      if (!select || !select.value || typeof opts.onStart !== "function") return;
      var selected = (opts.courses || []).find(function (course) {
        return String(course.id) === String(select.value);
      });
      opts.onStart({
        courseId: select.value,
        courseLabel: (selected && (selected.label || selected.name)) || select.value
      });
    }

    if (select) select.addEventListener("change", updateStartState);
    if (startButton) startButton.addEventListener("click", onStart);
    updateStartState();

    return {
      destroy: function () {
        disposed = true;
        if (select) select.removeEventListener("change", updateStartState);
        if (startButton) startButton.removeEventListener("click", onStart);
      }
    };
  }

  var api = {
    renderCoursePicker: renderCoursePicker,
    renderLearnShell: renderLearnShell,
    mountCourseTeacher: mountCourseTeacher,
    mountCoursePicker: mountCoursePicker
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.nucleusSynapseCourseTeacher = api;
  }
})();
