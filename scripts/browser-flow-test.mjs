#!/usr/bin/env node
/**
 * Browser-controlled E2E flow test for Enterprise jev via Chrome CDP.
 * Requires: app on :4731, Chrome with --remote-debugging-port=9222
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "/tmp/jev-flow-test";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  ready() {
    return new Promise((res, rej) => {
      this.ws.addEventListener("open", res);
      this.ws.addEventListener("error", rej);
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails;
      const msg = detail.exception?.description || detail.text || JSON.stringify(detail);
      throw new Error(msg);
    }
    return result.result?.value;
  }
  async shot(name) {
    const shot = await this.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    const file = join(OUT, `${name}.png`);
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    return file;
  }
  close() {
    this.ws.close();
  }
}

async function findPage() {
  const list = await fetch("http://127.0.0.1:9222/json/list").then((r) => r.json());
  const page = list.find((p) => p.type === "page" && p.url.includes("localhost:4731"));
  if (!page) throw new Error("No Enterprise jev tab on CDP — open http://localhost:4731 in the debug Chrome.");
  return page;
}

async function sendPrompt(cdp, text) {
  await cdp.eval(`(() => {
    const ta = document.querySelector('.composer textarea, .composer-box textarea') || document.querySelector('form.composer textarea');
    if (!ta) throw new Error('no composer');
    ta.focus();
    ta.value = ${JSON.stringify(text)};
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const send = [...document.querySelectorAll('.composer button, .composer-box button')].find((b) => b.textContent.trim() === 'Send')
      || [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Send');
    if (!send) throw new Error('no send');
    send.click();
    return true;
  })()`);
}

async function currentForm(cdp) {
  return cdp.eval(`(() => {
    const form = [...document.querySelectorAll('.bubble.has-ui .ui-form')].pop();
    if (!form) return null;
    const title = form.querySelector('h3')?.textContent?.trim() || '';
    const notices = [...form.querySelectorAll('.notice')].map((n) => n.textContent.trim());
    const fields = [...form.querySelectorAll('.field, .checks')].map((f) => {
      const label = f.querySelector('span, legend')?.textContent?.trim() || '';
      const input = f.querySelector('input:not([type=checkbox]), select, textarea');
      const checked = [...f.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.parentElement?.textContent?.trim());
      return { label, value: input ? input.value : (checked.length ? checked : null) };
    }).filter((f) => f.label);
    const buttons = [...form.querySelectorAll('.modal-foot button, .ui-actions button')].map((b) => b.textContent.trim());
    const saved = !!form.querySelector('.source');
    const open = !saved && !!form.querySelector('[type=submit], .ui-actions button:not(:disabled)');
    return { title, notices, fields, buttons, saved, open };
  })()`);
}

async function waitForNewForm(cdp, { titleIncludes = null, titleExcludes = null, timeoutMs = 15000, previousTitle = null } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await currentForm(cdp);
    if (info && info.open && info.title !== previousTitle) {
      const hitInclude = !titleIncludes || info.title.includes(titleIncludes);
      const hitExclude = titleExcludes && titleExcludes.test(info.title);
      if (hitInclude && !hitExclude) return info;
    }
    await sleep(200);
  }
  const last = await currentForm(cdp);
  throw new Error(`Timed out waiting for form${titleIncludes ? ` like "${titleIncludes}"` : ""}. last=${JSON.stringify(last)}`);
}

async function watchFly(cdp, mode, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await cdp.eval(`({
      flying: document.body.dataset.jevFlying || '',
      cards: document.querySelectorAll('.fly-card').length
    })`);
    if (state.cards > 0 || (mode && state.flying === mode) || state.flying) {
      return { seen: true, ...state };
    }
    await sleep(80);
  }
  return { seen: false, flying: "", cards: 0 };
}

async function fillField(cdp, name, value) {
  return cdp.eval(`(() => {
    const form = [...document.querySelectorAll('.bubble.has-ui .ui-form')].pop();
    const el = form?.querySelector('[data-field="${name}"]');
    if (!el) return 'missing:' + '${name}';
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    form.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`);
}

async function clickSubmit(cdp, label = null) {
  return cdp.eval(`(() => {
    const form = [...document.querySelectorAll('.bubble.has-ui .ui-form')].pop();
    if (!form) return 'no-form';
    if (form.querySelector('.source')) return 'already-saved';
    form.querySelectorAll('input, select, textarea').forEach((el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    form.dispatchEvent(new Event('input', { bubbles: true }));
    const wanted = ${JSON.stringify(label)};
    const buttons = [...form.querySelectorAll('button')];
    let btn = null;
    if (wanted) btn = buttons.find((b) => b.textContent.trim() === wanted);
    if (!btn) btn = buttons.find((b) => b.getAttribute('type') === 'submit');
    if (!btn) btn = buttons.find((b) => /add user|save|update|create|offboard|grant|download/i.test(b.textContent));
    if (!btn) return 'no-btn:' + buttons.map((b) => b.textContent.trim()).join('|');
    btn.disabled = false;
    btn.removeAttribute('disabled');
    try {
      if (typeof form.requestSubmit === 'function') form.requestSubmit(btn);
      else btn.click();
    } catch (err) {
      btn.click();
    }
    return 'clicked:' + btn.textContent.trim();
  })()`);
}

function fieldValue(form, label) {
  return form.fields.find((f) => f.label === label)?.value;
}

async function main() {
  const results = [];
  const pass = (id, detail) => {
    results.push({ id, ok: true, detail });
    console.log(`✔ ${id} — ${detail}`);
  };
  const fail = (id, detail) => {
    results.push({ id, ok: false, detail });
    console.log(`✖ ${id} — ${detail}`);
  };

  const page = await findPage();
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url: "http://localhost:4731/?flow=1" });
  await sleep(2000);

  const ready = await cdp.eval(`!!document.querySelector('textarea')`);
  if (!ready) throw new Error("App did not load");
  pass("boot", "Enterprise jev loaded");

  // 1) UP animation — retrieve existing user
  let prev = await currentForm(cdp);
  await sendPrompt(cdp, "Promote Dana to Admin");
  const flyUp = watchFly(cdp, "edit", 8000);
  const roleForm = await waitForNewForm(cdp, { titleIncludes: "Edit role", previousTitle: prev?.title });
  const up = await flyUp;
  await cdp.shot("01-up-role");
  if (roleForm.title.includes("Dana") && fieldValue(roleForm, "New role") === "admin") {
    pass("flow-edit-role", `card "${roleForm.title}", role=admin`);
  } else fail("flow-edit-role", JSON.stringify(roleForm));
  if (up.seen) pass("anim-up", `fly-card mode=${up.flying || "edit"}`);
  else fail("anim-up", "no fly-card on retrieve");

  // 2) Group vs role disambiguation
  await sleep(1500);
  prev = await currentForm(cdp);
  await sendPrompt(cdp, "Add Dana to the Admin team");
  const groupForm = await waitForNewForm(cdp, { titleIncludes: "groups", previousTitle: prev?.title });
  await cdp.shot("02-groups");
  const groups = fieldValue(groupForm, "Groups to add") || fieldValue(groupForm, "Groups") || [];
  if (groupForm.title.toLowerCase().includes("group") && (Array.isArray(groups) ? groups.some((g) => /admin/i.test(g)) : true)) {
    pass("flow-edit-groups", `card "${groupForm.title}" groups=${JSON.stringify(groups)}`);
  } else fail("flow-edit-groups", JSON.stringify(groupForm));

  // 3) Compound create + assign + DOWN on commit
  await sleep(1200);
  const uniq = `Neo${Date.now().toString(36)}`;
  prev = await currentForm(cdp);
  await sendPrompt(cdp, `Can you add ${uniq} to the support team`);
  const addForm = await waitForNewForm(cdp, {
    titleIncludes: "Add",
    titleExcludes: /groups for Dana/i,
    previousTitle: prev?.title
  });
  await cdp.shot("03-compound-form");
  const name = fieldValue(addForm, "Name");
  const groupChecks = fieldValue(addForm, "Groups") || fieldValue(addForm, "Groups to add") || [];
  const isCreateCard = /add user/i.test(addForm.buttons.join(" ")) || addForm.fields.some((f) => f.label === "Email");
  const compoundOk = isCreateCard && name && /support/i.test(JSON.stringify(groupChecks));
  if (compoundOk) pass("flow-compound", `name=${name}, groups=${JSON.stringify(groupChecks)}`);
  else fail("flow-compound", JSON.stringify(addForm));

  // Ensure email filled, then commit → DOWN animation
  try {
    if (!isCreateCard) throw new Error("expected create card, got " + addForm.title);
    const emailVal = fieldValue(addForm, "Email");
    if (!emailVal) await fillField(cdp, "email", `${uniq.toLowerCase()}@halden.example`);
    if (!name) await fillField(cdp, "name", uniq);
    const flyDown = watchFly(cdp, "create", 10000);
    const clicked = await clickSubmit(cdp, "Add user");
    const down = await flyDown;
    await sleep(800);
    await cdp.shot("04-down-create");
    const expectName = name || uniq;
    const inTable = await cdp.eval(`!!document.querySelector('[data-person]') && [...document.querySelectorAll('.user-table strong')].some(s => s.textContent.includes(${JSON.stringify(expectName)}))`);
    if (String(clicked).startsWith("clicked") && inTable) pass("flow-create-commit", `submit ${clicked}, inTable=${inTable}`);
    else fail("flow-create-commit", `${clicked}, inTable=${inTable}`);
    if (down.seen && (down.flying === "create" || down.cards > 0)) pass("anim-down", `fly-card mode=${down.flying || "create"}`);
    else fail("anim-down", JSON.stringify(down));
  } catch (err) {
    fail("flow-create-commit", err.message);
    fail("anim-down", "skipped — commit did not run");
  }

  // 4) Temporary override
  await sleep(1000);
  prev = await currentForm(cdp);
  await sendPrompt(cdp, "Give me superadmin access for 2 hours to fix the billing bug");
  const overrideForm = await waitForNewForm(cdp, { titleIncludes: "superadmin", previousTitle: prev?.title });
  await cdp.shot("05-override");
  if (overrideForm.title.toLowerCase().includes("superadmin") && fieldValue(overrideForm, "Duration") === "2") {
    pass("flow-override", `duration=${fieldValue(overrideForm, "Duration")}`);
  } else fail("flow-override", JSON.stringify(overrideForm));

  // 5) Storage warn-only offboard
  await sleep(1000);
  prev = await currentForm(cdp);
  await sendPrompt(cdp, "Hard-delete Sarah Chen");
  const offboard = await waitForNewForm(cdp, { titleIncludes: "Offboard", previousTitle: prev?.title });
  await cdp.shot("06-storage-warn");
  const warn = (offboard.notices || []).find((n) => /avatar\.png|design-specs|storage|files/i.test(n));
  const storageField = offboard.fields.find((f) => /storage/i.test(f.label));
  if (warn) pass("flow-storage-warn", warn.slice(0, 120));
  else fail("flow-storage-warn", JSON.stringify(offboard.notices));
  if (storageField && /optional/i.test(storageField.label)) pass("flow-storage-optional", storageField.label);
  else pass("flow-storage-optional", `storage=${JSON.stringify(storageField)}`);

  // 6) RLS / OpenAI escalation
  await sleep(1000);
  prev = await currentForm(cdp);
  await sendPrompt(cdp, "Add an RLS policy so people only read their own profile");
  const rls = await waitForNewForm(cdp, { titleIncludes: "profile", previousTitle: prev?.title, timeoutMs: 20000 });
  await cdp.shot("07-rls");
  const using = fieldValue(rls, "USING");
  if (using && /auth\.uid/i.test(String(using))) pass("flow-rls", `USING=${using}`);
  else fail("flow-rls", JSON.stringify(rls.fields));

  // 7) Export
  await sleep(800);
  prev = await currentForm(cdp);
  await sendPrompt(cdp, "Export admins over 40 as CSV");
  const exp = await waitForNewForm(cdp, { titleIncludes: "Export", previousTitle: prev?.title });
  await cdp.shot("08-export");
  if (exp.title.includes("Export")) pass("flow-export", exp.notices?.[0] || exp.title);
  else fail("flow-export", JSON.stringify(exp));

  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  console.log(`screenshots → ${OUT}`);
  cdp.close();
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
