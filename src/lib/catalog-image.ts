/** Local-only image decoding. SVG/documents are never accepted or sent to AI. */
export async function readCatalogImage(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024)
    throw new Error("Usa una imagen JPG, PNG o WebP de hasta 5 MB");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.width || !image.height || image.width * image.height > 40_000_000)
      throw new Error("Dimensiones de imagen no compatibles");
    const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.8);
    if (data.length > 1_000_000) throw new Error("Imagen demasiado grande: reduce la resolución");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}
