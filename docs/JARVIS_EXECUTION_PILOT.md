# Esecuzione autorizzata JARVIS — candidato isolato

Questo intervento aggiunge un percorso persistente reale, non abilita tutte le
operazioni del gestionale e non abilita scritture nel Pilot attuale.

## Percorso implementato
- `snoop_access_control_status`: lettura tramite la RPC esistente, JWT dell'utente.
- `snoop_access_control`: prepara la modifica del controllo entrate (non QR di
  dispensazione). Proposta booleana rigorosa; amministratore pilota verificato.
- UI di conferma separata dal modello; token casuale di singola operazione, mai
  trasmesso al modello o nei log. Doppio invio non produce una seconda esecuzione.
- `voiceAccessOperation`: trasporto server user-scoped, nessuna service-role key;
  timeout, redirect rifiutati, schema del risultato e identificativo verificati.
- `snoop_voice_access`: registro persistente e transazione che richiama
  `snoop_set_club_access_control`, poi rilegge con `snoop_get_club_access_control`.
  Non duplica la logica delle impostazioni e non riscrive servizi manuali.
- Autore/club, valore originale, valore richiesto, data di preparazione/completamento
  e risultato conservati. Tabelle di audit senza privilegi diretti per il client,
  RLS attivo, RPC con controlli amministrativi anche nel database.
- Chiave persistente; lock della richiesta e del club; conferma scaduta o stato
  cambiato rifiutati; errore della RPC annulla insieme impostazione e completamento.
- Il gateway restituisce `completed` al modello soltanto dopo la risposta verificata
  della RPC. Il vecchio `AppActionResult completed` dal browser resta vietato.
- Risposta persa dopo il commit = `uncertain`, mai retry automatico. Pulsante
  `Verifica esito` legge il registro; non ripete la modifica. Non annunciare una
  nuova esecuzione quando si consulta un risultato storico.

## Protezioni e limiti
Il tool di scrittura non è offerto senza `SNOOP_VOICE_EXECUTION_PILOT_ENABLED=true`.
Il flag non è stato configurato su Cloudflare. Si mantengono allowlist utente/club,
consenso e dati sintetici del Pilot; REAL rimane invariato.

La migrazione unica `docs/sql/SNOOP_VOICE_EXECUTION_REVIEW_ONLY.sql` è preparata ma
NON applicata. Prima dell'applicazione verificare conflitti di nomi, disponibilità
delle due RPC esistenti, current_club_id/is_current_user_club_admin/can_operate_club
e backup delle definizioni. Se una dipendenza manca, la transazione si interrompe.
Non eliminare o rieseguire migrazioni esistenti. Nessuna modifica a contabilità,
stock, ordini, Monedero, Socio o Security PSG.

## Evidenze riproducibili
`node --test tests/voice-execution.test.mjs` usa PostgreSQL/PGlite isolato con ruoli,
club e utenti sintetici, importando le vere RPC get/set esistenti. Verifica lettura,
nessuna modifica prima della conferma, persistenza riletta, replay, autorizzazioni,
RLS/privilegi del registro, stale state, scadenza, rollback e risposta persa dopo commit.
Il trasporto HTTP è un adapter di test verso quel database, non Supabase remoto.

`node scripts/test-deepgram-app-worker.mjs --execution --close-retry` e variante
`--compiled` verificano il gateway Workerd, doppia conferma, risposta al provider
solo dopo esecuzione e lettura esito. Provider e backend HTTP di questi test sono
sintetici; non confonderli con la verifica PostgreSQL separata.

`node scripts/test-deepgram-app.mjs --execution-ui` verifica conferma e stato incerto
nei quattro profili Chromium/WebKit. Gateway e audio sono sintetici. Il test nativo
`--native-audio --startup-only` verifica separatamente cattura e rendering PCM.
Non certificano microfono fisico, Deepgram reale, qualità linguistica o accuratezza.

## Ambito ancora non implementato
Questo contratto può ospitare altri adapter, ma non dichiara implementati rinnovi,
registrazione persistente soci, variazioni stock, transazioni ordini/Monedero o cassa.
Occorrono adapter specifici sulle rispettive API/RPC e test transazionali dedicati;
non estendere automaticamente la conferma di un'impostazione a operazioni economiche.
La riconnessione mantiene i vincoli precedenti; la risoluzione di operazioni persistenti
oltre ricaricamento completo richiede ancora una vista dei propri risultati pendenti.
Il controllo esito nella sessione corrente è implementato, non un nuovo report.

## Blocco del collaudo online
Richiede autorizzazione separata per applicare la sola nuova migrazione, abilitare il
flag per il Pilot autorizzato e rilasciare il commit esatto dopo CI. Non sono stati
eseguiti push, merge, deployment, nuove credenziali o chiamate Deepgram reali.
Non è disponibile una sessione Ddr autenticata o un telefono fisico nel workspace.

Rollback: disabilitare prima il solo flag vocale e ripristinare il precedente codice
verificato. Conservare registro e RPC per audit/riconciliazione: non eliminare dati
né invertire automaticamente impostazioni che un amministratore abbia poi modificato.
