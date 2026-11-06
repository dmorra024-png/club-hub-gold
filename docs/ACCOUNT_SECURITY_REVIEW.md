# Stabilizzazione: sicurezza degli account

Per lo sviluppo amministrativo successivo, vedere
[ADMINISTRATIVE_RUNTIME.md](ADMINISTRATIVE_RUNTIME.md). Questo documento conserva
gli esiti della prima revisione degli account.

Ramo: `codex/stabilize-independent-club`. Questa revisione realizza la parte di
sicurezza degli account del piano `CODEX_STABILIZATION_PLAN.md`; non certifica
l'intero piano. Security PSG non è stato modificato. Nessun merge, deploy o
accesso in scrittura a un database remoto è stato eseguito.

## Comportamento corretto

- Un account esistente viene riutilizzato senza cambiare password o metadati.
  Nessuna password viene generata, restituita o inviata in chiaro.
- Un nuovo account riceve un invito Supabase monouso. È il titolare a scegliere
  la password. Sono gestiti anche i link `type=invite` nella pagina esistente.
- Il pulsante di recupero invia un link all'email letta da Supabase per quel
  collaboratore; un amministratore non può impostare direttamente una password
  globale né agire su un amministratore attraverso questo endpoint.
- La revoca elimina soltanto il ruolo `collaborator` identificato nel club
  autorizzato. Account Auth, profilo, altri ruoli e storico rimangono intatti.
- Inserimento dei ruoli senza upsert: un vincolo duplicato dà errore, senza
  spostare il ruolo di un account da un club all'altro o riscriverne i permessi.
- Controlli server sul ruolo di amministratore nel club corrente, con
  propagazione degli errori del database e del provider email.
- Cache di React Query e del club svuotate al logout e al cambio di account.
- Link costruiti solo da `APP_URL`, mai dall'header Host della richiesta.
- La nuova migrazione revoca le scritture dirette su `user_roles`, compreso
  `TRUNCATE`, limita la lettura dei profili agli utenti che condividono un club
  e impedisce che una registrazione pubblica riceva automaticamente super-admin.

Il vincolo esistente `UNIQUE(user_id, role)` è conservato. Aggiungere lo stesso
tipo di ruolo a un secondo club fallisce esplicitamente; questa PR non introduce
un selettore multi-club né modifica appartenenze preesistenti.

## Verifiche

| Verifica                                             | Esito e limiti                                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                           | PASS: 26 test, zero saltati; account, errori del provider, isolamento e revoche                                               |
| Policy SQL                                           | PASS su PostgreSQL incorporato PGlite, dati sintetici, ruoli authenticated/anon/service_role e JWT simulato                   |
| Regressioni SQL                                      | La fixture riproduce lettura globale dei profili e promozione diretta con le policy precedenti; la nuova migrazione le blocca |
| Conservazione dati                                   | PASS sui record sintetici preesistenti; migrazione ripetuta senza alterare ruoli/account                                      |
| TypeScript e build                                   | PASS: `npm run typecheck` (inclusi i test) e `npm run build`                                                                  |
| Lint                                                 | Il repository contiene errori preesistenti; nessuna correzione automatica globale                                             |
| HTTP locale                                          | PASS: auth/reset renderizzate; lista, recupero e revoca rifiutano richieste senza autenticazione                              |
| Email, inviti, token scaduti/riutilizzati            | DA TESTARE su progetto Supabase separato con SMTP configurato                                                                 |
| Sessioni simultanee e logout tra account reali       | DA TESTARE in browser con account fittizi distinti                                                                            |
| Installazione Android/PWA                            | NON ESEGUITA in questa revisione                                                                                              |
| Flussi di soci/catalogo/genetiche/magazzino/cassa/QR | NON VALIDATI da questi test di sicurezza                                                                                      |
| AI vocale IT/ES e indipendenza runtime da Lovable    | INVARIATE, non validate né completate                                                                                         |

La fixture SQL contiene solo lo schema degli account: non è un replay completo
delle migrazioni di Supabase, né una verifica del gateway Auth, JWT reali o SMTP.
La CI aggiunta esegue test, TypeScript e build, senza applicare migrazioni o fare
deployment. Il suo esito remoto va verificato sulla PR.

## Riproduzione locale

Con Node >=22.18 (verificato Node 24.22.1) e Bun 1.3.12:

```sh
bun install --frozen-lockfile
npm test
npm run typecheck
npm run build
npm run dev -- --host 0.0.0.0 --port 3000
# Con il server avviato, in un altro terminale:
npm run test:smoke:accounts
```

`npm test` usa l'isolamento nello stesso processo per mostrare ed eseguire tutti
i singoli casi anche nel runner cloud. I test non richiedono credenziali né rete.
PGlite è una dipendenza solo di sviluppo. Gli archivi nel lockfile usano il
registro pubblico npm al posto della cache privata Lovable: versioni,
dipendenze transitive e hash di integrità dei pacchetti già presenti sono invariati.
I pacchetti/configurazione runtime di Lovable non sono stati rimossi.

Lo smoke HTTP usa solo il server di sviluppo locale. Le RPC di TanStack possono
serializzare un errore in una risposta HTTP 200: il test verifica l'errore di
autenticazione nel corpo, non soltanto il codice di stato. Non passa credenziali
né raggiunge il database remoto. Non sostituisce il collaudo con utenti reali.

## Collaudo separato e procedura di rilascio da autorizzare

1. Preparare un progetto Supabase di prova senza dati reali. Per il server
   configurare `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e
   `SUPABASE_SERVICE_ROLE_KEY`; per il browser, le corrispondenti variabili
   `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Non esporre la chiave
   service-role al browser e non inserirla in Git o nei log.
2. Configurare `APP_URL` come origine HTTPS attendibile dell'applicazione
   (per esempio `https://club.example.test`), ammettendo HTTP solo per localhost.
   Aggiungere esattamente `<APP_URL>/reset-password` ai redirect autorizzati
   di Supabase. Verificare SMTP e template di invito/recupero, inclusi eventuali
   webhook email personalizzati già collegati al progetto.
3. Revisionare e applicare **solo nel progetto di prova**
   `20261105103000_secure_account_access.sql`. Non eseguire automaticamente
   l'intero storico delle migrazioni su produzione: contiene anche operazioni
   storiche estranee a questa revisione. La migrazione di sicurezza non elimina
   né aggiorna dati esistenti.
4. Su installazioni nuove, assegnare il primo super-admin mediante una procedura
   fidata e revisionata fuori dal signup pubblico. Su installazioni esistenti
   i ruoli sono conservati. L'assenza di super-admin non ne crea uno nuovo.
5. Collaudare account fittizi: due club, due amministratori, un collaboratore
   condiviso e un utente senza ruoli. Verificare che inviti/recuperi arrivino
   soltanto al titolare, che un link scaduto/riutilizzato fallisca e che la revoca
   nel club A lasci funzionante l'accesso al club B. Provare anche chiamate
   dirette PostgREST, sessioni già aperte e account che cambiano nello stesso
   browser. L'account Auth resta valido dopo la revoca di una sola membership.
6. Una nuova identità può essere già stata invitata se il successivo inserimento
   della membership fallisce: non viene eliminata per compensazione. Dopo aver
   risolto l'errore, ripetere l'assegnazione; il percorso per account esistenti
   non invia automaticamente un secondo invito. Il titolare può richiedere un
   recupero dalla pagina di accesso. Verificare anche rate limiting e consegna SMTP.
7. Rilascio e migrazione su produzione richiedono autorizzazione esplicita e un
   backup verificato. Non distribuire questa migrazione con vecchi handler che
   scrivono i ruoli tramite il client authenticated: usare una finestra di
   manutenzione per aggiornare schema e codice insieme.

In caso di problemi, sospendere temporaneamente le operazioni sugli account e
ripristinare una versione applicativa compatibile con le policy restrittive.
Non riattivare automaticamente le vecchie policy permissive e non cancellare
utenti o record per recuperare un invito fallito. Un eventuale ripristino completo
di database/codice richiede verifica del backup e approvazione separata.
