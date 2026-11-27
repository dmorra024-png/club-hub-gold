/** Interpret explicit delta commands, never save stock without a human confirmation. */
export type VoiceStockMovement = { name: string; delta: number };
const ADD = "anade|anadir|agrega|agregar|suma|sumar|aumenta|aumentar|incrementa|incrementar|aggiungi|aggiungere|metti|pon|mas|\\+";
const REMOVE = "quita|quitar|resta|restar|saca|sacar|retira|retirar|disminuye|disminuir|togli|togliere|rimuovi|meno|menos|-";
const OP = "(?:" + ADD + "|" + REMOVE + ")";
const NUM = "(\\d{1,7}(?:[.,]\\d{1,2})?)";
const UNIT = "(?:\\s*(?:gramos?|grammi|gr|g|unidades?|unidad|unita|u))?";
const patterns = [
  new RegExp("^(?:stock\\s+)?(.+?)\\s+(" + OP + ")\\s+" + NUM + UNIT + "$", "i"),
  new RegExp("^(?:stock\\s+)?(" + OP + ")\\s+" + NUM + UNIT + "\\s+(?:(?:al|a|del|de|da|en|nel|su)\\s+)?(.+)$", "i"),
  new RegExp("^(?:stock\\s+)?" + NUM + UNIT + "\\s+(" + OP + ")\\s+(.+)$", "i"),
  new RegExp("^(" + OP + ")\\s+(?:(?:el|lo|il)\\s+)?stock\\s+(?:(?:de|del|di)\\s+)?(.+?)\\s+(?:(?:en|de|por|di)\\s+)?" + NUM + UNIT + "$", "i"),
];
const positive = new RegExp("^(?:" + ADD + ")$", "i");
function normalize(raw: string) {
  return raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.!?;:]+$/g, "").replace(/\s+/g, " ").trim()
    .replace(/^(?:snoop\s*[,:\s]+)?/, "")
    .replace(/^(?:(?:por favor|per favore)\s*[,:\s]+)?/, "")
    .replace(/^(?:stock\s+){2,}/, "stock ");
}
export function parseVoiceStockMovement(raw: string): VoiceStockMovement | null {
  const spoken = normalize(raw);
  for (let i = 0; i < patterns.length; i++) {
    const m = patterns[i].exec(spoken);
    if (!m) continue;
    const [operation, quantity, name] = i === 0
      ? [m[2], m[3], m[1]]
      : i === 1
        ? [m[1], m[2], m[3]]
        : i === 2
          ? [m[2], m[1], m[3]]
          : [m[1], m[3], m[2]];
    const amount = Number(quantity.replace(",", "."));
    const target = name.replace(/^(?:el|la|lo|il|los|las)\s+/, "")
      .replace(/^(?:stock\s+)?(?:de|del|di)\s+/, "").trim();
    if (!target || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000)
      return null;
    return { name: target, delta: (positive.test(operation) ? 1 : -1) * amount };
  }
  return null;
}
