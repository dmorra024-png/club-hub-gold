import { supabase } from "@/integrations/supabase/client";

export function formatPrice(cents: number) {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

export function daysBetween(from: Date, to: Date) {
  const ms = to.getTime() - from.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function expiryBadge(expiresAt: string | Date): { label: string; color: string; days: number } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  const days = daysBetween(today, exp);
  if (days < 0) return { label: `Caducada (${Math.abs(days)} d)`, color: "bg-destructive/20 text-destructive border-destructive/40", days };
  if (days <= 7) return { label: `${days} d`, color: "bg-orange-500/15 text-orange-300 border-orange-500/40", days };
  if (days <= 30) return { label: `${days} d`, color: "bg-yellow-500/15 text-yellow-300 border-yellow-500/40", days };
  return { label: `${days} d`, color: "bg-neon/10 text-neon border-neon/40", days };
}

export async function uploadToSnoopDocs(file: Blob, path: string): Promise<string> {
  const { error } = await supabase.storage.from("snoop-docs").upload(path, file, {
    upsert: true,
    contentType: file.type || "image/png",
  });
  if (error) throw error;
  return path;
}

export async function signedUrl(path: string, expiresIn = 3600) {
  const { data, error } = await supabase.storage.from("snoop-docs").createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

export async function compressImage(file: File, maxDim = 1280, quality = 0.82): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("compress failed"))), "image/jpeg", quality);
  });
}

export const CONTRACT_VERSION = "v1-es-2025";

export const CONTRACT_TEXT_ES = `CONTRATO DE ADHESIÓN — ASOCIACIÓN PRIVADA SNOOP

1. NATURALEZA DE LA ASOCIACIÓN
La Asociación es una entidad privada sin ánimo de lucro inscrita conforme a la legislación española vigente, con domicilio social en España. Su objeto es agrupar a personas adultas consumidoras de cannabis y reducir los riesgos derivados del consumo, en el marco del Código Penal español (arts. 368 y ss.) y de la jurisprudencia del Tribunal Supremo sobre consumo compartido en ámbito privado.

2. CONDICIONES DEL SOCIO
2.1. El socio declara ser mayor de 18 años y consumidor habitual de cannabis con anterioridad a su ingreso.
2.2. El socio aporta sus datos personales reales y un documento de identidad válido, cuyos datos se conservarán conforme al Reglamento (UE) 2016/679 (RGPD) y la Ley Orgánica 3/2018, de protección de datos personales.
2.3. La condición de socio es personal e intransferible.

3. NORMAS INTERNAS
3.1. Está prohibido consumir cannabis fuera de las instalaciones de la Asociación.
3.2. Está prohibido revender, regalar o ceder cannabis a terceros, dentro o fuera del local.
3.3. Está prohibida la entrada a menores de edad y la presencia de cualquier sustancia ilegal distinta del cannabis destinado al consumo compartido.
3.4. El socio se compromete a respetar al resto de socios, al personal y a las normas de convivencia del local.
3.5. El incumplimiento de cualquiera de estas normas conlleva la baja inmediata y, en su caso, la denuncia ante las autoridades competentes.

4. CUOTAS Y APORTACIONES
4.1. El socio abona una cuota periódica destinada al sostenimiento de la Asociación.
4.2. La aportación no constituye en ningún caso compraventa de sustancia, sino contribución al cultivo colectivo y a los gastos comunes.

5. PROTECCIÓN DE DATOS (RGPD / LOPDGDD)
5.1. Responsable del tratamiento: la Asociación Snoop.
5.2. Finalidad: gestión de la condición de socio, control de acceso al local y cumplimiento de obligaciones legales.
5.3. Base jurídica: ejecución del presente contrato (art. 6.1.b RGPD) e interés legítimo (art. 6.1.f RGPD).
5.4. Conservación: durante la vigencia de la asociación más el plazo legal aplicable.
5.5. Derechos: el socio puede ejercer en cualquier momento sus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a la dirección de la Asociación.

6. ACEPTACIÓN
Firmando este documento, el socio declara haber leído, comprendido y aceptado íntegramente las normas de la Asociación, las condiciones de admisión y la política de protección de datos.`;
