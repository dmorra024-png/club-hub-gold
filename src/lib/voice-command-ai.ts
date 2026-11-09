/** Closed vocabulary: no names, dates, numbers, catalogue values or conversation history leave the device. */
const vocabulary = new Set(
  "hola snoop por favor quiero quisiera me gustaria puedes podria ir a la el los las un una de del para pantalla seccion donde dar alta nuevo nueva crear registrar socio socios miembro miembros producto productos buscar abrir ver mostrar consultar caja informe informes inventario stock inicio home ajustes perfil vorrei posso vai alla al alla schermata sezione creare registra nuovo nuova soci cerca aprire apri vedere cassa report impostazioni".split(
    " ",
  ),
);
export const safeCommands = [
  "Crear socio",
  "Buscar socio",
  "Crear producto",
  "Ver stock",
  "Abrir caja",
  "Ver caja de hoy",
  "Inicio",
  "Ajustes",
] as const;
export function safeVoiceCommand(text: unknown): string | null {
  if (typeof text !== "string" || text.length > 180) return null;
  const normalized = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  if (!/^[a-z\s]+$/.test(normalized)) return null;
  const words = normalized.split(/\s+/);
  return words.length > 0 && words.every((w) => vocabulary.has(w)) ? normalized : null;
}
export function validatedCommandProposal(value: unknown): (typeof safeCommands)[number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  return Object.keys(entry).length === 1 && safeCommands.includes(entry.command as any)
    ? (entry.command as (typeof safeCommands)[number])
    : null;
}
