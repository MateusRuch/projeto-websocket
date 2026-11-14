# Guia de evidências

Este roteiro produz os três prints exigidos e organiza o PDF de entrega. Use dois clientes: uma aba normal e uma janela anônima, ou dois navegadores diferentes.

## Preparação

1. No terminal, execute `npm install` e depois `npm start`.
2. Abra `http://localhost:8080` no primeiro cliente.
3. Abra a mesma URL no segundo cliente.
4. Deixe o terminal do servidor visível durante toda a demonstração.

## Print 1 — servidor em execução

Capture o terminal logo após iniciar o servidor, mostrando as linhas:

```text
Chat WebSocket iniciado
  HTTP: http://localhost:8080
  WS:   ws://localhost:8080/ws
```

Se possível, mantenha no mesmo print a primeira linha de conexão:

```text
[conexão] aberta id=... ip=...
```

## Print 2 — dois clientes conectados simultaneamente

1. No primeiro cliente, entre com o nome `Ana`.
2. No segundo, entre com o nome `Bruno`.
3. Confirme que ambos exibem:
   - status `Conectado`;
   - contador `2 pessoas online`;
   - avisos de entrada na sala.
4. Posicione as duas janelas lado a lado e capture a tela inteira.

## Print 3 — mensagem recebida em tempo real

1. No cliente `Ana`, envie uma mensagem, por exemplo: `Olá, Bruno!`.
2. Capture as duas janelas mostrando a mesma mensagem e o terminal com a linha:

```text
[mensagem] id=... nome="Ana" texto="Olá, Bruno!"
```

3. Opcional: feche a janela do cliente `Bruno` e capture o aviso de saída e a linha de encerramento:

```text
[conexão] encerrada id=... nome="Bruno" código=1000
```

## Organização do PDF

Monte um único PDF nesta ordem:

1. Print do servidor em execução.
2. Print dos dois clientes conectados simultaneamente.
3. Print demonstrando o recebimento da mensagem em tempo real.
4. Respostas a–d, com no máximo 5 linhas por item e no máximo 1 página no total.

## Respostas para incluir no PDF

**a) Como as conexões dos clientes foram armazenadas?**
Em um `Map` em memória no processo Node.js, usando um UUID como chave. Cada valor guarda id, nome, socket, horário de entrada e estado do heartbeat. A remoção ocorre no evento `close`, e o mapa é percorrido no broadcast.

**b) Como o sistema identifica um cliente conectado?**
O servidor gera um UUID na abertura da conexão; o nome é enviado depois na mensagem `join`. As mensagens carregam `authorId`, e o UUID é usado nos logs, na remoção e na contagem. O nome serve apenas para exibição.

**c) O que aconteceria se a mesma funcionalidade fosse implementada usando polling?**
Haveria requisições HTTP repetidas em intervalos, com atraso e tráfego desnecessário. Com muitos clientes, aumentariam as respostas vazias e a carga no servidor. Atualizações urgentes não seriam instantâneas, e o custo cresceria com o número de clientes.

**d) Em quais cenários o WebSocket é mais adequado que uma API REST tradicional?**
Em chat, notificações, colaboração em tempo real, dashboards ao vivo, jogos e leilões. Nesses casos o servidor precisa enviar eventos assim que ocorrem e pode haver troca frequente nos dois sentidos. REST continua mais adequado para CRUD, consultas cacheáveis e operações pontuais.

## Checklist final

- [ ] Print do terminal com o servidor iniciado.
- [ ] Print com dois clientes e o contador `2 pessoas online`.
- [ ] Print de uma mensagem aparecendo nos dois clientes e no log do servidor.
- [ ] Respostas a–d com até 5 linhas cada.
- [ ] Respostas descritivas em no máximo 1 página.
- [ ] PDF único, legível e sem dados pessoais desnecessários.
