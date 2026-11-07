# SNOOP — completamento verificato, 7 novembre 2026

Ramo: `codex/stabilize-independent-club`, PR #1. Sincronizzato con fast-forward fino a `b71c250` prima delle modifiche. L'ultimo workflow di quel commit era PASS; il precedente falliva nel tentativo di decodificare un SVG come bitmap, già corretto da `b71c250`.

## Correzioni

- **Collaboratori:** campi nome, cognome, email e permessi; nessuna password scelta dall'amministratore. Il profilo Worker era impostato su `SNOOP_INVITATION_DELIVERY=manual`, quindi non spediva email senza un provider aggiuntivo. Ora `auto` usa il servizio Auth già configurato; se sono già presenti `EMAIL_API_KEY`/`EMAIL_FROM`, usa quel provider. L'accettazione è distinta dalla consegna: il provider personalizzato deve restituire un ID messaggio; errori, quota e configurazione assente non diventano successi. Gli errori SMTP possono produrre un link manuale monouso, con token nel frammento e senza log di credenziali. Ogni link rigenerato ha una diversa chiave di idempotenza. Account esistenti, password e accessi ad altri club vengono conservati.
- **Attivazione personale:** corretto il consumo duplicato del token quando gli eventi Auth rimontavano la pagina. URL ripulito prima della verifica e promessa di verifica riutilizzata. Browser test: una sola verifica OTP e un solo aggiornamento password.
- **Quote/Caja:** conservata la rimozione della voce “Cuotas e ingresos”. Iscrizione e rinnovo ora chiamano una RPC atomica che registra socio/scadenza e ricevuta insieme, usando prezzo e durata del piano letti dal database. Richiede i permessi corretti; protegge replay, concorrenza e club diversi. Include operazioni gratuite nel registro di idempotenza. In Caja: storico e report giornaliero/mensile; il contante delle quote entra nell'importo atteso della cassa aperta dell'operatore, mentre carta e bonifico restano distinti dal contante. Nessun ordine viene creato per una quota.
- **Categorie/prodotti:** modifica del nome, archiviazione e riattivazione categorie; cancellazione confermata delle sole categorie vuote, con ulteriore blocco database. Prodotti modificabili e archiviabili/riattivabili; nessuna cancellazione con stock o storico. Modifica scheda atomica con controllo di concorrenza. Quantità corrette attraverso la RPC di rettifica già esistente; storico visibile e immutabile. Scritture dirette di stock senza RPC e manipolazioni dirette del registro sono bloccate.
- **AI catalogo:** la causa del blocco era `AI_VOICE_ONLY=true`, che rifiutava anche il catalogo. Aggiunta autorizzazione separata `AI_CATALOG_PROCESSING_ENABLED=true`, mantenendo esclusi documenti e modelli per dati personali. Invio dei soli nome/categoria/tipo pubblici del prodotto; nessun prezzo, inventario, ID, documento, socio o cronologia. Adattatore Workers AI compatibile con risposte stringa/oggetto, timeout ripuliti e nessun retry o provider a pagamento. Le descrizioni sono proposte informative da verificare, mai salvate automaticamente.
- **Immagini:** rimossa la generazione di fotografie inventate; ricerca su Wikimedia Commons con nome, metadati di licenza, autore e fonte. Riconosciuti anche il dominio ufficiale `thumb.wikimedia.org` e i vecchi riferimenti HTTP Creative Commons, convertiti a HTTPS. Licenze e collegamenti devono essere coerenti; solo bitmap da host autorizzati. I risultati sono candidati: la corrispondenza esatta va confermata dall'operatore; nessuna scelta automatica. Attribuzione conservata nella scheda. Sempre disponibile caricamento locale JPG/PNG/WebP, con ridimensionamento nel browser e senza invio all'AI.
- **Logo/mobile:** usato il logo commerciale già presente nel repository in login, recupero password, app e pannello piattaforma. Nessun “Club Management” nell'intestazione. Logo incluso nella cache pubblica PWA, versione aggiornata a v4. Corretto overflow delle schede Caja sul telefono. Il workflow esegue anche il collaudo completo Chromium/WebKit.

## Test realmente eseguiti

| Verifica | Esito | Prova e limite |
|---|---|---|
| Suite automatica completa | PASS | **159/159**, zero fallimenti |
| TypeScript applicazione e test | PASS | `npm run typecheck` |
| Build produzione Node | PASS | `npm run build` |
| Build Cloudflare | PASS | `npm run build:worker:test`, configurazione sintetica locale |
| Wrangler | PASS | `deploy --dry-run`; nessun deployment |
| Segreti frontend | PASS | 61 artefatti pubblici controllati |
| Sicurezza account HTTP | PASS | HTML login/recupero e tre funzioni account reali: richieste anonime respinte prima dei database |
| Isolamento/RLS/migrazioni | PASS | PostgreSQL WASM/PGlite locale: amministratori di due club, collaboratore senza permesso cassa, Super Admin, categorie, rettifiche immutabili, replay iscrizione/rinnovo, rollback e report |
| Android/Chromium Pixel 7 | PASS | Build di produzione: categorie, stock, schede, immagini manuali, proposta AI, permessi, inviti, link e password. API intercettate con dati sintetici |
| iPhone/Chromium emulato | PASS | Stesso flusso, nessun overflow |
| iPhone/WebKit | PASS | Stesso flusso nel motore WebKit reale su Linux, viewport iPhone 13. Non è una prova su iPhone fisico |
| PWA produzione | PASS | Manifest, installabilità Chromium, icone, prompt, offline, cache esclusivamente pubblica |
| Iscrizione/rinnovo/QR browser | PASS | Dati sintetici, doppio click, rinnovo annullato/confermato, visualizzazione QR e bozza AI senza scritture automatiche |
| Dettatura IT/ES browser | PASS | MediaRecorder reale con microfono sintetico, risposta trascrizione simulata, compilazione campi, zero salvataggi automatici |
| API immagini Commons reale | PASS | HTTP 200, ricerca generica “Measuring cup”, 6 risultati e 2 candidati ammessi dal filtro finale, licenze Public domain / CC BY-SA 3.0; nessun dato personale |
| Consegna email a destinatario reale | BLOCKED | Non effettuata. Lettura della configurazione SMTP Snoop-pilot: HTTP 403, `Missing required permission(s): auth_config_read`. Il trasporto e i rifiuti sono collaudati con provider sintetico; non viene dichiarata una consegna reale |
| Inferenza AI reale su Samsung | BLOCKED | Nessun deployment di questa versione e nessuna richiesta al modello Cloudflare reale. I test SDK/binding sono simulati; accuratezza reale e quota dell'account restano da verificare |
| Installazione su telefono fisico | BLOCKED | Nessun accesso al Samsung/iPhone fisico in questa sessione |

WebKit è stato scaricato dal distributore ufficiale Playwright; le librerie mancanti sono state estratte da pacchetti ufficiali Debian soltanto in `/tmp`, senza installazioni di sistema. È stato verificato l'avvio effettivo e completato il flusso browser, non soltanto il controllo dipendenze.

La pre-verifica remota, eseguita con una sola SELECT di metadati su Snoop-pilot, conferma: `snoop_access_context` e `adjust_administrative_stock` presenti; `manage_administrative_category`, `save_membership_with_receipt` e il campo `image_attribution` ancora assenti. Nessun dato personale consultato e nessuna scrittura remota.

## Operazioni da autorizzare

1. **Solo su Snoop-pilot `bnwanxbmprbymbutoths`:** applicare insieme, in una transazione, le migrazioni `20261107120000_catalog_lifecycle.sql` e `20261107123000_membership_payment_flow.sql`, poi ricaricare lo schema PostgREST. Aggiungono campi/funzioni/protezioni e il registro di idempotenza; non eliminano account, club, dati o movimenti. Non rieseguire l'inizializzazione del database. Non applicate in questa sessione.
2. **Successivamente:** deployment del commit revisionato sul solo Worker esistente `snoop-pilot`, riutilizzando i segreti protetti esistenti, con voce/catalogo e inviti automatici abilitati. Nessun servizio a pagamento attivato.

L'eventuale verifica SMTP richiede soltanto la capacità esatta `auth_config_read` sul progetto Snoop-pilot oppure una prova di invito reale autorizzata separatamente; non richiede per questi test nuove password o chiavi in chat. Security PSG non è stato utilizzato o modificato. Nessun merge, deployment o scrittura sul database remoto.

## Sincronizzazione GitHub finale

Il codice è conservato in un commit locale e in una patch Git completa esportata. Il push finale è **BLOCKED**: Git rifiuta le credenziali (`Invalid username or token`); anche GitHub API/CLI ora risponde `HTTP 401 Bad credentials`. Il ramo remoto verificato prima del blocco era `b71c250`; la PR #1 non contiene ancora questa correzione. Non sono stati creati token, riscritta la cronologia pubblicata o avviati workflow/deployment. Il collegamento GitHub dell'ambiente deve essere ripristinato prima della pubblicazione; non occorre rifare codice o test.
