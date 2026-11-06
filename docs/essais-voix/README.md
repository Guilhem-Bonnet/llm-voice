# Textes d'essai des voix

Ces textes servent à écouter et à comparer les voix de LLM Voice. Les fichiers numérotés alimentent le banc et contiennent des balises : pour écouter un document normal dans l'extension, ouvre `lecture-demo.md`.

| Fichier | Ce qu'on écoute |
|---|---|
| `lecture-demo.md` | **À ouvrir pour essayer l'extension** : un document normal à lire à voix haute |
| `01-mots-techniques.md` | La prononciation du vocabulaire technique, telle quelle puis réécrite phonétiquement |
| `02-ton-et-style.md` | Le même contenu écrit dans plusieurs tons |
| `03-personnages.md` | Une scène à plusieurs voix |
| `04-documents.md` | Des passages longs : documentation, récit, réponse de Claude |
| `05-francophonies.md` | Des tournures de France, du Québec, de Belgique et de Suisse |

## Format

- `@nom: texte` : une réplique ou une variante. Le nom désigne le personnage ou le style.
- `% personnage = voix` : la voix attribuée à un personnage.
- `- mot :: forme phonétique :: phrase avec {x}` : un mot à tester, `{x}` étant remplacé par le mot.

Le reste du fichier est ignoré par le banc.

## Lancer le banc

`scripts/voice-lab/run.sh` demande le serveur `pocket-tts serve --language french` sur le port 8000 et écrit une page d'écoute avec ses mesures. Les mesures disent si l'audio a changé, pas s'il est agréable : seule ton écoute tranche.
