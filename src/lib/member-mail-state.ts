export function memberMailLabel(state: string) {
  return (
    (
      {
        pending: "Pendiente de envío",
        sending: "Procesando envío",
        accepted: "Enviado: aceptado por el proveedor, entrega no confirmada",
        delivered: "Entregado: confirmado por el proveedor",
        error: "Error de envío",
        unknown: "Resultado incierto: reconciliar antes de otro intento",
        not_requested: "Sin solicitud en la nueva cola; historial anterior no verificado",
      } as Record<string, string>
    )[state] ?? "Estado no verificado"
  );
}
