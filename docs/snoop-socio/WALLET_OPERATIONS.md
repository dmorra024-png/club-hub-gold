# Monedero — isolata la logica delle operazioni

`apps/socio/wallet-operations.mjs` è **un boundary server-side non collegato al gestionale**. Modella i tre casi: ricarica associata alla sessione cassa, consumo associato a un ordine, e rimborso associato a un ordine annullato e al suo precedente addebito. Non autorizza transazioni dalla PWA socio.

## Condizioni non negoziabili
1. Il personale è autenticato **lato server** nel club corrente, con permessi distinti `wallet_topup`, `wallet_spend`, `wallet_refund`. I permessi devono essere mappati e verificati contro l'attuale modello del gestionale prima dell'integrazione.
2. Il club deve aver abilitato il Monedero: in tal caso è l'unico metodo ammesso per i movimenti dei soci nel flusso concordato. La valutazione legale/accounting va completata prima dell'attivazione.
3. Il turno di ogni collaboratore coincide con **la propria sessione di cassa**: inizia all'apertura effettiva e termina alla chiusura effettiva, senza fasce orarie fisse. La ricarica deve essere associata a una sessione di cassa effettivamente aperta, del club e collaboratore autorizzati; deve rifiutare una cassa chiusa o di un altro club. Il riepilogo giornaliero aggrega le sessioni pertinenti, anche se gli orari variano e se un turno attraversa la mezzanotte.
5. L'RPC database deve impegnare **atomicamente** verifica dei permessi, stato attivo socio, stato cassa, ordine e annullamento; blocco della riga wallet; saldo e ledger; unicità globale del `operation_id` e unicità per ordine/transazione di rimborso.
5. Il pagamento del socio non può causare conteggio doppio: ricarica può essere entrata di cassa, utilizzo di crediti NON è una seconda entrata di contanti. Storno ordine deve ripristinare crediti e stock tramite l'operazione contabile già prevista, non duplicare il rimborso in contanti.
6. Il ledger è **append-only**, mai modificare/eliminare un movimento. Le correzioni creano nuove scritture con riferimento all'operazione originaria; i saldi non possono essere negativi.
7. Chiamate duplicate (anche con connessione instabile) restituiscono il risultato originale senza riaddebito. Per evitare ripetizioni con nuovi operation ID, il DB deve imporre vincoli su (club, order, kind), non basta l'idempotenza della richiesta.
8. Un account socio NON può effettuare ricariche, pagamenti o rettifiche: l'app soci espone soltanto i dati leggibili tramite RLS, filtrati per iscrizione verificata.

I test attuali sono **sintetici, in memoria**, e validano il contratto di input/permessi e la separazione club. Non dimostrano ancora transazioni concorrenti reali. Nessuna migrazione, merge o deployment è stato eseguito.
