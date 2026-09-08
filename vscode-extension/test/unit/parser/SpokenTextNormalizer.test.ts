import { describe, expect, it } from "vitest";
import { normalize } from "../../../src/parser/SpokenTextNormalizer.js";

describe("normalize", () => {
  it("keeps a link's label and drops the URL", () => {
    expect(normalize("Voir [kubernetes.io](https://kubernetes.io/fr/docs/home/) pour plus.", "fr")).toBe(
      "Voir kubernetes.io pour plus."
    );
  });

  it("keeps an image's alt text and drops the URL", () => {
    expect(normalize("![Architecture Kubernetes](https://kubernetes.io/img.svg)", "fr")).toBe(
      "Architecture Kubernetes"
    );
  });

  it("strips bold markers (** and __)", () => {
    expect(normalize("Un mot **important** et un autre __souligné__.", "fr")).toBe(
      "Un mot important et un autre souligné."
    );
  });

  it("strips italic markers (* and _)", () => {
    expect(normalize("Un mot *discret* et un autre _feutré_.", "fr")).toBe("Un mot discret et un autre feutré.");
  });

  it("strips strikethrough markers", () => {
    expect(normalize("Ceci est ~~obsolète~~ remplacé.", "fr")).toBe("Ceci est obsolète remplacé.");
  });

  it("turns inline code into a 'code : x' announcement in French", () => {
    expect(normalize("Exécute `kubectl get pods` maintenant.", "fr")).toBe(
      "Exécute code : kubectl get pods maintenant."
    );
  });

  it("turns inline code into a 'code: x' announcement in English", () => {
    expect(normalize("Run `kubectl get pods` now.", "en")).toBe("Run code: kubectl get pods now.");
  });

  it("reduces a bare URL to its domain", () => {
    expect(normalize("Documentation: https://kubernetes.io/fr/docs/home/ ici.", "fr")).toBe(
      "Documentation: kubernetes.io ici."
    );
  });

  it("reads an arrow as 'flèche' in French and 'arrow' in English", () => {
    expect(normalize("Pod -> Service -> Ingress", "fr")).toBe("Pod flèche Service flèche Ingress");
    expect(normalize("Pod -> Service -> Ingress", "en")).toBe("Pod arrow Service arrow Ingress");
  });

  it("strips leading bullet markers from list-like lines", () => {
    expect(normalize("- premier point\n- deuxième point", "fr")).toBe("premier point deuxième point");
  });

  it("collapses multiple spaces and blank lines into a single space", () => {
    expect(normalize("trop     d'espaces\n\n\nici", "fr")).toBe("trop d'espaces ici");
  });

  it("never strips accented characters", () => {
    const text = "Café, hôtel, être, naïve, à côté — accents préservés.";
    expect(normalize(text, "fr")).toBe(text);
  });

  it("defaults to French phrasing when no lang is given", () => {
    expect(normalize("Du `code` ici.")).toBe("Du code : code ici.");
  });

  it("is idempotent on already-clean text", () => {
    const clean = "Une phrase déjà propre, sans aucune syntaxe Markdown.";
    expect(normalize(clean, "fr")).toBe(clean);
  });
});
