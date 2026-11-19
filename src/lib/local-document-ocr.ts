import { parseMrzText, type MrzParseResult } from "./local-document-mrz";

type LocalTesseract = {
  createWorker: (languages: string, oem?: number, options?: Record<string, unknown>) => Promise<{
    recognize: (image: Blob | HTMLCanvasElement) => Promise<{ data: { text: string } }>;
    setParameters: (params: Record<string, string>) => Promise<unknown>;
    terminate: () => Promise<unknown>;
  }>;
};
declare global {
  interface Window { Tesseract?: LocalTesseract }
}
let loader: Promise<LocalTesseract> | undefined;

/** Loads only SNOOP-hosted code; never pulls OCR scripts from a public CDN. */
function localEngine(): Promise<LocalTesseract> {
  if (typeof window === "undefined") return Promise.reject(new Error("OCR local solo disponible en el navegador"));
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!loader) loader = new Promise<LocalTesseract>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "/ocr/tesseract.min.js";
    el.async = true;
    el.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error("El motor OCR local no está disponible"));
    el.onerror = () => reject(new Error("No se ha podido cargar el lector OCR local"));
    document.head.appendChild(el);
  }).catch((error) => {
    loader = undefined;
    throw error;
  });
  return loader;
}

async function bottomCrop(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    const y = Math.round(bitmap.height * 0.56);
    canvas.width = bitmap.width;
    canvas.height = Math.max(1, bitmap.height - y);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No se pudo preparar la imagen para OCR");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, y, bitmap.width, bitmap.height - y, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

function combinedParse(texts: string[]): MrzParseResult | null {
  for (const text of texts) {
    const match = parseMrzText(text);
    if (match) return match;
  }
  return parseMrzText(texts.join("\n"));
}

/**
 * Local-only document scan. No image or OCR text is posted to a backend.
 * Unverified OCR is never used to fill identity fields.
 */
export async function readLocalMrzFromImages(files: readonly Blob[]): Promise<MrzParseResult | null> {
  if (!files.length || files.length > 2) throw new Error("Se necesitan una o dos fotografías");
  const tesseract = await localEngine();
  const worker = await tesseract.createWorker("eng", 1, {
    workerPath: new URL("/ocr/worker.min.js", location.origin).href,
    corePath: new URL("/ocr/core", location.origin).href,
    langPath: new URL("/ocr/lang", location.origin).href,
    workerBlobURL: false,
  });
  try {
    await worker.setParameters({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: "6",
    });
    const texts: string[] = [];
    // Scan the bottom first (MRZ position), then the full image if necessary.
    for (const file of files) {
      const cropped = await bottomCrop(file);
      texts.push((await worker.recognize(cropped)).data.text);
      if (combinedParse(texts)) return combinedParse(texts);
      texts.push((await worker.recognize(file)).data.text);
      if (combinedParse(texts)) return combinedParse(texts);
    }
    return combinedParse(texts);
  } finally {
    await worker.terminate();
  }
}
