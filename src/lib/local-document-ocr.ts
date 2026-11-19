import { parseMrzText, type MrzParseResult } from "./local-document-mrz";
import { parsePrintedDocumentText, type VisualDocumentFields } from "./local-document-visual";

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

/**
 * Keep the source camera resolution until OCR finishes. The original
 * compressed upload preview can be small enough to destroy MRZ glyphs.
 * Limit output dimensions so Android/iOS do not allocate huge WASM bitmaps.
 */
async function cropForMrz(
  image: ImageBitmap,
  topRatio: number,
  threshold = false,
): Promise<HTMLCanvasElement> {
  const top = Math.floor(image.height * topRatio);
  const height = Math.max(1, image.height - top);
  const targetWidth = Math.min(2600, Math.max(image.width, 1600));
  const scale = targetWidth / image.width;
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = Math.min(2400, Math.round(height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No se pudo preparar la imagen para OCR");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, top, image.width, height, 0, 0, canvas.width, canvas.height);
  if (threshold) {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = pixels.data;
    for (let p = 0; p < data.length; p += 4) {
      const luma = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) / 256;
      const value = luma > 145 ? 255 : 0;
      data[p] = data[p + 1] = data[p + 2] = value;
    }
    ctx.putImageData(pixels, 0, 0);
  }
  return canvas;
}

function combinedParse(texts: string[]): MrzParseResult | null {
  for (const text of texts) {
    const match = parseMrzText(text);
    if (match) return match;
  }
  return parseMrzText(texts.join("\n"));
}

export type LocalDocumentResult =
  | { format: "TD1" | "TD3"; verified: true; fields: MrzParseResult["fields"]; rawText: "" }
  | { format: "PRINTED"; verified: false; fields: VisualDocumentFields; rawText: string };

/**
 * Returns MRZ-verified fields when available, otherwise conservatively
 * labeled printed fields and a human-readable OCR preview. Never uploads.
 */
export async function readLocalDocumentFromImages(files: readonly Blob[]): Promise<LocalDocumentResult | null> {
  const mrz = await readLocalMrzFromImages(files);
  if (mrz) return { ...mrz, rawText: "" };
  const tesseract = await localEngine();
  const worker = await tesseract.createWorker("spa+eng", 1, {
    workerPath: new URL("/ocr/worker.min.js", location.origin).href,
    corePath: new URL("/ocr/core", location.origin).href,
    langPath: new URL("/ocr/lang", location.origin).href,
    workerBlobURL: false,
  });
  try {
    await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "3" });
    const texts: string[] = [];
    for (const file of files) {
      const bitmap = await createImageBitmap(file);
      try {
        const image = await cropForMrz(bitmap, 0);
        texts.push((await worker.recognize(image)).data.text);
      } finally { bitmap.close(); }
    }
    const rawText=texts.join("\n").trim().slice(0, 6000);
    if (!rawText) return null;
    const fields=parsePrintedDocumentText(rawText);
    return {format:"PRINTED",verified:false,fields,rawText};
  } finally {
    await worker.terminate();
  }
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
    for (const file of files) {
      const bitmap = await createImageBitmap(file);
      try {
        // Passport booklets may have the MRZ in the bottom quarter.
        // ID cards have MRZ across the lower half; try both separately.
        for (const ratio of [0.68, 0.48, 0]) {
          const region = await cropForMrz(bitmap, ratio);
          const found = (await worker.recognize(region)).data.text;
          texts.push(found);
          const verified = combinedParse(texts);
          if (verified) return verified;
        }
        // Contrast preprocessing can recover thin OCR-B glyphs on patterned
        // passport paper. No data is accepted without check digits.
        const highContrast = await cropForMrz(bitmap, 0.56, true);
        texts.push((await worker.recognize(highContrast)).data.text);
        const verified = combinedParse(texts);
        if (verified) return verified;
      } finally {
        bitmap.close();
      }
    }
    return combinedParse(texts);
  } finally {
    await worker.terminate();
  }
}
