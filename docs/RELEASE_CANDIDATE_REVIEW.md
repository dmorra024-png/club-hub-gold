> Revisione successiva: [pilota gratuito Cloudflare/Supabase](FREE_PILOT.md). I risultati sotto descrivono la revisione precedente.

# SNOOP / Club Hub Gold — candidata per collaudo, 5 novembre 2026

Ramo `codex/stabilize-independent-club`, PR #1. Prosegue la base `1835c30` senza riscrivere il progetto. Grafica, cataloghi e funzioni manuali conservati. Nessuna modifica a Security PSG, nessuna cancellazione di account/dati, nessun merge o deployment.

## Registro degli incassi associativi

La voce **Cuotas e ingresos** (`/cuotas`) aggiunge un registro indipendente da ordini, vendite e magazzino. Registra data/ora server, importo in centesimi, socio, operatore, metodo (contanti, carta, bonifico, altro), concetto e identificativo. Mostra storico paginato e report giornalieri/mensili, filtrati per periodo e metodo; date e confini dei giorni seguono `Europe/Madrid`, compresa l'ora legale.

L'operatore deve selezionare il socio, indicare il pagamento già ricevuto e confermare. Il rinnovo dell'iscrizione non certifica automaticamente un incasso. Le richieste ripetute con lo stesso UUID sono idempotenti anche in concorrenza; una richiesta riutilizzata con dati diversi viene respinta. Lo storico non è modificabile o cancellabile dagli account dell'app. I riferimenti e le descrizioni del socio/operatore vengono conservati anche dopo modifiche anagrafiche o revoca dell'accesso.

`use_cash` consente registrazione e consultazione, `view_reports` solo consultazione. Admin opera sul club corrente autorevole del database. Super Admin seleziona esplicitamente un club nella stessa applicazione. RPC e RLS controllano club e permesso, oltre all'appartenenza del socio: conoscere un UUID di altro club non basta. Le somme sono aggregate nel database e restituite come JSON, per evitare il limite di 1000 righe PostgREST; lo storico usa la stessa finestra temporale ed è paginato a 25 operazioni.

La migrazione aggiuntiva `20261105170000_membership_receipts.sql` è applicata **solo al database locale sintetico**. Non introduce servizi di pagamento o trasferimenti finanziari: registra contabilmente pagamenti ricevuti. Non genera automaticamente ricevute fiscali e non è stato introdotto un modulo di vendita.

## AI indipendente e autorizzazioni

Ripristinato il montaggio dell'assistente vocale nelle schermate autenticate. Il provider OpenAI-compatible è configurato sul server; anche i percorsi AI legacy conservati usano lo stesso adapter indipendente, senza chiave o endpoint Lovable obbligatori. L'immagine AI opzionale richiede `AI_IMAGE_MODEL` compatibile; resta possibile caricare immagini manualmente.

Usare [.env.example](../.env.example) come elenco di configurazione, senza inserirvi segreti. Per abilitare voce/estrazione servono **AI_API_KEY**, **AI_BASE_URL**, **AI_AUTHORIZED_ORIGIN** esattamente uguale all'origine HTTPS scelta, **AI_MODEL**, **AI_TRANSCRIBE_MODEL** e **AI_EXTERNAL_PROCESSING_ENABLED=true**. TTS usa **AI_TTS_MODEL** e **AI_TTS_VOICE**. Verificare modello, endpoint compatibili, condizioni di trattamento e accesso di rete verso il provider autorizzato. Il runtime attuale non ha credenziali AI configurate e la policy di rete non autorizza `api.openai.com`: nessuna chiamata a un provider reale è stata effettuata.

- Le chiavi non usano il prefisso `VITE_` e non arrivano al browser. Il bundle pubblico viene controllato contro le chiavi private del sandbox.
- Documenti/foto richiedono separatamente **AI_DOCUMENT_PROCESSING_ENABLED=true**; il solo consenso vocale non li abilita. Prima di elaborare, l'interfaccia verifica l'autorizzazione del server; il server blocca comunque le chiamate dirette non autorizzate.
- Il riconoscimento del fornitore del browser è disabilitato per impostazione predefinita. Il percorso normale registra con `MediaRecorder`, su gesto esplicito, e invia al solo provider configurato tramite il server. Il riconoscimento continuo preesistente resta opzionale con **AI_BROWSER_SPEECH_ENABLED=true**, previa autorizzazione separata.
- Italiano e spagnolo sono selezionabili. I comandi di navigazione amministrativa non salvano pagamenti. Le proposte per un nuovo socio compilano il modulo; il salvataggio resta manuale e le correzioni manuali restano possibili. Un errore AI usa il parser locale quando disponibile e mantiene il modulo manuale.
- Redirect del provider rifiutati; HTTPS obbligatorio per provider esterni. HTTP è ammesso soltanto su loopback per test/provider locali.

## Unica PWA Android/iPhone

Manifest e icone esistenti mantenuti; aggiunti metadati Apple e istruzioni Safari «Condividi → Aggiungi alla schermata Home». Stessa applicazione e stessi accessi per i tre ruoli. Il service worker conserva soltanto risorse pubbliche, senza HTML autenticato, API o dati dei soci. Lavorare senza Internet non è supportato: viene mostrata la pagina offline e, tornando online, si può riprendere la navigazione autenticata.

Gli aggiornamenti del service worker aspettano la conferma «Actualizar app / Aggiorna app»: un modulo aperto non viene ricaricato automaticamente. La conferma avverte di salvare prima di ricaricare. Il collaudo verifica anche rifiuto dell'aggiornamento, successiva accettazione e rimozione della vecchia cache.

Corretti l'allargamento della lista soci su mobile e il dialog QR, che potevano spostare il pulsante di chiusura fuori dal viewport. Il dialog è accessibile, limitato al viewport e rilascia la fotocamera quando si chiude.

## Verifiche eseguite

Esito finale: **64/64 unitari, 21/21 casi amministrativi nativi, 10/10 integrazioni AI locali e 11/11 casi PWA/mobile PASS; 0 FAIL**. I casi BLOCKED sono elencati separatamente.

Tutti i test usano PostgreSQL/Auth/REST/Storage/Mailpit **locali** e identità `example.test`. Nessun database remoto, documento reale o account reale. Il provider AI è un server HTTP simulato locale: le risposte sintetiche provano la catena di integrazione, non l'accuratezza del riconoscimento di voce reale.

| Verifica | Esito | Evidenza / livello |
| --- | --- | --- |
| Test automatici | PASS | 64/64: account, SQL/RLS, quote, date/DST, parser IT/ES, trasporti provider locali, QR |
| TypeScript | PASS | Sorgenti e test |
| Build | PASS | Vite/TanStack/Nitro in modalità sandbox, senza Lovable |
| Endpoint account senza autenticazione | PASS | Accesso respinto prima dell'esecuzione degli handler |
| Segreti nel bundle pubblico | PASS | 55 file pubblici controllati contro service-role e chiave AI sintetica |
| Login e uso dopo accesso | PASS | Browser e backend Supabase nativo locale |
| Registrazione, ricerca accentata e modifica socio | PASS | Scritture/riletture DB, doppio clic e nome vuoto |
| Quote e rinnovi | PASS | Creazione, annullamento, rinnovo confermato |
| QR e documenti sintetici | PASS | QR della UI decodificato, upload/URL firmato verificati |
| Dipendenti | PASS | Invito, modifica permessi, recupero e revoca: identità e profilo conservati |
| Permessi e multi-club | PASS | Scritture non autorizzate ed escalation respinte, altro club isolato |
| Cassa base | PASS | Apertura/chiusura, importi negativi respinti; nessun ordine |
| Incassi quote | PASS | UI con conferma/annullamento, operatore e importi persistiti |
| Storico e duplicati | PASS | Concorrenza idempotente, storico non modificabile/cancellabile dall'app |
| Report giornalieri/mensili | PASS | Totali e confini Madrid verificati su DB reale sintetico; oltre 1000 gruppi verificati nel test SQL |
| Super Admin | PASS | Selezione esplicita di club e report separati |
| Report con dati indisponibili | PASS | Errore 503 sintetico visibile, nessuno zero ingannevole |
| AI IT/ES: trascrizione/estrazione/compilazione | PASS | Auth reale, provider HTTP simulato, proposta senza salvataggio automatico |
| Comandi vocali amministrativi IT/ES | PASS | MediaRecorder reale, microfono sintetico Chromium, provider simulato e navigazione effettiva |
| Documenti AI non autorizzati | PASS | RPC bloccata prima di contattare il provider |
| AI indisponibile e microfono negato | PASS | Parser locale IT/ES e inserimento manuale disponibili |
| PWA installabilità Chromium Android | PASS | Manifest/CDP, icone, prompt, cache solo pubblica |
| Layout Android/iPhone | PASS | Chromium Pixel 7 e iPhone 13 emulati: login nativo e navigazione amministrativa |
| Fotocamera negata / concessa | PASS | Errore gestito; video sintetico e rilascio tracce alla chiusura |
| iPhone: metadati e guida installazione | PASS | Viewport/user agent iPhone in Chromium, non Safari |
| Aggiornamento e ritorno online | PASS | Build locale reale e cambio controllato del service worker |
| Voce reale e provider esterno | BLOCKED | Mancano credenziali, autorizzazione origine/rete e campioni vocali reali |
| Android e iPhone fisici / Safari | BLOCKED | Nessun dispositivo collegato; eseguibile WebKit non installato. Emulazione Chromium non certifica Safari |
| Immagini del marchio originali | BLOCKED | PNG originali assenti, rimangono puntatori asset. Non sostituiti con altri marchi |

Il riepilogo dettagliato delle ultime esecuzioni viene salvato in `docs/RC_TEST_RESULTS.json`, senza credenziali, screenshot o dati personali. Una riga PASS non attesta l'esito delle righe BLOCKED. Questa è una candidata per il collaudo, non una dichiarazione di prontezza alla pubblicazione.

## Ripetere il collaudo

1. `SUPABASE_CLI=/percorso/supabase SANDBOX_WORKDIR=/percorso/privato npm run sandbox:prepare`: prepara oppure aggiorna le migrazioni **locali** senza reset. Conservare il workdir privato; contiene credenziali sintetiche e log con chiavi locali.
2. `npm run dev:sandbox`; quindi, con lo stesso `SANDBOX_WORKDIR`, `npm run test:sandbox:administration` e `npm run test:smoke:accounts`.
3. `npm run test:sandbox:ai`: avvia autonomamente un secondo server di sviluppo locale e il provider AI simulato. Non richiede chiavi reali.
4. `npm test`, `npm run typecheck`, `npm run build -- --mode sandbox`, `npm run test:security:bundle`.
5. `npm run test:sandbox:mobile`: avvia autonomamente la build Node su loopback e un proxy **solo di test**, per tenere il backend locale sulla stessa origine. Usa Chromium installato in `/usr/bin/chromium`, modificabile con `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

I test non pubblicano il servizio. Un telefono reale richiederà un'origine HTTPS raggiungibile e il backend configurato; questo turno non crea deployment o URL pubblico. Prima di pubblicare vanno completate le verifiche fisiche, autorizzato/configurato il provider reale, ripristinati gli asset originali e revisionata la migrazione. Nessun permesso di merge/deployment è stato richiesto o assunto.
