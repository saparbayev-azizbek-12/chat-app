// Enhanced WhatsApp-like Chat JavaScript

class ChatApp {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this._roomId = null; // Private property for tracking
        this.isTyping = false;
        this.typingTimer = null;
        this.messageQueue = [];
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.recordingTimer = null;
        this.recordingStartTime = null;
        this.isRecording = false;
        this.cancelRecording = false;
        this.emojiPickerVisible = false;
        this.selectionMode = false;
        this.selectedMessages = new Set();
        
        this.initializeApp();
    }
    
    // Getter and setter for roomId with logging
    get roomId() {
        return this._roomId;
    }
    
    set roomId(value) {
        this._roomId = value;
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
    
    // Initialize AJAX polling instead of WebSocket
    initWebSocket(roomId, currentUser) {
        // Validate roomId
        if (!roomId || roomId === 'null' || roomId === null || roomId === undefined) {
            return;
        }
        
        this.roomId = roomId;
        this.currentUser = currentUser;
        this.lastMessageTime = null;
        
        console.log('Initializing AJAX polling for room:', roomId);
        console.log('Setting roomId to:', this.roomId, typeof this.roomId);
        this.showConnectionStatus('Connected', 'success');
        
        // Start polling for new messages
        this.startPolling();
        
        // Start polling for online status updates
        this.startOnlineStatusPolling();
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
    
    // Send message via AJAX
    sendMessage() {
        const messageInput = document.getElementById('messageInput');
        if (!messageInput) return;
        
        const content = messageInput.value.trim();
        if (!content) return;
        
        // Check if roomId is valid
        if (!this.roomId || this.roomId === 'null' || this.roomId === null) {
            return;
        }
        
        console.log('Sending message:', content);
        
        const url = `/api/send-message/${this.roomId}/`;
        
        // Send via AJAX
        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-CSRFToken': this.getCookie('csrftoken')
            },
            body: `content=${encodeURIComponent(content)}`
        })
        .then(response => {
            console.log('Response status:', response.status);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Response data:', data);
            if (data.success) {
                console.log('Message sent successfully');
                // Add message to chat immediately
                this.addMessageToChat(data.message);
                this.scrollToBottom();
                // Update last message time
                this.lastMessageTime = data.message.created_at;
            } else {
                console.error('Failed to send message:', data.error);
                this.showError('Failed to send message: ' + data.error);
            }
        })
        .catch(error => {
            // Silently fail
        });
        
        // Clear input
        messageInput.value = '';
        this.stopTyping();
        
        // Auto-resize textarea
        messageInput.style.height = 'auto';
    }
    
    // Start polling for new messages
    startPolling() {
        console.log('Starting message polling...');
        this.pollForMessages();
        
        // Poll every 2 seconds
        this.pollingInterval = setInterval(() => {
            this.pollForMessages();
        }, 2000);
    }
    
    // Start online status polling
    startOnlineStatusPolling() {
        console.log('Starting online status polling...');
        this.updateOnlineStatus();
        
        // Poll every 10 seconds for online status
        this.onlineStatusInterval = setInterval(() => {
            this.updateOnlineStatus();
        }, 10000);
    }
    
    // Poll for new messages
    pollForMessages() {
        // Check if roomId is still valid
        if (!this.roomId || this.roomId === 'null' || this.roomId === null) {
            return;
        }
        
        let url = `/api/get-messages/${this.roomId}/`;
        if (this.lastMessageTime) {
            url += `?last_time=${encodeURIComponent(this.lastMessageTime)}`;
            console.log('Polling for messages after:', this.lastMessageTime);
        } else {
            console.log('Polling for all messages (initial load)');
        }
        
        fetch(url, {
            method: 'GET',
            headers: {
                'X-CSRFToken': this.getCookie('csrftoken')
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.messages && data.messages.length > 0) {
                console.log('Received new messages:', data.messages.length);
                
                data.messages.forEach(message => {
                    // Check if message already exists to avoid duplicates
                    const existingMessage = document.querySelector(`[data-message-id="${message.id}"]`);
                    if (!existingMessage) {
                        this.addMessageToChat(message);
                    }
                    // Update last message time regardless
                    this.lastMessageTime = message.created_at;
                });
                
                // Add long press handlers to existing messages that don't have them
                this.addLongPressToExistingMessages();
                
                this.scrollToBottom();
            }
        })
        .catch(error => {
            // Silently fail
        });
    }
    
    // Update online status display
    updateOnlineStatus() {
        // Get other participant info from page
        const otherParticipantElement = document.querySelector('[data-participant-id]');
        if (!otherParticipantElement) return;
        
        const participantId = otherParticipantElement.getAttribute('data-participant-id');
        
        fetch(`/api/online-status/`, {
            method: 'GET',
            headers: {
                'X-CSRFToken': this.getCookie('csrftoken')
            }
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.online_users) {
                const isOnline = data.online_users.includes(participantId);
                this.updateOnlineIndicators(isOnline);
            } else if (data.error) {
                console.warn('Online status error:', data.error);
            }
        })
        .catch(error => {
            // Silently fail
        });
    }
    
    // Update online indicators in UI
    updateOnlineIndicators(isOnline) {
        const onlineIndicators = document.querySelectorAll('.online-indicator');
        const statusTexts = document.querySelectorAll('.status-text');
        
        onlineIndicators.forEach(indicator => {
            if (isOnline) {
                indicator.style.display = 'block';
            } else {
                indicator.style.display = 'none';
            }
        });
        
        statusTexts.forEach(statusText => {
            if (isOnline) {
                statusText.textContent = 'Online';
                statusText.style.color = 'var(--whatsapp-green)';
            } else {
                // Keep existing "Last seen" text, just update color
                statusText.style.color = '#999';
            }
        });
    }
    
    // Send WebSocket message with queue fallback (disabled for AJAX mode)
    sendWebSocketMessage(message) {
        // WebSocket disabled - using AJAX polling instead
        console.log('WebSocket message ignored (using AJAX mode):', message);
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
        const isSent = this.currentUser ? message.sender.id === this.currentUser.id : false;
        
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
        
        // Add long press handler for selection mode
        this.addLongPressHandler(messageDiv);
        messageDiv.setAttribute('data-long-press-added', 'true');
        
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
                const duration = this.formatDuration(message.duration || 0);
                return `
                    <div class="voice-message">
                        <button class="voice-play-button" onclick="toggleAudioPlayback('${message.id}')">
                            <i class="fas fa-play" id="play-icon-${message.id}"></i>
                        </button>
                        <div class="voice-waveform" id="waveform-${message.id}">
                            <div class="waveform-bars">
                                <div class="bar" style="height: 15px;"></div>
                                <div class="bar" style="height: 25px;"></div>
                                <div class="bar" style="height: 20px;"></div>
                                <div class="bar" style="height: 30px;"></div>
                                <div class="bar" style="height: 18px;"></div>
                                <div class="bar" style="height: 25px;"></div>
                                <div class="bar" style="height: 15px;"></div>
                                <div class="bar" style="height: 22px;"></div>
                            </div>
                        </div>
                        <span class="voice-duration" id="duration-${message.id}">${duration}</span>
                        <audio id="audio-${message.id}" src="${message.file_url}" style="display: none;" 
                               onloadedmetadata="updateVoiceDuration('${message.id}')"
                               ontimeupdate="updateVoiceProgress('${message.id}')"
                               onended="resetVoicePlayback('${message.id}')"></audio>
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
    
    // Typing indicator functions (disabled for AJAX mode)
    startTyping() {
        // Typing indicators disabled in AJAX mode
        if (!this.isTyping) {
            this.isTyping = true;
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
        if (files.length === 0) return;
        
        const file = files[0]; // Only handle first file
        
        // Validate file type
        if (!this.isValidImageFile(file)) {
            this.showError('Only JPG, JPEG, and PNG images are allowed.');
            return;
        }
        
        // Show image preview
        this.showImagePreview(file);
    }
    
    isValidImageFile(file) {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
        const allowedExtensions = ['.jpg', '.jpeg', '.png'];
        
        const isValidType = allowedTypes.includes(file.type.toLowerCase());
        const hasValidExtension = allowedExtensions.some(ext => 
            file.name.toLowerCase().endsWith(ext)
        );
        
        return isValidType && hasValidExtension;
    }
    
    showImagePreview(file) {
        const modal = document.getElementById('imagePreviewModal');
        const previewImage = document.getElementById('previewImage');
        
        if (!modal || !previewImage) {
            console.error('Image preview elements not found');
            return;
        }
        
        // Create file URL for preview
        const fileURL = URL.createObjectURL(file);
        previewImage.src = fileURL;
        
        // Store file for later upload
        this.selectedImageFile = file;
        
        // Show modal
        modal.classList.remove('d-none');
        
        // Add event listeners if not already added
        this.setupImagePreviewListeners();
    }
    
    setupImagePreviewListeners() {
        const cancelBtn = document.getElementById('cancelImageBtn');
        const sendBtn = document.getElementById('sendImageBtn');
        
        if (cancelBtn && !cancelBtn.hasAttribute('data-listener-added')) {
            cancelBtn.addEventListener('click', () => this.cancelImageUpload());
            cancelBtn.setAttribute('data-listener-added', 'true');
        }
        
        if (sendBtn && !sendBtn.hasAttribute('data-listener-added')) {
            sendBtn.addEventListener('click', () => this.confirmImageUpload());
            sendBtn.setAttribute('data-listener-added', 'true');
        }
    }
    
    cancelImageUpload() {
        this.hideImagePreviewModal();
    }
    
    confirmImageUpload() {
        if (!this.selectedImageFile) {
            console.error('No image file selected');
            return;
        }
        
        // Store the file reference before clearing
        const fileToUpload = this.selectedImageFile;
        
        // Hide modal and clean up
        this.hideImagePreviewModal();
        
        // Upload the file
        this.uploadFile(fileToUpload);
    }
    
    hideImagePreviewModal() {
        const modal = document.getElementById('imagePreviewModal');
        const previewImage = document.getElementById('previewImage');
        
        // Hide modal
        modal.classList.add('d-none');
        
        // Clean up
        if (previewImage.src) {
            URL.revokeObjectURL(previewImage.src);
            previewImage.src = '';
        }
        
        this.selectedImageFile = null;
        
        // Reset file input
        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            fileInput.value = '';
        }
    }
    
    uploadFile(file) {
        if (!file) {
            console.error('No file provided to uploadFile');
            this.showError('No file selected for upload');
            return;
        }
        
        // Try to get roomId from multiple sources
        let roomId = this.roomId;
        
        if (!roomId) {
            // Try to get from URL
            const pathParts = window.location.pathname.split('/');
            const chatIndex = pathParts.indexOf('chat');
            if (chatIndex !== -1 && pathParts[chatIndex + 1]) {
                roomId = pathParts[chatIndex + 1];
                this.roomId = roomId; // Update the stored roomId
                console.log('Retrieved roomId from URL:', roomId);
            }
        }
        
        if (!roomId) {
            // Try to get from data attribute
            const chatContainer = document.querySelector('[data-room-id]');
            if (chatContainer) {
                roomId = chatContainer.getAttribute('data-room-id');
                this.roomId = roomId; // Update the stored roomId
                console.log('Retrieved roomId from data attribute:', roomId);
            }
        }
        
        if (!roomId) {
            console.error('No room ID available for upload');
            this.showError('Chat room not available. Please refresh the page.');
            return;
        }
        
        console.log('Uploading file:', file.name, 'to room:', roomId);
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('room_id', roomId);
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
                console.log('File upload successful:', data.message);
                
                // Notify via WebSocket
                this.sendWebSocketMessage({
                    type: 'media_uploaded',
                    message_id: data.message.id
                });
                
                // Add to chat immediately if currentUser is available
                if (this.currentUser) {
                    this.addMessageToChat(data.message);
                    this.scrollToBottom();
                } else {
                    console.log('Message will be loaded via polling since currentUser is not available');
                }
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
            console.log('ChatApp.startVoiceRecording called');
            console.log('Current isRecording:', this.isRecording);
            console.log('Current mediaRecorder:', this.mediaRecorder);
            
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('Got media stream:', stream);
            
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];
            this.recordedBlob = null;
            this.cancelRecording = false;
            
            console.log('MediaRecorder created:', this.mediaRecorder);
            console.log('cancelRecording reset to:', this.cancelRecording);
            
            this.mediaRecorder.ondataavailable = (event) => {
                this.audioChunks.push(event.data);
            };
            
            this.mediaRecorder.onstop = () => {
                this.recordedBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
                stream.getTracks().forEach(track => track.stop());
                
                console.log('MediaRecorder stopped. cancelRecording flag:', this.cancelRecording);
                
                // Only send if not cancelled
                if (!this.cancelRecording) {
                    console.log('Sending voice message...');
                    this.sendVoiceMessage();
                } else {
                    console.log('Voice recording cancelled, not sending');
                }
                
                // Reset cancel flag
                this.cancelRecording = false;
            };
            
            this.mediaRecorder.start();
            this.isRecording = true;
            this.recordingStartTime = Date.now();
            
            console.log('MediaRecorder started, isRecording set to:', this.isRecording);
            
            this.showInlineRecordingUI();
            this.startRecordingTimer();
            
            console.log('Voice recording started successfully');
        } catch (error) {
            console.error('Error accessing microphone:', error);
            this.showError('Could not access microphone. Please check permissions.');
        }
    }
    
    stopVoiceRecording() {
        if (this.mediaRecorder && this.isRecording) {
            console.log('Stopping voice recording and sending...');
            console.log('cancelRecording flag before stop:', this.cancelRecording);
            this.mediaRecorder.stop();
            this.isRecording = false;
            this.hideInlineRecordingUI();
            this.stopRecordingTimer();
            // Note: sendVoiceMessage will be called automatically in mediaRecorder.onstop
        } else {
            console.log('Cannot stop: mediaRecorder or isRecording is false');
        }
    }
    
    cancelVoiceRecording() {
        console.log('ChatApp.cancelVoiceRecording called');
        console.log('mediaRecorder:', this.mediaRecorder);
        console.log('isRecording:', this.isRecording);
        console.log('Current cancelRecording flag:', this.cancelRecording);
        
        if (this.mediaRecorder && this.isRecording) {
            // Set flag to prevent sending BEFORE stopping
            this.cancelRecording = true;
            console.log('cancelRecording flag AFTER setting to true:', this.cancelRecording);
            
            console.log('Cancelling voice recording...');
            
            // Stop timer and UI first
            this.isRecording = false;
            this.hideInlineRecordingUI();
            this.stopRecordingTimer();
            
            // Stop MediaRecorder LAST
            this.mediaRecorder.stop();
            this.recordedBlob = null;
        } else {
            console.log('Cannot cancel: mediaRecorder or isRecording is false');
        }
    }
    
    showInlineRecordingUI() {
        const normalInput = document.getElementById('normalMessageInput');
        const voiceInput = document.getElementById('voiceRecordingInput');
        
        if (normalInput && voiceInput) {
            normalInput.classList.add('d-none');
            voiceInput.classList.remove('d-none');
        }
    }
    
    hideInlineRecordingUI() {
        const normalInput = document.getElementById('normalMessageInput');
        const voiceInput = document.getElementById('voiceRecordingInput');
        
        if (normalInput && voiceInput) {
            normalInput.classList.remove('d-none');
            voiceInput.classList.add('d-none');
        }
    }
    
    sendVoiceMessage() {
        if (!this.recordedBlob) {
            console.error('No recorded audio to send');
            return;
        }
        
        console.log('Sending voice message...');
        this.uploadVoiceMessage(this.recordedBlob);
    }
    
    showVoicePreview() {
        console.log('Showing voice preview...');
        if (this.recordedBlob) {
            // Set audio source for preview
            const previewAudio = document.getElementById('previewAudio');
            const url = URL.createObjectURL(this.recordedBlob);
            previewAudio.src = url;
            
            // Calculate and display duration
            previewAudio.addEventListener('loadedmetadata', () => {
                const duration = this.formatDuration(Math.floor(previewAudio.duration));
                document.getElementById('previewDuration').textContent = duration;
            });
            
            // Show modal
            const modal = new bootstrap.Modal(document.getElementById('voicePreviewModal'));
            modal.show();
        }
    }
    
    uploadVoiceMessage(audioBlob) {
        const formData = new FormData();
        const fileName = `voice_${Date.now()}.wav`;
        formData.append('file', audioBlob, fileName);
        formData.append('room_id', this.roomId);
        formData.append('caption', '');
        
        // Calculate duration from recording time
        const recordingDuration = this.recordingStartTime ? 
            Math.round((Date.now() - this.recordingStartTime) / 1000) : 0;
        formData.append('duration', recordingDuration);
        
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
                console.log('Voice message uploaded successfully');
                // No need to manually add to chat, polling will fetch it
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
        const overlay = document.getElementById('voiceRecordingOverlay');
        const voiceButton = document.getElementById('voiceButton');
        
        if (overlay) {
            overlay.classList.remove('d-none');
            // Reset timer
            document.getElementById('recordingTimer').textContent = '00:00';
        }
        if (voiceButton) voiceButton.classList.add('recording');
    }
    
    hideRecordingUI() {
        const overlay = document.getElementById('voiceRecordingOverlay');
        const voiceButton = document.getElementById('voiceButton');
        
        if (overlay) overlay.classList.add('d-none');
        if (voiceButton) voiceButton.classList.remove('recording');
    }
    
    startRecordingTimer() {
        this.recordingTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
            const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const seconds = (elapsed % 60).toString().padStart(2, '0');
            
            const timeDisplay = document.getElementById('recordingTimerDisplay');
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
            smileys: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕'],
            people: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅', '👄', '💋', '🩸', '👶', '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔', '👩', '🧓', '👴', '👵', '🙍', '🙎', '🙅', '🙆', '💁', '🙋', '🧏', '🙇', '🤦', '🤷', '👮', '🕵️', '💂', '🥷', '👷', '🤴', '👸', '👳', '👲', '🧕', '🤵', '👰', '🤰', '🤱', '👼', '🎅', '🤶', '🦸', '🦹', '🧙', '🧚', '🧛', '🧜', '🧝', '🧞', '🧟', '💆', '💇', '🚶', '🧍', '🧎', '🏃', '💃', '🕺', '🕴️', '👯', '🧖', '🧗', '🤺', '🏇', '⛷️', '🏂', '🏌️', '🏄', '🚣', '🏊', '⛹️', '🏋️', '🚴', '🚵', '🤸', '🤼', '🤽', '🤾', '🤹', '🧘', '🛀', '🛌'],
            nature: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟', '🦗', '🕷️', '🕸️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐈', '🐓', '🦃', '🦚', '🦜', '🦢', '🦩', '🕊️', '🐇', '🦝', '🦨', '🦡', '🦦', '🦥', '🐁', '🐀', '🌸', '💮', '🏵️', '🌹', '🥀', '🌺', '🌻', '🌼', '🌷', '🌱', '🪴', '🌲', '🌳', '🌴', '🌵', '🌶️', '🍄', '🌾', '💐', '🌿', '🍀', '🍃', '🍂', '🍁', '🌊', '🌀', '🌈', '🌤️', '⛅', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '☃️', '⛄', '🌬️', '💨', '🌪️', '☀️', '🌞', '🌝', '🌛', '🌜', '🌚', '🌕', '🌖', '🌗', '🌘', '🌑', '🌒', '🌓', '🌔', '🌙', '⭐', '🌟', '💫', '⚡', '☄️', '💥', '🔥', '🌋'],
            food: ['🍇', '🍈', '🍉', '🍊', '🍋', '🍌', '🍍', '🥭', '🍎', '🍏', '🍐', '🍑', '🍒', '🍓', '🫐', '🥝', '🍅', '🫒', '🥥', '🥑', '🍆', '🥔', '🥕', '🌽', '🌶️', '🫑', '🥒', '🥬', '🥦', '🧄', '🧅', '🍄', '🥜', '🌰', '🍞', '🥐', '🥖', '🫓', '🥨', '🥯', '🥞', '🧇', '🧀', '🍖', '🍗', '🥩', '🥓', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🫔', '🥙', '🧆', '🥚', '🍳', '🥘', '🍲', '🫕', '🥗', '🍿', '🧈', '🧂', '🍱', '🍘', '🍙', '🍚', '🍛', '🍜', '🍝', '🍠', '🍢', '🍣', '🍤', '🍥', '🥮', '🍡', '🥟', '🥠', '🥡', '🦀', '🦞', '🦐', '🦑', '🦪', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭', '🍮', '🍯', '🍼', '🥛', '☕', '🫖', '🍵', '🍶', '🍾', '🍷', '🍸', '🍹', '🍺', '🍻', '🥂', '🥃', '🥤', '🧋', '🧃', '🧉', '🧊'],
            activities: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️', '🤺', '🤾', '🏌️', '🏇', '🧘', '🏄', '🏊', '🤽', '🚣', '🧗', '🚵', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🏵️', '🎗️', '🎫', '🎟️', '🎪', '🤹', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧', '🎼', '🎵', '🎶', '🪘', '🥁', '🪗', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩'],
            travel: ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🏍️', '🛵', '🚲', '🛴', '🛺', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '🛩️', '💺', '🛰️', '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚢', '⚓', '⛽', '🚧', '🚦', '🚥', '🚏', '🗺️', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟️', '🎡', '🎢', '🎠', '⛲', '⛱️', '🏖️', '🏝️', '🏜️', '🌋', '⛰️', '🏔️', '🗻', '🏕️', '⛺', '🛖', '🏠', '🏡', '🏘️', '🏚️', '🏗️', '🏭', '🏢', '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏫', '🏩', '💒', '🏛️', '⛪', '🕌', '🛕', '🕍', '🕯️', '💡', '🔦', '🪔'],
            objects: ['💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️', '🪜', '🧰', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🪚', '🔩', '⚙️', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '🪦', '⚱️', '🏺', '🔮', '📿', '🧿', '💈', '⚗️', '🔭', '🔬', '🕳️', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹', '🪠', '🧽', '🧴', '🛎️', '🔑', '🗝️', '🚪', '🪑', '🛏️', '🛋️', '🪞', '🚿', '🛁', '🚽', '🪤', '🪒', '🧴', '🧷', '🧹', '🧺', '🔱', '🔰', '⚱️', '🏺', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', '🗜️', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️', '⌛', '⏳', '📡', '🔋', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️', '🪜', '🧰', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🪚'],
            symbols: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🛗', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '⚧️', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '🟰', '♾️', '💲', '💱', '™️', '©️', '®️', '〰️', '➰', '➿', '🔚', '🔙', '🔛', '🔝', '🔜', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '◾', '◽', '◼️', '◻️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '👁️‍🗨️', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢', '🕣', '🕤', '🕥', '🕦', '🕧']
        };
    }
    
    toggleEmojiPicker() {
        const emojiPicker = document.getElementById('emojiPicker');
        
        if (!emojiPicker) {
            console.error('Emoji picker element not found!');
            return;
        }
        
        if (!this.emojiPickerVisible) {
            // Show emoji picker
            this.emojiPickerVisible = true;
            this.populateEmojis('smileys');
            this.showEmojiPicker(emojiPicker);
        } else {
            // Hide emoji picker  
            this.emojiPickerVisible = false;
            this.hideEmojiPicker(emojiPicker);
        }
    }
    
    showEmojiPicker(emojiPicker) {
        // Apply proper emoji picker styles
        emojiPicker.style.setProperty('display', 'block', 'important');
        emojiPicker.style.setProperty('visibility', 'visible', 'important');
        emojiPicker.style.setProperty('opacity', '1', 'important');
        emojiPicker.style.setProperty('z-index', '9999', 'important');
        emojiPicker.style.setProperty('border', '1px solid #ddd', 'important');
        emojiPicker.style.setProperty('border-radius', '8px', 'important');
        emojiPicker.style.setProperty('position', 'fixed', 'important');
        emojiPicker.style.setProperty('bottom', '80px', 'important');
        emojiPicker.style.setProperty('right', '20px', 'important');
        emojiPicker.style.setProperty('transform', 'none', 'important');
        emojiPicker.style.setProperty('background', 'white', 'important');
        emojiPicker.style.setProperty('width', '320px', 'important');
        emojiPicker.style.setProperty('height', '280px', 'important');
        emojiPicker.style.setProperty('box-shadow', '0 4px 20px rgba(0, 0, 0, 0.15)', 'important');
        emojiPicker.style.setProperty('overflow', 'hidden', 'important');
        

    }
    
    hideEmojiPicker(emojiPicker) {
        emojiPicker.style.setProperty('display', 'none', 'important');
        emojiPicker.style.setProperty('visibility', 'hidden', 'important');
        emojiPicker.style.setProperty('opacity', '0', 'important');
        

    }
    
    populateEmojis(category) {
        const emojiGrid = document.getElementById('emojiGrid');
        
        if (!emojiGrid) {
            console.error('Emoji grid not found');
            return;
        }
        
        emojiGrid.innerHTML = '';
        
        if (this.emojiData[category]) {
            this.emojiData[category].forEach((emoji, index) => {
                const button = document.createElement('button');
                button.className = 'emoji-item';
                button.textContent = emoji;
                button.style.setProperty('background', 'none', 'important');
                button.style.setProperty('border', 'none', 'important');
                button.style.setProperty('padding', '8px', 'important');
                button.style.setProperty('border-radius', '4px', 'important');
                button.style.setProperty('font-size', '20px', 'important');
                button.style.setProperty('cursor', 'pointer', 'important');
                button.style.setProperty('transition', 'background-color 0.2s', 'important');
                button.style.setProperty('width', '32px', 'important');
                button.style.setProperty('height', '32px', 'important');
                button.style.setProperty('display', 'flex', 'important');
                button.style.setProperty('align-items', 'center', 'important');
                button.style.setProperty('justify-content', 'center', 'important');
                
                // Hover effect
                button.addEventListener('mouseenter', () => {
                    button.style.setProperty('background', '#f0f0f0', 'important');
                    button.style.setProperty('transform', 'scale(1.1)', 'important');
                });
                button.addEventListener('mouseleave', () => {
                    button.style.setProperty('background', 'none', 'important');
                    button.style.setProperty('transform', 'scale(1)', 'important');
                });
                button.onclick = () => {
                    console.log('Emoji clicked:', emoji);
                    this.insertEmoji(emoji);
                };
                emojiGrid.appendChild(button);
                
            });
        } else {
            console.error(`No emoji data found for category: ${category}`);
        }
        
        // Update active category
        document.querySelectorAll('.emoji-category').forEach(btn => {
            btn.classList.remove('active');
        });
        const activeBtn = document.querySelector(`[data-category="${category}"]`);
        if (activeBtn) activeBtn.classList.add('active');
        
        // Style emoji grid properly
        emojiGrid.style.setProperty('padding', '10px', 'important');
        emojiGrid.style.setProperty('height', '220px', 'important');
        emojiGrid.style.setProperty('overflow-y', 'auto', 'important');
        emojiGrid.style.setProperty('display', 'grid', 'important');
        emojiGrid.style.setProperty('grid-template-columns', 'repeat(8, 1fr)', 'important');
        emojiGrid.style.setProperty('gap', '4px', 'important');
        emojiGrid.style.setProperty('align-content', 'start', 'important');
        emojiGrid.style.setProperty('background', 'white', 'important');

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
        
        // Auto-resize
        this.autoResizeTextarea(messageInput);
    }
    
    // Message Selection Functions
    enableSelectionMode() {
        this.selectionMode = true;
        this.selectedMessages.clear();
        
        // Show selection header
        const selectionHeader = document.getElementById('selectionHeader');
        const messagesContainer = document.getElementById('messagesContainer');
        
        if (selectionHeader) {
            selectionHeader.classList.remove('d-none');
        }
        
        if (messagesContainer) {
            messagesContainer.classList.add('selection-mode');
            messagesContainer.style.paddingTop = '70px'; // Account for selection header
        }
        
        // Add checkboxes to all messages
        this.addCheckboxesToMessages();
        
        // Update UI
        this.updateSelectionHeader();
        
        // Setup event listeners
        this.setupSelectionEventListeners();
    }
    
    disableSelectionMode() {
        this.selectionMode = false;
        this.selectedMessages.clear();
        
        // Hide selection header
        const selectionHeader = document.getElementById('selectionHeader');
        const messagesContainer = document.getElementById('messagesContainer');
        
        if (selectionHeader) {
            selectionHeader.classList.add('d-none');
        }
        
        if (messagesContainer) {
            messagesContainer.classList.remove('selection-mode');
            messagesContainer.style.paddingTop = ''; // Reset padding
        }
        
        // Remove checkboxes from messages
        this.removeCheckboxesFromMessages();
        
        // Remove selected styling
        document.querySelectorAll('.message.selected').forEach(msg => {
            msg.classList.remove('selected');
        });
    }
    
    addCheckboxesToMessages() {
        const messages = document.querySelectorAll('.message');
        messages.forEach(message => {
            if (!message.querySelector('.message-checkbox')) {
                const messageId = message.getAttribute('data-message-id');
                const checkbox = document.createElement('div');
                checkbox.className = 'message-checkbox';
                checkbox.setAttribute('data-message-id', messageId);
                checkbox.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleMessageSelection(messageId, message, checkbox);
                });
                message.appendChild(checkbox);
            }
        });
    }
    
    removeCheckboxesFromMessages() {
        document.querySelectorAll('.message-checkbox').forEach(checkbox => {
            checkbox.remove();
        });
    }
    
    toggleMessageSelection(messageId, messageElement, checkbox) {
        if (this.selectedMessages.has(messageId)) {
            // Deselect
            this.selectedMessages.delete(messageId);
            messageElement.classList.remove('selected');
            checkbox.classList.remove('checked');
        } else {
            // Select
            this.selectedMessages.add(messageId);
            messageElement.classList.add('selected');
            checkbox.classList.add('checked');
        }
        
        this.updateSelectionHeader();
        
        // If no messages selected, disable selection mode
        if (this.selectedMessages.size === 0) {
            this.disableSelectionMode();
        }
    }
    
    updateSelectionHeader() {
        const selectionCount = document.getElementById('selectionCount');
        const deleteBtn = document.getElementById('deleteSelectedBtn');
        
        if (selectionCount) {
            const count = this.selectedMessages.size;
            selectionCount.textContent = `${count} selected`;
        }
        
        if (deleteBtn) {
            deleteBtn.disabled = this.selectedMessages.size === 0;
        }
    }
    
    setupSelectionEventListeners() {
        const cancelBtn = document.getElementById('cancelSelectionBtn');
        const deleteBtn = document.getElementById('deleteSelectedBtn');
        
        if (cancelBtn && !cancelBtn.hasAttribute('data-selection-listener')) {
            cancelBtn.addEventListener('click', () => this.disableSelectionMode());
            cancelBtn.setAttribute('data-selection-listener', 'true');
        }
        
        if (deleteBtn && !deleteBtn.hasAttribute('data-selection-listener')) {
            deleteBtn.addEventListener('click', () => this.showDeleteConfirmation());
            deleteBtn.setAttribute('data-selection-listener', 'true');
        }
    }
    
    showDeleteConfirmation() {
        if (this.selectedMessages.size === 0) return;
        
        const deleteModal = document.getElementById('deleteModal');
        const deleteCountText = document.getElementById('deleteCountText');
        
        if (deleteCountText) {
            deleteCountText.textContent = this.selectedMessages.size;
        }
        
        if (deleteModal) {
            deleteModal.classList.remove('d-none');
        }
        
        // Setup modal event listeners
        this.setupDeleteModalListeners();
    }
    
    setupDeleteModalListeners() {
        const cancelBtn = document.getElementById('cancelDeleteBtn');
        const confirmBtn = document.getElementById('confirmDeleteBtn');
        
        if (cancelBtn && !cancelBtn.hasAttribute('data-delete-listener')) {
            cancelBtn.addEventListener('click', () => this.hideDeleteModal());
            cancelBtn.setAttribute('data-delete-listener', 'true');
        }
        
        if (confirmBtn && !confirmBtn.hasAttribute('data-delete-listener')) {
            confirmBtn.addEventListener('click', () => this.confirmDelete());
            confirmBtn.setAttribute('data-delete-listener', 'true');
        }
    }
    
    hideDeleteModal() {
        const deleteModal = document.getElementById('deleteModal');
        if (deleteModal) {
            deleteModal.classList.add('d-none');
        }
    }
    
    confirmDelete() {
        if (this.selectedMessages.size === 0) return;
        
        const messageIds = Array.from(this.selectedMessages);
        
        // Show loading state
        this.showUploadProgress('Deleting messages...');
        
        // Call delete API
        fetch('/api/delete-messages/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': this.getCookie('csrftoken')
            },
            body: JSON.stringify({
                message_ids: messageIds
            })
        })
        .then(response => response.json())
        .then(data => {
            this.hideUploadProgress();
            this.hideDeleteModal();
            
            if (data.success) {
                // Remove messages from UI
                messageIds.forEach(id => {
                    const messageElement = document.querySelector(`[data-message-id="${id}"]`);
                    if (messageElement) {
                        messageElement.remove();
                    }
                });
                
                // Disable selection mode
                this.disableSelectionMode();
                
                // Show success message
                this.showSuccessMessage(data.message || 'Messages deleted successfully');
            } else {
                this.showError(data.error || 'Failed to delete messages');
            }
        })
        .catch(error => {
            this.hideUploadProgress();
            this.hideDeleteModal();
            console.error('Delete error:', error);
            this.showError('Failed to delete messages. Please try again.');
        });
    }
    
    showSuccessMessage(message) {
        // You can implement a toast notification here
        console.log('Success:', message);
    }
    
    addLongPressHandler(messageElement) {
        let longPressTimer;
        let isLongPress = false;
        
        const startLongPress = (e) => {
            isLongPress = false;
            longPressTimer = setTimeout(() => {
                isLongPress = true;
                if (!this.selectionMode) {
                    this.enableSelectionMode();
                    // Auto-select the long-pressed message
                    const messageId = messageElement.getAttribute('data-message-id');
                    if (messageId) {
                        const checkbox = messageElement.querySelector('.message-checkbox');
                        if (checkbox) {
                            this.toggleMessageSelection(messageId, messageElement, checkbox);
                        }
                    }
                }
                // Haptic feedback for mobile
                if (navigator.vibrate) {
                    navigator.vibrate(50);
                }
            }, 500); // 500ms for long press
        };
        
        const cancelLongPress = () => {
            clearTimeout(longPressTimer);
        };
        
        const handleClick = (e) => {
            if (isLongPress) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
            
            // If in selection mode, toggle selection on click
            if (this.selectionMode) {
                e.preventDefault();
                e.stopPropagation();
                const messageId = messageElement.getAttribute('data-message-id');
                const checkbox = messageElement.querySelector('.message-checkbox');
                if (messageId && checkbox) {
                    this.toggleMessageSelection(messageId, messageElement, checkbox);
                }
                return false;
            }
        };
        
        // Touch events for mobile
        messageElement.addEventListener('touchstart', startLongPress);
        messageElement.addEventListener('touchend', cancelLongPress);
        messageElement.addEventListener('touchmove', cancelLongPress);
        
        // Mouse events for desktop
        messageElement.addEventListener('mousedown', startLongPress);
        messageElement.addEventListener('mouseup', cancelLongPress);
        messageElement.addEventListener('mouseleave', cancelLongPress);
        
        // Click handler
        messageElement.addEventListener('click', handleClick);
    }
    
    addLongPressToExistingMessages() {
        const messages = document.querySelectorAll('.message:not([data-long-press-added])');
        messages.forEach(messageElement => {
            this.addLongPressHandler(messageElement);
            messageElement.setAttribute('data-long-press-added', 'true');
        });
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
        // Setup event listeners immediately if DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.setupEventListeners();
            });
        } else {
            this.setupEventListeners();
        }
    }
    
    setupEventListeners() {
        // Message input events
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            console.log('Message input found, setting up event listeners');
            messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    console.log('Enter key pressed, sending message');
                    this.sendMessage();
                }
            });
            
            messageInput.addEventListener('input', () => {
                this.startTyping();
                this.autoResizeTextarea(messageInput);
            });
        } else {
            console.error('Message input not found!');
        }
        
        // Send button
        const sendButton = document.getElementById('sendButton');
        if (sendButton) {
            console.log('Send button found, setting up click listener');
            sendButton.addEventListener('click', () => {
                console.log('Send button clicked');
                this.sendMessage();
            });
        } else {
            console.error('Send button not found!');
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
    
    // Cleanup method
    cleanup() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        if (this.onlineStatusInterval) {
            clearInterval(this.onlineStatusInterval);
            this.onlineStatusInterval = null;
        }
        

    }
}

// Global functions for backward compatibility
let chatApp = null;

function initializeChat(roomId, currentUser) {
    // Only cleanup if existing chatApp has valid roomId or if roomIds differ
    if (chatApp) {
        if (chatApp.roomId === roomId) {
            return; // Don't reinitialize same room
        }
        chatApp.cleanup(); // Cleanup previous instance
    }
    
    chatApp = new ChatApp();
    chatApp.initWebSocket(roomId, currentUser);
    chatApp.scrollToBottom();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (chatApp) {
        chatApp.cleanup();
    }
});

function sendMessage() {
    if (chatApp) {
        chatApp.sendMessage();
    }
}

function toggleEmojiPicker() {
    console.log('Global toggleEmojiPicker called');
    if (chatApp) {
        console.log('Calling chatApp.toggleEmojiPicker()');
        chatApp.toggleEmojiPicker();
    } else {
        console.error('chatApp not found for emoji picker');
    }
}

function toggleFileUpload() {
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.click(); // Open file browser directly
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

// Update global function
function startVoiceRecording() {
    console.log('Global startVoiceRecording called');
    if (chatApp) {
        console.log('Calling chatApp.startVoiceRecording()');
        chatApp.startVoiceRecording();
    } else {
        console.error('chatApp not found');
    }
}

function stopVoiceRecording() {
    if (chatApp) chatApp.stopVoiceRecording();
}

function cancelVoiceRecording() {
    console.log('Global cancelVoiceRecording called');
    console.log('chatApp exists:', !!chatApp);
    console.log('chatApp.isRecording:', chatApp?.isRecording);
    console.log('chatApp.mediaRecorder:', chatApp?.mediaRecorder);
    
    if (chatApp) {
        console.log('Calling chatApp.cancelVoiceRecording()');
        chatApp.cancelVoiceRecording();
    } else {
        console.error('chatApp not found');
    }
}

function toggleAudioPlayback(messageId) {
    const audio = document.getElementById(`audio-${messageId}`);
    const playIcon = document.getElementById(`play-icon-${messageId}`);
    const waveform = document.querySelector(`[onclick="toggleAudioPlayback('${messageId}')"]`).closest('.voice-message').querySelector('.voice-waveform');
    
    if (audio && playIcon) {
        if (audio.paused) {
            // Pause all other playing audios
            document.querySelectorAll('audio').forEach(otherAudio => {
                if (otherAudio !== audio && !otherAudio.paused) {
                    otherAudio.pause();
                    // Reset their play icons
                    const otherId = otherAudio.id.replace('audio-', '');
                    const otherIcon = document.getElementById(`play-icon-${otherId}`);
                    if (otherIcon) otherIcon.className = 'fas fa-play';
                }
            });
            
            audio.play();
            playIcon.className = 'fas fa-pause';
        } else {
            audio.pause();
            playIcon.className = 'fas fa-play';
        }
        
        audio.onended = () => {
            playIcon.className = 'fas fa-play';
            if (waveform) {
                waveform.style.setProperty('--progress', '0%');
            }
        };
    }
}

function updateVoiceDuration(messageId) {
    const audio = document.getElementById(`audio-${messageId}`);
    const durationElement = document.getElementById(`duration-${messageId}`);
    
    if (audio && durationElement && audio.duration) {
        const minutes = Math.floor(audio.duration / 60);
        const seconds = Math.floor(audio.duration % 60);
        durationElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
}

function updateVoiceProgress(messageId) {
    const audio = document.getElementById(`audio-${messageId}`);
    const waveform = document.getElementById(`waveform-${messageId}`);
    const durationElement = document.getElementById(`duration-${messageId}`);
    
    if (audio && waveform && durationElement && audio.duration) {
        const progress = (audio.currentTime / audio.duration) * 100;
        waveform.style.setProperty('--progress', `${progress}%`);
        
        // Update current time display
        const currentMinutes = Math.floor(audio.currentTime / 60);
        const currentSeconds = Math.floor(audio.currentTime % 60);
        durationElement.textContent = `${currentMinutes}:${currentSeconds.toString().padStart(2, '0')}`;
    }
}

function resetVoicePlayback(messageId) {
    const playIcon = document.getElementById(`play-icon-${messageId}`);
    const waveform = document.getElementById(`waveform-${messageId}`);
    const durationElement = document.getElementById(`duration-${messageId}`);
    const audio = document.getElementById(`audio-${messageId}`);
    
    if (playIcon) playIcon.className = 'fas fa-play';
    if (waveform) waveform.style.setProperty('--progress', '0%');
    
    // Reset to original duration
    if (audio && durationElement && audio.duration) {
        const minutes = Math.floor(audio.duration / 60);
        const seconds = Math.floor(audio.duration % 60);
        durationElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
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

// Initialize chat app immediately
if (!chatApp) {
    chatApp = new ChatApp();
    console.log('ChatApp created');
}
