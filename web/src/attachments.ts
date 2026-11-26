/**
 * Turning photos and files into something the tutor can read — all done on the phone,
 * so nothing is uploaded anywhere except to our own Worker.
 *  - Photos are shrunk to ≤1600px JPEG (smaller upload, lower AI cost).
 *  - PDFs: every page (up to MAX_PHOTOS) becomes an image so handwriting and annotations are
 *    seen, and any typed text is extracted too to help with reading printed questions.
 *  - Word (.docx) and .txt: text is extracted.
 */

export type Attachment =
  | { kind: "image"; name: string; dataUrl: string }
  | { kind: "text"; name: string; text: string };

export const MAX_PHOTOS = 6;
export const MAX_FILE_TEXT = 8000;
const MAX_SIDE = 1600;
const MAX_DATA_URL = 1_400_000;
export const ACCEPT = "image/*,application/pdf,.pdf,.docx,.txt";

export async function readAttachment(file: File): Promise<Attachment[]> {
  const name = file.name || "photo";
  const lower = name.toLowerCase();
  if (file.type.startsWith("image/")) return [{ kind: "image", name, dataUrl: await compressImage(file) }];
  if (file.type === "application/pdf" || lower.endsWith(".pdf")) return readPdf(file, name);
  if (lower.endsWith(".docx")) return [{ kind: "text", name, text: clip(await readDocx(file)) }];
  if (file.type.startsWith("text/") || lower.endsWith(".txt")) return [{ kind: "text", name, text: clip(await file.text()) }];
  throw new Error(`${name}: please use a photo, PDF, Word (.docx) or .txt file.`);
}

function clip(text: string) {
  const t = text.replace(/\n{3,}/g, "\n\n").trim();
  return t.length > MAX_FILE_TEXT ? t.slice(0, MAX_FILE_TEXT) + "\n[…file shortened]" : t;
}

async function loadImage(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file);
  } catch {
    // Fallback for browsers where createImageBitmap can't decode this type.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function canvasToJpeg(source: CanvasImageSource, w: number, h: number): string {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // transparent PNGs → white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  for (const q of [0.82, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= MAX_DATA_URL) return url;
  }
  throw new Error("That photo is too large. Try cropping it.");
}

export async function compressImage(file: Blob): Promise<string> {
  let img;
  try {
    img = await loadImage(file);
  } catch {
    throw new Error("Couldn't open that photo. On iPhone, try Settings → Camera → Formats → Most Compatible, or send a screenshot.");
  }
  return canvasToJpeg(img, img.width, img.height);
}

async function readPdf(file: File, name: string): Promise<Attachment[]> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = Math.min(doc.numPages, MAX_PHOTOS);
  const out: Attachment[] = [];
  let text = "";
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n\n";
    // Render the whole page (including handwriting and ink annotations) as an image.
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
    out.push({ kind: "image", name: `${name} (page ${i})`, dataUrl: canvasToJpeg(canvas, canvas.width, canvas.height) });
  }
  let note = "";
  if (doc.numPages > pages) note = `\n[Only the first ${pages} of ${doc.numPages} pages were attached. Send the rest separately.]`;
  if (text.replace(/\s/g, "").length > 20 || note) {
    out.unshift({ kind: "text", name: `${name} (typed text)`, text: clip(text) + note });
  }
  if (doc.numPages > pages) warnUser(`${name} has ${doc.numPages} pages — only the first ${pages} were attached.`);
  return out;
}

/** Surface a warning without failing the upload. */
let warn: ((msg: string) => void) | null = null;
export function onAttachmentWarning(fn: (msg: string) => void) {
  warn = fn;
}
function warnUser(msg: string) {
  warn?.(msg);
}

async function readDocx(file: File): Promise<string> {
  const mammoth = (await import("mammoth/mammoth.browser.js")).default;
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}
