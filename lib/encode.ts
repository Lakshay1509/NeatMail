import sodium from "libsodium-wrappers";

let initialized = false;

async function init() {
  if (!initialized) {
    await sodium.ready;
    initialized = true;
  }
}

// Helper to get key (must be 32 bytes for AES-256-SIV)
function getKey(): Uint8Array {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY is not set");
  }

  // Ensure 32 bytes key
  const keyBytes = sodium.crypto_generichash(32, key, null);
  return keyBytes;
}

// Encrypt
export async function encryptDomain(domain: string): Promise<string> {
  await init();

  const key = getKey();
  const message = sodium.from_string(domain);

  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(message, nonce, key);

  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce, 0);
  combined.set(ciphertext, nonce.length);

  return sodium.to_base64(combined);
}

// Decrypt
export async function decryptDomain(ciphertextB64: string): Promise<string> {
  await init();

  const key = getKey();
  const combined = sodium.from_base64(ciphertextB64);
  const nonceLength = sodium.crypto_secretbox_NONCEBYTES;

  const nonce = combined.slice(0, nonceLength);
  const ciphertext = combined.slice(nonceLength);

  const decrypted = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);

  return sodium.to_string(decrypted);
}