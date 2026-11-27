/** A shared, pure normalizer for member voice searches in browser and server. */
export function spokenMemberQuery(input: string) {
  // Voice commands are optional: do not strip a real surname like "De Luca".
  // Only strip grammatical prefixes once an explicit search/open intent exists.
  // Match command grammar accent-insensitively without altering real names.
  // Normalizing a *name* would lose accents in the UI and could change identity.
  let value = input.trim().replace(/^[¿¡\s]+|[?.!\s]+$/g, "");
  const commandPatterns = [
    /^(?:por favor|per favore)\s*,?\s*/iu,
    /^(?:(?:puedes|potresti|puoi)\s+)?(?:(?:quiero|necesito|vorrei|voglio)\s+(?:que\s+)?)?(?:abre|abrir|apri|apre|busca|buscar|buscame|cerca|trova|encuentra|encuentrame|encontrar|mostrar|mostra|muestrame|ver|vedere|cercare|trovare)\s+/iu,
    /^(?:a|al)\s+/iu,
    /^(?:(?:la|el|lo|il|una|un)\s+)?(?:(?:ficha|scheda|perfil|profile|datos|dati)\s+)?(?:(?:del|de|della|di|al)\s+)?(?:socio|socia|soci|miembro|member)\s+(?:(?:de\s+nombre|di\s+nome)\s+)?/iu,
    /^(?:(?:la|el)\s+)?(?:ficha|scheda|perfil|profile)\s+(?:del|de|di)\s+/iu,
    /^(?:que\s+se\s+llama|che\s+si\s+chiama|llamado|llamada|de\s+nombre|di\s+nome|nombre)\s+/iu,
  ];
  // Convert the grammar to an accent-insensitive matching shadow while
  // removing an equivalent number of original Unicode characters.
  const unaccented = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  value = value.replace(/^(?:por favor|per favore)\s*,?\s*/iu, "");
  const original = value;
  const command = commandPatterns[1].exec(unaccented(value));
  if (!command) return original;
  value = value.slice([...unaccented(value).slice(0, command[0].length)].length);
  for (const rx of commandPatterns.slice(2)) {
    const shadow = unaccented(value);
    const match = rx.exec(shadow);
    if (match) value = value.slice(match[0].length);
  }
  return value.trim();
}
