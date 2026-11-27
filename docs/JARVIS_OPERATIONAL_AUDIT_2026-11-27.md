# JARVIS Pilot — audit operativo e semplificazione (27 novembre 2026)

## Decisione
Conservare il Voice Agent Deepgram e il database SNOOP. NON introdurre un secondo agente, un secondo parser globale o nuovi percorsi di scrittura. Usare il registro `execution-registry.ts` per ogni operazione persistente, il modulo di lettura autorizzato per le consultazioni e la navigazione esistente per aprire pagine.

## Osservazioni nel codice (non equivalgono a collaudo sul telefono)
- `deepgram-app-gateway.ts` instrada più tipi di funzioni: letture, proposte/draft, shortcut browser ed esecuzione. Il client `DeepgramPilotVoice.tsx` ha anche una fase di applicazione della proposta. Occorre evitare richieste duplicate.
- `agent-settings.server.ts` contiene un prompt operativo molto grande, con regole per varianti verbali: è una superficie fragile da ridurre **solo dopo test di comportamento**.
- `SNOOP_VOICE_EXECUTION_PILOT_ENABLED` condiziona `snoop_execute`; la sua presenza nel codice NON prova che il flag sia attivo sul Worker pubblicato.
- `stock.adjust` è definito con importo del movimento `delta`, note esplicite, permesso `manage_products` e conferma obbligatoria. I valori vengono verificati dal server; NON scrivere direttamente attraverso una nuova scorciatoia.
- La schermata stock utilizzava una selezione del primo prodotto con nome parzialmente corrispondente; ciò poteva indirizzare un movimento al prodotto sbagliato.
- Il parser del formulario non gestiva con affidabilità una classificazione dettata da sola come «sativa» o «cambia a híbrida».
- La normalizzazione delle ricerche socio non copriva varie frasi naturali. Il nome deve sempre essere cercato tramite la RPC autenticata e limitata al club.

## Patch isolata in questo ramo
1. Dettatura sativa/indica/híbrida in turni successivi; campo proposto soltanto, nessun salvataggio automatico.
2. Ricerca nomi soci: elimina prefissi vocali ma preserva cognomi reali come «De Luca».
3. Movimento stock: corrispondenza esatta unica; se ambiguo mostra candidati e richiede scelta e conferma. Nessuna modifica alla RPC o ai permessi.
4. Test di regressione dedicati per queste operazioni.

## Gate ancora aperti
- CI completo, typecheck e test browser/mobile reali prima del merge.
- Verificare su Cloudflare Pilot lo stato del flag `SNOOP_VOICE_EXECUTION_PILOT_ENABLED` e la compatibilità delle RPC senza attivare scritture.
- Inventariare ogni tool con contratto input/output, permessi, conferma e unica UX di errore.
- Fare prove E2E multi-turno con dati sintetici per: cerca socio, apri scheda, nuovo prodotto, sativa/indica/híbrida, aggiungi/togli stock, caja, informe.
- Solo dopo risultati verdi, rimuovere i parser e le istruzioni duplicate, un percorso per volta, non con una sostituzione generale.

## Ambito proibito a questa PR
Nessun deploy, alterazione voce/Deepgram, flag di esecuzione, SQL, database, ordini, saldi, wallet, socio o Worker REAL.

**Stato:** audit e patch preparati; il completamento funzionale del collaboratore IA non è ancora dimostrato.
