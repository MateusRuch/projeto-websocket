# Chat em Tempo Real com WebSocket

Chat público que demonstra comunicação bidirecional em tempo real. O servidor usa Node.js e a biblioteca `ws`; o navegador usa a API nativa `WebSocket`. Não há Socket.IO, polling, CDN ou dependência de serviços externos.

## Como executar

```bash
npm install
npm start
```

Para reinstalar as versões exatas registradas no `package-lock.json`, use `npm ci`.

Abra `http://localhost:8080` em duas abas (ou em uma aba normal e outra anônima). Para testar em duas máquinas, use o endereço de rede exibido no terminal e libere a porta no firewall.

Para encerrar o servidor, pressione `Ctrl+C`.

### Configuração opcional

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `8080` | Porta do HTTP e do WebSocket |
| `HOST` | `0.0.0.0` | Interface de escuta; use `127.0.0.1` para aceitar apenas conexões locais |

```bash
PORT=3000 npm start
HOST=127.0.0.1 npm start
```

## Requisitos atendidos

| Requisito | Implementação |
| --- | --- |
| Protocolo WebSocket (`ws://`) | Servidor `ws` e cliente `WebSocket` nativo em `ws://<host>/ws`; sem bibliotecas que escondem o protocolo |
| Dois clientes simultâneos | A aplicação aceita vários clientes e exibe o contador de pessoas online |
| Cliente para servidor | Mensagens `join` e `chat` em JSON |
| Servidor para todos (broadcast) | Mensagens de chat, entrada/saída e encerramento são enviadas a todos os clientes da sala |
| Exibição visual | Lista de mensagens com autor, horário e destaque para mensagens próprias |
| Logs no console do servidor | Abertura de conexão, mensagem recebida e encerramento de conexão |

## Estrutura

```text
.
├── server.js
├── package.json
├── public/
│   ├── index.html
│   ├── styles.css
│   └── client.js
├── docs/
│   ├── EVIDENCIAS.md
│   └── EXPLICACAO-CODIGO.md
└── README.md
```

O servidor HTTP entrega a interface e o servidor WebSocket usa a mesma porta e a mesma origem. Assim, não é necessário configurar CORS nem abrir uma segunda porta.

## Como funciona

1. O cliente abre a página e informa um nome.
2. O navegador conecta em `ws://<host>/ws` e envia `{"type":"join","name":"Ana"}`.
3. O servidor registra a conexão, envia o histórico recente e faz broadcast do aviso de entrada.
4. Ao enviar `{"type":"chat","text":"Olá"}`, o servidor registra a mensagem no console e a repassa a todos os clientes conectados.
5. Ao fechar a aba, o servidor remove o cliente, registra o encerramento e avisa os demais.

## Decisões técnicas

- **Identificação:** cada conexão recebe um UUID gerado pelo servidor com `crypto.randomUUID()`. O nome escolhido no `join` é usado para exibição, enquanto o UUID identifica a conexão em logs, remoção e destaque das mensagens próprias.
- **Armazenamento:** as conexões ativas ficam em um `Map` em memória, com o UUID como chave. Isso permite inserção, busca e remoção em tempo constante. O modelo é de uma única instância; para várias instâncias seria necessário um armazenamento compartilhado, como Redis.
- **Clientes desconectados:** o evento `close` remove o cliente do `Map` e dispara o aviso de saída. Um heartbeat com `ping`/`pong` a cada 30 segundos encerra conexões que pararam de responder.
- **Formato das mensagens:** JSON, por ser estruturado, extensível e permitir tipos, autor, identificador e timestamp no mesmo payload. O servidor limita o payload a 16 KB, o nome a 40 caracteres e o texto a 500 caracteres.
- **Histórico:** as últimas 50 mensagens de chat ficam em memória e são enviadas a quem entra depois. Não há banco de dados; ao reiniciar o servidor, o histórico é perdido.
- **Rede:** todos os arquivos são locais, sem CDN, e o WebSocket usa a mesma porta/origem da página. Em redes que bloqueiam WebSocket, a demonstração pode ser feita localmente com duas abas.

## Protocolo

Mensagens do cliente:

```json
{"type":"join","name":"Ana"}
{"type":"chat","text":"Olá, pessoal!"}
```

Mensagens do servidor:

| Tipo | Conteúdo |
| --- | --- |
| `welcome` | `clientId`, `name`, `clientCount` e `history` |
| `chat` | `id`, `author`, `authorId`, `text` e `timestamp` |
| `system` | `event`, `text`, `timestamp` e `clientCount` |
| `clients` | `count` de pessoas online |
| `error` | `code`, `message` e `timestamp` |

## Respostas para as evidências

**a) Como as conexões dos clientes foram armazenadas?**
Em um `Map` em memória no processo Node.js, usando um UUID como chave. Cada valor guarda id, nome, socket, horário de entrada e estado do heartbeat. A remoção ocorre no evento `close`, e o mapa é percorrido no broadcast.

**b) Como o sistema identifica um cliente conectado?**
O servidor gera um UUID na abertura da conexão; o nome é enviado depois na mensagem `join`. As mensagens carregam `authorId`, e o UUID é usado nos logs, na remoção e na contagem. O nome serve apenas para exibição.

**c) O que aconteceria se a mesma funcionalidade fosse implementada usando polling?**
Haveria requisições HTTP repetidas em intervalos, com atraso e tráfego desnecessário. Com muitos clientes, aumentariam as respostas vazias e a carga no servidor. Atualizações urgentes não seriam instantâneas, e o custo cresceria com o número de clientes.

**d) Em quais cenários o WebSocket é mais adequado que uma API REST tradicional?**
Em chat, notificações, colaboração em tempo real, dashboards ao vivo, jogos e leilões. Nesses casos o servidor precisa enviar eventos assim que ocorrem e pode haver troca frequente nos dois sentidos. REST continua mais adequado para CRUD, consultas cacheáveis e operações pontuais.

## Limitações

- Não há autenticação, moderação, salas ou mensagens privadas.
- O histórico é mantido apenas em memória e não sobrevive ao reinício do servidor.
- A aplicação usa `ws://`, conforme o requisito; em produção seria necessário TLS (`wss://`) e um proxy reverso.
- A dependência `ws` precisa ser instalada pelo npm. Em uma rede sem acesso ao registry, copie a pasta `node_modules` gerada em outra máquina.

## Evidências

O roteiro para os prints e para a montagem do PDF está em [docs/EVIDENCIAS.md](docs/EVIDENCIAS.md).

## Documentação do código

A explicação técnica completa está em [docs/EXPLICACAO-CODIGO.md](docs/EXPLICACAO-CODIGO.md), incluindo ciclo de vida da conexão, protocolo JSON, funções principais e justificativas das decisões.
