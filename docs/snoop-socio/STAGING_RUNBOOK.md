# SNOOP Socio — procedura di collaudo, NON pubblicare senza revisione

## Stato al 17 novembre 2026
- PR #25 in bozza, ramo `feature/snoop-socio-app-design-20261117`, **nessun merge** e **nessun deployment**.
- App installabile PWA: schermate ES, login, registrazione, verifica email, QR per ogni club, Mis clubes, Monedero read-only.
- Servizio isolato con Supabase Auth (cookie Secure/HttpOnly), controllo non-staff, proiezioni RLS, cifratura AES-GCM dei QR e consumo monouso richiesto allo scanner.
- Worker staging e whitelist di asset statici pronti come codice, non distribuiti.
- Test sintetici GitHub Actions; **non equivalgono a collaudo live con soci né a prove Android/iPhone**.

## Separazione senza modifiche al gestionale
L'unico target autorizzabile per un futuro collaudo è il Worker distinto `snoop-socio-staging` con URL separato da `snoop-pilot`. Il nuovo Worker è configurato in `apps/socio/wrangler.staging.jsonc` con asset pubblici generati tramite `node apps/socio/build-public.mjs`.

Il builder pubblica soltanto `index.html`, `main.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `icon.svg`. Non pubblica moduli .mjs, repository server, test, SQL, segreti, né documenti.

## Interventi che richiederanno l'utente, solo al momento dell'approvazione del test
1. **Autorizzare esplicitamente la creazione del Worker separato**. Non riutilizzare il dominio del gestionale o i segreti di JARVIS.
2. **Autorizzare l'URL esatto di SNOOP Socio in Supabase → Authentication → URL Configuration → Redirect URLs**, mantenendo invariato l'URL del gestionale. L'email di conferma deve aprire SNOOP Socio e non la home admin.
3. **Predisporre separatamente le impostazioni del Worker** (`SOCIO_SUPABASE_URL`, `SOCIO_SUPABASE_PUBLISHABLE_KEY`, `SOCIO_ORIGIN`) e il segreto `SOCIO_QR_SIGNING_KEY_BASE64` di 32 byte casuali, gestito solo tramite Cloudflare Secret; mai in chat o GitHub.
4. **Approvarne il database in staging**, dopo revisione Codex: schema solo proposto in `apps/socio/schema/REVIEW_ONLY.sql`, non applicato. La creazione di utenti Auth è un effetto reale sul progetto Supabase: evitare iscrizioni di prova fino a isolamento confermato.
5. **Convalidare la prima associazione al club**: SNOOP oggi conserva `members.email` ma NON verifica l'indirizzo durante l'iscrizione. L'uguaglianza email non è autorizzazione. Serve una prova d'identità/consenso del club, con fallback a codice monouso presentato al banco per soci legacy o casi dubbi.
6. **Approvare la futura integrazione dello scanner gestionale** dopo test con Codex, senza cambiare scanner durante il lavoro JARVIS.

Nessun intervento è necessario adesso. Non installare un nuovo plugin, non cambiare password o impostazioni del gestionale di produzione.

## Gate tecnici prima di un solo socio reale
- Verifica RLS cross-club e staff/admin/superadmin, con JWT reale; no service_role nella PWA pubblica.
- Revisione security advisors Supabase preesistenti. Alcune funzioni SECURITY DEFINER sono eseguibili da ruoli autenticati e devono essere auditati per un account socio nuovo; non equivale automaticamente a vulnerabilità.
- Email signup/login/refresh/logout testate con provider reale, redirect allowlist, rate limit e revoca.
- Claim email e challenge code con transazioni SQL atomiche, TTL, rate limits, no enumerazione.
- Scansione JWT staff same-club, membership valida, e registrazione atomica del nonce già usato (rifiuta replay).
- Wallet per-club con ledger contabile e tabelle read-only; nessuna ricarica/dispensazione live finché non completa la revisione legale e del doppio conteggio della cassa.
- Validazione installazione e tastiera Android/iOS, sessione PWA, comportamento offline, perdita rete.
- Codex revisiona il diff e dà esito; approvazione manuale prima di merge, migrazione e deployment.

## Controlli senza effetti reali
```sh
node apps/socio/check.mjs
node --test apps/socio/*.test.mjs
node apps/socio/build-public.mjs
```

Il cartello QR unico viene generato **solo quando l'URL HTTPS di SNOOP Socio è vero e verificato**: `apps/socio/create-install-poster.mjs`.
