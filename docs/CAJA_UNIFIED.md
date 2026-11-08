# Caja unificata — 8 novembre 2026

Il report comprende **pedidos con stato `completed` e ricevute delle quote associative**. Le schermate giornaliere, per data e per collaboratore usano le stesse fonti; la home esclude anch'essa i pedidos annullati/non completati. I fondi iniziali e le chiusure rimangono valori separati delle sessioni e non entrano negli incassi.

Il pannello “Turnos administrativos” usa il nuovo RPC server `snoop_cash_shift_report`. La data predefinita viene dal server. Ogni movimento viene classificato dalla propria data registrata, in **Europe/Madrid**, negli intervalli **[11:00,17:00)** e **[17:00,23:00)**. Le operazioni fuori turno rimangono separate e incluse nel totale giornaliero. Non viene inventata un'assegnazione del personale. I movimenti senza responsabile sono indicati come tali e sono visibili soltanto agli amministratori.

Il responsabile proviene da `orders.created_by` o `membership_receipts.recorded_by`, mai da un ID liberamente fornito dal frontend. Il collaboratore vede esclusivamente i propri movimenti; il Super Admin non riceve dati operativi. Alla riduzione dei permessi, la cache del report viene invalidata immediatamente e i dati vengono richiesti nuovamente. Il report non espone dati identificativi dei soci.

## Unico file SQL da approvare

[**SNOOP_CASH_SHIFTS_PROPOSED.sql**](sql/SNOOP_CASH_SHIFTS_PROPOSED.sql)

- Un'unica transazione, da eseguire una sola volta **dopo autorizzazione**; non è stata applicata a database remoti.
- Verifica tabelle/colonne/tipi, RLS già attivo e funzioni di autorizzazione della separazione piattaforma/club. Si ferma se il nuovo RPC esiste già.
- Crea solo una funzione di lettura, ne limita l'esecuzione agli utenti autenticati e ricarica la cache dello schema PostgREST.
- Nessun `UPDATE`, `DELETE`, backfill, modifica di policy o nuova tabella contabile. Nessuna modifica di account, fondi, ricevute o pedidos.
- Sostituisce nell'app il precedente RPC delle sole quote, senza dipendere dalla sua proposta SQL. Non serve applicare quella vecchia proposta; se già presente, può coesistere senza modifiche.

La funzione seleziona le due fonti separatamente con `UNION ALL`, senza join con righe di prodotto o sessioni che moltiplicherebbero i movimenti. Gli ID sono distinti per fonte (`order:` / `fee:`), quindi UUID uguali in tabelle differenti non eliminano un incasso valido. I duplicati della stessa fonte non gonfiano i totali; dati discordanti fanno fallire il calcolo. Il flusso corrente di iscrizione/rinnovo registra una ricevuta della quota, non un pedido aggiuntivo; non vengono dedotte correlazioni inesistenti tra movimenti storici.

## Prove eseguite con dati sintetici

| Fonte / responsabile | Mattina | Pomeriggio | Fuori turno | Totale |
|---|---:|---:|---:|---:|
| Pedidos completati | 10 € | 20 € | 3 € | 33 € |
| Quote associative | 5 € | 0 € | 0 € | 5 € |
| Collaboratore B | 15 € | 0 € | 0 € | 15 € |
| Amministratore A | 0 € | 20 € | 0 € | 20 € |
| Senza responsabile | 0 € | 0 € | 3 € | 3 € |
| **Club** | **15 €** | **20 €** | **3 €** | **38 €** |

Un pedido annullato da 999,99 € e un fondo iniziale da 9.999,99 € sono **esclusi**. Due tabelle con lo stesso UUID mantengono entrambi i movimenti. Ripetere i record non raddoppia gli importi. PostgreSQL locale verifica la migrazione sullo schema completo e la compatibilità con la proposta precedente; confronta dati e policy prima/dopo. Verifica isolamento tra club, filtro del collaboratore, parametri falsificati, Super Admin, club sospeso, downgrade dei privilegi e rifiuto atomico di dipendenze incompatibili. I test già presenti verificano i confini orari e l'ora legale di Madrid.

Il test browser usa le risposte effettivamente prodotte dall'RPC nel database PostgreSQL **locale**, sostituendo il trasporto HTTP. Verifica il componente React reale in Chromium mobile Samsung e WebKit iPhone, comprese sessioni distinte, downgrade senza ricaricamento, importi, assenza di salvataggi e assenza di overflow orizzontale. Non è una prova su hardware fisico né sul Supabase remoto.

- `npm test`: **210/210 PASS**.
- TypeScript e build produzione: **PASS**.
- `npm run test:cash:browser`: **PASS** su entrambi i browser.
- Regressioni PWA/accesso/tastiera e ripristino sessione: **PASS** su entrambi i browser.
- Build Cloudflare, dry-run locale e scansione dei segreti frontend: **PASS**.
- CI: esito del commit riportato nella PR #1.

[Esito browser](CAJA_BROWSER_RESULTS.json) · [Samsung amministratore](screenshots/caja-unified-samsung-admin.png) · [iPhone collaboratore](screenshots/caja-unified-iphone-staff.png)

## Limiti reali / attivazione

Lo schema attuale dei pedidos conserva stato e importo, **non il metodo di pagamento né una conferma bancaria separata**. Il report mostra quindi importi dei pedidos completati registrati, senza affermare che siano contanti o pagamenti bancari riconciliati. Le quote mantengono il metodo di pagamento registrato. Non sono stati aggiunti campi o alterati dati storici per colmare questa informazione mancante.

Per attivare il nuovo RPC sono necessarie una verifica delle dipendenze sul progetto reale e l'autorizzazione ad applicare **soltanto il file sopra**, poi un'autorizzazione separata al deployment. Fino ad allora l'app online non contiene queste modifiche; il nuovo pannello segnala l'assenza del RPC anziché mostrare importi inventati. Nessun merge, deployment, accesso/modifica al database di produzione, segreto o intervento su Security PSG effettuato. I conflitti della PR con `main` restano separati da questo intervento.
