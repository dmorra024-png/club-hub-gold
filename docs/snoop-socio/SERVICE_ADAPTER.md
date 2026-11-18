# Backend service adapter — isolato, non distribuito

`apps/socio/service.mjs` contiene il servizio business server-side con repository iniettato: `clubs`, `linkMembership`, `card`, `qr`, `wallet`, `scan`. I test usano un repository sintetico in memoria.

**Manca ancora l'adattatore Supabase/Cloudflare reale.** Il chiamante del servizio deve autenticare la sessione server-side, assicurare il tipo `socio` (non staff), verifica email, e recuperare links/membership con autorizzazione RLS. Mai accettare `actor`, `staff` o `repository` da JSON del client. La funzione repository `claimAndConsumeLinkChallenge` deve consumare il challenge e creare il link in **una transazione atomica**, con codice hashato, TTL e rate limit; `policy` è un helper non una security boundary. La funzione `walletForMember` è solo lettura RLS per membership verificata. Lo scanner operatori deve estrarre il club dall'access context dello staff, verificare il QR firmato e l'attualità della membership. La scansione da sola non autorizza operazioni.

In questa fase nessuna tabella è stata creata, nessuna credenziale è stata gestita, nessun database è stato modificato, e nessun QR di produzione viene emesso.
