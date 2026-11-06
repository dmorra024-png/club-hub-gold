# Club Hub Gold — stabilizzazione e indipendenza Lovable

## Missione
Usare questo repository come fonte unica. Conservare UI, flussi già implementati, dati e soprattutto assistente vocale per soci, categorie, prodotti, genetiche, inventario. Rendere build e deployment indipendenti da Lovable. Non toccare Security PSG.

## Verifiche iniziali (codice originale)
- React 19 / TanStack Start / Supabase.
- Percorsi: `/soci/nuovo`, `/soci/gestisci`, `/productos`, `/caja`, `/ajustes/colaboradores`, `/reset-password`, QR ecc.
- `src/lib/voice-agent.functions.ts` invoca `ai.gateway.lovable.dev` per trascrizione, voce e interpretazione: sostituire dipendenza con provider indipendente configurabile, senza eliminare comandi AI. Interrompere l'invio di dati identificativi senza valutazione privacy.
- `src/lib/platform.functions.ts` `upsertAuthUser` reimposta password se email già esistente: correggere in fail-safe, nessun reset implicito. `sendWelcomeEmail` invia password temporanea in chiaro: utilizzare inviti/reset one-time. `deleteCollaborator` cancella auth user globale anche se condiviso: revocare soltanto membership del club salvo verifica esplicita di assenza altre appartenenze.
- `src/routes/_authenticated/caja.tsx` verifica sessioni duplicate, errori, isolamento RLS, valori negativi, calcoli e timezone.

## Ordine di esecuzione
1. Ispezionare codice, migrazioni, RLS, test e secrets configurabili. Creare smoke/build/lint/typing check.
2. Fix sicurezza account e tenant isolation con test automatici.
3. Validare flussi CRUD su database di prova (solo dati fittizi) per soci, collaboratori, prodotti, genetiche, stock, cassa, report, QR.
4. Sostituire servizi Lovable indispensabili con provider indipendenti: AI voce funzionante, backend, build e hosting. Supportare dettatura IT/ES, conferma esplicita delle modifiche materiali, fallback manuale.
5. PWA Android installabile, responsive, UX fedele all'originale. Nessun redesign non richiesto.
6. Produrre matrice di risultati PASS/FAIL/BLOCKED e piano installazione/rollback.

## Sicurezza e pubblicazione
Non usare dati reali nei test; non cancellare utenti, documenti, storico o produzione. Nessuna migrazione distruttiva. Niente merge o deploy automatico: PR da revisionare. Non dichiarare 'pronto' senza test reali. Le attività relative alla cannabis richiedono verifica dei limiti legali locali; non presupporre autorizzazioni.

## Done
Build green, integrazioni AI operative su provider indipendente in ambiente di prova, flussi core testati con account multipli e RLS, report dei limiti residui, procedura self-hosting senza Lovable.

## Avanzamento: revisione sicurezza account

La revisione sul ramo `codex/stabilize-independent-club` corregge inviti, password,
revoca delle membership e protezione dei profili/ruoli. Test e procedura di
collaudo, inclusi i limiti non ancora verificati, sono documentati in
[`docs/ACCOUNT_SECURITY_REVIEW.md`](docs/ACCOUNT_SECURITY_REVIEW.md).
Questa revisione non completa le attività funzionali, AI, PWA o indipendenza
runtime previste dal piano. Nessuna migrazione è stata applicata a dati reali.

## Avanzamento: percorso amministrativo indipendente

Implementati runtime Node senza SDK Lovable, AI configurabile per soci/documenti,
conferma dei dati prima del salvataggio, PWA e test browser/SQL con dati sintetici.
Stato, credenziali mancanti, loghi da esportare e percorsi legacy esclusi sono in
[`docs/ADMINISTRATIVE_RUNTIME.md`](docs/ADMINISTRATIVE_RUNTIME.md).
Il piano complessivo non è dichiarato completato né pronto al deployment.

## Avanzamento: incassi associativi, AI e PWA mobile

Registro incassi autonomo implementato, AI collegata alle schermate e autorizzazioni provider/documenti separate, aggiornamenti PWA su conferma e correzioni del QR mobile. Risultati nativi, istruzioni e blocchi esterni nella [revisione della candidata](docs/RELEASE_CANDIDATE_REVIEW.md). Nessun merge o deployment eseguito.

## Avanzamento: collaudo gratuito Cloudflare/Supabase

Implementati target workerd, adapter Workers AI gratuito con autorizzazioni separate, inviti manuali monouso e correzioni di inventario, cataloghi, PWA e documenti multi-club. Configurazioni, esiti e sole operazioni esterne sono nella [consegna pilota gratuita](docs/FREE_PILOT.md). Nessuna risorsa remota o pubblicazione è stata effettuata.
