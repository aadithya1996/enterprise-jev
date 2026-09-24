# Jev User Management: Use Cases & API Schema

When building a chat-based user management interface, Jev acts as the ultra-fast classification layer. Because Jev is a System One model that returns typed, probabilistic decisions instead of generating open text, you can map every chat message directly to application state without the overhead of parsing a language model's output.

Here is a breakdown of the core use cases and the exact JSON payload you would send to the Jev API to handle them.

## 1. Detailed Use Cases

### Provisioning & Deprovisioning
* **Add User:** Provisioning a new identity and assigning initial groups. This often triggers a duplicate check if an inactive profile already exists in the system.
* **Inactivate User:** Temporarily disabling login access (e.g., for a leave of absence or security review) without deleting the underlying data.
* **Delete/Offboard User:** Permanently removing a user. This triggers critical downstream dependencies, like checking the final payroll run date and reassigning their direct reports to a new manager.

### Access Control & RBAC (Role-Based Access Control)
* **Edit Role:** Promoting or demoting a user (e.g., changing a "Member" to a "Moderator" or "Admin").
* **Temporary Override:** Granting short-term elevated access (e.g., "Give me superadmin access for 2 hours to fix the billing bug"). This requires a high-risk security check and potentially a multi-factor authentication (MFA) step rendered in the UI.

### Organizational Management
* **Update Manager:** Reassigning a user's reporting line, often required automatically when their current manager leaves or changes departments.
* **Group Assignment:** Adding or removing a user from specific feature groups, Slack channels, or operational squads.

### Directory, metadata, and auth lifecycle
* **View User:** Open a person's public profile plus auth-adjacent fields (email, status, metadata) without changing anything.
* **Edit Metadata:** Write `first_name`, `last_name`, and similar profile metadata. This does not change the auth identity.
* **Ban User:** Temporarily block new sign-in. Existing sessions stay valid until their access tokens expire.
* **Export Users:** Download `auth.users` joined to public profile fields as CSV.
* **Hard vs soft delete:** Hard delete removes the auth identity (sessions and refresh tokens drop; outstanding JWTs still last until `exp`). Soft delete only marks the profile deleted. Owned storage objects surface as a warning on the offboard card — deleting or reassigning them is optional, not a blocker.

---

## 2. The Jev API Questions Payload

To execute these use cases, you pass the unstructured chat input (the `state`) to Jev, along with a strict schema of `questions`. Jev evaluates all questions in parallel and returns structured probabilities (e.g., `Choice`, `Score`, `Noul`). 

```json
{
  "state": "Remove Sarah next Friday after payroll clears, and route her direct reports to Alice.",
  "questions": {
    "primary_intent": {
      "type": "Choice",
      "options": [
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
        "none"
      ],
      "instructions": "Identify the primary user management action requested in the state."
    },
    "risk_severity": {
      "type": "Score",
      "levels": [
        "low",
        "medium",
        "high",
        "critical"
      ],
      "instructions": "Score the security and operational risk of the request. Overriding RBAC or deleting users is critical."
    },
    "check_duplicate": {
      "type": "Noul",
      "statement": "This request is provisioning a new user and requires checking against existing identities to prevent duplicate records."
    },
    "payroll_dependency": {
      "type": "Noul",
      "statement": "This request involves offboarding or terminating a user, which must be synchronized with a final payroll cycle."
    },
    "requires_manager_reassignment": {
      "type": "Noul",
      "statement": "The requested action removes or inactivates a user who likely manages direct reports, requiring their team to be reassigned."
    },
    "is_temporary_override": {
      "type": "Noul",
      "statement": "This request asks for a temporary elevation of permissions or a time-bound access override."
    }
  }
}
```

## 3. How to Use the Response in the UI

When Jev returns the evaluation (typically in under 500 milliseconds), your application logic reads the flags to render the correct UI elements. 

For example, if the `primary_intent` is `delete_user` and the `requires_manager_reassignment` Noul returns a high probability (e.g., `0.95`), your backend halts the automatic deletion. Instead, it injects an interactive reassignment modal directly into the chat window so the user can securely select the new manager before proceeding.

## 4. Auto-fill & Seamless Prefill

Every form (the "card") that Jev opens must arrive **pre-filled** whenever the request plus the directory already contain enough information. The card should never make the operator re-type something the system can already infer. This is what makes the experience feel seamless instead of like a wizard.

Rules for prefilling a card:

* **Resolve the subject first.** When a message names or references an existing person, group, role, or policy (via `subject_user`, `target_group`, `target_role`, or an OpenAI-drafted `policyId`), bind that record and lock its identity field. The card opens already scoped to that entity.
* **Copy known values onto the fields.** Pull the entity's current values straight from the directory snapshot: role, groups, manager, email, `first_name`, `last_name`, `age`, status, ban window, and (for RLS) `table`, `command`, `grantee`, `USING`, and `WITH CHECK`. Merge any values Jev or OpenAI extracted from the message on top of those defaults.
* **Infer sensible defaults.** For a brand-new user, derive the email from the name, default the role to `member`, and preselect any groups named in the message. For durations, map phrases like "2 hours" onto the matching preset.
* **Only ask for what is genuinely missing.** A required field stays empty (and the card stays un-submittable) *only* when neither the message nor the directory can supply it. If every required field is satisfied, the primary action is enabled immediately so the operator can confirm with a single click.
* **Editing is a read-then-write flow.** For any edit of an existing user or policy, the card is a mirror of the live record. Load the current row, then let the operator adjust just the deltas.

The goal: when sufficient information is present, opening the card and confirming it should feel like one continuous motion rather than a form to fill out.

## 5. Directory ↔ Chat Motion

Because cards mirror the live directory, motion always follows the direction of the data. There are exactly two transitions, tied to when data moves — not to when a form is saved:

* **Retrieval → UP.** Whenever an existing user or policy is *retrieved* into the chat (any view/edit card that opens pre-filled from a directory record), that record's data animates **up from the terminal/directory panel into the chat card**, with a brief cinematic backdrop. This is the only "up" transition, and it fires at retrieval time, not on save.
* **New user added → DOWN.** When a brand-new user is *added*, the data animates **down from the chat into the terminal table**, landing on the newly created row.

Editing an existing record does **not** animate on save — the "up" motion already happened when its data was retrieved. These transitions are cosmetic and must respect `prefers-reduced-motion`; the underlying prefill behavior above is what matters for correctness.