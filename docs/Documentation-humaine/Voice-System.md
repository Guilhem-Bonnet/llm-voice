
## Tableau comparatif des meilleurs systèmes vocaux
| Critère |  Moshi (Open-Source) |  Gradium (API Commerciale) |
| :--- | :--- | :--- |
| **Coût** | **100 % Gratuit** (open source/ local). | Payant (facturation à l'utilisation de l'API). |
| **Infrastructure** | **Local / Auto-hébergé** (Nécessite un bon GPU). | **Cloud** (Zéro matériel requis, géré par Gradium). |
| **Facilité d'intégration** | Moyenne à difficile (configuration du modèle et du serveur). | **Très simple** (simple appel API en quelques lignes de code). |
| **Confidentialité** | Totale (les données vocales ne quittent jamais votre machine). | Dépend des politiques d'entreprise de Gradium. |
| **Performance** | Limitée par la puissance de votre ordinateur. | **Ultra-rapide** (infrastructure optimisée par NVIDIA). |
| **Flexibilité** | Maximale (vous pouvez modifier le code source). | Limitée aux fonctionnalités proposées par l'API. |


###  Décision : 
- Vérifier si il peut faire seulement du TTS
- Pour le moment faire aves Moshi




## Peut-il faire du TTS (Text-to-Speech) avancé ?

Oui, mais sous deux formes différentes :
- **Via le modèle Moshi global (Monologue Intérieur) :** L'architecture de Moshi utilise une méthode appelée Inner Monologue. Avant de générer du son, il écrit du texte dans sa "tête" de manière ultra-rapide pour structurer sa pensée, puis le convertit en voix. Les développeurs peuvent exploiter cette brique pour lui faire faire du TTS en continu.

- **Via les modèles dédiés de Kyutai (Kyutai TTS) :** Le laboratoire a officiellement extrait la puissance vocale de Moshi pour publier des modèles open-source purement dédiés au TTS avancé. 
- **Vous pouvez retrouver sur leur Hugging Face officiel :**
	- Kyutai Pocket TTS : Un modèle très léger et ultra-rapide capable de tourner directement sur un simple processeur (CPU) d'ordinateur.
	- Kyutai TTS 1.6B : Un modèle plus lourd optimisé pour la synthèse vocale fluide en streaming, idéal pour les serveurs.
	- Clonage de voix (Voice Cloning) : Ces modèles TTS intègrent nativement le clonage de voix à partir d'un court extrait audio et fournissent l'horodatage exact de chaque mot prononcé (word-timing).