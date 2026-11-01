// Atalhos de DOM usados pela interface inteira.
export const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector(selector) as T;

// h(): cria elementos com atributos, handlers "on…" tipados e filhos; nulos e false são descartados.
export type Child = Node | string | null | undefined | false | Child[];
type EventProps = { [K in keyof HTMLElementEventMap as `on${K}`]?: (event: HTMLElementEventMap[K]) => void };
type Props = EventProps & Record<string, unknown>;
const flatten = (children: Child[]): (Node | string)[] =>
  children.flatMap(child => Array.isArray(child) ? flatten(child) : child == null || child === false ? [] : [child]);
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') element.className = String(value);
    else if (key === 'value') (element as HTMLInputElement).value = String(value);
    else if (key.startsWith('on')) element.addEventListener(key.slice(2), value as EventListener);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  element.append(...flatten(children));
  return element;
}
export const inputValue = (event: Event) => (event.target as HTMLInputElement).value;
