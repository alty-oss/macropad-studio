# Changelog

## 0.3.0

### Novas ações do app
- **OBS Studio** (obs-websocket 5, já incluído no OBS 28+): trocar de cena, gravação, transmissão, câmera virtual, replay buffer, silenciar fonte, volume de fonte em dB (ótimo num knob), mostrar/esconder fonte, transição do Studio Mode e marcador na gravação. O estado (gravando, ao vivo, cena) aparece na bandeja, no rodapé e no OSD.
- **Áudio do Windows**: mudo e volume do microfone e da saída padrão, volume e mudo por programa, e controle de players pelo SMTC.
- **Requisição HTTP** (webhooks), **Home Assistant**, **MIDI** (control change, com modo "somar" para knobs) e **Voicemeeter**.
- **Sistema**: comando/script, janela (minimizar, maximizar, fechar, sempre no topo, próximo monitor), bloquear, suspender, desligar, reiniciar, alternar tema claro/escuro, mouse (cliques e rolagem), brilho por DDC/CI, tocar som e contador em arquivo de texto.
- "Abrir" pode trazer para frente um programa já aberto; "Digitar texto" pode colar pela área de transferência e aceita `{data}`, `{hora}` e `{clipboard}`.

### Multi-ação
- Modos **alternar** (cada pressão executa uma lista) e **tocar ou segurar**.
- **Perfis por programa**: a mesma tecla executa etapas diferentes conforme a janela em foco.
- Etapas podem ser duplicadas.

### Editor
- Desfazer e refazer (Ctrl+Z / Ctrl+Y), descartar todas as alterações.
- Legenda, ícone e cor personalizados por controle.
- Kits prontos: Streaming (OBS), Reuniões (Meet, Teams, Zoom), VS Code, Photoshop, Mídia e Discord.
- Copiar e trocar camadas inteiras; "cola" da configuração em SVG para imprimir.
- A camada ativa no macropad é marcada no cabeçalho, deduzida da última tecla do app.
- O knob da pré-visualização gira junto com o knob do aparelho.
- "Testar" também para atalhos e mídia gravados no aparelho.
- Navegação pelas teclas com as setas; Shift+F10 abre o menu do controle.
- Tema claro, escuro ou igual ao Windows; tela de boas-vindas na primeira abertura.
- O arquivo de configuração exportado (versão 2) inclui os campos novos e as legendas.

### App
- **Atualização automática**: o app procura uma versão nova ao abrir e instala por Configurações › Sobre.
- **OSD**: aviso discreto na tela ao usar uma ação do app.
- Erros com a janela fechada viram notificação do Windows.
- Bandeja: "Parar ações em execução" e "Pausar teclas virtuais".
- Linha de comando: `--run <camada>:<slot>` e `--stop`.
- Registro de atividade em arquivo, com botão para abrir a pasta.

### Correções
- Um `config.json` ilegível não apaga mais as macros: é guardado à parte e o app avisa.
- Um modificador segurado no teclado de verdade não troca mais a tecla virtual reconhecida.
- Cada tecla tem sua própria fila: uma macro longa não trava as outras, e giros rápidos do knob são somados.
- As etapas só são salvas no app depois que o macropad confirma a gravação.
- Uma tecla virtual cujo keyup se perdeu volta a funcionar sozinha.
- Aviso quando a janela em foco roda como administrador (o Windows bloqueia texto e atalhos).
- CSP restrito na interface e detecção do dispositivo sem disputar o HID com leituras em andamento.

## 0.2.0

- Interface em TypeScript, pré-visualização do aparelho deitado, importar e exportar a configuração.
