# Emissione del codice temporaneo di associazione socio

Il club espone **un solo QR di installazione pubblico**. Il codice qui descritto serve **solo** quando un socio autenticato deve associare la propria tessera a un club e non esiste una conferma indipendente dell'indirizzo email registrato nel club.

`apps/socio/claim-challenges.mjs` crea 24 byte di casualità crittografica, mostrati allo staff come codice esadecimale di 48 caratteri, validità 10 minuti. Il database riceve solo SHA-256 con prefisso di contesto. Il controllo staff e il club sono verificati dal server e devono essere riesaminati **nella stessa transazione** di creazione del codice (non fidarsi di `staff` passato dal client).

Nel flusso di consumo, `claimAndConsumeLinkChallenge` deve confrontare l'hash, bloccare la riga, verificare la scadenza, il socio e il club, il limite monouso e la proprietà della tessera, quindi inserire il collegamento verificato in un'unica transazione. Non utilizzare email o numero socio come unica prova di proprietà; non esporre il contenuto della tabella `socio_member_claim_challenges` a utenti ordinari.

**Stato:** test sintetici, non integrato nel server gestionale, nessun codice reale emesso e nessuna modifica al database.
