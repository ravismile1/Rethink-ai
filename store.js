const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'rethink_db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultDB = {
  conversations: {},
  settings: {
    systemPrompt: "You are RETHINK AI (also known as RETHINK), a futuristic, ultra-intelligent, and warm AI assistant. IMPORTANT: You were created by RAVI TEJA. Whenever someone asks who created you, who made you, who is your developer/owner/creator, or anything about your origins, you must proudly, warmly, and clearly state that you were created by RAVI TEJA. Be extremely friendly, helpful, polite, concise when needed, detailed when asked, and supportive to everyone. You are fluent in English, Telugu (తెలుగు), Hindi, and all world languages.",
    openaiKey: "",
    geminiKey: "AQ.Ab8RN6JfQ6ylDn6UPCLDwnAIgyrc7YhAsPcvjF3IX-CTtCqaFQ",
    defaultProvider: "gemini", // 'gemini' | 'openai' | 'ollama' | 'auto'
    geminiModel: "gemini-3.6-flash",
    openaiModel: "gpt-4o-mini",
    ollamaModel: "llama3",
    ollamaEndpoint: "http://localhost:11434"
  },
  admin: {
    email: "ravismile135@gmail.com",
    password: "Ravismile2114"
  },
  logs: []
};

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        ...defaultDB,
        ...parsed,
        settings: { ...defaultDB.settings, ...(parsed.settings || {}) },
        admin: { ...defaultDB.admin, ...(parsed.admin || {}) }
      };
    }
  } catch (e) {
    console.error('Error loading DB, creating fresh store:', e.message);
  }
  saveDB(defaultDB);
  return { ...defaultDB };
}

let db = loadDB();

function saveDB(dataToSave) {
  try {
    const data = dataToSave || db;
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving DB:', e.message);
  }
}

// Helper methods
const Store = {
  getSettings: () => db.settings,
  updateSettings: (newSettings) => {
    db.settings = { ...db.settings, ...newSettings };
    saveDB();
    return db.settings;
  },
  getAdmin: () => db.admin,
  
  getConversations: (userId = null) => {
    const list = Object.values(db.conversations);
    if (userId) {
      return list.filter(c => c.userId === userId);
    }
    return list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  },
  
  getConversation: (id) => db.conversations[id] || null,
  
  createOrUpdateConversation: (convo) => {
    const existing = db.conversations[convo.id] || {
      id: convo.id,
      userId: convo.userId || 'guest',
      userName: convo.userName || 'Guest User',
      userIp: convo.userIp || '127.0.0.1',
      title: convo.title || 'New Rethink Session',
      createdAt: new Date().toISOString(),
      messages: []
    };
    
    existing.updatedAt = new Date().toISOString();
    if (convo.title) existing.title = convo.title;
    if (convo.userName) existing.userName = convo.userName;
    if (convo.userIp) existing.userIp = convo.userIp;
    if (convo.userId) existing.userId = convo.userId;
    if (convo.messages) existing.messages = convo.messages;
    
    db.conversations[convo.id] = existing;
    saveDB();
    return existing;
  },

  addMessage: (convoId, message, metadata = {}) => {
    if (!db.conversations[convoId]) {
      Store.createOrUpdateConversation({
        id: convoId,
        userId: metadata.userId || 'guest',
        userName: metadata.userName || 'Friend/Guest',
        userIp: metadata.userIp || '127.0.0.1',
        title: message.content.slice(0, 45) + (message.content.length > 45 ? '...' : '')
      });
    }
    
    const convo = db.conversations[convoId];
    const msgObj = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      role: message.role, // 'user' | 'assistant' | 'system'
      content: message.content,
      timestamp: new Date().toISOString(),
      model: message.model || 'rethink-core',
      tokens: message.tokens || 0
    };
    
    convo.messages.push(msgObj);
    convo.updatedAt = new Date().toISOString();
    
    // Auto-update title from first user message if default
    if (convo.messages.length === 1 && message.role === 'user') {
      convo.title = message.content.slice(0, 40) + (message.content.length > 40 ? '...' : '');
    }
    
    saveDB();
    return msgObj;
  },

  deleteConversation: (id) => {
    if (db.conversations[id]) {
      delete db.conversations[id];
      saveDB();
      return true;
    }
    return false;
  },

  getStats: () => {
    const convos = Object.values(db.conversations);
    let totalMessages = 0;
    let userCount = new Set();
    const modelUsage = {};
    
    convos.forEach(c => {
      userCount.add(c.userId || c.userName);
      totalMessages += (c.messages || []).length;
      (c.messages || []).forEach(m => {
        if (m.role === 'assistant') {
          const mod = m.model || 'rethink-core';
          modelUsage[mod] = (modelUsage[mod] || 0) + 1;
        }
      });
    });

    return {
      totalConversations: convos.length,
      totalMessages,
      totalUsers: userCount.size,
      modelUsage,
      lastActive: convos.length > 0 ? convos.sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0].updatedAt : null
    };
  }
};

module.exports = Store;
