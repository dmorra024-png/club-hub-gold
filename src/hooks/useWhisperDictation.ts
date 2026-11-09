import { useCallback, useEffect, useRef, useState } from "react";
import { SpeechEndpoint } from "../lib/speech-endpoint";
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
  onStart?: () => void;
  onTranscript: (text: string) => Promise<void> | void;
};
type Capture = {
  recorder?: MediaRecorder;
  stream?: MediaStream;
  context?: AudioContext;
  source?: MediaStreamAudioSourceNode;
  interval?: ReturnType<typeof setInterval>;
  timer?: ReturnType<typeof setTimeout>;
  stopping?: boolean;
  released?: boolean;
  stopped?: boolean;
};
/** Each recording owns its resources. Old callbacks cannot release a newer microphone. */
export function useWhisperDictation(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [phase, setPhase] = useState<DictationPhase>("idle"),
    [error, setError] = useState(""),
    [hint, setHint] = useState("");
  const capture = useRef<Capture | null>(null),
    generation = useRef(0),
    pending = useRef(false),
    mounted = useRef(true),
    owner = useRef(Symbol("snoop-microphone"));
  const release = useCallback((s: Capture) => {
    if (s.released) return;
    s.released = true;
    clearTimeout(s.timer);
    clearInterval(s.interval);
    s.source?.disconnect();
    if (s.context && s.context.state !== "closed") void s.context.close().catch(() => {});
    s.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    if (capture.current === s) capture.current = null;
  }, []);
  const cancel = useCallback(
    (message = "") => {
      generation.current++;
      pending.current = false;
      const s = capture.current;
      if (s) {
        const r = s.recorder;
        if (r) {
          r.onstop = null;
          r.ondataavailable = null;
          r.onerror = null;
          if (r.state !== "inactive")
            try {
              r.stop();
            } catch {}
        }
        release(s);
      }
      if (mounted.current) {
        setPhase("idle");
        setError(message);
        setHint("");
      }
    },
    [release],
  );
  const finish = useCallback(() => {
    const s = capture.current,
      rec = s?.recorder;
    if (!s || s.stopping || rec?.state !== "recording") return;
    s.stopping = true;
    clearTimeout(s.timer);
    clearInterval(s.interval);
    setPhase("processing");
    try {
      rec.stop();
    } catch {
      cancel("No se pudo finalizar el audio. Usa la entrada manual.");
    }
  }, [cancel]);
  const start = useCallback(async () => {
    // Explicit start is idempotent throughout startup, recording AND interpretation.
    if (pending.current) return;
    setError("");
    setHint("");
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
    const valid = () =>
      id === generation.current && mounted.current && scope === latest.current.scope;
    let language = latest.current.language;
    try {
      language = latest.current.getLanguage?.() ?? language;
    } catch {}
    const s: Capture = {};
    capture.current = s;
    pending.current = true;
    setPhase("starting");
    latest.current.onStart?.();
    // The latest user gesture owns the microphone, not the fastest status request.
    window.dispatchEvent(new CustomEvent("snoop:microphone-owner", { detail: owner.current }));
    // Resume inside the original user gesture, before any permission/network await (Safari).
    try {
      const Audio =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Audio) {
        s.context = new Audio();
        void s.context.resume().catch(() => {});
      }
    } catch {}
    try {
      const config = await latest.current.available();
      if (!valid()) {
        release(s);
        return;
      }
      if (!config.available)
        throw new Error("IA no disponible. Puedes introducir los datos manualmente.");
      const tracks = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!valid()) {
        tracks.getTracks().forEach((t) => t.stop());
        release(s);
        return;
      }
      s.stream = tracks;
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ].find((v) => MediaRecorder.isTypeSupported(v));
      if (!mime) throw new Error("Formato de audio no compatible. Usa la entrada manual.");
      const rec = new MediaRecorder(tracks, { mimeType: mime });
      s.recorder = rec;
      const chunks: Blob[] = [];
      let size = 0;
      rec.ondataavailable = (e) => {
        if (!valid()) return;
        if (e.data.size) {
          size += e.data.size;
          if (size > 8_000_000) {
            cancel("Audio demasiado largo. Dicta una frase más corta.");
            return;
          }
          chunks.push(e.data);
        }
      };
      rec.onerror = () => {
        if (valid())
          cancel(
            "No se pudo grabar el audio. Revisa el micrófono o introduce los datos manualmente.",
          );
      };
      tracks.getTracks().forEach(
        (t) =>
          (t.onended = () => {
            if (valid() && !s.released)
              cancel("La grabación se interrumpió. Puedes volver a intentarlo.");
          }),
      );
      rec.onstop = async () => {
        if (s.stopped) return;
        s.stopped = true;
        // Check before release; never release whatever capture happens to be current.
        release(s);
        if (!valid()) return;
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
          if (!valid()) return;
          const result = await latest.current.transcribe({
            audioBase64: data,
            mimeType: rec.mimeType,
            language,
          });
          if (!valid()) return;
          if (!result.text?.trim())
            throw new Error(
              "No se entendió el dictado. Reintenta o introduce los datos manualmente.",
            );
          await latest.current.onTranscript(result.text.trim());
        } catch (e) {
          if (valid())
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
      rec.start(250);
      setPhase("recording");
      try {
        if (!s.context) throw new Error("No audio analyser");
        const ctx = s.context,
          source = ctx.createMediaStreamSource(tracks),
          analyser = ctx.createAnalyser();
        s.source = source;
        analyser.fftSize = 1024;
        source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize),
          endpoint = new SpeechEndpoint(performance.now());
        s.interval = setInterval(() => {
          if (!valid() || s.stopping || rec.state !== "recording") return;
          if (ctx.state !== "running") {
            setHint(
              "Finalización automática no disponible. Pulsa para terminar o escribe el comando.",
            );
            return;
          }
          analyser.getByteTimeDomainData(samples);
          let power = 0;
          for (const sample of samples) power += (sample - 128) ** 2;
          const end = endpoint.sample(Math.sqrt(power / samples.length) / 128, performance.now());
          if (end === "no-speech")
            cancel("No se detectó voz. Vuelve a intentarlo o escribe el comando.");
          else if (end) finish();
        }, 120);
      } catch {
        setHint("Finalización automática no disponible. Pulsa para terminar o escribe el comando.");
      }
      s.timer = setTimeout(finish, 60000);
    } catch (e) {
      release(s);
      if (id === generation.current) {
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
    const languageChanged = () => cancel();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("offline", offline);
    window.addEventListener("snoop:voice-language", languageChanged);
    window.addEventListener("snoop:microphone-owner", other);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("offline", offline);
      window.removeEventListener("snoop:voice-language", languageChanged);
      window.removeEventListener("snoop:microphone-owner", other);
    };
  }, [cancel]);
  return { phase, error, hint, start, finish, cancel };
}
