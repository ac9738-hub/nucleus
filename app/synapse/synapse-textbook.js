// Synapse Textbook — AI textbook platform (Khan-style outline + one scrollable course thread).
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

  function lessonKey(lesson) {
    if (!lesson) return "";
    return String(lesson.id || lesson.index || "");
  }

  function isAnswerLesson(lesson) {
    return Boolean(lesson && (lesson.interaction === "answer" || lesson.type === "problem"));
  }

  function groupLessonsByUnit(lessons) {
    var units = [];
    var indexByTitle = {};
    (lessons || []).forEach(function (lesson, idx) {
      var title = String(lesson.sectionGroup || "Course content").trim() || "Course content";
      if (indexByTitle[title] == null) {
        indexByTitle[title] = units.length;
        units.push({
          title: title,
          sectionIndex: lesson.sectionIndex != null ? lesson.sectionIndex : units.length,
          lessons: []
        });
      }
      units[indexByTitle[title]].lessons.push(Object.assign({}, lesson, { index: idx }));
    });
    units.sort(function (a, b) {
      return (a.sectionIndex || 0) - (b.sectionIndex || 0);
    });
    return units;
  }

  function countCompleted(lessons, completed) {
    var done = 0;
    (lessons || []).forEach(function (lesson, idx) {
      var key = lessonKey(lesson) || String(idx);
      if (completed && completed[key]) done += 1;
    });
    return done;
  }

  function renderCourseCardGrid(courses, meta) {
    var info = meta || {};
    var cards = (courses || []).map(function (course) {
      var label = course.label || course.name || course.id;
      return (
        '<button type="button" class="synapse-textbook-course-card" data-synapse-textbook-course="' +
        escape(course.id) + '">' +
        '<span class="synapse-textbook-course-card-title">' + escape(label) + "</span>" +
        '<span class="synapse-textbook-course-card-meta">Open textbook</span>' +
        "</button>"
      );
    }).join("");
    var status = "";
    if (info.loading || info.pending) {
      status = '<p class="synapse-textbook-status">Loading courses from your Canvas graph…</p>';
    } else if (info.error) {
      status = '<p class="synapse-textbook-error">' + escape(info.error) + "</p>";
    } else if (!(courses || []).length) {
      status = '<p class="synapse-textbook-status">No courses with teaching content yet.</p>';
    }
    return (
      '<section class="synapse-textbook-picker">' +
      '<div class="synapse-textbook-picker-inner">' +
      '<span class="synapse-eyebrow">Synapse</span>' +
      "<h2>Your courses</h2>" +
      "<p>Each course is an AI textbook — pick a unit on the left, learn in one continuous thread.</p>" +
      status +
      '<div class="synapse-textbook-course-grid">' + (cards || '<p class="synapse-textbook-status">No courses available.</p>') + "</div>" +
      "</div>" +
      "</section>"
    );
  }

  function renderOutline(units, session) {
    var activeIndex = session.lessonIndex || 0;
    var completed = session.completedLessonIds || {};
    return units.map(function (unit) {
      var cards = unit.lessons.map(function (lesson) {
        var idx = lesson.index;
        var key = lessonKey(lesson) || String(idx);
        var active = idx === activeIndex ? " is-active" : "";
        var done = completed[key] ? " is-done" : "";
        var typeLabel = lesson.type === "problem" ? "Practice" : lesson.type === "example" ? "Example" : "Lesson";
        return (
          '<button type="button" class="synapse-textbook-lesson-card' + active + done + '" data-synapse-textbook-lesson="' +
          idx + '">' +
          '<span class="synapse-textbook-lesson-type">' + escape(typeLabel) + "</span>" +
          '<span class="synapse-textbook-lesson-name">' + escape(lesson.name || "Untitled") + "</span>" +
          "</button>"
        );
      }).join("");
      return (
        '<div class="synapse-textbook-unit">' +
        '<h3 class="synapse-textbook-unit-title">' + escape(unit.title) + "</h3>" +
        '<div class="synapse-textbook-unit-lessons">' + cards + "</div>" +
        "</div>"
      );
    }).join("");
  }

  function renderTextbookShell(session) {
    var lessons = session.lessons || [];
    var units = groupLessonsByUnit(lessons);
    var completed = countCompleted(lessons, session.completedLessonIds);
    var total = lessons.length;
    var pct = total ? Math.round((completed / total) * 100) : 0;
    var lesson = session.lesson || lessons[session.lessonIndex || 0] || null;

    return (
      '<section class="synapse-textbook" data-synapse-textbook-root>' +
      '<aside class="synapse-textbook-outline" aria-label="Course outline">' +
      '<div class="synapse-textbook-outline-head">' +
      '<button type="button" class="synapse-textbook-back" data-synapse-textbook-back>← Courses</button>' +
      '<h2 class="synapse-textbook-course-name">' + escape(session.courseLabel || session.courseId) + "</h2>" +
      '<div class="synapse-textbook-overall-progress">' +
      '<div class="synapse-textbook-progress-label">' + completed + " / " + total + " lessons</div>" +
      '<div class="synapse-learn-track"><div class="synapse-learn-track-fill" style="width:' + pct + '%"></div></div>' +
      "</div>" +
      "</div>" +
      '<nav class="synapse-textbook-units">' + renderOutline(units, session) + "</nav>" +
      "</aside>" +
      '<div class="synapse-textbook-main">' +
      '<header class="synapse-textbook-main-head">' +
      "<div>" +
      (lesson && lesson.sectionGroup ? '<span class="synapse-textbook-section-chip">' + escape(lesson.sectionGroup) + "</span>" : "") +
      "<h1>" + escape(lesson ? lesson.name : "Course thread") + "</h1>" +
      (lesson && lesson.filename
        ? '<p class="synapse-textbook-source">' + escape(lesson.filename) +
          (lesson.pageNumber != null ? " · p." + lesson.pageNumber : "") + "</p>"
        : "") +
      "</div>" +
      '<button type="button" class="synapse-textbook-continue" data-synapse-textbook-continue>Continue lesson</button>' +
      "</header>" +
      '<div class="synapse-thread synapse-textbook-thread" data-synapse-textbook-thread role="log" aria-live="polite"></div>' +
      '<div class="synapse-learn-answer" data-synapse-textbook-answer-panel hidden>' +
      '<label class="synapse-learn-answer-label" for="synapse-textbook-answer-input">Your answer</label>' +
      '<textarea id="synapse-textbook-answer-input" class="synapse-learn-answer-input" data-synapse-textbook-answer-input rows="3" placeholder="Work the problem, then check your answer…"></textarea>' +
      '<div class="synapse-learn-answer-actions">' +
      '<button type="button" class="synapse-learn-check-answer" data-synapse-textbook-check-answer>Check answer</button>' +
      "</div>" +
      "</div>" +
      '<form class="synapse-composer synapse-textbook-composer" data-synapse-textbook-send>' +
      '<div class="synapse-composer-field">' +
      '<textarea data-synapse-textbook-input rows="1" placeholder="Ask anything about this course…" autocomplete="off"></textarea>' +
      "</div>" +
      '<button type="submit" class="synapse-send-button" data-synapse-textbook-send-button>Ask</button>' +
      "</form>" +
      "</div>" +
      "</section>"
    );
  }

  function renderThreadMessage(message) {
    if (!message) return "";
    if (message.kind === "divider") {
      return (
        '<div class="synapse-textbook-divider" data-synapse-lesson-id="' + escape(message.lessonId || "") + '" id="synapse-lesson-' +
        escape(String(message.lessonIndex != null ? message.lessonIndex : "")) + '">' +
        '<span class="synapse-textbook-divider-label">' + escape(message.title || "Section") + "</span>" +
        "</div>"
      );
    }
    if (message.role !== "user" && message.role !== "assistant") return "";
    var tmpl = templates();
    var roleLabel = message.role === "user" ? "You" : "Synapse";
    return (
      '<div class="synapse-msg synapse-msg-' + message.role + '" data-synapse-role="' + message.role + '">' +
      '<div class="synapse-msg-meta"><span class="synapse-msg-role">' + escape(roleLabel) + "</span></div>" +
      '<div class="synapse-msg-text">' +
      (tmpl && tmpl.formatContent ? tmpl.formatContent(message.content) : escape(message.content)) +
      "</div>" +
      "</div>"
    );
  }

  function buildTeacherSystem(lesson, session, options) {
    var extra = options || {};
    var lessonState = (session.lessonState && session.lessonState[lessonKey(lesson)]) || { bites: [] };
    var bites = lessonState.bites || [];
    var isQuestion = Boolean(extra.isQuestion);
    var isAnswerCheck = Boolean(extra.isAnswerCheck);
    var groundingPrompt = String(lesson.groundingPrompt || "").trim();
    var fallbackContext = String(lesson.teachingContext || lesson.problemStatement || lesson.snippet || "").trim();
    var sourceMaterial = groundingPrompt || fallbackContext;
    var groundingLabels = Array.isArray(lesson.groundingLabels) ? lesson.groundingLabels : [];
    return (
      "You are Synapse — an AI textbook tutor inside Nucleus.\n" +
      "Teach in a clear textbook voice. The student sees one long scrollable thread for the whole course.\n\n" +
      "Current lesson: [" + lesson.type + "] " + lesson.name + "\n" +
      (lesson.sectionGroup ? "Unit: " + lesson.sectionGroup + "\n" : "") +
      "Course: " + (session.courseLabel || session.courseId) + "\n" +
      (lesson.filename ? "Source file: " + lesson.filename + "\n" : "") +
      (isAnswerCheck && lesson.answerKey ? "Reference answer: " + lesson.answerKey + "\n" : "") +
      "\nGrounding:\n" +
      "- Facts must come from lesson sources below.\n" +
      "- Cite sources as [C#] when available: " + (groundingLabels.join(", ") || "none") + "\n\n" +
      "Source material:\n" + sourceMaterial + "\n\n" +
      (isAnswerCheck
        ? "Grade the student's answer briefly (4-8 sentences).\n"
        : isQuestion
        ? "Answer the student's question (4-8 sentences), grounded in sources.\n"
        : isAnswerLesson(lesson)
        ? "Restate the problem, give one hint. Do not reveal full solution. End with [BLOCK_DONE] when done.\n"
        : "Deliver the next teaching bite (4-7 sentences). Prior bites this lesson: " +
          (bites.length ? bites.join(" | ") : "none") +
          ". End with [BLOCK_DONE] when this lesson is fully covered.\n")
    );
  }

  function bitePrompt(session, lessonState) {
    var count = (lessonState && lessonState.bites || []).length;
    return count
      ? "Continue this lesson with the next teaching bite."
      : "Open this lesson with the first teaching bite.";
  }

  function mountTextbookPicker(viewRoot, options) {
    var opts = options || {};
    var root = viewRoot && viewRoot.querySelector ? viewRoot : null;
    if (!root) return { destroy: function () {} };

    function onClick(event) {
      var btn = event.target.closest("[data-synapse-textbook-course]");
      if (!btn || typeof opts.onStart !== "function") return;
      var courseId = btn.getAttribute("data-synapse-textbook-course");
      var selected = (opts.courses || []).find(function (c) {
        return String(c.id) === String(courseId);
      });
      opts.onStart({
        courseId: courseId,
        courseLabel: (selected && (selected.label || selected.name)) || courseId
      });
    }

    root.addEventListener("click", onClick);
    return {
      destroy: function () {
        root.removeEventListener("click", onClick);
      }
    };
  }

  function mountTextbook(viewRoot, options) {
    var opts = options || {};
    var t = templates();
    var root = viewRoot && viewRoot.querySelector ? viewRoot : null;
    if (!root || !t) return { destroy: function () {} };

    var bridge = opts.bridge;
    var session = {
      courseId: opts.courseId || "",
      courseLabel: opts.courseLabel || "",
      lessons: opts.lessons || [],
      lessonIndex: opts.lessonIndex || 0,
      courseThread: Array.isArray(opts.courseThread) ? opts.courseThread.slice() : [],
      completedLessonIds: Object.assign({}, opts.completedLessonIds || {}),
      lessonState: Object.assign({}, opts.lessonState || {})
    };
    var disposed = false;
    var sending = false;
    var ui = {};

    function persist() {
      if (typeof opts.onSessionChange === "function") {
        opts.onSessionChange({
          courseThread: session.courseThread.slice(),
          completedLessonIds: Object.assign({}, session.completedLessonIds),
          lessonState: Object.assign({}, session.lessonState),
          lessonIndex: session.lessonIndex
        });
      }
    }

    function currentLesson() {
      return session.lessons[session.lessonIndex] || null;
    }

    function getLessonState(lesson) {
      var key = lessonKey(lesson);
      if (!session.lessonState[key]) {
        session.lessonState[key] = { bites: [], modelMessages: [], blockDone: false, started: false };
      }
      return session.lessonState[key];
    }

    function bindUi() {
      ui.root = root.querySelector("[data-synapse-textbook-root]");
      ui.thread = root.querySelector("[data-synapse-textbook-thread]");
      ui.form = root.querySelector("[data-synapse-textbook-send]");
      ui.input = root.querySelector("[data-synapse-textbook-input]");
      ui.sendButton = root.querySelector("[data-synapse-textbook-send-button]");
      ui.continueButton = root.querySelector("[data-synapse-textbook-continue]");
      ui.backButton = root.querySelector("[data-synapse-textbook-back]");
      ui.answerPanel = root.querySelector("[data-synapse-textbook-answer-panel]");
      ui.answerInput = root.querySelector("[data-synapse-textbook-answer-input]");
      ui.checkAnswerButton = root.querySelector("[data-synapse-textbook-check-answer]");
    }

    function renderThread() {
      if (!ui.thread) return;
      ui.thread.innerHTML = session.courseThread.map(renderThreadMessage).join("");
      ui.thread.scrollTop = ui.thread.scrollHeight;
    }

    function appendThread(entry) {
      session.courseThread.push(entry);
      if (ui.thread) {
        ui.thread.insertAdjacentHTML("beforeend", renderThreadMessage(entry));
        ui.thread.scrollTop = ui.thread.scrollHeight;
      }
      persist();
    }

    function lessonDivider(lesson) {
      return {
        kind: "divider",
        lessonId: lessonKey(lesson),
        lessonIndex: lesson.index,
        title: (lesson.sectionGroup ? lesson.sectionGroup + " · " : "") + (lesson.name || "Lesson")
      };
    }

    function markLessonStarted(lesson) {
      var key = lessonKey(lesson);
      var state = getLessonState(lesson);
      if (state.started) return false;
      state.started = true;
      appendThread(lessonDivider(lesson));
      return true;
    }

    function selectLesson(index) {
      if (index < 0 || index >= session.lessons.length) return;
      session.lessonIndex = index;
      session.lesson = session.lessons[index];
      updateActiveCards();
      updateAnswerPanel();
      markLessonStarted(session.lesson);
      var anchor = root.querySelector("#synapse-lesson-" + index);
      if (anchor && ui.thread) {
        anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      persist();
    }

    function updateActiveCards() {
      root.querySelectorAll("[data-synapse-textbook-lesson]").forEach(function (btn) {
        var idx = parseInt(btn.getAttribute("data-synapse-textbook-lesson"), 10);
        btn.classList.toggle("is-active", idx === session.lessonIndex);
        var lesson = session.lessons[idx];
        var key = lessonKey(lesson);
        btn.classList.toggle("is-done", Boolean(session.completedLessonIds[key]));
      });
    }

    function updateAnswerPanel() {
      var lesson = currentLesson();
      var show = lesson && isAnswerLesson(lesson);
      if (ui.answerPanel) ui.answerPanel.hidden = !show;
    }

    function setSending(on) {
      sending = on;
      if (ui.sendButton) ui.sendButton.disabled = on;
      if (ui.continueButton) ui.continueButton.disabled = on;
      if (ui.checkAnswerButton) ui.checkAnswerButton.disabled = on;
    }

    function buildModelMessages(lessonState, extra) {
      var rows = (lessonState.modelMessages || []).slice();
      if (extra && (extra.isQuestion || extra.isAnswerCheck)) {
        rows = rows.filter(function (row) { return !row.internal; });
      }
      return rows.map(function (row) {
        return { role: row.role, content: row.content };
      });
    }

    function sendToModel(userText, extra) {
      var lesson = currentLesson();
      if (!lesson || !bridge || typeof bridge.send !== "function") {
        return Promise.resolve({ ok: false, error: "Unavailable" });
      }
      var lessonState = getLessonState(lesson);
      var messages = buildModelMessages(lessonState, extra);
      if (userText) messages.push({ role: "user", content: userText });

      var requestId = "tb:" + Date.now() + ":" + Math.random().toString(36).slice(2);
      var buffer = "";
      var node = null;
      var unsubscribe = null;

      function pushDelta(delta) {
        buffer += delta || "";
        if (node) {
          var textEl = node.querySelector(".synapse-msg-text");
          if (textEl) textEl.innerHTML = t.formatContent ? t.formatContent(buffer) : escape(buffer);
        }
      }

      if (ui.thread) {
        node = document.createElement("div");
        node.className = "synapse-msg synapse-msg-assistant";
        node.innerHTML = '<div class="synapse-msg-meta"><span class="synapse-msg-role">Synapse</span></div><div class="synapse-msg-text"></div>';
        ui.thread.appendChild(node);
      }

      if (bridge && typeof bridge.on === "function") {
        unsubscribe = bridge.on("synapse:response-chunk", function (payload) {
          if (payload && payload.requestId === requestId) pushDelta(payload.delta || "");
        });
      }

      return Promise.resolve(
        bridge.send({
          requestId: requestId,
          conversationId: "textbook:" + session.courseId,
          model: opts.model || t.DEFAULT_MODEL,
          maxTokens: (extra && extra.maxTokens) || BITE_MAX_TOKENS,
          system: buildTeacherSystem(lesson, session, extra),
          messages: messages
        })
      ).then(function (result) {
        if (typeof unsubscribe === "function") unsubscribe();
        var finalText = (result && result.text) || buffer;
        if (!result || result.ok === false) {
          if (node) node.remove();
          return result;
        }
        var cleaned = String(finalText || "").trim();
        var entry = { role: "assistant", content: cleaned, lessonId: lessonKey(lesson), createdAt: Date.now() };
        appendThread(entry);
        lessonState.modelMessages.push({ role: "assistant", content: cleaned });
        if (!(extra && (extra.isQuestion || extra.isAnswerCheck))) {
          lessonState.bites.push(cleaned);
        }
        if (/\[BLOCK_DONE\]/i.test(cleaned)) {
          lessonState.blockDone = true;
          session.completedLessonIds[lessonKey(lesson)] = true;
          updateActiveCards();
        }
        persist();
        return result;
      }).catch(function (err) {
        if (typeof unsubscribe === "function") unsubscribe();
        if (node) node.remove();
        return { ok: false, error: (err && err.message) || "Failed" };
      });
    }

    function continueLesson() {
      if (sending || disposed) return;
      var lesson = currentLesson();
      if (!lesson) return;
      markLessonStarted(lesson);
      var lessonState = getLessonState(lesson);
      if (lessonState.blockDone) return;
      setSending(true);
      lessonState.modelMessages.push({ role: "user", content: bitePrompt(session, lessonState), internal: true });
      sendToModel(null, { maxTokens: BITE_MAX_TOKENS }).finally(function () { setSending(false); });
    }

    function onAsk(event) {
      event.preventDefault();
      if (sending || !ui.input) return;
      var text = String(ui.input.value || "").trim();
      if (!text) return;
      appendThread({ role: "user", content: text, lessonId: lessonKey(currentLesson()), createdAt: Date.now() });
      getLessonState(currentLesson()).modelMessages.push({ role: "user", content: text });
      ui.input.value = "";
      setSending(true);
      sendToModel(null, { isQuestion: true, maxTokens: QUESTION_MAX_TOKENS }).finally(function () { setSending(false); });
    }

    bindUi();
    session.lesson = currentLesson();
    renderThread();
    updateActiveCards();
    updateAnswerPanel();

    if (ui.form) ui.form.addEventListener("submit", onAsk);
    if (ui.continueButton) ui.continueButton.addEventListener("click", continueLesson);
    if (ui.backButton) ui.backButton.addEventListener("click", function () {
      if (typeof opts.onExit === "function") opts.onExit();
    });
    root.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-synapse-textbook-lesson]");
      if (!btn) return;
      selectLesson(parseInt(btn.getAttribute("data-synapse-textbook-lesson"), 10));
    });

    if (!session.courseThread.length && session.lessons.length) {
      selectLesson(session.lessonIndex);
      continueLesson();
    }

    return {
      destroy: function () {
        disposed = true;
        if (ui.form) ui.form.removeEventListener("submit", onAsk);
        if (ui.continueButton) ui.continueButton.removeEventListener("click", continueLesson);
      }
    };
  }

  var api = {
    groupLessonsByUnit: groupLessonsByUnit,
    renderCourseCardGrid: renderCourseCardGrid,
    renderTextbookShell: renderTextbookShell,
    mountTextbookPicker: mountTextbookPicker,
    mountTextbook: mountTextbook
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.nucleusSynapseTextbook = api;
  }
})();
