# Macropad Studio

Configurador para Windows dos macropads CH57x (USB `1189:8840`, como o modelo de 12 teclas e 3 knobs), que também transforma o celular num Stream Deck.

## Recursos

### Macropad
- **Editor visual** do aparelho: arraste ações até as teclas e knobs, ajuste no painel de propriedades e grave. Desfazer/refazer, copiar e colar, trocar teclas de lugar e três camadas.
- **Gravado no aparelho**: atalhos de teclado e teclas de mídia funcionam em qualquer computador, mesmo sem o app.
- **Ações do app** por teclas virtuais (F13–F24), com o app na bandeja:
  - **Sistema**: abrir programas, pastas e sites, digitar texto, comandos e scripts, janelas, energia, tema, mouse e brilho do monitor.
  - **Áudio**: mudo do microfone, volume da saída e por programa, teclas de mídia e soundboard.
  - **OBS Studio**: cenas, gravação, transmissão, replay, fontes, volume e screenshot.
  - **Integrações**: requisições HTTP (webhooks) e Voicemeeter.
- **Multi-ação**: várias etapas em sequência, alternar entre duas listas, tocar ou segurar e perfis por programa (a mesma tecla faz coisas diferentes conforme a janela em foco).
- **Knobs** com ações incrementais (volume, brilho, rolagem) nos giros.
- Kits prontos (Streaming, Reuniões, VS Code, Photoshop, Mídia, Discord), legendas, ícones e cores nas teclas, cola para impressão, exportar/importar a configuração e aviso na tela (OSD).

### Celular
- **Stream Deck no celular** pela rede Wi-Fi: escaneie o QR code ou abra o endereço, sem código.
- **App instalável** no iPhone e no Android, em tela cheia e sem rolagem, sempre deitado (5 × 3) em qualquer posição do celular.
- **Botões com estado**: gravando no OBS o botão fica vermelho e vira "parar"; cena atual acende, microfone mudo aparece riscado, tocar/pausar acompanha a mídia e o contador mostra o valor.
- **Pastas** com botão Voltar, para organizar quantos botões quiser.
- **Visual personalizável**: cores, ícones (incluindo OBS, Twitch, YouTube, Discord e Spotify) e **imagens**, como logo ou cobrindo a tecla inteira.
- Todas as ações do app funcionam no celular; volume, brilho e afins **repetem enquanto você segura** o botão.
- Acesso às camadas do macropad pelo celular, inclusive atalhos e mídia gravados no aparelho.

> O servidor do celular fica desligado por padrão e não pede código: qualquer aparelho da mesma rede que abrir o endereço pode usar os botões. Ative-o só em redes de confiança. Por usar HTTP, no Android o app pode virar só um atalho, a menos que o endereço seja liberado em `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.

## Uso rápido

1. Instale pela página de [Releases](../../releases) e conecte o macropad: o app o detecta sozinho.
2. Arraste uma ação da biblioteca até uma tecla ou knob e ajuste no painel de propriedades.
3. Clique em **Gravar no dispositivo**.
4. Para o celular, abra a aba **Celular**, monte os botões e clique em **Conectar celular**.

Fechar a janela mantém o app na bandeja. Pela linha de comando, `"Macropad Studio.exe" --run 1:3` aciona a camada 1, slot 3, e `--stop` para as ações em execução.

## Desenvolvimento

Requisitos: [Bun](https://bun.sh/), Rust e Visual Studio Build Tools (C++).

```powershell
bun install
bun run dev        # app com recarga automática
bun run build      # instalador em src-tauri\target\release\bundle\nsis
bun test           # testes da interface; os do Rust com `cargo test` em src-tauri
bun run typecheck
```

Cada push na `main` publica uma versão `<maior>.<menor>.<execução>` em Releases, com o `<maior>.<menor>` do `src-tauri/Cargo.toml`; o app se atualiza sozinho. Para mudar de série (como 0.4 → 0.5), altere a versão no `Cargo.toml`.

O app só usa os comandos documentados de leitura e gravação de atalhos (`0xFA`/`0xFB`/`0xFE`): não mexe em firmware nem no modelo do teclado, e não troca a camada ativa, que é escolhida no próprio macropad.
