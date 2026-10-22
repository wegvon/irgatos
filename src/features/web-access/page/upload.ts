import { write } from "./client";

/** A file on its way to the Mac, then attached there. */
export type Upload = {
  key: string;
  name: string;
  /** The Mac's id once every piece arrived. */
  id?: string;
  error?: string;
  /** A thumbnail for pictures, revoked when the chip goes. */
  preview?: string;
};

/** Raw bytes per request: a multiple of 3, so the pieces' base64 joins. */
const PIECE = 180_000;
/** Phone photos are shrunk to this many pixels on the long side. */
const MAX_SIDE = 2048;
const SHRINKABLE = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
]);

/**
 * Sends a file to the Mac in pieces small enough for its relay, shrinking
 * phone photos first. Resolves to the id a message names it by.
 */
export async function uploadFile(file: File): Promise<string> {
  const ready = await shrink(file);
  const bytes = new Uint8Array(await ready.arrayBuffer());
  let id: string | undefined;
  for (let at = 0; at === 0 || at < bytes.length; at += PIECE) {
    const last = at + PIECE >= bytes.length;
    const result = await write<{ uploadId: string }>(
      "upload",
      {
        ...(id ? { uploadId: id } : { name: ready.name, type: ready.type }),
        chunk: base64(bytes.subarray(at, at + PIECE)),
        last,
      },
      false,
    );
    id = result.uploadId;
  }
  return id!;
}

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000)
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

/** A large photo as a JPEG of at most MAX_SIDE pixels; anything else as is. */
async function shrink(file: File): Promise<File> {
  if (!SHRINKABLE.has(file.type) || typeof createImageBitmap !== "function")
    return file;
  try {
    const image = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
    if (scale === 1 && file.type !== "image/heic" && file.size < 1_500_000) {
      image.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas
      .getContext("2d")
      ?.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const blob = await new Promise<Blob | null>((done) =>
      canvas.toBlob(done, "image/jpeg", 0.85),
    );
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
