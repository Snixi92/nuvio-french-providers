# 🇫🇷 French Streaming Providers — Nuvio Addon

Addon Stremio pour Nuvio avec **8 providers français** : VF, VOSTFR, MULTI.

---

## ▶️ Comment installer dans NuvioTV

1. Ouvre Nuvio → **Paramètres → Addons**
2. Clique sur **"Add Addon"** / **"Ajouter un addon"**
3. Colle cette URL :

```
https://nuvio-french-providers.onrender.com/manifest.json
```

4. Confirme — les providers apparaissent immédiatement

---

## 📱 Version mobile (Plugin QuickJS)

Pour l'app Nuvio Mobile → **Paramètres → Plugins** → ajoute :

```
https://raw.githubusercontent.com/Snixi92/nuvio-french-providers/main/manifest.json
```

---

## 🎬 Providers inclus

| Provider | Statut | Films | Séries | Qualité |
|---|---|---|---|---|
| Frenchstream | 🟢 Actif | ✅ | ✅ | 1080p, 720p, 480p |
| Papadustream | 🟢 Actif | ✅ | ✅ | 1080p, 720p, 480p |
| Coflix | 🟢 Actif | ✅ | ✅ | 720p, HD |
| Anime-Sama | 🟢 Actif | ❌ | ✅ | 1080p, 720p (Animes VF/VOSTFR) |
| Nakios | 🟡 En maintenance | ✅ | ✅ | 1080p, 720p |
| Purstream | 🟡 En maintenance | ✅ | ✅ | 1080p, 720p |
| Movix | 🟡 En maintenance | ✅ | ✅ | 1080p, 720p |

---

## ⚙️ Architecture

- **Addon Stremio** (NuvioTV/NuvioWeb) : serveur hébergé sur Render, convertit les IDs IMDB → TMDB et interroge les 8 providers en parallèle
- **Plugin QuickJS** (NuvioMobile) : les fichiers `providers/*.js` s'exécutent directement sur l'appareil
