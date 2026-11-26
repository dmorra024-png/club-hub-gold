# SNOOP — turni flessibili basati sulla cassa

**Requisito aggiornato:** nessuna fascia oraria predeterminata né turni numerati applicati globalmente. Ogni club può avere orari di apertura differenti, e ogni collaboratore può iniziare e terminare in momenti diversi.

**Fonte autorevole: la sessione di cassa reale** (`public.cash_sessions` già presente in SNOOP). Quando il collaboratore apre la cassa, inizia il suo turno effettivo; quando la cassa viene chiusa, termina il turno. `opened_at` e `closed_at` sono le date/ore reali, `user_id` identifica chi ha aperto, `closed_by` chi ha chiuso (può essere diverso e va evidenziato nel rapporto). Nessuna chiusura automatica al cambio di giorno.

**Informe/Caja del día:** gli orari dei movimenti e delle sessioni devono essere rispettati, inclusi turni che passano la mezzanotte. Una vista per data deve mostrare le sessioni del club interessate e non supporre un numero fisso di turni. Il riepilogo giornaliero segue il fuso orario configurato per quel club e una regola di attribuzione trasparente: definire in fase di integrazione se l'aggregazione è per timestamp del movimento (preferibile per i totali giornalieri), non assegnare arbitrariamente tutto a un turno della data di apertura. Le sessioni non si chiudono automaticamente alle 00:00. La cassa effettiva, i movimenti e il nome di chi apre/chiude devono restare riconciliabili.

**Monedero:** le ricariche devono essere attribuite alla sessione di cassa effettivamente aperta e autorizzata per il club. Una sessione chiusa o di altro club non può accettare una ricarica. L'uso di crediti è un movimento del saldo, non una nuova entrata di contante. L'eventuale handover di cassa fra collaboratori va tracciato senza falsificare orari.

`apps/socio/cash-shifts.mjs` produce soltanto una rappresentazione **read-only e verificabile** di questo ciclo di vita; non apre/chiude la cassa e non modifica il gestionale. Le prove usano sessioni sintetiche e coprono orari arbitrari, notte, chiusura e isolamento fra club.

**Non applicato a produzione.** Prima dell'integrazione reale, verificare regole di autorizzazione e modalità di utilizzo specifiche per club.
