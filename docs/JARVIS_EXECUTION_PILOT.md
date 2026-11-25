# JARVIS — esecuzione autorizzata e collaudo

## Stato e base effettiva

PR #27; applicazione pubblicata di riferimento `459303a` (PR #63), sorgenti
`a410848`, con avalador, doppio stock e Finanzas. L'elenco effettivo dei 29 comandi
è in `JARVIS_CAPABILITY_MATRIX.json`; non equivale a certificazione di parità totale.
Nessun merge, deployment, attivazione REAL o scrittura su database reale da questo ramo.

## Unico meccanismo

`execution-registry.ts` definisce input/output Zod, permessi, riferimenti e RPC.
Il gateway verifica JWT, club e allowlist Pilot; risolve riferimenti anonimi emessi
solo dal server. Nessun URL/SQL/RPC libero, nessuna conferma generata dal modello.
`snoop_voice_command` prepara, conferma, cancella la proposta, recupera e riconcilia
l'esito con lock, snapshot, scadenza, audit e chiave persistente. Un esito incerto
si risolve leggendo lo stato, mai ripetendo automaticamente la scrittura.
`completed` richiede la rilettura effettiva del risultato; il browser non può
fabbricarlo con `AppActionResult`. Le funzioni e i controlli manuali restano intatti.

## Operazioni collegate

- Soci: ricerca privata POST, scheda/storico, modifiche anagrafiche consentite,
  registrazione compatibile con avalador e campi del club, rinnovi e ricevute.
- Quote e sconti: creazione/modifica, attivazione, validità e assegnazione/rimozione.
- Catalogo: categorie, archiviazione/ripristino, schede prodotto, descrizioni e prezzi
  in centesimi; nuovo prodotto con posizione esplicita e zero stock.
- Stock: consultazione totale, ubicazioni riconciliate e storico. Rettifica legacy
  provata solo sullo schema legacy; sul doppio stock si ferma prima della modifica.
- Caja: apertura/chiusura sessioni, fondo/conteggio/note e audit originale; report
  Madrid per giorno, periodo, sessione e collaboratore autorizzato. Nessun turno fisso
  o cassa notturna. Fondo iniziale distinto dagli incassi e dai conteggi.
- Monedero: configurazione club, saldo, storico ricariche, ricarica e storno attraverso
  le RPC originali. Il rimborso richiede l'attestazione che sia già avvenuto; SNOOP
  registra la prova, non esegue un pagamento bancario/POS.
- Finanzas: fornitori, spese, annullamento spesa e registrazioni di acquisti previsti;
  non genera pagamenti, ordini prodotto, movimenti inventario o movimenti Caja.
- Collaboratori: consultazione privata; modifica permessi/revoca del ruolo del club
  solo da admin, senza modificare admin, Auth, email, password o altri club.
- Navigazione, bozze, correzioni, ricerca del catalogo e informazioni botaniche con
  fonti restano sulle porte autorizzate delle schermate esistenti.

## Recupero e interfaccia

Solo UUID dell'operazione in sessionStorage, isolato per utente/club: niente token,
trascrizioni o dati del modulo. Dopo riavvio/riconnessione il server restituisce
stato e nuova revisione. Una proposta scaduta non viene eseguita; un completamento
non viene ripetuto. Nuova conferma manuale richiesta per le proposte ancora valide.
Disabilitare il flag blocca le scritture ma consente di riconciliare uno stato già
registrato. Il gateway ricontrolla il gate Monedero anche sulle conferme recuperate.
Gli esiti verificati aggiornano soltanto la vista corrente attraverso letture scoped.

## SQL: proposta unica, NON applicata

`docs/sql/SNOOP_VOICE_EXECUTION_REVIEW_ONLY.sql` è la proposta coordinata, non un
upgrade da eseguire alla cieca. Il preflight rifiuta un registro già esistente;
non cancellare tabelle né rieseguire vecchie migrazioni. Le copie SQL avalador,
located product e Finanzas sono sorgenti già presenti nel ramo del proprietario,
usate come fixture: NON sono nuove migrazioni da applicare nuovamente.
La migrazione voice_usage_budget già applicata non viene riapplicata.
La verifica readonly dei metadati reali ha restituito HTTP 401: compatibilità dello
schema installato non attestata e nessuna sostituzione di credenziali.

## Limiti che non vanno nascosti

Non sono introdotte automazioni di distribuzione di prodotti regolamentati o checkout
vocale di tali prodotti. I flussi manuali restano disponibili.
Documenti, firma, foto, scelta file e credenziali richiedono gli input umani originali.
Inviti Auth/email non hanno un contratto di replay duraturo verificabile nei servizi
esistenti: la bozza resta disponibile, l'invio non viene dichiarato eseguito da JARVIS.
Le rettifiche localizzate richiedono la definizione verificata delle RPC attualmente
installate, non accessibile con la connessione Supabase che risponde 401.
Le impostazioni non registrate non sono esposte tramite un esecutore arbitrario.

## Collaudo e rilascio successivo

`JARVIS_EXECUTION_RESULTS.json` distingue SQL reale isolato, browser e provider
sintetici da Deepgram e dispositivi fisici. I test PCM misurano segnale e frequenza
nel vero Web Audio di Chromium/WebKit; non certificano altoparlanti o microfoni fisici.
La prova reale richiede sessione Pilot autenticata autorizzata e Deepgram esistente;
non si estraggono chiavi dal Worker e non si creano endpoint pubblici di diagnostica.

Dopo approvazione dello schema e dei test sul commit esatto, il futuro rilascio richiede
un'autorizzazione specifica e il preflight dei binding protetto. REAL resta disattivato.
Rollback: disabilitare il flag di esecuzione e ripristinare il bundle verificato;
conservare registro e risultati per audit, senza invertire operazioni automaticamente.

## Latest published-source reconciliation

The last actual upload is `3e7487088396cbd21edc99d454d88d9418dad0bb`, workflow
`45459564392` (Almacén). The earlier integrated upload was `ce9259b1d5a4f757057c1e4b7902bc3e6b26c9ae`,
workflow `45381805328`, following `459303a` / `45381047028`. The warehouse branch
used an older voice/member base. This development reconciliation preserves its
connected WarehousePanel and order euro-input fix while retaining integrated
avalador, audio/execution, Finanzas and the idempotent located-product creation RPC.
No release branch was merged and no Worker was uploaded by this work.

The owner location SQL is now available as source and is tested only locally. Its
stock movement trigger always affects Dispensario; it does not provide an explicit
warehouse physical-count correction. The legacy voice correction remains blocked
on this schema. Missing location rows become zero only when the installed-schema
conservation rule and exact nonnegative sum uniquely reconcile to the product total.
HTTP errors and mismatches never become zero. No transfer automation is introduced.

The theme command uses only the seven current curated themes. Tests load the owner's
existing policy as a fixture and verify two independent clubs; no production RLS is
changed. The member-requirements read returns current required/optional/disabled
field keys before asking registration questions, without returning member data.


L'invito App Socio corrente resta quello manuale autenticato a sei cifre. Il vecchio
invio QR email è ritirato dall'interfaccia e non viene aggiunto a JARVIS.
La fixture di registrazione ora verifica il contratto avalador attuale: nessun
fallback a RPC ritirate, nessuna riduzione dei controlli su importo o doppio clic.
