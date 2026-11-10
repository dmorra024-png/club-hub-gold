import { useEffect, useState } from "react";
import { madridToday } from "@/lib/member-administration";
import { RECORDS_CHANGED } from "@/components/FinancialRecordDialog";
/** BFCache/pageshow and Madrid midnight must refresh both cash surfaces. */
export function useCashRefresh() {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let day = madridToday();
    const refresh = () => {
      if (document.visibilityState === "visible") {
        day = madridToday();
        setEpoch((n) => n + 1);
      }
    };
    const rollover = () => {
      if (document.visibilityState === "visible" && madridToday() !== day) refresh();
    };
    for (const event of ["focus", "online", "pageshow", RECORDS_CHANGED])
      window.addEventListener(event, refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(rollover, 30000);
    return () => {
      for (const event of ["focus", "online", "pageshow", RECORDS_CHANGED])
        window.removeEventListener(event, refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
    };
  }, []);
  return [epoch, () => setEpoch((n) => n + 1)] as const;
}
