import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "./directory.js";
import { buildQuestions, candidatesFromMessage, planFromAnswers } from "./plan.js";

const NOW = new Date("2026-09-23T12:00:00Z");

function choice(value, confidence = 0.93) {
  return { type: "choice", choice: value, confidence, probabilities: { [value]: confidence } };
}

function answers(overrides = {}) {
  return {
    primary_intent: choice("none", 0.9),
    risk_severity: { type: "score", score: 0.2, confidence: 0.8 },
    check_duplicate: { type: "noul", noul: 0.04 },
    payroll_dependency: { type: "noul", noul: 0.05 },
    requires_manager_reassignment: { type: "noul", noul: 0.04 },
    is_temporary_override: { type: "noul", noul: 0.03 },
    subject_user: choice("unspecified", 0.8),
    target_group: choice("none", 0.8),
    group_action: choice("unspecified", 0.8),
    target_role: choice("unspecified", 0.8),
    new_manager: choice("unspecified", 0.8),
    override_window: choice("unspecified", 0.8),
    effective_when: choice("unspecified", 0.8),
    inactive_reason: choice("unspecified", 0.8),
    delete_mode: choice("unspecified", 0.8),
    ban_window: choice("unspecified", 0.8),
    storage_action: choice("unspecified", 0.8),
    export_group: choice("unspecified", 0.8),
    export_role: choice("unspecified", 0.8),
    export_status: choice("unspecified", 0.8),
    export_age: choice("unspecified", 0.8),
    owns_storage: { type: "noul", noul: 0.04 },
    is_soft_delete: { type: "noul", noul: 0.04 },
    needs_generation: { type: "noul", noul: 0.04 },
    ...overrides
  };
}

function plan(message, overrides, mentions = [], draft = null) {
  const directory = createStore().snapshot();
  return planFromAnswers({
    message,
    answers: answers(overrides),
    directory,
    mentions,
    meta: { model: "jev-test", latencyMs: 120 },
    now: NOW,
    draft
  });
}

function field(modal, name) {
  return modal.fields.find((item) => item.name === name);
}

test("questions use the live Jev schema for every use-case flag", () => {
  const directory = createStore().snapshot();
  const questions = buildQuestions(directory, [{ key: "mentioned_priya", label: "Priya" }]);
  for (const key of ["primary_intent", "export_group", "export_role", "export_status", "export_age"]) {
    assert.ok(questions[key]);
  }
  assert.equal(questions.primary_intent.type, "choice");
  assert.deepEqual(Object.keys(questions.primary_intent.criteria), [
    "add_user",
    "inactivate_user",
    "delete_user",
    "edit_rbac",
    "override_rbac",
    "update_manager",
    "edit_groups",
    "view_user",
    "edit_metadata",
    "ban_user",
    "export_users",
    "create_group",
    "manage_rls",
    "explain_access",
    "none"
  ]);
  assert.equal(questions.risk_severity.criteria.length, 4);
  assert.equal(questions.check_duplicate.type, "noul");
  assert.equal(questions.subject_user.criteria.mentioned_priya.includes("Priya"), true);
});

test("a new capitalized name becomes a choice option, known people do not", () => {
  const directory = createStore().snapshot();
  const mentions = candidatesFromMessage("Add Priya to the Support team", directory);
  assert.deepEqual(mentions, [{ key: "mentioned_priya", label: "Priya" }]);
  assert.deepEqual(candidatesFromMessage("Add Jenson to the Admin team", directory), []);
});

test("adding Jenson opens a provisioning form against his inactive profile", () => {
  const result = plan("Add Jenson to the Admin team", {
    primary_intent: choice("add_user", 0.94),
    check_duplicate: { type: "noul", noul: 0.95 },
    subject_user: choice("jenson_hale"),
    target_group: choice("admin"),
    group_action: choice("add")
  });
  assert.equal(result.modal.title, "Add Jenson");
  assert.equal(field(result.modal, "name").value, "Jenson Hale");
  assert.ok(field(result.modal, "groups").value.includes("admin"));
  assert.ok(field(result.modal, "groups").value.includes("engineering"));
  assert.equal(result.modal.notices[0].tone, "warning");
  assert.deepEqual(result.modal.buttons.map((button) => button.id), ["reactivate", "create"]);
  assert.equal(result.action.screen, "add_user");
  assert.equal(result.action.subjectId, "jenson_hale");
});

test("an Admin-team request is not left as an empty role change", () => {
  const result = plan("Add Jenson to the Admin team", {
    primary_intent: choice("edit_rbac", 0.75),
    subject_user: choice("jenson_hale"),
    target_group: choice("admin"),
    target_role: choice("unspecified"),
    group_action: choice("add")
  });
  assert.equal(result.trace.screen, "add_user");
  assert.ok(field(result.modal, "groups").value.includes("admin"));
});

test("an active person named with a group opens membership, not a second profile", () => {
  const result = plan("Add Marcus to the Admin team", {
    primary_intent: choice("add_user", 0.9),
    subject_user: choice("marcus_hale"),
    target_group: choice("admin"),
    group_action: choice("add")
  });
  assert.equal(result.trace.screen, "edit_groups");
  assert.equal(field(result.modal, "groupAction").value, "add");
  assert.deepEqual(field(result.modal, "groups").value, ["admin"]);
});

test("offboarding Sarah holds for payroll and a new manager", () => {
  const result = plan("Remove Sarah next Friday after payroll clears, and route her direct reports to Alice.", {
    primary_intent: choice("delete_user", 0.96),
    risk_severity: { type: "score", score: 3, confidence: 0.9 },
    payroll_dependency: { type: "noul", noul: 0.97 },
    requires_manager_reassignment: { type: "noul", noul: 0.95 },
    subject_user: choice("sarah_chen"),
    new_manager: choice("alice_okonkwo"),
    effective_when: choice("next_friday")
  });
  assert.equal(result.trace.risk.id, "critical");
  assert.equal(field(result.modal, "payrollDate").value, "2026-09-25");
  assert.equal(field(result.modal, "newManagerId").value, "alice_okonkwo");
  assert.equal(field(result.modal, "confirm").match, "Sarah");
  assert.equal(result.action.requirements.payroll, true);
  assert.equal(result.action.requirements.manager, true);
  assert.match(result.reply, /Direct reports still need a manager/);
});

test("temporary superadmin asks for a duration and an authenticator code", () => {
  const result = plan("Give me superadmin access for 2 hours to fix the billing bug", {
    primary_intent: choice("override_rbac", 0.97),
    risk_severity: { type: "score", score: 2.8, confidence: 0.88 },
    is_temporary_override: { type: "noul", noul: 0.98 },
    subject_user: choice("operator"),
    override_window: choice("h2")
  });
  assert.equal(field(result.modal, "durationHours").value, "2");
  assert.equal(field(result.modal, "subjectId").value, "operator");
  assert.equal(field(result.modal, "mfa").demoCode, result.action.mfaCode);
  assert.equal(result.action.requirements.mfa, true);
});

test("a lasting promotion stays on the role form", () => {
  const result = plan("Promote Dana to Admin", {
    primary_intent: choice("edit_rbac", 0.94),
    subject_user: choice("dana_ruiz"),
    target_role: choice("admin"),
    is_temporary_override: { type: "noul", noul: 0.08 }
  });
  assert.equal(result.trace.screen, "edit_rbac");
  assert.equal(field(result.modal, "role").value, "admin");
});

test("commit reactivates Jenson onto Admin and can offboard Sarah onto Alice", () => {
  const store = createStore();
  const add = plan("Add Jenson to the Admin team", {
    primary_intent: choice("add_user"),
    check_duplicate: { type: "noul", noul: 0.95 },
    subject_user: choice("jenson_hale"),
    target_group: choice("admin"),
    group_action: choice("add")
  });
  const reactivated = store.commit(add.action, {
    name: "Jenson Hale",
    email: "jenson.hale@halden.example",
    role: "member",
    groups: ["engineering", "admin"],
    managerId: "sarah_chen"
  }, "reactivate");
  const jenson = reactivated.snapshot.users.find((user) => user.id === "jenson_hale");
  assert.equal(jenson.status, "active");
  assert.ok(jenson.groups.includes("admin"));

  const remove = plan("Remove Sarah next Friday after payroll clears, and route her direct reports to Alice.", {
    primary_intent: choice("delete_user"),
    risk_severity: { type: "score", score: 3, confidence: 0.9 },
    payroll_dependency: { type: "noul", noul: 0.97 },
    requires_manager_reassignment: { type: "noul", noul: 0.95 },
    subject_user: choice("sarah_chen"),
    new_manager: choice("alice_okonkwo"),
    effective_when: choice("next_friday")
  });
  const offboarded = store.commit(remove.action, {
    subjectId: "sarah_chen",
    payrollDate: "2026-09-25",
    newManagerId: "alice_okonkwo",
    confirm: "Sarah",
    deleteMode: "hard",
    storageAction: "delete_objects"
  }, "delete");
  const snapshot = offboarded.snapshot;
  assert.equal(snapshot.users.find((user) => user.id === "sarah_chen").status, "offboarded");
  assert.equal(snapshot.users.find((user) => user.id === "marcus_hale").managerId, "alice_okonkwo");
  assert.equal(snapshot.users.find((user) => user.id === "leo_park").managerId, "alice_okonkwo");
  assert.equal(snapshot.users.find((user) => user.id === "sarah_chen").directReports.length, 0);
});

test("override grant and revoke stay off the lasting role", () => {
  const store = createStore();
  const result = plan("Give me superadmin access for 2 hours", {
    primary_intent: choice("override_rbac"),
    is_temporary_override: { type: "noul", noul: 0.99 },
    subject_user: choice("operator"),
    override_window: choice("h2"),
    risk_severity: { type: "score", score: 3, confidence: 0.9 }
  });
  assert.throws(() => store.commit(result.action, {
    subjectId: "operator",
    durationHours: "2",
    reason: "Fix billing",
    mfa: "000000"
  }, "grant"), /authenticator/);
  const granted = store.commit(result.action, {
    subjectId: "operator",
    durationHours: "2",
    reason: "Fix the billing bug",
    mfa: result.action.mfaCode
  }, "grant");
  assert.equal(granted.snapshot.overrides.length, 1);
  assert.equal(granted.snapshot.users.find((user) => user.id === "dana_ruiz").role, "moderator");
  const revoked = store.revoke();
  assert.equal(revoked.snapshot.overrides.length, 0);
});

test("view, metadata, ban, and export open the matching forms", () => {
  const viewed = plan("Show me Dana's profile and metadata", {
    primary_intent: choice("view_user", 0.95),
    subject_user: choice("dana_ruiz")
  });
  assert.equal(viewed.modal.title, "Dana Ruiz");
  assert.equal(field(viewed.modal, "subjectId").value, "dana_ruiz");

  const meta = plan("Set Noah's first name to Noah and age to 31", {
    primary_intent: choice("edit_metadata", 0.93),
    subject_user: choice("noah_ibarra")
  });
  assert.equal(field(meta.modal, "firstName").value, "Noah");
  const saved = createStore().commit(meta.action, { subjectId: "noah_ibarra", firstName: "Noah", lastName: "Ibarra", age: "31" }, "save");
  assert.equal(saved.snapshot.users.find((user) => user.id === "noah_ibarra").age, 31);

  const banned = plan("Ban Marcus for 24 hours", {
    primary_intent: choice("ban_user", 0.94),
    subject_user: choice("marcus_hale"),
    ban_window: choice("h24")
  });
  assert.equal(field(banned.modal, "durationHours").value, "24");
  const afterBan = createStore().commit(banned.action, { subjectId: "marcus_hale", durationHours: "24", reason: "Security review" }, "ban");
  assert.ok(afterBan.snapshot.users.find((user) => user.id === "marcus_hale").bannedUntil);

  const exported = plan("Export the user directory as CSV", {
    primary_intent: choice("export_users", 0.96)
  });
  assert.equal(exported.modal.title, "Export users");
  const file = createStore().commit(exported.action, { status: "all" }, "export");
  assert.match(file.download.content, /alice.okonkwo@halden.example/);

  const support = plan("Can you give me an export of support users as csv", {
    primary_intent: choice("export_users", 0.95),
    export_group: choice("support"),
    target_group: choice("support")
  });
  assert.equal(field(support.modal, "groupId").value, "support");
  const supportFile = createStore().commit(support.action, {
    groupId: "support",
    role: "",
    status: "all",
    ageBand: ""
  }, "export");
  assert.match(supportFile.download.filename, /support/);
  assert.match(supportFile.download.content, /dana.ruiz/);
  assert.doesNotMatch(supportFile.download.content, /marcus.hale/);
});

test("hard delete warns about storage but does not block", () => {
  const store = createStore();
  const result = plan("Delete Leo's account", {
    primary_intent: choice("delete_user", 0.95),
    owns_storage: { type: "noul", noul: 0.96 },
    subject_user: choice("leo_park"),
    delete_mode: choice("hard")
  });
  assert.equal(field(result.modal, "storageAction").required, false);
  assert.match(result.modal.notices.find((notice) => /owns/.test(notice.text)).text, /warn|leave those files/i);
  assert.equal(result.modal.notices.find((notice) => /owns/.test(notice.text)).tone, "warning");
  const deleted = store.commit(result.action, {
    subjectId: "leo_park",
    payrollDate: "2026-09-25",
    confirm: "Leo",
    deleteMode: "hard"
  }, "delete");
  assert.equal(deleted.snapshot.users.find((user) => user.id === "leo_park").status, "offboarded");
  // Files stay on the offboarded profile when the operator leaves them.
  assert.equal(deleted.snapshot.users.find((user) => user.id === "leo_park").storageObjects.length, 1);

  const cleaned = createStore().commit(result.action, {
    subjectId: "leo_park",
    payrollDate: "2026-09-25",
    confirm: "Leo",
    deleteMode: "hard",
    storageAction: "delete_objects"
  }, "delete");
  assert.equal(cleaned.snapshot.users.find((user) => user.id === "leo_park").storageObjects.length, 0);
});

test("create group and rls screens persist in the store", () => {
  const created = plan("Create a Platform group for on-call engineers", {
    primary_intent: choice("create_group", 0.94),
    needs_generation: { type: "noul", noul: 0.9 }
  }, [], { groupName: "Platform", groupDetail: "On-call engineers" });
  assert.equal(created.trace.screen, "create_group");
  assert.equal(field(created.modal, "name").value, "Platform");
  const store = createStore();
  const after = store.commit(created.action, { name: "Platform", detail: "On-call engineers" }, "create");
  assert.ok(after.snapshot.groups.some((group) => group.id === "platform"));

  const rls = planFromAnswers({
    message: "Add an RLS policy so people only read their own profile",
    answers: answers({ primary_intent: choice("manage_rls", 0.93) }),
    directory: after.snapshot,
    meta: { model: "jev-test" },
    now: NOW,
    draft: {
      policyName: "Read own profile v2",
      table: "public.profiles",
      command: "select",
      grantee: "authenticated",
      usingExpr: "auth.uid() = id"
    }
  });
  assert.equal(rls.trace.screen, "manage_rls");
  const saved = store.commit(rls.action, {
    name: "Read own profile v2",
    table: "public.profiles",
    command: "select",
    grantee: "authenticated",
    usingExpr: "auth.uid() = id",
    enabled: "true"
  }, "save");
  assert.ok(saved.snapshot.policies.some((policy) => policy.name === "Read own profile v2"));
});

test("an unknown person targeted for group or role changes creates the user first", () => {
  const result = plan("add vishwa to the design team", {
    primary_intent: choice("edit_groups", 0.88),
    subject_user: choice("mentioned_vishwa"),
    target_group: choice("none"),
    group_action: choice("add")
  }, [{ key: "mentioned_vishwa", label: "Vishwa" }]);

  assert.equal(result.trace.screen, "add_user");
  assert.equal(result.modal.title, "Add Vishwa");
  assert.equal(field(result.modal, "name").value, "Vishwa");
  assert.match(result.reply, /Vishwa isn't in the directory yet, so this creates their profile first/);
  assert.ok(result.modal.buttons.some((b) => b.id === "create"));
  assert.ok(result.modal.buttons.some((b) => b.id === "create_group" && b.label.includes("Design")));
});

test("an unknown person targeted for offboarding opens not_found with a create prompt", () => {
  const result = plan("delete vishwa", {
    primary_intent: choice("delete_user", 0.95),
    subject_user: choice("mentioned_vishwa")
  }, [{ key: "mentioned_vishwa", label: "Vishwa" }]);

  assert.equal(result.trace.screen, "not_found");
  assert.equal(result.modal.title, "Vishwa not found");
  assert.ok(result.modal.buttons.some((b) => b.id === "add_user"));
});
