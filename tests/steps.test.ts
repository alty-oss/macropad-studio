import { describe, expect, test } from 'bun:test';
import { appBindingError, type BindingOf } from '../src/device/protocol.ts';
import { newStep, parseStep, stepError, stepNames, stepSummary, type StepType } from '../src/device/steps.ts';

const types = Object.keys(stepNames) as StepType[];

describe('etapas do app', () => {
  test('toda etapa nova sobrevive a salvar e ler', () => {
    for (const type of types) {
      // Um atalho novo ainda não tem tecla e não pode ser salvo; usamos um completo.
      const step = type === 'hotkey' ? { type, mods: 1, code: 0x04 } : newStep(type);
      expect(parseStep(JSON.parse(JSON.stringify(step)))).toEqual(step);
      expect(stepSummary(step).length).toBeGreaterThan(0);
    }
  });

  test('etapas sem o dado principal não podem ser gravadas', () => {
    const incomplete: StepType[] = ['open', 'website', 'text', 'hotkey', 'command', 'http', 'sound', 'counter'];
    for (const type of incomplete) expect(stepError(newStep(type))).not.toBeNull();
    for (const type of ['delay', 'media', 'window', 'system', 'mouse', 'brightness', 'player', 'voicemeeter'] as StepType[]) expect(stepError(newStep(type))).toBeNull();
    expect(stepError({ type: 'audio', target: 'app', app: '', action: 'up', amount: 5 })).toMatch(/programa/);
    expect(stepError({ type: 'obs', action: 'scene', scene: '', source: '', amount: 0 })).toMatch(/cena/);
    expect(stepError({ type: 'obs', action: 'volume', scene: '', source: 'Mic', amount: 2 })).toBeNull();
    expect(stepError({ type: 'obs', action: 'screenshot', scene: '', source: 'Mic', amount: 0 })).toMatch(/pasta/);
    expect(stepError({ type: 'http', method: 'GET', url: 'ftp://x', headers: '', body: '' })).toMatch(/http/);
  });

  test('a leitura recusa valores fora das opções e limita números', () => {
    expect(parseStep({ type: 'media', key: 'ejetar' })).toBeNull();
    expect(parseStep({ type: 'obs', action: 'explodir' })).toBeNull();
    expect(parseStep({ type: 'brightness', change: 340.6 })).toEqual({ type: 'brightness', change: 100 });
    expect(parseStep({ type: 'nada' })).toBeNull();
    // Recursos que saíram do app: arquivos antigos são importados sem essas etapas.
    expect(parseStep({ type: 'midi', port: 'loopMIDI', mode: 'add', channel: 1, control: 7, value: 2 })).toBeNull();
    expect(parseStep({ type: 'homeassistant', service: 'toggle', entity: 'light.sala' })).toBeNull();
  });
});

describe('ações do app com modo e perfis', () => {
  const base: BindingOf<'app'> = { kind: 'app', multi: true, steps: [{ type: 'delay', ms: 100 }] };

  test('modo alternar e segurar exigem a segunda lista', () => {
    expect(appBindingError({ ...base, mode: 'toggle', alt: [] })).toMatch(/segunda/);
    expect(appBindingError({ ...base, mode: 'hold', alt: [] })).toMatch(/segurar/);
    expect(appBindingError({ ...base, mode: 'hold', alt: [{ type: 'delay', ms: 1 }] })).toBeNull();
  });

  test('perfis precisam de programa e de etapas válidas', () => {
    expect(appBindingError({ ...base, profiles: [{ app: '', steps: [{ type: 'delay', ms: 1 }] }] })).toMatch(/programa/);
    expect(appBindingError({ ...base, profiles: [{ app: 'zoom.exe', steps: [] }] })).toMatch(/zoom\.exe/);
    expect(appBindingError({ ...base, profiles: [{ app: 'zoom.exe', steps: [{ type: 'hotkey', mods: 4, code: null }] }] })).toMatch(/Perfil de zoom\.exe/);
    expect(appBindingError({ ...base, profiles: [{ app: 'zoom.exe', steps: [{ type: 'hotkey', mods: 4, code: 0x19 }] }] })).toBeNull();
  });
});
