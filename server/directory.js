export const GROUPS = [
  { id: "admin", name: "Admin team", detail: "Directory operators and access owners" },
  { id: "engineering", name: "Engineering", detail: "Product and platform squad" },
  { id: "support", name: "Support", detail: "Customer support rotation" },
  { id: "billing", name: "Billing", detail: "Payroll and billing operators" },
  { id: "people", name: "People", detail: "People operations" }
];

export const ROLES = [
  { id: "member", name: "Member", detail: "Standard employee access" },
  { id: "moderator", name: "Moderator", detail: "Day-to-day moderation without directory control" },
  { id: "admin", name: "Admin", detail: "Directory and role administration" },
  { id: "superadmin", name: "Superadmin", detail: "Break-glass access across the workspace" }
];

export const TABLES = [
  { id: "public.profiles", name: "public.profiles", detail: "Public profile rows keyed to auth.users" },
  { id: "public.invoices", name: "public.invoices", detail: "Billing documents" },
  { id: "storage.objects", name: "storage.objects", detail: "Files in Storage" }
];

export const POLICY_COMMANDS = [
  { id: "select", name: "SELECT" },
  { id: "insert", name: "INSERT" },
  { id: "update", name: "UPDATE" },
  { id: "delete", name: "DELETE" },
  { id: "all", name: "ALL" }
];

const SEED_POLICIES = [
  {
    id: "profiles_self_select",
    name: "Read own profile",
    table: "public.profiles",
    command: "select",
    grantee: "authenticated",
    usingExpr: "auth.uid() = id",
    withCheck: "",
    enabled: true
  },
  {
    id: "profiles_service",
    name: "Service role manages profiles",
    table: "public.profiles",
    command: "all",
    grantee: "service_role",
    usingExpr: "true",
    withCheck: "true",
    enabled: true
  },
  {
    id: "invoices_billing_select",
    name: "Billing group reads invoices",
    table: "public.invoices",
    command: "select",
    grantee: "group:billing",
    usingExpr: "(auth.jwt() -> 'app_metadata' -> 'groups') ? 'billing'",
    withCheck: "",
    enabled: true
  }
];

export const AGE_BANDS = [
  { id: "under_30", label: "Under 30", matches: (age) => age != null && age < 30 },
  { id: "age_30_39", label: "30–39", matches: (age) => age != null && age >= 30 && age <= 39 },
  { id: "age_40_plus", label: "40 and over", matches: (age) => age != null && age >= 40 }
];

export function filterUsers(users, filters = {}) {
  return users.filter((user) => {
    if (filters.status && filters.status !== "all") {
      if (filters.status === "banned") {
        if (!user.bannedUntil || new Date(user.bannedUntil) <= new Date()) return false;
      } else if (user.status !== filters.status) return false;
    }
    if (filters.groupId && !(user.groups || []).includes(filters.groupId)) return false;
    if (filters.role && user.role !== filters.role) return false;
    if (filters.ageBand) {
      const band = AGE_BANDS.find((item) => item.id === filters.ageBand);
      if (band && !band.matches(user.age)) return false;
    }
    return true;
  });
}

function profile(full, extras = {}) {
  const [firstName, ...rest] = full.split(" ");
  return {
    firstName,
    lastName: rest.join(" "),
    age: extras.age ?? null,
    storageObjects: extras.storageObjects || [],
    bannedUntil: extras.bannedUntil || null,
    banReason: null
  };
}

const SEED = [
  {
    id: "alice_okonkwo",
    name: "Alice Okonkwo",
    email: "alice.okonkwo@halden.example",
    role: "admin",
    status: "active",
    groups: ["people", "admin"],
    managerId: null,
    title: "Director of people",
    ...profile("Alice Okonkwo", { age: 42 })
  },
  {
    id: "sarah_chen",
    name: "Sarah Chen",
    email: "sarah.chen@halden.example",
    role: "admin",
    status: "active",
    groups: ["engineering", "people"],
    managerId: "alice_okonkwo",
    title: "Engineering manager",
    ...profile("Sarah Chen", { age: 38, storageObjects: [{ id: "sarah-avatar", name: "avatar.png" }, { id: "sarah-specs", name: "design-specs.pdf" }] })
  },
  {
    id: "marcus_hale",
    name: "Marcus Hale",
    email: "marcus.hale@halden.example",
    role: "member",
    status: "active",
    groups: ["engineering"],
    managerId: "sarah_chen",
    title: "Backend engineer",
    ...profile("Marcus Hale", { age: 29 })
  },
  {
    id: "leo_park",
    name: "Leo Park",
    email: "leo.park@halden.example",
    role: "member",
    status: "active",
    groups: ["engineering"],
    managerId: "sarah_chen",
    title: "Product designer",
    ...profile("Leo Park", { age: 31, storageObjects: [{ id: "leo-moodboard", name: "moodboard.fig" }] })
  },
  {
    id: "dana_ruiz",
    name: "Dana Ruiz",
    email: "dana.ruiz@halden.example",
    role: "moderator",
    status: "active",
    groups: ["support"],
    managerId: "alice_okonkwo",
    title: "Support lead",
    ...profile("Dana Ruiz", { age: 36 })
  },
  {
    id: "noah_ibarra",
    name: "Noah Ibarra",
    email: "noah.ibarra@halden.example",
    role: "member",
    status: "active",
    groups: ["billing"],
    managerId: "alice_okonkwo",
    title: "Billing specialist",
    ...profile("Noah Ibarra", { age: 34, storageObjects: [{ id: "noah-invoices", name: "invoices.csv" }] })
  },
  {
    id: "jenson_hale",
    name: "Jenson Hale",
    email: "jenson.hale@halden.example",
    role: "member",
    status: "inactive",
    groups: ["engineering"],
    managerId: "sarah_chen",
    title: "Product engineer",
    ...profile("Jenson Hale", { age: 27 })
  }
];

function clone(value) {
  return structuredClone(value);
}

function nameList(people) {
  const names = people.map((person) => person.name);
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function groupName(id) {
  return GROUPS.find((group) => group.id === id)?.name || id;
}

function roleName(id) {
  return ROLES.find((role) => role.id === id)?.name || id;
}

export function makeSnapshot(users, overrides, audit, groups = GROUPS, policies = SEED_POLICIES) {
  const decorated = users.map((user) => {
    const manager = users.find((candidate) => candidate.id === user.managerId);
    const directReports = users
      .filter((candidate) => candidate.managerId === user.id && candidate.status === "active")
      .map((candidate) => ({ id: candidate.id, name: candidate.name }));
    const override = overrides.find((item) => item.subjectId === user.id) || null;
    return {
      ...user,
      managerName: manager?.name || null,
      directReports,
      override: override
        ? { role: override.role, expiresAt: override.expiresAt, reason: override.reason }
        : null
    };
  });

  return {
    users: decorated,
    groups,
    roles: ROLES,
    tables: TABLES,
    policies: policies.map((policy) => ({ ...policy })),
    overrides: overrides.map((item) => ({
      ...item,
      subjectName:
        item.subjectId === "operator"
          ? "You"
          : users.find((user) => user.id === item.subjectId)?.name || item.subjectId
    })),
    audit: audit.slice(0, 12)
  };
}

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function activeReports(users, subjectId) {
  return users.filter((user) => user.managerId === subjectId && user.status === "active");
}

function reassign(users, subjectId, newManagerId) {
  const reports = activeReports(users, subjectId);
  if (!reports.length) return [];
  if (!newManagerId) fail("Choose a manager for the direct reports before continuing.");
  if (newManagerId === subjectId) fail("A person cannot become their own manager.");
  const manager = users.find((user) => user.id === newManagerId);
  if (!manager || manager.status !== "active") fail("Pick an active manager.");
  for (const user of users) {
    if (user.managerId === subjectId) user.managerId = newManagerId;
  }
  return reports;
}

function slugId(name, users) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "user";
  let id = base;
  let suffix = 2;
  while (users.some((user) => user.id === id)) id = `${base}_${suffix++}`;
  return id;
}

function assertEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) fail("Enter a valid email address.");
}

function assertRole(role, { allowSuperadmin = false } = {}) {
  const known = ROLES.some((item) => item.id === role);
  if (!known) fail("Choose a role.");
  if (role === "superadmin" && !allowSuperadmin) {
    fail("Superadmin is granted as a temporary override, with a time limit and an authenticator check.");
  }
}

function cleanGroups(groups) {
  const ids = Array.isArray(groups) ? groups : [];
  const known = new Set(GROUPS.map((group) => group.id));
  return [...new Set(ids.filter((id) => known.has(id)))];
}

export function createStore() {
  const users = clone(SEED);
  const groups = clone(GROUPS);
  const policies = clone(SEED_POLICIES);
  const overrides = [];
  const audit = [];

  function groupName(id) {
    return groups.find((group) => group.id === id)?.name || id;
  }

  function cleanGroups(list) {
    const ids = Array.isArray(list) ? list : [];
    const known = new Set(groups.map((group) => group.id));
    return [...new Set(ids.filter((id) => known.has(id)))];
  }

  function pushAudit(text, affectedIds) {
    audit.unshift({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      text,
      affectedIds
    });
  }

  function finish(reply, affectedIds, extra = {}) {
    pushAudit(reply, affectedIds);
    return { reply, affectedIds, snapshot: makeSnapshot(users, overrides, audit, groups, policies), ...extra };
  }

  return {
    snapshot() {
      return makeSnapshot(users, overrides, audit, groups, policies);
    },
    reset() {
      users.splice(0, users.length, ...clone(SEED));
      groups.splice(0, groups.length, ...clone(GROUPS));
      policies.splice(0, policies.length, ...clone(SEED_POLICIES));
      overrides.splice(0, overrides.length);
      audit.splice(0, audit.length);
      return makeSnapshot(users, overrides, audit, groups, policies);
    },
    revoke() {
      overrides.splice(0, overrides.length);
      return finish("Revoked the temporary access override.", []);
    },
    commit(action, fields, button) {
      if (!action.buttons.includes(button)) fail("That confirmation is no longer available.");
      const subjectId = fields.subjectId || action.subjectId || null;
      const subject = subjectId && subjectId !== "operator"
        ? users.find((user) => user.id === subjectId) || null
        : null;

      if (action.requirements.confirm) {
        const typed = String(fields.confirm || "").trim().toLowerCase();
        if (typed !== action.requirements.confirm.toLowerCase()) {
          fail(`Type ${action.requirements.confirm} to confirm.`);
        }
      }
      if (action.requirements.mfa && String(fields.mfa || "") !== action.mfaCode) {
        fail("That authenticator code does not match.");
      }
      if (action.requirements.payroll && !/^\d{4}-\d{2}-\d{2}$/.test(fields.payrollDate || "")) {
        fail("Choose the final payroll date.");
      }

      if (action.screen === "add_user") {
        const name = String(fields.name || "").trim();
        const email = String(fields.email || "").trim().toLowerCase();
        if (name.length < 2) fail("Enter the person's name.");
        assertEmail(email);
        assertRole(fields.role);
        const groups = cleanGroups(fields.groups);
        const managerId = fields.managerId || null;
        if (managerId) {
          const manager = users.find((user) => user.id === managerId);
          if (!manager || manager.status !== "active") fail("Pick an active manager.");
        }

        if (button === "reactivate") {
          if (!subject) fail("That inactive profile is no longer on the directory.");
          if (users.some((user) => user.email === email && user.id !== subject.id)) {
            fail("Another profile already uses that email.");
          }
          subject.name = name;
          subject.email = email;
          subject.role = fields.role;
          subject.groups = groups;
          subject.managerId = managerId;
          subject.status = "active";
          subject.inactiveReason = null;
          const groupLabel = groups.map(groupName).join(", ") || "no groups";
          return finish(`Reactivated ${subject.name} on ${groupLabel}.`, [subject.id]);
        }

        if (users.some((user) => user.email === email)) fail("Another profile already uses that email.");
        const created = {
          id: slugId(name, users),
          name,
          email,
          role: fields.role,
          status: "active",
          groups,
          managerId,
          title: "New hire",
          ...profile(name)
        };
        users.push(created);
        const groupLabel = groups.map(groupName).join(", ") || "no groups";
        return finish(`Added ${created.name} as ${roleName(created.role)} on ${groupLabel}.`, [created.id]);
      }

      if (action.screen === "override_rbac") {
        const hours = Number(fields.durationHours);
        if (![1, 2, 4, 8, 24].includes(hours)) fail("Choose how long the override lasts.");
        const reason = String(fields.reason || "").trim();
        if (reason.length < 3) fail("Add a short reason for the override.");
        const targetId = fields.subjectId || "operator";
        if (targetId !== "operator" && !users.some((user) => user.id === targetId && user.status === "active")) {
          fail("Grant the override to an active person, or to yourself.");
        }
        const existing = overrides.findIndex((item) => item.subjectId === targetId);
        if (existing >= 0) overrides.splice(existing, 1);
        const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
        overrides.unshift({
          id: crypto.randomUUID(),
          subjectId: targetId,
          role: "superadmin",
          reason,
          expiresAt,
          createdAt: new Date().toISOString()
        });
        const who = targetId === "operator" ? "you" : users.find((user) => user.id === targetId).name;
        return finish(`Granted superadmin to ${who} for ${hours} hour${hours === 1 ? "" : "s"}.`, targetId === "operator" ? [] : [targetId]);
      }

      if (action.screen === "export_users") {
        const filters = {
          status: fields.status && fields.status !== "all" ? fields.status : null,
          groupId: fields.groupId || null,
          role: fields.role || null,
          ageBand: fields.ageBand || null
        };
        const rows = filterUsers(users, filters);
        const header = ["id", "email", "first_name", "last_name", "age", "role", "status", "groups", "banned_until", "storage"];
        const csv = [
          header.join(","),
          ...rows.map((user) => [
            user.id,
            user.email,
            user.firstName || "",
            user.lastName || "",
            user.age ?? "",
            user.role,
            user.status,
            user.groups.join("|"),
            user.bannedUntil || "",
            (user.storageObjects || []).map((file) => file.name).join("|")
          ].map((value) => `"${String(value).replaceAll("\"", "\"\"")}"`).join(","))
        ].join("\n");
        const parts = [
          filters.groupId,
          filters.role,
          filters.ageBand,
          filters.status
        ].filter(Boolean);
        const filename = `${parts.length ? parts.join("-") + "-" : ""}users.csv`;
        const labels = [];
        if (filters.groupId) labels.push(groupName(filters.groupId));
        if (filters.role) labels.push(roleName(filters.role));
        if (filters.ageBand) labels.push(AGE_BANDS.find((item) => item.id === filters.ageBand)?.label || filters.ageBand);
        if (filters.status) labels.push(filters.status);
        const who = labels.length ? labels.join(", ") : "the directory";
        return finish(`Exported ${rows.length} ${who} user${rows.length === 1 ? "" : "s"} as CSV.`, [], {
          download: { filename, mime: "text/csv", content: csv }
        });
      }

      if (action.screen === "create_group") {
        const name = String(fields.name || "").trim();
        const detail = String(fields.detail || "").trim();
        if (name.length < 2) fail("Enter a group name.");
        const id = slugId(name, groups);
        if (groups.some((group) => group.name.toLowerCase() === name.toLowerCase())) {
          fail("A group with that name already exists.");
        }
        groups.push({ id, name, detail: detail || "Operator-created group" });
        return finish(`Created the ${name} group.`, []);
      }

      if (action.screen === "manage_rls") {
        const name = String(fields.name || "").trim();
        const table = String(fields.table || "").trim();
        const command = String(fields.command || "").trim();
        const grantee = String(fields.grantee || "").trim();
        const usingExpr = String(fields.usingExpr || "").trim();
        if (name.length < 2) fail("Name the policy.");
        if (!TABLES.some((item) => item.id === table)) fail("Choose a table.");
        if (!POLICY_COMMANDS.some((item) => item.id === command)) fail("Choose a command.");
        if (!grantee) fail("Choose who the policy applies to.");
        if (!usingExpr) fail("Add a USING expression.");
        const enabled = fields.enabled === "true" || fields.enabled === true;
        const existing = policies.find((policy) => policy.id === fields.policyId);
        if (existing) {
          existing.name = name;
          existing.table = table;
          existing.command = command;
          existing.grantee = grantee;
          existing.usingExpr = usingExpr;
          existing.withCheck = String(fields.withCheck || "").trim();
          existing.enabled = enabled;
          return finish(`Updated RLS policy ${name} on ${table}.`, []);
        }
        policies.unshift({
          id: slugId(name, policies),
          name,
          table,
          command,
          grantee,
          usingExpr,
          withCheck: String(fields.withCheck || "").trim(),
          enabled
        });
        return finish(`Created RLS policy ${name} on ${table}.`, []);
      }

      if (action.screen === "explain_access") {
        return finish(action.summary || fields.summary || "Saved the access explanation.", []);
      }

      if (!subject) fail("Choose a person on the directory.");

      if (action.screen === "inactivate_user") {
        if (subject.status !== "active") fail(`${subject.name} is not an active user.`);
        const reason = fields.reason;
        if (!["leave", "security", "other"].includes(reason)) fail("Choose why access is being paused.");
        const reports = reassign(users, subject.id, fields.newManagerId || null);
        subject.status = "inactive";
        subject.inactiveReason = reason;
        const reasonLabel = { leave: "a leave of absence", security: "a security review", other: "a temporary hold" }[reason];
        const extra = reports.length ? ` ${nameList(reports)} now report to ${users.find((user) => user.id === fields.newManagerId).name}.` : "";
        return finish(`Inactivated ${subject.name} for ${reasonLabel}.${extra}`, [subject.id, ...reports.map((person) => person.id)]);
      }

      if (action.screen === "delete_user") {
        if (subject.status === "offboarded") fail(`${subject.name} is already offboarded.`);
        const mode = fields.deleteMode === "soft" ? "soft" : "hard";
        if (mode === "hard" && (subject.storageObjects || []).length) {
          // Storage is warn-only: delete/reassign if the operator chose to, otherwise leave the files.
          if (fields.storageAction === "reassign_objects") {
            const ownerId = fields.newManagerId || subject.managerId;
            const owner = users.find((user) => user.id === ownerId && user.status === "active" && user.id !== subject.id);
            if (!owner) fail("Pick someone active to receive the storage files.");
            owner.storageObjects = [...(owner.storageObjects || []), ...(subject.storageObjects || [])];
            subject.storageObjects = [];
          } else if (fields.storageAction === "delete_objects") {
            subject.storageObjects = [];
          }
        }
        const reports = reassign(users, subject.id, fields.newManagerId || null);
        if (mode === "soft") {
          subject.status = "inactive";
          subject.inactiveReason = "deleted";
          const moved = reports.length
            ? ` ${nameList(reports)} now report to ${users.find((user) => user.id === fields.newManagerId).name}.`
            : "";
          return finish(`Soft-deleted ${subject.name}. The auth identity remains, so the account can still refresh until you hard-delete.${moved}`, [subject.id, ...reports.map((person) => person.id)]);
        }
        subject.status = "offboarded";
        subject.payrollDate = fields.payrollDate || null;
        subject.offboardedAt = new Date().toISOString();
        const payroll = subject.payrollDate ? ` Final payroll date ${subject.payrollDate}.` : "";
        const moved = reports.length
          ? ` ${nameList(reports)} now report to ${users.find((user) => user.id === fields.newManagerId).name}.`
          : "";
        return finish(`Hard-deleted ${subject.name}. Sessions and refresh tokens are dropped. Outstanding access tokens stay valid until they expire.${payroll}${moved}`, [subject.id, ...reports.map((person) => person.id)]);
      }

      if (action.screen === "edit_rbac") {
        if (subject.status !== "active") fail("Change the role of an active user, or reactivate them first.");
        assertRole(fields.role);
        if (fields.role === subject.role) fail(`${subject.name} is already ${roleName(subject.role)}.`);
        const previous = roleName(subject.role);
        subject.role = fields.role;
        return finish(`Changed ${subject.name} from ${previous} to ${roleName(subject.role)}.`, [subject.id]);
      }

      if (action.screen === "update_manager") {
        if (subject.status === "offboarded") fail(`${subject.name} is already offboarded.`);
        const manager = users.find((user) => user.id === fields.newManagerId);
        if (!manager || manager.status !== "active") fail("Pick an active manager.");
        if (manager.id === subject.id) fail("A person cannot become their own manager.");
        subject.managerId = manager.id;
        return finish(`${subject.name} now reports to ${manager.name}.`, [subject.id, manager.id]);
      }

      if (action.screen === "edit_groups") {
        if (subject.status !== "active") fail("Update groups for an active person, or reactivate them first.");
        const selected = cleanGroups(fields.groups);
        if (!selected.length) fail("Choose at least one group.");
        if (fields.groupAction === "remove") {
          subject.groups = subject.groups.filter((id) => !selected.includes(id));
          return finish(`Removed ${subject.name} from ${selected.map(groupName).join(", ")}.`, [subject.id]);
        }
        subject.groups = [...new Set([...subject.groups, ...selected])];
        return finish(`Added ${subject.name} to ${selected.map(groupName).join(", ")}.`, [subject.id]);
      }

      if (action.screen === "view_user") {
        return finish(`Opened the profile for ${subject.name}.`, [subject.id]);
      }

      if (action.screen === "edit_metadata") {
        const firstName = String(fields.firstName || "").trim();
        const lastName = String(fields.lastName || "").trim();
        if (firstName.length < 1 || lastName.length < 1) fail("Enter a first and last name.");
        let age = null;
        if (String(fields.age || "").trim()) {
          age = Number(fields.age);
          if (!Number.isInteger(age) || age < 0 || age > 120) fail("Age has to be a whole number.");
        }
        subject.firstName = firstName;
        subject.lastName = lastName;
        subject.age = age;
        subject.name = `${firstName} ${lastName}`;
        return finish(`Updated metadata for ${subject.name}.`, [subject.id]);
      }

      if (action.screen === "ban_user") {
        if (subject.status !== "active") fail("Ban an active account, or restore it first.");
        const hours = Number(fields.durationHours);
        if (![1, 24, 168, 720].includes(hours)) fail("Choose how long the ban lasts.");
        const reason = String(fields.reason || "").trim();
        if (reason.length < 3) fail("Add a short reason for the ban.");
        subject.bannedUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
        subject.banReason = reason;
        return finish(`Banned sign-in for ${subject.name} for ${hours} hour${hours === 1 ? "" : "s"}. Existing sessions stay valid until their tokens expire.`, [subject.id]);
      }

      fail("This action is not available.");
    }
  };
}
