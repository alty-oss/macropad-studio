import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

describe('conexão da página mobile', () => {
  const html = readFileSync(new URL('../src/mobile.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

  // Roda o script da página com DOM, WebSocket e timers falsos.
  function load() {
    const elements = new Map<string, Record<string, unknown>>();
    const element = (id: string) => {
      if (!elements.has(id)) elements.set(id, { hidden: false, textContent: '', className: '', value: '', disabled: false });
      return elements.get(id)!;
    };
    const timers = new Map<number, () => void>();
    const sockets: FakeSocket[] = [];
    let nextTimer = 0;

    class FakeSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      readyState = FakeSocket.CONNECTING;
      sent: string[] = [];
      onclose?: (event: { code: number; reason: string }) => void;
      onmessage?: (event: { data: string }) => void;
      onerror?: () => void;
      constructor(public url: string) { sockets.push(this); }
      send(message: string) { this.sent.push(message); }
      close() { this.readyState = 3; this.onclose?.({ code: 1006, reason: '' }); }
    }

    runInNewContext(script!, {
      document: { getElementById: element, querySelectorAll: () => [] },
      location: { search: '', protocol: 'http:', host: '192.168.1.2:38800' },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      WebSocket: FakeSocket,
      URLSearchParams,
      setTimeout: (callback: () => void) => { const id = ++nextTimer; timers.set(id, callback); return id; },
      clearTimeout: (id: number) => timers.delete(id),
      setInterval: () => 1,
      clearInterval: () => {}
    });
    return { element, timers, sockets };
  }

  test('conecta direto pelo endereço, sem pareamento', () => {
    expect(script).toBeDefined();
    expect(html).not.toContain('api/pair');
    const { sockets, element } = load();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('ws://192.168.1.2:38800/ws');
    // Nenhuma mensagem de autenticação: o computador envia o estado assim que a conexão abre.
    expect(sockets[0].sent).toEqual([]);
    sockets[0].readyState = 1;
    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'state', state: { mobile: [], physical: [], folders: [] } }) });
    expect(element('status').textContent).toBe('Conectado');
  });

  test('estados dos botões chegam junto do estado e em mensagens próprias', () => {
    const { sockets, element } = load();
    sockets[0].readyState = 1;
    const send = (message: unknown) => sockets[0].onmessage?.({ data: JSON.stringify(message) });
    send({ type: 'state', state: { mobile: [], physical: [], folders: [] }, states: { 'm:0:1': { tone: 'live', icon: 'stop' } } });
    send({ type: 'states', states: { 'm:0:1': { tone: 'warn', icon: 'stop' } } });
    send({ type: 'states', states: {} });
    // Mensagens de estado não derrubam a conexão nem mostram erro.
    expect(element('status').textContent).toBe('Conectado');
    expect(element('connection-detail').textContent).toBe('');
  });

  test('reconexões não criam dois WebSockets', () => {
    const { sockets, timers } = load();
    sockets[0].close();
    sockets[0].onclose?.({ code: 1006, reason: '' }); // fechamento repetido do mesmo socket
    expect(timers.size).toBe(1);
    const reconnect = [...timers.values()][0];
    reconnect();
    expect(sockets).toHaveLength(2);
    reconnect(); // callback antigo disparado de novo pelo navegador
    expect(sockets).toHaveLength(2);
    expect(sockets[1].url).toBe('ws://192.168.1.2:38800/ws');
  });
});
