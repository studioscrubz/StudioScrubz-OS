import "server-only";
import sharp, { type OutputInfo } from "sharp";

export async function validateDrawnPngSignature(value: string): Promise<void> {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || value.length > 700000) throw new Error("Draw your signature before completing the Agreement.");
  let result: { data: Buffer; info: OutputInfo };
  try {
    const bytes = Buffer.from(match[1], "base64");
    const image = sharp(bytes, { failOn: "error" });
    const metadata = await image.metadata();
    if (metadata.format !== "png") throw new Error("Invalid PNG format");
    result = await image.flatten({ background: "#ffffff" }).toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  } catch {
    throw new Error("The drawn signature must be a valid PNG image.");
  }
  const { data, info } = result;
  if (info.width < 240 || info.height < 80 || info.width > 2400 || info.height > 1200) throw new Error("The drawn signature image has invalid dimensions.");
  let inkPixels = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    if (data[index] < 220 || data[index + 1] < 220 || data[index + 2] < 220) inkPixels += 1;
  }
  if (inkPixels < 40) throw new Error("Draw your signature before completing the Agreement.");
}
