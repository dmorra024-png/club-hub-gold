# Architettura e sicurezza — SNOOP Socio

## Confini di isolamento
La nuova PWA deve avere **entrypoint, routing e deployment separati** dal gestionale, pur riutilizzando il backend Supabase con nuova superficie API strettamente dedicata. Preferire nuovo Worker Cloudflare con nome, ambiente e segreti distinti (da definire prima del deploy). Niente cambi alla tabella `members` o agli endpoint JARVIS senza revisione specifica.

## Modello concettuale (non SQL da applicare)
- `socio_accounts`: riferimento all'identità Auth Supabase, email verificata, lingua, preferenze; NON ruoli di club admin.
- `socio_membership_links`: riferimento `auth_user_id`, `club_id`, `member_id`; stato `pending/verified/revoked`, metodo di verifica, timestamp, revoche, unicità per membership. Non usare email come chiave univoca tra club.
- `socio_link_challenges`: hash dei token, scadenza breve, tentativi limitati, origine club e membro, consumed_at; validazione lato server con audit. Codice opzionale verificabile al banco quando la semplice email non basta.
- `socio_qr_sessions`: se materializzata, solo nonce/hash, membership, scadenza e revoca (o meglio token firmati di breve durata con revocation support); non memorizzare token in chiaro.
- `socio_wallet_ledger` e `socio_wallet_accounts`: **solo specifica separata**, non implementare prima del controllo contabile e normativo; saldo per (club_id,member_id), crediti interi in centesimi, ledger append-only, correlazione alle operazioni di cassa.
- `club_member_portal_config`: abilitazione app/Monedero per club, personalizzazione consentita, eventuali limiti.

Le tabelle sopra sono **proposte**. Eseguire confronto con migrazioni, vincoli, RLS e RPC già presenti prima di materializzarle.

## Associazione identità / membership
1. Auth verifica il controllo dell'email (email+password con conferma).
2. Il backend cerca eventuali membership collegate all'email solo in un processo non enumerabile e senza comunicare risultati a utenti non verificati.
3. Email verificata non autorizza da sola il collegamento: usare prova aggiuntiva o un processo di conferma robusto e auditabile per prevenire errore del personale, account con email condivise, furto di indirizzi, import legacy. Possibili challenge di associazione a scadenza breve emesse al socio presente nel club e registrate da staff autorizzato; la PWA non deve obbligare a inviare QR via messaggistica.
4. Verifica permessi e validità dell'iscrizione a OGNI accesso a QR/Monedero; revoca immediata dell'associazione e controllo sessioni.
5. Se lo stesso account ha adesioni multiple, `Mis clubes` mostra soltanto quelle verificate. L'ultimo club selezionato è preferenza locale non prova di autorizzazione.

## QR
- Distinguere nettamente **QR di installazione statico** (URL pubblico della PWA) e **QR membership dinamico** (token opaco breve).
- Il QR membership non espone nome, email, telefono, documento, numero socio in chiaro o dati del wallet. Il numero socio può apparire come testo nel display autenticato, non nel payload QR.
- Token cifrato AES-256-GCM opaco (senza UUID leggibili dal QR), vincolato a club e singola membership; lifetime ridotto (es. 30–60 s da validare) + rotazione visibile con gestione rete. Preferire scadenza e nonce anti-replay, lato server con controllo club dell'operatore e ruolo; non considerare scansione = consenso a operazione economica.
- QR acquisito con screenshot deve perdere validità rapidamente; eventuali screenshot di sessioni recenti non possono autorizzare ricariche/ordini autonomamente.
- Offline: mostra stato esplicito `Sin conexión`, non promettere un QR valido se non può essere aggiornato/validato.
- Su iOS PWA consentire uno sblocco sessione quando OS interrompe l'app. Non chiedere nuovi permessi inutili.

## Monedero
- Un saldo distinto per ciascuna membership, senza trasferimenti fra club.
- Non riutilizzare `orders.total_cents` come denaro incassato quando ordini sono coperti da crediti.
- Distinguere contabilmente versamento/ricarica (eventuale ingresso di cassa) da consumo del credito (passività/saldo diminuisce; non nuovo incasso), secondo il modello contabile e legale approvato.
- Ledger immutabile: rettifiche come movimenti compensativi, non update/delete; idempotency key per ogni comando e transazione atomica contro doppi addebiti e saldi negativi.
- Permessi minimi e audit di staff, ricariche/rettifiche/conferme; saldo socio read-only.
- Prima di implementare conversione 1 credito=1 euro o uso per dispensazione, ottenere revisione giuridica e contabile per la giurisdizione reale dei club. Non trattare i crediti come moneta elettronica senza valutare la disciplina applicabile.

## RLS e API
- Tutti i dati membership/wallet filtrati sia per identità socio autenticata sia per membership verificata.
- Il club selezionato proviene da un link verificato, mai da un `club_id` arbitrario del client.
- Endpoint operatori esistenti continuano a usare permessi club, mai il solo account Socio.
- Bloccare enumerazione per email, bruteforce di challenge, IDOR cross-club; registrare audit senza audio o credenziali.
- Preferire schema SQL e policy con `SECURITY INVOKER`; ogni funzione privilegiata richiede revisioni dedicate. Testare RLS con due club e due utenti.
- Nessuna modifica alle strutture di autenticazione operativa del gestionale senza piano di migrazione.

## Consenso e dati
Privacy by design: QR senza PII, no analytics di terze parti sui dati soci, sessioni/registro audit minimizzati, possibilità revoca collegamento e eliminazione nei limiti degli obblighi di conservazione; testo privacy e condizioni del club da predisporre prima del go-live.
