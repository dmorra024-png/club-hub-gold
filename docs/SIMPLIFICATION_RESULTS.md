# SNOOP — semplificazione verificata

- Una sola Caja: “Mi caja” e “Informe de caja”. Rimossi turni fissi, UUID, avvisi tecnici, report per turno e schede duplicate. `/cuotas` torna alla Caja; registrazione e rinnovo soci mantengono il flusso esistente.
- Apertura e chiusura passano dal server con utente/club verificati. Il report mostra sessioni, responsabili disponibili, date/orari Europe/Madrid, importi e movimenti del giorno, anche senza sessione. Deduplicazione per fonte, esclusione dei pedidos annullati e del fondo iniziale dagli incassi. Lettura paginata oltre 1.000 movimenti; nessun nuovo RPC dei turni richiesto.
- Eliminati menu e pagina dell'archivio separato: `/geneticas` porta a Productos senza leggere, copiare o cancellare il vecchio archivio. Il motore foto/fonti non è stato modificato. ✨ funziona sulla stessa scheda, anche in editing, con proposta correggibile, annullamento e conferma esplicita. Nessun prodotto duplicato.
- Microfoni del modulo prodotto collegati al Whisper già autorizzato, al posto del riconoscimento browser disabilitato. Frasi complete e correzioni IT/ES compilano i campi esistenti localmente. Una trascrizione tardiva non sostituisce una modifica manuale; nessun salvataggio vocale automatico.
- Conservati i controlli di accesso, l'isolamento tra club, lo stile e la navigazione inferiore SNOOP. Gli importi/draft restano montati durante la verifica dell'accesso; i dati di una sessione/club diverso non vengono riutilizzati.

## Verifiche effettive

- **222/222 test automatici PASS**, compresi test di sicurezza e PostgreSQL isolato.
- **TypeScript e build produzione PASS**.
- **Chromium Samsung e WebKit iPhone PASS**: Caja apertura/chiusura/nuova apertura da altro collaboratore, report sessioni e giornata, fuori sessione, dati propri, assenza di turni e UUID.
- **Browser PASS**: tastiera simulata, campi visibili, barra inferiore nascosta durante digitazione, nessun hard reload nei casi testati, errore/retry, ripristino della rotta e confronto home/Caja.
- **Voice PASS con audio/trascrizioni sintetici**: frase completa Mario Rossi, mic interno al campo prodotto, nome/categoria/quantità, “stock zero”, correzioni singole, modifiche manuali conservate, permessi e annullamento del microfono.
- **Browser PASS**: gestione soci/rinnovi, categorie, prodotti, stock/storico, inviti, profilo, proposta ✨ modificabile e salvata nella stessa scheda; vecchio archivio assente, nessuna scrittura al suo database.

Le prove browser usano trasporto/API sintetici; PostgreSQL usa lo schema reale in PGlite con auth/storage locali. Non sono test su hardware fisico o servizi di produzione. Risultati: `CAJA_BROWSER_RESULTS.json`, `CRITICAL_BROWSER_RESULTS.json`, `GENETICS_BROWSER_RESULTS.json`, `VOICE2_ADMINISTRATIVE_BROWSER_RESULTS.json`; screenshot reali renderizzati `docs/screenshots/caja-simple-*.png` e `critical-keyboard-*`.

## Limiti dichiarati

1. **Autore della chiusura:** lo schema esistente non contiene `closed_by`. Non viene inventato né retrocompilato: lo storico senza quel dato mostra “No registrado”. [SNOOP_CASH_SESSION_AUDIT_PROPOSED.sql](sql/SNOOP_CASH_SESSION_AUDIT_PROPOSED.sql) aggiunge solo il campo e un trigger di audit server per le nuove operazioni. È testato localmente, ma **non applicato**. Servono autorizzazione e verifica del database reale per attivare questa persistenza. Il trigger non cambia policy né movimenti/contabilità e impedisce di falsificare autore/orari.
2. **Fotografie generate:** il flusso configurato non ha un modello di generazione immagini: i modelli verificati nel codice sono Llama per il testo e Whisper per l'audio. La funzione attuale cerca foto riutilizzabili e consente upload manuale; non produce fotografie artificiali né le presenta come autentiche. Non è stata verificata dal vivo una capacità/quota di generazione immagini, né sono stati abilitati modelli o costi aggiuntivi.
3. **Telefoni e voce reali:** accuratezza dei nomi pronunciati, microfono fisico, sospensione/terminazione del processo da Android/iOS e consegna AI dal servizio reale richiedono collaudo sul dispositivo. Non sono dichiarati risolti con simulatori.

Nessun deployment, merge, SQL remoto, modifica a segreti, account, permessi o Security PSG. Le funzioni SQL dei turni già installate e i dati dell'archivio restano nel database; non vengono usati dall'interfaccia semplificata.
