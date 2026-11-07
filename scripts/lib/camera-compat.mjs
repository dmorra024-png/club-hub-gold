/** html5-qrcode 2.3.8 ignores the play() promise. Catch only its own video surface,
 * suppress an expected AbortError after closing/removal, and report real failures
 * back to the scanner component. No global rejection handler or media prototype patch.
 */
export function guardQrCameraPlayback(code, id) {
  if (
    !id.replaceAll("\\", "/").includes("/html5-qrcode/") ||
    !/\bthis\.surface\.play\(\);/.test(code)
  )
    return null;
  return code.replaceAll(
    "this.surface.play();",
    `void this.surface.play().catch((error) => {
    if (error?.name === "AbortError" && (this.isClosed || !this.surface.isConnected)) return;
    this.surface.dispatchEvent(new CustomEvent("snoop:camera-play-error", {bubbles: true, detail: {name: error?.name || "PlaybackError"}}));
  });`,
  );
}
export function qrCameraCompatibility() {
  return {
    name: "snoop-qr-camera-playback",
    enforce: "pre",
    transform(code, id) {
      const guarded = guardQrCameraPlayback(code, id);
      return guarded === null ? null : { code: guarded, map: null };
    },
  };
}
