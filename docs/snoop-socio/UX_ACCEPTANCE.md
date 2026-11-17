# UX SNOOP Socio — schermate e accettazione

## 0. Identità visiva
Lingua principale ES, IT/EN opzionali. Colori blu notte + oro SNOOP, typography premium, pulsanti grandi touch, accessibilità e contrasto. No banner, marketing invasivo, foto prodotti, riferimenti weed, richieste di permessi non necessarie.

## 1. Installazione tramite QR unico
Cartello: `SNOOP SOCIO · Escanea para instalar`, un URL pubblico HTTPS canonico che non cambia per i soci. Android Chrome: `Instalar` se browser e PWA lo consentono, altrimenti `Añadir a pantalla de inicio`. iOS Safari: istruzioni `Compartir → Añadir a pantalla de inicio`. Mai fingere installazione nativa. L'app deve poter funzionare anche dal browser.

## 2. Autenticazione
Prima schermata `Iniciar sesión` / `Registrarse`. Registrazione: email, password, conferma password; spiegazione che l'email deve coincidere con quella fornita al club. Verifica email, reimposta password, cambio email con verifica. Messaggi anti-enumerazione: non svelare pubblicamente se email o membership esistono. Feedback accessibile; tastiera non copre campi su iOS. Non creare un socio fittizio se la membership manca.

## 3. Prima associazione
Dopo conferma email, sistema informa `Vincula tu carnet del club` se non ci sono membership già verificate. Il socio può completare una prova di appartenenza verificata, eventualmente usando un codice breve ricevuto sullo schermo presso il banco, senza invio di QR personale via email. Non rivelare dati di club che non gli appartengono. Una volta verificato, il QR appare automaticamente.

## 4. Home QR (schermata predefinita)
Header: `SNOOP`, nome del club corrente e menu `⋮` in alto a destra. Grande QR centrale dinamico, indicatore di aggiornamento/scadenza, `Nº socio`, stato membership e una breve istruzione `Muestra este código al personal`. QR aggiornato senza refresh dell'intera pagina. Se club sospende/annulla la membership, il QR non viene emesso e lo stato è spiegato.

## 5. Menu tre puntini
- `Mis clubes`: elenco solo delle membership verificate (nome/logo/stato), selezione immediata di un club.
- `Mi perfil`: email e impostazioni account non operative.
- `Idioma`: ES/IT/EN.
- `Cerrar sesión`: cancella access token e preferenze sensibili locali.

Se il socio è iscritto a club A e B, dopo selezione B cambiano QR, numero socio, stato e Monedero; riaprendo l'app mostra B se ancora autorizzato. Club A non può consultare B.

## 6. Monedero
Solo quando abilitato dal club selezionato, mostra `Saldo monedero`, unità in euro/crediti secondo policy club e link `Movimientos`; consultazione, nessuna ricarica autonoma non approvata. Storico: data, descrizione, variazione, saldo post-operazione e stato. Non mostrare un saldo di esempio come saldo reale.

## 7. Errore rete / sessione
Con connessione assente, schermata esplicita, nessun QR dinamico falsamente valido. Token scaduto o autenticazione revocata -> schermata login. Se aggiornamento QR fallisce, non riutilizzare un token vecchio.

## Matrice minima di collaudo affidata a Codex
- Nuovo socio, email verificata, membership valida: registra account, verifica associazione, QR valido.
- Email esistente in Club A e nuova iscrizione in Club B: stesso account, due link verificati, due QR e due eventuali saldi distinti.
- Altra persona usa email coincidente o per errore inserita dal club: non ottiene accesso senza prova aggiuntiva.
- Club A prova a scansionare QR di B: rifiuto cross-club; screenshot di token scaduto: rifiuto.
- Revoca socio o sospensione: blocca nuove emissioni QR; Monedero non accessibile.
- Doppio tap cambio club, refresh, background/resume, connessione lenta, rete offline.
- Login Android Chrome, iOS Safari home screen, desktop; installazione PWA tramite QR.
- Integrazione futura con gestionale e Monedero verificata solo in staging separato: zero cambi a produzione fino a revisione e autorizzazione.
