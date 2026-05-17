# 🇫🇷 French Streaming Providers — Nuvio Addon

Addon Stremio pour Nuvio avec 7 providers français : **Nakios, Purstream, Movix, ToFlix, Frenchstream, Nakastream, Vstream**.

Films & séries en **VF, VOSTFR, MULTI**.

---

## ▶️ Comment installer dans NuvioTV

1. Ouvre Nuvio → **Paramètres → Addons**
2. Clique sur **"Add Addon"** / **"Ajouter un addon"**
3. Colle cette URL :

```
https://nuvio-french-providers.onrender.com/manifest.json
```

4. Confirme — les 7 providers apparaissent immédiatement

---

## 📱 Version mobile (Plugin QuickJS)

Pour l'app Nuvio Mobile → **Paramètres → Plugins** → ajoute :

```
https://raw.githubusercontent.com/Snixi92/nuvio-french-providers/main/manifest.json
```

---

## 🎬 Providers inclus

| Provider | Films | Séries | Qualité |
|---|---|---|---|
| Nakios | ✅ | ✅ | 4K, 1080p, 720p |
| Purstream | ✅ | ✅ | 1080p, 720p |
| Movix | ✅ | ✅ | 1080p, 720p |
| ToFlix | ✅ | ✅ | HD |
| Frenchstream | ✅ | ✅ | HD |
| Nakastream | ✅ | ✅ | 1080p, 720p |
| Vstream | ✅ | ✅ | HD |

---

## ⚙️ Architecture

- **Addon Stremio** (NuvioTV/NuvioWeb) : serveur hébergé sur Render, convertit les IDs IMDB → TMDB et interroge les 7 providers en parallèle
- **Plugin QuickJS** (NuvioMobile) : les fichiers `providers/*.js` s'exécutent directement sur l'appareil
