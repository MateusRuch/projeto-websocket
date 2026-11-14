# Entendendo o código

Este documento explica como o chat em tempo real foi construído, quais decisões foram tomadas e como cada parte do código participa do fluxo de uma mensagem. As referências de linha correspondem à versão atual dos arquivos.

## 1. Visão geral

A aplicação tem dois processos de comunicação usando a mesma porta:

```text
Navegador A ─── HTTP GET / ───────────────► server.js ───► public/index.html
Navegador A ─── WebSocket /ws ────────────► server.js
Navegador B ─── WebSocket /ws ────────────► server.js
server.js   ─── broadcast JSON ───────────► Navegadores A e B
```

- O Node.js entrega os arquivos estáticos e mantém o servidor WebSocket.
- O navegador usa a API nativa `WebSocket`, sem bibliotecas de cliente.
- Todas as mensagens trafegam em JSON.
- O servidor mantém em memória a lista de clientes e as últimas 50 mensagens.

O ponto central é o broadcast: quando um cliente envia uma mensagem, o servidor não responde apenas a ele; percorre todos os clientes ativos e envia a mesma mensagem para todos.

## 2. Mapa dos arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `server.js` | Servidor HTTP, servidor WebSocket, estado dos clientes, histórico, validação, logs e broadcast |
| `public/index.html` | Estrutura da tela de entrada e da tela de chat |
| `public/styles.css` | Layout, estados visuais, responsividade e animações |
| `public/client.js` | Conexão WebSocket, envio, recebimento, renderização, reconexão e estado local |
| `package.json` | Scripts e dependência `ws` |
| `README.md` | Execução, requisitos, decisões e respostas da atividade |
| `docs/EVIDENCIAS.md` | Roteiro dos prints e do PDF de entrega |

## 3. Ciclo de vida de uma conexão

### 3.1 Abertura

1. A página carrega `public/client.js` com `defer` (`public/index.html:80`).
2. O usuário digita o nome e envia o formulário.
3. `handleJoinSubmit` (`public/client.js:43`) valida o nome e chama `connect` (`public/client.js:117`).
4. `connect` cria um `WebSocket` para `ws://<host>/ws` (`public/client.js:138`).
5. No servidor, `wss.on("connection")` (`server.js:58`) cria um objeto de cliente com UUID e o guarda no `Map` (`server.js:59`).
6. O servidor registra a abertura no console (`server.js:69`).
7. Quando o evento `open` chega ao navegador, `sendJoin` (`public/client.js:188`) envia `{"type":"join","name":"..."}`.

### 3.2 Entrada na sala

1. O servidor recebe a mensagem no listener `socket.on("message")` (`server.js:75`).
2. O JSON é decodificado e o tipo `join` é encaminhado para `handleJoin` (`server.js:129`).
3. O nome é validado por `sanitizeName` (`server.js:205`).
4. O servidor envia `welcome` somente para o novo cliente (`server.js:146`), contendo:
   - `clientId`;
   - `name`;
   - `clientCount`;
   - `history` com as últimas 50 mensagens.
5. Em seguida, faz broadcast do aviso de entrada (`server.js:155`) e do contador atualizado (`server.js:156`).
6. No cliente, `handleWelcome` (`public/client.js:241`) guarda o `clientId`, mostra o painel de chat e renderiza o histórico.

### 3.3 Envio de uma mensagem

1. O formulário de mensagem chama `handleMessageSubmit` (`public/client.js:73`).
2. O texto é validado e enviado por `send` (`public/client.js:197`).
3. O servidor recebe, identifica o tipo `chat` e chama `handleChat` (`server.js:159`).
4. `handleChat` verifica se o cliente entrou, valida o texto, cria o payload e registra a mensagem no histórico (`server.js:185`).
5. O servidor imprime no console quem enviou e o texto (`server.js:199`).
6. `broadcast` (`server.js:244`) percorre todos os clientes com nome e envia o mesmo JSON.
7. Cada navegador recebe a mensagem em `handleServerMessage` (`public/client.js:207`) e chama `appendChat` (`public/client.js:291`).

### 3.4 Saída

1. Quando a aba fecha ou a conexão cai, o servidor recebe `close` (`server.js:107`).
2. O cliente é removido do `Map` (`server.js:111`).
3. O encerramento é registrado no console com ID, nome, código e motivo (`server.js:112`).
4. Se o cliente já tinha entrado, o servidor avisa os demais (`server.js:118`) e atualiza o contador.

## 4. Servidor em detalhe

### 4.1 Constantes e estado global

Em `server.js:10` ficam as configurações:

| Constante | Valor | Uso |
| --- | --- | --- |
| `PORT` | `8080` | Porta HTTP e WebSocket |
| `HOST` | `0.0.0.0` | Interface de escuta |
| `MAX_NAME_LENGTH` | `40` | Limite do nome |
| `MAX_MESSAGE_LENGTH` | `500` | Limite do texto |
| `MAX_HISTORY` | `50` | Mensagens mantidas em memória |
| `HEARTBEAT_INTERVAL_MS` | `30000` | Intervalo do ping/pong |

O estado principal também é global ao processo:

```js
const clients = new Map(); // id -> objeto do cliente
const history = [];        // últimas mensagens de chat
```

`clients` é a fonte da verdade para saber quem está conectado. `history` é separado porque representa conteúdo, não conexões.

### 4.2 Servidor HTTP estático

`serveStatic` (`server.js:316`) faz o seguinte:

1. Aceita apenas `GET` e `HEAD`.
2. Decodifica a URL e rejeita URLs inválidas.
3. Converte `/` em `/index.html`.
4. Resolve o caminho dentro de `public` e verifica se ele não escapou do diretório.
5. Lê o arquivo e devolve o MIME type correspondente.
6. Retorna `404` para arquivos inexistentes.
7. Adiciona cabeçalhos de segurança, incluindo `Content-Security-Policy` e `X-Content-Type-Options`.

A checagem de caminho é importante: sem ela, uma URL com `..` poderia tentar ler arquivos fora de `public/`.

### 4.3 Servidor WebSocket

O `WebSocketServer` (`server.js:48`) é criado em cima do mesmo servidor HTTP:

```js
const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 16 * 1024,
});
```

Isso significa que a página e o WebSocket compartilham a mesma porta e a mesma origem. A aplicação não precisa de CORS nem de uma segunda porta liberada no firewall.

O `maxPayload` limita quadros a 16 KB. Os limites de nome e texto são validados separadamente.

### 4.4 O objeto de cliente

Cada conexão cria um objeto (`server.js:59`):

```js
{
  id: crypto.randomUUID(),
  name: null,
  socket,
  joinedAt: new Date(),
  alive: true,
  ip: "..."
}
```

- `id` identifica a conexão de forma única, independentemente do nome.
- `name` começa nulo e só é preenchido no `join`.
- `socket` é a conexão `ws` usada para enviar mensagens.
- `joinedAt` registra o horário de entrada.
- `alive` é usado pelo heartbeat.
- `ip` aparece nos logs de abertura.

O `Map` usa o UUID como chave. A remoção no `close` é direta, sem percorrer uma lista.

### 4.5 Validação das mensagens

O listener de mensagens (`server.js:75`) aceita apenas texto. Ele rejeita:

- mensagens binárias;
- JSON inválido;
- valores que não sejam objetos;
- tipos desconhecidos;
- `chat` antes do `join`;
- texto vazio ou maior que 500 caracteres;
- nomes vazios ou maiores que 40 caracteres.

`sendError` (`server.js:235`) devolve um JSON com `type: "error"`, um código e uma mensagem legível. O cliente usa isso para mostrar o erro sem derrubar a conexão.

### 4.6 Entrada e nomes

`sanitizeName` (`server.js:205`) remove caracteres de controle, colapsa espaços, remove espaços nas pontas e aplica normalização Unicode NFC. O mesmo nome pode ser usado por duas conexões: a identidade real é o UUID, e o nome serve para exibição.

Essa escolha separa identificação técnica de identificação visual. Se o nome fosse a chave do `Map`, duas pessoas com o mesmo nome colidiriam. Se o UUID fosse exibido sozinho, o chat ficaria ilegível.

### 4.7 Histórico

As mensagens de chat são objetos completos:

```json
{
  "type": "chat",
  "id": "uuid-da-mensagem",
  "author": "Ana",
  "authorId": "uuid-da-conexao",
  "text": "Olá!",
  "timestamp": "2026-11-14T20:00:00.000Z"
}
```

`handleChat` adiciona o objeto em `history` e remove os mais antigos quando o array passa de 50 (`server.js:194`). O `welcome` envia uma cópia do array (`history.slice()`) para o novo cliente.

O histórico não é persistido. Reiniciar o servidor zera o array. Para persistência, seria necessário gravar em arquivo ou banco de dados.

### 4.8 Broadcast

`broadcast` (`server.js:244`) serializa o payload uma única vez e percorre o `Map`:

```js
for (const client of clients.values()) {
  if (!client.name || client.socket.readyState !== WebSocket.OPEN) {
    continue;
  }
  client.socket.send(serialized);
}
```

Dois detalhes importantes:

- Clientes que abriram a conexão mas ainda não enviaram `join` não recebem broadcast.
- Apenas conexões `OPEN` recebem mensagens; conexões em fechamento são ignoradas.

O `try/catch` evita que uma conexão problemática interrompa o envio para as demais.

### 4.9 Heartbeat e conexões mortas

`startHeartbeat` (`server.js:291`) roda a cada 30 segundos:

1. Se `alive` for `false`, a conexão não respondeu ao ping anterior e é encerrada com `terminate()`.
2. Caso contrário, `alive` vira `false` e o servidor envia um `ping`.
3. Quando o cliente responde com `pong`, o listener em `server.js:71` marca `alive = true`.

Esse mecanismo detecta quedas de rede e abas fechadas abruptamente que, em alguns casos, não geram um `close` imediato.

### 4.10 Encerramento gracioso

`shutdown` (`server.js:418`) é acionado por `SIGINT` (`Ctrl+C`) ou `SIGTERM`:

1. Marca `shuttingDown = true` para evitar broadcasts de saída duplicados.
2. Para o heartbeat.
3. Avisa os clientes de que o servidor está encerrando.
4. Fecha cada socket com código `1001`.
5. Fecha o servidor WebSocket e o HTTP.
6. Se algo travar, força a saída após 3 segundos.

### 4.11 Logs obrigatórios

O servidor imprime três eventos principais:

```text
[17:00:00] [conexão] aberta id=8d70df12 ip=127.0.0.1
[17:00:05] [mensagem] id=8d70df12 nome="Ana" texto="Olá!"
[17:00:10] [conexão] encerrada id=8d70df12 nome="Ana" código=1000
```

Eles atendem diretamente ao requisito de registrar abertura, recebimento e encerramento. O ID é encurtado para os primeiros 8 caracteres apenas na exibição; o UUID completo continua no estado e nos payloads.

## 5. Cliente em detalhe

### 5.1 Estado local

O objeto `state` (`public/client.js:22`) guarda:

| Campo | Significado |
| --- | --- |
| `socket` | Conexão WebSocket atual |
| `clientId` | UUID recebido no `welcome` |
| `name` | Nome escolhido pelo usuário |
| `joined` | Indica se o `welcome` já chegou |
| `reconnectAttempts` | Tentativas de reconexão já feitas |
| `reconnectTimer` | Timer pendente de reconexão |
| `allowReconnect` | Impede reconexão ao fechar a página |

O estado é pequeno de propósito: toda a verdade sobre conexões e histórico fica no servidor.

### 5.2 Conexão e proteção contra sockets antigos

`connect` (`public/client.js:117`) cria a URL com base na origem atual:

```js
const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
```

Os listeners verificam `state.socket !== socket` antes de agir (`public/client.js:143`, `152`, `160`). Isso evita que eventos de um socket antigo, já substituído, alterem o estado do socket novo durante uma reconexão.

### 5.3 Entrada e envio

`handleJoinSubmit` (`public/client.js:43`) valida o nome, guarda em `state.name` e decide entre:

- enviar o `join` em um socket já aberto que ainda não entrou;
- aguardar a conexão em andamento;
- abrir uma nova conexão.

`handleMessageSubmit` (`public/client.js:73`) impede envio quando `joined` é falso, remove espaços nas pontas e limpa o campo após o envio.

O campo e o botão ficam desabilitados enquanto a conexão não está pronta (`setComposerEnabled`, `public/client.js:391`).

### 5.4 Recebimento e roteamento

`handleServerMessage` (`public/client.js:207`) converte o JSON e usa um `switch`:

| Tipo | Ação |
| --- | --- |
| `welcome` | Configura a tela, o ID e renderiza o histórico |
| `chat` | Adiciona uma mensagem à lista |
| `system` | Adiciona um aviso e atualiza o contador |
| `clients` | Atualiza o contador |
| `error` | Mostra o erro na tela de entrada ou como aviso |

Se o JSON for inválido, o cliente apenas registra um aviso no console e ignora o pacote.

### 5.5 Renderização segura

`appendChat` (`public/client.js:291`) cria os elementos com `document.createElement` e usa `textContent` para autor e texto. Não há `innerHTML` com dados do servidor, então uma mensagem contendo HTML é exibida como texto e não é executada. Isso evita XSS.

A mensagem própria recebe a classe `own` quando `authorId === state.clientId` (`public/client.js:301`). O CSS então alinha e colore a bolha de forma diferente.

O horário é formatado com `Intl.DateTimeFormat` em `formatTime` (`public/client.js:456`), e o timestamp completo fica no atributo `title`.

### 5.6 Rolagem e estados vazios

`appendToMessageList` (`public/client.js:350`) verifica se o usuário está perto do fim da lista antes de rolar. Assim, mensagens novas não interrompem alguém que está lendo o histórico. Mensagens próprias sempre levam a lista para o fim.

`clearMessages` (`public/client.js:361`) insere um item de estado vazio. Ele é removido quando chega a primeira mensagem ou aviso.

### 5.7 Reconexão

Quando o socket fecha e existe um nome salvo, `scheduleReconnect` (`public/client.js:418`) calcula uma espera exponencial:

```text
tentativa 1 -> 1s
tentativa 2 -> 2s
tentativa 3 -> 4s
tentativa 4 -> 8s
tentativa 5 -> 8s
```

Depois de cinco tentativas, o banner mostra o botão "Reconectar". O botão zera o contador e tenta novamente. Ao abrir a conexão, o cliente reenvia o `join` e o servidor devolve um novo `welcome` com o histórico atualizado.

`beforeunload` (`public/client.js:104`) desativa a reconexão e fecha o socket com código `1000` quando a página é abandonada.

## 6. Protocolo JSON

### 6.1 Cliente para servidor

```json
{"type":"join","name":"Ana"}
{"type":"chat","text":"Olá, pessoal!"}
```

### 6.2 Servidor para cliente

**welcome**

```json
{
  "type": "welcome",
  "clientId": "uuid",
  "name": "Ana",
  "clientCount": 1,
  "history": []
}
```

**chat**

```json
{
  "type": "chat",
  "id": "uuid-da-mensagem",
  "author": "Ana",
  "authorId": "uuid-da-conexao",
  "text": "Olá, pessoal!",
  "timestamp": "2026-11-14T20:00:00.000Z"
}
```

**system**

```json
{
  "type": "system",
  "event": "join",
  "text": "Ana entrou na sala.",
  "timestamp": "2026-11-14T20:00:00.000Z",
  "clientCount": 1
}
```

**clients**

```json
{"type":"clients","count":2}
```

**error**

```json
{
  "type": "error",
  "code": "INVALID_JSON",
  "message": "Mensagem inválida: envie um objeto JSON.",
  "timestamp": "2026-11-14T20:00:00.000Z"
}
```

### 6.3 Sequência de uma mensagem

```text
Ana                         Servidor                         Bruno
 |                              |                               |
 |-- join --------------------> |                               |
 |<-- welcome ---------------- |                               |
 |                              |-- system (Ana entrou) ------> |
 |<-- system (Ana entrou) ----- |                               |
 |                              |-- clients (2) --------------> |
 |<-- clients (2) ------------- |                               |
 |                              |                               |
 |-- chat "Olá!" -------------> |                               |
 |                              |-- chat "Olá!" --------------> |
 |<-- chat "Olá!" ------------- |                               |
```

## 7. Decisões de projeto e justificativas

| Decisão | Motivo | Limitação |
| --- | --- | --- |
| `ws` em vez de Socket.IO | Mantém o protocolo WebSocket explícito, conforme o requisito da atividade | Exige tratamento manual de reconexão, heartbeat e protocolo |
| UUID como chave | Evita colisões e separa identidade técnica do nome exibido | O UUID não é amigável para leitura; por isso os logs mostram apenas 8 caracteres |
| `Map` em memória | Busca, inserção e remoção simples; adequado para uma instância | Não funciona para múltiplas instâncias sem armazenamento compartilhado |
| JSON | Estrutura tipos, autor, timestamp e histórico no mesmo formato | Payload maior que texto simples e necessidade de validação |
| Broadcast no servidor | O servidor conhece todos os clientes e centraliza a distribuição | Cada mensagem é enviada N vezes; para escalar seria necessário pub/sub |
| Histórico em memória | Simples e suficiente para a demonstração | É perdido ao reiniciar; não há paginação nem persistência |
| Mesma porta e origem | Evita CORS e reduz bloqueios de rede | Em produção, o ideal é `wss://` com proxy reverso |
| `textContent` no cliente | Impede execução de HTML vindo de outros usuários | Não há formatação rica nas mensagens |

## 8. Como executar e observar o fluxo

```bash
npm install
npm start
```

1. Abra `http://localhost:8080`.
2. Entre como `Ana` em uma aba e como `Bruno` em uma janela anônima.
3. Observe no terminal:

```text
[conexão] aberta ...
[entrada] ... nome="Ana"
[conexão] aberta ...
[entrada] ... nome="Bruno"
```

4. Envie uma mensagem da Ana. O terminal mostra `[mensagem]` e as duas abas exibem a mensagem.
5. Feche a aba do Bruno. O terminal mostra `[conexão] encerrada` e a aba da Ana recebe o aviso de saída.
6. Abra uma terceira aba e entre com outro nome. O `welcome` entrega o histórico recente.

## 9. Limitações e próximos passos

- Não há autenticação; qualquer pessoa com acesso à URL pode entrar.
- Não há salas, mensagens privadas, edição ou exclusão de mensagens.
- O histórico é perdido ao reiniciar o servidor.
- O servidor é de instância única; múltiplas instâncias exigiriam um mecanismo de pub/sub.
- Não há limite de tentativas de entrada nem rate limiting de mensagens.
- Em produção, seria necessário HTTPS/WSS, proxy reverso, persistência e moderação.

## 10. Referência rápida

| Local | Responsabilidade |
| --- | --- |
| `server.js:38` | Criação do servidor HTTP |
| `server.js:48` | Criação do servidor WebSocket |
| `server.js:58` | Abertura de conexão e criação do cliente |
| `server.js:75` | Recebimento e roteamento de mensagens |
| `server.js:107` | Encerramento de conexão e limpeza |
| `server.js:129` | Entrada na sala |
| `server.js:159` | Processamento de mensagens de chat |
| `server.js:205` | Sanitização do nome |
| `server.js:244` | Broadcast |
| `server.js:291` | Heartbeat |
| `server.js:316` | Servidor de arquivos estáticos |
| `server.js:418` | Encerramento gracioso |
| `server.js:456` | Inicialização do servidor |
| `public/client.js:22` | Estado local do cliente |
| `public/client.js:43` | Tratamento do formulário de entrada |
| `public/client.js:73` | Tratamento do formulário de mensagem |
| `public/client.js:117` | Criação e eventos do WebSocket |
| `public/client.js:207` | Roteamento das mensagens do servidor |
| `public/client.js:241` | Configuração após o `welcome` |
| `public/client.js:291` | Renderização de mensagens de chat |
| `public/client.js:331` | Renderização de avisos de sistema |
| `public/client.js:418` | Reconexão com espera exponencial |
| `public/client.js:446` | Sanitização do nome no navegador |
