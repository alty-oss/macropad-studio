# TODO — Macropad Studio

Levantamento feito em 02/11/2026 lendo o app de ponta a ponta (v0.2.0). A maior parte foi implementada na v0.3.0 (ver `CHANGELOG.md`). Prioridades:

- **P1**: corrige um risco real ou destrava muita coisa
- **P2**: feature de alto valor
- **P3**: bom de ter, ou exige pesquisa antes

Marcado com [x]: implementado, compila e passa nos testes automáticos (`bun test`, `cargo test`, `cargo clippy`). **Ainda não foi testado com o macropad, o OBS, o Home Assistant, o Voicemeeter ou portas MIDI reais**: a primeira tarefa é passar pela lista de verificação no fim deste arquivo.

---

## 1. Correções e riscos encontrados

- [x] **P1 — `config.json` corrompido apagava todas as macros.** Agora o arquivo ruim vira `config-invalido-<número>.json`, o app avisa (toast ou notificação) e registra no log. O `config.json` ganhou o campo `version` (§1, último item).
- [x] **P1 — Erros das ações do app sumiam com a janela na bandeja.** Viram notificação do Windows quando a janela está escondida ou minimizada, e também aparecem no OSD.
- [x] **P1 — Modificador segurado no teclado de verdade disparava a macro errada.** O gancho guarda quando cada Ctrl/Shift passou de solto a pressionado: só os que chegaram junto com a tecla (≤ 50 ms) contam como do macropad. Limite conhecido: se o usuário segura no teclado o **mesmo** modificador que o macropad envia, a escolha ainda pode errar. A solução completa é o Raw Input (§5).
- [x] **P2 — Uma macro longa travava todas as outras.** Cada (camada, slot) tem uma thread própria, e "Parar ações em execução" (bandeja, `--stop`) interrompe as execuções na próxima etapa, inclusive no meio de um "Aguardar" ou de um texto.
- [x] **P2 — Giros de knob se acumulavam.** Giros que chegam durante uma execução viram uma execução só, repetida, sem esperar o modificador de novo a cada vez.
- [x] **P2 — A gravação não era transacional.** As etapas só vão para o app depois que o macropad confirma o controle; se a gravação falha no meio, o rascunho fica para tentar de novo.
- [x] **P2 — O `held` do gancho podia travar uma tecla.** Sem repetição automática por 1 s, a próxima pressão conta como nova.
- [x] **P2 — Janelas elevadas (admin) não recebem texto nem atalhos.** O app detecta e avisa, sugerindo abrir o Macropad Studio como administrador. Falta a opção de **sempre** abrir elevado (exige um manifesto ou uma tarefa agendada, porque o autostart não eleva).
- [x] **P3 — CSP desligado.** CSP restrito no `tauri.conf.json` (desligado só no `dev`, por causa do recarregamento automático).
- [ ] **P3 — Detecção do dispositivo por polling.** Parcial: a verificação não disputa mais o mutex do HID com leituras em andamento (`try_lock`). Falta trocar o polling de 1 s por `WM_DEVICECHANGE`.
- [x] **P3 — Versão duplicada.** O `tauri.conf.json` agora usa a versão do `Cargo.toml`.
- [x] **P3 — `config.json` sem versão.** Campo `version` (2) e leitura da versão 1 testada.

---

## 2. Integrações

### OBS Studio (P2)

- [x] Conexão nas Configurações: ativar, endereço, porta e senha (no Gerenciador de Credenciais), com o estado da conexão ao lado
- [x] Grupo "Streaming" na biblioteca, com etapas que também funcionam em multi-ação:
  - [x] Trocar de cena (sugestões carregadas do OBS, com digitação livre)
  - [x] Gravação, transmissão e câmera virtual (alternar, iniciar, parar)
  - [x] Pausar / retomar gravação
  - [x] Salvar replay buffer
  - [x] Silenciar / ativar fonte de áudio
  - [x] Mostrar / esconder fonte numa cena (vazio = cena atual)
  - [x] Volume de fonte em dB (bom num knob)
  - [x] Transição no Studio Mode e marcador na gravação
  - [ ] Screenshot da fonte (`SaveSourceScreenshot` pede uma pasta de destino; falta o campo)
- [x] Reconexão automática a cada 3 s; ação com o OBS fechado vira aviso
- [x] Estado de gravação, transmissão e cena na bandeja, no rodapé e no OSD

### Áudio do Windows (P2)

- [x] Mudo do microfone global (`IAudioEndpointVolume`)
- [x] Volume e mudo por aplicativo (`IAudioSessionManager2`)
- [ ] Trocar o dispositivo de saída padrão. A API (`IPolicyConfig`) não é documentada pela Microsoft; precisa de testes em várias versões do Windows antes de entrar.
- [x] Nível de volume no OSD ao girar

### Outras integrações

- [x] **P2 — Requisição HTTP / webhook** (método, URL, cabeçalhos, corpo; JSON detectado sozinho)
- [x] **P2 — Home Assistant**: endereço e token nas Configurações, entidades sugeridas a partir de `/api/states`
- [x] **P3 — Voicemeeter** (Remote API): definir, somar ou alternar qualquer parâmetro
- [x] **P3 — Saída MIDI**: control change, com modo "somar" para knobs
- [x] **P3 — Mídia por app (SMTC)**: tocar/pausar, próxima, anterior e parar num player específico; o título tocando aparece no OSD
- [x] **P3 — Discord**: kit com os atalhos e instruções para configurá-los no Discord
- [ ] **P3 — Twitch / YouTube**: exige registrar um app OAuth (client id) e um fluxo de login; fica para depois

---

## 3. Novas ações e etapas

- [x] **P2 — Perfis por programa** (em multi-ação), escolhidos pelo executável da janela em foco, com sugestões dos programas abertos
- [x] **P2 — Pressionar e segurar** (modo "tocar ou segurar", 450 ms). Falta o **toque duplo**, que atrasaria todo toque simples.
- [x] **P2 — Ação alternada (toggle)**
- [x] **P2 — Executar comando / script** (cmd, com opção de não abrir janela). Falta mostrar a saída e o código de saída no registro.
- [x] **P2 — Colar pela área de transferência**, restaurando o conteúdo anterior
- [x] **P2 — Variáveis no texto**: `{data}`, `{hora}` e `{clipboard}`. Falta `{contador}`.
- [x] **P2 — Teclas de mídia e volume dentro de multi-ação**
- [x] **P2 — Abrir ou focar**
- [x] **P3 — Controle de janela**: minimizar, maximizar/restaurar, fechar, sempre no topo, próximo monitor
- [x] **P3 — Sistema**: bloquear, suspender, desligar, reiniciar, alternar tema; brilho por DDC/CI
- [x] **P3 — Mouse**: cliques e rolagem vertical e horizontal. Falta mover o cursor.
- [x] **P3 — Soundboard** (MP3/WAV pelo MCI). Falta escolher o dispositivo de saída (cabo virtual para o Discord).
- [x] **P3 — Contador** em arquivo de texto. Falta o pomodoro / timer.
- [ ] **P3 — Multi-ação avançada**: repetir N vezes, repetir enquanto segura, "esperar janela X aparecer", condição pela janela em foco (os perfis cobrem parte disso)

---

## 4. Editor e experiência

- [x] **P1 — Desfazer / refazer** (Ctrl+Z / Ctrl+Y, botões no cabeçalho; digitação seguida no mesmo campo vira um passo)
- [x] **P2 — Descartar todas as alterações** (menu Mais)
- [x] **P2 — Legenda, ícone e cor por tecla**, salvos no app e incluídos no arquivo exportado
- [x] **P2 — OSD** (janela transparente, sem foco e sem cliques; desligável nas Configurações)
- [x] **P2 — Camada ativa** marcada no cabeçalho e na dica da bandeja
- [x] **P2 — Kits prontos**: Streaming (OBS), Reuniões (Meet/Teams/Zoom com perfis), VS Code, Photoshop, Mídia, Discord
- [x] **P2 — Copiar e trocar camadas inteiras**
- [x] **P2 — Testar ações gravadas no dispositivo** (atalhos e mídia)
- [x] **P2 — Pausar teclas virtuais** (bandeja e Configurações)
- [x] **P3 — Knob do preview gira junto com o físico** (e afunda ao pressionar). Só para knobs com ação do app; ações gravadas no aparelho, como volume, não passam pelo gancho (Raw Input, §5).
- [x] **P3 — Cola da configuração** em SVG (abre no navegador para imprimir). Falta exportar direto em PDF ou PNG.
- [x] **P3 — Primeira execução guiada** (diálogo de boas-vindas)
- [x] **P3 — Navegação por teclado no preview** (setas pela posição na tela, Shift+F10 / tecla de menu)
- [x] **P3 — Registro de atividade em arquivo** (`%LOCALAPPDATA%\com.macropad.studio\logs\activity.log`, gira em 1 MB) e botão para abrir a pasta
- [x] **P3 — Tema claro** e "igual ao Windows". O aparelho e o teclado virtual mantêm o visual escuro do produto de propósito.
- [ ] **P3 — Inglês** (i18n). Todas as strings estão espalhadas nos módulos; o primeiro passo é extraí-las para um arquivo por idioma.

---

## 5. Hardware e protocolo (pesquisa, precisa do aparelho)

- [ ] **P2 — Macros de vários passos gravadas no aparelho** (`count > 1` no registro). Precisa de engenharia reversa com o macropad em mãos, respeitando a regra do README (só leitura e gravação de atalhos).
- [ ] **P3 — Raw Input para identificar o macropad.** Resolveria de vez o conflito com modificadores (§1), o giro do preview para ações gravadas no aparelho e teclados com F13–F24 de fábrica.
- [ ] **P3 — Ações de mouse do firmware.** Confirmar no aparelho antes de expor.
- [ ] **P3 — Outros modelos do mesmo protocolo** (3, 6 e 15 teclas).
- [ ] **Confirmar o keyup ao soltar**: o modo "segurar" depende de o macropad manter a tecla pressionada enquanto o dedo está nela. Se ele soltar na hora, o segurar nunca dispara (vale o toque).

---

## 6. Engenharia, testes e distribuição

- [x] **P1 — CI no GitHub Actions** (`.github/workflows/ci.yml`): tipos, `bun test`, clippy com `-D warnings`, `cargo test` e o instalador como artefato
- [x] **P2 — Testes no Rust**: scancodes, rotas do gancho e modificadores, config corrompida e versão 1, autenticação do OBS (exemplo da documentação), volume em dB, MIDI, cabeçalhos HTTP, contador
- [x] **P2 — Atualização automática** (`tauri-plugin-updater`). O app procura ao abrir e em Configurações › Sobre; o release publica o `latest.json` assinado. A chave privada está nos segredos `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` do repositório, e a cópia local em `%USERPROFILE%\.tauri\` (guardar num gerenciador de senhas: sem ela, quem já instalou não recebe mais atualizações). Quem tem a v0.2.0 precisa instalar a v0.3.0 manualmente uma vez.
- [ ] **P2 — Assinatura de código** do instalador. Precisa de um certificado de assinatura de código. Opções: SignPath Foundation (grátis para open source, pedir aprovação), Azure Trusted Signing ou um certificado OV com assinatura na nuvem. Com ele, configurar `bundle.windows.signCommand` e os segredos no release.
- [x] **P2 — Changelog e release** (`CHANGELOG.md`; `.github/workflows/release.yml`: cada push na `main` vira a versão `<maior>.<menor>.<execução>`, com tag, instalador e `latest.json` em Releases e os commits como notas)
- [ ] **P3 — Testes da interface** com um transporte falso. Os módulos do editor usam o DOM; falta um ambiente como happy-dom no `bun test`.
- [x] **P3 — Linha de comando**: `--run <camada>:<slot>` e `--stop`. Falta uma API local (WebSocket) para outros programas.
- [ ] **P3 — Sistema de plugins**.

---

## Lista de verificação no aparelho (fazer primeiro)

1. Abrir a v0.3.0 com um `config.json` da v0.2.0 e conferir que as macros continuam funcionando.
2. Uma tecla de ação do app na camada 1 com Shift segurado no teclado: deve executar a ação dela, não a de outra tecla.
3. Girar um knob com ação do app rápido: as execuções somam, sem atraso acumulado; o knob do preview gira.
4. Modo "tocar ou segurar": confirmar que o segurar dispara (item do §5).
5. Desligar o cabo no meio de uma gravação: o rascunho continua marcado e gravar de novo funciona.
6. OSD: aparece sem roubar o foco de um jogo ou de um documento, e some sozinho.
7. OBS: conectar com senha, trocar de cena, volume de fonte no knob, e o estado de gravação na bandeja.
8. Mudo do microfone e volume por programa (Spotify, Discord).
9. Tema claro e escuro; abrir o app só pela bandeja (`--hidden`) e conferir as notificações de erro.
