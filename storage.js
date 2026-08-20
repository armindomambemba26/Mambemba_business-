import { bucket } from "./firebase.js";
import crypto from "crypto";

export async function uploadBuffer(buffer, contentType, folder="products") {
  const name = `${folder}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  const file = bucket.file(name);
  await file.save(buffer, { metadata: { contentType, cacheControl: "public,max-age=31536000" } });
  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(name).replace(/%2F/g, "/")}`;
}
