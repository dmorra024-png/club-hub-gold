# JARVIS — copertura verificabile del ramo di sviluppo

## Base realmente pubblicata e riconciliazione

L'ultimo upload verificato è `3e7487088396cbd21edc99d454d88d9418dad0bb`, workflow
`45459564392` (Almacén). Quel ramo deriva da una base precedente all'integrazione
JARVIS `ce9259b1d5a4f757057c1e4b7902bc3e6b26c9ae` / workflow `45381805328` e alla
versione `459303a122ce5ae560712a234098deb20b43fae4` / workflow `45381047028`.
La riconciliazione conserva WarehousePanel e il fix euro degli ordini dell'ultimo
upload, insieme a correzioni audio/JARVIS, avalador, Finanzas e creazione prodotto
idempotente con posizione esplicita. Non sostituisce il ramo pubblicato.
`apps/socio`, contabilità, formule Caja e API Monedero restano invariati.

## Registro comune e persistenza

`JARVIS_CAPABILITY_MATRIX.json` deriva dagli schemi e permessi effettivi: 29 comandi
amministrativi registrati, ricerche bounded e ispettori condivisi. Ogni capacità ha
input/output Zod, autorizzazione, riferimenti emessi dal server, conferma manuale,
chiave persistente, lock, verifica dello snapshot, audit e rilettura del risultato.
Un risultato `completed` dal browser resta rifiutato; il modello non riceve il token.
Dopo un errore di rete si legge l'esito, senza ripetere automaticamente la scrittura.
Le operazioni usano le RPC originali o le stesse operazioni CRUD delle API manuali.
Il singolo helper privato non è concesso agli utenti e non espone SQL/RPC arbitrarie.

## Capacità amministrative

- Soci: configurazione reale dei campi richiesti/facoltativi/disabilitati, ricerca
  privata POST, scheda e storico, modifiche consentite, registrazione eleggibile con
  avalador, rinnovi e ricevute. Documenti, firma ed età non vengono inventati.
- Quote e sconti: creazione, modifica, attivazione, validità e assegnazione/rimozione.
- Catalogo: categorie, archivio/ripristino, schede prodotto, descrizioni e prezzi in
  centesimi. Nuovo prodotto con destinazione esplicita e zero stock iniziale.
- Stock: totale, ubicazioni e storico. Le somme usano millesimi esatti. Una riga
  mancante è zero solo se la conservazione del totale lo dimostra; errori HTTP e
  mismatch non diventano zero. La rettifica legacy è bloccata sul doppio stock:
  il trigger originale aggiorna sempre Dispensario, non un conteggio per ubicazione.
- Caja: apertura/chiusura di sessioni, fondo, conteggio e note; report Madrid per
  giorno, periodo, sessione e collaboratore verificato. Nessun turno fisso o notturno.
- Monedero: configurazione club, saldo, storico ricariche, ricarica e storno mediante
  le RPC originali. L'operatore attesta l'incasso o rimborso già avvenuto; SNOOP non
  avvia pagamenti POS/bancari. Storico e movimento originale sono conservati.
- Finanzas: fornitori, spese, annullamento spesa e acquisti amministrativi previsti;
  non genera ordini prodotto, pagamenti, movimenti stock o movimenti Caja.
- Collaboratori: ricerca privata, modifica dei permessi o revoca del ruolo nel club
  solo da admin, con conferma e controllo di modifiche concorrenti. Non modifica
  ruoli admin né cancella utenti Auth.
- Tema: selezione delle sette palette esistenti, conferma e rilettura del tema;
  policy del proprietario verificata su due club sintetici, senza modificare RLS reale.
- App Socio: conservato l'invito autenticato a sei cifre del flusso manuale corrente.
  Il vecchio invio QR email non viene reintrodotto come nuovo comando JARVIS.
- Navigazione, ricerche, bozze, correzioni e consultazione botanica con fonti rimangono
  sulle porte autorizzate e sulle schermate esistenti, senza click DOM simulati.

## Recupero e audio

Solo UUID dell'operazione in sessionStorage, per utente e club: niente token,
trascrizioni o dati del modulo. Riavvio e reload recuperano l'esito dal server e
richiedono nuovamente conferma per una proposta valida. Una proposta scaduta non è
eseguita, un completamento non è ripetuto. Le viste si aggiornano tramite letture
scoped senza reload automatici. Gli ascolti non rimangono nascosti in background.
Deepgram, endpointing 0.85/5000 ms, vocabolario e voce restano quelli esistenti.
I test Web Audio misurano PCM non nullo, frequenza, ripresa dopo sospensione e
interruzione. Non certificano microfono, altoparlante o qualità STT/TTS fisica.

## Evidenze e vincoli residui

`JARVIS_EXECUTION_RESULTS.json` distingue PostgreSQL/Workerd/browser reali isolati da
provider/autenticazione sintetici. Il flusso gateway completo verifica anche
registrazione e annullamento spesa con esito persistito, senza doppia esecuzione.
La matrice non dichiara parità completa né abilita automaticamente la produzione.
Non vengono introdotte automazioni di distribuzione/checkout di prodotti regolamentati.
Documenti, firma, file, credenziali e inviti Auth/SMTP senza contratto di replay
verificabile rimangono nei flussi umani originali. Le impostazioni non registrate
non sono esposte tramite esecutori arbitrari.
La richiesta readonly ai metadati Supabase ha risposto HTTP 401. Le definizioni stock
pubblicate sono disponibili e provate localmente; lo schema effettivamente installato
resta da verificare. Non sono state estratte o sostituite credenziali.
La proposta SQL unica NON è applicata; voice_usage_budget non viene riapplicata.
REAL, merge e deployment restano disattivati/non eseguiti. Servono revisione dello
schema reale e autorizzazione specifica prima del futuro rilascio del commit esatto.

## Regressione CI individuata sul primo push

Run `45572454853`, `test-member-administration.mjs:231`: mancata navigazione dopo
la conferma. La schermata invocava correttamente `snoop_register_member_with_avalador`,
ma la fixture riconosceva soltanto le precedenti RPC e restituiva un array vuoto.
Il controllo applicativo di `savedId` rifiutava correttamente quell'esito non verificato.
La fixture ora valida le cinque chiavi attuali, identità/club/importo/request ID e
rifiuta il contratto di creazione ritirato; rinnovi e controllo del doppio clic restano.
Anche i test di assenza di salvataggi vocali riconoscono la nuova RPC come scrittura.
Nessun timeout allungato, controllo di sicurezza rimosso o falso successo introdotto.
