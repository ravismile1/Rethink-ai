// ==========================================================
// RETHINK AI - ADMIN PORTAL LOGIC (RAVI TEJA)
// ==========================================================

let adminToken = localStorage.getItem('rethink_admin_jwt') || null;
let allConversations = [];
let selectedConversationId = null;

const adminLoginScreen = document.getElementById('adminLoginScreen');
const adminDashboard = document.getElementById('adminDashboard');
const loginError = document.getElementById('loginError');

document.addEventListener('DOMContentLoaded', () => {
  if (adminToken) {
    verifyAndLoadAdmin();
  } else {
    showLogin();
  }
});

function showLogin() {
  adminLoginScreen.style.display = 'flex';
  adminDashboard.style.display = 'none';
}

function showDashboard() {
  adminLoginScreen.style.display = 'none';
  adminDashboard.style.display = 'flex';
  loadDashboardData();
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  loginError.style.display = 'none';

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      loginError.textContent = data.error || 'Invalid credentials';
      loginError.style.display = 'block';
      return;
    }

    adminToken = data.token;
    localStorage.setItem('rethink_admin_jwt', adminToken);
    showDashboard();
  } catch (err) {
    loginError.textContent = 'Server connection failed';
    loginError.style.display = 'block';
  }
}

function handleAdminLogout() {
  adminToken = null;
  localStorage.removeItem('rethink_admin_jwt');
  showLogin();
}

async function verifyAndLoadAdmin() {
  try {
    const res = await fetch('/api/admin/overview', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (!res.ok) {
      handleAdminLogout();
      return;
    }
    showDashboard();
  } catch (e) {
    handleAdminLogout();
  }
}

// Load Dashboard Data
async function loadDashboardData() {
  loadOverviewStats();
  loadAllConversations();
  loadAdminSettings();
}

async function loadOverviewStats() {
  try {
    const res = await fetch('/api/admin/overview', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('statTotalConvos').textContent = data.stats.totalConversations || 0;
    document.getElementById('statTotalMessages').textContent = data.stats.totalMessages || 0;
    document.getElementById('statTotalUsers').textContent = data.stats.totalUsers || 0;

    const topModel = Object.keys(data.stats.modelUsage || {})[0] || 'Gemini 3.6 Flash';
    document.getElementById('statAiEngine').textContent = topModel;
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

async function loadAllConversations() {
  try {
    const res = await fetch('/api/admin/conversations', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    allConversations = data.conversations || [];
    renderConversationsList(allConversations);

    // If one was previously selected, refresh it
    if (selectedConversationId) {
      inspectConversation(selectedConversationId);
    }
  } catch (err) {
    console.error('Failed to load convos:', err);
  }
}

function renderConversationsList(convos) {
  const container = document.getElementById('adminConvoList');
  container.innerHTML = '';

  if (!convos || convos.length === 0) {
    container.innerHTML = '<div style="padding:16px; color:var(--text-muted); font-size:0.85rem; text-align:center;">No conversations found</div>';
    return;
  }

  convos.forEach(c => {
    const card = document.createElement('div');
    card.className = 'convo-item-card' + (c.id === selectedConversationId ? ' selected' : '');
    card.id = `admin-card-${c.id}`;

    const msgCount = (c.messages || []).length;
    const lastMsg = c.messages && c.messages.length > 0 ? c.messages[c.messages.length - 1].content : 'No messages';
    const timeFormatted = new Date(c.updatedAt || c.createdAt).toLocaleString();

    card.innerHTML = `
      <div class="convo-user-line">
        <span class="convo-username">${escapeHtml(c.userName || 'Guest')}</span>
        <span class="convo-time">${timeFormatted.split(',')[1] || ''}</span>
      </div>
      <div class="convo-preview">${escapeHtml(c.title || lastMsg)}</div>
      <div class="convo-meta-tag">
        💬 ${msgCount} msgs • IP: ${escapeHtml(c.userIp || '127.0.0.1')}
      </div>
    `;

    card.addEventListener('click', () => inspectConversation(c.id));
    container.appendChild(card);
  });
}

function handleSearchConvos() {
  const q = document.getElementById('convoSearchInput').value.toLowerCase().trim();
  if (!q) {
    renderConversationsList(allConversations);
    return;
  }

  const filtered = allConversations.filter(c => 
    (c.userName && c.userName.toLowerCase().includes(q)) ||
    (c.title && c.title.toLowerCase().includes(q)) ||
    (c.userIp && c.userIp.includes(q)) ||
    (c.messages && c.messages.some(m => m.content.toLowerCase().includes(q)))
  );

  renderConversationsList(filtered);
}

async function inspectConversation(convoId) {
  selectedConversationId = convoId;

  // Highlight card
  document.querySelectorAll('.convo-item-card').forEach(el => el.classList.remove('selected'));
  const card = document.getElementById(`admin-card-${convoId}`);
  if (card) card.classList.add('selected');

  try {
    const res = await fetch(`/api/admin/conversation/${convoId}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const convo = data.conversation;

    document.getElementById('viewerTitle').textContent = `${convo.userName || 'User'}: "${convo.title || 'Chat'}"`;
    document.getElementById('viewerDetails').textContent = `User IP: ${convo.userIp || '127.0.0.1'} • Started: ${new Date(convo.createdAt).toLocaleString()}`;
    document.getElementById('deleteConvoBtn').style.display = 'block';

    const viewerMessages = document.getElementById('viewerMessages');
    viewerMessages.innerHTML = '';

    (convo.messages || []).forEach(m => {
      const bubble = document.createElement('div');
      bubble.className = `admin-msg-bubble ${m.role}`;
      const roleName = m.role === 'user' ? (convo.userName || 'User') : `RETHINK AI (${m.model || 'Gemini 3.6'})`;
      const time = new Date(m.timestamp).toLocaleTimeString();

      bubble.innerHTML = `
        <div style="font-size:0.75rem; font-weight:700; color:${m.role === 'user' ? 'var(--primary-cyan)' : 'var(--accent-lime)'}; margin-bottom:4px;">
          ${roleName} • ${time}
        </div>
        <div>${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
      `;
      viewerMessages.appendChild(bubble);
    });

    viewerMessages.scrollTop = viewerMessages.scrollHeight;
  } catch (err) {
    console.error('Failed to inspect conversation:', err);
  }
}

async function deleteSelectedConvo() {
  if (!selectedConversationId) return;
  if (!confirm('Are you sure you want to permanently delete this conversation from database?')) return;

  try {
    await fetch(`/api/admin/conversation/${selectedConversationId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    selectedConversationId = null;
    document.getElementById('viewerTitle').textContent = 'Select a conversation to inspect';
    document.getElementById('viewerDetails').textContent = 'Every query sent by your friends is permanently recorded here.';
    document.getElementById('viewerMessages').innerHTML = '<div style="color:var(--text-secondary); text-align:center; margin:auto;">Session deleted.</div>';
    document.getElementById('deleteConvoBtn').style.display = 'none';

    loadAllConversations();
    loadOverviewStats();
  } catch (err) {
    console.error('Failed to delete:', err);
  }
}

// Settings management
async function loadAdminSettings() {
  try {
    const res = await fetch('/api/admin/settings', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const s = data.settings || {};

    document.getElementById('settingSystemPrompt').value = s.systemPrompt || '';
    document.getElementById('settingGeminiKey').value = s.geminiKey || '';
    document.getElementById('settingOpenAIKey').value = s.openaiKey || '';
    document.getElementById('settingOllamaEndpoint').value = s.ollamaEndpoint || '';
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const alertEl = document.getElementById('settingsAlert');
  alertEl.style.display = 'none';

  const payload = {
    systemPrompt: document.getElementById('settingSystemPrompt').value.trim(),
    geminiKey: document.getElementById('settingGeminiKey').value.trim(),
    openaiKey: document.getElementById('settingOpenAIKey').value.trim(),
    ollamaEndpoint: document.getElementById('settingOllamaEndpoint').value.trim()
  };

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      alertEl.textContent = '✓ Settings successfully updated!';
      alertEl.style.color = 'var(--accent-lime)';
      alertEl.style.display = 'block';
      setTimeout(() => { alertEl.style.display = 'none'; }, 3000);
    }
  } catch (err) {
    alertEl.textContent = 'Failed to update settings';
    alertEl.style.color = '#FF6666';
    alertEl.style.display = 'block';
  }
}

// Tab Switching
function switchTab(tabId) {
  document.querySelectorAll('.admin-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

  event.target.classList.add('active');
  const targetPane = document.getElementById(tabId);
  if (targetPane) targetPane.classList.add('active');
}

// Export Full Database
function exportFullDatabaseJSON() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allConversations, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `rethink_database_backup_${Date.now()}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function exportConversationsCSV() {
  let csv = "ID,User Name,User IP,Title,Created At,Message Count\n";
  allConversations.forEach(c => {
    const safeTitle = `"${(c.title || '').replace(/"/g, '""')}"`;
    const safeUser = `"${(c.userName || '').replace(/"/g, '""')}"`;
    csv += `${c.id},${safeUser},${c.userIp || '127.0.0.1'},${safeTitle},${c.createdAt},${(c.messages || []).length}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rethink_conversations_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
