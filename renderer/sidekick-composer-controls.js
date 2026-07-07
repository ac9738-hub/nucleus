// LUMI composer dropdowns (answer mode + model).
(function () {
  "use strict";

  var MODEL_LABELS = {
    "claude-sonnet-4-6": "Sonnet 4.6",
    "claude-opus-4-8": "Opus 4.8",
    "claude-haiku-4-5-20251001": "Haiku 4.5",
    "deepseek-chat": "DeepSeek"
  };

  var MODE_LABELS = {
    grounded: "Grounded",
    general: "General"
  };

  function normalizeMode(value) {
    return String(value || "").trim().toLowerCase() === "general" ? "general" : "grounded";
  }

  function normalizeModel(value) {
    var id = String(value || "").trim();
    return MODEL_LABELS[id] ? id : "claude-sonnet-4-6";
  }

  function closeAllDropdowns(except) {
    document.querySelectorAll(".ai-dropdown.is-open").forEach(function (node) {
      if (except && node === except) return;
      node.classList.remove("is-open");
      var trigger = node.querySelector(".ai-dropdown-trigger");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  }

  function bindDropdown(root, options) {
    if (!root) return;
    var trigger = root.querySelector(".ai-dropdown-trigger");
    var panel = root.querySelector(".ai-dropdown-panel");
    var valueEl = options.valueEl;
    if (!trigger || !panel) return;

    trigger.addEventListener("click", function (event) {
      event.stopPropagation();
      var open = root.classList.contains("is-open");
      closeAllDropdowns();
      if (!open) {
        root.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
      }
    });

    panel.querySelectorAll(".ai-dropdown-option").forEach(function (option) {
      option.addEventListener("click", function () {
        var value = option.getAttribute("data-value");
        if (!value) return;
        panel.querySelectorAll(".ai-dropdown-option").forEach(function (item) {
          var active = item === option;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-selected", active ? "true" : "false");
        });
        if (valueEl) valueEl.textContent = options.labelFor(value);
        root.classList.remove("is-open");
        trigger.setAttribute("aria-expanded", "false");
        options.onSelect(value);
      });
    });
  }

  function setDropdownValue(root, value, label) {
    if (!root) return;
    var panel = root.querySelector(".ai-dropdown-panel");
    var valueEl = root.querySelector(".ai-dropdown-value");
    if (valueEl) valueEl.textContent = label;
    if (!panel) return;
    panel.querySelectorAll(".ai-dropdown-option").forEach(function (option) {
      var active = option.getAttribute("data-value") === value;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function init(config) {
    config = config || {};
    var modeRoot = document.getElementById("ai-answer-mode-dropdown");
    var modelRoot = document.getElementById("ai-model-dropdown");
    var modeValueEl = document.getElementById("ai-answer-mode-value");
    var modelValueEl = document.getElementById("ai-model-value");

    var state = {
      answerMode: normalizeMode(config.answerMode),
      sidekickModel: normalizeModel(config.sidekickModel)
    };

    function syncModeUi() {
      setDropdownValue(modeRoot, state.answerMode, MODE_LABELS[state.answerMode]);
      if (typeof config.onModeChange === "function") config.onModeChange(state.answerMode);
    }

    function syncModelUi() {
      setDropdownValue(modelRoot, state.sidekickModel, MODEL_LABELS[state.sidekickModel]);
      if (typeof config.onModelChange === "function") config.onModelChange(state.sidekickModel);
    }

    bindDropdown(modeRoot, {
      valueEl: modeValueEl,
      labelFor: function (value) { return MODE_LABELS[normalizeMode(value)]; },
      onSelect: function (value) {
        state.answerMode = normalizeMode(value);
        syncModeUi();
      }
    });

    bindDropdown(modelRoot, {
      valueEl: modelValueEl,
      labelFor: function (value) { return MODEL_LABELS[normalizeModel(value)]; },
      onSelect: function (value) {
        state.sidekickModel = normalizeModel(value);
        syncModelUi();
      }
    });

    document.addEventListener("click", function () { closeAllDropdowns(); });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeAllDropdowns();
    });

    setDropdownValue(modeRoot, state.answerMode, MODE_LABELS[state.answerMode]);
    setDropdownValue(modelRoot, state.sidekickModel, MODEL_LABELS[state.sidekickModel]);

    return {
      getAnswerMode: function () { return state.answerMode; },
      getSidekickModel: function () { return state.sidekickModel; },
      setAnswerMode: function (value) {
        state.answerMode = normalizeMode(value);
        setDropdownValue(modeRoot, state.answerMode, MODE_LABELS[state.answerMode]);
      },
      setSidekickModel: function (value) {
        state.sidekickModel = normalizeModel(value);
        setDropdownValue(modelRoot, state.sidekickModel, MODEL_LABELS[state.sidekickModel]);
      }
    };
  }

  window.SidekickComposerControls = {
    init: init,
    normalizeMode: normalizeMode,
    normalizeModel: normalizeModel
  };
})();
