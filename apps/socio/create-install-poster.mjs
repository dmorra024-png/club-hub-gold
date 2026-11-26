/**
 * Creates a printable SVG for the fixed SNOOP Socio install URL.
 * Run ONLY after a separately deployed member-app HTTPS hostname is approved:
 * node apps/socio/create-install-poster.mjs --url https://approved-host.example/socio/ --out poster.svg
 * This script imports QRCode from the repository's existing npm dependency.
 */
import {writeFile, mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import QRCode from 'qrcode';
const argv=process.argv.slice(2);
const param=name=>{const i=argv.indexOf(name);return i<0?null:argv[i+1];};
const address=param('--url'),file=param('--out');
if(!address||!file)throw Error('REQUIRED: --url https://member-app-host/path/ --out poster.svg');
const url=new URL(address);
if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||/localhost|127\.0\.0\.1/i.test(url.hostname))
 throw Error('Only public HTTPS URL without credentials, query or fragment is permitted');
if(!file.endsWith('.svg'))throw Error('Output must be SVG');
const qr=await QRCode.toString(url.toString(),{type:'svg',margin:1,width:440,errorCorrectionLevel:'H',color:{dark:'#111c34',light:'#ffffff'}});
const inner=qr.replace(/^<\?xml[^>]*>\s*/,'').replace(/<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'');
const illustration=`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="900" viewBox="0 0 640 900">
<rect width="640" height="900" rx="32" fill="#101a30"/>
<rect x="25" y="25" width="590" height="850" rx="20" fill="none" stroke="#d7b873" stroke-width="3"/>
<text x="320" y="110" text-anchor="middle" fill="#d7b873" font-size="58" font-weight="700" font-family="sans-serif" letter-spacing="12">SNOOP</text>
<text x="320" y="160" text-anchor="middle" fill="#f4f6fa" font-size="27" font-family="sans-serif">TU CARNET DIGITAL</text>
<rect x="80" y="210" width="480" height="480" rx="23" fill="#ffffff"/>
<svg x="100" y="230" width="440" height="440" viewBox="0 0 440 440">${inner}</svg>
<text x="320" y="749" text-anchor="middle" fill="#d7b873" font-size="28" font-family="sans-serif" font-weight="600">ESCANEA PARA INSTALAR</text>
<text x="320" y="799" text-anchor="middle" fill="#dae2ef" font-size="20" font-family="sans-serif">Android · iPhone</text>
</svg>`;
const output=resolve(file);
await mkdir(dirname(output),{recursive:true});
await writeFile(output,illustration,'utf8');
console.log('Install poster SVG created:',output);
