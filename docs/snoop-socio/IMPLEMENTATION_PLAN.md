# Piano di sviluppo e consegna a Codex — SNOOP Socio

## Regola assoluta
Non modificare il codice gestionale attivo, il database di produzione, Worker `snoop-pilot`, workflow di JARVIS, o branch di Codex. Questo ramo contiene documenti e codice isolato `apps/socio/` (interfaccia, funzioni di dominio, servizio backend astratto, test). Non è una PWA autenticata funzionante finché non saranno realizzati adapter Supabase, API, migrazioni autorizzate e deployment separato. **Nessun deploy o merge** finché Codex non valuta compatibilità e sicurezza.

## Verifica tecnica preliminare (read-only completata 17 nov 2026)
Su Supabase SNOOP:
- tabella `members` contiene `id`, `club_id`, `email`, `member_number` per membership; il numero socio NON è un account di login.
- tabella `orders` contiene `member_id`, `club_id`, `total_cents`, `cash_session_id`; `cash_sessions` contiene `opening_cash_cents` / `closing_cash_cents`; `financial_order_refunds` esiste.
- **Non risulta tabella wallet/monedero dedicata** nei nomi delle tabelle pubbliche correnti.
- Nessuna tabella `qr_token` dedicata visibile dal confronto delle colonne con il nome contenente qr; eventuale QR attuale potrebbe essere generato in codice. Codex deve recuperare il formato del QR già usato dal gestionale, evitando incompatibilità.
- Verifica RLS, RPC, migrazioni e flussi reali di cassa prima di proporre SQL.

## Fasi di sviluppo su questo ramo, separate dal pilot JARVIS
1. Codex rivede specifica e controlla come il gestionale attuale rappresenta `members`, `club_id`, QR, i permessi e rinnovo.
2. Nuovo entrypoint PWA dedicato in una directory isolata (`apps/socio/` o progetto separato concordato) con manifest, service worker minimo, design e navigazione indipendenti; niente import da schermate admin.
3. Collegare la UI già isolata a login/registrazione e verifica email via Auth con confini e rate limiting; account socio senza permessi gestionali.
4. Implementare meccanismo verificato di associazione a membership multi-club. Email è l'indice e non il permesso; nessuna esposizione di club di altri soci.
5. Implementare emissione/validazione QR dinamico club-scoped e lettura via gestionale, con compatibilità studiata anziché cambiare a sorpresa i QR esistenti.
6. Implementare menu `Mis clubes`, last-club, stato e account.
7. Monedero: progettare contabilmente saldo/ledger/ricariche e QR, completare revisione legale e dei permessi; solo dopo aggiungere API e UI read-only del socio.
8. Test automatici e browser reali Android/iOS, integrazione su ambiente isolato senza PII reali; Codex consegna PR draft verso `main` solo per revisione, senza merge.
9. Pubblicare con nuovo URL/Worker e install QR soltanto dopo autorizzazione esplicita del proprietario e test multi-club completi; mai bloccare il lavoro JARVIS.

## Contratti API suggeriti, soggetti a review
- `GET /socio/me`: account socio, stato di verifica email, solo dati non sensibili.
- `GET /socio/clubs`: membership verificate dell'utente, senza endpoint di ricerca email pubblico.
- `POST /socio/link/claim`: challenge monouso e audit; protezione anti-bruteforce.
- `GET /socio/clubs/:clubId/carnet`: numero socio, stato, token QR breve per link verificato.
- `GET /socio/clubs/:clubId/wallet` e `/wallet/movements`: consultazione consentita se Monedero abilitato; solo saldo e movimenti del club scelto.
- Endpoint gestionale scansione che verifica token QR, membership, club operatore e scadenza, senza consumare fondi.

Non usare i nomi di route come contratto finale prima di mappare l'infrastruttura esistente. Tutti gli endpoint richiedono Auth e autorizzazione server, eccetto pagina install pubblica.

## Checklist per il futuro merge
- Diff limitato a codice app socio nuovo e integrazione esplicitamente approvata.
- Nessuna modifica ai flussi Codex/JARVIS in corso.
- Nessuna secrets nel repository; policy Supabase non permissive.
- Staging verificato da Codex, review incrociata cross-club e revoca.
- Compatibilità dei QR scanner già presenti.
- Rollback pronto, deploy separato, niente migrazione dati irreversibile.

## Aggiornamento implementazione 17 novembre 2026
Interfaccia PWA isolata e servizi business astratti aggiunti in `apps/socio`: `domain.mjs`, `auto-link.mjs`, `service.mjs`, e relativi test. Disponibili contratti per sincronizzazione automatica membership tramite email Auth confermata, QR firmato per singolo club, saldo Monedero e storico read-only, sempre senza dati reali. **Importante:** l'attuale schema `members` non contiene un flag di conferma email al momento dell'iscrizione; Codex dovrà concordare una prova affidabile o un meccanismo equivalente prima di attivare auto-link senza codice. Le sole email uguali non devono abilitare accesso a schede altrui.
