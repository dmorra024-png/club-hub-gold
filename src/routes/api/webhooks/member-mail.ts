import { createFileRoute } from "@tanstack/react-router";
import { dedicatedMailClient, verifyMailEvent } from "@/lib/member-mail-worker.server";
export const Route = createFileRoute("/api/webhooks/member-mail")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = (globalThis as any).__env__ ?? process.env;
        try {
          const reader = request.body?.getReader();
          if (!reader) return new Response("Empty", { status: 400 });
          let text = "",
            bytes = 0;
          const decoder = new TextDecoder();
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              bytes += value.length;
              if (bytes > 65536) return new Response("Too large", { status: 413 });
              text += decoder.decode(value, { stream: true });
            }
          } finally {
            await reader.cancel();
          }
          text += decoder.decode();
          const event = verifyMailEvent(text, request.headers, env.SNOOP_MAIL_WEBHOOK_SECRET);
          const { error } = await dedicatedMailClient(env).rpc(
            "snoop_confirm_member_mail" as any,
            { p_event: event.id, p_provider: event.provider, p_type: event.type } as any,
          );
          if (error) return new Response("Unavailable", { status: 503 });
          return Response.json({ accepted: true });
        } catch {
          return new Response("Webhook not accepted", { status: 401 });
        }
      },
    },
  },
});
