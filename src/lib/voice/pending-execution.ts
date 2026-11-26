const prefix = "snoop:voice-pending:";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
/** Only an opaque operation UUID is kept, not a token, transcript, draft or member data. */
export function pendingExecution(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  owner: string,
) {
  const key = prefix + owner;
  return {
    read() {
      try {
        const id = storage.getItem(key);
        return id && uuid.test(id) ? id : null;
      } catch {
        return null;
      }
    },
    save(id: string) {
      if (!uuid.test(id)) throw Error("VOICE_PENDING_ID_INVALID");
      try {
        storage.setItem(key, id);
      } catch {}
    },
    clear(id: string) {
      try {
        if (storage.getItem(key) === id) storage.removeItem(key);
      } catch {}
    },
  };
}
