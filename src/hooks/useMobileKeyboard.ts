import { useEffect, useState } from "react";
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
/** Visual viewport is the visible screen; layout viewport can remain behind the keyboard. */
export function keyboardGeometry(
  baseline: number,
  layout: number,
  visible: number,
  offset: number,
  focused: boolean,
) {
  const open = focused && (baseline - visible >= 100 || layout - visible - offset >= 100);
  return { open, top: offset + 12, bottom: offset + visible - 20 };
}
let expandedHeight = 0,
  lastOrientation = "";
export function useMobileKeyboard() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const orientation = () =>
      String(screen.orientation?.type ?? (innerWidth > innerHeight ? "landscape" : "portrait"));
    if (lastOrientation !== orientation()) {
      lastOrientation = orientation();
      expandedHeight = 0;
    }
    expandedHeight = Math.max(expandedHeight, innerHeight, window.visualViewport?.height ?? 0);
    let frame = 0,
      settle: ReturnType<typeof setTimeout> | undefined,
      observed: ResizeObserver | undefined;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const vv = window.visualViewport,
          active = document.activeElement;
        const height = vv?.height ?? innerHeight,
          offset = vv?.offsetTop ?? 0;
        const focused = editableElement(active);
        const geometry = keyboardGeometry(expandedHeight, innerHeight, height, offset, focused);
        // Older mobile browsers expose no keyboard geometry: hide the dock while editing.
        if (!vv && focused && matchMedia("(pointer: coarse)").matches) geometry.open = true;
        if (!focused || !geometry.open)
          expandedHeight = Math.max(expandedHeight, height, innerHeight);
        const voiceBar = document.querySelector(".snoop-listening")?.getBoundingClientRect();
        if (voiceBar) geometry.top = Math.max(geometry.top, voiceBar.bottom + 12);
        setOpen(geometry.open);
        document.documentElement.style.setProperty("--snoop-visible-height", `${height}px`);
        document.documentElement.style.setProperty("--snoop-visible-top", `${offset}px`);
        document.documentElement.style.setProperty(
          "--snoop-keyboard-inset",
          `${geometry.open ? Math.max(0, innerHeight - height - offset) : 0}px`,
        );
        document.body.dataset.snoopKeyboard = String(geometry.open);
        if (!geometry.open || !focused) return;
        const rect = active.getBoundingClientRect();
        if (rect.top >= geometry.top && rect.bottom <= geometry.bottom) return;
        const delta =
          rect.height > geometry.bottom - geometry.top
            ? rect.top - geometry.top
            : (rect.top + rect.bottom - geometry.top - geometry.bottom) / 2;
        let parent = active.parentElement;
        while (parent && parent !== document.body) {
          if (
            /auto|scroll/.test(getComputedStyle(parent).overflowY) &&
            parent.scrollHeight > parent.clientHeight
          ) {
            parent.scrollTop += delta;
            return;
          }
          parent = parent.parentElement;
        }
        window.scrollBy({ top: delta, behavior: "instant" });
      });
    };
    const focus = () => {
      observed?.disconnect();
      const active = document.activeElement;
      if (editableElement(active) && typeof ResizeObserver !== "undefined") {
        // Portalled dialogs can shrink after the first keyboard measurement.
        // Recheck the final layout, without replacing the field or its focus.
        observed ??= new ResizeObserver(update);
        observed.observe(active);
        const dialog = active.closest('[role="dialog"], [role="alertdialog"]');
        if (dialog) observed.observe(dialog);
      }
      update();
      clearTimeout(settle);
      settle = setTimeout(update, 80);
    };
    const rotate = () => {
      expandedHeight = Math.max(innerHeight, window.visualViewport?.height ?? 0);
      lastOrientation = orientation();
      update();
    };
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", rotate);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", focus);
    update();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      observed?.disconnect();
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", rotate);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", focus);
      delete document.body.dataset.snoopKeyboard;
    };
  }, []);
  return open;
}
