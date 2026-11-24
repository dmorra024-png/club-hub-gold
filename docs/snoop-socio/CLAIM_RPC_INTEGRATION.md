# Prova di proprietà tessera: percorso completo (review only)

1. Un amministratore/collaboratore con permesso `manage_members` e sessione autentica apre la tessera del socio nel proprio club.
2. Il server del gestionale invia `POST /api/snoop-socio-staff/claim` con ID club/socio; `staff-claim-http.mjs` usa solo il JWT staff verificato dal server.
3. La RPC `socio_issue_member_claim` **riesamina nel database** ruolo, club e iscrizione attiva, revoca codici precedenti, crea un codice crittografico di 24 byte valido 10 minuti e memorizza soltanto l'hash. Il codice viene mostrato una volta al collaboratore.
4. Il socio, tramite la propria sessione autenticata con email verificata, inserisce il codice nella PWA. `supabase-rls.mjs` invia solo il codice alla RPC `socio_claim_member`, che verifica account non staff, challenge, club attivo, tessera e scadenza. Blocco `FOR UPDATE`, consumo e link vengono eseguiti atomicamente. Una scansione successiva del codice è rifiutata.
5. La PWA può quindi caricare esclusivamente la tessera associata, tramite RLS.

**Non ancora attivo:** le due RPC sono in `schema/CLAIM_RPCS_REVIEW_ONLY.sql`, mai applicate alla produzione; l'endpoint staff non è montato nel gestionale e non deve esserlo senza revisione dei ruoli, rate limiting per indirizzo IP, monitoraggio anomalie e controllo manuale di un socio già associato.

La email uguale fra club non garantisce da sola l'associazione. Il Monedero resta disabilitato fino alle transazioni contabili verificate e al consenso di attivazione di ogni club.
