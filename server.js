const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const Store = require('./store');
const { generateChatCompletion } = require('./aiService');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'rethink_super_secret_jwt_ravi_teja_2026';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Helper to get client IP
function getClientIp(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
}

// Admin Authentication Middleware
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Admin access required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin' || decoded.email !== Store.getAdmin().email) {
      return res.status(403).json({ error: 'Forbidden: Invalid admin token' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired admin session. Please login again.' });
  }
}

// ========================
// PUBLIC CHAT API ENDPOINTS
// ========================

// Health & System Status
app.get('/api/status', async (req, res) => {
  const settings = Store.getSettings();
  let ollamaOnline = false;
  let ollamaModels = [];

  try {
    const oRes = await fetch(`${settings.ollamaEndpoint}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (oRes.ok) {
      const oData = await oRes.json();
      ollamaOnline = true;
      ollamaModels = (oData.models || []).map(m => m.name);
    }
  } catch (e) {
    ollamaOnline = false;
  }

  res.json({
    status: 'online',
    appName: 'RETHINK AI',
    version: '1.0.0',
    creator: 'RAVI TEJA',
    providers: {
      groq: { configured: !!settings.groqKey, defaultModel: settings.groqModel, active: true },
      ollama: { online: ollamaOnline, models: ollamaModels }
    }
  });
});

// Chat completion endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { conversationId, message, userName, userId, provider, model } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    const convoId = conversationId || 'convo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const userIp = getClientIp(req);
    const uName = userName || 'Guest Friend';
    const uId = userId || 'user_' + userIp.replace(/[^a-zA-Z0-9]/g, '_');

    // Fetch existing conversation history
    let convo = Store.getConversation(convoId);
    if (!convo) {
      convo = Store.createOrUpdateConversation({
        id: convoId,
        userId: uId,
        userName: uName,
        userIp: userIp,
        title: message.trim().slice(0, 45)
      });
    }

    // Record user message
    Store.addMessage(convoId, {
      role: 'user',
      content: message.trim()
    }, { userId: uId, userName: uName, userIp: userIp });

    // Prepare full history for context
    const currentConvo = Store.getConversation(convoId);
    const messagesHistory = currentConvo.messages.map(m => ({
      role: m.role,
      content: m.content
    }));

    // Call AI service
    const startTime = Date.now();
    const aiResult = await generateChatCompletion(messagesHistory, provider, model);
    const durationMs = Date.now() - startTime;

    // Record assistant response
    const savedAiMsg = Store.addMessage(convoId, {
      role: 'assistant',
      content: aiResult.content,
      model: aiResult.model,
      tokens: aiResult.tokens
    }, { userId: uId, userName: uName, userIp: userIp });

    res.json({
      conversationId: convoId,
      messageId: savedAiMsg.id,
      response: aiResult.content,
      model: aiResult.model,
      provider: aiResult.provider,
      tokens: aiResult.tokens,
      durationMs,
      note: aiResult.note || null
    });
  } catch (err) {
    console.error('Chat endpoint error:', err);
    res.status(500).json({
      error: 'An error occurred while generating response',
      details: err.message
    });
  }
});

// Fetch conversations for a specific user session
app.get('/api/conversations', (req, res) => {
  const { userId } = req.query;
  const list = Store.getConversations(userId || null);
  res.json({ conversations: list });
});

// Fetch single conversation messages
app.get('/api/conversation/:id', (req, res) => {
  const convo = Store.getConversation(req.params.id);
  if (!convo) return res.status(404).json({ error: 'Conversation not found' });
  res.json({ conversation: convo });
});

// Delete a conversation
app.delete('/api/conversation/:id', (req, res) => {
  const ok = Store.deleteConversation(req.params.id);
  res.json({ success: ok });
});

// ========================
// ADMIN API ENDPOINTS (Ravi Teja Only)
// ========================

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  const adminConfig = Store.getAdmin();

  if (email === adminConfig.email && password === adminConfig.password) {
    const token = jwt.sign(
      { email: adminConfig.email, role: 'admin', name: 'Ravi Teja' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.json({
      success: true,
      token,
      admin: {
        email: adminConfig.email,
        name: 'Ravi Teja',
        role: 'Super Admin'
      }
    });
  }

  res.status(401).json({ error: 'Invalid admin credentials. Access restricted to Ravi Teja.' });
});

// Admin Overview & Analytics
app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const stats = Store.getStats();
  const convos = Store.getConversations();
  
  res.json({
    stats,
    recentConversations: convos.slice(0, 10),
    systemTime: new Date().toISOString()
  });
});

// Admin Get All User Conversations with search
app.get('/api/admin/conversations', requireAdmin, (req, res) => {
  const { q, limit, offset } = req.query;
  let convos = Store.getConversations();

  if (q) {
    const qLower = q.toLowerCase();
    convos = convos.filter(c => 
      (c.title && c.title.toLowerCase().includes(qLower)) ||
      (c.userName && c.userName.toLowerCase().includes(qLower)) ||
      (c.userIp && c.userIp.includes(qLower)) ||
      (c.messages && c.messages.some(m => m.content.toLowerCase().includes(qLower)))
    );
  }

  res.json({
    total: convos.length,
    conversations: convos
  });
});

// Admin Get Specific Conversation Messages
app.get('/api/admin/conversation/:id', requireAdmin, (req, res) => {
  const convo = Store.getConversation(req.params.id);
  if (!convo) return res.status(404).json({ error: 'Conversation not found' });
  res.json({ conversation: convo });
});

// Admin Delete Conversation
app.delete('/api/admin/conversation/:id', requireAdmin, (req, res) => {
  const ok = Store.deleteConversation(req.params.id);
  res.json({ success: ok });
});

// Admin Get Settings
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const settings = Store.getSettings();
  res.json({ settings });
});

// Admin Update Settings
app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const updated = Store.updateSettings(req.body);
  res.json({ success: true, settings: updated });
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 RETHINK AI Server is live!`);
  console.log(`🌐 Web App:      http://localhost:${PORT}`);
  console.log(`👑 Admin Portal: http://localhost:${PORT}/admin.html`);
  console.log(`💎 Admin Email:  ravismile135@gmail.com`);
  console.log(`⚡ Creator:      RAVI TEJA`);
  console.log(`======================================================\n`);
});
