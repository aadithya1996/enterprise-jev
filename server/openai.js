export function openaiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function parseContent(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(raw);
  } catch {
    return { reply: trimmed || "I could not draft that.", action: "none" };
  }
}

export async function draftWithOpenAI({ message, directory, jevScreen }) {
  if (!openaiConfigured()) return null;

  const catalog = {
    groups: (directory.groups || []).map((group) => ({ id: group.id, name: group.name, detail: group.detail })),
    roles: (directory.roles || []).map((role) => ({ id: role.id, name: role.name })),
    policies: (directory.policies || []).map((policy) => ({
      id: policy.id,
      name: policy.name,
      table: policy.table,
      command: policy.command,
      grantee: policy.grantee,
      using: policy.usingExpr
    })),
    tables: directory.tables || []
  };

  const body = {
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You help a directory operator. Jev already classified the request and could not finish it alone.",
          "Draft concrete values the form can use. For RLS, write Postgres USING / WITH CHECK expressions.",
          "Prefer existing table, role, and group ids from the catalog.",
          "action=create_group when they want a new team. action=manage_rls for row-level security.",
          "action=explain_access when they want an explanation of who can read or write.",
          "Reply as JSON with keys: reply, action, groupName, groupDetail, policyName, table, command, grantee, usingExpr, withCheck.",
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          message,
          jevScreen,
          catalog
        })
      }
    ]
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || `OpenAI did not answer (${response.status}).`;
    const error = new Error(detail);
    error.status = response.status === 401 ? 503 : 502;
    throw error;
  }

  const parsed = parseContent(payload?.choices?.[0]?.message?.content);
  const action = ["create_group", "manage_rls", "explain_access", "none"].includes(parsed.action)
    ? parsed.action
    : "none";
  return {
    reply: String(parsed.reply || parsed.message || "").trim() || "Draft ready.",
    action,
    groupName: parsed.groupName || parsed.group_name || "",
    groupDetail: parsed.groupDetail || parsed.group_detail || parsed.detail || "",
    policyName: parsed.policyName || parsed.policy_name || parsed.name || "",
    table: parsed.table || "public.profiles",
    command: parsed.command || "select",
    grantee: parsed.grantee || "authenticated",
    usingExpr: parsed.usingExpr || parsed.using_expr || parsed.using || "",
    withCheck: parsed.withCheck || parsed.with_check || "",
    model: payload?.model || body.model
  };
}

export function shouldUseOpenAI(answers, plan) {
  const screen = plan?.trace?.screen;
  if (["create_group", "manage_rls", "explain_access"].includes(screen)) return true;
  if (screen === "none") return true;
  const generation = Number(answers?.needs_generation?.noul) || 0;
  return generation >= 0.7 && ["none", "create_group", "manage_rls", "explain_access"].includes(screen);
}
