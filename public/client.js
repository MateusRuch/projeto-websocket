"use strict";

const elements = {
  joinPanel: document.querySelector("#joinPanel"),
  joinForm: document.querySelector("#joinForm"),
  nameInput: document.querySelector("#nameInput"),
  joinError: document.querySelector("#joinError"),
  chatPanel: document.querySelector("#chatPanel"),
  currentName: document.querySelector("#currentName"),
  clientCount: document.querySelector("#clientCount"),
  messageList: document.querySelector("#messageList"),
  messageForm: document.querySelector("#messageForm"),
  messageInput: document.querySelector("#messageInput"),
  sendButton: document.querySelector("#sendButton"),
  status: document.querySelector("#status"),
  statusText: document.querySelector("#statusText"),
  banner: document.querySelector("#banner"),
  bannerText: document.querySelector("#bannerText"),
  reconnectButton: document.querySelector("#reconnectButton"),
};

const state = {
  socket: null,
  clientId: null,
  name: null,
  joined: false,
  reconnectAttempts: 0,
  reconnectTimer: null,
  allowReconnect: true,
};

const MAX_RECONNECT_ATTEMPTS = 5;
const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
});

elements.joinForm.addEventListener("submit", handleJoinSubmit);
elements.messageForm.addEventListener("submit", handleMessageSubmit);
elements.reconnectButton.addEventListener("click", handleReconnectClick);
window.addEventListener("beforeunload", handleBeforeUnload);

function handleJoinSubmit(event) {
  event.preventDefault();

  const name = sanitizeName(elements.nameInput.value);
  if (!name) {
    showJoinError("Informe um nome de 1 a 40 caracteres.");
    elements.nameInput.focus();
    return;
  }

  state.name = name;
  state.allowReconnect = true;
  state.reconnectAttempts = 0;
  elements.nameInput.value = name;
  elements.currentName.textContent = name;
  hideJoinError();
  hideBanner();

  if (state.socket && state.socket.readyState === WebSocket.OPEN && !state.joined) {
    sendJoin();
    return;
  }

  if (state.socket && state.socket.readyState === WebSocket.CONNECTING) {
    return;
  }

  connect();
}

function handleMessageSubmit(event) {
  event.preventDefault();

  if (!state.joined) {
    return;
  }

  const text = elements.messageInput.value.trim();
  if (!text) {
    return;
  }

  if (!send({ type: "chat", text })) {
    return;
  }

  elements.messageInput.value = "";
  elements.messageInput.focus();
}

function handleReconnectClick() {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  state.reconnectAttempts = 0;
  hideBanner();
  connect();
}

function handleBeforeUnload() {
  state.allowReconnect = false;

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.close(1000, "Página fechada");
  }
}

function connect() {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  if (
    state.socket &&
    (state.socket.readyState === WebSocket.OPEN ||
      state.socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  if (!state.name) {
    return;
  }

  setStatus("connecting", "Conectando...");
  hideJoinError();

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  state.socket = socket;

  socket.addEventListener("open", () => {
    if (state.socket !== socket) {
      return;
    }

    console.log("[WebSocket] conexão aberta");
    state.reconnectAttempts = 0;
    sendJoin();
  });

  socket.addEventListener("message", (event) => {
    if (state.socket !== socket) {
      return;
    }

    handleServerMessage(event);
  });

  socket.addEventListener("close", (event) => {
    if (state.socket !== socket) {
      return;
    }

    console.log(
      `[WebSocket] conexão encerrada (código ${event.code}${
        event.reason ? `, motivo: ${event.reason}` : ""
      })`,
    );

    state.joined = false;
    state.clientId = null;
    setComposerEnabled(false);

    if (state.name && state.allowReconnect) {
      scheduleReconnect(event.reason);
      return;
    }

    setStatus("offline", "Desconectado");
  });

  socket.addEventListener("error", () => {
    console.warn("[WebSocket] erro na conexão");
  });
}

function sendJoin() {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  setStatus("connecting", "Entrando...");
  send({ type: "join", name: state.name });
}

function send(payload) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  state.socket.send(JSON.stringify(payload));
  console.log("[WebSocket] mensagem enviada", payload);
  return true;
}

function handleServerMessage(event) {
  let message;

  try {
    message = JSON.parse(event.data);
  } catch {
    console.warn("[WebSocket] resposta inválida recebida", event.data);
    return;
  }

  console.log("[WebSocket] mensagem recebida", message);

  switch (message.type) {
    case "welcome":
      handleWelcome(message);
      break;
    case "chat":
      appendChat(message);
      break;
    case "system":
      appendSystem(message);
      updateClientCount(message.clientCount);
      break;
    case "clients":
      updateClientCount(message.count);
      break;
    case "error":
      handleServerError(message);
      break;
    default:
      console.warn("[WebSocket] tipo de mensagem desconhecido", message);
  }
}

function handleWelcome(message) {
  state.clientId = message.clientId;
  state.joined = true;
  state.reconnectAttempts = 0;

  if (typeof message.name === "string" && message.name) {
    state.name = message.name;
  }

  elements.currentName.textContent = state.name;
  elements.joinPanel.hidden = true;
  elements.chatPanel.hidden = false;
  elements.nameInput.value = state.name;

  clearMessages();

  if (Array.isArray(message.history)) {
    for (const item of message.history) {
      if (item && item.type === "chat") {
        appendChat(item);
      }
    }
  }

  updateClientCount(message.clientCount);
  setStatus("online", "Conectado");
  setComposerEnabled(true);
  hideBanner();
  hideJoinError();
  elements.messageInput.focus();

  console.log(`[WebSocket] conectado como ${state.name} (${message.clientId})`);
}

function handleServerError(message) {
  const text = message.message || "Erro desconhecido.";

  if (!state.joined) {
    showJoinError(text);
    setStatus("offline", "Não foi possível entrar");
    return;
  }

  appendSystem({
    event: "error",
    text: `Erro: ${text}`,
    timestamp: message.timestamp,
  });
}

function appendChat(message) {
  if (!message || typeof message.text !== "string") {
    return;
  }

  removeEmptyState();

  const item = document.createElement("li");
  item.className = "message";

  if (message.authorId && message.authorId === state.clientId) {
    item.classList.add("own");
  }

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const author = document.createElement("strong");
  author.textContent = message.author || "Anônimo";

  const time = document.createElement("time");
  time.dateTime = message.timestamp || "";
  time.textContent = formatTime(message.timestamp);

  if (message.timestamp) {
    const date = new Date(message.timestamp);
    if (!Number.isNaN(date.getTime())) {
      time.title = date.toLocaleString("pt-BR");
    }
  }

  const text = document.createElement("p");
  text.className = "message-text";
  text.textContent = message.text;

  meta.append(author, time);
  item.append(meta, text);
  appendToMessageList(item);
}

function appendSystem(message) {
  if (!message || typeof message.text !== "string") {
    return;
  }

  removeEmptyState();

  const item = document.createElement("li");
  item.className = "system-message";

  if (message.event === "shutdown" || message.event === "error") {
    item.classList.add("danger");
  }

  const time = formatTime(message.timestamp);
  item.textContent = time ? `${time} · ${message.text}` : message.text;
  appendToMessageList(item);
}

function appendToMessageList(item) {
  const list = elements.messageList;
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 100;

  list.append(item);

  if (nearBottom || item.classList.contains("own")) {
    list.scrollTop = list.scrollHeight;
  }
}

function clearMessages() {
  elements.messageList.replaceChildren();

  const empty = document.createElement("li");
  empty.className = "empty-state";
  empty.textContent = "Nenhuma mensagem ainda. Envie a primeira!";
  elements.messageList.append(empty);
}

function removeEmptyState() {
  const empty = elements.messageList.querySelector(".empty-state");
  if (empty) {
    empty.remove();
  }
}

function updateClientCount(count) {
  if (!Number.isInteger(count) || count < 0) {
    return;
  }

  elements.clientCount.textContent =
    count === 1 ? "1 pessoa online" : `${count} pessoas online`;
}

function setStatus(status, text) {
  elements.status.dataset.state = status;
  elements.statusText.textContent = text;
}

function setComposerEnabled(enabled) {
  elements.messageInput.disabled = !enabled;
  elements.sendButton.disabled = !enabled;
}

function showJoinError(message) {
  elements.joinError.textContent = message;
  elements.joinError.hidden = false;
}

function hideJoinError() {
  elements.joinError.textContent = "";
  elements.joinError.hidden = true;
}

function showBanner(message, showButton) {
  elements.bannerText.textContent = message;
  elements.reconnectButton.hidden = !showButton;
  elements.banner.hidden = false;
}

function hideBanner() {
  elements.banner.hidden = true;
  elements.bannerText.textContent = "";
  elements.reconnectButton.hidden = true;
}

function scheduleReconnect(reason) {
  if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    setStatus("offline", "Desconectado");
    showBanner(
      "Não foi possível reconectar. Verifique se o servidor está em execução.",
      true,
    );
    return;
  }

  state.reconnectAttempts += 1;

  const delay = Math.min(1000 * 2 ** (state.reconnectAttempts - 1), 8000);
  const seconds = Math.ceil(delay / 1000);
  const reasonText = reason ? ` (${reason})` : "";

  setStatus("connecting", `Reconectando em ${seconds}s...`);
  showBanner(
    `Conexão perdida${reasonText}. Tentativa ${state.reconnectAttempts} de ${MAX_RECONNECT_ATTEMPTS} em ${seconds}s.`,
    false,
  );

  state.reconnectTimer = window.setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, delay);
}

function sanitizeName(value) {
  const name = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC");

  return name.length >= 1 && name.length <= 40 ? name : null;
}

function formatTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return timeFormatter.format(date);
}
