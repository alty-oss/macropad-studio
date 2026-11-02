# Macropad Studio

Configurador para Windows dos macropads CH57x identificados como USB `1189:8840`, incluindo o modelo de 12 teclas e 3 knobs. É um app Tauri: a janela configura o dispositivo e o processo fica na bandeja executando as ações do app.

## Dois tipos de ação

- **Gravadas no macropad**: atalho de teclado, multimídia e "Sem ação". Ficam na memória do dispositivo e funcionam em qualquer computador, mesmo sem o app.
- **Executadas pelo app** (marcadas com *App*): o app grava no slot uma **tecla virtual** e associa a ela as etapas configuradas. As etapas disponíveis:
  - **Sistema**: abrir arquivo, pasta ou programa (ou trazer para frente se já estiver aberto), site, digitar ou colar texto (com `{data}`, `{hora}` e `{clipboard}`), atalho, aguardar, comando ou script, janela, energia e tema, mouse e brilho do monitor (DDC/CI).
  - **Áudio**: mudo e volume do microfone e da saída padrão, volume por programa, controle de players (SMTC), teclas de mídia e tocar som.
  - **Streaming**: ações do OBS Studio (cena, gravação, transmissão, replay, fontes, volume em dB) e contador em arquivo de texto para fontes do OBS.
  - **Integrações**: requisição HTTP (webhooks), Home Assistant, MIDI e Voicemeeter.

  Uma **multi-ação** junta várias etapas e pode **alternar** entre duas listas a cada pressão, executar outra lista ao **segurar** a tecla e ter **perfis por programa**: a mesma tecla faz uma coisa no Photoshop e outra no VS Code, conforme a janela em foco.

### Teclas virtuais

O descritor HID do teclado aceita usos de `0x00` a `0xFF`, então o macropad pode enviar F13–F24 (`0x68`–`0x73`), teclas que o Windows reconhece mas que nenhum teclado comum tem. Cada par (camada, slot) recebe um código fixo de F13–F24, combinado com Ctrl ou Shift, do lado esquerdo ou direito, quando os 12 códigos simples se esgotam (`virtualCode` em [src/device/protocol.ts](src/device/protocol.ts)). Alt e Win ficam de fora porque, sozinhos, abrem menus.

Um gancho de teclado de baixo nível ([src-tauri/src/virtual_keys.rs](src-tauri/src/virtual_keys.rs)) reconhece esses códigos, impede que cheguem aos outros programas e envia a ação ao executor ([src-tauri/src/executor.rs](src-tauri/src/executor.rs)). Por isso o app precisa estar aberto, mesmo que só na bandeja. As etapas, legendas e preferências ficam em `%APPDATA%\com.macropad.studio\config.json`; senhas e tokens das integrações ficam no Gerenciador de Credenciais do Windows. Se o `config.json` não puder ser lido, ele é guardado como `config-invalido-<número>.json` e o app avisa, em vez de sobrescrevê-lo.

O gancho distingue o modificador enviado pelo macropad (que chega junto com a tecla) do que o usuário já segurava no teclado de verdade. Cada tecla virtual tem sua própria fila no executor: uma macro longa não atrasa as outras, e giros de knob que chegam durante uma execução são somados. **Parar ações em execução** e **Pausar teclas virtuais** ficam no menu da bandeja.

### Integrações

- **OBS Studio**: ative o servidor em Ferramentas › Configurações do WebSocket no OBS (28 ou mais novo) e informe a senha nas Configurações do Macropad Studio. O app reconecta sozinho quando o OBS abre e mostra no rodapé, na bandeja e no OSD se está gravando ou ao vivo.
- **Home Assistant**: endereço e um token de acesso de longa duração nas Configurações. As etapas chamam `homeassistant.toggle`, `turn_on` ou `turn_off`, que valem para luzes, tomadas, cenas e scripts.
- **MIDI**: envia control change para qualquer porta MIDI de saída; para programas sem porta própria, use uma porta virtual (loopMIDI).
- **Voicemeeter**: usa a Remote API (`VoicemeeterRemote64.dll`) da instalação padrão.

### Linha de comando

`"Macropad Studio.exe" --run 1:3` aciona a camada 1, slot 3, como se a tecla fosse pressionada, e `--stop` para as ações em execução. Com o app já aberto, o pedido vai para a instância da bandeja.

## Desenvolvimento

Requisitos: [Bun](https://bun.sh/), Rust (`rustup`) e Visual Studio Build Tools com a carga de trabalho C++. O WebView2 já vem no Windows 10/11.

```powershell
bun install
bun run dev        # abre o app com recarga automática da interface
bun run build      # gera o instalador em src-tauri\target\release\bundle\nsis
bun run test       # verifica o protocolo sem conectar o macropad
bun run typecheck  # checagem de tipos do TypeScript (modo estrito)
```

**Cada push na `main` publica uma versão** em Releases. O workflow de release testa tudo, gera a versão `<maior>.<menor>.<execução>` (o `<maior>.<menor>` vem do `src-tauri/Cargo.toml`, como `0.3.12`), cria a tag `v<versão>` e publica o instalador com os artefatos do updater assinados (pela chave nos segredos do repositório) e o `latest.json` que o app consulta para se atualizar. As notas são os commits desde o release anterior. Para mudar de `0.3.x` para `0.4.x`, basta alterar a versão no `Cargo.toml`. Pull requests rodam só o CI. Localmente, `bun run build` não precisa da chave: os artefatos do updater só são gerados no release (`scripts/release.ts`).

`bun run web` serve só a interface em `http://localhost:8000` para o Chrome/Edge, usando WebHID. Nesse modo, as ações do app ficam indisponíveis.

O projeto é em TypeScript. O Bun roda o servidor e os testes direto do `.ts`; a interface, que o WebView2 executa como JavaScript, é empacotada pelo próprio Bun: sob demanda no servidor de desenvolvimento, com recarga automática, e em `dist/` por `bun run build:web` antes do build de release.

## Organização

```
src/                    interface (o WebView do app)
  index.html, main.ts   página e ponto de entrada: liga os eventos e conecta ao macropad
  osd.html, osd.ts      aviso na tela (OSD), numa janela transparente à parte
  device/               tudo do hardware e dos formatos, sem DOM
    keys.ts             nomes das teclas HID, layout do teclado virtual, modificadores e mídia
    protocol.ts         slots, teclas virtuais, codificação dos registros e os tipos Binding e Macro
    steps.ts            etapas do app: tipos, opções, resumo, validação e leitura
    transport.ts        troca de relatórios HID: Rust no app (@tauri-apps/api) ou WebHID no navegador
    backup-file.ts      formato do arquivo exportado e validação na importação
  editor/               a tela do editor
    state.ts            estado: conexão, camadas (dispositivo e rascunhos), seleção, legendas e OBS
    editing.ts          rascunhos, seleção, copiar e colar, desfazer/refazer e operações com camadas
    session.ts          conexão, leitura das camadas e gravação
    board.ts            pré-visualização do aparelho, arrastar e soltar, funções e giro do knob
    inspector.ts        painel de propriedades: multi-ação, modos, perfis e aparência
    step-forms.ts       formulários de cada tipo de etapa
    library.ts          biblioteca de ações e busca
    kits.ts             kits prontos (OBS, reuniões, VS Code…)
    labels.ts           legendas, ícones e cores personalizados
    cheatsheet.ts       "cola" da configuração em SVG
    shortcuts.ts        captura de atalhos e teclado virtual
    legend.ts           títulos, ícones e legendas impressas nas keycaps
    chrome.ts           tela de conexão, cabeçalho, faixa de aviso e rodapé
    backup.ts           exportar e importar a configuração
    menu.ts, feedback.ts, settings.ts   menu flutuante, avisos e configurações
  lib/                  utilitários sem regra de negócio (dom.ts, icons.ts, text.ts)
  styles/               main.css importa um arquivo por área da tela
src-tauri/              app nativo (Rust)
  src/device.rs         abre a interface de configuração (página 0xFF00) com hidapi
  src/virtual_keys.rs   gancho de teclado que reconhece as teclas virtuais
  src/executor.rs       uma fila por tecla, modos alternar/segurar, perfis e cada tipo de etapa
  src/system.rs         janela em foco, elevação, janelas, energia, mouse, brilho, sons, área de transferência
  src/audio.rs          Core Audio (microfone, saída, volume por programa) e players (SMTC)
  src/obs.rs            cliente do obs-websocket 5
  src/integrations.rs   HTTP, Home Assistant, MIDI e Voicemeeter
  src/secrets.rs        senhas e tokens no Gerenciador de Credenciais
  src/config.rs         macros, legendas e preferências em %APPDATA%
  src/main.rs           comandos, bandeja, OSD, notificações, linha de comando e instância única
scripts/dev-server.ts   servidor de desenvolvimento usado por `bun run dev` e `bun run web`
tests/                  `bun test`: protocolo, etapas, arquivo de configuração e correspondência entre os módulos e o HTML
.github/workflows/      CI (tipos, testes, clippy e instalador) e release por tag
```

Os testes do Rust rodam com `cargo test` dentro de `src-tauri`.

## Uso

1. Conecte o macropad. O app o detecta sozinho e lê a camada ativa.
2. Arraste uma ação da lista à direita até uma tecla ou knob, ou selecione o controle e clique na ação. Ao clicar num knob, o painel de propriedades mostra abas para girar à esquerda, pressionar e girar à direita.
3. Ajuste os parâmetros no painel de propriedades. Em atalhos, clique no campo e pressione a combinação; para Win ou Alt+Tab, use o teclado virtual.
4. Clique em **Gravar no dispositivo**. O app grava, lê o dispositivo de novo e confirma cada controle.

Clique com o botão direito num controle para copiar, colar, limpar ou testar (ou use Shift+F10; as setas andam entre os controles). Arrastar uma tecla sobre outra troca as ações das duas. Ctrl+Z e Ctrl+Y desfazem e refazem. No painel de propriedades, **Aparência** define legenda, ícone e cor da tecla, que valem na hora e não vão para o macropad. Fechar a janela mantém o app na bandeja; para encerrar, use **Sair** no menu do ícone.

O botão **Mais** no cabeçalho tem os kits prontos (Streaming, Reuniões, VS Code, Photoshop, Mídia e Discord), a cola para impressão, copiar ou trocar camadas inteiras e descartar todas as alterações. Tudo entra como alteração não gravada.

Para fazer backup ou levar a configuração para outro computador, use o botão de arquivo no cabeçalho: **Exportar configuração** salva um `.json` com as ações das três camadas, incluindo as etapas das ações do app e as legendas personalizadas (com o macropad conectado, as camadas ainda não abertas são lidas antes). **Importar configuração** valida o arquivo e aplica as ações como alterações não gravadas; nada vai para o macropad até você clicar em **Gravar no dispositivo**. Ações existentes que o editor não representa ficam de fora da exportação.

## Ordem física das teclas

A pré-visualização mostra o aparelho deitado, girado 90° para a direita: knobs na lateral direita (knob 1 em cima, o knob grande embaixo) e as teclas num bloco de 4 × 3. Os nomes "Tecla 01" a "Tecla 12" seguem a ordem de leitura nessa posição, da esquerda para a direita e de cima para baixo.

O firmware numera as teclas por coluna, de baixo para cima, com o aparelho em pé (knobs em cima). A correspondência nessa posição é:

| Linha física, de cima para baixo | Esquerda | Centro | Direita |
| --- | ---: | ---: | ---: |
| 1 | slot 4 | slot 8 | slot 12 |
| 2 | slot 3 | slot 7 | slot 11 |
| 3 | slot 2 | slot 6 | slot 10 |
| 4 | slot 1 | slot 5 | slot 9 |

Essa ordem foi confirmada no aparelho: gravar nos slots 1, 2 e 3 afetou as três teclas inferiores da coluna esquerda.

Cada knob usa três slots a partir do 16 (knob 1: 16–18, knob 2: 19–21, knob 3: 22–24), na ordem girar à esquerda, pressionar, girar à direita, também confirmada no aparelho.

## Limite importante

O app só envia os comandos documentados de leitura e gravação de atalhos (`0xFA`/`0xFB`/`0xFE`), além dos delimitadores de gravação. Ele não contém comandos de firmware, reset de fábrica ou alteração do modelo do teclado. A camada ativa é escolhida no próprio macropad; o app não consegue trocá-la.
