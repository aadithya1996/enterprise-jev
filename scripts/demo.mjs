#!/usr/bin/env node
/**
 * Live demo of Jev's capabilities in Enterprise jev.
 *
 * Walks the running app through representative prompts and prints the typed
 * judgments (Choice / Score / Noul), the composed screen, and the prefilled
 * card. Classify-only by default — nothing is committed.
 *
 * Usage:
 *   node scripts/demo.mjs
 *   node scripts/demo.mjs --base http://localhost:4731
 *   node scripts/demo.mjs --only 4,7
 */

const args = process.argv.slice(2);
const base = argValue("--base") || process.env.DEMO_BASE || "http://localhost:4731";
const only = new Set(
  (argValue("--only") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
);

function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const STEPS = [
  {
    id: "1",
    capability: "Choice — route the primary intent",
    text: "Add Marcus to Support",
    expect: "intent=edit_groups, risk stays low/medium"
  },
  {
    id: "2",
    capability: "Choice — disambiguate group vs role",
    text: "Add Dana to the Admin team",
    expect: "intent=edit_groups (Admin team ≠ Admin role)"
  },
  {
    id: "3",
    capability: "Choice — lasting role change",
    text: "Promote Dana to Admin",
    expect: "intent=edit_rbac, role field prefilled to admin"
  },
  {
    id: "4",
    capability: "Noul — temporary override flag",
    text: "Give me superadmin access for 2 hours to fix the billing bug",
    expect: "is_temporary_override high → screen=override_rbac"
  },
  {
    id: "5",
    capability: "Score — graded risk climbs with severity",
    text: "Remove Sarah next Friday after payroll clears, and route her direct reports to Alice.",
    expect: "risk=critical; payroll + reassignment Nouls light up"
  },
  {
    id: "6",
    capability: "Choice — dynamic subject resolution",
    text: "Show me Dana's profile and metadata",
    expect: "subject=dana_ruiz, screen=view_user"
  },
  {
    id: "7",
    capability: "Composition — compound create + assign",
    text: "Can you add Cecil to the support team",
    expect: "named person + group → add_user with Support preselected"
  },
  {
    id: "8",
    capability: "Lowercase name extraction → prefilled card",
    text: "add sundar as a new user",
    expect: "Name field = Sundar (not empty)"
  },
  {
    id: "9",
    capability: "Confidence gate — clarify when unsure",
    text: "do something with Dana",
    expect: "low confidence → clarify buttons, or a safe default screen"
  },
  {
    id: "10",
    capability: "Escalation — OpenAI drafts when generation is needed",
    text: "Add an RLS policy so people only read their own profile",
    expect: "screen=manage_rls, USING expression drafted"
  },
  {
    id: "11",
    capability: "Export — filtered directory download form",
    text: "Export admins over 40 as CSV",
    expect: "screen=export_users with role/age filters set"
  },
  {
    id: "12",
    capability: "Create group — OpenAI drafts purpose",
    text: "Create a Platform group for on-call engineers",
    expect: "screen=create_group with name/purpose prefilled"
  }
];

async function api(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${path} failed (${response.status})`);
  return data;
}

function field(modal, name) {
  return (modal?.fields || []).find((item) => item.name === name) || null;
}

function flagMap(flags = []) {
  return Object.fromEntries(flags.map((item) => [item.id, Number(item.value).toFixed(2)]));
}

function line(label, value) {
  console.log(`    ${label.padEnd(14)} ${value}`);
}

function summarize(step, data) {
  const t = data.trace || {};
  const modal = data.modal;
  const name = field(modal, "name")?.value;
  const role = field(modal, "role")?.value;
  const groups = field(modal, "groups")?.value;
  const using = field(modal, "usingExpr")?.value;
  const policyId = field(modal, "policyId")?.value;

  console.log(`\n[${step.id}] ${step.capability}`);
  console.log(`  prompt:  ${step.text}`);
  console.log(`  expect:  ${step.expect}`);
  line("intent", `${t.intent?.choice || "—"} (${t.intent?.label || "—"})  conf=${t.intent?.confidence ?? "—"}`);
  line("subject", `${t.subject?.choice || "—"}  conf=${t.subject?.confidence ?? "—"}`);
  line("group", `${t.group?.choice || "—"}  conf=${t.group?.confidence ?? "—"}`);
  line("risk", `${t.risk?.label || "—"}  score=${t.risk?.score ?? "—"}  conf=${t.risk?.confidence ?? "—"}`);
  line("flags", JSON.stringify(flagMap(t.flags)));
  line("screen", t.screen || "—");
  if (t.adjustedReason) line("adjusted", t.adjustedReason);
  if (t.openai) line("openai", t.openai);
  line("model", `${t.model || "—"}  ${t.latencyMs != null ? `${t.latencyMs}ms` : ""}`);
  if (modal) {
    line("card", modal.title || "(untitled)");
    if (name != null) line("· name", JSON.stringify(name));
    if (role != null) line("· role", JSON.stringify(role));
    if (groups != null) line("· groups", JSON.stringify(groups));
    if (policyId != null) line("· policy", JSON.stringify(policyId));
    if (using != null && using !== "") line("· USING", JSON.stringify(String(using).slice(0, 80)));
    if (modal.notices?.length) {
      for (const notice of modal.notices) line("· notice", notice.text);
    }
    if (modal.buttons?.length) {
      line("· buttons", modal.buttons.map((button) => button.label).join(" · "));
    }
  } else {
    line("card", "(none)");
    line("reply", (data.reply || "").slice(0, 120));
  }
}

async function main() {
  console.log(`Enterprise jev · capability demo`);
  console.log(`base ${base}\n`);

  const health = await api("/api/health");
  if (!health.configured) {
    console.error("TYPESAFE_API_KEY is not set on the server. Set it in .env and restart.");
    process.exit(1);
  }
  console.log(`health  Jev=${health.model}  OpenAI=${health.openaiConfigured ? health.openaiModel : "off"}`);

  const steps = only.size ? STEPS.filter((step) => only.has(step.id)) : STEPS;
  if (!steps.length) {
    console.error("No steps matched --only. Valid ids: " + STEPS.map((step) => step.id).join(", "));
    process.exit(1);
  }

  let failed = 0;
  for (const step of steps) {
    try {
      const data = await api("/api/chat", { text: step.text });
      summarize(step, data);
    } catch (error) {
      failed += 1;
      console.log(`\n[${step.id}] ${step.capability}`);
      console.log(`  prompt:  ${step.text}`);
      console.log(`  ERROR:   ${error.message}`);
    }
  }

  console.log(`\nDone. ${steps.length - failed}/${steps.length} steps classified.`);
  console.log("Nothing was committed — open http://localhost:4731 to confirm any card in the UI.");
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
