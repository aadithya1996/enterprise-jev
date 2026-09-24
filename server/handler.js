import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./directory.js";
import { evaluate } from "./jev.js";
import { draftWithOpenAI, openaiConfigured, shouldUseOpenAI } from "./openai.js";
import { buildQuestions, buildState, candidatesFromMessage, planFromAnswers } from "./plan.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

function loadEnv() {
  const file = path.join(root, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const store = createStore();
const decisions = new Map();
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store"
  });
  res.end(data);
}

function remember(entry) {
  decisions.set(entry.id, entry);
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [id, item] of decisions) {
    if (item.at < cutoff) decisions.delete(id);
  }
  while (decisions.size > 40) decisions.delete(decisions.keys().next().value);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) {
      const error = new Error("That message is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("The request body was not valid JSON.");
    error.status = 400;
    throw error;
  }
}

function publicPlan(plan, decisionId) {
  return {
    decisionId,
    reply: plan.reply,
    trace: plan.trace,
    modal: plan.modal || null,
    action: plan.action ? { screen: plan.action.screen, subjectId: plan.action.subjectId } : null
  };
}

const ACCESS_SCREENS = new Set(["create_group", "manage_rls", "explain_access"]);

async function classify(text) {
  const directory = store.snapshot();
  const mentions = candidatesFromMessage(text, directory);
  const started = Date.now();
  const questions = buildQuestions(directory, mentions);
  const jev = await evaluate(buildState(text, directory), questions);
  const meta = {
    model: jev.model,
    usage: jev.usage,
    latencyMs: jev.latencyMs ?? Date.now() - started,
    questionCount: Object.keys(questions).length,
    openai: null
  };
  const preview = planFromAnswers({ message: text, answers: jev.answers, directory, mentions, meta });
  let draft = null;
  let plan = preview;
  if (shouldUseOpenAI(jev.answers, preview) && openaiConfigured()) {
    try {
      draft = await draftWithOpenAI({ message: text, directory, jevScreen: preview.trace.screen });
      meta.openai = draft.model;
      const forceIntent = ACCESS_SCREENS.has(draft.action) && (preview.trace.screen === "none" || ACCESS_SCREENS.has(preview.trace.screen))
        ? draft.action
        : null;
      plan = planFromAnswers({
        message: text,
        answers: jev.answers,
        directory,
        mentions,
        meta,
        forceIntent,
        draft
      });
    } catch (error) {
      console.error("OpenAI draft failed:", error.message);
      if (preview.modal) {
        preview.modal.notices = [
          ...(preview.modal.notices || []),
          { tone: "warning", text: `OpenAI did not fill this form (${error.message}).` }
        ];
      }
      if (preview.trace.screen === "none") {
        preview.reply = `${preview.reply} OpenAI could not draft a follow-up (${error.message}).`;
      }
      plan = preview;
    }
  }
  const id = randomUUID();
  remember({ id, at: Date.now(), message: text, answers: jev.answers, mentions, plan, draft });
  return publicPlan(plan, id);
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    send(res, 200, {
      configured: Boolean(process.env.TYPESAFE_API_KEY) || process.env.JEV_FIXTURE === "1",
      openaiConfigured: openaiConfigured(),
      model: process.env.TYPESAFE_MODEL || "jev-latest",
      openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini"
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    send(res, 200, store.snapshot());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJson(req);
    if (body.decisionId && body.forceIntent) {
      const prior = decisions.get(body.decisionId);
      if (!prior) {
        send(res, 409, { error: "This form expired. Send the message again." });
        return;
      }
      const plan = planFromAnswers({
        message: prior.message,
        answers: prior.answers,
        directory: store.snapshot(),
        mentions: prior.mentions,
        meta: {
          model: prior.plan.trace?.model,
          usage: prior.plan.trace?.usage,
          latencyMs: prior.plan.trace?.latencyMs,
          questionCount: prior.plan.trace?.questions,
          openai: prior.plan.trace?.openai || null
        },
        forceIntent: body.forceIntent,
        draft: prior.draft || null
      });
      prior.plan = plan;
      prior.at = Date.now();
      send(res, 200, publicPlan(plan, prior.id));
      return;
    }

    const text = String(body.text || "").trim();
    if (!text) {
      send(res, 400, { error: "Enter a message first." });
      return;
    }
    const plan = await classify(text);
    send(res, 200, plan);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/commit") {
    const body = await readJson(req);
    const prior = decisions.get(body.decisionId);
    if (!prior?.plan?.action) {
      send(res, 409, { error: "This form expired. Send the message again." });
      return;
    }
    const result = store.commit(prior.plan.action, body.fields || {}, body.button);
    send(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/overrides/revoke") {
    send(res, 200, store.revoke());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    decisions.clear();
    send(res, 200, store.reset());
    return;
  }

  send(res, 404, { error: "Not found." });
}

async function handleStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": "no-store"
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

/**
 * Unified request router used by both the local Node HTTP server
 * (server/index.js) and the Vercel serverless function (api/index.js).
 */
export async function handleRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, { error: "Method not allowed." });
      return;
    }
    await handleStatic(res, url.pathname);
  } catch (error) {
    const status = error.status || 500;
    send(res, status, { error: error.message || "Something went wrong." });
  }
}
