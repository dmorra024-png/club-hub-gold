/**
 * Backwards-compatible static SNOOP card decoder. Never treat an arbitrary
 * URL/string as a member number or accept a QR for another club.
 * The resulting number must still be resolved under the authenticated club.
 */
export function decodeLegacyMemberQr(value: string): string | null {
  if (typeof value !== "string" || value.length > 350) return null;
  let text = value.trim();
  if (!text) return null;

  // Historical SNOOP card emails used an image URL; accept only a known
  // exact route, not a query parameter, redirect or arbitrary hostname.
  if (/^https:\/\//i.test(text)) {
    let u: URL;
    try { u = new URL(text); } catch { return null; }
    if (!["snoop-pilot.dmorra024.workers.dev"].includes(u.hostname) ||
        u.username || u.password || u.port || u.search || u.hash) return null;
    const route = u.pathname.match(/^\/api\/public\/qr\/([0-9]{1,12})(?:\.png)?\/?$/i);
    if (!route) return null;
    text = "SNOOP:" + route[1];
  }
  const tagged = text.match(/^SNOOP\s*[:#-]\s*([0-9]{1,12})$/i);
  if (tagged) return tagged[1].padStart(7,"0");
  const plain = text.replace(/[\s\u00a0]/g,"");
  if (!/^\d{6,12}$/.test(plain)) return null;
  return plain.padStart(7,"0");
}

/** Match only a unique exact member number; never guess someone else's card. */
export function matchLegacyMember<T extends {member_number:string}>(rows:T[],decoded:string):T|null{
  const matches=rows.filter(row=>row.member_number===decoded);
  return matches.length===1?matches[0]:null;
}
