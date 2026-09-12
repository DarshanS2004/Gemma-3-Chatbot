const state = {
  userName: window.__BOOTSTRAP__.userName || "Darshan",
  conversations: [],
  activeChatId: null,
  activeConversation: null,
  settings: {
    region: "",
    model_id: "",
    enable_web_search: true,
  },
  openChatMenu: null,
  openMessageMenu: null,
  openComposerMenu: null,
  pendingFiles: [],
  pendingUploads: {
    documents: [],
    images: [],
  },
  chatModes: {},
  sidebarCollapsed: false,
  pinnedChats: JSON.parse(window.localStorage.getItem("gemmaPinnedChats") || "[]"),
  openModal: null,
  revealSecrets: {
    access_key: false,
    secret_key: false,
    session_token: false,
  },
  micListening: false,
  speechRecognition: null,
  micTargetId: null,
  micBaseText: "",
  micShouldContinue: false,
  micStopping: false,
  micSessionId: 0,
  micRestartTimer: null,
  sendingPrompt: false,
  editTargetIndex: null,
};

const MODE_CONFIG = {
  summarize: {
    label: "Summarize file",
    hint: "Your next message will focus on summarizing the uploaded file(s).",
    promptPrefix: "Summarize the uploaded file(s) clearly and accurately. User request: ",
    defaultDisplayPrompt: "Summarize this file",
    defaultModelPrompt: "Please summarize the uploaded file(s) clearly and accurately.",
  },
  inspect: {
    label: "Inspect image",
    hint: "Your next message will focus on analyzing the uploaded image(s).",
    promptPrefix: "Inspect the uploaded image(s) in detail and answer the user's request. User request: ",
    defaultDisplayPrompt: "Inspect this image",
    defaultModelPrompt: "Please inspect the uploaded image(s) and explain what you observe clearly.",
  },
  web: {
    label: "Search the web",
    hint: "Your next message will use live web search for the latest information.",
    promptPrefix: "Use live web search to answer this with up-to-date information. User request: ",
    enableWebSearch: true,
    defaultDisplayPrompt: "Search the web",
    defaultModelPrompt: "Use live web search and provide the most relevant up-to-date information.",
  },
  code: {
    label: "Write code",
    hint: "Your next message will prioritize code generation and implementation help.",
    promptPrefix: "Write code for this request and explain the implementation clearly. User request: ",
    defaultDisplayPrompt: "Write code",
    defaultModelPrompt: "Write useful code for this request and explain the implementation clearly.",
  },
};

const mainView = document.getElementById("main-view");
const chatList = document.getElementById("chat-list");
const historySearch = document.getElementById("history-search");
const hiddenDocUpload = document.getElementById("hidden-doc-upload");
const hiddenImageUpload = document.getElementById("hidden-image-upload");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const sidebarSearchToggle = document.getElementById("sidebar-search-toggle");
const modalRoot = document.getElementById("modal-root");
const tooltipRoot = document.getElementById("tooltip-root");
let tooltipShowTimer = null;
let tooltipHideTimer = null;

function getModeKey() {
  return state.activeChatId || "draft";
}

function getActiveMode() {
  return state.chatModes[getModeKey()] || null;
}

function setActiveMode(mode) {
  if (!MODE_CONFIG[mode]) return;
  state.chatModes[getModeKey()] = mode;
}

function clearActiveMode() {
  delete state.chatModes[getModeKey()];
}

function migrateDraftMode(chatId) {
  if (!chatId || !state.chatModes.draft) return;
  state.chatModes[chatId] = state.chatModes.draft;
  delete state.chatModes.draft;
}

function escapeHtml(value = "") {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function markdownToHtml(text = "") {
  const inlineMarkdown = (value = "") => {
    let output = escapeHtml(value.trim());
    output = output.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    output = output.replace(/\*(.*?)\*/g, "<em>$1</em>");
    output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
    return output;
  };

  const highlightCode = (source = "", language = "") => {
    const genericKeywordPattern = "(?:function|return|const|let|var|if|else|for|while|break|continue|class|new|import|from|export|default|try|catch|finally|throw|async|await|def|print|in|range|True|False|None|and|or|not)";
    const pythonKeywordPattern = "(?:def|return|import|from|as|if|elif|else|for|while|break|continue|class|try|except|finally|raise|with|lambda|yield|True|False|None|and|or|not|in|is|pass)";
    const jsKeywordPattern = "(?:function|return|const|let|var|if|else|for|while|break|continue|class|new|import|from|export|default|try|catch|finally|throw|async|await|true|false|null|undefined)";
    const keywordPattern = language.includes("python")
      ? pythonKeywordPattern
      : language.includes("js") || language.includes("ts")
        ? jsKeywordPattern
        : genericKeywordPattern;

    const tokenRegex = new RegExp(
      `(#.*$|\\/\\/.*$|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\\b\\d+(?:\\.\\d+)?\\b|\\b${keywordPattern}\\b)`,
      "gm"
    );

    let html = "";
    let lastIndex = 0;
    let match;

    while ((match = tokenRegex.exec(source)) !== null) {
      const token = match[0];
      html += escapeHtml(source.slice(lastIndex, match.index));

      let className = "token-plain";
      if (token.startsWith("#") || token.startsWith("//")) {
        className = "token-comment";
      } else if (
        (token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"))
      ) {
        className = "token-string";
      } else if (/^\d/.test(token)) {
        className = "token-number";
      } else {
        className = "token-keyword";
      }

      html += `<span class="${className}">${escapeHtml(token)}</span>`;
      lastIndex = tokenRegex.lastIndex;
    }

    html += escapeHtml(source.slice(lastIndex));
    return html;
  };

  const normalized = (text || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";

  const segments = [];
  const lines = normalized.split("\n");
  let textBuffer = [];
  let codeBuffer = [];
  let inFence = false;
  let activeFence = "";
  let activeLanguage = "";

  const flushText = () => {
    if (!textBuffer.length) return;
    const content = textBuffer.join("\n").trim();
    if (content) {
      segments.push({ type: "text", content });
    }
    textBuffer = [];
  };

  const flushCode = () => {
    segments.push({
      type: "code",
      language: activeLanguage,
      content: codeBuffer.join("\n").replace(/\n+$/, ""),
    });
    codeBuffer = [];
    activeFence = "";
    activeLanguage = "";
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)\s*([a-zA-Z0-9_+#.-]*)\s*$/);

    if (!inFence && fenceMatch) {
      flushText();
      inFence = true;
      activeFence = fenceMatch[1][0];
      activeLanguage = (fenceMatch[2] || "").trim().toLowerCase();
      continue;
    }

    if (inFence) {
      const closingFence = new RegExp(`^\\s*${activeFence}{3,}\\s*$`);
      if (closingFence.test(line)) {
        flushCode();
        inFence = false;
        continue;
      }
      codeBuffer.push(line);
      continue;
    }

    textBuffer.push(line);
  }

  if (inFence) {
    textBuffer.push(`${activeFence.repeat(3)}${activeLanguage ? activeLanguage : ""}`);
    if (codeBuffer.length) {
      textBuffer.push(...codeBuffer);
    }
  }

  flushText();

  return segments.map((segment) => {
    if (segment.type === "code") {
      const label = segment.language || "code";
      const highlighted = highlightCode(segment.content, segment.language);
      return `
        <div class="code-block">
          <div class="code-block-header">
            <span class="code-language">${escapeHtml(label)}</span>
            <button class="code-copy-button" data-action="copy-code" data-code="${encodeURIComponent(segment.content)}">Copy code</button>
          </div>
          <pre><code>${highlighted}</code></pre>
        </div>
      `;
    }

    const blocks = segment.content
      .trim()
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);

    return blocks.map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      if (!lines.length) return "";

      if (lines.length === 1 && /^###\s+/.test(lines[0])) {
        return `<h3>${inlineMarkdown(lines[0].replace(/^###\s+/, ""))}</h3>`;
      }
      if (lines.length === 1 && /^##\s+/.test(lines[0])) {
        return `<h2>${inlineMarkdown(lines[0].replace(/^##\s+/, ""))}</h2>`;
      }
      if (lines.length === 1 && /^#\s+/.test(lines[0])) {
        return `<h1>${inlineMarkdown(lines[0].replace(/^#\s+/, ""))}</h1>`;
      }

      if (lines.every((line) => /^[-*]\s+/.test(line))) {
        const items = lines
          .map((line) => `<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }

      if (lines.every((line) => /^\d+\.\s+/.test(line))) {
        const items = lines
          .map((line) => `<li>${inlineMarkdown(line.replace(/^\d+\.\s+/, ""))}</li>`)
          .join("");
        return `<ol>${items}</ol>`;
      }

      return `<p>${inlineMarkdown(lines.join(" "))}</p>`;
    }).join("");
  }).join("");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove("show"), 1800);
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Request failed");
  }
  return response.json();
}

function resetPending() {
  state.pendingFiles = [];
  state.pendingUploads = {
    documents: [],
    images: [],
  };
  state.editTargetIndex = null;
  const dockInput = document.getElementById("dock-prompt");
  const homeInput = document.getElementById("home-prompt");
  if (dockInput) delete dockInput.dataset.replaceIndex;
  if (homeInput) delete homeInput.dataset.replaceIndex;
}

function savePinnedChats() {
  window.localStorage.setItem("gemmaPinnedChats", JSON.stringify(state.pinnedChats));
}

function titleFromPrompt(prompt = "") {
  const compact = (prompt || "").trim().replace(/\s+/g, " ");
  if (!compact) return "New chat";
  return compact.length <= 48 ? compact : `${compact.slice(0, 45).trimEnd()}...`;
}

function buildPromptSubmission(rawPrompt = "") {
  const cleanPrompt = (rawPrompt || "").trim();
  const activeMode = getActiveMode();
  const modeConfig = activeMode ? MODE_CONFIG[activeMode] : null;
  const hasPendingDocs = state.pendingUploads.documents.length > 0;
  const hasPendingImages = state.pendingUploads.images.length > 0;

  if (cleanPrompt) {
    return {
      displayPrompt: cleanPrompt,
      modelPrompt: modeConfig ? `${modeConfig.promptPrefix}${cleanPrompt}` : cleanPrompt,
      modeConfig,
    };
  }

  if (modeConfig?.defaultDisplayPrompt && modeConfig?.defaultModelPrompt) {
    return {
      displayPrompt: modeConfig.defaultDisplayPrompt,
      modelPrompt: modeConfig.defaultModelPrompt,
      modeConfig,
    };
  }

  if (hasPendingImages) {
    return {
      displayPrompt: MODE_CONFIG.inspect.defaultDisplayPrompt,
      modelPrompt: MODE_CONFIG.inspect.defaultModelPrompt,
      modeConfig: MODE_CONFIG.inspect,
    };
  }

  if (hasPendingDocs) {
    return {
      displayPrompt: MODE_CONFIG.summarize.defaultDisplayPrompt,
      modelPrompt: MODE_CONFIG.summarize.defaultModelPrompt,
      modeConfig: MODE_CONFIG.summarize,
    };
  }

  return null;
}

function isPinned(chatId) {
  return state.pinnedChats.includes(chatId);
}

function orderedConversations() {
  return [...state.conversations].sort((left, right) => {
    const leftPinned = isPinned(left.id) ? 1 : 0;
    const rightPinned = isPinned(right.id) ? 1 : 0;
    if (leftPinned !== rightPinned) return rightPinned - leftPinned;
    return 0;
  });
}

function applySidebarState() {
  sidebar.classList.toggle("collapsed", state.sidebarCollapsed);
  sidebarToggle.dataset.tooltip = state.sidebarCollapsed ? "Expand menu" : "Collapse menu";
}

function hideTooltip() {
  if (tooltipShowTimer) {
    window.clearTimeout(tooltipShowTimer);
    tooltipShowTimer = null;
  }
  if (tooltipHideTimer) {
    window.clearTimeout(tooltipHideTimer);
  }
  tooltipRoot.classList.remove("is-visible");
  tooltipHideTimer = window.setTimeout(() => {
    tooltipRoot.hidden = true;
    tooltipRoot.textContent = "";
    tooltipRoot.className = "app-tooltip";
    tooltipRoot.style.left = "-9999px";
    tooltipRoot.style.top = "-9999px";
    tooltipHideTimer = null;
  }, 90);
}

function positionTooltip(target, position) {
  const rect = target.getBoundingClientRect();
  const tooltipRect = tooltipRoot.getBoundingClientRect();
  const gap = 12;

  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  let top = rect.bottom + gap;

  if (position === "right") {
    left = rect.right + gap;
    top = rect.top + rect.height / 2 - tooltipRect.height / 2;
  } else if (position === "left") {
    left = rect.left - tooltipRect.width - gap;
    top = rect.top + rect.height / 2 - tooltipRect.height / 2;
  } else if (position === "bottom") {
    left = rect.left + rect.width / 2 - tooltipRect.width / 2;
    top = rect.bottom + gap;
  }

  const maxLeft = window.innerWidth - tooltipRect.width - 14;
  const maxTop = window.innerHeight - tooltipRect.height - 14;
  left = Math.min(Math.max(14, left), Math.max(14, maxLeft));
  top = Math.min(Math.max(14, top), Math.max(14, maxTop));

  tooltipRoot.style.left = `${left}px`;
  tooltipRoot.style.top = `${top}px`;
}

function queueTooltip(target) {
  if (tooltipHideTimer) {
    window.clearTimeout(tooltipHideTimer);
    tooltipHideTimer = null;
  }
  if (tooltipShowTimer) {
    window.clearTimeout(tooltipShowTimer);
  }
  const text = target?.dataset?.tooltip;
  if (!text) return;
  tooltipShowTimer = window.setTimeout(() => {
    showTooltip(target);
    tooltipShowTimer = null;
  }, 180);
}

function showTooltip(target) {
  if (tooltipHideTimer) {
    window.clearTimeout(tooltipHideTimer);
    tooltipHideTimer = null;
  }
  if (tooltipShowTimer) {
    window.clearTimeout(tooltipShowTimer);
    tooltipShowTimer = null;
  }
  const text = target?.dataset?.tooltip;
  if (!text) return;

  const position = target.dataset.tooltipPosition || "bottom";
  tooltipRoot.hidden = false;
  tooltipRoot.textContent = text;
  tooltipRoot.className = `app-tooltip pos-${position}`;
  tooltipRoot.style.left = "-9999px";
  tooltipRoot.style.top = "-9999px";
  positionTooltip(target, position);
  requestAnimationFrame(() => {
    tooltipRoot.classList.add("is-visible");
  });
}

function syncMicButtons() {
  document.querySelectorAll('[data-action="mic"]').forEach((button) => {
    button.classList.toggle("is-listening", state.micListening);
    button.setAttribute("aria-pressed", state.micListening ? "true" : "false");
  });
}

function getComposerInput() {
  return document.getElementById("dock-prompt") || document.getElementById("home-prompt");
}

function getComposerInputById(inputId) {
  return inputId ? document.getElementById(inputId) : getComposerInput();
}

function maskSecret(value = "") {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}${"•".repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

function secretFieldMarkup(key, label) {
  const revealed = state.revealSecrets[key];
  const rawValue = state.settings[key] || "";
  const displayValue = revealed ? rawValue : maskSecret(rawValue);
  return `
    <label class="settings-field">
      <span>${label}</span>
      <div class="settings-secret-row">
        <input
          class="settings-input"
          id="settings-${key}"
          data-setting-key="${key}"
          type="${revealed ? "text" : "password"}"
          value="${escapeHtml(displayValue)}"
          autocomplete="off"
          spellcheck="false"
          readonly
        >
        <button class="secret-toggle" type="button" data-action="toggle-secret" data-key="${key}">
          ${revealed ? "Hide" : "Show"}
        </button>
      </div>
    </label>
  `;
}

function renderModal() {
  if (state.openModal !== "settings") {
    modalRoot.innerHTML = "";
    return;
  }

  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="settings-modal" role="dialog" aria-modal="true" aria-label="Settings" data-modal-surface="true">
        <div class="settings-header">
          <div>
            <div class="settings-title">Settings</div>
            <div class="settings-subtitle">Review the Bedrock configuration and credentials used by this dashboard.</div>
          </div>
          <button class="chrome-button" type="button" data-action="close-modal" aria-label="Close settings">&times;</button>
        </div>
        <div class="settings-grid">
          <label class="settings-field">
            <span>AWS Region</span>
            <input class="settings-input" id="settings-region" type="text" value="${escapeHtml(state.settings.region || "")}">
          </label>
          <label class="settings-field">
            <span>Bedrock Model ID</span>
            <input class="settings-input" id="settings-model_id" type="text" value="${escapeHtml(state.settings.model_id || "")}">
          </label>
          ${secretFieldMarkup("access_key", "AWS Access Key ID")}
          ${secretFieldMarkup("secret_key", "AWS Secret Access Key")}
          ${secretFieldMarkup("session_token", "AWS Session Token")}
          <label class="settings-field">
            <span>Temperature</span>
            <input class="settings-input" id="settings-temperature" type="number" min="0" max="1" step="0.1" value="${escapeHtml(String(state.settings.temperature ?? 0.4))}">
          </label>
          <label class="settings-field">
            <span>Max Tokens</span>
            <input class="settings-input" id="settings-max_tokens" type="number" min="100" max="4096" step="50" value="${escapeHtml(String(state.settings.max_tokens ?? 1400))}">
          </label>
          <label class="settings-field settings-field-checkbox">
            <span>Enable live web search</span>
            <input id="settings-enable_web_search" type="checkbox" ${state.settings.enable_web_search ? "checked" : ""}>
          </label>
        </div>
        <div class="settings-actions">
          <button class="settings-secondary" type="button" data-action="close-modal">Close</button>
          <button class="settings-primary" type="button" data-action="save-settings">Save settings</button>
        </div>
      </div>
    </div>
  `;
}

function renderSidebar() {
  chatList.innerHTML = orderedConversations()
    .map((chat) => {
      const active = chat.id === state.activeChatId ? " active" : "";
      const pinned = isPinned(chat.id) ? " pinned" : "";
      const menu = state.openChatMenu === chat.id
        ? `
          <div class="chat-menu">
            <button data-action="toggle-pin-chat" data-chat-id="${chat.id}">${isPinned(chat.id) ? "Unpin" : "Pin"}</button>
            <button data-action="rename-chat" data-chat-id="${chat.id}">Rename</button>
            <button data-action="delete-chat" data-chat-id="${chat.id}">Delete</button>
          </div>
        `
        : "";
      return `
        <div class="chat-row${active}${pinned}">
            <button class="chat-open" data-action="open-chat" data-chat-id="${chat.id}" data-tooltip="${escapeHtml(chat.title || "New chat")}" data-tooltip-position="right">
              <span class="chat-open-text">${escapeHtml(chat.title || "New chat")}</span>
            </button>
            <div class="chat-menu-wrap">
            <button class="chat-menu-button" data-action="toggle-chat-menu" data-chat-id="${chat.id}" aria-label="Chat options" data-tooltip="More" data-tooltip-position="right">&#8942;</button>
              ${menu}
            </div>
          </div>
        `;
    })
    .join("");
  applySidebarState();
}

function iconTools() {
  return `
    <span class="icon-tools" aria-hidden="true">
      <span></span><span></span><span></span>
    </span>
  `;
}

function iconMic() {
  return `
    <svg viewBox="0 0 24 24" class="icon-svg" aria-hidden="true">
      <path d="M12 15a3.2 3.2 0 0 0 3.2-3.2V7.2a3.2 3.2 0 1 0-6.4 0v4.6A3.2 3.2 0 0 0 12 15Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M6.8 11a5.2 5.2 0 0 0 10.4 0M12 16v3.4M9.4 19.4h5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  `;
}

function iconSend() {
  return `
    <svg viewBox="0 0 24 24" class="icon-svg icon-send-svg" aria-hidden="true">
      <path d="M8 6.8L17.6 12 8 17.2" fill="none" stroke="currentColor" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

function iconThumb(direction) {
  const rotate = direction === "down" ? ' transform="rotate(180 12 12)"' : "";
  return `
    <svg viewBox="0 0 24 24" class="icon-svg" aria-hidden="true">
      <path d="M10 21H6.8A1.8 1.8 0 0 1 5 19.2v-6.4A1.8 1.8 0 0 1 6.8 11H10m0 10V11m0 10 4.8 0a2.7 2.7 0 0 0 2.6-2l1.1-4.6a2.2 2.2 0 0 0-2.1-2.7H13V7.7a2.7 2.7 0 0 0-.8-1.9L10.8 4.4A1.1 1.1 0 0 0 9 5.2V11"${rotate} fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

function iconRetry() {
  return `
    <svg viewBox="0 0 24 24" class="icon-svg" aria-hidden="true">
      <path d="M20 6v5h-5M19 11a7 7 0 1 0 1.4 4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

function iconCopy() {
  return `
    <svg viewBox="0 0 24 24" class="icon-svg" aria-hidden="true">
      <rect x="9" y="7" width="10" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"></rect>
      <path d="M15 7V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  `;
}

function iconEdit() {
  return `
    <svg viewBox="0 0 24 24" class="icon-svg" aria-hidden="true">
      <path d="M4 20h4l10-10-4-4L4 16v4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
      <path d="M13 7l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
    </svg>
  `;
}

function iconMore() {
  return `
    <svg viewBox="0 0 24 24" class="icon-svg" aria-hidden="true">
      <circle cx="12" cy="5.5" r="1.7" fill="currentColor"></circle>
      <circle cx="12" cy="12" r="1.7" fill="currentColor"></circle>
      <circle cx="12" cy="18.5" r="1.7" fill="currentColor"></circle>
    </svg>
  `;
}

function iconDownload() {
  return `
    <svg viewBox="0 0 24 24" class="icon-svg" aria-hidden="true">
      <path d="M12 4v10m0 0 4-4m-4 4-4-4M5 18.5h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
}

function pendingMarkup() {
  if (!state.pendingFiles.length) return "";
  return `
    <div class="upload-strip in-composer">
      ${state.pendingFiles.map((item, index) => `
        <div class="upload-pill">
          <span class="upload-pill-name">${escapeHtml(item.name)}</span>
          <button class="upload-pill-remove" data-action="remove-pending-file" data-index="${index}" aria-label="Remove file">&times;</button>
        </div>
      `).join("")}
    </div>
  `;
}

function activeModeMarkup() {
  const mode = getActiveMode();
  if (!mode || !MODE_CONFIG[mode]) return "";
  const config = MODE_CONFIG[mode];
  return `
    <div class="mode-banner">
      <div class="mode-banner-copy">
        <span class="mode-badge">Mode active</span>
        <span class="mode-label">${escapeHtml(config.label)}</span>
        <span class="mode-hint">${escapeHtml(config.hint)}</span>
      </div>
      <button class="mode-clear" data-action="clear-mode" aria-label="Clear active mode">&times;</button>
    </div>
  `;
}

function composerMarkup({ docked = false } = {}) {
  const attachMenu = state.openComposerMenu === "attach"
    ? `
      <div class="floating-panel">
        <button data-action="pick-docs">Upload files</button>
        <button data-action="pick-images">Upload photos</button>
      </div>
    `
    : "";

  const toolsMenu = state.openComposerMenu === "tools"
    ? `
      <div class="floating-panel">
        <label class="toggle-row">
          <span>Use live web search</span>
          <input type="checkbox" id="web-toggle" ${state.settings.enable_web_search ? "checked" : ""}>
        </label>
      </div>
    `
    : "";

  return `
    <div class="${docked ? "dock" : ""}">
      <div class="composer-card">
        ${pendingMarkup()}
        ${activeModeMarkup()}
        <textarea class="composer-input" id="${docked ? "dock-prompt" : "home-prompt"}" placeholder="Ask Gemma"></textarea>
        <div class="composer-toolbar">
          <div class="composer-toolbar-group">
            <div class="toolbar-anchor">
              <button class="toolbar-icon-button" data-action="toggle-composer-menu" data-menu="attach" aria-label="Attach" data-tooltip="Add files" data-tooltip-position="top">+</button>
              ${attachMenu}
            </div>
            <div class="toolbar-anchor">
              <button class="toolbar-tools-button" data-action="toggle-composer-menu" data-menu="tools" data-tooltip="Tools" data-tooltip-position="top">
                ${iconTools()}
                <span>Tools</span>
              </button>
              ${toolsMenu}
            </div>
          </div>
          <div class="composer-toolbar-group">
            <button class="toolbar-mode-button" disabled>Fast <span class="mini-caret">&#9662;</span></button>
            <button class="toolbar-icon-button mic-button" data-action="mic" aria-label="Microphone" data-tooltip="Use microphone" data-tooltip-position="top">
              ${iconMic()}
            </button>
            <button class="toolbar-icon-button send-button" data-action="send-prompt" data-source="${docked ? "dock" : "home"}" aria-label="Send" data-tooltip="Send message" data-tooltip-position="top">
              ${iconSend()}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function homeMarkup() {
  return `
    <div class="home-hero">
      <div class="hero-kicker">Hi ${escapeHtml(state.userName)}</div>
      <div class="hero-title">Where should we start?</div>
      ${composerMarkup({ docked: false })}
      <div class="chip-row">
        <button class="chip" data-action="activate-mode" data-mode="summarize">Summarize a file</button>
        <button class="chip" data-action="activate-mode" data-mode="inspect">Inspect an image</button>
        <button class="chip" data-action="activate-mode" data-mode="web">Search the web</button>
        <button class="chip" data-action="activate-mode" data-mode="code">Write code</button>
      </div>
    </div>
  `;
}

function renderUserMessage(message, index) {
  return `
    <div class="msg msg-user">
      <div class="user-message-shell">
        <div class="user-actions">
          <button class="floating-action icon-action" data-action="copy-text" data-text="${encodeURIComponent(message.content)}" data-tooltip="Copy" data-tooltip-position="bottom" aria-label="Copy">
            ${iconCopy()}
          </button>
          <button class="floating-action icon-action" data-action="edit-message" data-index="${index}" data-tooltip="Edit" data-tooltip-position="bottom" aria-label="Edit">
            ${iconEdit()}
          </button>
        </div>
        <div class="user-bubble">${markdownToHtml(message.content)}</div>
      </div>
    </div>
  `;
}

function renderAssistantMessage(message, index) {
  const thinkingMarkup = message.isThinking
    ? `
      <div class="assistant-thinking">
        <span></span><span></span><span></span>
      </div>
    `
    : "";

  const sources = (message.sources || []).length
    ? `
      <details class="sources-toggle">
        <summary>Sources</summary>
        ${(message.sources || []).map((source) => `
          <div class="source-entry">
            ${source.url ? `<a href="${source.url}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>` : `<div>${escapeHtml(source.title)}</div>`}
            ${source.snippet ? `<div class="thinking">${escapeHtml(source.snippet)}</div>` : ""}
          </div>
        `).join("")}
      </details>
    `
    : "";

  const moreMenu = state.openMessageMenu === index
    ? `
      <div class="message-menu">
        <button data-action="delete-answer" data-index="${index}">Delete answer</button>
      </div>
    `
    : "";

  const fileMarkup = (message.generated_files || []).length
    ? `
      <div class="generated-file-stack">
        ${(message.generated_files || []).map((file) => `
          <a class="generated-file-card" href="${file.download_url}" download="${escapeHtml(file.filename)}">
            <div class="generated-file-meta">
              <div class="generated-file-format">${escapeHtml(file.format || "FILE")}</div>
              <div class="generated-file-name">${escapeHtml(file.filename)}</div>
            </div>
            <div class="generated-file-download">
              ${iconDownload()}
              <span>Download</span>
            </div>
          </a>
        `).join("")}
      </div>
    `
    : "";

  return `
    <div class="msg">
      <div class="assistant-row">
        <div class="assistant-mark"></div>
        <div class="assistant-content">
          ${message.content ? `<div class="assistant-copy">${markdownToHtml(message.content)}</div>` : ""}
          ${fileMarkup}
          ${thinkingMarkup}
          ${sources}
          ${message.isThinking ? "" : `<div class="assistant-actions">
            <button class="message-action icon-action" data-action="feedback" data-value="up" aria-label="Like" data-tooltip="Good response" data-tooltip-position="bottom">
              ${iconThumb("up")}
            </button>
            <button class="message-action icon-action" data-action="feedback" data-value="down" aria-label="Dislike" data-tooltip="Bad response" data-tooltip-position="bottom">
              ${iconThumb("down")}
            </button>
            <button class="message-action icon-action" data-action="retry-answer" data-index="${index}" aria-label="Retry" data-tooltip="Redo" data-tooltip-position="bottom">
              ${iconRetry()}
            </button>
            <button class="message-action icon-action" data-action="copy-text" data-text="${encodeURIComponent(message.content)}" aria-label="Copy" data-tooltip="Copy" data-tooltip-position="bottom">
              ${iconCopy()}
            </button>
            <div class="message-action more-wrap">
              <button class="message-action icon-action" data-action="toggle-message-menu" data-index="${index}" aria-label="More" data-tooltip="More" data-tooltip-position="bottom">
                ${iconMore()}
              </button>
              ${moreMenu}
            </div>
          </div>`}
        </div>
      </div>
    </div>
  `;
}

function conversationMarkup() {
  const chat = state.activeConversation;
  const messages = (chat?.messages || [])
    .map((message, index) => (message.role === "user"
      ? renderUserMessage(message, index)
      : renderAssistantMessage(message, index)))
    .join("");

  return `
    <div class="thread-title">${escapeHtml(chat?.title || "New chat")}</div>
    <div class="thread">${messages}</div>
    ${composerMarkup({ docked: true })}
  `;
}

function renderMain() {
  mainView.innerHTML = (!state.activeConversation || !state.activeConversation.messages.length)
    ? homeMarkup()
    : conversationMarkup();
  syncMicButtons();
}

async function refreshConversation(chatId) {
  const data = await jsonFetch(`/api/conversations/${chatId}`);
  state.activeConversation = data;
  state.activeChatId = data.id;
  resetPending();
  renderSidebar();
  renderMain();
  renderModal();
}

async function bootstrap() {
  const data = await jsonFetch("/api/bootstrap");
  state.userName = data.user_name;
  state.conversations = data.conversations;
  state.activeChatId = data.active_chat_id;
  state.settings = { ...state.settings, ...data.settings };
  if (state.activeChatId) {
    state.activeConversation = await jsonFetch(`/api/conversations/${state.activeChatId}`);
  }
  renderSidebar();
  renderMain();
  renderModal();
}

async function ensureChat() {
  if (state.activeChatId) return;
  const created = await jsonFetch("/api/conversations", { method: "POST" });
  state.activeChatId = created.id;
  state.activeConversation = created;
  migrateDraftMode(created.id);
  state.conversations.unshift({
    id: created.id,
    title: created.title,
    updated_at: created.updated_at,
    message_count: 0,
  });
}

async function flushPendingUploads() {
  if (!state.pendingUploads.documents.length && !state.pendingUploads.images.length) return;
  const form = new FormData();
  state.pendingUploads.documents.forEach((file) => form.append("documents", file));
  state.pendingUploads.images.forEach((file) => form.append("images", file));
  await fetch(`/api/conversations/${state.activeChatId}/upload`, {
    method: "POST",
    body: form,
  });
}

async function sendPrompt(prompt, options = {}) {
  const submission = buildPromptSubmission(prompt);
  if (!submission || state.sendingPrompt) return;
  const cleanPrompt = submission.displayPrompt;
  const dockInput = document.getElementById("dock-prompt");
  const homeInput = document.getElementById("home-prompt");
  const replaceIndexFromInput = [dockInput, homeInput]
    .map((input) => input?.dataset?.replaceIndex)
    .find((value) => value !== undefined);
  const replaceUserIndex = Number.isInteger(options.replaceUserIndex)
    ? options.replaceUserIndex
    : replaceIndexFromInput !== undefined
      ? Number(replaceIndexFromInput)
    : Number.isInteger(state.editTargetIndex)
      ? state.editTargetIndex
      : null;

  const modeConfig = submission.modeConfig;
  const finalPrompt = submission.modelPrompt;
  if (modeConfig?.enableWebSearch) {
    state.settings.enable_web_search = true;
  }

  if (dockInput) dockInput.value = "";
  if (homeInput) homeInput.value = "";
  if (dockInput) delete dockInput.dataset.replaceIndex;
  if (homeInput) delete homeInput.dataset.replaceIndex;

  if (!state.activeConversation) {
    state.activeConversation = {
      id: state.activeChatId || "draft",
      title: "New chat",
      messages: [],
    };
  }

  const baseMessages = replaceUserIndex !== null
    ? (state.activeConversation.messages || []).slice(0, replaceUserIndex)
    : (state.activeConversation.messages || []);

  if (replaceUserIndex === 0 && state.activeConversation) {
    const nextTitle = titleFromPrompt(cleanPrompt);
    state.activeConversation.title = nextTitle;
    state.conversations = state.conversations.map((chat) => (
      chat.id === state.activeChatId ? { ...chat, title: nextTitle } : chat
    ));
  }

  state.activeConversation.messages = [
    ...baseMessages,
    {
      role: "user",
      content: cleanPrompt,
      model_content: finalPrompt,
      timestamp: new Date().toISOString(),
    },
    {
      role: "assistant",
      content: "Thinking…",
      timestamp: new Date().toISOString(),
      isThinking: true,
    },
  ];
  state.openComposerMenu = null;
  state.sendingPrompt = true;
  state.editTargetIndex = null;
  renderSidebar();
  renderMain();

  try {
    await ensureChat();
    await flushPendingUploads();

    const response = await jsonFetch("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        chat_id: state.activeChatId,
        prompt: finalPrompt,
        display_prompt: cleanPrompt,
        mode: getActiveMode(),
        replace_user_index: replaceUserIndex,
        settings: state.settings,
      }),
    });

    state.conversations = response.conversations;
    state.activeConversation = response.chat;
    state.activeChatId = response.chat.id;
    clearActiveMode();
    resetPending();
    renderSidebar();
    renderMain();
  } catch (error) {
    const messages = state.activeConversation?.messages || [];
    if (messages.length && messages[messages.length - 1]?.isThinking) {
      messages[messages.length - 1] = {
        role: "assistant",
        content: "The request could not be completed right now. Please try again.",
        timestamp: new Date().toISOString(),
        error: true,
      };
    }
    renderMain();
    throw error;
  } finally {
    state.sendingPrompt = false;
  }
}

function stagePending(kind) {
  const input = kind === "documents" ? hiddenDocUpload : hiddenImageUpload;
  const files = Array.from(input.files || []);
  if (!files.length) return;

  state.pendingUploads[kind].push(...files);
  state.pendingFiles.push(
    ...files.map((file) => ({
      name: file.name,
      kind,
    }))
  );
  input.value = "";
  renderMain();
  showToast("Added to composer");
}

function closeFloatingUi() {
  state.openChatMenu = null;
  state.openMessageMenu = null;
  state.openComposerMenu = null;
}

function stopMicCapture() {
  state.micShouldContinue = false;
  state.micStopping = true;
  state.micSessionId += 1;
  if (state.micRestartTimer) {
    window.clearTimeout(state.micRestartTimer);
    state.micRestartTimer = null;
  }
  if (state.speechRecognition) {
    try {
      state.speechRecognition.abort();
    } catch (error) {
      // Ignore browser-specific abort errors.
    }
  }
  state.speechRecognition = null;
  state.micListening = false;
  syncMicButtons();
}

async function ensureMicAccess() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support microphone capture.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

async function startMicCapture() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast("Microphone dictation is not supported in this browser.");
    return;
  }

  if (state.micListening) {
    stopMicCapture();
    return;
  }

  const input = getComposerInput();
  if (!input) {
    showToast("Open a chat composer first.");
    return;
  }

  try {
    await ensureMicAccess();
  } catch (error) {
    const permissionMessage = error?.name === "NotAllowedError"
      ? "Please allow microphone access in the browser."
      : "No working microphone was detected, or microphone access is blocked.";
    showToast(permissionMessage);
    state.micShouldContinue = false;
    state.micStopping = false;
    return;
  }

  const recognition = new SpeechRecognition();
  const sessionId = state.micSessionId + 1;
  state.micSessionId = sessionId;
  state.micTargetId = input.id;
  state.micBaseText = input.value || "";
  state.micShouldContinue = true;
  state.micStopping = false;
  recognition.lang = navigator.language || "en-IN";
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;
  state.speechRecognition = recognition;

  recognition.onstart = () => {
    if (sessionId !== state.micSessionId) return;
    state.micListening = true;
    syncMicButtons();
    showToast("Listening...");
  };

  recognition.onresult = (event) => {
    if (sessionId !== state.micSessionId || !state.micShouldContinue) return;
    let finalTranscript = "";
    let interimTranscript = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0]?.transcript || "";
      if (result.isFinal) {
        finalTranscript += `${transcript} `;
      } else {
        interimTranscript += `${transcript} `;
      }
    }

    const liveInput = getComposerInputById(state.micTargetId);
    if (!liveInput) return;

    const combined = `${state.micBaseText} ${finalTranscript}${interimTranscript}`.trim();
    liveInput.value = combined;
    liveInput.focus();

    if (finalTranscript.trim()) {
      state.micBaseText = `${state.micBaseText} ${finalTranscript}`.trim();
    }
  };

  recognition.onerror = (event) => {
    if (sessionId !== state.micSessionId) return;
    const reasons = {
      "not-allowed": "Please allow microphone access in the browser.",
      "service-not-allowed": "Speech recognition is blocked by the browser settings.",
      "audio-capture": "No working microphone was detected, or another app is using it.",
      "aborted": "",
    };
    if (event.error === "aborted" && state.micStopping) {
      return;
    }
    if (event.error === "no-speech") {
      return;
    }
    if (event.error === "network" && state.micShouldContinue) {
      return;
    }
    const reason = reasons[event.error] || `Microphone capture failed: ${event.error}`;
    if (reason) showToast(reason);
    if (!["aborted", "no-speech", "network"].includes(event.error)) {
      state.micShouldContinue = false;
    }
  };

  recognition.onend = () => {
    if (sessionId !== state.micSessionId) return;
    state.micListening = false;
    state.speechRecognition = null;
    syncMicButtons();
    if (state.micShouldContinue && !state.micStopping) {
      state.micRestartTimer = window.setTimeout(() => {
        state.micRestartTimer = null;
        if (state.micShouldContinue && !state.speechRecognition && sessionId === state.micSessionId) {
          startMicCapture();
        }
      }, 250);
      return;
    }
    state.micTargetId = null;
    state.micBaseText = "";
    state.micStopping = false;
  };

  try {
    recognition.start();
  } catch (error) {
    state.speechRecognition = null;
    state.micShouldContinue = false;
    state.micStopping = false;
    showToast("Microphone could not start. Please try again.");
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) {
    const keepOpen = event.target.closest(
      ".floating-panel, .chat-menu, .message-menu, .chat-menu-wrap, [data-modal-surface='true']"
    );
    if (!keepOpen && (state.openChatMenu || state.openMessageMenu !== null || state.openComposerMenu)) {
      closeFloatingUi();
      renderSidebar();
      renderMain();
    }
    if (!keepOpen && state.openModal) {
      state.openModal = null;
      renderModal();
    }
    return;
  }

  const { action } = target.dataset;

  try {
    if (action === "open-chat") {
      await refreshConversation(target.dataset.chatId);
      return;
    }

    if (action === "toggle-chat-menu") {
      const chatId = target.dataset.chatId;
      state.openChatMenu = state.openChatMenu === chatId ? null : chatId;
      state.openMessageMenu = null;
      renderSidebar();
      return;
    }

    if (action === "delete-chat") {
      const chatId = target.dataset.chatId;
      const response = await jsonFetch(`/api/conversations/${chatId}`, { method: "DELETE" });
      state.pinnedChats = state.pinnedChats.filter((id) => id !== chatId);
      savePinnedChats();
      state.conversations = response.conversations;
      state.activeChatId = response.active_chat_id;
      state.openChatMenu = null;
      resetPending();
      await refreshConversation(state.activeChatId);
      return;
    }

    if (action === "open-settings") {
      state.openModal = "settings";
      renderModal();
      return;
    }

    if (action === "close-modal") {
      state.openModal = null;
      renderModal();
      return;
    }

    if (action === "toggle-pin-chat") {
      const chatId = target.dataset.chatId;
      if (isPinned(chatId)) {
        state.pinnedChats = state.pinnedChats.filter((id) => id !== chatId);
      } else {
        state.pinnedChats = [chatId, ...state.pinnedChats.filter((id) => id !== chatId)];
      }
      savePinnedChats();
      state.openChatMenu = null;
      renderSidebar();
      showToast(isPinned(chatId) ? "Chat pinned" : "Chat unpinned");
      return;
    }

    if (action === "rename-chat") {
      const chatId = target.dataset.chatId;
      const current = state.conversations.find((chat) => chat.id === chatId);
      const title = window.prompt("Rename chat", current?.title || "New chat");
      if (!title || !title.trim()) return;
      const updated = await jsonFetch(`/api/conversations/${chatId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: title.trim() }),
      });
      state.conversations = state.conversations.map((chat) => (
        chat.id === chatId ? { ...chat, title: updated.title } : chat
      ));
      if (state.activeConversation?.id === chatId) {
        state.activeConversation.title = updated.title;
      }
      state.openChatMenu = null;
      renderSidebar();
      renderMain();
      showToast("Chat renamed");
      return;
    }

    if (action === "toggle-composer-menu") {
      const menu = target.dataset.menu;
      state.openComposerMenu = state.openComposerMenu === menu ? null : menu;
      renderMain();
      return;
    }

    if (action === "pick-docs") {
      hiddenDocUpload.click();
      return;
    }

    if (action === "pick-images") {
      hiddenImageUpload.click();
      return;
    }

    if (action === "clear-mode") {
      clearActiveMode();
      renderMain();
      showToast("Mode cleared");
      return;
    }

    if (action === "remove-pending-file") {
      const index = Number(target.dataset.index);
      const [removed] = state.pendingFiles.splice(index, 1);
      if (removed) {
        const bucket = state.pendingUploads[removed.kind] || [];
        const fileIndex = bucket.findIndex((file) => file.name === removed.name);
        if (fileIndex >= 0) bucket.splice(fileIndex, 1);
      }
      renderMain();
      return;
    }

    if (action === "mic") {
      startMicCapture();
      return;
    }

    if (action === "send-prompt") {
      const source = target.dataset.source;
      const input = document.getElementById(source === "dock" ? "dock-prompt" : "home-prompt");
      await sendPrompt(input ? input.value : "");
      return;
    }

    if (action === "activate-mode") {
      const mode = target.dataset.mode;
      setActiveMode(mode);
      state.openComposerMenu = null;
      renderMain();
      const label = MODE_CONFIG[mode]?.label || "Mode";
      showToast(`${label} activated`);
      return;
    }

    if (action === "toggle-secret") {
      const key = target.dataset.key;
      if (!key) return;
      state.revealSecrets[key] = !state.revealSecrets[key];
      renderModal();
      return;
    }

    if (action === "save-settings") {
      state.settings.region = document.getElementById("settings-region")?.value.trim() || state.settings.region;
      state.settings.model_id = document.getElementById("settings-model_id")?.value.trim() || state.settings.model_id;
      state.settings.temperature = Number(document.getElementById("settings-temperature")?.value || state.settings.temperature || 0.4);
      state.settings.max_tokens = Number(document.getElementById("settings-max_tokens")?.value || state.settings.max_tokens || 1400);
      state.settings.enable_web_search = Boolean(document.getElementById("settings-enable_web_search")?.checked);
      state.openModal = null;
      renderModal();
      showToast("Settings updated for this session");
      return;
    }

    if (action === "copy-text") {
      const text = decodeURIComponent(target.dataset.text || "");
      await navigator.clipboard.writeText(text);
      showToast("Copied");
      return;
    }

    if (action === "copy-code") {
      const code = decodeURIComponent(target.dataset.code || "");
      await navigator.clipboard.writeText(code);
      showToast("Code copied");
      return;
    }

    if (action === "edit-message") {
      const message = state.activeConversation.messages[Number(target.dataset.index)];
      const input = document.getElementById("dock-prompt") || document.getElementById("home-prompt");
      if (input) {
        input.value = message.content;
        input.dataset.replaceIndex = String(Number(target.dataset.index));
        input.focus();
      }
      showToast("Question loaded into composer");
      state.editTargetIndex = Number(target.dataset.index);
      return;
    }

    if (action === "feedback") {
      showToast("Feedback saved");
      return;
    }

    if (action === "retry-answer") {
      const index = Number(target.dataset.index);
      const messages = state.activeConversation.messages;
      let userIndex = null;
      let prompt = "";
      for (let i = index - 1; i >= 0; i -= 1) {
        if (messages[i].role === "user") {
          prompt = messages[i].content;
          userIndex = i;
          break;
        }
      }
      if (prompt && userIndex !== null) {
        await sendPrompt(prompt, { replaceUserIndex: userIndex });
      }
      return;
    }

    if (action === "toggle-message-menu") {
      const index = Number(target.dataset.index);
      state.openMessageMenu = state.openMessageMenu === index ? null : index;
      renderMain();
      return;
    }

    if (action === "delete-answer") {
      const index = Number(target.dataset.index);
      const updated = await jsonFetch(`/api/conversations/${state.activeChatId}/messages/${index}`, {
        method: "DELETE",
      });
      state.activeConversation = updated;
      state.openMessageMenu = null;
      renderMain();
    }
  } catch (error) {
    showToast(error.message || "Something went wrong");
  }
});

document.addEventListener("mouseover", (event) => {
  const target = event.target.closest("[data-tooltip]");
  if (!target) {
    hideTooltip();
    return;
  }
  queueTooltip(target);
});

document.addEventListener("mouseout", (event) => {
  const fromTarget = event.target.closest("[data-tooltip]");
  if (!fromTarget) return;
  const toTarget = event.relatedTarget?.closest?.("[data-tooltip]");
  if (fromTarget === toTarget) return;
  hideTooltip();
});

window.addEventListener("scroll", hideTooltip, true);
window.addEventListener("resize", hideTooltip);

historySearch.addEventListener("input", async (event) => {
  const query = event.target.value.trim();
  if (!query) {
    state.conversations = await jsonFetch("/api/conversations");
    renderSidebar();
    return;
  }

  const hits = await jsonFetch("/api/history-search", {
    method: "POST",
    body: JSON.stringify({ query }),
  });
  const ordered = [];
  const seen = new Set();
  hits.forEach((hit) => {
    if (!seen.has(hit.chat_id)) {
      seen.add(hit.chat_id);
      ordered.push({
        id: hit.chat_id,
        title: hit.chat_title,
      });
    }
  });
  state.conversations = ordered;
  renderSidebar();
});

sidebarToggle.addEventListener("click", () => {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  applySidebarState();
});

sidebarSearchToggle.addEventListener("click", () => {
  if (state.sidebarCollapsed) {
    state.sidebarCollapsed = false;
    applySidebarState();
  }
  historySearch.focus();
});

document.addEventListener("keydown", (event) => {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    event.target instanceof HTMLTextAreaElement &&
    event.target.classList.contains("composer-input")
  ) {
    event.preventDefault();
    sendPrompt(event.target.value);
    return;
  }

  if (event.key === "Escape" && state.openModal) {
    state.openModal = null;
    renderModal();
  }
});

hiddenDocUpload.addEventListener("change", () => stagePending("documents"));
hiddenImageUpload.addEventListener("change", () => stagePending("images"));

document.getElementById("new-chat-btn").addEventListener("click", async () => {
  const created = await jsonFetch("/api/conversations", { method: "POST" });
  state.conversations.unshift({
    id: created.id,
    title: created.title,
    updated_at: created.updated_at,
    message_count: 0,
  });
  state.activeConversation = created;
  state.activeChatId = created.id;
  migrateDraftMode(created.id);
  resetPending();
  renderSidebar();
  renderMain();
});

document.addEventListener("change", (event) => {
  if (event.target.id === "web-toggle") {
    state.settings.enable_web_search = event.target.checked;
  }
});

bootstrap();
