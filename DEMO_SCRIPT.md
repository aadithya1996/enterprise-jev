# Enterprise Jev — Demo Script

A presenter's walkthrough for the Directory Control Plane. Total runtime **~6–8 minutes**.
The script is written as spoken narration (**SAY**) paired with the exact action to
perform on screen (**DO**) and what the audience should notice (**NOTICE**).

---

## 0. Setup (before the audience arrives)

**DO**
- Start the server: `npm start` (listens on `http://localhost:4731`).
- Open the app and reset to a clean directory (the demo runner resets automatically).
- Optional automated run: `npm run demo:display -- --step` (press Enter between scenes),
  or `./run-demo.sh --report` to auto-open the screenshot report at the end.

**SAY**
> "This is Enterprise Jev — a control plane for your directory. Instead of hunting through
> a dozen admin forms, an operator just describes the change in plain English, and Jev
> assembles the exact, pre-filled action for review."

---

## 1. Live draft → deploy (the headline capability)

**Prompt:** `update Dana's role to admin`

**DO**
- Start typing the prompt slowly. **Do not press Enter yet.**

**NOTICE**
- As soon as the request is recognized, the **right card is drafted in place** — Dana's
  profile (avatar, current role, squad), the action ("Edit role"), and the **auto-filled**
  new value (**Admin**, shown as `← Was: Moderator`).
- A slim loader runs into the card while it settles. Nothing has been submitted.

**SAY**
> "Notice I haven't hit send. The moment Jev understands me, it drafts the card right here
> and fills in the values it inferred — the right person, the right action, the new role.
> It's a preview, not a commitment."

**DO**
- Press **Enter once**.

**NOTICE**
- The loader completes and the draft **opens into the full, editable card** — the role
  becomes a real dropdown, the confirm button appears, and Dana's record lifts **UP** from
  the directory dock into the chat with a cinematic vignette.

**SAY**
> "One keystroke opens the full card. If everything looks right, I confirm; if not, I can
> adjust any field first."

**DO**
- Press **Enter again** (or click **Update role**).

**NOTICE**
- The change commits and Dana's row updates to **Admin** in the directory below, with a
  brief "Committed to directory" confirmation on the card.

**SAY**
> "Two calm keystrokes: open, then commit. The operator is always in control, and the card
> stays a single clean surface — no nested boxes, no repeated text."

---

## 2. Disambiguation — group vs. role

**Prompt:** `Add Dana to the Admin team`

**DO**
- Type the prompt; let the draft appear; press Enter to open; then commit.

**NOTICE**
- Jev routes this to **Edit groups**, not the RBAC role. The **Admin team** group is
  pre-checked — it understood "Admin team" means the operational squad, not the Admin role.

**SAY**
> "Same word, 'Admin', but a completely different intent. Jev distinguishes the *team* from
> the *role* and opens group membership instead of a promotion."

---

## 3. Compound provisioning — creation flows DOWN

**Prompt:** `Can you add Cecil to the support team`

**DO**
- Type, open the card, review, then click **Add user**.

**NOTICE**
- Cecil doesn't exist yet. Jev folds **create user + Support squad assignment** into one
  card and pre-fills name and email. On save, the card animates **DOWN** into the directory
  table and the new row lands with a gold pulse.

**SAY**
> "For a brand-new person, Jev combines creation and group assignment into a single step.
> Watch the card drop down and become a real directory row."

---

## 4. Deprovisioning with dependency gates

**Prompt:** `Hard-delete Sarah Chen`

**DO**
- Open the card; point out the blocking requirements before submitting.

**NOTICE**
- The card flags **manager reassignment** (Sarah manages direct reports) and a
  **payroll run date**, and surfaces a non-blocking notice about her owned storage files.
- The action **cannot be confirmed** until a successor manager and payroll date are chosen.

**SAY**
> "High-risk actions carry guardrails. Offboarding Sarah is blocked until her reports have a
> new manager and payroll is accounted for — the safeguards are built into the card."

---

## 5. Break-glass elevation with MFA

**Prompt:** `Give me superadmin access for 2 hours to fix the billing bug`

**DO**
- Open the card; enter the demo authenticator code; grant access.

**NOTICE**
- Jev recognizes a **temporary** elevation. It never grants permanent superadmin — it locks
  the window to **2 hours** and presents a live **authenticator MFA** challenge.

**SAY**
> "Temporary means temporary. Jev pre-sets the duration and requires an MFA code before any
> elevated access is granted."

---

## 6. Security policy drafting (System One + OpenAI)

**Prompt:** `Add an RLS policy so people only read their own profile`

**DO**
- Switch the dock to **Policies** (the demo does this automatically); open the card; save.

**NOTICE**
- Jev classifies this as a row-level-security request and drafts the Postgres
  `USING (auth.uid() = id)` expression against `public.profiles`, pre-filling the policy card.

**SAY**
> "For security policies, Jev classifies the intent instantly and drafts the actual SQL
> expression, so the operator reviews a ready-made policy instead of writing it by hand."

---

## Closing

**SAY**
> "That's Enterprise Jev: describe the change, review a draft that's already filled in, and
> deploy with a keystroke. Fast to draft, safe to commit, and always the operator's decision."

---

## Appendix — New capabilities in this build

- **Live draft preview.** The matching action card is drafted in place as you type, with the
  right entity and inferred values auto-filled, before anything is sent.
- **Press Enter to deploy.** The draft opens into the full, editable card on the first Enter;
  a second Enter commits. A loader visibly runs into the card during the transition.
- **Redesigned single-surface card.** One clean container: an entity header (avatar, name,
  current role, squad), streamlined title, subtle field labels, custom selects, and an inline
  commit confirmation — no box-in-a-box and no repeated names.
- **Neutral, product-first language.** The interface describes what it's doing ("Live preview",
  "Auto-filled", "Enter to deploy") rather than exposing internal engine terminology.

### Automated showcase flags

```bash
npm run demo:display                 # run all scenes at presenter pace
npm run demo:display -- --step       # pause for Enter between scenes
npm run demo:display -- --speed slow # slow pacing for large rooms
npm run demo:display -- --only 1     # run just the live draft → deploy scene
./run-demo.sh --report               # run, then open the screenshot report
```

Screenshots are written to `demo-output/` (including `01-dana-role-up-draft.png`, which
captures the live draft moment before deploy).
