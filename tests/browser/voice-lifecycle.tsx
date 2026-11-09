// Isolated development-test harness. Not an application route or production entry.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useWhisperDictation } from "../../src/hooks/useWhisperDictation";
const w = window as any;
w.fixture = {
  available: true,
  hold: false,
  holdInterpretation: false,
  uploads: 0,
  applied: 0,
  text: "Comando sintético",
  denied: false,
  samples: 0,
  endedMode: false,
};
function Harness() {
  const [continuous, setContinuous] = useState(false);
  const [scope, setScope] = useState("synthetic-user:club-a:/"),
    [language, setLanguage] = useState<"es" | "it">("es");
  const dict = useWhisperDictation({
    continuous,
    scope,
    language,
    available: async () => ({ available: w.fixture.available }),
    transcribe: async () => {
      w.fixture.uploads++;
      if (w.fixture.hold) await new Promise((r) => (w.fixture.resolve = r));
      return { text: w.fixture.text };
    },
    onTranscript: async () => {
      if (w.fixture.holdInterpretation) await new Promise((r) => (w.fixture.interpret = r));
      w.fixture.applied++;
    },
  });
  const other = useWhisperDictation({
    scope,
    language,
    available: async () => {
      if (w.fixture.holdOtherStatus) await new Promise((r) => (w.fixture.resumeOtherStatus = r));
      return { available: true };
    },
    transcribe: async () => ({ text: "Otro comando sintético" }),
    onTranscript: () => {},
  });
  useEffect(() => {
    w.hook = dict;
    w.setContinuous = setContinuous;
    w.otherHook = other;
    w.setScope = setScope;
    w.setLanguage = setLanguage;
  }, [dict]);
  return (
    <>
      <button onClick={() => void dict.start()}>Start</button>
      <button onClick={dict.finish}>Finish</button>
      <button onClick={() => dict.cancel()}>Cancel</button>
      <output data-other-phase={other.phase}>{other.phase}</output>
      <output data-phase={dict.phase}>{dict.phase}</output>
      <p role="alert">{dict.error}</p>
      <p role="status">{dict.hint}</p>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
