export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
// Sem acentos e em minúsculas, para a busca encontrar "midia" em "Multimídia".
export const normalize = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
