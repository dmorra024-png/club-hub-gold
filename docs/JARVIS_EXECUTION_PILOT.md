# JARVIS — registro condiviso di lettura ed esecuzione

Ramo di sviluppo isolato. Nessuna migrazione applicata da Codex, nessun flag attivato,
nessun merge o deployment. Non è certificazione di parità completa con l'app manuale.

## Meccanismo comune implementato
`execution-registry.ts` definisce nomi, schemi, permessi e RPC delle capacità.
`snoop_execute` accetta solo una capacità registrata: niente URL, SQL o nomi RPC liberi.
Il gateway risolve riferimenti temporanei ottenuti da letture autorizzate, ricontrolla
identità/club e prepara il comando. Il modello non riceve token di conferma.

Una sola tabella e una sola RPC transazionale (`snoop_voice_command`) gestiscono:
preparazione, token, scadenza, conferma, annullamento della proposta, idempotenza,
lock, audit, lettura dell'esito e verifica della persistenza. `snoop_voice_access`
rimane un wrapper compatibile, non un secondo motore. Dopo errori di rete l'esito
è incerto: si legge il registro, senza retry automatici della scrittura. Annullare
una proposta non annulla né rimborsa un'operazione già completata.

Il tool può confermare al modello solo l'esito verificato dal server. Il browser
non può promuovere il vecchio `AppActionResult` a `completed`.

## Operazioni persistenti collegate e provate su SQL isolato

| Capacità | API/RPC riutilizzata | Verifica |
|---|---|---|
| Controllo entrate attivo/disattivo | snoop_set_club_access_control | Rilettura del valore, audit e replay |
| Categoria: rinomina, archivio, ripristino | manage_administrative_category | Nome/stato riletti; prodotti e stock conservati |
| Descrizione informativa prodotto | save_administrative_product_checked | Descrizione riletta; stock, prezzi e movimenti invariati |
| Rinnovo quota socio | confirm_membership_with_receipt | Socio/piano/scadenza, membership_operations e ricevuta effettiva; importo ricavato dal piano |

Per i prezzi legacy frazionari, la vecchia RPC catalogo non accetta la rappresentazione
esistente: l'adapter si ferma prima della conferma; non arrotonda e non corregge prezzi.
Normalizza solo valori matematicamente interi e ne verifica l'invarianza dopo il salvataggio.
Non vengono inventati importi, metodi di pagamento o quantità.

I controlli SQL rispettano i permessi specifici; è verificato anche un collaboratore
catalogo autorizzato, e il rifiuto senza permessi. L'amministratore può consultare
l'audit di altri operatori dello stesso club senza confermarne le richieste.
L'allowlist vocale del Pilot resta amministratore Ddr: nessuna apertura globale.

## Letture collegate
`snoop_records_search`: soci, prodotti, categorie, stock e quote. JWT utente,
club esplicito, proiezioni limitate, massimo sei risultati più indicazione di troncamento.
La ricerca soci usa la nuova RPC read-only POST: nomi nel corpo, mai nell'URL.
La RPC è SECURITY INVOKER e usa RLS oltre al controllo del club e di manage_members.
I nomi e i dati personali dei soci sono mostrati solo nell'app autenticata; al modello
vanno riferimenti anonimi. Catalogo, stock e quote restituiscono solo i campi non
personali richiesti. Le unità stock provengono dalla categoria; se mancanti non vengono
inventate. La memoria dei riferimenti è limitata alla connessione e pulita alla chiusura.

Sono mantenuti i servizi vocali preesistenti di cassa giornaliera/intervallo, navigazione,
bozze, vocabolario e fonti botaniche. Nessuna seconda logica contabile o wallet.

## Evidenze e limiti della verifica
- Suite unit/integration e TypeScript; build Node e Worker, dry-run.
- PostgreSQL/PGlite isolato: RPC originali applicate dal repository, persistenza reale,
  RLS, privilegi, conferma, prezzo cambiato, token errato, cancellazione, replay,
  rollback, risposta persa dopo commit, cross-club per ogni nuova operazione.
- PostgreSQL 17 in Docker con rete none: sette sessioni concorrenti, attese su lock
  osservate, un solo rinnovo/ricevuta/audit e importo 1000 centesimi una sola volta.
- Workerd sorgente/compilato: lettura, riferimenti tipizzati, conferma ed esito server,
  doppio clic, controllo stato e cancellazione; upstream HTTP/provider sintetici.
- Chromium/WebKit: quattro profili Samsung, iPhone, desktop e tablet; riepilogo socio,
  piano, importo e metodo, conferma, cancellazione e stato incerto. Provider sintetico.
- Percorso PCM nativo e regressioni dei moduli preesistenti verificati separatamente.

Non è stata misurata l'accuratezza STT reale, la latenza Deepgram o l'udibilità fisica.
Nel workspace e nei file di configurazione previsti non sono presenti DEEPGRAM_API_KEY,
credenziali Cloudflare utilizzabili o una sessione autenticata Ddr. Nessuna chiave
nuova creata o estratta. Non creare endpoint pubblici di diagnostica per aggirare il blocco.

## Parti ancora non collegate a scrittura
Creazione/modifica persistente anagrafica socio, creazione completa prodotto, rettifiche
stock, transazioni ordini, scritture Caja e Monedero non sono implementate nel registro.
I flussi manuali restano quelli esistenti, con controlli e conferme originali.
La registrazione manuale controlla documenti, firma e campi obbligatori del club che
la vecchia RPC da sola non verifica completamente: esporla direttamente aggirerebbe
quelle protezioni. Occorre prima un validatore server condiviso e integrazione con gli
input umani esistenti. Non vengono fabricate firme, documenti o accettazioni.
Non è aggiunta automazione di distribuzione di sostanze regolamentate.

La risoluzione dopo un completo ricaricamento dell'app richiede ancora una vista delle
richieste pendenti: il controllo esito nella sessione attiva è implementato. Non
presentare una richiesta preparata/cancellata come operazione completata.

## Attivazione e rollback
`snoop_execute` resta disabilitato senza SNOOP_VOICE_EXECUTION_PILOT_ENABLED=true.
Il flag non è stato configurato. La proposta SQL unica
`docs/sql/SNOOP_VOICE_EXECUTION_REVIEW_ONLY.sql` sostituisce quella precedente NON
applicata da Codex. Se è stata applicata da altri, il controllo iniziale si ferma:
serve un upgrade revisionato, non eliminare il registro né rieseguire la proposta.
Verificare prima schema reale, dipendenze RPC e conflitti. Nessuna migrazione automatica.

Il futuro rilascio richiede autorizzazione specifica, CI sul commit esatto, preflight
binding/secret protetto e allowlist Pilot invariata. REAL rimane disattivato.
Rollback: disabilitare il solo flag e ripristinare il codice verificato; mantenere
registro/RPC per audit e riconciliazione. Non invertire dati o movimenti automaticamente.

## Extension after cfe78658

The authoritative action list is now `JARVIS_CAPABILITY_MATRIX.json`: 21 persistent
commands, seven bounded record search kinds and a shared detail inspector. The earlier
"not connected" section is superseded for member card edits, human-input-free eligible
registrations, product creation/metadata, audited physical inventory correction and
cash/wallet operations listed in that matrix. Remaining operations are explicit there.

For basic CRUD, the private `snoop_voice_entity` helper performs the same table
operations as the existing manual PostgREST APIs and retains their constraints/audit.
It is not granted to users. The single public command RPC still owns authorization,
confirmation, idempotency, stale-state locking, atomic execution and durable results.
Original catalog/membership/stock/wallet RPCs remain authoritative for their operations.

The review-only proposal has additional schema prerequisites: discounts, assignments
and member field configuration. Missing prerequisites fail before installation. Cash
writes additionally fail without the existing session audit trigger. Wallet commands
are hidden and refused when the original wallet feature gate is disabled. No previous
migration is rerun and no dependency is silently installed on production.

Wallet recharges require a separately checked receipt acknowledgment, validated by
both the gateway and the command RPC and timestamped server-side. A model cannot
manufacture the user's confirmation token. Credits are not a claim that SNOOP has
initiated or completed an external card/transfer payment.

Verified completion refreshes only the relevant existing screen via its scoped read
port. Financial views reuse the existing records-changed event. There is no page
reload, extra save, accounting formula change or replacement of the manual handlers.

The new Workerd `--database` mode invokes the real isolated SQL ledger and original
RPCs through the actual gateway and HTTP transport. Provider and identity upstreams
are synthetic; this is still not a real Deepgram or physical-phone test.
