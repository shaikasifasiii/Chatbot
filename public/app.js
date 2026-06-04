const $ = (selector) => document.querySelector(selector);

const state = {
  conversationId: localStorage.getItem('conversationId') || crypto.randomUUID(),
  provider: localStorage.getItem('provider') || 'openai',
  model: localStorage.getItem('model') || 'gpt-4.1-mini',
  messages: []
};

const messagesEl = $('#messages');
const formEl = $('#composer');
const promptEl = $('#prompt');
const statusEl = $('#status');
const providerEl = $('#provider');
const modelEl = $('#model');
const newChatEl = $('#new-chat');

providerEl.value = state.provider;
modelEl.value = state.model;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? 'var(--error)' : '';
}

function renderMessage(message) {
  const el = document.createElement('div');
  el.className = `message ${message.role}`;
  el.textContent = message.content;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderAllMessages() {
  messagesEl.innerHTML = '';
  for (const message of state.messages) {
    renderMessage(message);
  }
}

function persistSettings() {
  localStorage.setItem('conversationId', state.conversationId);
  localStorage.setItem('provider', state.provider);
  localStorage.setItem('model', state.model);
}

async function loadConversation() {
  state.messages = [];
  renderAllMessages();
  setStatus('Loading conversation history...');

  try {
    const response = await fetch(`/api/conversations/${state.conversationId}`);
    if (response.ok) {
      const data = await response.json();
      state.messages = data.messages ?? [];
      renderAllMessages();
      setStatus(`Conversation ${state.conversationId.slice(0, 8)} ready.`);
      return;
    }

    const errorBody = await response.json().catch(() => ({}));
    if (response.status !== 404) {
      const details = [errorBody.error, errorBody.hint].filter(Boolean).join(' - ');
      throw new Error(
        details ? `Failed to load conversation (${response.status}): ${details}` : `Failed to load conversation (${response.status})`
      );
    }

    setStatus('New conversation ready.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

providerEl.addEventListener('change', () => {
  state.provider = providerEl.value;
  persistSettings();
});

modelEl.addEventListener('change', () => {
  state.model = modelEl.value.trim() || 'gpt-4.1-mini';
  persistSettings();
});

newChatEl.addEventListener('click', async () => {
  state.conversationId = crypto.randomUUID();
  state.messages = [];
  persistSettings();
  renderAllMessages();
  await loadConversation();
});

formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = promptEl.value.trim();
  if (!message) return;

  const userMessage = { role: 'user', content: message };
  state.messages.push(userMessage);
  renderMessage(userMessage);
  promptEl.value = '';
  setStatus('Waiting for model response...');

  const responseBubble = { role: 'assistant', content: 'Thinking...' };
  state.messages.push(responseBubble);
  renderMessage(responseBubble);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        conversationId: state.conversationId,
        provider: state.provider,
        model: state.model,
        message
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error ?? `Request failed (${response.status})`);
    }

    state.conversationId = data.conversationId;
    persistSettings();
    responseBubble.content = data.assistantMessage.content;
    setStatus(`Logged inference ${data.requestId}.`);
  } catch (error) {
    responseBubble.content = `Error: ${error.message}`;
    responseBubble.role = 'error';
    setStatus(error.message, true);
  } finally {
    renderAllMessages();
  }
});

await loadConversation();
