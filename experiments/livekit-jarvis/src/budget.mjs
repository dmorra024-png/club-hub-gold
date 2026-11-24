/**
 * Illustrative LiveKit Ship budget, NOT a billing invoice or quotation.
 * $50 shared by all clubs, 5000 included session minutes across the project.
 * STT: Deepgram Nova-3 multilingual ($.0058/session min).
 * TTS: Aura-2 ($.018/generated-audio min), estimated 30% of session.
 * LLM: Gemma 4 31B estimated $.0014/session min from LiveKit estimator.
 * Actual model calls depend on token counts; provider pricing can change.
 */
export function costEstimate({clubs,minutesPerClub,speechShare=0.3}){
 if(!Number.isInteger(clubs)||clubs<=0 || !Number.isFinite(minutesPerClub)||minutesPerClub<0 || speechShare<0||speechShare>1) throw Error('Invalid budget inputs');
 const totalMinutes=clubs*minutesPerClub;
 const hostingTotal=50+Math.max(0,totalMinutes-5000)*0.01;
 const stt=minutesPerClub*0.0058;
 const tts=minutesPerClub*speechShare*0.018;
 const llmEstimate=minutesPerClub*0.0014;
 return {hostingPerClub:hostingTotal/clubs,stt,tts,llmEstimate,totalPerClub:hostingTotal/clubs+stt+tts+llmEstimate};
}
