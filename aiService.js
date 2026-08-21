const Store = require('./store');

// Primary Groq API caller
async function callGroq(messages, settings, modelOverride) {
  const model = modelOverride || settings.groqModel || 'openai/gpt-oss-120b';
  const apiKey = settings.groqKey;

  if (!apiKey) throw new Error('Groq API key not configured in settings');

  const systemInstruction = settings.systemPrompt || "You are RETHINK AI, created by RAVI TEJA. Be helpful, friendly, and smart.";

  const fullMessages = [
    { role: 'system', content: systemInstruction },
    ...messages.filter(m => m.role !== 'system')
  ];

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`Groq Error (${res.status}): ${errData.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const rawContent = data.choices?.[0]?.message?.content || '';

  return {
    content: rawContent,
    model: `Groq (${model})`,
    provider: 'groq',
    tokens: data.usage?.total_tokens || 0
  };
}

// Local Ollama caller (offline fallback)
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
    }),
    signal: AbortSignal.timeout(4000)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Ollama Error (${res.status}): ${errText || res.statusText}`);
  }

  const data = await res.json();
  if (!data.message?.content) {
    throw new Error('Ollama model returned empty response');
  }

  return {
    content: data.message.content,
    model: `Ollama (${model})`,
    provider: 'ollama',
    tokens: 0
  };
}

// Master Chat Completion Router (Groq-Powered)
async function generateChatCompletion(messages, requestedProvider = 'auto', requestedModel = null) {
  const settings = Store.getSettings();
  let provider = requestedProvider || settings.defaultProvider || 'auto';

  // Groq models to try in sequence for 100% reliability
  const groqCandidateModels = [
    requestedModel,
    settings.groqModel,
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'groq/compound',
    'qwen/qwen3.6-27b'
  ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

  let errors = [];

  // If specifically requested Ollama, try Ollama first
  if (provider === 'ollama') {
    try {
      return await callOllama(messages, settings, requestedModel);
    } catch (err) {
      console.warn('[AI Router] Ollama unavailable, falling back to Groq:', err.message);
      errors.push(`Ollama: ${err.message}`);
    }
  }

  // Primary: Execute via Groq with candidate model fallback
  if (settings.groqKey) {
    for (const modelCandidate of groqCandidateModels) {
      try {
        return await callGroq(messages, settings, modelCandidate);
      } catch (err) {
        console.warn(`[AI Router] Groq model ${modelCandidate} failed:`, err.message);
        errors.push(`Groq (${modelCandidate}): ${err.message}`);
      }
    }
  } else {
    errors.push('Groq: API key is not configured in settings');
  }

  // Secondary local fallback if Groq was unreachable
  if (provider !== 'ollama') {
    try {
      return await callOllama(messages, settings, requestedModel);
    } catch (err) {
      // Ollama silent catch
    }
  }

  // Diagnostic feedback if completely unreachable
  return {
    content: `⚠️ **Unable to reach Groq AI Service.**\n\n**Reason:**\n${errors.map(e => `• ${e}`).join('\n')}\n\n*Please ensure your Groq API key is valid in [Admin Settings](/admin.html).*`,
    model: 'Connection Diagnostics',
    provider: 'error',
    tokens: 0
  };
}

module.exports = {
  generateChatCompletion,
  callGroq,
  callOllama
};
