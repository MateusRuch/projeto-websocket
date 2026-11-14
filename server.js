"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { WebSocket, WebSocketServer } = require("ws");

const PORT = parsePort(process.env.PORT);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_NAME_LENGTH = 40;
const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY = 50;
const HEARTBEAT_INTERVAL_MS = 30_000;

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
  [".txt", "text/plain; charset=utf-8"],
]);

const clients = new Map();
const history = [];
let heartbeatInterval = null;
let shuttingDown = false;

const server = http.createServer((request, response) => {
  serveStatic(request, response).catch((error) => {
    console.error(`[${timestamp()}] [erro] falha ao servir ${request.url}:`, error);
    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    response.end("Erro interno do servidor.");
  });
});

const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 16 * 1024,
});

wss.on("error", (error) => {
  console.error(`[${timestamp()}] [erro] servidor WebSocket: ${error.message}`);
});

wss.on("connection", (socket, request) => {
  const client = {
    id: crypto.randomUUID(),
    name: null,
    socket,
    joinedAt: new Date(),
    alive: true,
    ip: request.socket.remoteAddress || "desconhecido",
  };

  clients.set(client.id, client);
  console.log(`[${timestamp()}] [conexão] aberta id=${shortId(client.id)} ip=${client.ip}`);

  socket.on("pong", () => {
    client.alive = true;
  });

  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      sendError(socket, "Apenas mensagens de texto são aceitas.", "BINARY_NOT_SUPPORTED");
      return;
    }

    let message;
    try {
      message = JSON.parse(data.toString("utf8"));
    } catch {
      sendError(socket, "Mensagem inválida: envie um objeto JSON.", "INVALID_JSON");
      return;
    }

    if (!message || typeof message !== "object" || Array.isArray(message)) {
      sendError(socket, "Mensagem inválida: envie um objeto JSON.", "INVALID_JSON");
      return;
    }

    if (message.type === "join") {
      handleJoin(client, message);
      return;
    }

    if (message.type === "chat") {
      handleChat(client, message);
      return;
    }

    sendError(socket, "Tipo de mensagem desconhecido.", "UNKNOWN_TYPE");
  });

  socket.on("close", (code, reasonBuffer) => {
    const wasJoined = Boolean(client.name);
    const reason = reasonBuffer.toString("utf8");

    clients.delete(client.id);
    console.log(
      `[${timestamp()}] [conexão] encerrada id=${shortId(client.id)} nome=${
        client.name ? JSON.stringify(client.name) : "-"
      } código=${code}${reason ? ` motivo=${JSON.stringify(reason)}` : ""}`,
    );

    if (wasJoined && !shuttingDown) {
      broadcastSystem("leave", `${client.name} saiu da sala.`);
      broadcastClients();
    }
  });

  socket.on("error", (error) => {
    console.error(`[${timestamp()}] [erro] cliente id=${shortId(client.id)}: ${error.message}`);
  });
});

function handleJoin(client, message) {
  if (client.name) {
    sendError(client.socket, "Você já está na sala.", "ALREADY_JOINED");
    return;
  }

  const name = sanitizeName(message.name);
  if (!name) {
    sendError(
      client.socket,
      `Informe um nome de 1 a ${MAX_NAME_LENGTH} caracteres.`,
      "INVALID_NAME",
    );
    return;
  }

  client.name = name;
  send(client.socket, {
    type: "welcome",
    clientId: client.id,
    name: client.name,
    clientCount: joinedClientCount(),
    history: history.slice(),
  });

  console.log(`[${timestamp()}] [entrada] id=${shortId(client.id)} nome=${JSON.stringify(client.name)}`);
  broadcastSystem("join", `${client.name} entrou na sala.`);
  broadcastClients();
}

function handleChat(client, message) {
  if (!client.name) {
    sendError(client.socket, "Entre na sala antes de enviar mensagens.", "NOT_JOINED");
    return;
  }

  if (typeof message.text !== "string") {
    sendError(client.socket, "O texto da mensagem é obrigatório.", "INVALID_TEXT");
    return;
  }

  const text = message.text.trim();
  if (!text) {
    sendError(client.socket, "A mensagem não pode estar vazia.", "EMPTY_MESSAGE");
    return;
  }

  if (text.length > MAX_MESSAGE_LENGTH) {
    sendError(
      client.socket,
      `A mensagem deve ter no máximo ${MAX_MESSAGE_LENGTH} caracteres.`,
      "MESSAGE_TOO_LONG",
    );
    return;
  }

  const payload = {
    type: "chat",
    id: crypto.randomUUID(),
    author: client.name,
    authorId: client.id,
    text,
    timestamp: new Date().toISOString(),
  };

  history.push(payload);
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  console.log(
    `[${timestamp()}] [mensagem] id=${shortId(client.id)} nome=${JSON.stringify(client.name)} texto=${JSON.stringify(text)}`,
  );
  broadcast(payload);
}

function sanitizeName(value) {
  if (typeof value !== "string") {
    return null;
  }

  const name = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC");

  if (!name || name.length > MAX_NAME_LENGTH) {
    return null;
  }

  return name;
}

function send(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  try {
    socket.send(JSON.stringify(payload));
  } catch (error) {
    console.error(`[${timestamp()}] [erro] falha ao enviar mensagem: ${error.message}`);
  }
}

function sendError(socket, message, code = "ERROR") {
  send(socket, {
    type: "error",
    code,
    message,
    timestamp: new Date().toISOString(),
  });
}

function broadcast(payload) {
  const serialized = JSON.stringify(payload);

  for (const client of clients.values()) {
    if (!client.name || client.socket.readyState !== WebSocket.OPEN) {
      continue;
    }

    try {
      client.socket.send(serialized);
    } catch (error) {
      console.error(
        `[${timestamp()}] [erro] falha no broadcast para id=${shortId(client.id)}: ${error.message}`,
      );
    }
  }
}

function broadcastSystem(event, text) {
  broadcast({
    type: "system",
    event,
    text,
    timestamp: new Date().toISOString(),
    clientCount: joinedClientCount(),
  });
}

function broadcastClients() {
  broadcast({
    type: "clients",
    count: joinedClientCount(),
  });
}

function joinedClientCount() {
  let count = 0;

  for (const client of clients.values()) {
    if (client.name) {
      count += 1;
    }
  }

  return count;
}

function startHeartbeat() {
  heartbeatInterval = setInterval(() => {
    for (const client of clients.values()) {
      if (!client.alive) {
        console.warn(
          `[${timestamp()}] [heartbeat] encerrando cliente inativo id=${shortId(client.id)}`,
        );
        client.socket.terminate();
        continue;
      }

      client.alive = false;

      try {
        client.socket.ping();
      } catch (error) {
        console.error(
          `[${timestamp()}] [heartbeat] falha no ping id=${shortId(client.id)}: ${error.message}`,
        );
        client.socket.terminate();
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

async function serveStatic(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, {
      Allow: "GET, HEAD",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Método não permitido.");
    return;
  }

  let pathname;
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Requisição inválida.");
    return;
  }

  if (pathname === "/") {
    pathname = "/index.html";
  }

  const filePath = path.resolve(PUBLIC_DIR, `.${pathname}`);
  const publicPrefix = `${PUBLIC_DIR}${path.sep}`;

  if (filePath !== PUBLIC_DIR && !filePath.startsWith(publicPrefix)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Acesso negado.");
    return;
  }

  let content;
  try {
    content = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Arquivo não encontrado.");
      return;
    }
    throw error;
  }

  const contentType =
    MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";

  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": content.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; base-uri 'none'",
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  response.end(content);
}

function getLanAddresses() {
  const addresses = [];

  for (const networkInterface of Object.values(os.networkInterfaces())) {
    for (const address of networkInterface || []) {
      if (address.family === "IPv4" && !address.internal) {
        addresses.push(address.address);
      }
    }
  }

  return addresses;
}

function parsePort(value) {
  if (value === undefined || value === "") {
    return 8080;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.warn(`[aviso] PORT inválida (${value}); usando 8080.`);
    return 8080;
  }

  return port;
}

function shortId(id) {
  return id.slice(0, 8);
}

function timestamp() {
  return new Date().toLocaleTimeString("pt-BR", { hour12: false });
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[${timestamp()}] [servidor] encerrando (${signal})...`);

  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  broadcastSystem("shutdown", "O servidor está sendo encerrado.");

  for (const client of clients.values()) {
    try {
      client.socket.close(1001, "Servidor encerrando");
    } catch {
      client.socket.terminate();
    }
  }

  wss.close();
  server.close(() => {
    console.log(`[${timestamp()}] [servidor] encerrado.`);
    process.exit(0);
  });

  setTimeout(() => {
    console.warn(`[${timestamp()}] [servidor] encerramento forçado.`);
    process.exit(1);
  }, 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.listen(PORT, HOST, () => {
  startHeartbeat();

  const localHost = HOST === "0.0.0.0" || HOST === "::" ? "localhost" : HOST;
  console.log(`[${timestamp()}] Chat WebSocket iniciado`);
  console.log(`  HTTP: http://${localHost}:${PORT}`);
  console.log(`  WS:   ws://${localHost}:${PORT}/ws`);

  if (HOST === "0.0.0.0" || HOST === "::") {
    for (const address of getLanAddresses()) {
      console.log(`  LAN:  http://${address}:${PORT}`);
    }
  }

  console.log("  Abra a URL em duas abas (ou em duas máquinas) para testar o broadcast.");
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `[${timestamp()}] [erro] a porta ${PORT} já está em uso. Use PORT=outra_porta npm start.`,
    );
  } else {
    console.error(`[${timestamp()}] [erro] falha no servidor HTTP:`, error);
  }

  process.exit(1);
});
