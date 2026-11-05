# Collaudo amministrativo — 5 novembre 2026

Backend: Supabase locale reale (PostgreSQL, Auth, REST, Storage, posta Mailpit), associazione e account sintetici `example.test`. Nessun accesso al database remoto; browser limitato all'origine locale. Nessun ordine o vendita creati. Nessuna modifica a Security PSG, merge o deployment.

Esecuzione ripetibile: `npm run sandbox:prepare`, `npm run dev:sandbox`, quindi `npm run test:sandbox:administration`. Credenziali e screenshot restano nel workdir privato, esclusi da git. La migrazione `20261105150000_administrative_cash_validation.sql` è stata applicata solo al database locale di prova; è da revisionare prima di qualsiasi applicazione esterna.

| Verifica eseguita | Esito | Evidenza e limite |
| --- | --- | --- |
| Login e home dopo accesso | PASS | Browser con Auth locale reale |
| Creazione quota | PASS | Durata e prezzo riletti dal DB |
| Registrazione manuale e doppio clic | PASS | Un solo socio persistito |
| Ricerca con accenti | PASS | Query PostgREST disambiguata; ricerca García senza accento verificata nel browser |
| Modifica nome vuoto | PASS | Rifiutata senza alterare il DB |
| Modifica valida | PASS | Anagrafica riletta dal DB |
| Rinnovo annullato/confermato | PASS | Nessuna variazione annullando; +30 giorni confermando |
| Documenti sintetici | PASS | Upload, URL firmato e confronto bytes |
| Invito dipendente | PASS | UI/server e utente Auth/membership verificati; posta locale |
| Permessi e isolamento fra club | PASS | Scritture vietate respinte, editor autorizzato, altro club isolato |
| Escalation ruolo via REST | PASS | Respinta dal backend |
| Cassa: importo negativo | PASS | Nessuna sessione creata |
| Cassa: apertura e chiusura | PASS | 12,50 euro persistiti come 1250 centesimi; nessun ordine |
| Report: indisponibilità dati | PASS | Risposta 503 sintetica sul backend locale: errore visibile dopo i tentativi automatici del client |
| Test automatici | PASS | 56/56; includono parser IT/ES e provider HTTP locale simulato |
| TypeScript e build | PASS | Build sandbox indipendente da Lovable |
| PWA Chromium mobile | PASS | Manifest, criteri installabilità, icone, prompt, offline e cache solo pubblica |
| Android fisico | BLOCKED | Nessun dispositivo disponibile; emulazione non equivale a installazione reale |
| Dettatura AI reale IT/ES | BLOCKED | Mancano AI_API_KEY, provider/modelli verificati e microfono; configurare AI_BASE_URL, AI_MODEL, AI_TRANSCRIBE_MODEL e AI_EXTERNAL_PROCESSING_ENABLED=true dopo valutazione del trattamento dati |
| Contabilità incassi quote | BLOCKED | Il modulo esistente aggrega ordini; manca un registro autonomo degli incassi associativi. Rinnovo non equivale a ricevuta di pagamento |
| Grafica completa del marchio | BLOCKED | PNG originali assenti; presenti puntatori asset. Non sostituiti con altri marchi |

## Correzioni riprodotte

La prima esecuzione completa aveva 11 PASS, 4 FAIL e 3 BLOCKED: ricerca accentata, nome vuoto, importi negativi e report silenziosamente azzerati. La riesecuzione finale ha completato 15 casi nativi: 15 PASS, 0 FAIL, 3 BLOCKED. La ricerca richiedeva anche la disambiguazione della relazione verso le quote; il report richiedeva di attendere i retry del client.

Aggiunti parsing monetario senza conversioni silenziose, guardia sulle operazioni di cassa, controllo delle righe effettivamente aggiornate e vincoli SQL non distruttivi `NOT VALID` (conservano lo storico, controllano nuove scritture). La policy di cassa verifica il permesso nel club corrente. Gli identificativi QR non vengono più troncati.

Il test AI con server HTTP locale prova il contratto di integrazione, non il riconoscimento di voce reale. Inserimento manuale conservato. L'app non è dichiarata pronta per produzione.

I report economici completi e la precisione dei conteggi su dataset amministrativi articolati non sono stati convalidati da questi casi. Revoca dipendente e recupero password hanno test automatici precedenti, ma questo collaudo nativo verifica soltanto invito e autorizzazioni.
