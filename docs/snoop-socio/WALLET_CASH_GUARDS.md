# Verifiche obbligatorie nella transazione Monedero

Le nuove funzioni in `apps/socio/wallet-cash-guards.mjs` esprimono i vincoli di autorizzazione di **cassa, turno e ordine**, validabili in isolamento. Non sono in uso nell'app live.

**Ricarica:** verifica club e membro, permessi staff derivati da JWT, sessione cassa `open`, nessuna chiusura registrata, ora di apertura antecedente all'operazione e corrispondenza fra collaboratore e apertura sessione. Il turno è determinato esclusivamente dalla sessione effettiva; non ci sono orari standard o chiusure automatiche a mezzanotte.

**Consumo:** deve riguardare un ordine completato del club e socio giusto e non già pagato in contanti o addebitato. L'importo coincide con quello dell'ordine. Se l'ordine è completato prima dell'addebito, la transazione reale deve verificare che non esista un pagamento precedente e bloccare l'ordine.

**Annullamento:** ordine cancellato, movimento `spend` originario dello stesso socio, club, ordine e importo; storno unico per ordine e addebito. Il rimborso del wallet deve essere coordinato con il ripristino stock e il registro cassa per non duplicare restituzioni.

**Regola essenziale:** queste funzioni NON sostituiscono il controllo nel database. La futura RPC deve leggere e bloccare le righe correnti `cash_sessions`, `orders`, `members`, `socio_wallet_accounts` e `socio_wallet_ledger` **all'interno della stessa transazione PostgreSQL**. Eseguire soltanto verifiche prima dell'RPC introdurrebbe una race condition. Nessuna modifica al database esistente è stata autorizzata o applicata.
