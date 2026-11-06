> Aggiornamento successivo: vedere [candidata per collaudo e nuova matrice](RELEASE_CANDIDATE_REVIEW.md). I risultati sotto descrivono la revisione precedente.

# Runtime amministrativo indipendente e PWA

Questa revisione riguarda soci, quote associative, account, documenti e strumenti
amministrativi. Non aggiunge o migliora flussi di vendita/distribuzione. Grafica,
fogli di stile, dati esistenti e Security PSG non vengono sostituiti. Nessuna
migrazione remota, pubblicazione o deployment è stato eseguito.

## Implementato

- Vite, TanStack Start e Nitro configurati direttamente, senza pacchetti Lovable.
  Build Node con `npm run build`; avvio con `npm start`, inclusa lettura locale
  di `.env` e `.env.local`. Soltanto le variabili `VITE_*` sono pubbliche.
- Trascrizione, TTS, OCR dei documenti e assistente dei soci usano un provider
  OpenAI-compatible configurabile. Restano disponibili italiano e spagnolo,
  parser testuale locale, compilazione manuale e avvisi espliciti sui fallback.
- L'agente prepara una bozza per il modulo dei soci; il salvataggio avviene solo
  dopo revisione e conferma manuale. Il rinnovo richiede conferma nella scheda.
  Le bozze in sessionStorage scadono dopo due minuti e si cancellano al consumo
  o al logout. Risposte AI tardive non sovrascrivono campi modificati nel frattempo.
- Corrette date ISO/europee, date impossibili, età al compleanno, calendario di
  Madrid, scadenze durante il cambio d'ora, piani facoltativi e doppi invii.
- Migrazione amministrativa aggiuntiva: autorizzazioni `manage_members` sul
  club corretto e vincolo che impedisce l'uso di una quota di un altro club.
  Le righe storiche restano intatte; il nuovo vincolo FK è `NOT VALID` per non
  riscrivere/cancellare eventuali anomalie preesistenti.
- QR associativo generato localmente come PNG/CID allegato, senza inviare il
  numero del socio a un generatore di immagini esterno. Il server verifica
  permesso amministrativo, club e destinatario prima di accodare la tessera.
- Trasporto email compatibile con l'API Resend, mittente configurabile,
  idempotenza e gestione degli errori di invio. Il messaggio UI distingue
  accodamento e consegna. Gli URL `/lovable/email/...` rimangono come percorsi
  compatibili, senza richiedere SDK, account o servizi Lovable.
- Manifest PWA, icone normali/maskable, pulsante di installazione e fallback
  offline. Il service worker conserva soltanto manifest, icone e pagina offline;
  non conserva HTML autenticato, documenti, dati dei soci, RPC o risposte API.
  Non vengono accodate modifiche mentre manca la connessione. Dopo un invio
  interrotto verificare il registro prima di ripetere: il blocco del doppio clic
  non certifica idempotenza attraverso disconnessioni e ricaricamenti.

## Verifiche locali

| Controllo                         | Risultato / limite                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                        | PASS: 52 test, account, SQL/RLS amministrativo, date IT/ES, bozze, QR e provider locali                                                        |
| `npm run typecheck`               | PASS: TypeScript applicazione e test                                                                                                           |
| `npm run build` / `npm start`     | PASS: server Node locale, senza configurazione Lovable                                                                                         |
| `npm run test:browser`            | PASS: Chromium, viewport Android emulata, manifest, criteri di installabilità, icone reali, prompt, offline e cache pubblica                   |
| Registrazione/rinnovo nel browser | PASS con Supabase completamente simulato; dati sintetici; doppio invio, annullamento/conferma rinnovo, QR e bozza senza salvataggio automatico |
| Provider AI/email                 | Contratti HTTP verificati con server locali simulati; nessun riconoscimento vocale o invio email reale dichiarato funzionante                  |
| Database                          | PostgreSQL incorporato PGlite; fixture amministrative limitate, non replay completo di Supabase/Auth/Storage                                   |
| Android fisico                    | Da verificare con HTTPS su un dispositivo reale, incluse fotocamera e microfono                                                                |
| Lint globale                      | Presenta errori preesistenti; non viene dichiarato verde                                                                                       |

La CI esegue questi controlli, avvia soltanto server locali e non contiene
operazioni di deployment o applicazione di migrazioni. Il risultato remoto della
CI va verificato sulla PR. I test browser bloccano o simulano tutte le richieste
a servizi esterni: non usano mai dati o account reali.

## Configurazione esatta ancora necessaria

Nel runtime attuale non sono presenti chiave AI, chiave email, service-role
Supabase o `APP_URL`. Configurare i valori tramite impostazioni sicure o un file
`.env.local` non tracciato; non inserire segreti nel repository o nelle variabili
`VITE_*`.

| Variabile                                             | Utilizzo                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `APP_URL`                                             | Origine HTTPS dell'applicazione; HTTP ammesso solo per localhost negli inviti                                   |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`            | Endpoint e chiave pubblica lato server                                                                          |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`  | Configurazione pubblica incorporata nella build browser                                                         |
| `SUPABASE_SERVICE_ROLE_KEY`                           | Operazioni amministrative degli account e coda email; mai esporla al browser                                    |
| `AI_EXTERNAL_PROCESSING_ENABLED=true`                 | Abilitazione esplicita del trattamento esterno dopo aver scelto provider e condizioni per i dati personali      |
| `AI_API_KEY`                                          | Credenziale server del provider OpenAI-compatible                                                               |
| `AI_BASE_URL`                                         | Default `https://api.openai.com/v1`; modificabile per un provider indipendente compatibile                      |
| `AI_MODEL`                                            | Default `gpt-4o-mini`; deve supportare chat/tool calling e, per OCR, immagini                                   |
| `AI_TRANSCRIBE_MODEL`, `AI_TTS_MODEL`, `AI_TTS_VOICE` | Default `gpt-4o-mini-transcribe`, `gpt-4o-mini-tts`, `ash`; verificare disponibilità presso il provider scelto  |
| `AI_STRUCTURED_OUTPUTS=false`                         | Solo se il provider non supporta JSON Schema; gli output restano validati e possono produrre un fallback locale |
| `EMAIL_API_KEY`, `EMAIL_FROM`                         | Credenziale e mittente verificato per email applicative                                                         |
| `EMAIL_API_URL`                                       | Default `https://api.resend.com/emails`; eventuale endpoint con lo stesso contratto                             |
| `EMAIL_QUEUE_SECRET`                                  | Segreto distinto per il job che chiama `POST /lovable/email/queue/process`                                      |
| `EMAIL_WEBHOOK_SECRET`                                | Opzionale, almeno 32 caratteri, per i webhook firmati personalizzati                                            |
| `EMAIL_PREVIEW_SECRET`                                | Opzionale, per le anteprime email protette                                                                      |

L'accesso di rete deve consentire l'host Supabase configurato e gli host effettivi
dei provider, ad esempio `api.openai.com` e `api.resend.com`. Al momento la policy
del runtime non include questi host applicativi. I test locali non dimostrano
quindi la raggiungibilità o l'autorizzazione dei servizi reali. In un runtime
con proxy, conservare proxy e CA forniti dalla piattaforma; con Node 24 può
servire `NODE_USE_ENV_PROXY=1` per il fetch nativo. Non disabilitare TLS né
aggirare la policy di rete.

Per gli inviti e il recupero password usare SMTP/Auth di Supabase con
`<APP_URL>/reset-password` nei redirect autorizzati. Disabilitare o riconfigurare
un eventuale vecchio hook email Lovable del progetto prima di un collaudo reale.
L'hook compatibile dell'app accetta un envelope firmato, non sostituisce
automaticamente il formato nativo di un hook Supabase: firma
`sha256=HMAC_SHA256(secret, timestamp + "." + body)` e header
`x-clubhub-timestamp` (Unix secondi), `x-clubhub-signature`, tolleranza 5 minuti.
Il payload auth deve avere `version: "1"`, `type`, `run_id`, `data` con i dati
previsti dal template. Per gli inviti è previsto anche il normale SMTP di Supabase, senza questo hook.
La consegna reale resta da collaudare.

## Loghi originali mancanti

Nel repository ci sono soltanto i descrittori dei due loghi attuali:
`snoop-logo.png` e `meduza-xxiii-logo.png`. I relativi byte non sono nella
cronologia Git. Non sono stati ridisegnati né sostituiti con il diverso logo
storico trovato nel repository. Le icone del nuovo launcher PWA sono separate.

Occorrono le due esportazioni PNG originali o un URL dal quale recuperarle.
Per conservarne gli indirizzi esistenti e servirle localmente:

```sh
npm run assets:import -- /percorso/snoop-logo.png /percorso/meduza-xxiii-logo.png
```

Lo script verifica firma PNG e dimensione indicata nei descrittori, impedisce
sovrascritture differenti e copia in `public/__l5e/assets-v1/...`. Non certifica
un hash originale sconosciuto. Fino all'importazione i due loghi possono risultare
assenti nel runtime standalone; la fedeltà grafica completa non è verificata.

## Ambito non completato

I moduli esistenti per ordini e prodotti che mescolano campi commerciali non sono
stati ottimizzati o migrati: i relativi parser/enrichment legacy possono ancora
richiedere il gateway Lovable. Le funzionalità AI esistenti non sono state
eliminate. Questa revisione rende indipendente il percorso amministrativo, non
certifica l'indipendenza di ogni percorso commerciale conservato nel repository.
Cataloghi, inventario, cassa, report economici e statistiche complessive non sono
coperti dai collaudi amministrativi descritti qui.

## Collaudo e rilascio separati

Su un progetto Supabase di prova, applicare nell'ordine le due nuove migrazioni
di sicurezza degli account e dei soci (`20261105103000...`, `20261105113000...`)
dopo revisione. Non rieseguire alla cieca l'intero storico su produzione.
Verificare con account fittizi di club distinti registrazione, rinnovo, email,
permessi, OCR e dettatura reale IT/ES. Installare la PWA su Android tramite HTTPS
e provare camera, microfono, riapertura e rete assente. Solo dopo questi collaudi
e l'importazione dei loghi valutare un rilascio, sempre previa autorizzazione.
Per il rollback mantenere una build precedente e un backup verificato; non
riaprire le vecchie policy permissive e non cancellare identità o dati.
