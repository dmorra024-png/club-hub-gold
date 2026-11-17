import React from "react";
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Img } from "@react-email/components";
import type { TemplateEntry } from "./registry";

interface Props {
  full_name?: string;
  member_number?: string;
  club_name?: string;
  qr_url?: string;
}

const Email = ({ full_name, member_number, club_name, qr_url }: Props) => (
  <Html lang="es" dir="ltr">
    <Head />
    <Preview>Tu carnet digital de {club_name ?? "tu club"}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{club_name ?? "Tu club"}</Heading>
        <Text style={subtitle}>Carnet digital de socio</Text>

        <Text style={text}>
          Hola {full_name ?? "socio"}, ¡bienvenido!
        </Text>
        <Text style={text}>
          Este es tu código QR de acceso. Muéstralo en la entrada del club para
          registrar tu entrada y salida.
        </Text>

        <Section style={qrBox}>
          {qr_url ? <Img src={qr_url} width={240} height={240} alt="QR" style={{ display: "block", margin: "0 auto" }} /> : null}
          <Text style={memberNumber}>Nº {member_number}</Text>
        </Section>

        <Text style={footer}>
          Guarda este email. Si pierdes el QR, tu club puede reenviártelo desde tu ficha.
        </Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Tu carnet — ${d.club_name ?? "Club"}`,
  displayName: "Carnet QR socio",
  previewData: {
    full_name: "Mario Rossi",
    member_number: "0000123",
    club_name: "Meduza",
    qr_url: "https://api.qrserver.com/v1/create-qr-code/?data=SNOOP:0000123&size=240x240",
  },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "28px 24px", maxWidth: "560px", margin: "0 auto" };
const h1 = { fontSize: "26px", fontWeight: 700, color: "#0a0a0a", margin: "0 0 4px" };
const subtitle = { fontSize: "12px", letterSpacing: "0.25em", textTransform: "uppercase" as const, color: "#666", margin: "0 0 24px" };
const text = { fontSize: "15px", lineHeight: "1.6", color: "#222", margin: "12px 0" };
const qrBox = { background: "#0a0a0a", borderRadius: "16px", padding: "24px", margin: "24px 0", textAlign: "center" as const };
const memberNumber = { color: "#39FF14", fontSize: "18px", letterSpacing: "0.3em", textAlign: "center" as const, margin: "12px 0 0", fontWeight: 700 };
const footer = { fontSize: "12px", color: "#888", marginTop: "24px" };
