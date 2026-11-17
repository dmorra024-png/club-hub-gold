import { createFileRoute } from "@tanstack/react-router";
import QRCode from "qrcode";

// Public PNG endpoint used by member QR emails so the code renders inline in inbox clients.
// The payload is only the socio number (e.g. "0000123"), meaningful only inside the software.
export const Route = createFileRoute("/api/public/qr/$code")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const raw = String(params.code || "").replace(/\.png$/i, "");
        const safe = raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
        if (!safe) return new Response("Bad code", { status: 400 });
        try {
          const dataUrl = await QRCode.toDataURL(`SNOOP:${safe}`, {
            margin: 1,
            width: 480,
            color: { dark: "#39FF14", light: "#0a0a0a" },
          });
          const b64 = dataUrl.split(",")[1] ?? "";
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return new Response(bytes, {
            status: 200,
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          });
        } catch (e) {
          return new Response("QR error", { status: 500 });
        }
      },
    },
  },
});
