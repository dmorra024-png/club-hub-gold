# Gateway operazioni Monedero (non pubblicato)

Il modulo `apps/socio/wallet-http.mjs` prepara tre endpoint **del futuro gestionale staff**:

- `POST /api/snoop-wallet/topup` ricarica con sessione cassa aperta
- `POST /api/snoop-wallet/spend` addebito con ordine collegato
- `POST /api/snoop-wallet/refund` restituzione crediti per ordine annullato

Ogni chiamata impone origine stessa, JSON, identità e autorizzazione staff verificate lato server e conferma esplicita. Le richieste NON contengono identità staff accettate dal client. L'app Socio rimane solo lettura (saldo/storico): non importare questo gateway nel Worker `snoop-socio-staging` né concedere privilegi `service_role` al browser.

**Non montare la rotta nel gestionale corrente** fino a integrazione approvata della transazione SQL con ordine, stock, cassa, riconciliazione e permessi reali. I test del gateway usano un repository sintetico; non equivalgono a test finanziari reali.
