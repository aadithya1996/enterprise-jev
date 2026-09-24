import { fixtureEvaluation } from "./fixture.js";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

function failure(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function messageFrom(status, body) {
  if (status === 401) return "Jev rejected the API key. Check TYPESAFE_API_KEY and restart.";
  if (status === 422) return "Jev rejected the question payload.";
  if (status === 429 || status === 529) return "Jev is busy. Try that message again.";
  const detail = typeof body?.error === "string" ? body.error : body?.message;
  return detail ? `Jev did not answer: ${detail}` : `Jev did not answer (${status}).`;
}

async function post(body, attempt) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000)
  });

  if ((response.status === 429 || response.status === 529) && attempt === 0) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) ? Math.min(retryAfter, 3) : 1;
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    return post(body, 1);
  }

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) throw failure(response.status === 401 || response.status === 422 ? response.status : 502, messageFrom(response.status, parsed));
  return parsed;
}

export async function evaluate(state, questions) {
  if (process.env.JEV_FIXTURE === "1") return fixtureEvaluation(state);

  if (!process.env.TYPESAFE_API_KEY) {
    throw failure(503, "Set TYPESAFE_API_KEY in .env and restart the server.");
  }

  const started = Date.now();
  const result = await post(
    {
      model: process.env.TYPESAFE_MODEL || "jev-latest",
      state,
      questions
    },
    0
  );
  return { ...result, latencyMs: Date.now() - started };
}
