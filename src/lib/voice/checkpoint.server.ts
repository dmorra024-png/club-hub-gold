import { ConversationMemory } from "../snoop-conversation.ts";
import { z } from "zod";
const Snapshot = z
  .object({
    owner: z.string().max(80),
    club: z.string().max(80),
    expires: z.number(),
    turn: z.number().int().nonnegative(),
    memory: ConversationMemory.optional(),
    history: z
      .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(1200) }))
      .max(10),
  })
  .strict();
export type VoiceSnapshot = z.infer<typeof Snapshot>;
async function key(secret: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("snoop-voice-resume-v1:" + secret),
  );
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const encode = (x: Uint8Array) =>
  btoa(String.fromCharCode(...x))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
function decode(x: string) {
  return Uint8Array.from(atob(x.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
}
export async function sealVoiceSnapshot(value: VoiceSnapshot, secret: string) {
  const v = Snapshot.parse(value);
  while (new TextEncoder().encode(JSON.stringify(v)).byteLength > 16000 && v.history.length)
    v.history.shift();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(secret),
    new TextEncoder().encode(JSON.stringify(v)),
  );
  return encode(iv) + "." + encode(new Uint8Array(data));
}
export async function openVoiceSnapshot(
  token: string,
  secret: string,
  owner: string,
  club: string,
  now = Date.now(),
) {
  if (token.length > 24000) throw Error("VOICE_RESUME_INVALID");
  try {
    const [iv, data, ...rest] = token.split(".");
    if (rest.length) throw Error();
    const bytes = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decode(iv) },
      await key(secret),
      decode(data),
    );
    const v = Snapshot.parse(JSON.parse(new TextDecoder().decode(bytes)));
    if (v.owner !== owner || v.club !== club || v.expires <= now || v.expires > now + 43200001)
      throw Error();
    return v;
  } catch {
    throw Error("VOICE_RESUME_INVALID");
  }
}
