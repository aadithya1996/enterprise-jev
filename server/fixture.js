function choice(value, confidence = 0.92) {
  return { type: "choice", choice: value, confidence, probabilities: { [value]: confidence, none: 1 - confidence } };
}

function noul(value) {
  return { type: "noul", noul: value };
}

function score(value) {
  return { type: "score", score: value, confidence: 0.9, probabilities: {} };
}

function answers(overrides) {
  return {
    primary_intent: choice("none", 0.8),
    risk_severity: score(0.2),
    check_duplicate: noul(0.05),
    payroll_dependency: noul(0.04),
    requires_manager_reassignment: noul(0.06),
    is_temporary_override: noul(0.03),
    subject_user: choice("unspecified", 0.7),
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
    owns_storage: noul(0.04),
    is_soft_delete: noul(0.04),
    needs_generation: noul(0.04),
    ...overrides
  };
}

export function fixtureEvaluation(state) {
  const message = String(state?.message || "");
  const text = message.toLowerCase();
  let picked = answers();

  if (text.includes("jenson") && text.includes("admin")) {
    picked = answers({
      primary_intent: choice("add_user", 0.94),
      risk_severity: score(0.3),
      check_duplicate: noul(0.95),
      subject_user: choice("jenson_hale", 0.93),
      target_group: choice("admin", 0.96),
      group_action: choice("add", 0.95)
    });
  } else if (text.includes("sarah") && /remove|offboard|delete/.test(text)) {
    picked = answers({
      primary_intent: choice("delete_user", 0.96),
      risk_severity: score(3),
      payroll_dependency: noul(0.97),
      requires_manager_reassignment: noul(0.95),
      subject_user: choice("sarah_chen", 0.94),
      new_manager: choice("alice_okonkwo", 0.92),
      effective_when: choice("next_friday", 0.9)
    });
  } else if (text.includes("inactivate") && text.includes("marcus")) {
    picked = answers({
      primary_intent: choice("inactivate_user", 0.93),
      risk_severity: score(1.2),
      subject_user: choice("marcus_hale", 0.95),
      inactive_reason: choice("leave", 0.91)
    });
  } else if (text.includes("dana") && text.includes("admin")) {
    picked = answers({
      primary_intent: choice("edit_rbac", 0.94),
      risk_severity: score(1.4),
      subject_user: choice("dana_ruiz", 0.95),
      target_role: choice("admin", 0.93)
    });
  } else if (text.includes("superadmin")) {
    picked = answers({
      primary_intent: choice("override_rbac", 0.97),
      risk_severity: score(3),
      is_temporary_override: noul(0.98),
      subject_user: choice("operator", 0.9),
      override_window: choice("h2", 0.94),
      target_role: choice("superadmin", 0.8)
    });
  } else if (text.includes("leo") && text.includes("manager")) {
    picked = answers({
      primary_intent: choice("update_manager", 0.93),
      risk_severity: score(1),
      subject_user: choice("leo_park", 0.94),
      new_manager: choice("alice_okonkwo", 0.95)
    });
  } else if (text.includes("remove") && text.includes("marcus")) {
    picked = answers({
      primary_intent: choice("edit_groups", 0.92),
      risk_severity: score(0.4),
      subject_user: choice("marcus_hale", 0.94),
      target_group: choice("engineering", 0.93),
      group_action: choice("remove", 0.95)
    });
  } else if (text.includes("priya")) {
    picked = answers({
      primary_intent: choice("add_user", 0.9),
      risk_severity: score(0.2),
      check_duplicate: noul(0.84),
      subject_user: choice("mentioned_priya", 0.88),
      target_group: choice("support", 0.9),
      group_action: choice("add", 0.9)
    });
  } else if (text.includes("profile") || text.includes("metadata") && text.includes("dana")) {
    picked = answers({
      primary_intent: choice("view_user", 0.94),
      subject_user: choice("dana_ruiz", 0.93)
    });
  } else if (text.includes("noah") && (text.includes("first name") || text.includes("age") || text.includes("metadata"))) {
    picked = answers({
      primary_intent: choice("edit_metadata", 0.93),
      subject_user: choice("noah_ibarra", 0.94)
    });
  } else if (text.includes("ban") && text.includes("marcus")) {
    picked = answers({
      primary_intent: choice("ban_user", 0.95),
      risk_severity: score(2),
      subject_user: choice("marcus_hale", 0.94),
      ban_window: choice("h24", 0.9)
    });
  } else if (text.includes("export") && text.includes("support")) {
    picked = answers({
      primary_intent: choice("export_users", 0.97),
      export_group: choice("support", 0.96),
      target_group: choice("support", 0.9)
    });
  } else if (text.includes("export")) {
    picked = answers({
      primary_intent: choice("export_users", 0.97)
    });
  } else if (text.includes("leo") && /delete|remove/.test(text)) {
    picked = answers({
      primary_intent: choice("delete_user", 0.94),
      owns_storage: noul(0.96),
      subject_user: choice("leo_park", 0.93),
      delete_mode: choice("hard", 0.9)
    });
  } else if (/create .+group|new team/.test(text)) {
    picked = answers({
      primary_intent: choice("create_group", 0.94),
      needs_generation: noul(0.88)
    });
  } else if (/rls|row-level|row level/.test(text)) {
    picked = answers({
      primary_intent: choice("manage_rls", 0.93),
      needs_generation: noul(0.91)
    });
  } else if (/who can (read|see)|explain access|rbac/.test(text)) {
    picked = answers({
      primary_intent: choice("explain_access", 0.92),
      needs_generation: noul(0.9)
    });
  }

  return {
    model: "fixture-not-jev",
    answers: picked,
    usage: { input_tokens: 0, output_tokens: 0 },
    latencyMs: 180
  };
}
