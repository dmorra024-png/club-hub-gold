/** A shared, pure normalizer for member voice searches in browser and server. */
export function spokenMemberQuery(input: string) {
  // Voice commands are optional: do not strip a real surname like "De Luca".
  // Only strip grammatical prefixes once an explicit search/open intent exists.
  let value = input.trim().replace(/^[¿¡\s]+|[?.!\s]+$/g, "");
  value = value.replace(/^(?:(?:por favor|per favore)\s*,?\s*)/iu, "");
  const intent = /^(?:(?:puedes|potresti|puoi)\s+)?(?:(?:quiero|necesito|vorrei|voglio)\s+(?:que\s+)?)?(?:abre|abrir|apri|apre|busca|buscar|búscame|cerca|trova|encuentra|encontrar|mostrar|mostra|muéstrame|ver|vedere|cercare|trovare)\s+/iu;
  const started = intent.test(value);
  if (!started) return value;
  value = value.replace(intent, "").replace(/^(?:a|al)\s+/iu, "");
  value = value.replace(/^(?:(?:la|el|lo|il|una|un)\s+)?(?:(?:ficha|scheda|perfil|profile|datos|dati)\s+)?(?:(?:del|de|della|di|al)\s+)?(?:socio|socia|soci|miembro|member)\s+(?:(?:de\s+nombre|di\s+nome)\s+)?/iu, "");
  value = value.replace(/^(?:(?:la|el)\s+)?(?:ficha|scheda|perfil|profile)\s+(?:del|de|di)\s+/iu, "");
  value = value.replace(/^(?:que\s+se\s+llama|che\s+si\s+chiama|llamado|llamada|de\s+nombre|di\s+nome|nombre)\s+/iu, "");
  return value.trim();
}
