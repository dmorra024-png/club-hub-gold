let activeReply: { cancel: () => void } | undefined;

/** Only OS-local voices: never silently select a remote synthesis provider. */
export function stopBrowserVoice() {
  const reply = activeReply;
  activeReply = undefined;
  reply?.cancel();
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
export function speakBrowserVoice(
  message: string,
  language: "it" | "es",
  finished: () => void,
  preferredVoiceURI?: string,
): boolean {
  if (
    typeof window === "undefined" ||
    typeof SpeechSynthesisUtterance === "undefined" ||
    !("speechSynthesis" in window) ||
    !message.trim()
  )
    return false;
  // Settle the preceding turn before assigning ownership to the next utterance.
  stopBrowserVoice();
  let completed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = () => {
    if (completed) return;
    completed = true;
    clearTimeout(timer);
    if (activeReply === owner) activeReply = undefined;
    finished();
  };
  const owner = { cancel: done };
  try {
    const voices = window.speechSynthesis
      .getVoices()
      .filter((v) => v.localService === true && v.lang.toLowerCase().startsWith(language));
    if (!voices.length) return false;
    const speech = new SpeechSynthesisUtterance(message.slice(0, 180));
    speech.lang = language === "it" ? "it-IT" : "es-ES";
    speech.rate = 0.95;
    speech.pitch = 0.95;
    speech.voice =
      voices.find((v) => v.voiceURI === preferredVoiceURI) ??
      voices.find((v) => v.lang.toLowerCase() === speech.lang.toLowerCase()) ??
      voices[0];
    speech.onend = done;
    speech.onerror = done;
    activeReply = owner;
    timer = setTimeout(() => {
      if (activeReply === owner) stopBrowserVoice();
    }, 20000);
    window.speechSynthesis.speak(speech);
    return true;
  } catch {
    done();
    return false;
  }
}
