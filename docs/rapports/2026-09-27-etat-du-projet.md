# LLM Voice — rapport d'état au 27 septembre 2026

Auteur : Marcel (concierge Grimoire), pour guilhem-bonnet.
Période couverte : 8 au 27 septembre 2026. Tâche courante : `GAO-diagnostic-s-001`.

---

## 1. En une page

Le projet est passé d'un cahier des charges à une extension VS Code installable, publiée en 0.1.1,
avec une 0.2.1 sur `main` non publiée. Dix-sept critères d'acceptation sont couverts par environ
960 tests automatisés, l'intégration continue tourne sur trois systèmes, et un audit de sécurité a
corrigé quatorze failles dont une critique.

**Et pourtant l'extension ne produit aucun son chez son premier utilisateur réel.**

La cause en a été établie le 27 septembre, par la mesure : Chromium, dans VS Code, refuse toute
lecture audio qui n'est pas déclenchée par un clic de l'utilisateur dans la fenêtre du lecteur.
Cela invalide la décision d'architecture qui faisait passer l'audio par une fenêtre web
(`ADR-001`). Aucune des corrections successives ne pouvait rétablir le son, parce que le blocage
était ailleurs.

Le produit est donc **fonctionnellement complet et inutilisable**, pour une raison unique,
identifiée, et dont la solution est claire mais non commencée.

---

## 2. Ce qui a été livré

| Phase | Contenu | État |
|---|---|---|
| 0 | Cadrage : revue du cahier des charges, brainstorm, revue sécurité, plan de délégation | livré |
| 1 | Dépôt public, gouvernance, intégration continue sur trois systèmes | livré |
| 2 | Onze décisions d'architecture, contrats TypeScript, outillage de test | livré |
| 3 | Tranche verticale : parsing, segmentation, lecteur, surlignage, commandes | livré |
| 4 | Providers réels : Chatterbox sur GPU, narrateur Ollama, Piper | livré |
| 5 | Inbox Claude Code, profils, gestion d'erreurs, journal sans contenu | livré |
| 6 | Audit sécurité, latence, documentation, publication 0.1.0 puis 0.1.1 | livré |
| 7 | Autonomie sans Docker, parcours de découverte, commandes non muettes | livré |
| 8 | Vue dédiée, navigateur de voix, éditeur de profils, dette d'outillage | fusionné, non publié |
| 9 | Diagnostic du son absent | cause trouvée, correction non livrée |

Deux versions publiées : 0.1.0 et 0.1.1. La 0.2.1 est sur `main`, jamais publiée.

---

## 3. L'enquête sur l'absence de son

### 3.1 Symptômes rapportés

Aucun son à la lecture. Surlignage ne correspondant pas à la section demandée et défilant trop
vite. Aucune langue définie après changement de profil ou de voix. Message d'erreur en boucle
proposant indéfiniment le même choix de voix.

### 3.2 Hypothèses éliminées, chacune par une preuve

| Hypothèse | Verdict | Preuve |
|---|---|---|
| Le fichier audio est corrompu | écarté | analyse octet par octet : RIFF, `fmt `, `data` toutes cohérentes, PCM 16 bits mono 22 kHz |
| Écriture partielle du cache | écarté | écriture atomique par fichier temporaire puis renommage |
| Le chemin est publié avant l'écriture | écarté | `audioUri` assigné seulement après l'attente de `put()` |
| Le fichier a été évincé du cache | écarté | cache de 5 Mo pour une limite de 512 Mo, épinglage en place |
| Autorisations de dossier ou politique de sécurité trop strictes | écarté | un WAV synthétique passe dans exactement la même chaîne |
| Deux vues de lecteur se volaient le pont audio | réel, corrigé | le commentaire du code l'admettait ; correction sur `fix/audio-failure-visible` |

### 3.3 Cause racine

Mesure du 27 septembre : une sonde ouvre une vraie fenêtre VS Code sur l'écran réel, charge dix
secondes de sinus à 440 Hz dans un élément audio, demande la lecture, pendant que les flux
PipeWire sont échantillonnés quatre fois par seconde.

```
playRejected: "NotAllowedError: play() can only be initiated by a user gesture."
flux audio VS Code détectés : 0
```

Second essai avec le son coupé avant lecture — une lecture muette est normalement tolérée par
Chromium : **même refus**. La politique d'Electron dans VS Code n'accorde aucune exception.

**Conséquence** : `ADR-001` est structurellement impossible pour une lecture déclenchée par
l'extension. Ce qui fonctionne parfaitement : la synthèse, le fichier produit, le cache, le
transport de ressource. Ce qui est bloqué : la mise en lecture, et elle seule.

---

## 4. Ce qui attend, non fusionné

Cinq commits sur `fix/audio-failure-visible`, tous justes, aucun suffisant :

- une erreur de lecture n'est plus traitée comme une progression ;
- un chien de garde détecte l'absence de progression et la fin de piste qui n'arrive pas ;
- le pont audio signale son échec au lieu de retourner en silence ;
- une vue qui se ferme ne coupe plus le lien d'une vue encore vivante ;
- un fichier de cache manquant est nommé explicitement.

Quatre demandes de fusion ouvertes, dont trois de mises à jour de dépendances. Un test à deux vues
écrit mais jamais validé.

---

## 5. Ce qui ne marche pas aujourd'hui

- Aucun son à la lecture déclenchée par une commande ou par la vue.
- Surlignage désynchronisé, conséquence directe : il avance sur les événements du lecteur, et rien
  ne le ralentit quand la lecture échoue.
- Langue non définie lors du choix de voix : aucun fichier du parcours ne touche ce champ.
- Section de départ incorrecte pour « Lire cette section » : jamais explorée.
- Windows et macOS validés uniquement par l'intégration continue, jamais à la main.

---

## 6. Options

| Option | Délai | Portée | Coût |
|---|---|---|---|
| Clic sur ▶ dans le lecteur | immédiat | contournement, confirme le diagnostic | aucun, mais l'utilisateur doit cliquer à chaque session |
| Lecture par le système depuis l'extension | court | rétablit le son hors du webview | dépend des lecteurs présents, fragile en multiplateforme |
| Moteur audio natif en Rust (`ADR-012`) | moyen | supprime la politique d'autoplay, donne la position réelle, corrige le surlignage | binaires par plateforme, signature, chaîne de compilation |

**Recommandation** : vérifier d'abord le contournement par clic, puis engager le moteur natif, en
gardant la lecture système comme repli si la piste Rust dérape. Fusionner en parallèle les cinq
corrections qui dorment.

---

## 7. Leçons consignées

1. Dix-sept critères d'acceptation verts et 960 tests n'ont pas empêché un produit inutilisable :
   aucun test ne vérifiait qu'un son sortait réellement de la carte son.
2. Un utilisateur qui met à jour n'est pas un utilisateur neuf : aucun test ne partait d'une
   configuration héritée, d'où le blocage sur un profil épinglé à un serveur arrêté.
3. Une erreur silencieuse coûte plus cher qu'une panne bruyante : le défilement muet a masqué la
   cause pendant quatre cycles.
4. Le diagnostic par la mesure directe, ici PipeWire, a tranché en une heure ce que la lecture de
   code n'avait pas tranché en plusieurs jours.
