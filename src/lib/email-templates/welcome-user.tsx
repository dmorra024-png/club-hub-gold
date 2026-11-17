import React from "react";
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button } from "@react-email/components";
import type { TemplateEntry } from "./registry";

interface Props {
  full_name?: string;
  email?: string;
  temporary_password?: string;
  role_label?: string;
  club_name?: string;
  login_url?: string;
}

const Email = ({ full_name, email, temporary_password, role_label, club_name, login_url }: Props) => (
  <Html lang="es" dir="ltr">
    <Head />
    <Preview>Tu acceso a SNOOP — {club_name ?? "Tu club"}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>SNOOP</Heading>
        <Text style={subtitle}>{club_name ?? "Tu club"}</Text>

        <Text style={text}>
          Hola {full_name ?? "👋"},
        </Text>
        <Text style={text}>
          Te hemos creado un acceso como <b>{role_label ?? "colaborador"}</b>{club_name ? <> en <b>{club_name}</b></> : null}.
        </Text>

        <Section style={box}>
          <Text style={label}>Usuario</Text>
          <Text style={value}>{email}</Text>
          <Text style={label}>Contraseña temporal</Text>
          <Text style={value}>{temporary_password}</Text>
        </Section>

        <Text style={text}>
          Por seguridad, cámbiala en cuanto entres por primera vez.
        </Text>

        {login_url ? (
          <Section style={{ textAlign: "center", margin: "28px 0" }}>
            <Button href={login_url} style={btn}>Entrar a SNOOP</Button>
          </Section>
        ) : null}

        <Text style={footer}>
          Si no esperabas este mensaje, puedes ignorarlo.
        </Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Tu acceso a SNOOP — ${d.club_name ?? ""}`.trim(),
  displayName: "Bienvenida usuario SNOOP",
  previewData: {
    full_name: "Daniele",
    email: "daniele@example.com",
    temporary_password: "Snoop-1234-Ab",
    role_label: "administrador",
    club_name: "Medusa 23",
    login_url: "https://snoop.app/auth",
  },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" };
const container = { padding: "32px 28px", maxWidth: "560px", margin: "0 auto" };
const h1 = { fontSize: "28px", letterSpacing: "0.3em", color: "#0a0a0a", margin: "0 0 4px", fontWeight: 700 } as const;
const subtitle = { fontSize: "12px", letterSpacing: "0.3em", color: "#39ff14", margin: "0 0 24px", textTransform: "uppercase" as const };
const text = { fontSize: "15px", lineHeight: "22px", color: "#111", margin: "0 0 14px" };
const box = { background: "#0a0a0a", color: "#fff", borderRadius: "12px", padding: "18px 20px", margin: "20px 0" };
const label = { fontSize: "10px", letterSpacing: "0.2em", color: "#39ff14", textTransform: "uppercase" as const, margin: "10px 0 2px" };
const value = { fontSize: "16px", color: "#fff", margin: "0 0 6px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };
const btn = { background: "#39ff14", color: "#0a0a0a", padding: "12px 22px", borderRadius: "8px", textDecoration: "none", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase" as const, fontSize: "13px" };
const footer = { fontSize: "12px", color: "#666", marginTop: "24px" };
