import { useEffect, useState } from "react";
import { focusedFieldDelta, keyboardGeometry } from "@/lib/mobile-viewport";
export { keyboardGeometry } from "@/lib/mobile-viewport";
export function editableElement(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    (element.isContentEditable ||
      element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLInputElement &&
        !["checkbox", "radio", "file", "button", "submit", "range", "color", "hidden"].includes(
          element.type,
        )))
  );
}
// Kept across route layouts, separately per physical orientation. Never derive
// orientation from the keyboard-shortened innerHeight (Safari can retain focus).
const expandedHeights = new Map<string, number>();
export function useMobileKeyboard() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const orientation = () => {
      const native = screen.orientation?.type?.split("-")[0];
      if (native) return native;
      const angle = (window as Window & { orientation?: number }).orientation;
      if (typeof angle === "number") return Math.abs(angle) % 180 === 90 ? "landscape" : "portrait";
      return screen.width > screen.height ? "landscape" : "portrait";
    };
    let frame = 0,
      settle: ReturnType<typeof setTimeout> | undefined,
      observed: ResizeObserver | undefined,
      reveal = false;
    const update = (ensureVisible = false) => {
      reveal ||= ensureVisible;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const shouldReveal = reveal;
        reveal = false;
        const vv = window.visualViewport,
          active = document.activeElement;
        const height = vv?.height ?? innerHeight,
          offset = vv?.offsetTop ?? 0,
          scale = vv?.scale ?? 1,
          key = `${orientation()}:${Math.round(innerWidth)}`;
        const baseline = Math.max(expandedHeights.get(key) ?? 0, innerHeight, height * scale);
        expandedHeights.set(key, baseline);
        // An orientation notification can precede the new width. Its old-size
        // sample must not become the baseline for the final rotated viewport.
        if (expandedHeights.size > 12) expandedHeights.delete(expandedHeights.keys().next().value!);
        const focused = editableElement(active),
          mobile = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
        const geometry = keyboardGeometry(
          baseline,
          innerHeight,
          height,
          offset,
          focused && mobile,
          scale,
        );
        if (!vv && focused && mobile) geometry.open = true;
        const voice = document.querySelector(".snoop-listening")?.getBoundingClientRect();
        if (voice) geometry.top = Math.max(geometry.top, voice.bottom + 12);
        setOpen(geometry.open);
        const style = document.documentElement.style;
        style.setProperty("--snoop-visible-height", `${height}px`);
        style.setProperty("--snoop-visible-top", `${offset}px`);
        style.setProperty(
          "--snoop-keyboard-inset",
          `${geometry.open ? Math.max(0, innerHeight - height - offset) : 0}px`,
        );
        document.body.dataset.snoopKeyboard = String(geometry.open);
        if (!shouldReveal || !geometry.open || !focused) return;
        const rect = active.getBoundingClientRect();
        let remaining = focusedFieldDelta(geometry.top, geometry.bottom, rect.top, rect.bottom);
        if (Math.abs(remaining) < 1) return;
        let parent = active.parentElement;
        while (parent && parent !== document.body) {
          if (
            /auto|scroll/.test(getComputedStyle(parent).overflowY) &&
            parent.scrollHeight > parent.clientHeight
          ) {
            const before = parent.scrollTop;
            parent.scrollTop += remaining;
            remaining -= parent.scrollTop - before;
            if (Math.abs(remaining) < 1) return;
          }
          parent = parent.parentElement;
        }
        window.scrollBy({ top: remaining, behavior: "instant" });
      });
    };
    const resize = () => update(true),
      pan = () => update(false);
    const focus = () => {
      observed?.disconnect();
      const active = document.activeElement;
      if (editableElement(active) && typeof ResizeObserver !== "undefined") {
        observed ??= new ResizeObserver(resize);
        observed.observe(active);
        const dialog = active.closest('[role="dialog"], [role="alertdialog"]');
        if (dialog) observed.observe(dialog);
      }
      resize();
      clearTimeout(settle);
      settle = setTimeout(resize, 280);
    };
    const rotate = () => {
      resize();
      clearTimeout(settle);
      settle = setTimeout(resize, 280);
    };
    const resume = () => {
      if (document.visibilityState === "visible") focus();
    };
    window.visualViewport?.addEventListener("resize", resize);
    // Safari pans on focus and on document scroll. Do not counter-scroll its pan.
    window.visualViewport?.addEventListener("scroll", pan);
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", rotate);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", focus);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      observed?.disconnect();
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", pan);
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", rotate);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", focus);
      delete document.body.dataset.snoopKeyboard;
      for (const key of ["--snoop-visible-height", "--snoop-visible-top", "--snoop-keyboard-inset"])
        document.documentElement.style.removeProperty(key);
    };
  }, []);
  return open;
}
