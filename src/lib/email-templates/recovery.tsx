import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="es" dir="ltr">
    <Head />
    <Preview>Restablece tu contraseña de {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={card}>
          <Text style={brand}>SNOOP</Text>
          <Heading style={h1}>Restablecer contraseña</Heading>
          <Text style={text}>
            Hemos recibido una solicitud para cambiar la contraseña de tu cuenta
            en {siteName}. Pulsa el botón para elegir una nueva:
          </Text>
          <Button style={button} href={confirmationUrl}>
            Cambiar contraseña
          </Button>
          <Hr style={hr} />
          <Text style={smallText}>
            Si el botón no funciona, copia y pega este enlace en tu navegador:
          </Text>
          <Text style={urlText}>
            <Link href={confirmationUrl} style={urlLink}>
              {confirmationUrl}
            </Link>
          </Text>
          <Text style={footer}>
            El enlace caduca en 1 hora. Si no has solicitado este cambio, puedes
            ignorar este email: tu contraseña no cambiará.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail

const main = {
  backgroundColor: '#ffffff',
  fontFamily: 'Inter, Arial, sans-serif',
  margin: '0',
  padding: '0',
}
const container = { padding: '24px 16px', maxWidth: '560px' }
const card = {
  backgroundColor: '#0b0f0c',
  borderRadius: '16px',
  border: '1px solid #1f3b26',
  padding: '32px 28px',
}
const brand = {
  fontSize: '13px',
  letterSpacing: '6px',
  color: '#39ff14',
  fontWeight: 'bold' as const,
  margin: '0 0 18px',
}
const h1 = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  color: '#ffffff',
  margin: '0 0 16px',
}
const text = {
  fontSize: '15px',
  color: '#c9d6cc',
  lineHeight: '1.6',
  margin: '0 0 26px',
}
const smallText = {
  fontSize: '12px',
  color: '#8fa394',
  lineHeight: '1.5',
  margin: '0 0 8px',
}
const urlText = { fontSize: '12px', margin: '0 0 20px', wordBreak: 'break-all' as const }
const urlLink = { color: '#39ff14', textDecoration: 'underline' }
const button = {
  backgroundColor: '#39ff14',
  color: '#04120a',
  fontSize: '15px',
  fontWeight: 'bold' as const,
  borderRadius: '10px',
  padding: '14px 26px',
  textDecoration: 'none',
  display: 'inline-block',
}
const hr = { borderColor: '#1f3b26', margin: '28px 0 18px' }
const footer = { fontSize: '12px', color: '#6f8375', margin: '18px 0 0', lineHeight: '1.5' }
