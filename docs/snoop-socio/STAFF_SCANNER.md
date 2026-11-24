# Scanner QR del socio — entrata HTTP staff isolata

L'app del socio emette QR temporanei cifrati per un club e un membro specifico. Il personale autenticato del gestionale usa **un ingresso distinto** `POST /api/snoop-scan/verify` per convalidare i QR: `apps/socio/staff-scanner-http.mjs`.

Il server verifica identità reale staff, club, permesso di scansione, origine e struttura del token, poi chiama `service.scan`: autenticità e scadenza del QR, stato attivo socio, consumo atomico del nonce per impedire scansioni ripetute. Ritorna solo identificativi `clubId` e `memberId`, **nessun documento personale, nessun saldo, nessuna operazione finanziaria**.

Il QR è una tessera per la dispensazione e non un controllo d'ingresso al club. La funzione non concede accesso alla tessera di un club differente, e la scansione non addebita automaticamente il Monedero. Eventuali addebiti richiedono il processo d'ordine confermato da personale autorizzato.

**Rimane isolato:** non è collegato alla UI/scanner del gestionale online, e l'adapter Supabase attuale rifiuta le scritture finché non esiste il replay store approvato. Test sintetici: HTTP, staff, scope club, token AES-GCM e replay una tantum. Prima dell'attivazione implementare una transazione reale con vincolo unico nonce e audit del personale.
