# Configurador local do teclado DIY

Configurador local para os macropads CH57x identificados como USB `1189:8840`, incluindo o modelo de 12 teclas e 3 controles.

## Abrir localmente

Com [Bun](https://bun.sh/) instalado, no PowerShell e dentro desta pasta, execute:

```powershell
bun run start
```

O CSS compilado já acompanha o projeto. Para editar a interface com Tailwind, instale as dependências e gere novamente o arquivo estático:

```powershell
bun install
bun run build:css
```

`site/tailwind.input.css` contém as cores, estilos globais e utilitários Tailwind sem Preflight; `site/styles.css` guarda o desenho da prévia física e do teclado QWERTY.

## Desenvolvimento com atualização automática

Depois de `bun install`, execute:

```powershell
bun run dev
```

Esse comando recompila o Tailwind ao salvar e atualiza o navegador automaticamente. Mudanças em CSS trocam as folhas de estilo sem recarregar a página, preservando a conexão com o macropad. Mudanças em HTML, JavaScript ou no servidor recarregam a página; nesse caso, pode ser necessário reconectar o dispositivo. Use `Ctrl+C` para parar os dois processos. O comando `bun run start` continua servindo a versão local sem ferramentas de desenvolvimento.

## Organização

- `site/`: página, JavaScript do navegador, CSS próprio e CSS compilado do Tailwind.
- `server/`: servidor Bun que publica apenas os arquivos necessários em `localhost`.
- `tests/`: verificação local do protocolo e da correspondência entre JavaScript e HTML.

Para verificar o protocolo sem conectar o macropad, execute `bun run test`.

Depois abra `http://localhost:8000` no **Google Chrome** ou **Microsoft Edge**. Não abra o arquivo com duplo clique: o WebHID requer um contexto seguro, e `localhost` atende a isso.

1. Clique em **Conectar dispositivo** e escolha **USB Composite Device**.
2. Clique numa tecla ou na superfície de uma rodinha para configurar seu pressionamento. As ações de giro ficam nos controles abaixo da pré-visualização. Um modal abrirá com a ação selecionada.
3. Escolha **Teclado**, **Mídia** ou **Sem ação**. Para um atalho, clique em Ctrl, Shift, Alt ou Win diretamente no teclado QWERTY e depois na tecla principal. O teclado virtual inclui teclas de função, pontuação, navegação e bloco numérico.
4. Clique em **Concluir** para preparar a mudança ou **Cancelar** para descartá-la. Use **Gravar** na página principal para salvar as alterações no macropad. A página lê o dispositivo novamente e confirma os registros aplicados.

É possível preparar alterações em mais de uma camada antes de gravar. A leitura manual de uma camada pede confirmação antes de descartar edições pendentes nela. Macros existentes com vários passos e outras ações que este editor não representa são mantidas enquanto você não substitui aquele controle.

## Ordem física das teclas

O firmware numera as teclas por coluna, de baixo para cima. A correspondência da representação 3 × 4 é:

| Linha física, de cima para baixo | Esquerda | Centro | Direita |
| --- | ---: | ---: | ---: |
| 1 | slot 4 | slot 8 | slot 12 |
| 2 | slot 3 | slot 7 | slot 11 |
| 3 | slot 2 | slot 6 | slot 10 |
| 4 | slot 1 | slot 5 | slot 9 |

Essa ordem foi confirmada no aparelho: gravar nos slots 1, 2 e 3 afetou as três teclas inferiores da coluna esquerda.

## Pré-visualização

A carcaça usa um contorno SVG único baseado na foto do aparelho, com recorte côncavo sob o knob grande, cabo USB, quatro indicadores luminosos e quatro parafusos. Teclas e rodinhas são elementos HTML interativos posicionados proporcionalmente sobre esse contorno. As teclas permanecem visualmente sem legendas, como no aparelho; o atalho de cada uma aparece no painel de seleção, no modal e na dica ao passar o mouse.

## Limite importante

O app só envia os comandos documentados de leitura e gravação de atalhos (`0xFA`/`0xFB`/`0xFE`), além dos delimitadores de gravação. Ele não contém comandos de firmware, reset de fábrica ou alteração do modelo do teclado. O desenho assume a orientação física mostrada na referência; confirme os sentidos das rodinhas com um teste no seu aparelho.
