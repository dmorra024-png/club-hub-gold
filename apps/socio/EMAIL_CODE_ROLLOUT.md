# SNOOP Socio — codice di conferma via email (6 cifre)

**Non attivare globalmente nel Supabase Auth condiviso con SNOOP gestionale:** i template Auth sono a livello di progetto e modificare la conferma globale può rompere gli inviti dei collaboratori.

## Email per il socio (esempio template di conferma)
Oggetto: `SNOOP Socio — tu código de confirmación`

```html
<div style="font-family:Arial,sans-serif;background:#0b1425;color:#fff;padding:24px">
  <h1 style="color:#c9a85f">SNOOP SOCIO</h1>
  <p>Tu código para confirmar la cuenta es:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:8px">{{ .Token }}</p>
  <p>Introduce el código en SNOOP Socio. Nunca lo compartas.</p>
</div>
```

## Stato del codice
- `POST /api/socio/auth/signup`: continua a creare credenziali email/password, Supabase deve inviare il token via email attraverso il template *Confirmation* (non un link).
- `POST /api/socio/auth/verify-code`: verifica `{email,code}` con `/auth/v1/verify`, `type: signup`.
- `POST /api/socio/auth/resend`: richiede un nuovo token.
- Dopo la conferma, il socio effettua login con email/password; l'autorizzazione alla propria tessera resta verificata dal server e dal club.

## Prima del rilascio reale
1. Separare il progetto Auth dei soci oppure implementare un servizio OTP per soci isolato, per **non cambiare** email/template del gestionale.
2. Attivare invio mail con provider SMTP adeguato, rate limits, expiry breve e controllo errori.
3. Collegare l'iscrizione socio sul gestionale alla generazione/invio del **codice per l'invito al club**: questo è distinto dal codice di conferma email e non può essere sostituito dal solo OTP.
4. Test end-to-end con nuova email socio e SMTP reale; test invito collaboratore non regressivo.
5. Solo dopo il collaudo effettuare deploy controllato. 
