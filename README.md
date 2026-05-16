# 🇫🇷 French Streaming Providers — Nuvio Addon

Addon Stremio pour Nuvio avec 5 providers français : **Nakios, Purstream, Movix, ToFlix, Frenchstream**.

Films & séries en **VF, VOSTFR, MULTI**.

---

## ▶️ Comment installer dans NuvioTV

1. Ouvre Nuvio → **Paramètres → Addons**
2. Clique sur **"Add Addon"** / **"Ajouter un addon"**
3. Colle cette URL :

```
https://1390a5ce-b71b-4588-92c0-194c4ab8a3f5-00-8t5kguuznezs.spock.replit.dev/api/stremio/manifest.json
```

4. Confirme — les 5 providers apparaissent immédiatement

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

---

## ⚙️ Architecture

- **Addon Stremio** (NuvioTV/NuvioWeb) : serveur hébergé sur Replit, convertit les IDs IMDB → TMDB et interroge les 5 providers en parallèle
- **Plugin QuickJS** (NuvioMobile) : les fichiers `providers/*.js` s'exécutent directement sur l'appareil
