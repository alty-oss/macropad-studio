// Etapas executadas pelo app: tipos, nomes, opções dos formulários, resumo, validação e leitura
// de arquivos. O formato é o mesmo do enum Step em src-tauri/src/config.rs. Não acessa o DOM.
import { comboLabel, isKnownKey } from './keys.ts';

type Options<T extends string> = readonly (readonly [T, string])[];
const values = <T extends string>(options: Options<T>) => new Set<string>(options.map(([value]) => value));

export const mediaKeys = [['playPause', 'Tocar / pausar'], ['next', 'Próxima faixa'], ['prev', 'Faixa anterior'], ['stop', 'Parar'], ['volumeUp', 'Volume +'], ['volumeDown', 'Volume −'], ['mute', 'Silenciar']] as const;
export const audioTargets = [['mic', 'Microfone padrão'], ['output', 'Saída de som padrão'], ['app', 'Um programa']] as const;
export const audioActions = [['toggle', 'Alternar mudo'], ['mute', 'Silenciar'], ['unmute', 'Ativar som'], ['up', 'Aumentar volume'], ['down', 'Diminuir volume']] as const;
export const windowActions = [['minimize', 'Minimizar'], ['maximize', 'Maximizar / restaurar'], ['close', 'Fechar'], ['topmost', 'Sempre no topo (alternar)'], ['nextMonitor', 'Mover para o próximo monitor']] as const;
export const systemActions = [['lock', 'Bloquear o computador'], ['sleep', 'Suspender'], ['shutdown', 'Desligar'], ['restart', 'Reiniciar'], ['theme', 'Alternar tema claro / escuro']] as const;
export const mouseActions = [['left', 'Clique esquerdo'], ['right', 'Clique direito'], ['middle', 'Clique do meio'], ['scrollUp', 'Rolar para cima'], ['scrollDown', 'Rolar para baixo'], ['scrollLeft', 'Rolar para a esquerda'], ['scrollRight', 'Rolar para a direita']] as const;
export const httpMethods = [['GET', 'GET'], ['POST', 'POST'], ['PUT', 'PUT'], ['PATCH', 'PATCH'], ['DELETE', 'DELETE']] as const;
export const obsActions = [
  ['scene', 'Trocar de cena'], ['record', 'Gravação (alternar)'], ['recordStart', 'Iniciar gravação'], ['recordStop', 'Parar gravação'], ['recordPause', 'Pausar / retomar gravação'],
  ['stream', 'Transmissão (alternar)'], ['streamStart', 'Iniciar transmissão'], ['streamStop', 'Parar transmissão'], ['virtualcam', 'Câmera virtual (alternar)'],
  ['replay', 'Salvar replay buffer'], ['mute', 'Silenciar fonte de áudio (alternar)'], ['volume', 'Volume de uma fonte'], ['visibility', 'Mostrar / esconder fonte'], ['screenshot', 'Screenshot da fonte'],
  ['transition', 'Transição (Studio Mode)'], ['chapter', 'Marcador na gravação']
] as const;
export const voicemeeterModes = [['set', 'Definir o valor'], ['add', 'Somar ao valor atual'], ['toggle', 'Alternar 0 / 1']] as const;

type Value<T extends Options<string>> = T[number][0];
export type MediaKey = Value<typeof mediaKeys>;
export type ObsAction = Value<typeof obsActions>;

export type Step =
  | { type: 'open'; path: string; args: string; focus?: boolean }
  | { type: 'website'; url: string }
  | { type: 'text'; text: string; paste?: boolean }
  | { type: 'hotkey'; mods: number; code: number | null }
  | { type: 'delay'; ms: number }
  | { type: 'media'; key: MediaKey }
  | { type: 'command'; command: string; hidden: boolean }
  | { type: 'http'; method: Value<typeof httpMethods>; url: string; headers: string; body: string }
  | { type: 'audio'; target: Value<typeof audioTargets>; app: string; action: Value<typeof audioActions>; amount: number }
  | { type: 'window'; action: Value<typeof windowActions> }
  | { type: 'system'; action: Value<typeof systemActions> }
  | { type: 'mouse'; action: Value<typeof mouseActions>; amount: number }
  | { type: 'sound'; path: string }
  | { type: 'counter'; path: string; change: number }
  | { type: 'brightness'; change: number }
  | { type: 'obs'; action: ObsAction; scene: string; source: string; amount: number; path?: string }
  | { type: 'voicemeeter'; parameter: string; mode: Value<typeof voicemeeterModes>; value: number }
export type StepType = Step['type'];
export type StepOf<T extends StepType> = Extract<Step, { type: T }>;

export const stepNames: Record<StepType, string> = {
  open: 'Abrir', website: 'Site', text: 'Digitar texto', hotkey: 'Atalho', delay: 'Aguardar', media: 'Mídia', command: 'Comando',
  http: 'Requisição HTTP', audio: 'Áudio', window: 'Janela', system: 'Sistema', mouse: 'Mouse', sound: 'Tocar som', counter: 'Contador',
  brightness: 'Brilho', obs: 'OBS', voicemeeter: 'Voicemeeter'
};

export function newStep(type: StepType): Step {
  switch (type) {
    case 'open': return { type, path: '', args: '', focus: false };
    case 'website': return { type, url: '' };
    case 'text': return { type, text: '', paste: false };
    case 'hotkey': return { type, mods: 0, code: null };
    case 'delay': return { type, ms: 300 };
    case 'media': return { type, key: 'playPause' };
    case 'command': return { type, command: '', hidden: true };
    case 'http': return { type, method: 'POST', url: '', headers: '', body: '' };
    case 'audio': return { type, target: 'mic', app: '', action: 'toggle', amount: 5 };
    case 'window': return { type, action: 'minimize' };
    case 'system': return { type, action: 'lock' };
    case 'mouse': return { type, action: 'scrollDown', amount: 1 };
    case 'sound': return { type, path: '' };
    case 'counter': return { type, path: '', change: 1 };
    case 'brightness': return { type, change: 10 };
    case 'obs': return { type, action: 'record', scene: '', source: '', amount: 2, path: '' };
    case 'voicemeeter': return { type, parameter: 'Strip[0].Gain', mode: 'add', value: 2 };
  }
}

const label = <T extends string>(options: Options<T>, value: string) => options.find(([key]) => key === value)?.[1] ?? value;
const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
const host = (url: string) => url.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`;
// Etapas de OBS que agem sobre uma fonte, e as que pedem uma cena.
export const obsNeedsSource = new Set<ObsAction>(['mute', 'volume', 'visibility', 'screenshot']);
export const obsNeedsScene = new Set<ObsAction>(['scene', 'visibility']);

export function stepSummary(step: Step): string {
  switch (step.type) {
    case 'open': return step.path ? fileName(step.path) : 'Escolha um arquivo';
    case 'website': return step.url ? step.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'Informe o endereço';
    case 'text': return step.text ? `“${step.text.length > 24 ? `${step.text.slice(0, 24)}…` : step.text}”` : 'Informe o texto';
    case 'hotkey': return comboLabel(step.mods, step.code).join(' + ') || 'Escolha a combinação';
    case 'delay': return `${step.ms} ms`;
    case 'media': return label(mediaKeys, step.key);
    case 'command': return step.command || 'Informe o comando';
    case 'http': return step.url ? `${step.method} ${host(step.url)}` : 'Informe o endereço';
    case 'audio': {
      const target = step.target === 'app' ? step.app || 'programa' : step.target === 'mic' ? 'microfone' : 'som';
      const action = step.action === 'up' || step.action === 'down' ? `${step.action === 'up' ? '+' : '−'}${step.amount}%` : label(audioActions, step.action).toLowerCase();
      return `${target} · ${action}`;
    }
    case 'window': return label(windowActions, step.action);
    case 'system': return label(systemActions, step.action);
    case 'mouse': return label(mouseActions, step.action);
    case 'sound': return step.path ? fileName(step.path) : 'Escolha o arquivo';
    case 'counter': return step.change === 0 ? 'Zerar' : signed(step.change);
    case 'brightness': return `${signed(step.change)}%`;
    case 'obs': {
      if (step.action === 'scene') return step.scene || 'Escolha a cena';
      if (step.action === 'volume') return `${step.source || 'fonte'} · ${signed(step.amount)} dB`;
      if (step.action === 'screenshot') return `${step.source || 'fonte'} · PNG`;
      if (obsNeedsSource.has(step.action)) return `${label(obsActions, step.action).split(' (')[0]} · ${step.source || 'fonte'}`;
      return label(obsActions, step.action);
    }
    case 'voicemeeter': return `${step.parameter} · ${step.mode === 'toggle' ? 'alternar' : step.mode === 'add' ? signed(step.value) : step.value}`;
  }
}

// Erro que impede gravar a etapa, ou null quando ela está completa.
export function stepError(step: Step): string | null {
  switch (step.type) {
    case 'open': return step.path.trim() ? null : 'Escolha o arquivo, pasta ou programa a abrir.';
    case 'website': return step.url.trim() ? null : 'Informe o endereço do site.';
    case 'text': return step.text ? null : 'Informe o texto a digitar.';
    case 'hotkey': return isKnownKey(step.code) ? null : 'Escolha a tecla principal do atalho.';
    case 'command': return step.command.trim() ? null : 'Informe o comando a executar.';
    case 'http': return /^https?:\/\/\S+/i.test(step.url.trim()) ? null : 'Informe um endereço começando com http:// ou https://.';
    case 'audio': return step.target === 'app' && !step.app.trim() ? 'Informe o programa, como spotify.exe.' : null;
    case 'sound': return step.path.trim() ? null : 'Escolha o arquivo de som.';
    case 'counter': return step.path.trim() ? null : 'Escolha o arquivo do contador.';
    case 'obs':
      if (step.action === 'scene' && !step.scene.trim()) return 'Escolha a cena do OBS.';
      if (obsNeedsSource.has(step.action) && !step.source.trim()) return 'Escolha a fonte do OBS.';
      return step.action === 'screenshot' && !(step.path ?? '').trim() ? 'Escolha a pasta dos screenshots.' : null;
    case 'voicemeeter': return step.parameter.trim() ? null : 'Informe o parâmetro do Voicemeeter, como Strip[0].Gain.';
    default: return null;
  }
}

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
export const isByte = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 255;
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const number = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const option = <T extends string>(options: Options<T>, value: unknown): T | null => typeof value === 'string' && values(options).has(value) ? value as T : null;

// Lê uma etapa de um arquivo exportado ou da configuração do app; null se for inválida.
export function parseStep(value: unknown): Step | null {
  if (!isObject(value)) return null;
  switch (value.type) {
    case 'open': return typeof value.path === 'string' ? { type: 'open', path: value.path, args: text(value.args), focus: value.focus === true } : null;
    case 'website': return typeof value.url === 'string' ? { type: 'website', url: value.url } : null;
    case 'text': return typeof value.text === 'string' ? { type: 'text', text: value.text, paste: value.paste === true } : null;
    case 'hotkey': return isByte(value.mods) && isKnownKey(value.code as number) ? { type: 'hotkey', mods: value.mods, code: value.code as number } : null;
    case 'delay': return Number.isInteger(value.ms) && (value.ms as number) >= 0 && (value.ms as number) <= 60000 ? { type: 'delay', ms: value.ms as number } : null;
    case 'media': { const key = option(mediaKeys, value.key); return key ? { type: 'media', key } : null; }
    case 'command': return typeof value.command === 'string' ? { type: 'command', command: value.command, hidden: value.hidden !== false } : null;
    case 'http': {
      const method = option(httpMethods, value.method);
      return method && typeof value.url === 'string' ? { type: 'http', method, url: value.url, headers: text(value.headers), body: text(value.body) } : null;
    }
    case 'audio': {
      const target = option(audioTargets, value.target), action = option(audioActions, value.action);
      return target && action ? { type: 'audio', target, action, app: text(value.app), amount: Math.round(number(value.amount, 1, 100, 5)) } : null;
    }
    case 'window': { const action = option(windowActions, value.action); return action ? { type: 'window', action } : null; }
    case 'system': { const action = option(systemActions, value.action); return action ? { type: 'system', action } : null; }
    case 'mouse': { const action = option(mouseActions, value.action); return action ? { type: 'mouse', action, amount: Math.round(number(value.amount, 1, 20, 1)) } : null; }
    case 'sound': return typeof value.path === 'string' ? { type: 'sound', path: value.path } : null;
    case 'counter': return typeof value.path === 'string' ? { type: 'counter', path: value.path, change: Math.round(number(value.change, -1000, 1000, 1)) } : null;
    case 'brightness': return { type: 'brightness', change: Math.round(number(value.change, -100, 100, 10)) };
    case 'obs': {
      const action = option(obsActions, value.action);
      return action ? { type: 'obs', action, scene: text(value.scene), source: text(value.source), amount: number(value.amount, -100, 100, 2), ...(typeof value.path === 'string' ? { path: value.path } : {}) } : null;
    }
    case 'voicemeeter': {
      const mode = option(voicemeeterModes, value.mode);
      return mode && typeof value.parameter === 'string' ? { type: 'voicemeeter', parameter: value.parameter, mode, value: number(value.value, -100, 100, 0) } : null;
    }
    default: return null;
  }
}

export function parseSteps(value: unknown): Step[] | null {
  if (!Array.isArray(value)) return null;
  const steps = value.map(parseStep);
  return steps.some(step => !step) ? null : steps as Step[];
}
