# SNOOP — revisione annullamenti contabili e rimborsi dichiarati

**Stato: implementazione amministrativa verificata; richiesta complessiva NON completata.** Il ripristino automatico delle scorte di cannabis e l'annullamento automatico generico delle altre attività non sono implementati. I PASS sotto riguardano esclusivamente le funzionalità indicate, non l'intero flusso vendita–stock richiesto.

## Funzioni effettivamente implementate

- Il collaboratore con permessi `manage_members` e `use_cash` può stornare contabilmente soltanto le proprie registrazioni. Un collaboratore autorizzato alla lettura dei report non acquisisce il diritto di stornare operazioni altrui. L'amministratore del club può intervenire anche sulle registrazioni degli altri operatori. Club inattivi, altri club e account di piattaforma rimangono esclusi.
- Un solo componente e una sola RPC per i due storici esistenti: ficha del socio e Historial → Últimas actividades → Ver todas. Pulsante `Anular operación`, conferma e motivo obbligatorio. Nessuna nuova pagina o menu; grafica premium conservata.
- Stato **ANULADO** rosso, originale conservato e una rettifica negativa immutabile. `Detalles de anulación` espone operatore e data originali, importo, autore/data/motivo dello storno, riferimento e fotografia documentale dei prodotti/quantità originali. La fotografia non modifica l'inventario.
- Lock della riga, vincolo UNIQUE e replay idempotente impediscono duplicazioni. Identità, club, importi, quantità documentali e date derivano dal database; non sono parametri modificabili dal frontend.
- Registro separato e immutabile del **rimborso integrale già eseguito**, con conferma esplicita dell'utente, metodo reale e motivo. Non esegue trasferimenti, pagamenti o restituzioni di contanti: registra una dichiarazione dell'operatore, non una conferma di un provider. Importo ricavato dalla rettifica originale, unico rimborso per rettifica, protezione da doppi clic e richieste concorrenti.
- La rettifica originale non viene aggiornata per aggiungere il rimborso. La nuova tabella `financial_order_refunds` rappresenta il movimento distinto richiesto, non una duplicazione del registro esistente. Il suo inserimento è riservato alla funzione verificata lato server; non sono concessi INSERT/UPDATE/DELETE agli utenti autenticati.

## Caja e tracciabilità

I totali contabili netti escludono gli originali annullati. Non viene sottratto nuovamente il delta della rettifica né il rimborso, evitando doppi conteggi. Originale, rettifica e rimborso dichiarato rimangono consultabili separatamente nei report esistenti.

Un rimborso dichiarato in contanti è associato alla sessione aperta dell'utente verificato, se presente; altrimenti rimane fuori sessione. È una distinta uscita del cassetto, non un nuovo importo negativo nei ricavi netti. Il saldo atteso considera questo movimento solo quando i dati del cassetto sono determinabili. Se un ordine annullato della sessione non ha un metodo di pagamento originale verificabile, non viene inventato un saldo: la riconciliazione resta non determinabile e richiede revisione. Il fondo iniziale non diventa un incasso.

Lo schema attuale degli ordini non registra il metodo di pagamento. Non vengono reinterpretati retroattivamente i dati né presunti pagamenti in contanti. Il rimborso supportato è integrale: rimborsi parziali e trasferimenti effettivi tramite provider non sono implementati.

## Migrazione esistente aggiornata — NON APPLICATA

È stato modificato lo stesso file `docs/sql/SNOOP_FINANCIAL_REVERSALS_PROPOSED.sql`, senza creare una seconda migrazione concorrente. Contiene una sola transazione: audit contabile, nuovi permessi dell'autore e registro distinto dei rimborsi. Nessun backfill o cancellazione di movimenti storici; nessuna modifica alle policy delle tabelle esistenti. Nuove tabelle con RLS, chiavi per club e immutabilità. Se la proposta risulta già installata o sono presenti trigger UPDATE sconosciuti, si interrompe senza applicazione parziale.

Verifica reale del 09/11/2026: GET dell'esatto progetto `bnwanxbmprbymbutoths` e unicamente SELECT dei cataloghi di sistema. Risultato: progetto Snoop-pilot verificato, tabelle `financial_order_reversals` e `financial_order_refunds` assenti, dipendenze di piattaforma presenti, unico trigger UPDATE degli ordini `orders_updated` → `tg_set_updated_at()`. Evidenza: `SNOOP_ANNULMENT_SCHEMA_CHECK.json`. Non sono state lette anagrafiche, documenti o righe finanziarie reali. Le prove sui dati impiegano soltanto fixture sintetiche.

La compatibilità è stata provata localmente con lo schema iniziale completo e con la variante contenente la precedente proposta amministrativa. Rimane preservato il calcolo del totale nella transazione iniziale di creazione; riscritture successive di importo, autore o data sono bloccate.

## Prove effettivamente eseguite

| Prova | Esito e ambito |
|---|---|
| Suite automatica completa | PASS 263/263, fixture sintetiche |
| TypeScript, build Node e build Workers locale, bundle pubblico | PASS; nessuna chiave privata nei 73 artefatti controllati |
| Autore, amministratore, collega abilitato alla cassa/report, altro club, Super Admin | PASS su PostgreSQL/PGlite locale; il collega abilitato non può stornare né registrare rimborsi altrui |
| Originale e rettifica immutabili, motivo obbligatorio, replay, rollback | PASS, SQL reale locale |
| Fotografia documentale dei prodotti/quantità | PASS; nessun reintegro stock |
| Rimborsi integrali dichiarati, importo server, metodo obbligatorio, secondo rimborso respinto | PASS su database locale e UI con API simulate |
| Fallimento della registrazione del rimborso | PASS: nessun rimborso salvato, rettifica precedente invariata |
| Accesso ai propri movimenti di cassa senza accesso all'audit del socio | PASS, policy PostgreSQL locali |
| Due storici, doppio clic, errore con motivo conservato, schema non attivato | PASS, 10 casi Chromium viewport Samsung/WebKit iPhone |
| Caja, rinnovi, storico e tastiera | PASS nelle rispettive regressioni browser |
| Sconti, home, navigazione, profilo e logout | PASS nelle rispettive regressioni browser |

### Contesa reale tra connessioni

`test:annulment:concurrency` avvia un PostgreSQL **17.11** isolato in Docker, senza rete né porte pubblicate e con dati sintetici. Una connessione mantiene il lock della riga mentre altre sei invocano la stessa funzione. Sono state osservate vere attese sui lock tramite `pg_stat_activity`:

- Annullamento contabile: 7 connessioni, 6 attese osservate, una sola rettifica.
- Registro del rimborso: 7 connessioni, 2 attese osservate, una sola dichiarazione di rimborso.

Il controllo finale verifica importo originale invariato, delta contabile esatto, rimborso unico e stock invariato. Non è una prova di restituzione dello stock né di pagamento reale. Il container e il relativo volume sono rimossi al termine. Evidenza: `FINANCIAL_CONCURRENCY_RESULTS.json`. Il controllo è aggiunto alla CI mantenendo gli altri test.

Screenshot realmente renderizzati con dati sintetici: `annulment-{samsung,iphone-webkit}-{member,detail,activity}.png` e `annulment-{samsung,iphone-webkit}-owner-{member,detail}.png`.

## Requisiti non completati — nessun PASS implicito

- **Ripristino automatico dello stock:** non implementato. Le quantità di cannabis disponibili per la distribuzione non vengono ricostituite automaticamente. I test accertano la conservazione dello stock corrente, anche dopo un successivo cambiamento di valore, non il reintegro richiesto.
- **Compensazione automatica dei movimenti d'inventario:** non implementata. Nessun movimento fisico viene generato dall'annullamento contabile.
- **Ripristino di aggiornamenti prodotto:** non implementato. Il codice attuale non conserva una fotografia verificabile dei valori precedenti; non viene sovrascritto lo stato corrente inventando valori passati.
- **Annullamento generico di qualsiasi attività o quota:** non implementato. Non si riutilizza la RPC degli ordini per modificare iscrizioni, inventario o aggiornamenti prodotto.
- **Audit delle compensazioni di stock:** non presente, perché tali compensazioni non vengono create. Rimangono originali, rettifica contabile e dichiarazione separata del rimborso.
- **Pagamenti/rimborsi fisici, hardware Samsung/iPhone:** non verificati. I browser sono simulazioni di viewport; la restituzione di denaro è una dichiarazione esplicita dell'utente.
- **Migrazione/deployment:** non eseguiti. Prima dell'attivazione online servono autorizzazioni specifiche sulla revisione aggiornata del file SQL e sulla pubblicazione. Nessun merge o intervento su Security PSG.
