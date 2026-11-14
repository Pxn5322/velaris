/**
 * Browser-side profile photo preparation.
 *
 * The deployment has no object-storage binding, so the API stores a bounded
 * data URL. This module accepts only PNG/JPEG/WebP, center-crops to a square
 * and downsizes to 256 px before encoding. That keeps the request small and
 * removes EXIF/location metadata through the canvas round trip.
 */

export const AVATAR_INPUT_MAX_BYTES = 10 * 1024 * 1024;
export const AVATAR_OUTPUT_MAX_BYTES = 512 * 1024;
const AVATAR_SIZE = 256;
const ACCEPTED = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!ACCEPTED.has(file.type)) {
    throw new Error("Choose a PNG, JPEG or WebP image.");
  }
  if (file.size === 0 || file.size > AVATAR_INPUT_MAX_BYTES) {
    throw new Error("Choose an image smaller than 10 MB.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare the image.");

    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    context.drawImage(
      bitmap,
      sx,
      sy,
      side,
      side,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    );

    const encoded = canvas.toDataURL("image/webp", 0.85);
    if (encoded.length > AVATAR_OUTPUT_MAX_BYTES * 1.4) {
      throw new Error("That image is still too large after resizing.");
    }
    return encoded;
  } finally {
    bitmap.close();
  }
}
