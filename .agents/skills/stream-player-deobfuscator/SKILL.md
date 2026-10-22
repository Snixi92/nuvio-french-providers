---
name: stream-player-deobfuscator
description: >-
  Outils et algorithmes de désobfuscation et rétro-ingénierie de scripts JavaScript (Dean Edwards
  Packer eval(p,a,c,k,e,d), Base64/Hex chiffrés, AES-CBC decrypt) pour extraire les URL de flux
  vidéo (.m3u8/.mp4) dissimulées dans les players web.
---

# Stream Player Deobfuscator & Reversing Guide

Ce skill fournit les outils algorithmiques pour déchiffrer et désobfusquer le code JavaScript des lecteurs vidéo de streaming sans exécuter de code arbitraire non sécurisé.

---

## 1. Dépacker Dean Edwards `eval(function(p,a,c,k,e,d)...)`

L'obfuscation la plus répandue chez les hébergeurs (ex: Sibnet, anciens Voe, Doodle, Vidlox).

### Algorithme de Déballage Sécurisé (Pur JS, sans `eval`) :

```javascript
/**
 * Dépacke un script obfusqué avec Dean Edwards Packer.
 * @param {string} packedCode - Chaîne contenant 'eval(function(p,a,c,k,e,d)...'
 * @returns {string} Code JS désobfusqué en clair
 */
function unpackDeanEdwards(packedCode) {
  const match = packedCode.match(/}\s*\(\s*'([^']*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']*)'\.split\('\|'\)/);
  if (!match) {
    // Variante alternative avec guillemets doubles ou sans quotes
    const altMatch = packedCode.match(/}\s*\(\s*"([^"]*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"([^"]*)"\.split\('\|'\)/);
    if (!altMatch) return packedCode;
    return runUnpacker(altMatch[1], parseInt(altMatch[2], 10), parseInt(altMatch[3], 10), altMatch[4].split('|'));
  }
  return runUnpacker(match[1], parseInt(match[2], 10), parseInt(match[3], 10), match[4].split('|'));
}

function runUnpacker(p, a, c, k) {
  function toBase(val, radix) {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let res = '';
    while (val > 0) {
      res = chars[val % radix] + res;
      val = Math.floor(val / radix);
    }
    return res || '0';
  }

  while (c--) {
    if (k[c]) {
      const token = toBase(c, a);
      const regex = new RegExp('\\b' + token + '\\b', 'g');
      p = p.replace(regex, k[c]);
    }
  }
  return p;
}
```

---

## 2. Déchiffrement AES (CryptoJS / Node.js `crypto`)

Plusieurs hébergeurs (ex: Voe, Filemoon, Dood) stockent la configuration du lecteur sous forme de chaîne chiffrée en AES-CBC ou AES-GCM avec un mot de passe ou un sel extrait du DOM (attribut `data-config`, balise `<meta>`, variable JS).

### Déchiffrement AES-CBC en Node.js :

```javascript
const crypto = require('crypto');

/**
 * Déchiffre un payload OpenSSL / CryptoJS encodé en base64
 * @param {string} encryptedBase64 - Données chiffrées (commence souvent par U2FsdGVkX1...)
 * @param {string} passphrase - Clé de chiffrement extraite du script
 */
function decryptCryptoJS_AES(encryptedBase64, passphrase) {
  const cipherData = Buffer.from(encryptedBase64, 'base64');
  // Les 8 premiers octets correspondent au header 'Salted__'
  const salt = cipherData.subarray(8, 16);
  const ciphertext = cipherData.subarray(16);

  // Dérivation de la clé et de l'IV selon l'algorithme EVP_BytesToKey de CryptoJS
  let hashList = [];
  let currentHash = Buffer.alloc(0);
  while (Buffer.concat(hashList).length < 48) { // 32 bytes key + 16 bytes iv
    currentHash = crypto.createHash('md5').update(Buffer.concat([currentHash, Buffer.from(passphrase), salt])).digest();
    hashList.push(currentHash);
  }
  const derivedBytes = Buffer.concat(hashList);
  const key = derivedBytes.subarray(0, 32);
  const iv = derivedBytes.subarray(32, 48);

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(ciphertext, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

---

## 3. Extraction Regex des Flux Vidéo Courants

Une fois le script JS déballé ou déchiffré, rechercher les motifs de configuration vidéo universels :

```javascript
/**
 * Extrait les flux .m3u8 et .mp4 d'une chaîne de script
 * @param {string} scriptContent
 * @returns {Array<string>} Liste des URLs de flux
 */
function extractStreamUrls(scriptContent) {
  const urls = [];

  // Format 1 : source: "https://..." ou file: "https://..."
  const sourceMatches = scriptContent.matchAll(/(?:file|source|src|hls|streamUrl)\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/gi);
  for (const m of sourceMatches) urls.push(m[1]);

  // Format 2 : URL brute .m3u8 ou .mp4 dans le JS
  const rawMatches = scriptContent.matchAll(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)(?:\?[^"']*)?)["']/gi);
  for (const m of rawMatches) {
    if (!urls.includes(m[1])) urls.push(m[1]);
  }

  // Format 3 : JWPlayer sources: [{ file: "..." }]
  const jwMatch = scriptContent.match(/sources\s*:\s*(\[[^\]]+\])/);
  if (jwMatch) {
    try {
      // Nettoyage sommaire avant parsing
      const jsonStr = jwMatch[1].replace(/([a-zA-Z0-9_]+)\s*:/g, '"$1":').replace(/'/g, '"');
      const sources = JSON.parse(jsonStr);
      sources.forEach(s => s.file && urls.push(s.file));
    } catch (e) {}
  }

  return [...new Set(urls)];
}
```
