// ==========================================================
// RETHINK AI - CLIENT APPLICATION LOGIC
// ==========================================================

let currentConversationId = null;
let currentMessages = [];
let isGenerating = false;
let isVoiceRecording = false;
let recognition = null;

// User Identity & Session
let userId = localStorage.getItem('rethink_user_id') || ('user_' + Math.random().toString(36).substr(2, 9));
localStorage.setItem('rethink_user_id', userId);

let userName = localStorage.getItem('rethink_user_name') || 'Friend of Ravi';

// DOM Elements
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const chatHistoryList = document.getElementById('chatHistoryList');
const heroContainer = document.getElementById('heroContainer');
const chatMessagesContainer = document.getElementById('chatMessagesContainer');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const voiceBtn = document.getElementById('voiceBtn');
const modelSelect = document.getElementById('modelSelect');
const userNameInput = document.getElementById('userNameInput');
const userAvatarChar = document.getElementById('userAvatarChar');

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  if (userNameInput) {
    userNameInput.value = userName;
    updateUserAvatar(userName);
    userNameInput.addEventListener('change', (e) => {
      userName = e.target.value.trim() || 'Friend';
      localStorage.setItem('rethink_user_name', userName);
      updateUserAvatar(userName);
    });
  }

  // Sidebar toggle
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      sidebar.classList.toggle('mobile-open');
    });
  }

  // Auto-resize input textarea
  if (chatInput) {
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
      sendBtn.disabled = !chatInput.value.trim();
    });

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  setupSpeechRecognition();
  loadConversationsList();
});

function updateUserAvatar(name) {
  if (userAvatarChar) {
    userAvatarChar.textContent = (name && name[0]) ? name[0].toUpperCase() : 'U';
  }
}

// ==========================================================
// CHAT & CONVERSATION MANAGEMENT
// ==========================================================

function startNewChat() {
  currentConversationId = null;
  currentMessages = [];
  heroContainer.style.display = 'flex';
  chatMessagesContainer.style.display = 'none';
  chatMessagesContainer.innerHTML = '';
  chatInput.value = '';
  chatInput.style.height = 'auto';
  chatInput.focus();

  // Highlight active in sidebar
  document.querySelectorAll('.chat-history-item').forEach(el => el.classList.remove('active'));
}

function usePromptSuggestion(promptText) {
  chatInput.value = promptText;
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
  sendMessage();
}

async function loadConversationsList() {
  try {
    const res = await fetch(`/api/conversations?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) return;
    const data = await res.json();
    renderSidebarHistory(data.conversations || []);
  } catch (err) {
    console.error('Failed to load history:', err);
  }
}

function renderSidebarHistory(convos) {
  chatHistoryList.innerHTML = '';
  if (!convos || convos.length === 0) {
    chatHistoryList.innerHTML = `<div style="padding:10px 14px; font-size:0.78rem; color:var(--text-muted);">No past conversations yet</div>`;
    return;
  }

  convos.forEach(c => {
    const item = document.createElement('div');
    item.className = 'chat-history-item' + (c.id === currentConversationId ? ' active' : '');
    item.id = `history-item-${c.id}`;

    item.innerHTML = `
      <span class="chat-title-text" title="${escapeHtml(c.title)}">${escapeHtml(c.title || 'Conversation')}</span>
      <button class="chat-delete-btn" title="Delete" onclick="deleteHistoryChat(event, '${c.id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.chat-delete-btn')) return;
      loadConversation(c.id);
    });

    chatHistoryList.appendChild(item);
  });
}

async function loadConversation(convoId) {
  try {
    const res = await fetch(`/api/conversation/${convoId}`);
    if (!res.ok) return;
    const data = await res.json();
    const convo = data.conversation;

    currentConversationId = convo.id;
    currentMessages = convo.messages || [];

    // Update active highlight
    document.querySelectorAll('.chat-history-item').forEach(el => el.classList.remove('active'));
    const activeEl = document.getElementById(`history-item-${convoId}`);
    if (activeEl) activeEl.classList.add('active');

    // Switch view
    heroContainer.style.display = 'none';
    chatMessagesContainer.style.display = 'flex';
    chatMessagesContainer.innerHTML = '';

    currentMessages.forEach(msg => {
      appendMessageToUI(msg.role, msg.content, msg.model, msg.timestamp, false);
    });

    scrollToBottom();
  } catch (e) {
    console.error('Error loading conversation:', e);
  }
}

async function deleteHistoryChat(event, id) {
  event.stopPropagation();
  if (!confirm('Are you sure you want to delete this chat?')) return;
  try {
    await fetch(`/api/conversation/${id}`, { method: 'DELETE' });
    if (currentConversationId === id) {
      startNewChat();
    }
    loadConversationsList();
  } catch (e) {
    console.error('Error deleting chat:', e);
  }
}

// ==========================================================
// SEND MESSAGE & STREAMING
// ==========================================================

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isGenerating) return;

  // Switch from Hero to Chat view
  if (heroContainer.style.display !== 'none') {
    heroContainer.style.display = 'none';
    chatMessagesContainer.style.display = 'flex';
  }

  // Add User Message to UI
  appendMessageToUI('user', text, null, new Date().toISOString(), true);
  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendBtn.disabled = true;
  isGenerating = true;

  // Show Animated R Generating Indicator
  const indicator = showGeneratingIndicator();
  scrollToBottom();

  const providerVal = modelSelect ? modelSelect.value : 'auto';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: currentConversationId,
        message: text,
        userName: userName,
        userId: userId,
        provider: providerVal
      })
    });

    const data = await res.json();
    indicator.remove();

    if (!res.ok) {
      appendMessageToUI('assistant', `⚠️ **Error:** ${data.error || 'Unable to get response from AI.'}`, 'Error', new Date().toISOString(), true);
    } else {
      currentConversationId = data.conversationId;
      appendMessageToUI('assistant', data.response, data.model, new Date().toISOString(), true, true);
      loadConversationsList();
    }
  } catch (err) {
    indicator.remove();
    appendMessageToUI('assistant', `⚠️ **Connection Error:** Could not connect to Rethink AI server. Please check your network or server status.`, 'Offline', new Date().toISOString(), true);
  } finally {
    isGenerating = false;
    sendBtn.disabled = false;
    scrollToBottom();
    chatInput.focus();
  }
}

function showGeneratingIndicator() {
  const row = document.createElement('div');
  row.className = 'message-row assistant';
  row.id = 'generatingIndicatorRow';

  row.innerHTML = `
    <div class="message-avatar ai">
      <img src="assets/avatar.svg" alt="Rethink R">
    </div>
    <div class="generating-indicator">
      <img src="assets/avatar.svg" class="generating-r-icon" alt="Generating...">
      <span class="generating-text">Rethink is processing your thought...</span>
    </div>
  `;

  chatMessagesContainer.appendChild(row);
  return row;
}

function appendMessageToUI(role, content, model, timestamp, isFresh = false, animate = false) {
  const row = document.createElement('div');
  row.className = `message-row ${role}` + (isFresh && role === 'assistant' ? ' fresh' : '');

  const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const modelTag = model ? `<span style="color:var(--primary-cyan); font-weight:600;">${escapeHtml(model)}</span>` : '';

  if (role === 'user') {
    row.innerHTML = `
      <div class="message-avatar user">
        ${userName ? userName[0].toUpperCase() : 'U'}
      </div>
      <div class="message-bubble">
        <p>${escapeHtml(content).replace(/\n/g, '<br>')}</p>
        <div class="message-meta" style="justify-content:flex-end;">
          <span>${timeStr}</span>
        </div>
      </div>
    `;
  } else {
    const parsedHtml = renderMarkdown(content);
    row.innerHTML = `
      <div class="message-avatar ai">
        <img src="assets/avatar.svg" alt="Rethink AI">
      </div>
      <div class="message-bubble">
        <div class="markdown-content">${parsedHtml}</div>
        <div class="message-meta">
          ${modelTag}
          <span>${timeStr}</span>
          <div class="message-actions">
            <button class="msg-action-btn" onclick="copyMessageText(this, \`${escapeJsString(content)}\`)" title="Copy message">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              Copy
            </button>
            <button class="msg-action-btn" onclick="speakMessageText(\`${escapeJsString(content)}\`)" title="Read aloud">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
              Listen
            </button>
          </div>
        </div>
      </div>
    `;
  }

  chatMessagesContainer.appendChild(row);
  scrollToBottom();
}

function scrollToBottom() {
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

// ==========================================================
// MARKDOWN RENDERING (Dark Glass Code + Lime Highlights)
// ==========================================================

function renderMarkdown(md) {
  if (!md) return '';
  let html = md;

  // Code Blocks ```lang \n code ```
  html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const safeLang = lang || 'code';
    const safeCode = escapeHtml(code.trim());
    return `
      <div class="code-container">
        <div class="code-header">
          <span>${safeLang.toUpperCase()}</span>
          <button class="code-copy-btn" onclick="copyCodeSnippet(this)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Copy
          </button>
        </div>
        <pre><code>${safeCode}</code></pre>
      </div>
    `;
  });

  // Inline code `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headings
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italics *text*
  html = html.replace(/\*([^*]+)\*/g, '<em class="highlight-lime">$1</em>');

  // Unordered list items
  html = html.replace(/^\s*[-*]\s+(.*)$/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');

  // Numbered lists
  html = html.replace(/^\s*(\d+)\.\s+(.*)$/gim, '<li>$2</li>');

  // Line breaks
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p><div/g, '<div').replace(/<\/div><\/p>/g, '</div>');

  // Highlight RAVI TEJA if mentioned
  html = html.replace(/\bRAVI TEJA\b/gi, '<span class="highlight-lime" style="color:var(--accent-lime); font-weight:800;">RAVI TEJA</span>');

  return html;
}

// Copy Helper
function copyCodeSnippet(btn) {
  const pre = btn.closest('.code-container').querySelector('pre code');
  if (!pre) return;
  navigator.clipboard.writeText(pre.innerText).then(() => {
    btn.innerHTML = '✓ Copied!';
    setTimeout(() => {
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy`;
    }, 2000);
  });
}

function copyMessageText(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ Copied!';
    setTimeout(() => { btn.innerHTML = orig; }, 2000);
  });
}

// Text to Speech
function speakMessageText(text) {
  if (!('speechSynthesis' in window)) {
    alert('Text-to-speech is not supported on this browser.');
    return;
  }
  window.speechSynthesis.cancel();
  const clean = text.replace(/[*#`_]/g, '');
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  window.speechSynthesis.speak(utterance);
}

// ==========================================================
// VOICE INPUT (Web Speech API)
// ==========================================================

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    if (voiceBtn) voiceBtn.style.display = 'none';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isVoiceRecording = true;
    if (voiceBtn) voiceBtn.classList.add('recording');
  };

  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      transcript += event.results[i][0].transcript;
    }
    chatInput.value = transcript;
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
  };

  recognition.onend = () => {
    isVoiceRecording = false;
    if (voiceBtn) voiceBtn.classList.remove('recording');
  };

  recognition.onerror = (e) => {
    console.warn('Speech error:', e.error);
    isVoiceRecording = false;
    if (voiceBtn) voiceBtn.classList.remove('recording');
  };
}

function toggleVoiceInput() {
  if (!recognition) {
    alert('Voice input is not supported in this browser.');
    return;
  }
  if (isVoiceRecording) {
    recognition.stop();
  } else {
    recognition.start();
  }
}

// Export Chat
function exportCurrentChat() {
  if (!currentMessages || currentMessages.length === 0) {
    alert('No active chat to export.');
    return;
  }

  let text = `# RETHINK AI - Conversation Export\n`;
  text += `Generated on: ${new Date().toLocaleString()}\n`;
  text += `Creator: RAVI TEJA\n\n---\n\n`;

  currentMessages.forEach(m => {
    text += `### ${m.role === 'user' ? (userName || 'User') : 'RETHINK AI'} (${m.timestamp || ''})\n\n${m.content}\n\n`;
  });

  const blob = new Blob([text], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rethink_chat_${Date.now()}.md`;
  a.click();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeJsString(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}
