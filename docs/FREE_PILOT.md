# SNOOP: consegna per il primo collaudo gratuito

Ramo `codex/stabilize-independent-club`, PR #1. Il progetto esistente prosegue: non è stato ricreato. Nessuna risorsa, configurazione, segreto, dominio o dato di Security PSG è stato modificato. Nessun deployment pubblico o merge eseguito.

## Stato attuale: piattaforma e gestionale separati

La separazione successiva è descritta in [PLATFORM_SEPARATION_RESULTS.md](PLATFORM_SEPARATION_RESULTS.md). Il Super Admin gestisce soltanto metadati dei club e inviti degli amministratori tramite funzioni server. I ruoli storici non vengono cancellati, ma un'identità Super Admin non può operare nel gestionale, neppure se conserva un vecchio ruolo Admin. Sospensione/scadenza sono verificate dal database e dai controlli server a ogni operazione.

Snoop-pilot è già inizializzato: **non rieseguire l'inizializzazione o il bootstrap del proprietario**. La migrazione di aggiornamento `20261106150000_platform_club_separation.sql` è preparata e collaudata, ma non ancora applicata al database remoto. Anche il deployment richiede autorizzazione distinta. Il file SQL iniziale approvato resta uno snapshot storico; le nuove installazioni richiedono anche le migrazioni successive, in ordine.

## Aggiornamento voce autorizzata

Il profilo vocale è preparato in [VOICE_ACTIVATION_RESULTS.md](VOICE_ACTIVATION_RESULTS.md): Cloudflare Workers AI trascrive IT/ES, mentre campi e comandi sono elaborati localmente nell'applicazione. `AI_VOICE_PROCESSING_ENABLED=true` e `AI_VOICE_ONLY=true` abilitano solo l'audio autorizzato; documenti, browser speech e invio di campi/storia a modelli testuali restano disabilitati. Il codice delle altre integrazioni resta conservato. Non è richiesto alcun nuovo segreto o reset del database; il deployment resta soggetto ad autorizzazione esplicita.

## Cosa è implementato

- Build TanStack Start/Nitro per **Cloudflare Workers**, accanto alla build Node conservata. `wrangler.json` usa esclusivamente il Worker `snoop-pilot`, asset propri e binding `SNOOP_AI`; non contiene domini, D1, KV, R2 o identificativi di altri progetti. Il target pilota rifiuta una configurazione Supabase dedicata mancante, invece di utilizzare quella storica.
- Corretto e collaudato l'errore `createRequire(import.meta.url)` che impediva l'esecuzione SSR in workerd. Il guard è limitato al runtime generato e lascia invariati gli URL dell'app.
- Corrette le autorizzazioni di cataloghi, categorie e quote. Creazione/modifica della risorsa e movimento di inventario sono ora transazioni atomiche. I movimenti concorrenti verificano lo stock atteso, senza perdere modifiche di un altro operatore.
- Le proposte di arricchimento AI del catalogo richiedono conferma; non vengono più scritte automaticamente dopo la creazione. Cataloghi informativi e genetica già esistenti sono mantenuti; non è stato aggiunto alcun flusso di vendita/distribuzione.
- Documenti privati isolati per club, compresi i percorsi precedenti. File e record conservati. I nuovi documenti usano un prefisso di club anche prima della registrazione del socio; un altro club non può firmarne URL o sovrascriverli. I nomi storici ambigui non consentono di rivendicare documenti altrui.
- Il registro autonomo degli incassi, i report e le funzioni amministrative precedenti sono conservati e ricollaudati.
- Inviti e recupero account gratuiti tramite **link monouso**, senza SMTP obbligatorio né password condivise. Nel profilo pilota il link è mostrato esclusivamente all'amministratore autorizzato, che lo consegna al titolare. Il token è nel frammento URL, non nella richiesta HTTP o nel Referer. Il nuovo amministratore sceglie la password nel gestionale. La consegna email preesistente resta disponibile nelle altre configurazioni.
- Corretta la pagina offline con Workers Static Assets: il service worker gestisce la canonicalizzazione `/offline.html` → `/offline` senza conservare una risposta redirect incompatibile con la navigazione offline. Cache solo di risorse pubbliche, aggiornamento su conferma, dati autenticati non conservati nel service worker.

## Hosting gratuito e database dedicato

Configurazioni: [`wrangler.json`](../wrangler.json), [`.env.pilot.example`](../.env.pilot.example). Comandi:

```sh
npm run pilot:database
# Compilare .env.pilot.local solo con il NUOVO progetto SNOOP dedicato.
npm run pilot:secrets
npm run build:worker
npm run worker:dry-run
```

`pilot:database` prepara in `.sandbox/pilot-database/` le migrazioni ordinate, un manifest SHA-256, il bootstrap esplicito del proprietario e dati dimostrativi sintetici. **Non si connette a database remoti.** Il bundle per il primo avvio rifiuta progetti già contenenti tabelle pubbliche o bucket: non va applicato a un progetto esistente. Gli aggiornamenti successivi usano le singole migrazioni, senza reset.

`pilot:secrets` prepara soltanto `.sandbox/pilot-worker-secrets.json`, privato e ignorato da Git; verifica progetto, origine HTTPS `snoop-pilot.…workers.dev` e impostazioni necessarie. Non carica segreti e non crea Worker. La chiave service-role resta sul server; nel browser va soltanto la chiave pubblicabile.

Nel sandbox locale sono già presenti Supabase nativo, tutte le migrazioni e soli dati sintetici. Per ripetere:

```sh
SUPABASE_CLI=/percorso/supabase SANDBOX_WORKDIR=/cartella/privata npm run sandbox:prepare
npm test
npm run typecheck
npm run build:worker:test
SANDBOX_WORKDIR=/cartella/privata npm run test:worker
SANDBOX_WORKDIR=/cartella/privata npm run test:sandbox:ai
```

Il collaudo Workers esegue **workerd locale**, non sostituisce l'intero backend con risposte simulate. Usa un proxy solo locale per collegare il browser al Supabase sintetico sulla stessa origine. Il binding AI remoto viene rimosso dalla configurazione locale: il test non può consumare inferenze Workers AI.

## Workers AI: verificato e non verificato

Schemi e prezzi ufficiali verificati il **5 novembre 2026**:

| Funzione | Modello/profilo | Esito della verifica |
| --- | --- | --- |
| Trascrizione IT/ES | `@cf/openai/whisper-large-v3-turbo` | Scheda ufficiale: audio base64, `language`, task `transcribe`; incluso nell'allocazione gratuita documentata |
| Testo, compilazione e interpretazione | `@cf/meta/llama-3.2-3b-instruct` | Scheda ufficiale: messaggi, JSON schema e strumenti; incluso nell'allocazione gratuita documentata |
| Collegamento al binding | Adapter AI SDK → `SNOOP_AI.run` | PASS nei test locali con binding simulato, inclusi JSON, strumenti, lingue, quota esaurita e autorizzazioni |
| Inferenza e accuratezza reali | Account Cloudflare Free | **BLOCKED:** account/binding remoto autorizzato e credenziali non disponibili; nessun modello remoto è stato invocato |
| OCR documenti e generazione immagini/TTS | Profilo gratuito attuale | Non abilitati/verificati; non sono richiesti per utilizzare i moduli manuali |

Workers AI documenta **10.000 Neurons/giorno**, condivisi dalle funzioni AI dell'account e azzerati alle 00:00 UTC. Sul piano Free, oltre quota le richieste falliscono: non è prevista alcuna attivazione automatica del piano Paid o di crediti. I modelli che richiedono un metodo di pagamento sono esclusi dall'allowlist del profilo. Il limite gratuito non equivale a utilizzo illimitato.

Il codice non richiede una chiave REST Cloudflare nel browser. Per utilizzare solo proposte testuali di catalogo non identificative si potrà autorizzare `AI_EXTERNAL_PROCESSING_ENABLED=true`. **Nel profilo vocale aggiornato, l’audio già autorizzato usa `AI_VOICE_PROCESSING_ENABLED`; `AI_PERSONAL_DATA_PROCESSING_ENABLED=false` continua a vietare l’invio di campi e cronologia ai modelli testuali.** Prima servono verifica delle condizioni/DPA, conservazione e luogo del trattamento: il piano Free non viene presentato come garanzia automatica di trattamento nell'UE. OCR dei documenti resta disabilitato nel profilo Workers gratuito anche con il consenso vocale. Il riconoscimento esterno del browser è disabilitato per impostazione predefinita.

Quota esaurita, provider non disponibile o permesso microfono negato mantengono l'inserimento manuale. Le proposte per soci e cataloghi richiedono revisione/salvataggio espliciti; i comandi amministrativi non certificano un pagamento. I test con provider locale non certificano l'accuratezza dei modelli reali. Prima della commercializzazione vanno verificate anche le condizioni del modello selezionato.

Fonti ufficiali consultate: [prezzi Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/), [schemi pubblici dei modelli](https://github.com/cloudflare/cloudflare-docs/tree/production/src/content/workers-ai-models), [binding](https://developers.cloudflare.com/workers-ai/configuration/bindings/), [limiti Workers](https://developers.cloudflare.com/workers/platform/limits/), [Supabase Free e quote](https://supabase.com/docs/guides/platform/billing-on-supabase).

## Esiti del collaudo

| Verifica realmente eseguita | Esito |
| --- | --- |
| Test automatici, compresi SQL/RLS e Storage multi-club | PASS — 79/79 |
| Gestionale completo su workerd con Supabase locale reale | PASS — 23/23 |
| Endpoint Worker senza autenticazione | PASS — 6/6 respinti |
| Android/iPhone emulati, PWA, permessi e aggiornamento | PASS — 11/11 |
| AI IT/ES, comandi e fallback con provider locale simulato | PASS — 10/10 |
| TypeScript e build Node/Cloudflare | PASS |
| Dry-run Worker | PASS — 840,59 KiB compressi |
| Segreti negli asset pubblici | PASS — 55 file controllati |
| Supabase Free remoto, account Cloudflare e inferenze reali | BLOCKED — credenziali/progetti non disponibili |
| CPU reale Workers Free e telefono fisico/Safari | BLOCKED — richiedono primo deployment autorizzato e dispositivi |
| PNG originali del marchio | BLOCKED — file mancanti |

La matrice e i conteggi dell'ultima esecuzione sono in [`FREE_PILOT_TEST_RESULTS.json`](FREE_PILOT_TEST_RESULTS.json). Distinguono backend nativo, simulazione AI e dispositivi fisici mancanti. Il bundle Worker è stato validato con `deploy --dry-run`, **non pubblicato**. Il limite CPU reale Workers Free (10 ms/richiesta) va controllato sul primo collaudo HTTPS autorizzato: workerd locale e la dimensione del bundle non certificano quel limite sul servizio remoto. Non viene suggerito un upgrade a pagamento come soluzione implicita.

## Sole operazioni esterne necessarie

1. **Account Cloudflare Free dedicato a SNOOP e progetto Supabase Free dedicato**, con uno slot Free disponibile. Supabase concede due progetti Free complessivi per gli account proprietari/amministratori: una nuova organizzazione non aggira quel limite. Se non c'è uno slot disponibile, la creazione rimane bloccata; non sospendere o modificare Security PSG. Se un flusso richiede carta o upgrade, fermarsi: nessuna attivazione a pagamento è prevista.
2. Nel nuovo Supabase vuoto, preferibilmente in una regione UE, applicare il pacchetto preparato; creare il proprio utente Auth e assegnare esplicitamente il primo Super Admin con `bootstrap-owner.sql`. Facoltativamente applicare `synthetic-club.sql`. Non usare dati reali nel collaudo. Configurare Site URL con l'origine HTTPS SNOOP e redirect `/reset-password`; gli inviti manuali non richiedono SMTP. Compilare `.env.pilot.local` con le chiavi del solo nuovo progetto.
3. **Ripristinare i PNG originali del marchio**, ancora assenti dal repository: fornire/esportare i file originali e usare `npm run assets:import`. Non sono stati sostituiti con altri marchi.
4. **Autorizzare espressamente il primo deployment HTTPS di collaudo.** Solo dopo tale autorizzazione, nel corretto account SNOOP: autenticare Wrangler, verificare l'account selezionato, costruire la build pilota, caricare i soli segreti SNOOP e pubblicare il solo Worker `snoop-pilot`. Nessun dominio personalizzato o acquisto è necessario. Wrangler restituirà `https://snoop-pilot.<sottodominio>.workers.dev`.
5. Sul telefono reale, aprire quell'indirizzo e completare login, installazione, permessi e verifica dei limiti/quote del servizio remoto. Per l'AI reale servono inoltre l'abilitazione del binding e le autorizzazioni di trattamento sopra indicate; iniziare con soli campioni sintetici. Finché mancano le garanzie sui dati personali, usare i moduli manuali.

I comandi di pubblicazione, da eseguire **solo dopo l'autorizzazione**, sono:

```sh
npx wrangler login
npx wrangler whoami  # verificare l'account SNOOP, non modificare quello di Security PSG
npm run pilot:database
npm run pilot:secrets
npm run build:worker
npm run worker:dry-run
npx wrangler secret bulk .sandbox/pilot-worker-secrets.json --config .output/server/wrangler.json
npx wrangler deploy --config .output/server/wrangler.json
```

Anche il caricamento iniziale dei segreti può creare una risorsa Worker: **non è stato eseguito**. Non abilitare deployment automatici da push. I segreti JSON e `.env.pilot.local` non vanno caricati su GitHub.

### Installazione sul telefono

- **Android:** aprire l'URL HTTPS in Chrome → menu ⋮ → **Installa app** / **Aggiungi a schermata Home** → aprire SNOOP dall'icona. Consentire microfono/fotocamera solo quando richiesti dall'azione desiderata.
- **iPhone:** aprire l'URL in **Safari** → **Condividi** → **Aggiungi alla schermata Home** → confermare SNOOP e aprirlo dall'icona. La procedura Safari non dipende dal prompt Chromium.
- Prima degli aggiornamenti terminare e salvare il modulo; poi premere **Actualizar app / Aggiorna app**. Senza rete viene mostrata la pagina offline: non vengono accodati pagamenti né registrazioni. Tornando online, riaprire il gestionale e controllare l'esito di un invio interrotto prima di ripeterlo.

Android/iPhone fisici e Safari/WebKit non sono disponibili in questo ambiente. I test iPhone effettuati sono emulazione viewport/user-agent Chromium e non vengono dichiarati certificazione Safari.
