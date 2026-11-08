import { useCallback, useEffect, useRef, useState } from "react";
export type DictationPhase = "idle" | "starting" | "recording" | "processing";
type Options = {
  scope: string;
  language: "it" | "es";
  getLanguage?: () => "it" | "es";
  available: () => Promise<{ available: boolean }>;
  transcribe: (data: {
    audioBase64: string;
    mimeType: string;
    language: "it" | "es";
  }) => Promise<{ text: string }>;
  onTranscript: (text: string) => Promise<void> | void;
};
/** User-initiated, bounded recording. Cancellation never transcribes a partial clip. */
export function useWhisperDictation(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [phase, setPhase] = useState<DictationPhase>("idle"),
    [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    generation = useRef(0),
    pending = useRef(false),
    mounted = useRef(true),
    owner = useRef(Symbol("snoop-microphone"));
  const release = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    recorder.current = null;
  }, []);
  const cancel = useCallback(
    (message = "") => {
      generation.current++;
      pending.current = false;
      const rec = recorder.current;
      if (rec) {
        rec.onstop = null;
        rec.ondataavailable = null;
        rec.onerror = null;
        if (rec.state === "recording")
          try {
            rec.stop();
          } catch {}
      }
      release();
      if (mounted.current) {
        setPhase("idle");
        setError(message);
      }
    },
    [release],
  );
  const finish = useCallback(() => {
    const rec = recorder.current;
    if (rec?.state === "recording") {
      setPhase("processing");
      try {
        rec.stop();
      } catch {
        cancel("No se pudo finalizar el audio. Usa la entrada manual.");
      }
    }
  }, [cancel]);
  const start = useCallback(async () => {
    if (pending.current || recorder.current?.state === "recording") return;
    setError("");
    if (!navigator.onLine) {
      setError("Sin conexión. Puedes completar el formulario manualmente.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Micrófono no disponible. Usa HTTPS y la entrada manual.");
      return;
    }
    const id = ++generation.current,
      scope = latest.current.scope;
    let language = latest.current.language;
    try {
      language = latest.current.getLanguage?.() ?? language;
    } catch {}
    pending.current = true;
    setPhase("starting");
    try {
      const config = await latest.current.available();
      if (id !== generation.current || !mounted.current) return;
      if (!config.available)
        throw new Error("IA no disponible. Puedes introducir los datos manualmente.");
      window.dispatchEvent(new CustomEvent("snoop:microphone-owner", { detail: owner.current }));
      const tracks = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (id !== generation.current || !mounted.current || scope !== latest.current.scope) {
        tracks.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = tracks;
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ].find((v) => MediaRecorder.isTypeSupported(v));
      if (!mime) throw new Error("Formato de audio no compatible. Usa la entrada manual.");
      const rec = new MediaRecorder(tracks, { mimeType: mime });
      recorder.current = rec;
      const chunks: Blob[] = [];
      let size = 0;
      rec.ondataavailable = (e) => {
        if (id !== generation.current) return;
        if (e.data.size) {
          size += e.data.size;
          if (size > 8_000_000) {
            cancel("Audio demasiado largo. Dicta una frase más corta.");
            return;
          }
          chunks.push(e.data);
        }
      };
      rec.onerror = () =>
        cancel(
          "No se pudo grabar el audio. Revisa el micrófono o introduce los datos manualmente.",
        );
      tracks.getTracks().forEach(
        (t) =>
          (t.onended = () => {
            if (id === generation.current)
              cancel("La grabación se interrumpió. Puedes volver a intentarlo.");
          }),
      );
      rec.onstop = async () => {
        release();
        if (id !== generation.current || !mounted.current) return;
        setPhase("processing");
        try {
          const audio = new Blob(chunks, { type: rec.mimeType });
          if (audio.size < 100)
            throw new Error("Audio vacío. Vuelve a dictar o usa la entrada manual.");
          const data = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(",")[1]);
            r.onerror = () => reject(new Error("No se pudo leer el audio."));
            r.readAsDataURL(audio);
          });
          if (id !== generation.current || scope !== latest.current.scope || !mounted.current)
            return;
          const result = await latest.current.transcribe({
            audioBase64: data,
            mimeType: rec.mimeType,
            language,
          });
          if (id !== generation.current || scope !== latest.current.scope || !mounted.current)
            return;
          if (!result.text?.trim())
            throw new Error(
              "No se entendió el dictado. Reintenta o introduce los datos manualmente.",
            );
          await latest.current.onTranscript(result.text.trim());
        } catch (e) {
          if (id === generation.current && mounted.current)
            setError(
              e instanceof Error ? e.message : "No se pudo transcribir. Usa la entrada manual.",
            );
        } finally {
          if (id === generation.current) {
            pending.current = false;
            if (mounted.current) setPhase("idle");
          }
        }
      };
      rec.start(1000);
      setPhase("recording");
      timer.current = setTimeout(finish, 60000);
    } catch (e) {
      if (id === generation.current) {
        release();
        pending.current = false;
        if (mounted.current) {
          setPhase("idle");
          setError(
            e instanceof Error && e.name === "NotAllowedError"
              ? "Permiso de micrófono denegado. Puedes introducir los datos manualmente."
              : e instanceof Error
                ? e.message
                : "Micrófono no disponible.",
          );
        }
      }
    }
  }, [cancel, finish, release]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);
  useEffect(() => () => cancel(), [options.scope, options.language, cancel]);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden" && pending.current)
        cancel(
          "Dictado interrumpido al salir de la aplicación. No se aplicarán resultados pendientes.",
        );
    };
    const offline = () => {
      if (pending.current) cancel("Conexión interrumpida. No se aplicarán resultados pendientes.");
    };
    const other = (e: Event) => {
      if ((e as CustomEvent).detail !== owner.current && pending.current) cancel();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("offline", offline);
    const languageChanged = () => cancel();
    window.addEventListener("snoop:voice-language", languageChanged);
    window.addEventListener("snoop:microphone-owner", other);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("offline", offline);
      window.removeEventListener("snoop:voice-language", languageChanged);
      window.removeEventListener("snoop:microphone-owner", other);
    };
  }, [cancel]);
  return { phase, error, start, finish, cancel };
}
