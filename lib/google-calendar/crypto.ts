import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const value = process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY;
  const decoded = value ? Buffer.from(value, "base64") : Buffer.alloc(0);
  if (decoded.length !== 32) throw new Error("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY must be a 32-byte base64 key.");
  return decoded;
}
export function encryptToken(value:string){const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(),iv);const body=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);return [iv,cipher.getAuthTag(),body].map(x=>x.toString("base64url")).join(".")}
export function decryptToken(value:string){const [iv,tag,body]=value.split(".").map(x=>Buffer.from(x,"base64url"));const decipher=createDecipheriv("aes-256-gcm",key(),iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(body),decipher.final()]).toString("utf8")}
