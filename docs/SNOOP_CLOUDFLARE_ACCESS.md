# Diagnosi Cloudflare SNOOP — 7 novembre 2026

Nessun deployment ripetuto, nessun token creato o modificato, nessun accesso a Supabase o ad altri Worker.

## Esito misurato

Diagnostica GET con le credenziali già protette nell'ambiente GitHub `snoop-pilot`: [run 42372891506](https://github.com/dmorra024-png/club-hub-gold/actions/runs/42372891506). Il job `diagnose-snoop` è completato; `deploy-snoop` è **skipped**. Valori dei segreti, ID token e ID account non sono nei risultati.

| Chiamata | Esito |
|---|---|
| `GET /client/v4/user/tokens/verify` | HTTP 200, token `active` |
| `GET /client/v4/accounts/{SNOOP_ACCOUNT}/workers/scripts/snoop-pilot/settings` | HTTP 403, Cloudflare `10000` |
| Stessa chiamata con User-Agent Wrangler | HTTP 403, Cloudflare `10000`; escluso il blocco browser 1010 |
| `GET .../snoop-pilot/script-settings` | HTTP 403, Cloudflare `10000` |
| `GET .../snoop-pilot/secrets` (soli metadati) | HTTP 403, Cloudflare `10000` |
| `GET .../snoop-pilot/deployments` | HTTP 403, Cloudflare `10000` |
| Lettura opzionale della policy del token stesso | HTTP 403: policy non ispezionabile; non viene richiesto un permesso globale aggiuntivo solo per leggerla |

## Permesso necessario

**Account → Workers Scripts → Edit**, chiamato **Workers Scripts Write** nello schema API, con Account Resources che includa l'account corretto di `snoop-pilot`.

Dove: **Cloudflare → Profilo → API Tokens → token esistente → Edit → Permissions / Account Resources**. Se il permesso Edit è già presente, va verificato l'ambito account: i risultati non permettono di distinguere fra gruppo mancante e risorsa account non inclusa. Non è necessario creare un nuovo token.

Lo [schema OpenAPI ufficiale](https://github.com/cloudflare/api-schemas/blob/main/openapi.json), operazione `worker-script-get-settings`, accetta Workers Scripts Write anche per GET settings. La pubblicazione `PUT /accounts/{account_id}/workers/scripts/{script_name}` richiede Workers Scripts Write (o un ruolo editor equivalente applicabile al Worker). Non serve aggiungere un permesso Read separato a un token Write correttamente autorizzato sul target. Eliminare soltanto la verifica iniziale non dimostra né ripristina il diritto di pubblicazione; sposterebbe il possibile errore a un'operazione di scrittura. Il controllo non è stato aggirato.

## Diagnostica riutilizzabile

Il workflow già esistente accetta `confirm=DIAGNOSE-SNOOP-PILOT`: seleziona esclusivamente il job GET. `confirm=DEPLOY-SNOOP-PILOT` seleziona invece il job di pubblicazione, che non è stato eseguito in questa attività. Cinque test automatici verificano target fisso, GET esclusivi, assenza di redirect, redazione dei valori e separazione dei job. La diagnosi non stampa corpi di errore o policy grezze.
