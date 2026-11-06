# Gestionale in sviluppo con database locale

`npm run dev` avvia il gestionale vero, non `offline.html`. La configurazione
Supabase tracciata esistente non è un database di collaudo verificato: non usarla
per prove con nuovi account o dati.

Per un backend indipendente, installare Docker e la CLI Supabase ufficiale
(verificata 2.75.0), poi:

```sh
npm run sandbox:prepare
npm run dev:sandbox
```

La preparazione usa un progetto locale dedicato `club-hub-gold-sandbox`, applica
le migrazioni alle sue tabelle locali e crea l'associazione e l'amministratore
fittizi. Non usa `--linked`, non invoca progetti remoti e non modifica `.env`.
Log e credenziali restano privati nella directory `.sandbox`, esclusa da Git;
la password non viene mostrata nei log. La configurazione generata è
`.env.sandbox.local`, anch'essa ignorata da Git. Una directory di utenti già
popolata senza il file delle credenziali non viene modificata automaticamente.

Sono configurabili `SUPABASE_CLI` (percorso del binario) e `SANDBOX_WORKDIR`
(directory dedicata). Nell'ambiente di questa sessione sono stati predisposti
`/workspace/.club-sandbox-tools/bin/supabase` e `/workspace/.club-hub-sandbox`.
La CLI usa le immagini ufficiali su Docker Hub: il registro predefinito ECR
risulta bloccato dalla policy di rete. Il primo avvio richiede il download delle
immagini. I log possono contenere chiavi locali: non pubblicarli né commetterli.

Il browser usa `/sandbox-api`, inoltrato da Vite al backend locale: dal telefono
non deve collegarsi al proprio `localhost` per accedere al database. Il backend
e la chiave service-role restano nel processo server.

Per il telefono serve un URL HTTPS di anteprima inoltrato alla porta 3000,
inclusi WebSocket e `/sandbox-api`. Impostare `DEV_PREVIEW_ORIGIN` all'origine
fornita dalla piattaforma prima di avviare Vite. Non usare gli IP privati del
container come se fossero raggiungibili dalla rete del telefono. Per email e
reset configurare anche l'origine pubblica autorizzata nel backend locale.

Nella sessione corrente `sites-preview status` e `sites-preview start` segnalano
`preview relay unavailable`: non è disponibile un URL pubblico verificato.
Occorre ripristinare/abilitare il servizio di anteprima della piattaforma; la
sola apertura di un server sulla porta 3000 non crea un collegamento pubblico.
L'avvio locale non costituisce un deployment.

AI, invio email esterno e loghi originali richiedono ancora le configurazioni e
i file descritti in `ADMINISTRATIVE_RUNTIME.md`. Il backend locale non rende
automaticamente disponibili questi servizi e non deve contenere dati reali.

## Esito verificato in questa sessione

- Vite in ascolto sulla porta 3000: pagina reale `/auth` HTTP 200 e login
  renderizzato nel browser con viewport mobile, senza mock della pagina.
- Test di sviluppo: rimozione del precedente service worker offline, mantenimento
  delle cache non appartenenti all'app e rifiuto HTTP dei file privati sandbox.
- 55 test automatici e TypeScript superati.
- Modalità `sandbox` senza file generato: avvio rifiutato, senza ripiegare sulla
  configurazione Supabase preesistente.
- Database locale NON avviato: Docker `vfs` esaurisce lo spazio durante
  l'importazione di `supabase/postgres:17.6.1.075` (`no space left on device`).
  Le immagini degli altri servizi sono state scaricate, ma non costituiscono
  un backend funzionante. I tentativi ripetuti sono stati interrotti.
- Login con account fittizio e schermata principale autenticata: NON ESEGUITI.
  Non esiste ancora un account demo utilizzabile; non usare account o dati reali.
- Collegamento dal telefono: BLOCCATO dal relay delle anteprime indisponibile.
  Non è stato generato un URL pubblico, né avviato alcun tunnel alternativo.

Per completare il collaudo occorre ripristinare il relay e aumentare lo spazio
Docker dell'ambiente (o fornire un diverso ambiente Docker adeguato). In alternativa
si può usare un progetto Supabase **separato e destinato ai test**, con configurazione
pubblica e service-role inserite nelle impostazioni sicure, mai in chat o in Git.
Il progetto indicato dall'attuale `.env` non è stato utilizzato per il collaudo.
La sola immagine della pagina login non equivale a un gestionale testabile dal telefono.
