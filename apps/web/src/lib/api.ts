// Client for the EmberWatch API (apps/api).
// These types mirror apps/api/src/emberwatch_api/schemas.py. They can later be
// generated from http://localhost:8000/openapi.json with openapi-typescript.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Health = {
  status: string;
  model_name: string;
  model_version: string;
  threshold: number;
};

export type TileScore = { y: number; x: number; size: number; probability: number };

export type FrameScore = {
  smoke: boolean;
  score: number;
  threshold: number;
  width: number;
  height: number;
  tiles: TileScore[];
  model_name: string;
  model_version: string;
  latency_ms: number;
};

/** Thrown when the API can't be reached or rejects a request; `message` is shown to the user. */
export class ApiError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new ApiError(
      `Can't reach the EmberWatch API at ${API_URL}. Start it with "uv run emberwatch-api" in apps/api.`,
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(body?.detail ?? `The API answered ${response.status} ${response.statusText}.`);
  }
  return response.json() as Promise<T>;
}

export const getHealth = () => call<Health>("/health", { cache: "no-store" });

export function scoreFrame(file: File) {
  const form = new FormData();
  form.append("image", file);
  return call<FrameScore>("/v1/frames/score", { method: "POST", body: form });
}
