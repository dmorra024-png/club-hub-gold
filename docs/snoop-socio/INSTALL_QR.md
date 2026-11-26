# QR unico di installazione SNOOP Socio

Quando la nuova app soci avrà un dominio HTTPS indipendente e autorizzato, il club può stampare un solo cartello per tutti i soci. Il QR contiene esclusivamente l'indirizzo dell'app: **nessun token, password, club_id o dato del socio**.

## Generatore del cartello
Il repository contiene già la libreria `qrcode` nella lista delle dipendenze. Dopo `npm install` o il sistema install già scelto dal progetto, eseguire:

```sh
node apps/socio/create-install-poster.mjs --url https://DOMINIO-SOCIO-APP/ --out snoop-socio-install.svg
```

Sostituire il placeholder esclusivamente con un hostname effettivamente pubblicato e verificato. Lo script rifiuta URL non HTTPS e URL con query/token/fragmenti. Il file SVG può essere stampato oppure convertito in PDF successivamente; l'output SVG è codice sorgente (non contiene font incorporati). Non distribuire il cartello prima del collaudo del collegamento.

## Percorso del socio
1. Scansiona il cartello con la fotocamera e apre la PWA.
2. Può usare l'app in browser o installarla; su iOS Safari il menu Condividi porta a `Aggiungi a schermata Home` e l'installazione potrebbe richiedere istruzioni manuali.
3. Entra o si registra una volta con email verificata. Il sistema collega soltanto le membership con prove adeguate; l'email coincidente da sola non crea una tessera.
4. La home mostra direttamente il QR personale del club selezionato. I tre puntini -> `Mis clubes` fanno cambiare club, QR, numero socio e saldo.

Il **QR sul cartello è statico**; il **QR nella tessera è dinamico**, distinto e server-side, con validità breve.
