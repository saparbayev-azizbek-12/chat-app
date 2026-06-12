(function () {
  const app = document.getElementById("chat-app");
  if (!app) return;

  const state = {
    ws: null,
    pendingFile: null,
    pendingPreviewUrl: null,
    recorder: null,
    recordChunks: [],
    recordStream: null,
    recordTimer: null,
    recordStartedAt: 0,
    typingTimer: null,
    typingResetTimer: null,
    headerPresenceText: "",
    latestMessageId: 0,
    fallbackPolling: false,
    pollTimer: null,
    pollInFlight: false,
  };

  const cfg = {
    conversationId: app.dataset.conversationId || "",
    userId: app.dataset.userId || "",
    otherUserId: app.dataset.otherUserId || "",
    sendUrl: app.dataset.sendUrl || "",
    uploadUrl: app.dataset.uploadUrl || "",
    messagesUrl: app.dataset.messagesUrl || "",
    startUrl: app.dataset.startUrl || "",
    userSearchUrl: app.dataset.userSearchUrl || "/accounts/search/",
    indexUrl: app.dataset.indexUrl || "/",
  };

  const els = {
    convSearch: document.getElementById("conv-search"),
    userSearch: document.getElementById("user-search"),
    searchResults: document.getElementById("search-results"),
    msgInput: document.getElementById("msg-input"),
    fileInput: document.getElementById("file-input"),
    filePreview: document.getElementById("attachment-preview"),
    emojiPicker: document.getElementById("emoji-picker"),
    sendBtn: document.getElementById("main-send-btn"),
    msgContainer: document.getElementById("msg-container"),
    scrollAnchor: document.getElementById("scroll-anchor"),
    headerTyping: document.getElementById("header-typing"),
    recordingBar: document.getElementById("recording-bar"),
    recordingTime: document.getElementById("recording-time"),
    headerStatusDot: document.getElementById("header-status-dot"),
    headerLastSeen: document.getElementById("header-last-seen"),
    ctxMenu: document.getElementById("ctx-menu"),
    ctxOverlay: document.getElementById("ctx-overlay"),
    videoModal: document.getElementById("video-modal"),
    videoModalPlayer: document.getElementById("video-modal-player"),
    videoModalClose: document.querySelector(".video-modal-close"),
  };

  const emojis = ["\u{1F600}", "\u{1F601}", "\u{1F602}", "\u{1F60A}", "\u{1F60D}", "\u{1F973}", "\u{1F60E}", "\u{1F91D}", "\u{1F44D}", "\u{1F44F}", "\u{1F64F}", "\u{1F525}", "\u2705", "\u{1F49A}", "\u{1F4CE}", "\u{1F3A7}", "\u{1F3A5}", "\u{1F4F7}", "\u{1F4C4}", "\u{1F4AC}", "\u2728", "\u{1F680}", "\u{1F605}", "\u{1F609}"];
  const audioExtensions = new Set(["mp3", "m4a", "wav", "ogg", "oga", "opus", "webm", "aac", "flac", "mpeg"]);
  const videoExtensions = new Set(["mp4", "webm", "mov", "m4v", "avi", "mkv"]);
  const imageExtensions = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);

  function init() {
    state.headerPresenceText = els.headerLastSeen?.textContent || "";
    bindPanels();
    bindSearch();
    bindComposer();
    bindRecorder();
    bindMediaControls();
    buildEmojiPicker();
    initializeLatestMessageId();
    connectSocket();
    scrollDown();
  }

  function bindPanels() {
    document.querySelectorAll("[data-new-chat-open]").forEach((btn) => {
      btn.addEventListener("click", () => showPanel("new-chat"));
    });
    document.querySelectorAll("[data-new-chat-close]").forEach((btn) => {
      btn.addEventListener("click", () => showPanel("chats"));
    });
    document.querySelectorAll("[data-panel-trigger]").forEach((btn) => {
      btn.addEventListener("click", () => showPanel(btn.dataset.panelTrigger));
    });
    document.querySelectorAll("[data-close-chat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        app.classList.remove("chat-open");
        if (window.history && cfg.indexUrl) window.history.pushState({}, "", cfg.indexUrl);
      });
    });
    els.ctxOverlay?.addEventListener("click", hideCtx);
  }

  function showPanel(name) {
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.panel === name);
    });
    document.querySelectorAll("[data-panel-trigger]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.panelTrigger === name);
    });
    if (name === "new-chat") setTimeout(() => els.userSearch?.focus(), 50);
  }

  function bindSearch() {
    els.convSearch?.addEventListener("input", () => {
      const q = els.convSearch.value.trim().toLowerCase();
      document.querySelectorAll(".conversation-item").forEach((item) => {
        const text = (item.dataset.searchText || "").toLowerCase();
        item.classList.toggle("hidden", q && !text.includes(q));
      });
    });
    els.userSearch?.addEventListener("input", debounce(() => {
      searchUsers(els.userSearch.value.trim());
    }, 220));
  }

  function bindComposer() {
    if (!els.msgInput) return;

    els.msgInput.addEventListener("input", () => {
      resizeInput();
      updateMainAction();
      sendTyping();
    });
    els.msgInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendCurrent();
      }
    });
    document.querySelector("[data-file-open]")?.addEventListener("click", () => els.fileInput?.click());
    els.fileInput?.addEventListener("change", () => {
      const file = els.fileInput.files?.[0];
      if (file) setPendingFile(file);
    });
    document.querySelector("[data-emoji-toggle]")?.addEventListener("click", () => {
      els.emojiPicker?.classList.toggle("hidden");
    });
    document.addEventListener("click", handleDocumentClick);
    els.sendBtn?.addEventListener("click", () => {
      if (hasSendableContent()) sendCurrent();
      else startRecording();
    });
    resizeInput();
    updateMainAction();
  }

  function handleDocumentClick(event) {
    const audioToggle = event.target.closest("[data-audio-toggle]");
    if (audioToggle) {
      toggleAudio(audioToggle.closest(".audio-card"));
      return;
    }

    const openTarget = event.target.closest("[data-open-url]");
    if (openTarget) {
      window.open(openTarget.dataset.openUrl, "_blank", "noopener,noreferrer");
      return;
    }

    const videoTarget = event.target.closest("[data-video-url]");
    if (videoTarget) {
      openVideo(videoTarget.dataset.videoUrl);
      return;
    }

    if (!els.emojiPicker || els.emojiPicker.classList.contains("hidden")) return;
    const clickedPicker = els.emojiPicker.contains(event.target);
    const clickedButton = event.target.closest("[data-emoji-toggle]");
    if (!clickedPicker && !clickedButton) els.emojiPicker.classList.add("hidden");
  }

  function bindMediaControls() {
    document.addEventListener("play", (event) => {
      if (!(event.target instanceof HTMLAudioElement)) return;
      document.querySelectorAll("audio").forEach((audio) => {
        if (audio !== event.target) audio.pause();
      });
      syncAudioCard(event.target);
    }, true);
    ["pause", "ended", "loadedmetadata", "durationchange", "timeupdate"].forEach((eventName) => {
      document.addEventListener(eventName, (event) => {
        if (event.target instanceof HTMLAudioElement) syncAudioCard(event.target);
      }, true);
    });
    document.addEventListener("input", (event) => {
      if (event.target.matches("[data-audio-progress]")) seekAudio(event.target);
    });
    document.querySelectorAll(".audio-card audio").forEach(syncAudioCard);
    els.videoModalClose?.addEventListener("click", closeVideo);
    els.videoModal?.addEventListener("click", (event) => {
      if (event.target === els.videoModal) closeVideo();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeVideo();
    });
  }

  function connectSocket() {
    if (!cfg.conversationId) return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    state.ws = new WebSocket(`${protocol}://${window.location.host}/ws/chat/${cfg.conversationId}/`);

    const fallbackTimer = window.setTimeout(() => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) startFallbackPolling();
    }, 1800);

    state.ws.addEventListener("open", () => {
      window.clearTimeout(fallbackTimer);
      stopFallbackPolling();
      updateComposerAvailability(true);
    });
    state.ws.addEventListener("close", () => {
      window.clearTimeout(fallbackTimer);
      startFallbackPolling();
    });
    state.ws.addEventListener("error", () => startFallbackPolling());
    state.ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "chat_message" && data.message) {
        appendMessage(data.message);
        acknowledgeIncomingMessage(data.message);
        scrollDown();
      } else if (data.type === "presence_update") {
        updateStatusUI(data);
      } else if (data.type === "message_deleted") {
        handleDeleted(data);
      } else if (data.type === "message_edited") {
        handleEdited(data);
      } else if (data.type === "typing") {
        showTyping(data.is_typing);
      } else if (data.type === "message_delivered") {
        updateMessageStatus(data.message_id, "delivered");
      } else if (data.type === "message_read") {
        updateMessageStatus(data.message_id, "read");
      }
    });
  }

  function acknowledgeIncomingMessage(message) {
    if (String(message.sender_id) === String(cfg.userId)) return;
    sendWs({ type: "mark_delivered", message_id: message.id }, { quiet: true });
    if (document.visibilityState === "visible") {
      sendWs({ type: "mark_read", message_id: message.id }, { quiet: true });
    } else {
      const onVisible = () => {
        if (document.visibilityState === "visible") {
          sendWs({ type: "mark_read", message_id: message.id }, { quiet: true });
          document.removeEventListener("visibilitychange", onVisible);
        }
      };
      document.addEventListener("visibilitychange", onVisible);
    }
  }

  async function searchUsers(query) {
    if (!els.searchResults) return;
    if (query.length < 2) {
      els.searchResults.innerHTML = hintMarkup("Type at least 2 characters to find contacts.");
      return;
    }
    els.searchResults.innerHTML = hintMarkup("Searching...");
    try {
      const response = await fetch(`${cfg.userSearchUrl}?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (!data.users?.length) {
        els.searchResults.innerHTML = hintMarkup("No users found.");
        return;
      }
      els.searchResults.innerHTML = data.users.map((user) => userResultMarkup(user)).join("");
      els.searchResults.querySelectorAll("[data-user-id]").forEach((btn) => {
        btn.addEventListener("click", () => startChat(btn.dataset.userId));
      });
    } catch (error) {
      els.searchResults.innerHTML = hintMarkup("Search failed. Try again.");
    }
  }

  async function startChat(userId) {
    const formData = new FormData();
    formData.append("user_id", userId);
    try {
      const response = await fetch(cfg.startUrl, {
        method: "POST",
        headers: { "X-CSRFToken": getCsrfToken() },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start chat");
      window.location.href = data.redirect_url;
    } catch (error) {
      showToast(error.message || "Could not start chat", "err");
    }
  }

  function userResultMarkup(user) {
    const avatar = user.avatar_url
      ? `<img src="${escapeAttr(user.avatar_url)}" alt="${escapeAttr(user.display_name)}" class="avatar-md">`
      : `<span class="avatar-md avatar-fallback">${escapeHtml((user.username || "?")[0].toUpperCase())}</span>`;
    return `
      <button type="button" class="user-result" data-user-id="${escapeAttr(user.id)}">
        <span class="avatar-wrap">${avatar}<span class="presence-dot${user.is_online ? " online" : ""}"></span></span>
        <span class="conversation-copy">
          <strong>${escapeHtml(user.display_name || user.username)}</strong>
          <span>@${escapeHtml(user.username)}</span>
        </span>
      </button>
    `;
  }

  function hintMarkup(text) {
    return `<div class="new-chat-hint"><p>${escapeHtml(text)}</p></div>`;
  }

  function buildEmojiPicker() {
    if (!els.emojiPicker) return;
    els.emojiPicker.innerHTML = `<div class="emoji-grid">${emojis.map((emoji) => `<button type="button" data-emoji="${emoji}" aria-label="${emoji}">${emoji}</button>`).join("")}</div>`;
    els.emojiPicker.querySelectorAll("[data-emoji]").forEach((btn) => {
      btn.addEventListener("click", () => {
        insertAtCursor(els.msgInput, btn.dataset.emoji);
        els.msgInput?.focus();
        resizeInput();
        updateMainAction();
      });
    });
  }

  function insertAtCursor(input, text) {
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    input.selectionStart = input.selectionEnd = start + text.length;
    input.dispatchEvent(new Event("input"));
  }

  function setPendingFile(file) {
    if (file.size > 10 * 1024 * 1024) {
      clearPendingFile();
      showToast("Max file size is 10 MB", "err");
      return;
    }
    clearPendingPreviewUrl();
    state.pendingFile = file;
    if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
      state.pendingPreviewUrl = URL.createObjectURL(file);
    }
    renderAttachmentPreview(file);
    updateMainAction();
  }

  function renderAttachmentPreview(file) {
    if (!els.filePreview) return;
    const kind = fileKind(file);
    const thumb = state.pendingPreviewUrl && file.type.startsWith("image/")
      ? `<img src="${state.pendingPreviewUrl}" alt="${escapeAttr(file.name)}">`
      : state.pendingPreviewUrl && file.type.startsWith("video/")
        ? `<video src="${state.pendingPreviewUrl}" muted></video>`
        : fileIconSvg(kind);
    els.filePreview.innerHTML = `
      <div class="attachment-card">
        <span class="attachment-thumb">${thumb}</span>
        <span class="attachment-info"><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(kind)} - ${formatBytes(file.size)}</small></span>
        <button type="button" class="remove-attachment" title="Remove attachment" aria-label="Remove attachment">${closeIconSvg()}</button>
      </div>
    `;
    els.filePreview.classList.remove("hidden");
    els.filePreview.querySelector(".remove-attachment")?.addEventListener("click", clearPendingFile);
  }

  function clearPendingFile() {
    state.pendingFile = null;
    clearPendingPreviewUrl();
    if (els.fileInput) els.fileInput.value = "";
    if (els.filePreview) {
      els.filePreview.innerHTML = "";
      els.filePreview.classList.add("hidden");
    }
    updateMainAction();
  }

  function clearPendingPreviewUrl() {
    if (state.pendingPreviewUrl) URL.revokeObjectURL(state.pendingPreviewUrl);
    state.pendingPreviewUrl = null;
  }

  function hasSendableContent() {
    return Boolean(els.msgInput?.value.trim() || state.pendingFile);
  }

  async function sendCurrent() {
    if (!cfg.conversationId) return;
    const content = els.msgInput?.value.trim() || "";
    if (state.pendingFile) {
      await uploadAttachment(state.pendingFile, content, false);
      return;
    }
    if (!content) return;
    if (!isSocketOpen()) {
      await sendTextHttp(content);
      return;
    }
    sendWs({ type: "chat_message", content });
    els.msgInput.value = "";
    resizeInput();
    updateMainAction();
    sendWs({ type: "stop_typing" }, { quiet: true });
  }

  async function uploadAttachment(file, caption, isVoice) {
    if (!cfg.uploadUrl) return;
    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("caption", caption || "");
    if (isVoice) formData.append("is_voice", "true");
    if (!isSocketOpen()) formData.append("broadcast", "true");
    setComposerBusy(true);
    try {
      const response = await fetch(cfg.uploadUrl, {
        method: "POST",
        headers: { "X-CSRFToken": getCsrfToken() },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed");
      const sent = sendWs({ type: "chat_message", message_id: data.message_id }, { quiet: true });
      if (!sent && data.message) {
        appendMessage(data.message);
        scrollDown();
      }
      if (!isVoice) {
        clearPendingFile();
        if (els.msgInput) els.msgInput.value = "";
        resizeInput();
      }
    } catch (error) {
      showToast(error.message || "Upload failed", "err");
    } finally {
      setComposerBusy(false);
      updateMainAction();
    }
  }

  function bindRecorder() {
    document.querySelector("[data-record-cancel]")?.addEventListener("click", cancelRecording);
    document.querySelector("[data-record-stop]")?.addEventListener("click", stopRecordingAndSend);
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      showToast("Voice recorder is not supported in this browser", "err");
      return;
    }
    try {
      state.recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.recordChunks = [];
      state.recorder = new MediaRecorder(state.recordStream);
      state.recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) state.recordChunks.push(event.data);
      });
      state.recorder.start();
      state.recordStartedAt = Date.now();
      els.recordingBar?.classList.remove("hidden");
      els.sendBtn?.classList.add("hidden");
      setComposerBusy(true, true);
      tickRecordingTime();
      state.recordTimer = window.setInterval(tickRecordingTime, 250);
    } catch (error) {
      showToast("Microphone permission is required", "err");
      cleanupRecording();
    }
  }

  function stopRecordingAndSend() {
    if (!state.recorder || state.recorder.state === "inactive") return;
    state.recorder.addEventListener("stop", async () => {
      const blob = new Blob(state.recordChunks, { type: state.recorder.mimeType || "audio/webm" });
      const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
      cleanupRecording();
      await uploadAttachment(file, "", true);
    }, { once: true });
    state.recorder.stop();
  }

  function cancelRecording() {
    if (state.recorder && state.recorder.state !== "inactive") {
      state.recorder.addEventListener("stop", cleanupRecording, { once: true });
      state.recorder.stop();
    } else {
      cleanupRecording();
    }
  }

  function cleanupRecording() {
    if (state.recordTimer) window.clearInterval(state.recordTimer);
    state.recordTimer = null;
    state.recordChunks = [];
    state.recordStartedAt = 0;
    state.recordStream?.getTracks().forEach((track) => track.stop());
    state.recordStream = null;
    state.recorder = null;
    if (els.recordingTime) els.recordingTime.textContent = "0:00";
    els.recordingBar?.classList.add("hidden");
    els.sendBtn?.classList.remove("hidden");
    setComposerBusy(false);
    updateMainAction();
  }

  function tickRecordingTime() {
    if (!els.recordingTime || !state.recordStartedAt) return;
    const seconds = Math.floor((Date.now() - state.recordStartedAt) / 1000);
    els.recordingTime.textContent = formatDuration(seconds);
  }

  function appendMessage(message) {
    if (!els.msgContainer || !els.scrollAnchor) return;
    if (document.querySelector(`[data-msg-id="${cssEscape(String(message.id))}"]`)) {
      updateLatestMessageId(message.id);
      return;
    }
    const row = document.createElement("div");
    const isMine = String(message.sender_id) === String(cfg.userId);
    row.className = `message-row ${isMine ? "mine" : "theirs"}`;
    row.dataset.msgId = message.id;
    row.innerHTML = messageMarkup(message, isMine);
    els.msgContainer.insertBefore(row, els.scrollAnchor);
    updateLatestMessageId(message.id);
  }

  function messageMarkup(message, isMine) {
    if (message.deleted_for_everyone) {
      return bubbleMarkup(`<p class="deleted-message">Deleted message</p>`, message, isMine);
    }
    const parts = [];
    if (message.attachment_url) parts.push(attachmentMarkup(message));
    if (message.content) parts.push(`<p class="message-text">${escapeHtml(message.content)}</p>`);
    return bubbleMarkup(parts.join(""), message, isMine);
  }

  function bubbleMarkup(content, message, isMine) {
    return `
      <article class="message-bubble ${isMine ? "bubble-mine" : "bubble-them"}" oncontextmenu="showCtx(event, ${escapeAttr(message.id)}, ${isMine ? "true" : "false"})">
        ${content}
        <footer class="message-meta">
          <time>${formatTime(message.created_at)}</time>
          ${isMine ? statusMarkup(message.delivery_status || "sent") : ""}
        </footer>
      </article>
    `;
  }

  function statusMarkup(status) {
    if (status === "read") return '<span class="read-status is-read" data-message-status="read">&#10003;&#10003;</span>';
    if (status === "delivered") return '<span class="read-status is-delivered" data-message-status="delivered">&#10003;&#10003;</span>';
    return '<span class="read-status is-sent" data-message-status="sent">&#10003;</span>';
  }

  function attachmentMarkup(message) {
    const url = escapeAttr(message.attachment_url);
    const name = escapeHtml(message.attachment_name || "Attachment");
    const size = escapeHtml(message.attachment_size_display || "");
    const kind = message.attachment_kind || message.message_type;
    if (kind === "image") {
      return `<button type="button" class="media-shell" data-open-url="${url}" aria-label="Open image"><img src="${url}" alt="${name}"></button>`;
    }
    if (kind === "video") {
      return `<button type="button" class="media-shell video-thumb" data-video-url="${url}" data-title="${name}" aria-label="Open video"><video src="${url}" muted preload="metadata" playsinline></video><span class="video-play-badge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z"/></svg></span></button>`;
    }
    if (kind === "audio" || kind === "voice") {
      return audioMarkup(message, url, name, size);
    }
    return `<a class="file-card" href="${url}" download><span class="file-icon">${fileIconSvg("File")}</span><span class="file-copy"><strong>${name}</strong><small>${size}</small></span></a>`;
  }

  function audioMarkup(message, url, name, size) {
    const isVoice = message.message_type === "voice" || message.attachment_kind === "voice";
    const title = isVoice ? "Voice message" : name;
    return `
      <div class="audio-card ${isVoice ? "voice-card" : ""}">
        <button type="button" class="audio-play" data-audio-toggle aria-label="Play audio">
          <svg class="audio-play-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z"/></svg>
          <svg class="audio-pause-icon hidden" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4a1.5 1.5 0 0 0-1.5 1.5v13a1.5 1.5 0 0 0 3 0v-13A1.5 1.5 0 0 0 7 4Zm10 0a1.5 1.5 0 0 0-1.5 1.5v13a1.5 1.5 0 0 0 3 0v-13A1.5 1.5 0 0 0 17 4Z"/></svg>
        </button>
        <div class="audio-copy">
          <input class="audio-progress" type="range" min="0" max="100" step="0.1" value="0" data-audio-progress aria-label="Audio progress">
          <span class="audio-meta-line"><small><span data-audio-current>0:00</span> / <span data-audio-duration>--:--</span></small><small>${size}</small></span>
        </div>
        <audio src="${url}" preload="metadata"></audio>
      </div>
    `;
  }

  function showTyping(isTyping) {
    if (!els.headerTyping || !els.headerLastSeen) return;
    window.clearTimeout(state.typingResetTimer);
    els.headerTyping.classList.toggle("hidden", !isTyping);
    els.headerLastSeen.classList.toggle("hidden", isTyping);
    if (isTyping) {
      state.typingResetTimer = window.setTimeout(() => showTyping(false), 1800);
    }
  }

  function sendTyping() {
    if (!isSocketOpen()) return;
    sendWs({ type: "typing" }, { quiet: true });
    if (state.typingTimer) window.clearTimeout(state.typingTimer);
    state.typingTimer = window.setTimeout(() => sendWs({ type: "stop_typing" }, { quiet: true }), 900);
  }

  function sendWs(payload, options = {}) {
    if (!isSocketOpen()) {
      if (!options.quiet) showToast("Connection is not ready", "err");
      return false;
    }
    state.ws.send(JSON.stringify(payload));
    return true;
  }

  function updateStatusUI(data) {
    const isOnline = Boolean(data.is_online);
    document.querySelectorAll(`[data-user-id="${cssEscape(String(data.user_id))}"]`).forEach((dot) => {
      dot.classList.toggle("online", isOnline);
    });
    if (String(data.user_id) === String(cfg.otherUserId)) {
      els.headerStatusDot?.classList.toggle("online", isOnline);
      if (els.headerLastSeen) {
        els.headerLastSeen.textContent = isOnline ? "Online" : "Last seen recently";
        state.headerPresenceText = els.headerLastSeen.textContent;
      }
    }
  }

  function updateMessageStatus(messageId, status) {
    const row = document.querySelector(`[data-msg-id="${cssEscape(String(messageId))}"]`);
    const statusEl = row?.querySelector("[data-message-status]");
    if (!statusEl) return;
    if (statusEl.dataset.messageStatus === "read") return;
    if (statusEl.dataset.messageStatus === "delivered" && status === "delivered") return;
    statusEl.outerHTML = statusMarkup(status);
  }

  function handleDeleted(data) {
    const row = document.querySelector(`[data-msg-id="${cssEscape(String(data.message_id))}"]`);
    if (!row) return;
    if (data.delete_for === "everyone") {
      const bubble = row.querySelector(".message-bubble");
      if (bubble) bubble.innerHTML = `<p class="deleted-message">Deleted message</p><footer class="message-meta"><span>deleted</span></footer>`;
    } else {
      row.remove();
    }
  }

  function handleEdited(data) {
    const row = document.querySelector(`[data-msg-id="${cssEscape(String(data.message_id))}"]`);
    const text = row?.querySelector(".message-text");
    if (text) text.textContent = data.content;
  }

  function showCtx(event, messageId, isMine) {
    event?.preventDefault();
    if (!els.ctxMenu || !els.ctxOverlay) return;
    els.ctxMenu.innerHTML = `
      <button type="button" data-copy-msg="${escapeAttr(messageId)}">Copy</button>
      <div class="ctx-sep"></div>
      <button type="button" data-delete-msg="${escapeAttr(messageId)}" data-delete-mode="me">Delete for me</button>
      ${isMine ? `<button type="button" class="danger" data-delete-msg="${escapeAttr(messageId)}" data-delete-mode="everyone">Delete for everyone</button>` : ""}
    `;
    const x = Math.min(event.clientX, window.innerWidth - 190);
    const y = Math.min(event.clientY, window.innerHeight - 155);
    els.ctxMenu.style.left = `${Math.max(8, x)}px`;
    els.ctxMenu.style.top = `${Math.max(8, y)}px`;
    els.ctxMenu.classList.remove("hidden");
    els.ctxOverlay.classList.remove("hidden");
    els.ctxMenu.querySelector("[data-copy-msg]")?.addEventListener("click", () => copyMsg(messageId));
    els.ctxMenu.querySelectorAll("[data-delete-msg]").forEach((btn) => {
      btn.addEventListener("click", () => deleteMsg(btn.dataset.deleteMsg, btn.dataset.deleteMode));
    });
  }

  function hideCtx() {
    els.ctxMenu?.classList.add("hidden");
    els.ctxOverlay?.classList.add("hidden");
  }

  async function deleteMsg(messageId, mode) {
    hideCtx();
    try {
      const response = await fetch(`/chat/message/${messageId}/delete/`, {
        method: "DELETE",
        headers: { "X-CSRFToken": getCsrfToken(), "Content-Type": "application/json" },
        body: JSON.stringify({ delete_for: mode }),
      });
      if (!response.ok) throw new Error("Delete failed");
      sendWs({ type: "delete_message", message_id: messageId, delete_for: mode }, { quiet: true });
      handleDeleted({ message_id: messageId, delete_for: mode });
    } catch (error) {
      showToast(error.message || "Delete failed", "err");
    }
  }

  function copyMsg(messageId) {
    const row = document.querySelector(`[data-msg-id="${cssEscape(String(messageId))}"]`);
    const text = row?.querySelector(".message-text")?.innerText || "";
    if (text) navigator.clipboard?.writeText(text);
    hideCtx();
  }

  function toggleAudio(card) {
    const audio = card?.querySelector("audio");
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => showToast("Audio could not be played", "err"));
    } else {
      audio.pause();
    }
  }

  function seekAudio(progress) {
    const card = progress.closest(".audio-card");
    const audio = card?.querySelector("audio");
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = (Number(progress.value) / 100) * audio.duration;
    syncAudioCard(audio);
  }

  function syncAudioCard(audio) {
    const card = audio.closest(".audio-card");
    if (!card) return;
    const isPlaying = !audio.paused && !audio.ended;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const progress = card.querySelector("[data-audio-progress]");
    const currentEl = card.querySelector("[data-audio-current]");
    const durationEl = card.querySelector("[data-audio-duration]");

    card.classList.toggle("is-playing", isPlaying);
    card.querySelector(".audio-play-icon")?.classList.toggle("hidden", isPlaying);
    card.querySelector(".audio-pause-icon")?.classList.toggle("hidden", !isPlaying);
    card.querySelector("[data-audio-toggle]")?.setAttribute("aria-label", isPlaying ? "Pause audio" : "Play audio");
    if (progress) progress.value = duration > 0 ? String((current / duration) * 100) : "0";
    if (currentEl) currentEl.textContent = formatDuration(current);
    if (durationEl && duration > 0) durationEl.textContent = formatDuration(duration);
  }

  function openVideo(url) {
    if (!url || !els.videoModal || !els.videoModalPlayer) return;
    document.querySelectorAll("audio").forEach((audio) => audio.pause());
    els.videoModalPlayer.src = url;
    els.videoModal.classList.remove("hidden");
    els.videoModal.setAttribute("aria-hidden", "false");
    els.videoModalPlayer.play().catch(() => {});
  }

  function closeVideo() {
    if (!els.videoModal || !els.videoModalPlayer) return;
    els.videoModalPlayer.pause();
    els.videoModalPlayer.removeAttribute("src");
    els.videoModalPlayer.load();
    els.videoModal.classList.add("hidden");
    els.videoModal.setAttribute("aria-hidden", "true");
  }

  function resizeInput() {
    if (!els.msgInput) return;
    els.msgInput.style.height = "44px";
    els.msgInput.style.height = `${Math.min(128, els.msgInput.scrollHeight)}px`;
  }

  function updateMainAction() {
    if (!els.sendBtn) return;
    const sendIcon = els.sendBtn.querySelector(".send-icon");
    const micIcon = els.sendBtn.querySelector(".mic-icon");
    const sendable = hasSendableContent();
    sendIcon?.classList.toggle("hidden", !sendable);
    micIcon?.classList.toggle("hidden", sendable);
    els.sendBtn.title = sendable ? "Send message" : "Record voice";
    els.sendBtn.setAttribute("aria-label", sendable ? "Send message" : "Record voice");
  }

  function updateComposerAvailability(isOnline) {
    if (!els.msgInput) return;
    els.msgInput.disabled = !isOnline;
    els.msgInput.placeholder = isOnline ? "Type a message..." : "Connecting...";
  }

  async function sendTextHttp(content) {
    if (!cfg.sendUrl) {
      showToast("Connection is not ready", "err");
      return;
    }
    setComposerBusy(true);
    try {
      const response = await fetch(cfg.sendUrl, {
        method: "POST",
        headers: {
          "X-CSRFToken": getCsrfToken(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Message could not be sent");
      if (data.message) {
        appendMessage(data.message);
        scrollDown();
      }
      if (els.msgInput) els.msgInput.value = "";
      resizeInput();
      updateMainAction();
    } catch (error) {
      showToast(error.message || "Message could not be sent", "err");
    } finally {
      setComposerBusy(false);
      updateMainAction();
    }
  }

  function startFallbackPolling() {
    if (!cfg.messagesUrl) {
      updateComposerAvailability(false);
      return;
    }
    updateComposerAvailability(true);
    if (state.fallbackPolling) return;
    state.fallbackPolling = true;
    pollMessages();
    state.pollTimer = window.setInterval(pollMessages, 3000);
  }

  function stopFallbackPolling() {
    state.fallbackPolling = false;
    if (state.pollTimer) window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  async function pollMessages() {
    if (!cfg.messagesUrl || state.pollInFlight) return;
    state.pollInFlight = true;
    try {
      const separator = cfg.messagesUrl.includes("?") ? "&" : "?";
      const response = await fetch(`${cfg.messagesUrl}${separator}after_id=${encodeURIComponent(state.latestMessageId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load messages");
      (data.messages || []).forEach((message) => appendMessage(message));
      if (data.messages?.length) scrollDown();
    } catch (error) {
      // Keep the composer usable; the next poll may recover.
    } finally {
      state.pollInFlight = false;
    }
  }

  function initializeLatestMessageId() {
    document.querySelectorAll("[data-msg-id]").forEach((row) => {
      updateLatestMessageId(row.dataset.msgId);
    });
  }

  function updateLatestMessageId(messageId) {
    const numericId = Number(messageId);
    if (Number.isFinite(numericId)) state.latestMessageId = Math.max(state.latestMessageId, numericId);
  }

  function isSocketOpen() {
    return Boolean(state.ws && state.ws.readyState === WebSocket.OPEN);
  }

  function setComposerBusy(isBusy, keepRecorderControls) {
    if (els.msgInput) els.msgInput.disabled = isBusy;
    document.querySelector("[data-file-open]")?.toggleAttribute("disabled", isBusy);
    document.querySelector("[data-emoji-toggle]")?.toggleAttribute("disabled", isBusy);
    if (!keepRecorderControls) els.sendBtn?.toggleAttribute("disabled", isBusy);
  }

  function scrollDown() {
    if (els.msgContainer) els.msgContainer.scrollTop = els.msgContainer.scrollHeight;
  }

  function fileKind(file) {
    const ext = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
    if (file.type.startsWith("image/")) return "Image";
    if (file.type.startsWith("video/")) return "Video";
    if (file.type.startsWith("audio/")) return "Audio";
    if (imageExtensions.has(ext)) return "Image";
    if (videoExtensions.has(ext)) return "Video";
    if (audioExtensions.has(ext)) return "Audio";
    return "File";
  }

  function fileIconSvg(kind) {
    const label = escapeHtml(kind || "File");
    return `<svg viewBox="0 0 24 24" width="24" height="24" aria-label="${label}"><path fill="currentColor" d="M6.75 2A2.75 2.75 0 0 0 4 4.75v14.5A2.75 2.75 0 0 0 6.75 22h10.5A2.75 2.75 0 0 0 20 19.25V8.41a2 2 0 0 0-.59-1.41L15 2.59A2 2 0 0 0 13.59 2H6.75Zm7 1.75V7a1 1 0 0 0 1 1h3.25l-4.25-4.25Z"/></svg>`;
  }

  function closeIconSvg() {
    return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6.7 5.3a1 1 0 0 0-1.4 1.4L10.58 12 5.3 17.3a1 1 0 1 0 1.4 1.4L12 13.42l5.3 5.3a1 1 0 0 0 1.4-1.42L13.42 12l5.3-5.3a1 1 0 0 0-1.42-1.4L12 10.58 6.7 5.3Z"/></svg>';
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatTime(value) {
    return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function formatDuration(totalSeconds) {
    const normalized = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const minutes = Math.floor(normalized / 60);
    const seconds = String(normalized % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function getCsrfToken() {
    return window.CSRF_TOKEN || getCookie("csrftoken") || "";
  }

  function getCookie(name) {
    return document.cookie
      .split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${name}=`))
      ?.split("=")[1] || "";
  }

  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function cssEscape(value) {
    return window.CSS?.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
  }

  window.showCtx = showCtx;
  window.hideCtx = hideCtx;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
