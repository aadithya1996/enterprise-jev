import { randomInt } from "node:crypto";
import { AGE_BANDS, filterUsers, POLICY_COMMANDS, ROLES, TABLES } from "./directory.js";

export const NOUL_GATE = 0.7;

const SKIP = new Set(
  `   add remove delete inactivate promote demote give move update change make grant route
   offboard disable enable create reactivate assign please team access superadmin admin
   moderator member friday monday tuesday wednesday thursday saturday sunday payroll
   after next from into onto with and the for hour hours view show export ban banned
   metadata profile csv lookup set first last age hours hour day days week can you give
   me an of as users over under similar`.split(/\s+/)
);

// Words that introduce a person to be provisioned ("add sundar", "onboard ravi").
const PROVISION_CUES = new Set(
  `add create provision onboard register named new assign put invite enroll promote demote`.split(/\s+/)
);

// Filler and connector tokens that sit between a cue and the actual name, or that
// end a name run. They are skipped before a name and stop the name once it starts.
const NAME_FILLERS = new Set(
  `a an the new user users hire hires employee employees member members person people
   account accounts identity profile profiles someone named as to on in at by of for
   from into onto with and or`.split(/\s+/)
);

// Domain nouns that look like bare words but are never a person's name.
const NON_NAME_WORDS = new Set(
  `policy policies rls row level security group groups team teams role roles table tables
   access csv export invoices invoice channel squad admin member moderator superadmin`.split(/\s+/)
);

const RISK_LEVELS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "critical", label: "Critical" }
];

const WINDOWS = [
  { id: "h1", hours: 1, label: "1 hour" },
  { id: "h2", hours: 2, label: "2 hours" },
  { id: "h4", hours: 4, label: "4 hours" },
  { id: "h8", hours: 8, label: "8 hours" },
  { id: "h24", hours: 24, label: "24 hours" }
];

const BAN_WINDOWS = [
  { id: "h1", hours: 1, label: "1 hour" },
  { id: "h24", hours: 24, label: "24 hours" },
  { id: "d7", hours: 24 * 7, label: "7 days" },
  { id: "d30", hours: 24 * 30, label: "30 days" }
];

function choice(instructions, criteria) {
  return { type: "choice", instructions, criteria };
}

function noul(instructions, yes, no) {
  return {
    type: "noul",
    instructions,
    criteria: { true: yes, false: no }
  };
}

function score(instructions, criteria) {
  return { type: "score", instructions, criteria };
}

export function candidatesFromMessage(message, directory) {
  const known = new Set(SKIP);
  for (const user of directory.users) {
    known.add(user.name.toLowerCase());
    for (const part of user.name.toLowerCase().split(/\s+/)) known.add(part);
  }
  for (const group of directory.groups) {
    known.add(group.name.toLowerCase());
    known.add(group.id);
  }
  for (const role of directory.roles) {
    known.add(role.name.toLowerCase());
    known.add(role.id);
  }

  const found = [];
  const seen = new Set();
  const addCandidate = (label) => {
    const parts = label.toLowerCase().split(/\s+/).filter(Boolean);
    if (!parts.length || parts.every((part) => known.has(part))) return;
    const key = `mentioned_${parts.join("_")}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ key, label });
  };

  // Capitalized mentions (existing behavior): "Add Priya", "Sundar".
  const pattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g;
  for (const match of message.matchAll(pattern)) {
    let label = match[0];
    const parts = label.toLowerCase().split(/\s+/);
    if (parts.length === 2 && SKIP.has(parts[0]) && !SKIP.has(parts[1]) && !known.has(parts[1])) {
      label = label.split(/\s+/)[1];
    }
    addCandidate(label);
  }

  // Lowercase, provisioning-cued mentions: "add sundar", "create ravi kumar",
  // "onboard sundar rao", "<name> as a new user".
  for (const label of provisioningNames(message, known)) addCandidate(label);

  return found.slice(0, 8);
}

// Extract personal names that are only detectable from provisioning cues, so a
// lowercase "add sundar as a new user" still offers Jev a `mentioned_sundar`
// option and prefills the Add-user card. Returns Title-cased labels.
function provisioningNames(message, known) {
  const isName = (word) =>
    /^[a-z][a-z'-]*$/.test(word) &&
    word.length >= 2 &&
    !known.has(word) &&
    !NAME_FILLERS.has(word) &&
    !NON_NAME_WORDS.has(word);
  const titleCase = (parts) =>
    parts
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");

  const labels = [];
  const tokens = [...message.matchAll(/[A-Za-z][A-Za-z'-]*/g)].map((match) => match[0]);
  const lower = tokens.map((token) => token.toLowerCase());

  // Forward: a cue word, optional fillers, then one or two name tokens.
  for (let index = 0; index < tokens.length; index++) {
    if (!PROVISION_CUES.has(lower[index])) continue;
    let cursor = index + 1;
    while (cursor < tokens.length && NAME_FILLERS.has(lower[cursor])) cursor++;
    const parts = [];
    while (cursor < tokens.length && parts.length < 2 && isName(lower[cursor])) {
      parts.push(lower[cursor]);
      cursor++;
    }
    if (parts.length) labels.push(titleCase(parts));
  }

  // Trailing: "<name> as a new user/hire/employee/member".
  const trailing = /\b([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)?)\s+as\s+(?:an?\s+)?(?:new\s+)?(?:user|hire|employee|member)\b/gi;
  for (const match of message.matchAll(trailing)) {
    const parts = match[1]
      .split(/\s+/)
      .map((word) => word.toLowerCase())
      .filter((word) => isName(word));
    if (parts.length) labels.push(titleCase(parts.slice(-2)));
  }

  return labels;
}

export function extractUnmappedGroup(message, directory, knownPersonName) {
  const catalog = liveGroups(directory);
  const knownGroupNames = new Set(catalog.map((g) => g.name.toLowerCase()));
  for (const g of catalog) knownGroupNames.add(g.id.toLowerCase());

  // 1. Phrasing like: "... to/into/onto/in/join [the] <candidate> team/group/squad/dept/department"
  const m1 = message.match(/\b(?:to|into|onto|in|join)\s+(?:the\s+)?([A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)?)\s+(?:team|group|squad|department|dept)\b/i);
  if (m1) {
    const raw = m1[1].trim();
    const lower = raw.toLowerCase();
    if (!knownGroupNames.has(lower) && !SKIP.has(lower) && lower !== knownPersonName?.toLowerCase()) {
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    }
  }

  // 2. Trailing "<candidate> (team|group|squad)"
  const m2 = message.match(/\b([A-Za-z0-9_-]+)\s+(?:team|group|squad)\b/i);
  if (m2) {
    const raw = m2[1].trim();
    const lower = raw.toLowerCase();
    if (!knownGroupNames.has(lower) && !SKIP.has(lower) && lower !== knownPersonName?.toLowerCase()) {
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    }
  }

  return null;
}

function userCriterion(user) {
  const reports = user.directReports?.length
    ? user.directReports.map((report) => report.name).join(", ")
    : "none";
  return [
    user.name,
    `role ${user.role}`,
    `status ${user.status}`,
    `groups ${user.groups.join(", ") || "none"}`,
    `manager ${user.managerName || "none"}`,
    `active direct reports: ${reports}`,
    `storage files: ${user.storageObjects?.length || 0}`,
    `banned until: ${user.bannedUntil || "none"}`,
    `metadata first_name=${user.firstName || ""} last_name=${user.lastName || ""} age=${user.age ?? "unset"}`
  ].join(". ") + ".";
}

export function buildQuestions(directory, mentions) {
  const people = {};
  for (const user of directory.users) people[user.id] = userCriterion(user);
  for (const mention of mentions) {
    people[mention.key] = `The person named "${mention.label}" in the message. They are not already a directory record.`;
  }
  people.operator = "The speaker, when they ask to change their own access. Example: give me superadmin for two hours.";
  people.unspecified = "No specific person can be identified.";

  const liveGroups = directory.groups || [];
  const groups = {};
  for (const group of liveGroups) {
    groups[group.id] = `${group.name} team. ${group.detail}. This is a group, not a role.`;
  }
  groups.none = "No team or group is named. Mention of the admin role is not the Admin team.";

  const roles = {};
  for (const role of ROLES) roles[role.id] = `${role.name}. ${role.detail}.`;
  roles.unspecified = "No lasting role change is requested. Naming the Admin team does not by itself select the admin role.";

  const managers = { unspecified: "No replacement manager is named." };
  for (const user of directory.users) {
    if (user.status === "active") managers[user.id] = `${user.name}, an active person who can receive reports.`;
  }

  const windows = { unspecified: "No duration is mentioned." };
  for (const window of WINDOWS) windows[window.id] = window.label;

  return {
    primary_intent: choice(
      "Identify the primary user management action requested in the message.",
      {
        add_user: "Provision a new identity, or restore an inactive profile, and assign initial groups.",
        inactivate_user: "Temporarily disable login without deleting the person, such as leave or a security review.",
        delete_user: "Permanently offboard or remove a person, including hard delete, soft delete, or when payroll or reports are mentioned.",
        edit_rbac: "Change the lasting role label (Member, Moderator, or Admin). Use this only for promote/demote language. Do not use this when the message puts someone on a team, including the Admin team.",
        override_rbac: "Grant short-term elevated access, such as superadmin for a few hours.",
        update_manager: "Change the person someone reports to.",
        edit_groups: "Add or remove an already active person from a team, group, channel, or squad. 'Add X to the Admin team' is a group assignment, not a role change.",
        view_user: "Look up one person's profile, auth record, or user metadata.",
        edit_metadata: "Change profile metadata such as first name, last name, or age. Not a role or group change.",
        ban_user: "Temporarily ban sign-in for a duration. This is not a lasting inactivation and not a delete.",
        export_users: "Export or download users as CSV. Includes filtered exports such as Support users, Admins, Members, inactive people, or an age range.",
        create_group: "Create a new team or group that people can later join. Not assigning an existing person to an existing team.",
        manage_rls: "Create or edit a row-level security policy: table, command, grantee, USING, or WITH CHECK.",
        explain_access: "Explain who can read or write a table, group, or role under current RBAC and RLS. No mutation is requested.",
        none: "The message is not a user-management, group, RBAC, or RLS action."
      }
    ),
    risk_severity: score(
      "Score the security and operational risk of the request. Overriding RBAC or deleting users is critical.",
      [
        "low — a routine change with no security or payroll impact, such as a group add",
        "medium — a role edit, manager change, or other access change that should be reviewed",
        "high — inactivating or banning a manager, or expanding privileged access",
        "critical — offboarding or deleting a person, a storage-gated delete, or a temporary privileged override"
      ]
    ),
    check_duplicate: noul(
      "This request is provisioning a new user and requires checking against existing identities to prevent duplicate records.",
      "The message creates or restores an identity, so existing and inactive profiles should be checked.",
      "The message only changes access, membership, or a reporting line."
    ),
    payroll_dependency: noul(
      "This request involves offboarding or terminating a user, which must be synchronized with a final payroll cycle.",
      "The message offboards, deletes, or times a departure around payroll.",
      "The message does not end employment and does not depend on payroll."
    ),
    requires_manager_reassignment: noul(
      "The requested action removes or inactivates a user who likely manages direct reports, requiring their team to be reassigned.",
      "The person being removed or inactivated has, or likely has, direct reports who need a new manager.",
      "Nobody's reporting line needs to move."
    ),
    is_temporary_override: noul(
      "This request asks for a temporary elevation of permissions or a time-bound access override.",
      "Access is requested for a limited time, such as a few hours, and is not a lasting role change.",
      "The request is a lasting role, group, or employment change."
    ),
    owns_storage: noul(
      "The person being deleted owns files in storage, so the operator should be warned before the auth user is removed.",
      "This is a delete or offboard, and the person owns storage objects that should be called out as a warning.",
      "No storage ownership needs a warning on this request."
    ),
    needs_generation: noul(
      "The request needs generated context that a classifier cannot finish, such as drafting an RLS expression, inventing a group purpose, or explaining access in prose.",
      "The operator needs a drafted policy, group description, or access explanation.",
      "A directory form can be filled from classification alone."
    ),
    is_soft_delete: noul(
      "The request asks to mark the account deleted in application tables, or to soft-delete, without removing the auth identity.",
      "The account should stay in auth.users, or a soft delete is requested.",
      "The request is a hard delete that should remove the auth identity, or it is not a delete."
    ),
    subject_user: choice(
      "Who is the person this request is about? Prefer an existing directory id, including an inactive profile, when the message names that person.",
      people
    ),
    target_group: choice(
      "Which team or group is named? Use this for adding or removing membership, and also when an export is limited to one team. The Admin team is a group. The admin role is separate.",
      groups
    ),
    group_action: choice(
      "Is the group membership being added or removed?",
      {
        add: "The person should join the group.",
        remove: "The person should leave the group.",
        unspecified: "The message does not change group membership."
      }
    ),
    target_role: choice(
      "Which lasting role should the person have after this request? Leave unspecified when the message names a team rather than a role, or when the elevation is temporary.",
      roles
    ),
    new_manager: choice(
      "Who should become the manager, either of the person in the message or of that person's direct reports?",
      managers
    ),
    override_window: choice(
      "How long should a temporary access override last?",
      windows
    ),
    effective_when: choice(
      "When should this employment change take effect?",
      {
        immediately: "The change should happen now.",
        next_friday: "The change should happen on Friday or next Friday.",
        end_of_pay_period: "The change should wait for payroll to clear or for the end of the pay period, and no weekday is named.",
        unspecified: "No effective date is mentioned."
      }
    ),
    inactive_reason: choice(
      "Why is login being paused, if this is an inactivation?",
      {
        leave: "Leave of absence, parental leave, or a similar planned pause.",
        security: "Security review or a suspected compromise.",
        other: "Some other temporary suspension.",
        unspecified: "The message is not inactivating anyone, or it gives no reason."
      }
    ),
    delete_mode: choice(
      "If this is a delete, should the auth identity be removed?",
      {
        hard: "Remove the auth user so they cannot mint new tokens. Sessions and refresh tokens are dropped.",
        soft: "Mark the profile deleted but leave the auth identity in place.",
        unspecified: "The message is not a delete, or it does not distinguish hard from soft."
      }
    ),
    ban_window: choice(
      "How long should a temporary sign-in ban last?",
      {
        h1: "One hour",
        h24: "Twenty-four hours",
        d7: "Seven days",
        d30: "Thirty days",
        unspecified: "No ban duration is mentioned, or this is not a ban."
      }
    ),
    storage_action: choice(
      "What should happen to files the person owns in storage?",
      {
        delete_objects: "Delete the storage objects owned by the person.",
        reassign_objects: "Move ownership of the files to someone else.",
        unspecified: "No storage action is mentioned. A warning about owned files is enough; deletion is not blocked."
      }
    ),
    export_group: choice(
      "If this is an export, which team should the CSV include?",
      Object.fromEntries([
        ...liveGroups.map((group) => [group.id, `Only people on ${group.name}. Example: export of ${group.name} users as CSV.`]),
        ["unspecified", "This is not an export, or the CSV should not be limited to one team."]
      ])
    ),
    export_role: choice(
      "If this is an export, which lasting role should the CSV include?",
      {
        member: "Only Members. Example: export members as CSV.",
        moderator: "Only Moderators.",
        admin: "Only people with the Admin role, not the Admin team.",
        unspecified: "This is not an export, or the CSV should not be limited to one role."
      }
    ),
    export_status: choice(
      "If this is an export, which account status should the CSV include?",
      {
        all: "Everyone, or no status filter was named.",
        active: "Only active accounts.",
        inactive: "Only inactive accounts.",
        offboarded: "Only offboarded or hard-deleted accounts.",
        banned: "Only accounts with a current sign-in ban.",
        unspecified: "This is not an export."
      }
    ),
    export_age: choice(
      "If this is an export, which age range should the CSV include?",
      {
        under_30: "People younger than 30. Example: export users under 30.",
        age_30_39: "People aged 30 through 39.",
        age_40_plus: "People aged 40 and over. Example: export admins over 40.",
        unspecified: "This is not an export, or no age filter was named."
      }
    )
  };
}

export function buildState(message, directory) {
  return {
    message,
    directory: directory.users.map((user) => ({
      id: user.id,
      name: user.name,
      role: user.role,
      status: user.status,
      groups: user.groups,
      manager: user.managerName,
      storage_files: (user.storageObjects || []).map((file) => file.name),
      banned_until: user.bannedUntil,
      first_name: user.firstName,
      last_name: user.lastName,
      age: user.age
    })),
    groups: directory.groups.map((group) => `${group.id}: ${group.name} — ${group.detail}`),
    roles: directory.roles.map((role) => `${role.id}: ${role.name} — ${role.detail}`),
    policies: (directory.policies || []).map((policy) => `${policy.name} on ${policy.table} (${policy.command}) for ${policy.grantee}: ${policy.usingExpr}`),
    tables: directory.tables || []
  };
}

function answer(answers, key) {
  const value = answers?.[key];
  if (!value) {
    const error = new Error(`Jev returned no answer for ${key}.`);
    error.status = 502;
    throw error;
  }
  return value;
}

function riskOf(value) {
  const index = Math.max(0, Math.min(RISK_LEVELS.length - 1, Math.round(Number(value.score) || 0)));
  return { ...RISK_LEVELS[index], score: Number(value.score) || 0, confidence: value.confidence ?? null };
}

function matchUser(label, directory) {
  const needle = label.trim().toLowerCase();
  const exact = directory.users.find((user) => user.name.toLowerCase() === needle);
  if (exact) return exact;
  const byFirst = directory.users.filter((user) => {
    const [first] = user.name.toLowerCase().split(/\s+/);
    return first === needle && user.status !== "offboarded";
  });
  return byFirst.length === 1 ? byFirst[0] : null;
}

function resolvePerson(choiceValue, directory, mentions) {
  if (choiceValue === "operator") return { kind: "operator", name: "You" };
  if (!choiceValue || choiceValue === "unspecified") {
    if (mentions.length === 1) {
      const user = matchUser(mentions[0].label, directory);
      return { kind: user ? "user" : "named", name: user?.name || mentions[0].label, user };
    }
    return { kind: "unknown", name: null, user: null };
  }
  const user = directory.users.find((item) => item.id === choiceValue);
  if (user) return { kind: "user", name: user.name, user };
  const mention = mentions.find((item) => item.key === choiceValue);
  if (mention) {
    const matched = matchUser(mention.label, directory);
    return { kind: matched ? "user" : "named", name: matched?.name || mention.label, user: matched };
  }
  return { kind: "unknown", name: null, user: null };
}

function resolveId(choiceValue, records) {
  if (!choiceValue || choiceValue === "none" || choiceValue === "unspecified") return null;
  return records.find((item) => item.id === choiceValue) || null;
}

function dateFor(when, now) {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (when === "immediately") return day.toISOString().slice(0, 10);
  if (when === "next_friday") {
    const add = (5 - day.getUTCDay() + 7) % 7 || 7;
    day.setUTCDate(day.getUTCDate() + add);
    return day.toISOString().slice(0, 10);
  }
  if (when === "end_of_pay_period") {
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    return end.toISOString().slice(0, 10);
  }
  return "";
}

function emailFor(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
  return slug ? `${slug}@halden.example` : "";
}

function personOptions(directory, { exclude = [], activeOnly = false } = {}) {
  return directory.users
    .filter((user) => user.status !== "offboarded" && !exclude.includes(user.id))
    .filter((user) => !activeOnly || user.status === "active")
    .map((user) => ({
      value: user.id,
      label: user.status === "inactive" ? `${user.name} (inactive)` : user.name
    }));
}

function nameList(items) {
  const names = items.map((item) => item.name);
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function locked(label, display, name, value) {
  return { type: "static", label, display, name, value };
}

function intentConfidence(value) {
  return Number(value.confidence ?? 0);
}

function rankedIntents(probabilities = {}) {
  return Object.entries(probabilities)
    .map(([id, probability]) => ({ id, probability: Number(probability) || 0 }))
    .sort((a, b) => b.probability - a.probability);
}

const INTENT_LABELS = {
  add_user: "Add user",
  inactivate_user: "Inactivate",
  delete_user: "Offboard",
  edit_rbac: "Edit role",
  override_rbac: "Temporary override",
  update_manager: "Update manager",
  edit_groups: "Edit groups",
  view_user: "View profile",
  edit_metadata: "Edit metadata",
  ban_user: "Ban user",
  export_users: "Export users",
  create_group: "Create group",
  manage_rls: "Manage RLS",
  explain_access: "Explain access",
  none: "None"
};

function flagList(flags) {
  return [
    { id: "check_duplicate", label: "Duplicate check", value: flags.duplicate },
    { id: "payroll_dependency", label: "Payroll", value: flags.payroll },
    { id: "requires_manager_reassignment", label: "Reassignment", value: flags.reassignment },
    { id: "is_temporary_override", label: "Temporary override", value: flags.temporary }
  ];
}

function highFlags(flags) {
  const labels = [];
  if (flags.duplicate >= NOUL_GATE) labels.push("a duplicate check");
  if (flags.payroll >= NOUL_GATE) labels.push("a payroll dependency");
  if (flags.reassignment >= NOUL_GATE) labels.push("manager reassignment");
  if (flags.temporary >= NOUL_GATE) labels.push("a temporary override");
  return labels;
}

function baseTrace(meta, ctx) {
  return {
    model: meta.model || null,
    latencyMs: meta.latencyMs ?? null,
    questions: meta.questionCount ?? null,
    usage: meta.usage || null,
    intent: { choice: ctx.rawIntent, label: INTENT_LABELS[ctx.rawIntent] || ctx.rawIntent, confidence: ctx.confidence },
    screen: ctx.screen,
    openai: meta.openai || null,
    adjustedReason: ctx.adjustedReason,
    risk: ctx.risk,
    flags: flagList(ctx.flags),
    subject: ctx.subjectChoice,
    group: ctx.groupChoice
  };
}

function modalShell(ctx, extra) {
  return {
    title: extra.title,
    source: ctx.message,
    notices: extra.notices || [],
    fields: extra.fields || [],
    buttons: extra.buttons
  };
}

function code() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function usersMentionedIn(message, directory) {
  return directory.users.filter((user) => {
    const full = user.name.toLowerCase();
    const first = full.split(/\s+/)[0];
    return message.toLowerCase().includes(full) || new RegExp(`\\b${first}\\b`, "i").test(message);
  });
}

function optional(answers, key, fallback) {
  return answers?.[key] || fallback;
}

function liveGroups(directory) {
  return directory.groups || [];
}

export function planFromAnswers({ message, answers, directory, mentions = [], meta = {}, forceIntent = null, draft = null, now = new Date() }) {
  const intentAnswer = answer(answers, "primary_intent");
  const rawIntent = intentAnswer.choice;
  const confidence = intentConfidence(intentAnswer);
  const flags = {
    duplicate: Number(answer(answers, "check_duplicate").noul) || 0,
    payroll: Number(answer(answers, "payroll_dependency").noul) || 0,
    reassignment: Number(answer(answers, "requires_manager_reassignment").noul) || 0,
    temporary: Number(answer(answers, "is_temporary_override").noul) || 0,
    ownsStorage: Number(answer(answers, "owns_storage").noul) || 0,
    softDelete: Number(answer(answers, "is_soft_delete").noul) || 0
  };
  const risk = riskOf(answer(answers, "risk_severity"));
  let person = resolvePerson(answer(answers, "subject_user").choice, directory, mentions);
  if (person.kind === "unknown") {
    const hinted = usersMentionedIn(message, directory);
    if (hinted.length === 1) person = { kind: "user", name: hinted[0].name, user: hinted[0] };
  }
  const catalog = liveGroups(directory);
  const group = resolveId(answer(answers, "target_group").choice, catalog);
  const role = resolveId(answer(answers, "target_role").choice, ROLES);
  const manager = resolveId(answer(answers, "new_manager").choice, directory.users.filter((user) => user.status === "active"));
  const groupAction = answer(answers, "group_action").choice;
  const windowChoice = answer(answers, "override_window").choice;
  const when = answer(answers, "effective_when").choice;
  const inactiveReason = answer(answers, "inactive_reason").choice;
  const deleteMode = answer(answers, "delete_mode").choice;
  const banWindow = answer(answers, "ban_window").choice;
  const storageAction = answer(answers, "storage_action").choice;
  const isExport = (forceIntent || rawIntent) === "export_users";
  const exportGroup = resolveId(answer(answers, "export_group").choice, catalog) || (isExport ? group : null);
  const exportRole = resolveId(answer(answers, "export_role").choice, ROLES) || (isExport ? role : null);
  const exportStatusRaw = answer(answers, "export_status").choice;
  const exportAgeRaw = answer(answers, "export_age").choice;
  const subjectChoice = {
    choice: answer(answers, "subject_user").choice,
    confidence: answer(answers, "subject_user").confidence ?? null
  };
  const groupChoice = {
    choice: answer(answers, "target_group").choice,
    confidence: answer(answers, "target_group").confidence ?? null
  };
  const unmappedGroup = !group ? extractUnmappedGroup(message, directory, person.name) : null;

  const ctx = {
    message,
    rawIntent,
    confidence,
    flags,
    risk,
    person,
    group,
    role,
    manager,
    groupAction,
    windowChoice,
    when,
    inactiveReason,
    deleteMode,
    banWindow,
    storageAction,
    exportGroup,
    exportRole,
    exportStatus: !exportStatusRaw || exportStatusRaw === "unspecified" || exportStatusRaw === "all" ? "all" : exportStatusRaw,
    exportAge: exportAgeRaw && exportAgeRaw !== "unspecified" ? exportAgeRaw : null,
    subjectChoice,
    groupChoice,
    unmappedGroup,
    screen: forceIntent || rawIntent,
    forced: Boolean(forceIntent),
    adjustedReason: null,
    draft,
    generation: Number(optional(answers, "needs_generation", { noul: 0 }).noul) || 0
  };

  if (!forceIntent && (rawIntent === "none" || confidence < 0.45) && rawIntent !== "none") {
    const options = rankedIntents(intentAnswer.probabilities).filter((item) => item.id !== "none" && item.probability >= 0.12).slice(0, 3);
    if (confidence < 0.45 && options.length > 1) {
      ctx.screen = "clarify";
      const plan = clarifyPlan(ctx, options, meta);
      return plan;
    }
  }

  if (ctx.screen === "none") {
    return {
      reply: ctx.draft?.reply || "That did not look like a directory action. Try adding someone, creating a group, managing RLS, viewing a profile, changing a role, banning, exporting, inactivating, or offboarding.",
      trace: baseTrace(meta, ctx),
      modal: null,
      action: null
    };
  }

  applyDirectoryRules(ctx);

  const built = buildScreen(ctx, directory, now);
  return {
    reply: built.reply,
    trace: baseTrace(meta, ctx),
    modal: built.modal,
    action: built.action
  };
}

function clarifyPlan(ctx, options, meta) {
  ctx.adjustedReason = "Jev's top intent was not confident enough to open a form on its own.";
  return {
    reply: "Choose the form that matches what you meant.",
    trace: baseTrace(meta, ctx),
    modal: modalShell(ctx, {
      title: "Which action should open?",
      notices: [{ tone: "info", text: "Choose the form that matches what you meant." }],
      buttons: options.map((item, index) => ({
        id: item.id,
        label: INTENT_LABELS[item.id] || item.id,
        tone: index === 0 ? "primary" : "secondary",
        forceIntent: item.id
      }))
    }),
    action: null
  };
}

// Screens that only make sense for an existing person. If the request targets a
// person who is not in the directory yet, the action must be composed with a
// create step first.
const COMPOUND_FROM_SCREENS = new Set(["edit_groups", "edit_rbac", "update_manager"]);

const REQUIRE_EXISTING_USER_SCREENS = new Set([
  "inactivate_user",
  "delete_user",
  "ban_user",
  "view_user",
  "edit_metadata"
]);

function applyDirectoryRules(ctx) {
  const { person, group, flags } = ctx;
  const user = person.user;

  // Compound action: Jev classified an edit (add to a group, change a role, or
  // set a manager), but the named person does not exist yet. You cannot edit
  // someone who is not on the directory, so fold both actions together — create
  // the profile AND apply the assignment — in the single add-user form, which
  // already carries name, role, groups, and manager. This is the "first add the
  // user, then add them to the team" case.
  if (!ctx.forced && person.kind === "named" && COMPOUND_FROM_SCREENS.has(ctx.screen)) {
    const steps = [];
    if (group && ctx.groupAction !== "remove") steps.push(`adds them to ${group.name}`);
    if (ctx.role && ctx.role.id !== "superadmin") steps.push(`makes them ${ctx.role.name}`);
    if (ctx.manager) steps.push(`sets ${ctx.manager.name} as their manager`);
    if (steps.length) {
      ctx.adjustedReason = `${person.name} isn't in the directory yet, so this creates the profile${steps.length ? `, then ${steps.join(" and ")}` : ""} in one step.`;
    } else if (ctx.unmappedGroup) {
      ctx.adjustedReason = `${person.name} isn't in the directory yet, so this creates their profile first. Note that '${ctx.unmappedGroup}' is not an existing group in the directory yet.`;
    } else {
      ctx.adjustedReason = `${person.name} isn't in the directory yet, so this creates their profile first.`;
    }
    ctx.screen = "add_user";
  }

  if (!ctx.forced && person.kind === "named" && REQUIRE_EXISTING_USER_SCREENS.has(ctx.screen)) {
    ctx.screen = "not_found";
  }

  if (!ctx.forced && ctx.screen === "edit_rbac" && flags.temporary >= NOUL_GATE) {
    ctx.adjustedReason = "This looks like a short-lived access grant, so the override form is opening.";
    ctx.screen = "override_rbac";
  }

  if (!ctx.forced && ctx.screen === "edit_rbac" && group && !ctx.role) {
    ctx.adjustedReason = `${group.name} is a group, not a role, so this opens membership instead of a role change.`;
    ctx.screen = user?.status === "active" ? "edit_groups" : "add_user";
  }

  if (ctx.screen === "add_user" && user?.status === "active") {
    if (group) {
      ctx.screen = "edit_groups";
      ctx.adjustedReason = `${user.name} already has an active profile, so this opens group membership instead of a second identity.`;
    } else {
      ctx.screen = "already_active";
      ctx.adjustedReason = `${user.name} already has an active profile.`;
    }
  }

  if ((ctx.screen === "edit_groups" || ctx.screen === "add_user") && user?.status === "inactive") {
    if (ctx.screen !== "add_user") {
      ctx.adjustedReason = `${user.name} is inactive, so provisioning and the duplicate check come before a group edit.`;
    }
    ctx.screen = "add_user";
  }
}

function opening(ctx) {
  const user = ctx.person?.user;
  const name = user?.name || ctx.person?.name || null;
  const group = ctx.group;
  const role = ctx.role;

  switch (ctx.screen) {
    case "add_user": {
      if (ctx.adjustedReason) {
        return `${ctx.adjustedReason} Review the profile details below and confirm to create their account:`;
      }
      if (name) {
        return `I've prepared a new profile for ${name}${group ? ` with the ${group.name} team assigned` : ""}. Review the details below and confirm to add them:`;
      }
      return "I've opened the new user provisioning form. Enter their details below to add them to the directory:";
    }
    case "inactivate_user": {
      if (name) {
        return `I've prepared the access pause for ${name}. Their account data stays intact on the directory. Choose a reason and confirm below:`;
      }
      return "I've opened the access pause form. Select a person, specify the reason, and confirm below:";
    }
    case "delete_user": {
      if (name) {
        return `I've initiated the offboarding flow for ${name}. Please verify payroll synchronization, direct report reassignments, and storage files before confirming:`;
      }
      return "I've opened the offboarding form. Review payroll timing, team reassignments, and storage files before confirming:";
    }
    case "edit_rbac": {
      if (name && role) {
        const art = /^[aeiou]/i.test(role.name) ? "an" : "a";
        return `I've set up the role update to make ${name} ${art} ${role.name}. (Note: this is a lasting role change; temporary elevations use the override form). Review and confirm below:`;
      }
      if (name) {
        return `I've pulled up ${name}'s record to update their role. Review the available roles below and confirm:`;
      }
      return "I've opened the role assignment form. Select a person and their new role below:";
    }
    case "override_rbac": {
      const hours = WINDOWS.find((w) => w.id === ctx.windowChoice)?.hours || 2;
      return `I've prepared a temporary superadmin override for ${hours} hour${hours === 1 ? "" : "s"}. Because this grants elevated break-glass access, please verify the authenticator code below to proceed:`;
    }
    case "update_manager": {
      if (name) {
        return `I've set up the manager reassignment for ${name}. Select their new reporting manager below and confirm:`;
      }
      return "I've opened the reporting line form. Select the team member and their new manager below:";
    }
    case "edit_groups": {
      const removing = ctx.groupAction === "remove";
      if (name && group) {
        const actionVerb = removing ? "remove" : "add";
        const prep = removing ? "from" : "to";
        const reasonNote = ctx.adjustedReason ? ` (${ctx.adjustedReason})` : "";
        return `I've prepared the group update to ${actionVerb} ${name} ${prep} ${group.name}${reasonNote}. Review their group assignments below and save:`;
      }
      if (name) {
        return `I've opened group memberships for ${name}. Adjust their squads below and confirm to save:`;
      }
      return "I've opened the group membership editor. Select a person and update their groups below:";
    }
    case "already_active": {
      return `${name || "This person"} already has an active profile in the directory. Choose what you would like to update:`;
    }
    case "view_user": {
      return name
        ? `Here is the full directory profile and metadata for ${name}:`
        : "Here is the directory profile and metadata:";
    }
    case "edit_metadata": {
      return name
        ? `I've opened the metadata editor for ${name}. Update their profile attributes below and save:`
        : "I've opened the metadata editor. Update their profile attributes below and save:";
    }
    case "ban_user": {
      const hours = ctx.banChoice?.hours || 24;
      return name
        ? `I've prepared a sign-in ban for ${name} for ${hours} hours. Existing sessions stay valid until their tokens expire. Confirm the details below:`
        : "I've opened the sign-in ban form. Existing sessions stay valid until tokens expire. Set the duration and confirm below:";
    }
    case "export_users": {
      return "I can export that for you! Here are the CSV export parameters for your directory query:";
    }
    case "create_group": {
      return group
        ? `I've drafted a new directory group for ${group.name}. Review the name and description below, then save to create it:`
        : "I've opened the group creation form. Enter a name and description below to add the group:";
    }
    case "manage_rls": {
      return "I've drafted the Row-Level Security policy for you using OpenAI. Review the table, command, and SQL expression below before saving:";
    }
    case "explain_access": {
      return "Here is an explanation of the current permissions, group memberships, and row-level policies:";
    }
    default: {
      return ctx.adjustedReason
        ? `I've adjusted the request: ${ctx.adjustedReason}`
        : "I've prepared this directory action for you. Take a look below and confirm when you're ready:";
    }
  }
}

function buildScreen(ctx, directory, now) {
  switch (ctx.screen) {
    case "add_user":
      return addUser(ctx, directory);
    case "not_found":
      return userNotFound(ctx);
    case "already_active":
      return alreadyActive(ctx);
    case "inactivate_user":
      return inactivate(ctx, directory);
    case "delete_user":
      return deleteUser(ctx, directory, now);
    case "edit_rbac":
      return editRole(ctx, directory);
    case "override_rbac":
      return override(ctx, directory);
    case "update_manager":
      return updateManager(ctx, directory);
    case "edit_groups":
      return editGroups(ctx, directory);
    case "view_user":
      return viewUser(ctx, directory);
    case "edit_metadata":
      return editMetadata(ctx, directory);
    case "ban_user":
      return banUser(ctx, directory);
    case "export_users":
      return exportUsers(ctx, directory);
    case "create_group":
      return createGroup(ctx);
    case "manage_rls":
      return manageRls(ctx, directory);
    case "explain_access":
      return explainAccess(ctx, directory);
    default:
      return {
        reply: opening(ctx),
        modal: null,
        action: null
      };
  }
}

function selectedGroups(ctx, existing = []) {
  const selected = new Set(existing);
  if (ctx.group && ctx.groupAction !== "remove") selected.add(ctx.group.id);
  return [...selected];
}

function addUser(ctx, directory) {
  const duplicate = ctx.person.user?.status === "inactive" ? ctx.person.user : null;
  const name = duplicate?.name || ctx.person.name || "";
  const notices = [];
  if (duplicate && ctx.flags.duplicate >= NOUL_GATE) {
    notices.push({
      tone: "warning",
      text: `${duplicate.name} already has an inactive profile (${duplicate.email}). Reactivate that identity, or create a separate one.`
    });
  } else if (duplicate) {
    notices.push({
      tone: "warning",
      text: `${duplicate.name} is inactive. Reactivating avoids a second record.`
    });
  } else if (ctx.person.kind === "named" && (ctx.group || (ctx.role && ctx.role.id !== "superadmin") || ctx.manager)) {
    const applied = [];
    if (ctx.group && ctx.groupAction !== "remove") applied.push(ctx.group.name);
    if (ctx.role && ctx.role.id !== "superadmin") applied.push(ctx.role.name);
    if (ctx.manager) applied.push(`manager ${ctx.manager.name}`);
    notices.push({
      tone: "info",
      text: `${name || "This person"} isn't in the directory yet. This form does both steps at once — it creates the profile and applies ${applied.join(", ")} on save.`
    });
  } else if (ctx.person.kind === "named") {
    notices.push({
      tone: "info",
      text: ctx.unmappedGroup
        ? `${name || "This person"} isn't in the directory yet. Note: '${ctx.unmappedGroup}' is not an existing group in the directory. You can create ${name ? `${name}'s` : "their"} profile now and assign an existing squad below, or create '${ctx.unmappedGroup}' afterward.`
        : `${name || "This person"} isn't in the directory yet. Creating their profile adds them to the directory control plane.`
    });
  } else if (ctx.flags.duplicate >= NOUL_GATE) {
    notices.push({
      tone: "info",
      text: "Check for an existing identity before creating a new one. No inactive profile matches this name."
    });
  }

  const fields = [
    { name: "name", label: "Name", type: "text", required: true, value: name, placeholder: "Full name" },
    {
      name: "email",
      label: "Email",
      type: "text",
      required: true,
      value: duplicate?.email || (name ? emailFor(name) : ""),
      placeholder: "name@halden.example",
      hint: duplicate ? "A separate profile needs a different email." : ""
    },
    {
      name: "role",
      label: "Role",
      type: "select",
      required: true,
      value: duplicate?.role || (ctx.role && ctx.role.id !== "superadmin" ? ctx.role.id : "member"),
      options: ROLES.filter((role) => role.id !== "superadmin").map((role) => ({ value: role.id, label: role.name }))
    },
    {
      name: "groups",
      label: "Groups",
      type: "multiselect",
      value: selectedGroups(ctx, duplicate?.groups || []),
      options: liveGroups(directory).map((group) => ({ value: group.id, label: group.name }))
    },
    {
      name: "managerId",
      label: "Manager",
      type: "select",
      value: duplicate?.managerId || ctx.manager?.id || "",
      options: [{ value: "", label: "No manager" }, ...personOptions(directory, { activeOnly: true, exclude: duplicate ? [duplicate.id] : [] })]
    }
  ];

  const buttons = duplicate
    ? [
        { id: "reactivate", label: `Reactivate ${duplicate.name}`, tone: "primary" },
        { id: "create", label: "Create a separate profile", tone: "secondary" }
      ]
    : [{ id: "create", label: "Add user", tone: "primary" }];

  if (!duplicate && ctx.unmappedGroup) {
    buttons.push({
      id: "create_group",
      label: `Create ${ctx.unmappedGroup} group`,
      tone: "secondary",
      forceIntent: "create_group"
    });
  }

  return {
    reply: opening(ctx),
    modal: modalShell(ctx, { title: duplicate ? `Add ${duplicate.name.split(" ")[0]}` : name ? `Add ${name.split(" ")[0]}` : "Add user", notices, fields, buttons }),
    action: {
      screen: "add_user",
      subjectId: duplicate?.id || null,
      buttons: buttons.map((button) => button.id),
      requirements: { payroll: false, manager: false, mfa: false, confirm: null },
      mfaCode: null
    }
  };
}

function userNotFound(ctx) {
  const name = ctx.person.name || "This person";
  return {
    reply: `${name} is not currently in the directory. If you'd like to add them, you can create their profile below:`,
    modal: modalShell(ctx, {
      title: `${name} not found`,
      notices: [{ tone: "warning", text: `No active or inactive directory profile was found for ${name}.` }],
      fields: [],
      buttons: [
        { id: "add_user", label: `Create profile for ${name}`, tone: "primary", forceIntent: "add_user" }
      ]
    }),
    action: null
  };
}

function alreadyActive(ctx) {
  const name = ctx.person.user?.name || "This person";
  return {
    reply: opening(ctx),
    modal: modalShell(ctx, {
      title: `${name} is already active`,
      notices: [{ tone: "info", text: `${name} is ${ctx.person.user.role} on ${ctx.person.user.groups.join(", ") || "no groups"}. Pick the form that matches what you meant.` }],
      buttons: [
        { id: "edit_groups", label: "Edit groups", tone: "primary", forceIntent: "edit_groups" },
        { id: "edit_rbac", label: "Edit role", tone: "secondary", forceIntent: "edit_rbac" },
        { id: "inactivate_user", label: "Inactivate", tone: "secondary", forceIntent: "inactivate_user" }
      ]
    }),
    action: null
  };
}

function subjectField(ctx, directory) {
  if (ctx.person.user) {
    const user = ctx.person.user;
    return locked("Person", `${user.name} · ${user.title}`, "subjectId", user.id);
  }
  return {
    name: "subjectId",
    label: "Person",
    type: "select",
    required: true,
    value: "",
    options: [{ value: "", label: "Choose a person" }, ...personOptions(directory)]
  };
}

function managerField(directory, subjectId, manager, required) {
  return {
    name: "newManagerId",
    label: "New manager for direct reports",
    type: "select",
    required,
    value: manager && manager.id !== subjectId ? manager.id : "",
    options: [
      { value: "", label: required ? "Choose a manager" : "No reassignment" },
      ...personOptions(directory, { exclude: subjectId ? [subjectId] : [], activeOnly: true })
    ]
  };
}

function inactivate(ctx, directory) {
  const user = ctx.person.user;
  const reports = user?.directReports || [];
  const needsManager = reports.length > 0 || ctx.flags.reassignment >= NOUL_GATE && reports.length > 0;
  const notices = [];
  if (reports.length) {
    notices.push({
      tone: "warning",
      text: `${user.name} manages ${nameList(reports)}. Their reporting line has to move before access is paused.`
    });
  } else if (ctx.flags.reassignment >= NOUL_GATE) {
    notices.push({
      tone: "info",
      text: "This person has no active direct reports, so no manager move is required."
    });
  }
  if (user?.status === "inactive") {
    notices.push({ tone: "warning", text: `${user.name} is already inactive.` });
  }

  const reasonValue = ["leave", "security", "other"].includes(ctx.inactiveReason) ? ctx.inactiveReason : "";
  const fields = [
    subjectField(ctx, directory),
    {
      name: "reason",
      label: "Reason",
      type: "select",
      required: true,
      value: reasonValue,
      options: [
        { value: "", label: "Choose a reason" },
        { value: "leave", label: "Leave of absence" },
        { value: "security", label: "Security review" },
        { value: "other", label: "Other hold" }
      ]
    }
  ];
  if (reports.length || ctx.flags.reassignment >= NOUL_GATE) fields.push(managerField(directory, user?.id, ctx.manager, reports.length > 0));

  const buttons = [{ id: "inactivate", label: "Inactivate", tone: "primary" }];
  return {
    reply: opening(ctx),
    modal: modalShell(ctx, { title: user ? `Inactivate ${user.name.split(" ")[0]}` : "Inactivate user", notices, fields, buttons }),
    action: {
      screen: "inactivate_user",
      subjectId: user?.id || null,
      buttons: ["inactivate"],
      requirements: { payroll: false, manager: needsManager, mfa: false, confirm: null },
      mfaCode: null
    }
  };
}

function deleteUser(ctx, directory, now) {
  const user = ctx.person.user;
  const reports = user?.directReports || [];
  const payrollRequired = true;
  const notices = [];
  if (ctx.flags.payroll >= NOUL_GATE || payrollRequired) {
    notices.push({
      tone: "danger",
      text: "Deletion should wait on the final payroll date, and an outstanding access token stays valid until it expires."
    });
  }
  if (reports.length) {
    notices.push({
      tone: "warning",
      text: `${user.name} manages ${nameList(reports)}. Pick their next manager before the profile can be removed.`
    });
  } else if (ctx.flags.reassignment >= NOUL_GATE) {
    notices.push({
      tone: "info",
      text: "This person has no active direct reports, so no manager move is required."
    });
  }
  const files = user?.storageObjects || [];
  if (files.length) {
    notices.push({
      tone: "warning",
      text: `${user.name} owns ${files.map((file) => file.name).join(", ")}. Hard delete will leave those files behind unless you delete or reassign them.`
    });
  }

  const firstName = user?.name.split(" ")[0] || "";
  const fields = [
    subjectField(ctx, directory),
    {
      name: "payrollDate",
      label: "Final payroll date",
      type: "date",
      required: payrollRequired,
      value: dateFor(ctx.when, now),
      hint: ctx.when && ctx.when !== "unspecified" ? `Timing from the request: ${ctx.when.replaceAll("_", " ")}` : "Required for every offboard."
    },
    {
      name: "deleteMode",
      label: "Delete type",
      type: "select",
      required: true,
      value: ctx.deleteMode === "soft" || ctx.flags.softDelete >= NOUL_GATE ? "soft" : "hard",
      options: [
        { value: "hard", label: "Hard delete — remove the auth identity" },
        { value: "soft", label: "Soft delete — keep the auth row, mark the profile deleted" }
      ]
    }
  ];
  if (files.length) {
    fields.push({
      name: "storageAction",
      label: "Storage files (optional)",
      type: "select",
      required: false,
      value: ["delete_objects", "reassign_objects"].includes(ctx.storageAction) ? ctx.storageAction : "",
      options: [
        { value: "", label: "Leave the files — warn only" },
        { value: "delete_objects", label: "Delete the files" },
        { value: "reassign_objects", label: "Reassign the files to the new manager" }
      ],
      hint: "A warning is enough. Handling the files is optional."
    });
  }
  if (reports.length || ctx.flags.reassignment >= NOUL_GATE) {
    fields.push(managerField(directory, user?.id, ctx.manager, reports.length > 0));
  }
  if (firstName) {
    fields.push({
      name: "confirm",
      label: `Type ${firstName} to offboard`,
      type: "confirm",
      required: true,
      match: firstName,
      placeholder: firstName
    });
  }

  return {
    reply: reports.length
      ? `${opening(ctx)} Direct reports still need a manager.`
      : opening(ctx),
    modal: modalShell(ctx, { title: user ? `Offboard ${user.name.split(" ")[0]}` : "Offboard user", notices, fields, buttons: [{ id: "delete", label: "Offboard", tone: "danger" }] }),
    action: {
      screen: "delete_user",
      subjectId: user?.id || null,
      buttons: ["delete"],
      requirements: { payroll: true, manager: reports.length > 0, mfa: false, confirm: firstName || null, storage: false },
      mfaCode: null
    }
  };
}

function editRole(ctx, directory) {
  const user = ctx.person.user;
  const options = ROLES.filter((role) => role.id !== "superadmin" && role.id !== user?.role).map((role) => ({
    value: role.id,
    label: role.name
  }));
  const value = ctx.role && ctx.role.id !== user?.role && ctx.role.id !== "superadmin" ? ctx.role.id : "";
  const notices = [];
  if (user) notices.push({ tone: "info", text: `${user.name} is currently ${ROLES.find((role) => role.id === user.role)?.name || user.role}.` });
  return {
    reply: opening(ctx),
    modal: modalShell(ctx, {
      title: user ? `Edit role for ${user.name.split(" ")[0]}` : "Edit role",
      notices,
      fields: [
        subjectField(ctx, directory),
        {
          name: "role",
          label: "New role",
          type: "select",
          required: true,
          value,
          options: [{ value: "", label: "Choose a role" }, ...options]
        }
      ],
      buttons: [{ id: "save", label: "Update role", tone: "primary" }]
    }),
    action: {
      screen: "edit_rbac",
      subjectId: user?.id || null,
      buttons: ["save"],
      requirements: { payroll: false, manager: false, mfa: false, confirm: null },
      mfaCode: null
    }
  };
}

function override(ctx, directory) {
  const hours = WINDOWS.find((window) => window.id === ctx.windowChoice)?.hours || null;
  const mfaCode = code();
  const subjectValue = ctx.person.kind === "operator" || !ctx.person.user ? "operator" : ctx.person.user.id;
  const notices = [
    {
      tone: "danger",
      text: "Temporary superadmin requires an authenticator check and an expiry."
    }
  ];
  return {
    reply: opening(ctx),
    modal: modalShell(ctx, {
      title: "Temporary superadmin",
      notices,
      fields: [
        {
          name: "subjectId",
          label: "Who receives it",
          type: "select",
          required: true,
          value: subjectValue,
          options: [
            { value: "operator", label: "You (operator)" },
            ...personOptions(directory, { activeOnly: true })
          ]
        },
        {
          name: "durationHours",
          label: "Duration",
          type: "select",
          required: true,
          value: hours ? String(hours) : "",
          options: [
            { value: "", label: "Choose a duration" },
            ...WINDOWS.map((window) => ({ value: String(window.hours), label: window.label }))
          ]
        },
        {
          name: "reason",
          label: "Reason",
          type: "text",
          required: true,
          value: "",
          placeholder: "Why is this access needed?"
        },
        {
          name: "mfa",
          label: "Authenticator code",
          type: "mfa",
          required: true,
          demoCode: mfaCode,
          placeholder: "6-digit code"
        }
      ],
      buttons: [{ id: "grant", label: "Grant access", tone: "danger" }]
    }),
    action: {
      screen: "override_rbac",
      subjectId: subjectValue === "operator" ? null : subjectValue,
      buttons: ["grant"],
      requirements: { payroll: false, manager: false, mfa: true, confirm: null },
      mfaCode
    }
  };
}

function updateManager(ctx, directory) {
  const user = ctx.person.user;
  const notices = [];
  if (user?.managerName) notices.push({ tone: "info", text: `${user.name} currently reports to ${user.managerName}.` });
  return {
    reply: opening(ctx),
    modal: modalShell(ctx, {
      title: user ? `Manager for ${user.name.split(" ")[0]}` : "Update manager",
      notices,
      fields: [
        subjectField(ctx, directory),
        {
          name: "newManagerId",
          label: "New manager",
          type: "select",
          required: true,
          value: ctx.manager && ctx.manager.id !== user?.id ? ctx.manager.id : "",
          options: [
            { value: "", label: "Choose a manager" },
            ...personOptions(directory, { exclude: user ? [user.id] : [], activeOnly: true })
          ]
        }
      ],
      buttons: [{ id: "save", label: "Update manager", tone: "primary" }]
    }),
    action: {
      screen: "update_manager",
      subjectId: user?.id || null,
      buttons: ["save"],
      requirements: { payroll: false, manager: false, mfa: false, confirm: null },
      mfaCode: null
    }
  };
}

function editGroups(ctx, directory) {
  const user = ctx.person.user;
  const removing = ctx.groupAction === "remove";
  const current = user?.groups || [];
  const catalog = liveGroups(directory);
  const pool = removing
    ? catalog.filter((group) => current.includes(group.id))
    : catalog.filter((group) => !current.includes(group.id));
  const selected = [];
  if (ctx.group && pool.some((group) => group.id === ctx.group.id)) selected.push(ctx.group.id);
  const notices = [];
  if (user) {
    const names = current.map((id) => catalog.find((group) => group.id === id)?.name || id);
    notices.push({ tone: "info", text: names.length ? `${user.name} is on ${names.join(", ")}.` : `${user.name} is not on a group yet.` });
  }
  if (!pool.length) {
    notices.push({
      tone: "info",
      text: removing ? "There is no group membership to remove." : "This person is already on every group."
    });
  }
  return {
    reply: opening(ctx),
    modal: modalShell(ctx, {
      title: user ? `${removing ? "Remove" : "Add"} groups for ${user.name.split(" ")[0]}` : "Edit groups",
      notices,
      fields: [
        subjectField(ctx, directory),
        locked("Change", removing ? "Remove from groups" : "Add to groups", "groupAction", removing ? "remove" : "add"),
        {
          name: "groups",
          label: removing ? "Groups to remove" : "Groups to add",
          type: "multiselect",
          required: true,
          value: selected,
          options: pool.map((group) => ({ value: group.id, label: group.name }))
        }
      ],
      buttons: [{ id: "save", label: removing ? "Remove from groups" : "Add to groups", tone: "primary" }]
    }),
    action: {
      screen: "edit_groups",
      subjectId: user?.id || null,
      buttons: ["save"],
      requirements: { payroll: false, manager: false, mfa: false, confirm: null },
      mfaCode: null
    }
  };
}

function viewUser(ctx, directory) {
  const user = ctx.person.user;
  const files = user?.storageObjects || [];
  const banned = user?.bannedUntil && new Date(user.bannedUntil) > new Date();
  const notices = [];
  if (!user) notices.push({ tone: "info", text: "Choose whose profile to open. Auth identities stay in the private auth schema; this form reads the public profile." });
  if (banned) notices.push({ tone: "warning", text: `Sign-in is banned until ${new Date(user.bannedUntil).toLocaleString()}. Existing sessions are not revoked.` });
  const fields = user
    ? [
        locked("Auth id", user.id, "subjectId", user.id),
        locked("Email", user.email),
        locked("Status", user.status),
        locked("Role", ROLES.find((role) => role.id === user.role)?.name || user.role),
        locked("First name", user.firstName || "—"),
        locked("Last name", user.lastName || "—"),
        locked("Age", user.age == null ? "—" : String(user.age)),
        locked("Storage", files.length ? files.map((file) => file.name).join(", ") : "None")
      ]
    : [subjectField(ctx, directory)];
  return {
    reply: opening(ctx),
    modal: modalShell(ctx, {
      title: user ? user.name : "View profile",
      notices,
      fields,
      buttons: [{ id: "done", label: "Done", tone: "primary" }]
    }),
    action: {
      screen: "view_user",
      subjectId: user?.id || null,
      buttons: ["done"],
      requirements: { payroll: false, manager: false, mfa: false, confirm: null },
      mfaCode: null
    }
  };
}

function editMetadata(ctx, directory) {
  const user = ctx.person.user;
  return {
    reply: opening(ctx),
    modal: modalShell(ctx, {
      title: user ? `Metadata for ${user.name.split(" ")[0]}` : "Edit metadata",
      notices: [{ tone: "info", text: "This writes public profile metadata (first_name, last_name, age). It does not change the auth identity." }],
      fields: [
        subjectField(ctx, directory),
        { name: "firstName", label: "First name", type: "text", required: true, value: user?.firstName || user?.name.split(" ")[0] || "", placeholder: "First name" },
        { name: "lastName", label: "Last name", type: "text", required: true, value: user?.lastName || user?.name.split(" ").slice(1).join(" ") || "", placeholder: "Last name" },
        { name: "age", label: "Age", type: "text", value: user?.age == null ? "" : String(user.age), placeholder: "Optional" }
      ],
      buttons: [{ id: "save", label: "Save metadata", tone: "primary" }]
    }),
    action: {
      screen: "edit_metadata",
      subjectId: user?.id || null,
      buttons: ["save"],
      requirements: { payroll: false, manager: false, mfa: false, confirm: null },
      mfaCode: null
    }
  };
}

function banUser(ctx, directory) {
  const user = ctx.person.user;
  const preset = BAN_WINDOWS.find((window) => window.id === ctx.banWindow);
  return {
    reply: opening(ctx),
    modal: modalShell(ctx, {
      title: user ? `Ban ${user.name.split(" ")[0]}` : "Ban user",
      notices: [
        { tone: "warning", text: "A ban only blocks new sign-in for its duration. It does not revoke sessions that are already open." },
        { tone: "info", text: "Deleting the auth user is what drops sessions and refresh tokens." }
      ],
      fields: [
        subjectField(ctx, directory),
        {
          name: "durationHours",
          label: "Ban duration",
          type: "select",
          required: true,
          value: preset ? String(preset.hours) : "",
          options: [
            { value: "", label: "Choose a duration" },
            ...BAN_WINDOWS.map((window) => ({ value: String(window.hours), label: window.label }))
          ]
        },
        {
          name: "reason",
          label: "Reason",
          type: "text",
          required: true,
          value: "",
          placeholder: "Why is sign-in being blocked?"
        }
      ],
      buttons: [{ id: "ban", label: "Ban sign-in", tone: "danger" }]
    }),
    action: {
      screen: "ban_user",
      subjectId: user?.id || null,
      buttons: ["ban"],
      requirements: { payroll: false, manager: false, mfa: false, confirm: null },
      mfaCode: null
    }
  };
}

function exportUsers(ctx, directory) {
  const status = ctx.exportStatus || "all";
  const groupId = ctx.exportGroup?.id || "";
  const role = ctx.exportRole?.id && ctx.exportRole.id !== "superadmin" ? ctx.exportRole.id : "";
  const ageBand = ctx.exportAge || "";
  const matched = filterUsers(directory.users, {
    status: status === "all" ? null : status,
    groupId: groupId || null,
    role: role || null,
    ageBand: ageBand || null
  });
  const labels = [];
  if (groupId) labels.push(liveGroups(directory).find((item) => item.id === groupId)?.name || groupId);
  if (role) labels.push(ROLES.find((item) => item.id === role)?.name || role);
  if (ageBand) labels.push(AGE_BANDS.find((item) => item.id === ageBand)?.label || ageBand);
  if (status !== "all") labels.push(status);
  const summary = labels.length ? labels.join(" · ") : "the full directory";
  return {
    reply: opening(ctx),
    modal: modalShell(ctx, {
      title: "Export users",
      notices: [{
        tone: "info",
        text: `${matched.length} ${matched.length === 1 ? "row matches" : "rows match"} ${summary}. Confirm to download the CSV.`
      }],
      fields: [
        {
          name: "groupId",
          label: "Team",
          type: "select",
          value: groupId,
          options: [{ value: "", label: "All teams" }, ...liveGroups(directory).map((item) => ({ value: item.id, label: item.name }))]
        },
        {
          name: "role",
          label: "Role",
          type: "select",
          value: role,
          options: [
            { value: "", label: "All roles" },
            ...ROLES.filter((item) => item.id !== "superadmin").map((item) => ({ value: item.id, label: item.name }))
          ]
        },
        {
          name: "status",
          label: "Status",
          type: "select",
          required: true,
          value: status,
          options: [
            { value: "all", label: "Everyone" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
            { value: "offboarded", label: "Offboarded" },
            { value: "banned", label: "Banned" }
          ]
        },
        {
          name: "ageBand",
          label: "Age",
          type: "select",
          value: ageBand,
          options: [
            { value: "", label: "All ages" },
            ...AGE_BANDS.map((item) => ({ value: item.id, label: item.label }))
          ]
        }
      ],
      buttons: [{ id: "export", label: "Download CSV", tone: "primary" }]
    }),
    action: {
      screen: "export_users",
      subjectId: null,
      buttons: ["export"],
      requirements: { payroll: false, manager: false, mfa: false, confirm: null },
      mfaCode: null
    }
  };
}

function granteeOptions(directory) {
  return [
    { value: "authenticated", label: "authenticated" },
    { value: "anon", label: "anon" },
    { value: "service_role", label: "service_role" },
    ...ROLES.map((role) => ({ value: `role:${role.id}`, label: `Role: ${role.name}` })),
    ...liveGroups(directory).map((group) => ({ value: `group:${group.id}`, label: `Group: ${group.name}` }))
  ];
}

function createGroup(ctx) {
  const draft = ctx.draft || {};
  return {
    reply: draft.reply || opening(ctx),
    modal: modalShell(ctx, {
      title: "Create group",
      notices: [{ tone: "info", text: "Groups are team membership. Roles stay separate. RLS policies can grant a group." }],
      fields: [
        { name: "name", label: "Group name", type: "text", required: true, value: draft.groupName || ctx.unmappedGroup || "", placeholder: "Platform" },
        { name: "detail", label: "Purpose", type: "textarea", required: true, value: draft.groupDetail || "", placeholder: "Who belongs here and what they can do." }
      ],
      buttons: [{ id: "create", label: "Create group", tone: "primary" }]
    }),
    action: {
      screen: "create_group",
      subjectId: null,
      buttons: ["create"],
      requirements: { payroll: false, manager: false, mfa: false, confirm: null },
      mfaCode: null
    }
  };
}

function manageRls(ctx, directory) {
  const draft = ctx.draft || {};
  const policies = directory.policies || [];
  const existing = policies.find((policy) => policy.id === draft.policyId || policy.name.toLowerCase() === String(draft.policyName || "").toLowerCase());
  const tables = directory.tables || TABLES;
  return {
    reply: draft.reply || opening(ctx),
    modal: modalShell(ctx, {
      title: existing ? `Edit ${existing.name}` : "Row-level policy",
      notices: [
        { tone: "info", text: "These policies are stored here so you can model RLS. They are not applied to a live Postgres instance." }
      ],
      fields: [
        { name: "policyId", label: "Existing policy", type: "select", value: existing?.id || "", options: [{ value: "", label: "Create a new policy" }, ...policies.map((policy) => ({ value: policy.id, label: policy.name }))] },
        { name: "name", label: "Policy name", type: "text", required: true, value: draft.policyName || existing?.name || "", placeholder: "Read own profile" },
        { name: "table", label: "Table", type: "select", required: true, value: draft.table || existing?.table || "public.profiles", options: tables.map((table) => ({ value: table.id, label: table.name })) },
        { name: "command", label: "Command", type: "select", required: true, value: draft.command || existing?.command || "select", options: POLICY_COMMANDS.map((item) => ({ value: item.id, label: item.name })) },
        { name: "grantee", label: "Applies to", type: "select", required: true, value: draft.grantee || existing?.grantee || "authenticated", options: granteeOptions(directory) },
        { name: "usingExpr", label: "USING", type: "textarea", required: true, value: draft.usingExpr || existing?.usingExpr || "", placeholder: "auth.uid() = id" },
        { name: "withCheck", label: "WITH CHECK", type: "textarea", value: draft.withCheck || existing?.withCheck || "", placeholder: "Optional write check" },
        { name: "enabled", label: "Enabled", type: "select", required: true, value: existing ? String(existing.enabled) : "true", options: [{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }] }
      ],
      buttons: [{ id: "save", label: existing ? "Update policy" : "Create policy", tone: "primary" }]
    }),
    action: {
      screen: "manage_rls",
      subjectId: null,
      buttons: ["save"],
      requirements: { payroll: false, manager: false, mfa: false, confirm: null },
      mfaCode: null
    }
  };
}

function explainAccess(ctx, directory) {
  const draft = ctx.draft || {};
  const groups = liveGroups(directory).map((group) => group.name).join(", ");
  const policies = (directory.policies || []).filter((policy) => policy.enabled);
  const summary = draft.reply || [
    `Groups: ${groups}.`,
    `Roles: ${directory.roles.map((role) => role.name).join(", ")}.`,
    `Enabled policies: ${policies.map((policy) => `${policy.name} (${policy.command} on ${policy.table} for ${policy.grantee})`).join("; ") || "none"}.`
  ].join(" ");
  return {
    reply: summary,
    modal: modalShell(ctx, {
      title: "Access model",
      notices: [{ tone: "info", text: "RBAC is the lasting role on a person. Groups are team membership. RLS is a row filter on a table." }],
      fields: [
        locked("Summary", summary, "summary", summary)
      ],
      buttons: [{ id: "save", label: "Record this", tone: "primary" }]
    }),
    action: {
      screen: "explain_access",
      subjectId: null,
      summary,
      buttons: ["save"],
      requirements: { payroll: false, manager: false, mfa: false, confirm: null },
      mfaCode: null
    }
  };
}
