import {
  parseAdministrativeDictation,
  spokenAdministrativeDate,
  isAdult,
  type MemberDictation,
} from "./member-administration.ts";
export type ConversationState = {
  awaiting: "name" | "first" | "last" | "birth" | "phone" | "optional" | "review";
};
export type ConversationReply = {
  handled: boolean;
  patch: Partial<MemberDictation>;
  state: ConversationState;
  message: string;
  summary?: string;
};
export function memberAwaiting(values: Partial<MemberDictation>): ConversationState {
  return {
    awaiting:
      !values.first_name && !values.last_name
        ? "name"
        : !values.first_name
          ? "first"
          : !values.last_name
            ? "last"
            : !values.birth_date
              ? "birth"
              : !values.phone
                ? "phone"
                : "optional",
  };
}
export function memberQuestion(values: Partial<MemberDictation>, it = false): string {
  if (!values.first_name && !values.last_name)
    return it ? "Dimmi nome e cognome." : "Dime nombre y apellidos.";
  if (!values.first_name) return it ? "Qual è il nome?" : "¿Cuál es el nombre?";
  if (!values.last_name) return it ? "Cognome?" : "¿Apellidos?";
  if (!values.birth_date) return it ? "Data di nascita?" : "¿Fecha de nacimiento?";
  if (!values.phone) return it ? "Vuoi aggiungere un telefono?" : "¿Quieres añadir un teléfono?";
  return it
    ? "Vuoi aggiungere altri dati? Puoi dire riepilogo."
    : "¿Otros datos? Puedes decir resumen.";
}
const normalize = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/** Session-local form dialogue. Never calls a provider, writes storage or saves. */
export function memberConversation(
  state: ConversationState,
  raw: string,
  current: Partial<MemberDictation>,
  plans: string[],
  it = false,
): ConversationReply {
  const text = raw.trim().replace(/^[¿¡]|[.!?]+$/g, "");
  const n = normalize(text);
  const unchanged = (message = ""): ConversationReply => ({
    handled: !!message,
    patch: {},
    state,
    message,
  });
  if (!text || text.length > 1200) return unchanged();
  if (
    /^(?:un momento|un segundo|espera|aspetta|un attimo|non so|no se|no lo se|gracias|grazie)$/.test(
      n,
    )
  )
    return unchanged(
      it
        ? "Quando vuoi, ripeti il dato. Non ho cambiato nulla."
        : "Cuando quieras, repite el dato. No he cambiado nada.",
    );
  if (
    /^(?:resumen|riepilogo|revisar|rivedi|confirmar|confirma|conferma|guardar|salva|si|sí|no|listo|hecho|basta|finito)$/i.test(
      text,
    )
  ) {
    return {
      handled: true,
      patch: {},
      state: { awaiting: "review" },
      summary:
        [current.first_name, current.last_name].filter(Boolean).join(" ") +
        " · " +
        (current.birth_date || (it ? "Data mancante" : "Fecha pendiente")) +
        (current.city ? " · " + current.city : ""),
      message: it
        ? "Rivedi i dati nel modulo. Per salvare usa il pulsante del modulo."
        : "Revisa los datos del formulario. Para guardar usa su botón.",
    };
  }
  // Route commands are handled by the existing permission-aware controller, never mistaken for names.
  if (
    /\b(?:buscar|busca|cerca|crear|crea|abrir|abre|apri|terminar|stop|detener|producto|prodotto|caja|stock|inventario|pedido)\b/i.test(
      n,
    )
  )
    return unchanged();
  let prepared = text
    .replace(/\b(?:anzi|más bien)\s*,?\s*/gi, ", ")
    .replace(
      /\b(?:cambia|modifica|corrige|correggi)\s+(?:il|el|la)?\s*(cognome|apellido|nombre|nome)\s+(?:in|a)\s+/gi,
      ", $1 ",
    )
    .replace(/\bnaci[oó]\s+(?:el\s+)?/i, "fecha de nacimiento ")
    .replace(/\b(?:a[nñ]ade|agrega|a[nñ]adir|aggiungi)\s+(?:la\s+)?(?:cuota|quota)\s+/i, "cuota ")
    .replace(/\b(cuota|quota|plan)\s+semestrale\b/i, "$1 semestral");
  const clearPhone =
    /\b(?:deja|dejar|lascia)\s+(?:el|il)?\s*(?:telefono|teléfono)\s+(?:vacio|vacío|vuoto)\b/i.test(
      text,
    );
  if (clearPhone)
    prepared = prepared.replace(
      /\b(?:deja|dejar|lascia)\s+(?:el|il)?\s*(?:telefono|teléfono)\s+(?:vacio|vacío|vuoto)\s*(?:y|e)?/i,
      "",
    );
  let patch: Partial<MemberDictation> = parseAdministrativeDictation(prepared, plans);
  if (state.awaiting === "birth" && !patch.birth_date) {
    const prefix = text
      .split(/\s*,?\s*\b(?:vive|reside|ciudad|città|residente)\b/i)[0]
      .replace(/[,;]\s*$/g, "");
    const date = spokenAdministrativeDate(prefix);
    if (date) patch.birth_date = date;
  }
  if (state.awaiting === "phone" && !patch.phone) {
    const prefix = prepared
      .replace(/^(?:s[iíì]|vale|ok)[\s,]+/i, "")
      .split(/[.,;]/)[0]
      .trim();
    if (/^\+?[\d\s]{6,20}$/.test(prefix)) {
      const phone = parseAdministrativeDictation(`teléfono ${prefix}`).phone;
      if (phone) patch.phone = phone;
    }
  }
  if (clearPhone) patch.phone = "";
  const missingPlan = /\b(?:cuota|quota|plan)\s+/i.test(prepared) && !patch.plan_name;
  const planWarning = it
    ? "Quota non identificata: selezionala nel modulo."
    : "Cuota no identificada: selecciónala en el formulario.";
  // Bare replies are interpreted ONLY as the field the assistant just requested.
  if (!Object.keys(patch).length && ["name", "first", "last"].includes(state.awaiting)) {
    const parts = text.split(/\s+/);
    const reserved =
      /\b(?:quiero|vorrei|hola|bueno|vale|puedes|gracias|no|si|sì|tal|vez|por|favor|como|que|hace|esto|algo|cualquier|test|prueba|socios|nombre|apellido|guardar|confirmar|salva|annulla|elimina|buenas|buenos|dias|tardes|ciao|ayuda|aiuto)\b/i;
    const valid =
      parts.length >= 1 &&
      parts.length <= 8 &&
      text.length <= 120 &&
      !reserved.test(n) &&
      parts.every((p) => /^[\p{L}][\p{L}'’-]*$/u.test(p));
    if (valid && state.awaiting === "name" && parts.length === 2)
      patch = { first_name: parts[0], last_name: parts[1] };
    else if (valid && state.awaiting === "name" && parts.length > 2)
      return {
        handled: true,
        patch: {},
        state: { awaiting: "first" },
        message: it
          ? "Qual è solo il nome, anche composto?"
          : "Dime solo el nombre, puede ser compuesto.",
      };
    else if (valid && state.awaiting === "first") patch = { first_name: text };
    else if (valid && state.awaiting === "last") patch = { last_name: text };
  }
  if (!Object.keys(patch).length && state.awaiting === "birth") {
    const date = spokenAdministrativeDate(text);
    if (date) patch.birth_date = date;
  }
  if (patch.birth_date && !isAdult(patch.birth_date))
    return unchanged(
      it
        ? "Data non valida per un socio maggiorenne. Ripeti la data."
        : "Fecha no válida para un socio mayor de edad. Repite la fecha.",
    );
  // Drop empty decoder values, except an explicitly requested clear. Unknown plans never invent IDs.
  patch = Object.fromEntries(
    Object.entries(patch).filter(([k, v]) => v || (k === "phone" && clearPhone)),
  );
  if (!Object.keys(patch).length)
    return unchanged(
      missingPlan
        ? planWarning
        : it
          ? "Non ho identificato un campo. Ripeti il campo e il valore."
          : "No identifiqué un campo. Repite el campo y el valor.",
    );
  const next = { ...current, ...patch };
  return {
    handled: true,
    patch,
    state: memberAwaiting(next),
    message: missingPlan ? planWarning : memberQuestion(next, it),
  };
}
