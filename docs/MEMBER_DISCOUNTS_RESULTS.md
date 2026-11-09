# Descuentos de socios — implementación sobre 79b00ff1555d

## Alcance

- Ajustes → Socios → Crear descuentos, dentro de la pantalla existente; diseño y tarjetas SNOOP, sin rutas ni menús adicionales.
- Nombre, porcentaje exacto (0,01–100 %, hasta dos decimales), edición, activación/desactivación y fechas de validez opcionales e inclusivas.
- Asignación o retirada desde la ficha existente. La ficha muestra el nombre, porcentaje y estado: activo, programado, caducado o inactivo. Desactivar no elimina asignaciones.
- Administradores gestionan; colaboradores con `manage_members` solamente consultan. Super Admin no accede a este contenido privado.
- No se aplican automáticamente a cuotas, pedidos o aportaciones. No se modifican planes aprobados ni registros financieros. Antes de habilitar aplicación económica se necesitan reglas asociativas aprobadas y evaluación jurídica de la operación concreta; no se presume su licitud.
- `Historial de pedidos` continúa embebido en la ficha del socio, con sus permisos anteriores; sin página nueva.

## SQL propuesto, NO ejecutado en Supabase

`docs/sql/SNOOP_MEMBER_DISCOUNTS_PROPOSED.sql` es la única migración nueva: una transacción con dos tablas nuevas, siete políticas RLS explícitas, claves foráneas por club y validación de asignaciones. Crea un índice único sobre `(id,club_id)` de socios, sin actualizar filas existentes. No cambia ninguna política existente, importe, cuenta o permiso. No borra registros. La eliminación de descuentos está denegada: se desactivan.

Dependencias: esquema inicial SNOOP y `20261106150000_platform_club_separation.sql` (funciones `current_club_id`, `can_operate_club`, `is_current_user_club_admin`). Si falta una dependencia o una tabla ya existe, la transacción falla; no pretende reaplicarse. Hasta su activación autorizada, la interfaz informa de que la función está pendiente sin bloquear la ficha ni el historial.

## Pruebas realizadas con datos sintéticos

- Suite completa: 250/250 PASS, incluidos dos tests nuevos de porcentajes/fechas y PostgreSQL/PGlite.
- PostgreSQL local con el esquema inicial y separación multi-club: aplicación de la propuesta; administrador A/B; lectura de colaborador autorizado; denegación a otro club, colaborador sin permiso y Super Admin; rechazo de modificaciones de colaborador, asignación cruzada, porcentaje inválido, fechas invertidas y borrado de descuentos; desactivación y conservación de planes originales. Inspección de las siete políticas finales.
- `test:discounts:browser`: seis casos PASS en Chromium viewport Samsung y WebKit iPhone, con API interceptada: crear/editar/activar/desactivar, fechas, asignar/retirar/reasignar, error y reintento con conservación del formulario, permisos de colaborador, esquema aún no activado, historial embebido y ausencia de desbordamiento horizontal. Ninguna petición accede a Supabase real.
- Regresión de registros administrativos: seis casos PASS (administrador, colaborador y sin permisos económicos en ambos navegadores).
- Regresión de socios PASS: inscripción sintética, duplicados, renovación cancelada/confirmada, QR y borrador AI sin guardado automático.
- TypeScript y build de producción PASS.
- Evidencias: `MEMBER_DISCOUNTS_BROWSER_RESULTS.json` y `discounts-{samsung,iphone-webkit}-{settings,member}.png`.

## Límites y activación pendiente

No hay prueba en dispositivos físicos ni activación en base remota. Para utilizarlo online faltan autorización y aplicación de la única migración propuesta, y posteriormente autorización de publicación. No se ha realizado merge, deployment, cambio de secretos ni acceso a Security PSG.
