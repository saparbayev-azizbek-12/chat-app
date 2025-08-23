// Enhanced WhatsApp-like Chat JavaScript

class ChatApp {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.roomId = null;
        this.isTyping = false;
        this.typingTimer = null;
        this.messageQueue = [];
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.recordingTimer = null;
        this.recordingStartTime = null;
        this.isRecording = false;
        
        this.initializeApp();
    }
    
    initializeApp() {
        this.bindEvents();
        this.loadEmojiData();
        
        // Auto-focus message input on desktop
        if (window.innerWidth > 768) {
            const messageInput = document.getElementById('messageInput');
            if (messageInput) messageInput.focus();
        }
    }
    
    // Initialize WebSocket connection
    initWebSocket(roomId, currentUser) {
        this.roomId = roomId;
        this.currentUser = currentUser;
        
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/chat/${roomId}/`;
        
        console.log('Connecting to WebSocket:', wsUrl);
        this.showConnectionStatus('Connecting...', 'warning');
        
        this.socket = new WebSocket(wsUrl);
        
        this.socket.onopen = (e) => {
            console.log('WebSocket connected successfully');
            this.showConnectionStatus('Connected', 'success');
            this.flushMessageQueue();
        };
        
        this.socket.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                console.log('Received message:', data);
                this.handleWebSocketMessage(data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };
        
        this.socket.onclose = (e) => {
            console.log('WebSocket disconnected:', e.code, e.reason);
            this.showConnectionStatus('Disconnected', 'danger');
            
            // Attempt to reconnect after 2 seconds
            setTimeout(() => {
                console.log('Attempting to reconnect...');
                this.initWebSocket(roomId, currentUser);
            }, 2000);
        };
        
        this.socket.onerror = (e) => {
            console.error('WebSocket error:', e);
            this.showConnectionStatus('Connection Error', 'danger');
        };
    }
    
    // Handle WebSocket messages
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'message':
                this.addMessageToChat(data.message);
                this.scrollToBottom();
                break;
            case 'typing':
                this.handleTypingIndicator(data.user, data.is_typing);
                break;
            case 'user_online':
                this.updateUserOnlineStatus(data.user_id, true);
                break;
            case 'user_offline':
                this.updateUserOnlineStatus(data.user_id, false);
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
    }
    
    // Send message
    sendMessage() {
        const messageInput = document.getElementById('messageInput');
        if (!messageInput) return;
        
        const content = messageInput.value.trim();
        if (!content) return;
        
        const message = {
            type: 'text',
            content: content
        };
        
        this.sendWebSocketMessage(message);
        messageInput.value = '';
        this.stopTyping();
        
        // Auto-resize textarea
        messageInput.style.height = 'auto';
    }
    
    // Send WebSocket message with queue fallback
    sendWebSocketMessage(message) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            try {
                this.socket.send(JSON.stringify(message));
                console.log('Message sent:', message);
            } catch (error) {
                console.error('Error sending message:', error);
                this.messageQueue.push(message);
            }
        } else {
            console.log('WebSocket not ready, queueing message');
            this.messageQueue.push(message);
            this.showConnectionStatus('Reconnecting...', 'warning');
        }
    }
    
    // Flush queued messages
    flushMessageQueue() {
        while (this.messageQueue.length > 0 && this.socket && this.socket.readyState === WebSocket.OPEN) {
            const message = this.messageQueue.shift();
            try {
                this.socket.send(JSON.stringify(message));
                console.log('Queued message sent:', message);
            } catch (error) {
                console.error('Error sending queued message:', error);
                this.messageQueue.unshift(message); // Put it back
                break;
            }
        }
    }
    
    // Add message to chat UI
    addMessageToChat(message) {
        const messagesContainer = document.getElementById('messagesContainer');
        if (!messagesContainer) return;
        
        // Remove typing indicator
        this.hideTypingIndicator();
        
        const messageElement = this.createMessageElement(message);
        messagesContainer.appendChild(messageElement);
        
        // Animate message appearance
        requestAnimationFrame(() => {
            messageElement.style.opacity = '0';
            messageElement.style.transform = 'translateY(20px)';
            messageElement.style.transition = 'all 0.3s ease';
            
            requestAnimationFrame(() => {
                messageElement.style.opacity = '1';
                messageElement.style.transform = 'translateY(0)';
            });
        });
    }
    
    // Create message element
    createMessageElement(message) {
        const messageDiv = document.createElement('div');
        const isSent = message.sender.id === this.currentUser.id;
        
        messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
        messageDiv.setAttribute('data-message-id', message.id);
        
        let avatarHtml = '';
        if (!isSent) {
            const avatarSrc = message.sender.profile_picture || '';
            const avatarText = message.sender.first_name?.charAt(0) || message.sender.username?.charAt(0) || '?';
            
            avatarHtml = `
                <div class="avatar-container me-2">
                    ${avatarSrc ? 
                        `<img src="${avatarSrc}" alt="${message.sender.username}" class="avatar">` :
                        `<div class="avatar">${avatarText.toUpperCase()}</div>`
                    }
                </div>
            `;
        }
        
        const contentHtml = this.generateMessageContent(message);
        const timeHtml = this.formatMessageTime(message.created_at);
        const statusHtml = isSent ? '<i class="fas fa-check message-status" title="Sent"></i>' : '';
        
        messageDiv.innerHTML = `
            ${avatarHtml}
            <div class="message-bubble">
                ${contentHtml}
                <div class="message-time">
                    ${timeHtml}
                    ${statusHtml}
                </div>
            </div>
        `;
        
        return messageDiv;
    }
    
    // Generate message content based on type
    generateMessageContent(message) {
        switch (message.message_type) {
            case 'text':
                return this.linkify(this.escapeHtml(message.content));
                
            case 'image':
                return `
                    <div class="media-message">
                        <img src="${message.file_url}" alt="Image" onclick="openImageModal('${message.file_url}')" style="cursor: pointer;">
                        ${message.content ? `<div class="mt-2">${this.escapeHtml(message.content)}</div>` : ''}
                    </div>
                `;
                
            case 'video':
                return `
                    <div class="media-message">
                        <video controls>
                            <source src="${message.file_url}" type="video/mp4">
                            Your browser does not support video playback.
                        </video>
                        ${message.content ? `<div class="mt-2">${this.escapeHtml(message.content)}</div>` : ''}
                    </div>
                `;
                
            case 'audio':
            case 'voice':
                return `
                    <div class="voice-message">
                        <button class="voice-play-button" onclick="toggleAudioPlayback('${message.id}')">
                            <i class="fas fa-play" id="play-icon-${message.id}"></i>
                        </button>
                        <div class="voice-waveform"></div>
                        <span class="voice-duration">${this.formatDuration(message.duration || 0)}</span>
                        <audio id="audio-${message.id}" src="${message.file_url}" style="display: none;"></audio>
                    </div>
                `;
                
            case 'file':
                const fileName = message.file_url.split('/').pop();
                const fileExt = fileName.split('.').pop().toLowerCase();
                const fileIcon = this.getFileIcon(fileExt);
                
                return `
                    <div class="file-message">
                        <div class="file-icon">
                            <i class="fas fa-${fileIcon}"></i>
                        </div>
                        <div class="file-info">
                            <div class="file-name">
                                <a href="${message.file_url}" target="_blank" rel="noopener">${fileName}</a>
                            </div>
                            ${message.file_size ? `<div class="file-size">${this.formatFileSize(message.file_size)}</div>` : ''}
                        </div>
                    </div>
                `;
                
            default:
                return this.escapeHtml(message.content || '');
        }
    }
    
    // Typing indicator functions
    startTyping() {
        if (!this.isTyping) {
            this.isTyping = true;
            this.sendWebSocketMessage({
                type: 'typing',
                is_typing: true
            });
        }
        
        // Reset the stop typing timer
        clearTimeout(this.typingTimer);
        this.typingTimer = setTimeout(() => {
            this.stopTyping();
        }, 3000);
    }
    
    stopTyping() {
        if (this.isTyping) {
            this.isTyping = false;
            this.sendWebSocketMessage({
                type: 'typing',
                is_typing: false
            });
        }
        clearTimeout(this.typingTimer);
    }
    
    handleTypingIndicator(user, isTyping) {
        const typingIndicator = document.getElementById('typingIndicator');
        if (!typingIndicator) return;
        
        if (isTyping && user.id !== this.currentUser.id) {
            const userName = user.first_name || user.username;
            typingIndicator.innerHTML = `
                <div class="message received">
                    <div class="avatar-container me-2">
                        <div class="avatar" style="width: 30px; height: 30px; font-size: 0.7rem;">
                            ${userName.charAt(0).toUpperCase()}
                        </div>
                    </div>
                    <div class="message-bubble">
                        <span>${userName} is typing</span>
                        <div class="typing-dots">
                            <div class="typing-dot"></div>
                            <div class="typing-dot"></div>
                            <div class="typing-dot"></div>
                        </div>
                    </div>
                </div>
            `;
            typingIndicator.classList.remove('d-none');
            this.scrollToBottom();
        } else {
            this.hideTypingIndicator();
        }
    }
    
    hideTypingIndicator() {
        const typingIndicator = document.getElementById('typingIndicator');
        if (typingIndicator) {
            typingIndicator.classList.add('d-none');
        }
    }
    
    // File upload functions
    handleFileUpload(files) {
        for (let file of files) {
            this.uploadFile(file);
        }
    }
    
    uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('room_id', this.roomId);
        formData.append('caption', '');
        
        this.showUploadProgress(file.name);
        
        fetch('/api/upload/', {
            method: 'POST',
            body: formData,
            headers: {
                'X-CSRFToken': this.getCookie('csrftoken')
            }
        })
        .then(response => response.json())
        .then(data => {
            this.hideUploadProgress();
            if (data.success) {
                // Notify via WebSocket
                this.sendWebSocketMessage({
                    type: 'media_uploaded',
                    message_id: data.message.id
                });
                
                // Add to chat immediately
                this.addMessageToChat(data.message);
                this.scrollToBottom();
            } else {
                this.showError('File upload failed: ' + data.error);
            }
        })
        .catch(error => {
            this.hideUploadProgress();
            console.error('Upload error:', error);
            this.showError('File upload failed. Please try again.');
        });
    }
    
    // Voice recording functions
    async startVoiceRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];
            
            this.mediaRecorder.ondataavailable = (event) => {
                this.audioChunks.push(event.data);
            };
            
            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
                this.uploadVoiceMessage(audioBlob);
                stream.getTracks().forEach(track => track.stop());
            };
            
            this.mediaRecorder.start();
            this.isRecording = true;
            this.recordingStartTime = Date.now();
            
            this.showRecordingUI();
            this.startRecordingTimer();
            
            console.log('Voice recording started');
        } catch (error) {
            console.error('Error accessing microphone:', error);
            this.showError('Could not access microphone. Please check permissions.');
        }
    }
    
    stopVoiceRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
            this.hideRecordingUI();
            this.stopRecordingTimer();
        }
    }
    
    cancelVoiceRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
            this.audioChunks = [];
            this.hideRecordingUI();
            this.stopRecordingTimer();
        }
    }
    
    uploadVoiceMessage(audioBlob) {
        const formData = new FormData();
        const fileName = `voice_${Date.now()}.wav`;
        formData.append('file', audioBlob, fileName);
        formData.append('room_id', this.roomId);
        formData.append('caption', '');
        
        this.showUploadProgress('Voice message');
        
        fetch('/api/upload/', {
            method: 'POST',
            body: formData,
            headers: {
                'X-CSRFToken': this.getCookie('csrftoken')
            }
        })
        .then(response => response.json())
        .then(data => {
            this.hideUploadProgress();
            if (data.success) {
                data.message.message_type = 'voice';
                
                this.sendWebSocketMessage({
                    type: 'media_uploaded',
                    message_id: data.message.id
                });
                
                this.addMessageToChat(data.message);
                this.scrollToBottom();
            } else {
                this.showError('Voice message upload failed: ' + data.error);
            }
        })
        .catch(error => {
            this.hideUploadProgress();
            console.error('Voice upload error:', error);
            this.showError('Voice message upload failed.');
        });
    }
    
    // UI helper functions
    showRecordingUI() {
        const voiceRecording = document.getElementById('voiceRecording');
        const voiceButton = document.getElementById('voiceButton');
        
        if (voiceRecording) voiceRecording.classList.remove('d-none');
        if (voiceButton) voiceButton.classList.add('recording');
    }
    
    hideRecordingUI() {
        const voiceRecording = document.getElementById('voiceRecording');
        const voiceButton = document.getElementById('voiceButton');
        
        if (voiceRecording) voiceRecording.classList.add('d-none');
        if (voiceButton) voiceButton.classList.remove('recording');
    }
    
    startRecordingTimer() {
        this.recordingTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
            const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const seconds = (elapsed % 60).toString().padStart(2, '0');
            
            const timeDisplay = document.getElementById('recordingTime');
            if (timeDisplay) {
                timeDisplay.textContent = `${minutes}:${seconds}`;
            }
        }, 1000);
    }
    
    stopRecordingTimer() {
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }
    }
    
    // Emoji functions
    loadEmojiData() {
        this.emojiData = {
            smileys: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳'],
            people: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏'],
            nature: ['🌸', '💮', '🏵️', '🌹', '🥀', '🌺', '🌻', '🌼', '🌷', '🌱', '🪴', '🌲', '🌳', '🌴', '🌵', '🌶️', '🍄', '🌾', '💐', '🌿', '🍀', '🍃', '🍂', '🍁', '🌊', '🌀', '🌈'],
            food: ['🍕', '🍔', '🍟', '🌭', '🥪', '🌮', '🌯', '🥙', '🧆', '🥚', '🍳', '🥘', '🍲', '🥗', '🍿', '🧈', '🧂', '🥨', '🥖', '🍞', '🥐', '🥯', '🧇', '🥞', '🍰', '🎂', '🧁'],
            activities: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊'],
            travel: ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🏍️', '🛵', '🚲', '🛴', '🛺', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡'],
            objects: ['💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️', '🪜', '🧰', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🪚'],
            symbols: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️']
        };
    }
    
    toggleEmojiPicker() {
        const emojiPicker = document.getElementById('emojiPicker');
        if (!emojiPicker) return;
        
        emojiPicker.classList.toggle('d-none');
        
        if (!emojiPicker.classList.contains('d-none')) {
            this.populateEmojis('smileys');
        }
    }
    
    populateEmojis(category) {
        const emojiGrid = document.getElementById('emojiGrid');
        if (!emojiGrid) return;
        
        emojiGrid.innerHTML = '';
        
        if (this.emojiData[category]) {
            this.emojiData[category].forEach(emoji => {
                const button = document.createElement('button');
                button.className = 'emoji-item';
                button.textContent = emoji;
                button.onclick = () => this.insertEmoji(emoji);
                emojiGrid.appendChild(button);
            });
        }
        
        // Update active category
        document.querySelectorAll('.emoji-category').forEach(btn => {
            btn.classList.remove('active');
        });
        const activeBtn = document.querySelector(`[data-category="${category}"]`);
        if (activeBtn) activeBtn.classList.add('active');
    }
    
    insertEmoji(emoji) {
        const messageInput = document.getElementById('messageInput');
        if (!messageInput) return;
        
        const cursorPos = messageInput.selectionStart;
        const textBefore = messageInput.value.substring(0, cursorPos);
        const textAfter = messageInput.value.substring(cursorPos);
        
        messageInput.value = textBefore + emoji + textAfter;
        messageInput.focus();
        messageInput.setSelectionRange(cursorPos + emoji.length, cursorPos + emoji.length);
        
        // Hide emoji picker
        document.getElementById('emojiPicker')?.classList.add('d-none');
        
        // Auto-resize
        this.autoResizeTextarea(messageInput);
    }
    
    // Utility functions
    scrollToBottom() {
        const messagesContainer = document.getElementById('messagesContainer');
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }
    
    autoResizeTextarea(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }
    
    formatMessageTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        
        if (isToday) {
            return date.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false 
            });
        } else {
            return date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    }
    
    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    getFileIcon(extension) {
        const iconMap = {
            pdf: 'file-pdf',
            doc: 'file-word', docx: 'file-word',
            xls: 'file-excel', xlsx: 'file-excel',
            ppt: 'file-powerpoint', pptx: 'file-powerpoint',
            txt: 'file-alt',
            zip: 'file-archive', rar: 'file-archive', '7z': 'file-archive',
            jpg: 'file-image', jpeg: 'file-image', png: 'file-image', gif: 'file-image',
            mp4: 'file-video', avi: 'file-video', mov: 'file-video',
            mp3: 'file-audio', wav: 'file-audio', ogg: 'file-audio'
        };
        return iconMap[extension] || 'file';
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    linkify(text) {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    }
    
    getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }
    
    showConnectionStatus(message, type) {
        // Remove existing status
        const existing = document.getElementById('connectionStatus');
        if (existing) existing.remove();
        
        const statusDiv = document.createElement('div');
        statusDiv.id = 'connectionStatus';
        statusDiv.className = `connection-status ${type}`;
        statusDiv.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'warning' ? 'exclamation-triangle' : 'times-circle'}"></i>
            ${message}
        `;
        
        document.body.appendChild(statusDiv);
        
        // Auto-hide success messages
        if (type === 'success') {
            setTimeout(() => {
                if (statusDiv) statusDiv.remove();
            }, 3000);
        }
    }
    
    showUploadProgress(fileName) {
        const messagesContainer = document.getElementById('messagesContainer');
        if (!messagesContainer) return;
        
        const progressDiv = document.createElement('div');
        progressDiv.id = 'uploadProgress';
        progressDiv.className = 'message sent';
        progressDiv.innerHTML = `
            <div class="message-bubble">
                <div class="d-flex align-items-center">
                    <div class="spinner-border spinner-border-sm me-2" role="status"></div>
                    <span>Uploading ${fileName}...</span>
                </div>
            </div>
        `;
        
        messagesContainer.appendChild(progressDiv);
        this.scrollToBottom();
    }
    
    hideUploadProgress() {
        const progressDiv = document.getElementById('uploadProgress');
        if (progressDiv) progressDiv.remove();
    }
    
    showError(message) {
        // Show toast notification
        const toast = document.createElement('div');
        toast.className = 'toast-notification error';
        toast.innerHTML = `
            <i class="fas fa-exclamation-triangle"></i>
            ${message}
        `;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #f44336;
            color: white;
            padding: 15px;
            border-radius: 5px;
            z-index: 2000;
            max-width: 300px;
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 5000);
    }
    
    updateUserOnlineStatus(userId, isOnline) {
        const indicators = document.querySelectorAll(`[data-user-id="${userId}"] .online-indicator`);
        indicators.forEach(indicator => {
            indicator.style.display = isOnline ? 'block' : 'none';
        });
    }
    
    // Event binding
    bindEvents() {
        document.addEventListener('DOMContentLoaded', () => {
            this.setupEventListeners();
        });
    }
    
    setupEventListeners() {
        // Message input events
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
            
            messageInput.addEventListener('input', () => {
                this.startTyping();
                this.autoResizeTextarea(messageInput);
            });
        }
        
        // Send button
        const sendButton = document.getElementById('sendButton');
        if (sendButton) {
            sendButton.addEventListener('click', () => this.sendMessage());
        }
        
        // Emoji category buttons
        document.querySelectorAll('.emoji-category').forEach(btn => {
            btn.addEventListener('click', () => {
                const category = btn.getAttribute('data-category');
                this.populateEmojis(category);
            });
        });
        
        // File upload events
        const fileInput = document.getElementById('fileInput');
        const fileUploadArea = document.getElementById('fileUploadArea');
        
        if (fileInput && fileUploadArea) {
            fileUploadArea.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => this.handleFileUpload(e.target.files));
            
            // Drag and drop
            fileUploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                fileUploadArea.classList.add('dragover');
            });
            
            fileUploadArea.addEventListener('dragleave', (e) => {
                e.preventDefault();
                fileUploadArea.classList.remove('dragover');
            });
            
            fileUploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                fileUploadArea.classList.remove('dragover');
                this.handleFileUpload(e.dataTransfer.files);
            });
        }
        
        // Voice recording button
        const voiceButton = document.getElementById('voiceButton');
        if (voiceButton) {
            voiceButton.addEventListener('click', () => {
                if (this.isRecording) {
                    this.stopVoiceRecording();
                } else {
                    this.startVoiceRecording();
                }
            });
        }
        
        // Mobile sidebar toggle
        const menuToggle = document.querySelector('.menu-toggle');
        const sidebar = document.getElementById('sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        
        if (menuToggle && sidebar) {
            menuToggle.addEventListener('click', () => {
                sidebar.classList.toggle('show');
                if (overlay) overlay.classList.toggle('show');
            });
        }
        
        if (overlay) {
            overlay.addEventListener('click', () => {
                sidebar?.classList.remove('show');
                overlay.classList.remove('show');
            });
        }
        
        // Auto-scroll when window is resized
        window.addEventListener('resize', () => {
            setTimeout(() => this.scrollToBottom(), 100);
        });
        
        // Hide emoji picker when clicking outside
        document.addEventListener('click', (e) => {
            const emojiPicker = document.getElementById('emojiPicker');
            const emojiButton = document.querySelector('[onclick="toggleEmojiPicker()"]');
            
            if (emojiPicker && !emojiPicker.contains(e.target) && e.target !== emojiButton) {
                emojiPicker.classList.add('d-none');
            }
        });
    }
}

// Global functions for backward compatibility
let chatApp = null;

function initializeChat(roomId, currentUser) {
    chatApp = new ChatApp();
    chatApp.initWebSocket(roomId, currentUser);
    chatApp.scrollToBottom();
}

function sendMessage() {
    if (chatApp) chatApp.sendMessage();
}

function toggleEmojiPicker() {
    if (chatApp) chatApp.toggleEmojiPicker();
}

function toggleFileUpload() {
    const fileUploadArea = document.getElementById('fileUploadArea');
    if (fileUploadArea) {
        fileUploadArea.classList.toggle('d-none');
    }
}

function toggleVoiceRecording() {
    if (chatApp) {
        if (chatApp.isRecording) {
            chatApp.stopVoiceRecording();
        } else {
            chatApp.startVoiceRecording();
        }
    }
}

function stopVoiceRecording() {
    if (chatApp) chatApp.stopVoiceRecording();
}

function cancelVoiceRecording() {
    if (chatApp) chatApp.cancelVoiceRecording();
}

function toggleAudioPlayback(messageId) {
    const audio = document.getElementById(`audio-${messageId}`);
    const playIcon = document.getElementById(`play-icon-${messageId}`);
    
    if (audio && playIcon) {
        if (audio.paused) {
            audio.play();
            playIcon.className = 'fas fa-pause';
        } else {
            audio.pause();
            playIcon.className = 'fas fa-play';
        }
        
        audio.onended = () => {
            playIcon.className = 'fas fa-play';
        };
    }
}

function openImageModal(imageUrl) {
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.innerHTML = `
        <div class="modal-dialog modal-lg modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header">
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body text-center">
                    <img src="${imageUrl}" class="img-fluid" alt="Image">
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
    
    modal.addEventListener('hidden.bs.modal', () => modal.remove());
}

// Initialize chat app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    chatApp = new ChatApp();
});
