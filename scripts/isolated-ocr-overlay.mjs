// Applies only offline document scanning to the exact known-live SNOOP source checkout.
// This runs in a disposable CI working directory. It does not commit or deploy.
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
const [baseline, ocr] = process.argv.slice(2);
if (!baseline || !ocr) throw Error("Usage: node isolated-ocr-overlay.mjs baseline ocr");
const file = "src/routes/_authenticated/soci.nuovo.tsx";
const read = (root,p) => readFile(join(root,p),"utf8");
let base=await read(baseline,file);
const modern=await read(ocr,file);
const startMark="  // --- Document OCR: take up to 2 photos";
const modernStart=modern.indexOf("  // Explicitly-consented external document reading.");
const modernEnd=modern.indexOf("\n  const voice = useWhisperDictation",modernStart);
const baseStart=base.indexOf(startMark);
const baseEnd=base.indexOf("\n  const voice = useWhisperDictation",baseStart);
if(modernStart<0||modernEnd<0||baseStart<0||baseEnd<0) throw Error("OCR function markers drifted: fail closed");
const reader = modern.slice(modernStart,modernEnd);
const oldImport='  extractMemberFieldsFromImages,\n';
if(!base.includes(oldImport)) throw Error("Baseline AI import drifted");
base=base.replace(oldImport,"");
const anchor='import { useWhisperDictation } from "@/hooks/useWhisperDictation";';
if(!base.includes(anchor)) throw Error("Baseline import hook drifted");
base=base.replace(anchor, anchor+'\nimport { extractMemberFieldsWithMistral, mistralDocumentOcrStatus } from "@/lib/mistral-documents.functions";');
const hook="  const extractFromImages = useServerFn(extractMemberFieldsFromImages);\n";
if(!base.includes(hook)) throw Error("Baseline OCR hook drifted");
base=base.replace(hook,'  const mistralStatus = useServerFn(mistralDocumentOcrStatus);\n  const mistralExtract = useServerFn(extractMemberFieldsWithMistral);\n');
const s=base.indexOf(startMark), e=base.indexOf("\n  const voice = useWhisperDictation",s);
base=base.slice(0,s)+reader+base.slice(e);
// Keep every unrelated form element untouched. Replace exactly the OCR scanner
// entry widget, preserving existing preview and the rest of Crear socio.
const baseUiStart=base.indexOf("      {/* Document scan (OCR):");
const modernUiStart=modern.indexOf("      {/* Document scan: camera and gallery");
const baseUiEnd=base.indexOf("\n        {scanPreviews.length > 0 && (",baseUiStart);
const modernUiEnd=modern.indexOf("\n        {scanPreviews.length > 0 && (",modernUiStart);
if(baseUiStart<0 || modernUiStart<0 || baseUiEnd<0 || modernUiEnd<0)
  throw Error("Scanner UI markers drifted: fail closed");
base=base.slice(0,baseUiStart)+modern.slice(modernUiStart,modernUiEnd)+base.slice(baseUiEnd);
await writeFile(join(baseline,file),base);
const copyPaths=["src/lib/local-document-mrz.ts","src/lib/local-document-ocr.ts","src/lib/local-document-visual.ts","src/lib/mistral-documents.functions.ts","scripts/prepare-local-document-ocr.mjs","tests/local-document-mrz.test.ts","tests/local-document-visual.test.ts"];
for(const p of copyPaths) { await mkdir(join(baseline,p.split("/").slice(0,-1).join("/")),{recursive:true});await copyFile(join(ocr,p),join(baseline,p));}
const pkgPath=join(baseline,"package.json");const pkg=JSON.parse(await readFile(pkgPath,"utf8"));
for(const s of ["dev","build","build:dev","build:worker","build:worker:test"]){
  const prefix="node scripts/prepare-local-document-ocr.mjs && ";
  if(!pkg.scripts[s]) throw Error("Missing baseline build command "+s);
  pkg.scripts[s]=prefix+pkg.scripts[s];
}
for (const [name,version] of Object.entries({"tesseract.js":"7.0.0","tesseract.js-core":"7.0.0","@tesseract.js-data/eng":"1.0.0","@tesseract.js-data/spa":"1.0.0"})) pkg.dependencies[name]=version;
await writeFile(pkgPath,JSON.stringify(pkg,null,2)+"\n");
console.log("ISOLATED_OCR_OVERLAY_OK");
