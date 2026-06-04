const DEFAULT_SYSTEM_PROMPT = `You are a concise, helpful chatbot.
Keep responses short unless the user asks for detail.
Use the recent conversation context when relevant.`;

function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function preview(text, maxLength = 220) {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

async function callOpenAICompatible({
  apiKey,
  baseUrl = 'https://api.openai.com',
  model,
  messages,
  temperature = 0.3
}) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message ?? `Provider request failed with status ${response.status}`;
    throw new Error(message);
  }

  const content = data?.choices?.[0]?.message?.content ?? '';
  return {
    text: content,
    raw: data,
    usage: {
      promptTokens: data?.usage?.prompt_tokens ?? null,
      completionTokens: data?.usage?.completion_tokens ?? null,
      totalTokens: data?.usage?.total_tokens ?? null
    }
  };
}

async function callMockModel({ messages }) {
  const userMessages = messages.filter((message) => message.role === 'user');
  const lastUserMessage = userMessages[userMessages.length - 1]?.content ?? '';
  const responseText = [
    `Mock response based on ${userMessages.length} user message(s).`,
    lastUserMessage ? `Latest input: ${preview(lastUserMessage, 140)}` : 'No user input found.',
    'Set OPENAI_API_KEY to enable a real provider.'
  ].join(' ');

  return {
    text: responseText,
    raw: { provider: 'mock' },
    usage: {
      promptTokens: messages.reduce((sum, message) => sum + estimateTokens(message.content), 0),
      completionTokens: estimateTokens(responseText),
      totalTokens: null
    }
  };
}

export function buildChatMessages({ userMessage, history = [], systemPrompt = DEFAULT_SYSTEM_PROMPT }) {
  return [
    { role: 'system', content: systemPrompt },
    ...history.map(({ role, content }) => ({ role, content })),
    { role: 'user', content: userMessage }
  ];
}

export function createProviderClient({
  provider = 'openai',
  model,
  apiKey = process.env.OPENAI_API_KEY ?? '',
  baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com'
}) {
  return {
    provider,
    model,
    async generate(messages) {
      if (provider === 'mock') {
        return callMockModel({ messages });
      }

      if (!apiKey) {
        throw new Error('Missing OPENAI_API_KEY. Use provider=mock for offline testing.');
      }

      return callOpenAICompatible({ apiKey, baseUrl, model, messages });
    }
  };
}

export { DEFAULT_SYSTEM_PROMPT, estimateTokens, preview };
