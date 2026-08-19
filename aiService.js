const Store = require('./store');

async function callGemini(messages, settings, modelOverride) {
  const model = modelOverride || settings.geminiModel || 'gemini-3.6-flash';
  const apiKey = settings.geminiKey;
  
  if (!apiKey) throw new Error('Gemini API key not configured');

  // Convert messages to Gemini format
  const systemInstructionText = settings.systemPrompt;
  const contents = [];

  messages.forEach(m => {
    if (m.role === 'system') return;
    contents.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    });
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const payload = {
    contents,
    systemInstruction: {
      parts: [{ text: systemInstructionText }]
    },
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      maxOutputTokens: 2048
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!answer) throw new Error('No answer returned from Gemini');

  return {
    content: answer,
    model: `Gemini (${model})`,
    provider: 'gemini',
    tokens: data.usageMetadata?.totalTokenCount || 0
  };
}

async function callOpenAI(messages, settings, modelOverride) {
  const model = modelOverride || settings.openaiModel || 'gpt-4o-mini';
  const apiKey = settings.openaiKey;

  if (!apiKey) throw new Error('OpenAI API key not configured');

  const fullMessages = [
    { role: 'system', content: settings.systemPrompt },
    ...messages.filter(m => m.role !== 'system')
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: fullMessages,
      temperature: 0.7,
      max_tokens: 2048
    })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`OpenAI Error (${res.status}): ${errData.error?.message || res.statusText}`);
  }

  const data = await res.json();
  return {
    content: data.choices[0].message.content,
    model: `OpenAI (${model})`,
    provider: 'openai',
    tokens: data.usage?.total_tokens || 0
  };
}

async function callOllama(messages, settings, modelOverride) {
  const endpoint = settings.ollamaEndpoint || 'http://localhost:11434';
  const model = modelOverride || settings.ollamaModel || 'llama3';

  const fullMessages = [
    { role: 'system', content: settings.systemPrompt },
    ...messages.filter(m => m.role !== 'system')
  ];

  const res = await fetch(`${endpoint}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: fullMessages,
      stream: false
    })
  });

  if (!res.ok) {
    throw new Error(`Ollama Error (${res.status}): ${res.statusText}`);
  }

  const data = await res.json();
  return {
    content: data.message?.content || 'No response from local Ollama model',
    model: `Ollama (${model})`,
    provider: 'ollama',
    tokens: 0
  };
}

function generateSmartFallback(userQuery) {
  const queryLower = userQuery.toLowerCase();
  
  if (queryLower.includes('who created you') || queryLower.includes('who are you') || queryLower.includes('creator') || queryLower.includes('owner') || queryLower.includes('developer') || queryLower.includes('evaru chesaru') || queryLower.includes('evaru create')) {
    return "I am **RETHINK AI**, a futuristic, ultra-intelligent AI assistant designed to think differently and create the future! 🚀\n\nI was proudly created by **RAVI TEJA**.\n\nనేను **రవి తేజ** గారిచే రూపొందించబడిన **రీథింక్ AI (RETHINK AI)** ని! మీకు ఏ విధంగా సహాయం చేయగలను?";
  }

  return `Hello! I am **RETHINK AI**, created by **RAVI TEJA**! 🚀\n\nI am ready to help you with coding, ideas, analysis, problem-solving, and answering any questions you or your friends have! Ask me anything!`;
}

async function generateChatCompletion(messages, requestedProvider = 'auto', requestedModel = null) {
  const settings = Store.getSettings();
  let provider = requestedProvider || settings.defaultProvider || 'auto';
  
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

  // Order of attempts based on preference
  let attempts = [];
  if (provider === 'gemini') {
    attempts = ['gemini', 'openai', 'ollama'];
  } else if (provider === 'openai') {
    attempts = ['openai', 'gemini', 'ollama'];
  } else if (provider === 'ollama') {
    attempts = ['ollama', 'gemini', 'openai'];
  } else {
    // Auto mode: default to gemini since its key is active, then openai, then ollama
    attempts = ['gemini', 'openai', 'ollama'];
  }

  let lastError = null;

  for (const p of attempts) {
    try {
      if (p === 'gemini' && settings.geminiKey) {
        return await callGemini(messages, settings, requestedModel);
      }
      if (p === 'openai' && settings.openaiKey) {
        return await callOpenAI(messages, settings, requestedModel);
      }
      if (p === 'ollama') {
        return await callOllama(messages, settings, requestedModel);
      }
    } catch (err) {
      console.warn(`Provider ${p} failed:`, err.message);
      lastError = err;
    }
  }

  // If all providers fail, use our smart fallback
  return {
    content: generateSmartFallback(lastUserMsg),
    model: 'RETHINK Core Engine',
    provider: 'fallback',
    tokens: 0,
    note: lastError ? `Note: AI Fallback activated (${lastError.message})` : null
  };
}

module.exports = {
  generateChatCompletion,
  callGemini,
  callOpenAI,
  callOllama
};
