import { supabase } from "../integrations/supabase/client";
import { parseAccountAccess, type AccountAccess } from "./access-context";
export async function authDeadline<T>(request: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(request),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error("No se pudo verificar la sesión. Comprueba la conexión y reintenta.")),
          12000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
const pending = new Map<string, Promise<AccountAccess>>();
export function verifiedAccess(uid: string): Promise<AccountAccess> {
  if (pending.has(uid)) return pending.get(uid)!;
  const request = authDeadline(supabase.rpc("snoop_access_context"))
    .then(({ data, error }) => {
      if (error) throw new Error("No se pudo verificar el acceso del club. Reintenta.");
      return parseAccountAccess(data);
    })
    .finally(() => {
      if (pending.get(uid) === request) pending.delete(uid);
    });
  pending.set(uid, request);
  return request;
}
