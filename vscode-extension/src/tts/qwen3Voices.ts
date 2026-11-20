/**
 * Les voix créées du service Qwen3 local (`deploy/qwen3/server.py`) : `POST /voices/create`
 * (formulaire urlencodé, comme le serveur l'accepte dans `parse_form`) et
 * `GET /voices/<id>/sample`. Passe par la garde réseau de l'extension, jamais en direct.
 */

export interface Qwen3Egress {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface CreatedQwen3Voice {
  readonly id: string;
  readonly name: string;
}

async function detailOf(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { detail?: unknown; error?: unknown };
    const detail = body.detail ?? body.error;
    return typeof detail === "string" ? detail : text;
  } catch {
    return text;
  }
}

export async function createQwen3Voice(
  egress: Qwen3Egress,
  baseUrl: string,
  input: { name: string; description: string; sampleText?: string },
  signal?: AbortSignal
): Promise<CreatedQwen3Voice> {
  const form = new URLSearchParams({ name: input.name, description: input.description });
  if (input.sampleText !== undefined && input.sampleText.trim().length > 0) {
    form.set("sample_text", input.sampleText.slice(0, 300));
  }
  const response = await egress.fetch(`${baseUrl.replace(/\/+$/, "")}/voices/create`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    ...(signal !== undefined ? { signal } : {})
  });
  if (response.status === 409) {
    throw new Error("Ce nom de voix est déjà pris : choisissez-en un autre.");
  }
  if (response.status === 503) {
    throw new Error("La carte graphique est réservée en ce moment (mode jeu) : réessayez plus tard.");
  }
  if (!response.ok) {
    const detail = (await detailOf(response)).slice(0, 200);
    throw new Error(`La voix n'a pas pu être créée (HTTP ${response.status})${detail.length > 0 ? ` : ${detail}` : ""}.`);
  }
  const body = (await response.json()) as { id?: unknown; name?: unknown };
  if (typeof body.id !== "string" || body.id.length === 0) {
    throw new Error("La voix créée n'a pas d'identifiant dans la réponse du service.");
  }
  return { id: body.id, name: typeof body.name === "string" ? body.name : input.name };
}

export async function fetchQwen3VoiceSample(egress: Qwen3Egress, baseUrl: string, voiceId: string, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await egress.fetch(
    `${baseUrl.replace(/\/+$/, "")}/voices/${encodeURIComponent(voiceId)}/sample`,
    signal !== undefined ? { signal } : {}
  );
  if (!response.ok) {
    throw new Error(`extrait indisponible (HTTP ${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
