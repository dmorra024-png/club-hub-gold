/** Device-provided speech synthesis: no paid TTS provider or audio upload by SNOOP. */
export function stopBrowserVoice() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

export function speakBrowserVoice(
  message: string,
  language: "it" | "es",
  finished: () => void,
): boolean {
  if (
    typeof window === "undefined" ||
    typeof SpeechSynthesisUtterance === "undefined" ||
    !("speechSynthesis" in window) ||
    !message.trim()
  ) return false;

  stopBrowserVoice();
  const speech = new SpeechSynthesisUtterance(message.slice(0, 180));
  speech.lang = language === "it" ? "it-IT" : "es-ES";
  speech.rate = 0.95;
  speech.pitch = 0.95;
  // Prefer voices matching the spoken language, otherwise let the OS choose.
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => v.lang.toLowerCase() === speech.lang.toLowerCase())
    ?? voices.find(v => v.lang.toLowerCase().startsWith(language));
  if (preferred) speech.voice = preferred;
  let completed = false;
  const done = () => {
    if (completed) return;
    completed = true;
    finished();
  };
  speech.onend = done;
  speech.onerror = done;
  window.speechSynthesis.speak(speech);
  return true;
}
