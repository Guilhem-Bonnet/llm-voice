---
title: "Cours Kubernetes — Les fondamentaux"
author: "Formation LLM Voice"
date: 2026-09-08
tags: [kubernetes, devops, conteneurs]
---

# Cours Kubernetes — Les fondamentaux

Bienvenue dans ce cours d'introduction à Kubernetes. Nous allons couvrir les
concepts essentiels : pods, deployments, services, et sondes de santé.

Ce document sert de fixture pour tester le parseur Markdown de LLM Voice
(cahier-des-charges.md §11-13) : titres, blocs de code, tableaux, listes,
liens, images et frontmatter YAML.

## 1. Qu'est-ce que Kubernetes ?

Kubernetes est un orchestrateur de conteneurs open source. Il automatise le
déploiement, la mise à l'échelle et la gestion des applications conteneurisées.

Voir la documentation officielle : [kubernetes.io](https://kubernetes.io/fr/docs/home/).

![Architecture Kubernetes](https://kubernetes.io/images/docs/components-of-kubernetes.svg)

### 1.1 Les composants du control plane

Le control plane comprend plusieurs composants clés :

- `kube-apiserver` — le point d'entrée de toutes les commandes REST
- `etcd` — le magasin clé-valeur qui stocke l'état du cluster
- `kube-scheduler` — assigne les pods aux nœuds disponibles
- `kube-controller-manager` — exécute les boucles de contrôle

### 1.2 Les composants du nœud (node)

1. `kubelet` — l'agent qui s'assure que les conteneurs tournent dans un pod
2. `kube-proxy` — maintient les règles réseau sur chaque nœud
3. Le runtime de conteneurs (containerd, CRI-O, etc.)

## 2. Le Pod, unité de base

Un Pod est la plus petite unité déployable de Kubernetes. Il encapsule un ou
plusieurs conteneurs partageant le même réseau et le même stockage.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: hello-world
  labels:
    app: hello-world
spec:
  containers:
    - name: app
      image: nginx:1.27
      ports:
        - containerPort: 80
```

Pour créer ce pod, on exécute :

```bash
kubectl apply -f pod.yaml
kubectl get pods -o wide
```

## 3. Les probes de santé

Kubernetes distingue trois types de sondes :

| Sonde       | Rôle                                   | Effet en cas d'échec          |
|-------------|-----------------------------------------|--------------------------------|
| liveness    | vérifie que le conteneur est vivant     | redémarrage du conteneur       |
| readiness   | vérifie que le conteneur peut servir    | retrait du service (endpoints) |
| startup     | protège les démarrages lents            | délai supplémentaire accordé   |

Exemple de configuration :

```yaml
readinessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 15
  periodSeconds: 20
```

## 4. Deployments et ReplicaSets

Un `Deployment` gère un `ReplicaSet`, qui lui-même gère un ensemble de pods
identiques. Cela permet :

- des mises à jour progressives (`RollingUpdate`) ;
- un retour en arrière (`kubectl rollout undo`) ;
- une mise à l'échelle horizontale (`kubectl scale`).

```bash
kubectl create deployment web --image=nginx:1.27 --replicas=3
kubectl scale deployment web --replicas=5
kubectl rollout status deployment/web
```

## 5. Services et découverte réseau

Un `Service` expose un ensemble de pods sous une adresse stable.

| Type          | Portée                              |
|---------------|--------------------------------------|
| ClusterIP     | interne au cluster (par défaut)      |
| NodePort      | exposé sur un port de chaque nœud    |
| LoadBalancer  | provisionne un load balancer externe |

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 8080
  type: ClusterIP
```

## 6. Gestion de la configuration

Deux ressources permettent de découpler la configuration du code :

- `ConfigMap` — pour les valeurs non sensibles (URLs, feature flags)
- `Secret` — pour les données sensibles (mots de passe, tokens, certificats)

```bash
kubectl create configmap app-config --from-literal=LOG_LEVEL=debug
kubectl create secret generic app-secret --from-literal=API_KEY=changeme
```

## 7. Ressources et quotas

Il est recommandé de toujours définir des limites de ressources :

```yaml
resources:
  requests:
    cpu: "100m"
    memory: "128Mi"
  limits:
    cpu: "500m"
    memory: "256Mi"
```

Sans ces limites, un pod peut consommer toutes les ressources d'un nœud et
provoquer l'éviction d'autres charges de travail.

## 8. Namespaces

Les namespaces permettent d'isoler logiquement des groupes de ressources :

- `default` — namespace par défaut
- `kube-system` — composants internes de Kubernetes
- `kube-public` — ressources publiques en lecture pour tous
- namespaces applicatifs créés par l'équipe (`staging`, `production`, etc.)

## 9. Observabilité

Pour diagnostiquer un problème, les commandes suivantes sont indispensables :

```bash
kubectl describe pod <nom-du-pod>
kubectl logs <nom-du-pod> --previous
kubectl get events --sort-by=.lastTimestamp
```

## 10. Pour aller plus loin

Ressources complémentaires :

- Documentation officielle : [kubernetes.io/fr](https://kubernetes.io/fr/)
- Guide des probes : [Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- Bonnes pratiques de production : [Kubernetes production best practices](https://learnk8s.io/production-best-practices)

## Conclusion

Ce chapitre a couvert les fondamentaux : pods, deployments, services, sondes
de santé, configuration et observabilité. Le prochain chapitre abordera le
stockage persistant et les StatefulSets.
