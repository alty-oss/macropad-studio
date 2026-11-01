# Macropad Studio

Configurador para Windows dos macropads CH57x identificados como USB `1189:8840`, incluindo o modelo de 12 teclas e 3 knobs. É um app Tauri: a janela configura o dispositivo e o processo fica na bandeja executando as ações do app.

## Dois tipos de ação

- **Gravadas no macropad**: atalho de teclado, multimídia e "Sem ação". Ficam na memória do dispositivo e funcionam em qualquer computador, mesmo sem o app.
- **Executadas pelo app** (marcadas com *App*): abrir arquivo, pasta ou programa, abrir site, digitar texto e multi-ação (várias etapas, com atalhos e pausas). O app grava no slot uma **tecla virtual** e associa a ela as etapas configuradas.

### Teclas virtuais

O descritor HID do teclado aceita usos de `0x00` a `0xFF`, então o macropad pode enviar F13–F24 (`0x68`–`0x73`), teclas que o Windows reconhece mas que nenhum teclado comum tem. Cada par (camada, slot) recebe um código fixo de F13–F24, combinado com Ctrl ou Shift, do lado esquerdo ou direito, quando os 12 códigos simples se esgotam (`virtualCode` em [src/device/protocol.ts](src/device/protocol.ts)). Alt e Win ficam de fora porque, sozinhos, abrem menus.

Um gancho de teclado de baixo nível ([src-tauri/src/virtual_keys.rs](src-tauri/src/virtual_keys.rs)) reconhece esses códigos, impede que cheguem aos outros programas e envia a ação ao executor ([src-tauri/src/executor.rs](src-tauri/src/executor.rs)). Por isso o app precisa estar aberto, mesmo que só na bandeja. As etapas ficam em `%APPDATA%\com.macropad.studio\config.json`.

## Desenvolvimento

Requisitos: [Bun](https://bun.sh/), Rust (`rustup`) e Visual Studio Build Tools com a carga de trabalho C++. O WebView2 já vem no Windows 10/11.

```powershell
bun install
bun run dev        # abre o app com recarga automática da interface
bun run build      # gera o instalador em src-tauri\target\release\bundle\nsis
bun run test       # verifica o protocolo sem conectar o macropad
bun run typecheck  # checagem de tipos do TypeScript (modo estrito)
```

`bun run web` serve só a interface em `http://localhost:8000` para o Chrome/Edge, usando WebHID. Nesse modo, as ações do app ficam indisponíveis.

O projeto é em TypeScript. O Bun roda o servidor e os testes direto do `.ts`; a interface, que o WebView2 executa como JavaScript, é empacotada pelo próprio Bun: sob demanda no servidor de desenvolvimento, com recarga automática, e em `dist/` por `bun run build:web` antes do build de release.

## Organização

```
src/                    interface (o WebView do app)
  index.html, main.ts   página e ponto de entrada: liga os eventos e conecta ao macropad
  device/               tudo do hardware, sem DOM
    keys.ts             nomes das teclas HID, layout do teclado virtual, modificadores e mídia
    protocol.ts         slots, teclas virtuais, codificação dos registros e os tipos Binding, Step e Macro
    transport.ts        troca de relatórios HID: Rust no app (@tauri-apps/api) ou WebHID no navegador
    backup-file.ts      formato do arquivo exportado e validação na importação
  editor/               a tela do editor
    state.ts            estado: conexão, camadas (dispositivo e rascunhos) e seleção
    editing.ts          rascunhos, seleção, copiar e colar
    session.ts          conexão, leitura das camadas e gravação
    board.ts            pré-visualização do aparelho, arrastar e soltar, funções do knob
    inspector.ts        painel de propriedades e formulários de cada ação
    library.ts          biblioteca de ações e busca
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
  src/executor.rs       executa as etapas: abrir, site, texto, atalho, aguardar
  src/config.rs         macros salvas em %APPDATA%
  src/main.rs           comandos, bandeja, inicialização com o Windows e instância única
scripts/dev-server.ts   servidor de desenvolvimento usado por `bun run dev` e `bun run web`
tests/                  `bun test`: protocolo, arquivo de configuração e correspondência entre os módulos e o HTML
```

## Uso

1. Conecte o macropad. O app o detecta sozinho e lê a camada ativa.
2. Arraste uma ação da lista à direita até uma tecla ou knob, ou selecione o controle e clique na ação. Ao clicar num knob, o painel de propriedades mostra abas para girar à esquerda, pressionar e girar à direita.
3. Ajuste os parâmetros no painel de propriedades. Em atalhos, clique no campo e pressione a combinação; para Win ou Alt+Tab, use o teclado virtual.
4. Clique em **Gravar no dispositivo**. O app grava, lê o dispositivo de novo e confirma cada controle.

Clique com o botão direito num controle para copiar, colar, limpar ou testar. Arrastar uma tecla sobre outra troca as ações das duas. Fechar a janela mantém o app na bandeja; para encerrar, use **Sair** no menu do ícone.

Para fazer backup ou levar a configuração para outro computador, use o botão de arquivo no cabeçalho: **Exportar configuração** salva um `.json` com as ações das três camadas, incluindo as etapas das ações do app (com o macropad conectado, as camadas ainda não abertas são lidas antes). **Importar configuração** valida o arquivo e aplica as ações como alterações não gravadas; nada vai para o macropad até você clicar em **Gravar no dispositivo**. Ações existentes que o editor não representa ficam de fora da exportação.

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
