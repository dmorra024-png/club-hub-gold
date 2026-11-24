# JARVIS — audit e decisione, 24 novembre 2026

## Stato ed evidenze
Base verificata: PR27, 22feef8. Nessuna modifica alla PR27 o alla produzione.
I 498 test e sei controlli CI del precedente commit non vengono rieseguiti: questa
prova aggiunge soltanto file sperimentali, non cambia codice applicativo o dipendenze.

Cause distinte, non una generica insufficienza del modello:
1. Audio: attivazione sequenziale resume→permesso poteva bloccarsi; evento di nuova
risposta mancante lasciava il playback soppresso. Regressioni precedenti documentate
in docs/JARVIS_AUDIO_REGRESSION.md. Questi difetti sono riprodotti automaticamente,
NON dimostrati come causa del guasto sul telefono dell'utente.
2. Test incompleti: microfono, autenticazione e provider erano simulati; il verde
non misurava STT reale, qualità TTS o udibilità fisica. 22feef8 aggiunge DSP nativo,
ma sorgente sonora/provider restano sintetici.
3. Limite funzionale dimostrabile nel codice: application-ports.ts espone patch/open/
search, nessuna esecuzione persistente. deepgram-app-gateway.ts rifiuta receipt
completed provenienti dal browser. Non è un problema risolvibile cambiando voce.
4. Comprensione reale non misurata: mancano corpus audio etichettato, ground truth,
accuratezza per campo e latenze separate del provider. Non attribuire ogni errore a
Whisper: il percorso Deepgram corrente usa Flux, non Whisper/GLM.
5. Funzioni manuali e voce non hanno parità: inventario attuale 301 operazioni/UI,
14 port, molte sole navigazioni o bozze. Vedi matrice esistente, non contare pulsanti
come operazioni vocali implementate.

## Ricerca diretta
URL ed esiti HTTP in sources.json/code-sources.json; hash delle risorse consultate
in research-sha256.json. Ispezionati file di implementazione, non solo README.
I riferimenti main sono mobili: gli hash identificano il materiale letto, non sono
una revisione permanente del repository upstream. Metadati manutenzione datati in
maintenance.json; issue browser in browser-issues.json sono segnalazioni, non prove.

| Alternativa | Codice/tecniche valutate | Licenza e compatibilità | Decisione |
|---|---|---|---|
| LiveKit Agents | agent_session.py: turn handling, interruzioni false, resume, ciclo sessione | Apache-2.0; attivo. Python/Node server e trasporto RTC; non installabile come sostituzione diretta nel Worker. Cloud o infrastruttura propria, TURN/egress da contabilizzare | Buon riferimento, migrazione non giustificata dal guasto attuale |
| Pipecat | user_turn_controller.py: strategie FIRST/insieme, timeout e turni | BSD-2-Clause; attivo. Pipeline Python con hosting e trasporto da gestire | Miglior candidato alternativo per futura pipeline composita, non adozione immediata |
| TEN | property.json del voice-assistant: grafo STT/LLM/TTS | LICENSE con condizioni aggiuntive: vietato hosting sui dispositivi finali e restrizioni concorrenziali Agora. Non qualificare come Apache puro; runtime server separato | Scartato per questa integrazione senza revisione licenza |
| Vocode | streaming_conversation.py: eventi interrompibili e componenti STT/TTS | MIT; ultimo push API rilevato novembre 2024, rischio manutenzione; server Python | Non prima scelta per un nuovo componente critico |
| Deepgram Voice Agent | gateway corrente, strumenti client, Flux multilingue/STT e TTS naturale | Servizio proprietario; chiave solo server, credito non significa gratuità; WebSocket esistente compatibile Worker/PWA | Conservare per pilot controllato, non promettere uso illimitato a 15 euro |
| OpenAI Realtime + Agents SDK | tool.py: strict JSON, is_enabled e needs_approval; API realtime richiede trasporto/sessioni propri | SDK MIT, API commerciale separata, nuova autorizzazione privacy/provider necessaria | Pattern di approvazione utile; nessuna nuova integrazione o chiave |
| Kokoro 82M | model card ufficiale, lingue e pesi | Pesi Apache-2.0; 82M parametri, circa 328 MB in FP32 prima di runtime/voci. Quantizzazione non verificata qui. WASM/WebGPU non universali; RAM e avvio da misurare | Test server futuro, non download obbligatorio mobile |
| Supertonic | LICENSE MIT del runtime | Licenza del runtime non certifica tutti i pesi/voci/versioni. Prestazioni, lingue e memoria non misurate qui | Non sostituire voce già apprezzata con qualità non verificata |
| Whisper locale / whisper.cpp, Piper | Alternative di STT/TTS locale, non benchmarkate in questa prova | Non assumere tutte le voci Piper liberamente commercializzabili; licenza modello per modello, RAM/batteria iOS e manutenzione da verificare | Non sostenere gratuità o compatibilità completa |

I listini OpenAI e LiveKit hanno risposto 403 da questo ambiente: nessun bypass e
nessun prezzo inventato. La documentazione Deepgram configure/billing richiesta in
questa sessione ha risposto 403; il listino pubblico ha risposto positivamente.

## Decisione concreta: B
A conserva costi e lacune esistenti; C aggiunge migrazione, infrastruttura e licenze
senza implementare le API SNOOP. B conserva cattura, DSP, WS autenticato, Deepgram,
contesto temporaneo, vocabulary, limiti server, port e servizi esistenti.
Separare quattro contratti: audio; proposta tipizzata; autorizzazione/conferma;
esecuzione e risultato verificato dal server. Il modello non può promuovere una bozza
in successo. Adapter di scrittura devono riusare API/RPC originali, idempotency key
persistente e audit; timeout dopo invio produce esito incerto e riconciliazione, non retry
cieco. Non abbassare la protezione completed del gateway per simulare completamento.

Per la voce conservare cancellazione playback su barge-in e segnale esplicito di nuova
risposta, AEC verificato oppure interruzione manuale dichiarata; contesto e generazione
vincolati a utente/club; sospensione in background; nessun ascolto nascosto. Le tecniche
LiveKit/Pipecat orientano le prove, non giustificano introdurre infrastrutture non misurate.

## Costi: USD, niente conversione EUR inventata
Listino Deepgram osservato: Standard .075/min; Advanced .163/min; BYO LLM .065/min;
BYO LLM+TTS .050/min, a cui aggiungere i provider esterni. Non sommare STT/TTS/LLM
una seconda volta alle tariffe integrate. Il listino dichiara minuti di connessione WS:
il silenzio con socket aperto può costare. Il tier effettivo del progetto va verificato
con usage/billing autorizzato; non assumere Standard per le voci/modelli selezionati.

| Minuti/club | Standard, solo provider | Advanced, solo provider |
|---|---:|---:|
|500|37.50|81.50|
|1000|75.00|163.00|
|2000|150.00|326.00|

cost-results.json contiene tutti i 30 scenari per 20/100 club, includendo una voce fissa
hosting e costi modello stimati per le alternative. Per Standard, rispettivamente:
20 club: 755 / 1505 / 3005 USD; 100 club: 3755 / 7505 / 15005 USD (inclusi 5 USD
hosting ipotizzati). Advanced: 1635 / 3265 / 6525 e 8155 / 16305 / 32605 USD.
Hosting 5 USD è ipotesi di scenario, non preventivo né prova di capacità/concorrenza.

Composito: STT multilingue Flux .0078/min e Flux TTS .045/1000 caratteri; ipotesi 35%
parlato assistente a 900 caratteri/min e LLM .002/min, più 25 USD fissi. Non è
necessariamente più economico a sufficienza: 1000 minuti costano 23.975 USD/club prima
della quota fissa. TTS locale/server cambia il conto, ma qualità e capacità non provate.
Self-host: scenari di flotta 250 o 1000 USD/mese più .002/min di modello; con 20 club
la sola quota fissa è 12.50 o 50 USD/club, con 100 è 2.50 o 10. Sono analisi di
sensibilità, NON offerte hardware verificate né benchmark. GPU, concorrenza di picco,
egress, storage, ridondanza, manutenzione, tasse, supporto e margine possono aumentarli.
Non usare questi scenari per promettere 2000 minuti a 15 EUR.

Conclusione commerciale: prezzo 10–15 EUR con 500–2000 minuti non sostenibile con
Voice Agent integrato PAYG. Occorrono quote misurate, prezzo superiore oppure un
benchmark self-host condiviso prima di un'offerta. Nessun abbonamento attivato.

## Prova riproducibile
`node --experimental-strip-types experiments/jarvis-decision/verify.ts`
`node experiments/jarvis-decision/costs.mjs`
verify.ts invoca il dispatcher applicativo reale applyDeepgramDraft e port registrati,
verifica nome/cognome, aggiornamento successivo, correzione manuale preservata,
permessi negati e contesto obsoleto. L'adapter del modulo è sintetico: nessuna prova
nuova di NLU, DB, STT/TTS o persistenza. localDispatchMs è tempo locale, NON latenza
vocale né benchmark statistico. Non ripetere i vecchi test audio come nuova evidenza.

## Cosa manca e blocchi precisi
- Servono adapter autorizzati e risultati server per operazioni persistenti: non esistono
nel contratto attuale. Caja/Monedero sono esclusi dalle modifiche autorizzate in questo
incarico: non riscriverli per ottenere una dimostrazione artificiale.
- Nessuna sessione Ddr autenticata o credenziale provider disponibile per prova reale
in questa esecuzione. Nessuna credenziale creata, esposta o modificata.
- Nessun telefono fisico: su Android/iPhone verificare permesso, risposta realmente
udibile, interruzione e nuova risposta, 20 turni in IT/ES/EN, ritorno da background,
confronto campi vs frase etichettata; registrare tempi senza dati personali.
- Per benchmark reale usare esclusivamente persone/prodotti sintetici e ambiente isolato;
nessun salvataggio sul DB produttivo. Non automatizzare flussi di distribuzione regolata.
- Mancano consumo reale per tier, fatture e capacità self-host sotto carico. Non stimare
accuratezza, p95 o numero club per macchina senza misura.

Non è una certificazione di JARVIS terminato. È una decisione motivata con prova del
confine applicativo, verificabile e senza compromettere i moduli protetti.
