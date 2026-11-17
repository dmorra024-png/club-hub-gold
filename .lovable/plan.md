## Nueva sección Ajustes (solo admin)

Añado una entrada **Ajustes** en el menú lateral, visible únicamente para `admin` y `super_admin`. Reorganizo lo existente y añado nuevas secciones.

### 1. Reorganización del menú

- **Quitar** del menú principal: `Cuotas` (`/piani`).
- **Quitar** de Socios: `Colaboradores` (`/soci/colaboratori`).
- **Añadir** entrada `Ajustes` (`/ajustes`) con icono engranaje, solo visible para admins.

### 2. Página `/ajustes` (índice)

Pantalla tipo dashboard con tarjetas hacia las 4 subsecciones:

- **Cuotas** → `/ajustes/cuotas` (mueve la página actual `piani.tsx`)
- **Socios** → `/ajustes/socios` (configurar campos del formulario)
- **Colaboradores** → `/ajustes/colaboradores` (mueve `soci.colaboratori.tsx`)
- **Dispositivos** → `/ajustes/dispositivos` (báscula, lector QR, tableta de firma)

Las rutas viejas (`/piani`, `/soci/colaboratori`) se quitan del routeTree.

### 3. Ajustes → Socios (configuración de campos)

Permite al admin marcar para cada campo del formulario de creación de socio:

- **Visible** (sí/no) — si no, no aparece en el wizard.
- **Obligatorio** (sí/no) — si sí, bloquea el guardado hasta completarlo.

Campos configurables: nombre, apellidos, fecha nacimiento, DNI, dirección, ciudad, código postal, teléfono, email, foto DNI, firma, plan.

Algunos campos quedan **siempre obligatorios** y no editables: nombre, apellidos, número socio (auto).

Guardado en una tabla nueva `club_member_field_config` (una fila por club). El formulario `soci.nuovo.tsx` lee esta config y muestra/valida según corresponda.

### 4. Ajustes → Dispositivos

Pantalla que permite conectar tres dispositivos vía Web APIs del navegador (preferencias guardadas en `localStorage` por dispositivo + usuario):

- **Báscula** (Web Serial API o Bluetooth) — selección del puerto, prueba de lectura en gramos, mostrar peso en vivo. Una vez emparejada, en la página de pedido aparecerá un botón "Leer báscula" que rellena el peso.
- **Lector QR / código de barras** (USB HID que actúa como teclado, o cámara) — toggle "lector externo conectado" y test (captura el siguiente código escaneado en cualquier input). En la búsqueda de socios añade compatibilidad automática.
- **Tableta de firma digital** (Web HID / Bluetooth si disponible, o fallback al `SignaturePad` con pointer events de un iPad/Wacom) — emparejamiento y test de trazo.

El soporte real depende del navegador: Chrome/Edge ofrecen Web Serial y Web HID. Lo dejo claro en la UI con un aviso si la API no está disponible.

### 5. Cambios técnicos

- Migración: tabla `club_member_field_config` (club_id, field_key, visible bool, required bool, sort_order). RLS: lectura por miembros del club, escritura solo admin/super_admin. GRANT correspondiente.
- Nuevas rutas: `src/routes/_authenticated/ajustes.index.tsx`, `ajustes.cuotas.tsx`, `ajustes.socios.tsx`, `ajustes.colaboradores.tsx`, `ajustes.dispositivos.tsx`.
- Mover contenido: `piani.tsx` → `ajustes.cuotas.tsx`; `soci.colaboratori.tsx` → `ajustes.colaboradores.tsx`. Borrar los originales.
- `SnoopLayout.tsx`: quitar Cuotas, añadir Ajustes con `show: a => a.isAdmin`.
- `soci.index.tsx`: quitar tarjeta Colaboradores.
- `soci.nuovo.tsx`: leer `club_member_field_config` y renderizar/validar dinámicamente.
- `index.tsx` (home): quitar el tile Cuotas.
- Nuevo hook `useDeviceSettings` para báscula/QR/firma con detección de disponibilidad de Web Serial/HID.

### Notas

- Los dispositivos físicos sólo funcionan en navegadores compatibles (Chrome/Edge desktop o Android). En iOS la Web Serial/HID no existe — mostraré aviso y dejaré el flujo manual como fallback.
- No toco la lógica de pedido/caja ahora; añadiré botones "Leer báscula" en una siguiente iteración si confirmas el emparejamiento.
