import {writeFileSync} from 'node:fs';
// USD, excluding taxes/FX. Public PAYG quotes observed 2026-11-24.
// Infrastructure/model assumptions below are scenarios, NOT measured vendor quotes.
const results=[];
for(const minutes of [500,1000,2000])for(const clubs of [20,100]){
 for(const [name,rate,fixed,extra] of [
 ['Deepgram Standard',0.075,5,0],['Deepgram Advanced',0.163,5,0],
 // Flux multilingual STT quote .0078/min; TTS .045/1k chars.
 // Assume assistant speaks 35% of session at 900 chars/min, model .002/session-min.
 ['Composable Flux STT + Flux TTS',0.0078+0.35*900/1000*0.045,25,0.002],
 // Capacity/quality not benchmarked: hypothetical shared workers + inference fleet.
 ['Self-host scenario 250 USD fixed',0,250,0.002],
 ['Self-host scenario 1000 USD fixed',0,1000,0.002],
 ]){
 const total=minutes*clubs*(rate+extra)+fixed;
 results.push({name,minutes,clubs,providerAndModelUSD:minutes*clubs*(rate+extra),fixedInfrastructureUSD:fixed,totalUSD:total,perClubUSD:total/clubs,assumptionsRequired:!name.startsWith('Deepgram')});
 }
}
writeFileSync(new URL('./cost-results.json',import.meta.url),JSON.stringify({date:'2026-11-24',currency:'USD',taxes:false,fxAssumed:false,promotionalCreditsIncluded:false,capacityMeasured:false,results},null,2));
console.log('PASS: 30 explicit cost scenarios; no service requests or purchases');
