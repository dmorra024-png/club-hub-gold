# Guards del dominio socio — codice isolato
Le funzioni in `apps/socio/domain.mjs` modellano i collegamenti account→membership verificati, il QR temporaneo HMAC con scopo club e una proposta di movimento wallet in centesimi interi. I test in `domain.test.mjs` controllano accesso multi-club, revoca, scadenza, firma e idempotenza.

**Questo non è un backend in produzione.** Le funzioni non interrogano Supabase, non autenticano sessioni, non salvano challenge, non autorizzano operatori né aggiornano saldi. Le variabili come `staffApproved`, `memberActive` e `authorized` devono provenire da controlli server-side, mai dal client. Codex deve costruire un endpoint autenticato, transazioni atomiche per one-use e wallet, RLS, replay protection, rate limit, scanner autorizzato e integrazione ai QR attuali prima di un merge.

Il QR non contiene nome, email o dati personali; la scansione **non autorizza da sola** una transazione. Il sistema wallet richiede revisione contabile e legale, inclusa la prevenzione della doppia contabilizzazione tra ricarica e consumo crediti.

Per verificare: `node --test apps/socio/domain.test.mjs`.
