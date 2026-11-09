# Annullamento contabile condiviso — SNOOP

## Implementazione

I due punti esistenti, **Ficha del socio → Historial de pedidos** e **Historial → Últimas actividades** (`/actividades`), aprono lo stesso `FinancialRecordDialog`. Il dettaglio dalla pagina attività risolve il socio sul server con il JWT dell'utente e riutilizza `memberOrderHistory`. Entrambe le viste invocano esclusivamente `annulMemberFinancialRecord` → `annulFinancialRecord` → `annul_financial_order`.

Solo un amministratore del club attivo, con gestione soci e cassa, può confermare. Il motivo è obbligatorio (5–2000 caratteri). L'originale rimane visibile con **ANULADO in rosso**; il dettaglio mostra autore/data/importo originali, amministratore/data/motivo dell'annullamento, riferimento e importo della rettifica. Le liste aggiornano il proprio contenuto dopo la conferma. Nessun nuovo menu o archivio.

Il campo `canCancel` resta falso quando la nuova tabella non è disponibile: la vecchia RPC non viene chiamata come alternativa senza rettifica. Un errore conserva il motivo. Dopo una conferma riuscita, un errore nella rilettura non riabilita il pulsante per una seconda operazione.

## Unica migrazione proposta — NON APPLICATA

`docs/sql/SNOOP_FINANCIAL_REVERSALS_PROPOSED.sql`:

- Una transazione atomica, applicabile una volta, dipendente dallo schema SNOOP e dalla separazione piattaforma/club. Provata localmente sia con sia senza la precedente proposta `SNOOP_ADMINISTRATIVE_RECORDS_PROPOSED.sql`. Non richiede di rieseguire le migrazioni precedenti e non attiva né sostituisce la conferma delle quote associative.
- Aggiunge le colonne di audit se mancanti e una tabella `financial_order_reversals`, con una sola rettifica per ordine, collegamento al club, importo originale e delta negativo. Nessun backfill, cancellazione, modifica di importi storici o delle RLS esistenti.
- Il trigger affidabile registra la rettifica nella stessa transazione dell'annullamento. Solo esso può inserire; i normali utenti non possono creare, modificare o cancellare rettifiche. Ulteriore trigger protegge l'immutabilità anche da aggiornamenti diretti privilegiati.
- Identità e date sono derivate dal server. Le future registrazioni conservano il calcolo iniziale del totale nella transazione di creazione; modifiche successive dell'importo, dell'autore, della data o dell'associazione al club/sessione sono bloccate. Questo evita di rompere l'RPC già esistente che inizializza il totale e lo calcola prima del commit.
- I nomi degli operatori vengono fotografati al momento dell'annullamento e rimangono stabili anche se cambia il profilo. Non si ricostruiscono nomi storici precedenti non registrati.
- Lock sulla riga, vincolo UNIQUE e replay idempotente: la stessa richiesta ritornata per un problema di rete non genera un secondo storno; un nuovo annullamento con motivo o amministratore diverso viene respinto.
- Un errore nell'inserimento della rettifica provoca rollback anche dello stato dell'operazione. Trigger UPDATE sconosciuti e ripetizione della migrazione causano interruzione, senza applicazione parziale.

## Report e inventario

I totali netti della Caja continuano a conteggiare soltanto operazioni completate. La rettifica NON viene sommata di nuovo a questi totali: lo storno non è sottratto due volte. Dentro lo stesso Informe de caja vengono mostrati originale e rettifica, anche quando registrati in date diverse, consultabili sul giorno originale e sul giorno della rettifica.

I riepiloghi di Informes escludono anche le righe appartenenti a ordini annullati e leggono tutte le pagine degli ordini e dei dettagli nel periodo. Nessuna modifica ai dettagli o all'inventario storico. Una rettifica contabile non costituisce rimborso fisico: non viene simulato un pagamento di ritorno. I conteggi del cassetto restano separati dai totali contabili netti.

Lo stock e i movimenti d'inventario non vengono reintegrati, riscritti o cancellati. Una eventuale rettifica fisica deve seguire il flusso di inventario già esistente, con quantità effettivamente verificate.

## Verifiche eseguite

| Verifica | Esito | Evidenza |
|---|---|---|
| Suite automatica completa | PASS, 258/258 | `npm test` |
| PostgreSQL/PGlite, due varianti dello schema | PASS | `tests/financial-reversals.test.mjs` |
| Amministratori, collaboratori, altro club e Super Admin | PASS | JWT/RLS reali nel PostgreSQL locale |
| Motivo obbligatorio, doppio annullamento/replay, immutabilità | PASS | RPC e trigger reali locali |
| Rollback della rettifica fallita, nessun restock | PASS | Stato originale e inventario confrontati prima/dopo |
| Logica server condivisa + report su date diverse | PASS | Client di test che esegue SELECT e RPC su PostgreSQL locale mantenendo il ruolo/JWT |
| Creazione iniziale compatibile, modifica storica respinta | PASS | Transazione iniziale e aggiornamento successivo separati |
| Browser Chromium viewport Samsung e WebKit iPhone | PASS, 10 casi | `FINANCIAL_ANNULMENT_BROWSER_RESULTS.json` |
| Annullo da entrambe le viste e rilettura dell'altra | PASS | Due registrazioni sintetiche, due sole rettifiche |
| Errori, motivo conservato, doppio clic, schema non attivato | PASS | API intercettate, nessuna produzione |
| Report Caja e Informes escludono gli annullati | PASS | Controllo UI e integrazione server/PostgreSQL |
| Regressione storico/iscrizione/rinnovo/tastiera | PASS, 6 casi | `test:records:browser` |
| Regressione Caja | PASS, Samsung e WebKit | `test:cash:browser` |
| Regressione sconti | PASS, 6 casi | `test:discounts:browser` |
| Home, navigazione, profilo, logout | PASS, 6 viewport | `test:premium:home`, compreso WebKit |
| TypeScript e build | PASS | `typecheck`, `build` |
| Bundle pubblico | PASS, 73 artefatti | `test:security:bundle` |

Screenshot di interfacce realmente renderizzate con dati sintetici: `annulment-{samsung,iphone-webkit}-{member,activity,detail}.png`.

## Limiti e attivazione

- Nessuna verifica su dispositivi fisici; Samsung/iPhone sono viewport Chromium/WebKit. Le prove browser intercettano le API. Le prove database impiegano PostgreSQL locale, non Supabase remoto.
- La migrazione NON è stata applicata al progetto reale; senza la sua approvazione e successivo deployment la nuova rettifica non è attiva online.
- Gli annullamenti anteriori privi di rettifica restano distinguibili con dati non registrati; non vengono inventati storni retroattivi.
- Ambito: registrazioni già confermate di `orders` nei due storici. Non viene annullata automaticamente l'iscrizione di un socio né emesso un rimborso.
- Nessun merge, deployment, cambio di segreti, account o accesso a Security PSG.

## Stabilizzazione della prova WebKit generale

La prima CI del commit `4044cc9` ha superato tutti i dieci casi nuovi di annullamento e le regressioni degli storici, ma ha segnalato un errore CORS su una richiesta attività `members` nel test generale `test-snoop-completion.mjs`, durante le transizioni tra ruolo amministratore e collaboratore e accessi diretti a pagine protette. Le API erano intercettate: non era una risposta RLS di Supabase reale.

La fixture ora attende contenuto della home e letture indipendenti prima di chiudere il documento e cambiare ruolo. Ogni verifica di accesso diretto parte da una nuova pagina dello stesso contesto autenticato. È stata introdotta latenza di 250 ms nelle risposte attività per esercitare il caso asincrono. Le asserzioni su errori, permessi, assenza di scritture, OTP monouso e password non sono state rimosse o attenuate; nessun aumento dei timeout. Prova locale finale PASS su Android Chromium, emulazione iPhone e WebKit. Nessuna modifica alle RLS o all'autenticazione dell'app per aggirare il problema del test.
