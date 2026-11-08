import { defineTask } from "nitro/task";
import { runDedicatedMemberMail } from "../../src/lib/member-mail-worker.server";
export default defineTask({
  meta: { description: "Dedicated SNOOP member-card outbox; one message per run" },
  async run() {
    const env = (globalThis as any).__env__ ?? process.env;
    try {
      return { result: await runDedicatedMemberMail(env) };
    } catch {
      return { result: { processed: 0, blocked: true } };
    }
  },
});
