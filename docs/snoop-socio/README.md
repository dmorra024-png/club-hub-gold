# SNOOP Socio — progettazione isolata (non pubblicata)

Stato: **design only / nessun deploy, merge o modifica al database**. Ramo `feature/snoop-socio-app-design-20261117` creato separatamente per futura revisione di Codex. Non toccare il lavoro parallelo JARVIS 3.

## Visione approvata
- Un'unica PWA SNOOP Socio, distribuita ai soci di tutti i club aderenti a SNOOP.
- Un solo QR stampato nel club apre una pagina HTTPS di installazione della PWA. È un QR **di distribuzione**, condivisibile, senza identificativi privati. Installazione PWA su Android e istruzioni per "Aggiungi alla schermata Home" su iOS.
- Prima apertura: **Iniciar sesión** oppure **Registrarse**. Registrazione con email già presente in una scheda socio, nuova password, verifica email. Le email sconosciute non possono vedere dati dei soci.
- Un account autenticato può avere più iscrizioni, anche in club differenti; **Mis clubes** è nel menu dei tre puntini in alto. Ogni club espone **QR personale differente**, numero socio, stato iscrizione e Monedero solo se abilitato dal relativo club.
- All'avvio dopo la prima associazione: schermata diretta con QR dell'ultimo club selezionato, senza login ripetitivo finché la sessione è valida. La sessione viene comunque revocata su logout o dispositivo compromesso.
- Design: premium blu/oro come SNOOP; nessun riferimento alla cannabis, nessuna navigazione sul pannello amministrativo. Interfaccia spagnola di default, localizzabile IT/EN.
- Il club A **non conosce** l'adesione del socio al club B, né il saldo B; il socio vede solo le proprie iscrizioni verificate.
- Nessun accesso automatico ottenuto dalla sola uguaglianza dell'email: la email è un indice di possibile match, non una prova dell'appartenenza.

## Percorso utente
1. Il club espone il QR di installazione (stessa destinazione per tutti i suoi soci; un indirizzo globale per la PWA).
2. Il socio apre il link, installa se desidera e sceglie registrazione o login.
3. Conferma l'email tramite sistema Auth. La registrazione non dà permessi operativi SNOOP.
4. Si elencano le adesioni collegabili con una procedura **verificata**, che non espone quali club possano avere quella email finché l'identità non è validata. Richiesto controllo contro omonimie, email condivise e inserimenti errati. Possibile emissione di breve codice di associazione in presenza da parte del club per il primo collegamento, senza inviare tessere né dover ripetere la registrazione.
5. Una volta collegata la prima membership, si apre direttamente il suo QR. Se una seconda membership viene registrata successivamente nello stesso club o in un altro club, il sistema propone una nuova associazione verificata; solo dopo compare in Mis clubes.
6. Il cambio club cambia QR, numero socio, stato e (se attivo) saldo, senza mescolare i contesti.

## Prodotti distinti
- SNOOP Gestionale: gestione soci, stampa cartello installazione, eventuale associazione/verifica del socio, lettura QR in dispensazione, gestione Monedero autorizzata.
- SNOOP Socio: login, QR, Mis clubes, saldo/storico informativo per singolo club, account/uscita.

## Cosa NON fa questo ramo
- Non aggiunge schermate o dipendenze al gestionale attuale.
- Non crea migrazioni o nuove tabelle nel DB di produzione.
- Non invia email, non crea QR reali, non pubblica app e non esegue ricariche.
- Non abilita accesso automatico ai dati per email coincidente.

Documenti: [architettura e sicurezza](ARCHITECTURE.md), [UX e criteri di accettazione](UX_ACCEPTANCE.md), [contratti e piano Codex](IMPLEMENTATION_PLAN.md).
