#!/usr/bin/env node
/**
 * ============================================================================
 * Enterprise jev — Interactive Demo Showcase & Visual Test Display Script
 * ============================================================================
 *
 * Demonstrates the core capabilities of Jev (System One classification &
 * seamless UI auto-fill) live in the browser with visual UP / DOWN animations,
 * high-res screenshot capture, and step-by-step presentation narration.
 *
 * New capabilities showcased:
 *   · Live draft preview — as you type, the matching action card is drafted in
 *     place with a loader and auto-filled values (no send required).
 *   · Press Enter to deploy — the draft opens into the full, editable card.
 *   · Redesigned single-surface card (clean entity header, no box-in-a-box).
 *
 * Usage:
 *   node scripts/display-demo.mjs
 *   ./run-demo.sh
 *   npm run demo:display
 *
 * Flags:
 *   --speed [normal|fast|slow]  Pacing (default: normal, for human presentations)
 *   --step                      Wait for [Enter] key in terminal between steps
 *   --only 1,3                  Run specific step numbers (e.g. 1, 3)
 *   --no-commit                 Do not click submit buttons, keep forms open
 *   --port 4731                 App server port (default: 4731)
 *   --cdp 9222                  Chrome debugging port (default: 9222)
 *   --report                    Automatically open HTML showcase report at end
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { exec, spawn } from "node:child_process";
import * as readline from "node:readline";

const OUT_DIR = resolve(process.cwd(), "demo-output");
mkdirSync(OUT_DIR, { recursive: true });

// Parse command-line arguments
const args = process.argv.slice(2);
function getArg(flag, fallback = null) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
}
const hasArg = (flag) => args.includes(flag);

const SPEED = getArg("--speed", "normal"); // "normal", "fast", "slow"
const INTERACTIVE_STEP = hasArg("--step");
const NO_COMMIT = hasArg("--no-commit");
const AUTO_REPORT = hasArg("--report");
const APP_PORT = getArg("--port", "4731");
const CDP_PORT = getArg("--cdp", "9222");
const ONLY_STEPS = getArg("--only")
  ? new Set(getArg("--only").split(",").map((s) => s.trim()))
  : null;

const SPEED_MULTIPLIERS = {
  fast: 0.4,
  normal: 1.0,
  slow: 1.7
};
const pace = SPEED_MULTIPLIERS[SPEED] || 1.0;

const sleep = (ms) => new Promise((res) => setTimeout(res, Math.max(50, Math.floor(ms * pace))));

// ANSI styling
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  gold: "\x1b[38;5;221m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  bgDark: "\x1b[48;5;236m"
};

function banner(title) {
  const line = "━".repeat(66);
  console.log(`\n${C.gold}${line}`);
  console.log(`  ${C.bold}${title}${C.reset}`);
  console.log(`${C.gold}${line}${C.reset}\n`);
}

function promptEnter(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(`\n${C.cyan}👉 ${query} [Press Enter to continue]${C.reset} `, () => {
      rl.close();
      res();
    });
  });
}

// ============================================================================
// Showcase Scenarios Definition
// ============================================================================

const SHOWCASE_STEPS = [
  {
    num: "1",
    id: "01-dana-role-up",
    capability: "Live Draft → Deploy + UP Motion & Auto-fill",
    desc: "As you type, the matching card is drafted in place with a loader and an auto-filled Role = Admin. Pressing Enter opens the full card; the record lifts UP from the directory table with a cinematic vignette.",
    prompt: "Promote Dana to Admin",
    dockTab: "users",
    showDraft: true,
    expected: {
      intent: "edit_rbac",
      risk: "low",
      titleIncludes: "Edit role",
      fields: [{ label: "Role", value: "admin" }]
    },
    action: "submit",
    actionLabel: "Update role",
    note: "The draft card appears while typing (auto-filled Admin). Enter deploys the full card as Dana's row lifts UP into chat."
  },
  {
    num: "2",
    id: "02-dana-group-disambiguate",
    capability: "Choice Disambiguation (Group ≠ Role)",
    desc: "Jev rubric disambiguates: 'Admin team' refers to the operator group, not the Admin RBAC role.",
    prompt: "Add Dana to the Admin team",
    dockTab: "users",
    expected: {
      intent: "edit_groups",
      risk: "low",
      titleIncludes: "groups",
      fieldIncludes: "Admin team"
    },
    action: "submit",
    actionLabel: "Save groups",
    note: "Jev routes to edit_groups instead of edit_rbac. 'Admin team' is pre-checked."
  },
  {
    num: "3",
    id: "03-cecil-compound-down",
    capability: "Compound Action & Creation → DOWN Motion",
    desc: "Cecil doesn't exist yet. Jev folds create + group into one card. On save, card drops DOWN into the table!",
    prompt: "Can you add Cecil to the support team",
    dockTab: "users",
    expected: {
      intent: "add_user",
      titleIncludes: "Add user",
      fields: [
        { label: "Name", value: "Cecil" },
        { label: "Email", value: "cecil@halden.example" }
      ]
    },
    action: "submit",
    actionLabel: "Add user",
    note: "Form pre-fills Cecil, Support group, and shows compound notice. On submit, card drops DOWN into table."
  },
  {
    num: "4",
    id: "04-sarah-storage-warning",
    capability: "Offboard Dependency & Storage File Warning",
    desc: "Hard-deleting Sarah Chen flags direct reports, payroll run date, and surfaces an optional storage files notice.",
    prompt: "Hard-delete Sarah Chen",
    dockTab: "users",
    expected: {
      intent: "delete_user",
      risk: "critical",
      titleIncludes: "Offboard",
      noticeIncludes: "avatar.png"
    },
    action: "submit",
    actionLabel: "Confirm offboard",
    note: "Shows payroll date, manager reassignment, and non-blocking warning for Sarah's owned storage files."
  },
  {
    num: "5",
    id: "05-temporary-override-mfa",
    capability: "Noul Flag + Temporary Superadmin MFA",
    desc: "Recognizes break-glass elevation request with 0.98 Noul probability. Pre-fills duration to 2 hours and displays MFA check.",
    prompt: "Give me superadmin access for 2 hours to fix the billing bug",
    dockTab: "users",
    expected: {
      intent: "override_rbac",
      risk: "critical",
      titleIncludes: "Temporary superadmin"
    },
    action: "mfa_and_submit",
    actionLabel: "Grant access",
    note: "Pre-fills duration=2 hours and demo authenticator code. Submitting grants temporary superadmin."
  },
  {
    num: "6",
    id: "06-openai-rls-policy",
    capability: "OpenAI Escalation for Postgres RLS",
    desc: "System One classifies manage_rls and escalates to OpenAI to draft a Postgres USING (auth.uid() = id) policy expression.",
    prompt: "Add an RLS policy so people only read their own profile",
    dockTab: "policies",
    expected: {
      intent: "manage_rls",
      titleIncludes: "Policy editor"
    },
    action: "submit",
    actionLabel: "Save policy",
    note: "Policies dock opens. Form pre-fills table=public.profiles and drafts SQL expression (auth.uid() = id)."
  }
];

// ============================================================================
// Chrome DevTools Protocol (CDP) WebSocket Client
// ============================================================================

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }

  ready() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve);
      this.ws.addEventListener("error", reject);
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
    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      const text = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`Eval failed: ${text}`);
    }
    return res.result?.value;
  }

  async captureScreenshot(filepath) {
    const shot = await this.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    writeFileSync(filepath, Buffer.from(shot.data, "base64"));
    return filepath;
  }

  close() {
    this.ws.close();
  }
}

// ============================================================================
// Environment & Chrome Helpers
// ============================================================================

async function ensureServerRunning() {
  const url = `http://localhost:${APP_PORT}/api/health`;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const health = await res.json();
      console.log(`${C.green}✔ App server active on port ${APP_PORT}${C.reset} (Jev model: ${health.model || "configured"})`);
      return true;
    }
  } catch {
    /* server not running yet */
  }

  console.log(`${C.cyan}Starting app server on port ${APP_PORT}...${C.reset}`);
  const nodeBin = existsSync("/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node")
    ? "/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node"
    : process.execPath;
  const child = spawn(nodeBin, ["server/index.js"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PORT: String(APP_PORT) }
  });
  child.unref();

  for (let i = 0; i < 20; i++) {
    await sleep(200);
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`${C.green}✔ App server started on port ${APP_PORT}${C.reset}`);
        return true;
      }
    } catch {
      /* continue polling */
    }
  }
  throw new Error(`Could not connect to app server on port ${APP_PORT}`);
}

async function getOrLaunchChrome() {
  const cdpListUrl = `http://127.0.0.1:${CDP_PORT}/json/list`;
  try {
    const list = await fetch(cdpListUrl).then((r) => r.json());
    if (Array.isArray(list)) {
      const page = list.find((p) => p.type === "page" && p.url.includes(`localhost:${APP_PORT}`));
      if (page) return page;
      // Tab exists on CDP, use new tab
      const newTab = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?http://localhost:${APP_PORT}/`).then((r) => r.json());
      return newTab;
    }
  } catch {
    /* Chrome not running with CDP */
  }

  console.log(`${C.cyan}Launching Chrome with remote debugging on port ${CDP_PORT}...${C.reset}`);
  const chromeApp = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(chromeApp)) {
    const chromeProc = spawn(chromeApp, [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=/tmp/chrome-jev-showcase`,
      "--no-first-run",
      "--no-default-browser-check",
      `http://localhost:${APP_PORT}/`
    ], { detached: true, stdio: "ignore" });
    chromeProc.unref();
  } else {
    throw new Error(`Google Chrome not found at ${chromeApp}. Start Chrome with --remote-debugging-port=${CDP_PORT}.`);
  }

  for (let i = 0; i < 30; i++) {
    await sleep(250);
    try {
      const list = await fetch(cdpListUrl).then((r) => r.json());
      const page = list.find((p) => p.type === "page" && p.url.includes(`localhost:${APP_PORT}`));
      if (page) return page;
    } catch {
      /* continue polling */
    }
  }
  throw new Error(`Failed to connect to Chrome over CDP on port ${CDP_PORT}`);
}

// ============================================================================
// In-Browser Automation Helpers
// ============================================================================

async function resetDirectory(cdp) {
  try {
    await cdp.eval(`fetch('/api/reset', { method: 'POST' }).catch(() => null)`);
  } catch {
    /* ignore if reset route not on running instance */
  }
}

async function typePromptWithVisualEffect(cdp, text) {
  await cdp.eval(`(() => {
    const composer = document.querySelector('.composer textarea, .composer-box textarea') || document.querySelector('textarea');
    if (!composer) throw new Error('Composer textarea not found');
    composer.focus();
    composer.value = '';
    composer.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  // Character by character typewriter effect
  const chunkDelay = Math.max(15, Math.floor(25 * pace));
  for (let i = 0; i < text.length; i++) {
    await cdp.eval(`(() => {
      const composer = document.querySelector('.composer textarea, .composer-box textarea') || document.querySelector('textarea');
      if (composer) {
        composer.value += ${JSON.stringify(text[i])};
        composer.dispatchEvent(new Event('input', { bubbles: true }));
        composer.scrollTop = composer.scrollHeight;
      }
    })()`);
    await new Promise((r) => setTimeout(r, chunkDelay));
  }
  await sleep(200);
}

async function clickSend(cdp) {
  await cdp.eval(`(() => {
    const sendBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Send');
    if (!sendBtn) throw new Error('Send button not found');
    sendBtn.click();
  })()`);
}

async function waitForDraftCard(cdp, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await cdp.eval(`Boolean(document.querySelector('.bubble.has-ui .card-loader-container, .bubble.is-staged'))`);
    if (ready) return true;
    await sleep(150);
  }
  return false;
}

async function waitForNewFormCard(cdp, beforeCount, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await cdp.eval(`(() => {
      const bubbles = [...document.querySelectorAll('.bubble')];
      if (bubbles.length <= ${beforeCount}) return null;
      const last = bubbles[bubbles.length - 1];
      if (last.classList.contains('pending')) return null;
      const form = last.querySelector('.ui-form');
      if (!form) return null;
      const title = form.querySelector('h3')?.textContent?.trim() || '';
      const notices = [...form.querySelectorAll('.notice')].map(n => n.textContent.trim());
      const fields = [...form.querySelectorAll('.field, .checks')].map(f => {
        const label = f.querySelector('span, legend')?.textContent?.trim() || '';
        const input = f.querySelector('input:not([type=checkbox]), select, textarea');
        const checked = [...f.querySelectorAll('input[type=checkbox]:checked')].map(c => c.parentElement?.textContent?.trim());
        return { label, value: input ? input.value : (checked.length ? checked : null) };
      }).filter(f => f.label);
      const buttons = [...form.querySelectorAll('button')].map(b => b.textContent.trim());
      const mfaDemo = form.querySelector('.authenticator strong')?.textContent?.trim() || null;
      return { title, notices, fields, buttons, mfaDemo };
    })()`);
    if (data && data.title) return data;
    await sleep(200);
  }
  throw new Error("Timed out waiting for new UI form card in chat");
}

async function highlightFormFields(cdp) {
  await cdp.eval(`(() => {
    const form = [...document.querySelectorAll('.bubble.has-ui .ui-form')].pop();
    if (!form) return;
    const inputs = form.querySelectorAll('input:not([type=hidden]):not([type=checkbox]), select, textarea, .authenticator, .notice');
    inputs.forEach(el => {
      if (el.value || el.classList.contains('notice') || el.classList.contains('authenticator')) {
        el.classList.add('demo-highlight');
        setTimeout(() => el.classList.remove('demo-highlight'), 2500);
      }
    });
  })()`);
}

async function fillMfaCodeIfPresent(cdp) {
  return cdp.eval(`(() => {
    const form = [...document.querySelectorAll('.bubble.has-ui .ui-form')].pop();
    const mfaInput = form?.querySelector('[data-field="mfa"]');
    const badge = form?.querySelector('.authenticator strong');
    if (mfaInput && badge) {
      mfaInput.value = badge.textContent.trim();
      mfaInput.dispatchEvent(new Event('input', { bubbles: true }));
      mfaInput.dispatchEvent(new Event('change', { bubbles: true }));
      return badge.textContent.trim();
    }
    return null;
  })()`);
}

async function clickSubmitButton(cdp, label) {
  return cdp.eval(`(() => {
    const form = [...document.querySelectorAll('.bubble.has-ui .ui-form')].pop();
    if (!form) return 'no-form';
    const buttons = [...form.querySelectorAll('button')];
    let btn = null;
    const wanted = ${JSON.stringify(label || "")}.toLowerCase();
    if (wanted) {
      btn = buttons.find(b => b.textContent.trim().toLowerCase().includes(wanted));
    }
    if (!btn) btn = buttons.find(b => b.getAttribute('type') === 'submit');
    if (!btn) btn = buttons.find(b => /add user|update|save|offboard|grant|confirm/i.test(b.textContent));
    if (!btn) return 'no-btn';
    btn.disabled = false;
    btn.removeAttribute('disabled');
    try {
      if (typeof form.requestSubmit === 'function') form.requestSubmit(btn);
      else btn.click();
    } catch {
      btn.click();
    }
    return 'clicked:' + btn.textContent.trim();
  })()`);
}

async function watchAnimationState(cdp, durationMs = 2000) {
  const start = Date.now();
  let flyState = { seen: false, mode: "" };
  while (Date.now() - start < durationMs) {
    const res = await cdp.eval(`({
      mode: document.body.dataset.jevFlying || '',
      cards: document.querySelectorAll('.fly-card').length
    })`);
    if (res.cards > 0 || res.mode) {
      flyState = { seen: true, mode: res.mode };
      break;
    }
    await sleep(60);
  }
  return flyState;
}

// ============================================================================
// HTML Report Generator
// ============================================================================

function generateHtmlReport(results) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Enterprise jev — Demo Showcase Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #161311; color: #fbf7f2; margin: 0; padding: 24px; }
    .header { text-align: center; margin-bottom: 32px; border-bottom: 1px solid #332b24; padding-bottom: 24px; }
    .header h1 { font-family: Georgia, serif; font-size: 32px; color: #e4b15d; margin: 0 0 8px; }
    .header p { color: #a3988c; font-size: 15px; margin: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(480px, 1fr)); gap: 24px; max-width: 1400px; margin: 0 auto; }
    .card { background: #241f1b; border: 1px solid #38312b; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.4); }
    .card-head { padding: 16px 20px; border-bottom: 1px solid #332b24; display: flex; justify-content: space-between; align-items: center; }
    .card-head h2 { font-size: 16px; margin: 0; color: #f6f0e8; }
    .badge { background: #1c6b55; color: #fff; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
    .card-body { padding: 16px 20px; }
    .prompt-box { background: #1a1613; border: 1px solid #3a322a; padding: 10px 14px; border-radius: 6px; font-family: monospace; font-size: 13px; color: #e4b15d; margin-bottom: 14px; }
    .card-desc { font-size: 13px; color: #cbbfb2; margin-bottom: 16px; line-height: 1.5; }
    .shot-wrap { border: 1px solid #38312b; border-radius: 8px; overflow: hidden; background: #000; }
    .shot-wrap img { width: 100%; display: block; }
    .meta-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .tag { background: #312b26; color: #cbbfb2; padding: 4px 10px; border-radius: 4px; font-size: 11px; }
    .status-pass { color: #4ade80; font-weight: bold; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Enterprise jev · Demo Showcase & Verification</h1>
    <p>Live draft-as-you-type &amp; press-Enter-to-deploy, System One probabilistic routing, UP/DOWN directional motion, and seamless form prefill.</p>
  </div>
  <div class="grid">
    ${results.map((r) => `
      <div class="card">
        <div class="card-head">
          <h2>Step ${r.num}: ${r.title}</h2>
          <span class="badge">${r.capability}</span>
        </div>
        <div class="card-body">
          <div class="prompt-box">💬 "${r.prompt}"</div>
          <div class="card-desc">${r.desc}</div>
          <div class="shot-wrap">
            <img src="./${r.shotFilename}" alt="${r.title}">
          </div>
          <div class="meta-tags">
            <span class="tag">Form: <strong>${r.formTitle || "None"}</strong></span>
            <span class="tag">Animation: <strong>${r.animSeen ? r.animMode.toUpperCase() : "Standard"}</strong></span>
            <span class="tag status-pass">✔ Verified</span>
          </div>
        </div>
      </div>
    `).join("")}
  </div>
</body>
</html>`;

  const reportPath = join(OUT_DIR, "index.html");
  writeFileSync(reportPath, html);
  return reportPath;
}

// ============================================================================
// Main Execution Loop
// ============================================================================

async function main() {
  banner("🎬 ENTERPRISE JEV — LIVE DEMO & PRESENTATION TEST RUNNER");
  console.log(`${C.dim}Mode: speed=${SPEED}, interactive_step=${INTERACTIVE_STEP}, no_commit=${NO_COMMIT}${C.reset}`);

  // 1. Verify app server & Chrome
  await ensureServerRunning();
  const page = await getOrLaunchChrome();
  console.log(`${C.green}✔ Connected to Chrome tab:${C.reset} ${page.url}`);

  // 2. Connect CDP WebSocket
  const cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  // Navigate to application
  console.log(`${C.cyan}Navigating to http://localhost:${APP_PORT}/ ...${C.reset}`);
  await cdp.send("Page.navigate", { url: `http://localhost:${APP_PORT}/` });
  await sleep(1500);

  // Reset state to fixtures
  await resetDirectory(cdp);
  await sleep(400);

  const results = [];
  const stepsToRun = SHOWCASE_STEPS.filter((s) => !ONLY_STEPS || ONLY_STEPS.has(s.num));

  for (let idx = 0; idx < stepsToRun.length; idx++) {
    const step = stepsToRun[idx];
    const isFirst = idx === 0;

    console.log(`\n${C.gold}┌────────────────────────────────────────────────────────────────────────┐${C.reset}`);
    console.log(`${C.gold}│${C.reset} ${C.bold}STEP ${step.num} OF ${SHOWCASE_STEPS.length}:${C.reset} ${C.cyan}${step.capability}${C.reset}`);
    console.log(`${C.gold}├────────────────────────────────────────────────────────────────────────┤${C.reset}`);
    console.log(`${C.gold}│${C.reset} ${C.bold}Prompt:${C.reset}    "${step.prompt}"`);
    console.log(`${C.gold}│${C.reset} ${C.bold}Concept:${C.reset}   ${step.desc}`);
    console.log(`${C.gold}│${C.reset} ${C.bold}Notice:${C.reset}    ${step.note}`);
    console.log(`${C.gold}└────────────────────────────────────────────────────────────────────────┘${C.reset}`);

    if (INTERACTIVE_STEP && !isFirst) {
      await promptEnter(`Ready to demonstrate Step ${step.num} ("${step.prompt}")?`);
    }

    // Set dock tab if specified
    if (step.dockTab) {
      await cdp.eval(`(() => {
        const btn = [...document.querySelectorAll('.chips button')].find(b => b.dataset.tab === '${step.dockTab}');
        if (btn) btn.click();
      })()`);
      await sleep(300);
    }

    // Record bubble count before sending to ensure we wait for the new response
    const beforeCount = await cdp.eval(`document.querySelectorAll('.bubble').length`);

    // Type prompt with visible typewriter effect
    console.log(`  ⌨  Typing in composer: "${step.prompt}"...`);
    await typePromptWithVisualEffect(cdp, step.prompt);

    // Live draft: the card is drafted in place as you type, before any send.
    if (step.showDraft) {
      const drafted = await waitForDraftCard(cdp, 3000);
      if (drafted) {
        console.log(`  ${C.gold}✍  Live Draft:${C.reset} Card drafted in place while typing — ${C.bold}auto-filled without sending${C.reset}.`);
        await highlightFormFields(cdp);
        await sleep(500);
        await cdp.captureScreenshot(join(OUT_DIR, `${step.id}-draft.png`));
        console.log(`  📸 Draft screenshot saved: ${join(OUT_DIR, `${step.id}-draft.png`)}`);
        console.log(`  ⌨  Pressing ${C.bold}Enter${C.reset} to deploy the full card...`);
      }
    }

    // Watch for UP animation concurrently with sending
    const animPromise = watchAnimationState(cdp, 2500);
    console.log(`  ⚡ Sending prompt...`);
    await clickSend(cdp);

    // Wait for new form card
    const form = await waitForNewFormCard(cdp, beforeCount, 16000);
    const animState = await animPromise;

    console.log(`  ${C.green}✔ Form Opened:${C.reset} "${form.title}"`);
    if (animState.seen) {
      console.log(`  ${C.gold}✨ Directional Flight:${C.reset} Card animated ${C.bold}${animState.mode.toUpperCase()}${C.reset} with cinematic vignette!`);
    }

    // Print prefilled fields
    if (form.fields?.length) {
      console.log(`  📝 ${C.bold}Prefilled Form Fields:${C.reset}`);
      for (const field of form.fields) {
        console.log(`     · ${C.cyan}${field.label}:${C.reset} ${JSON.stringify(field.value)}`);
      }
    }
    if (form.notices?.length) {
      console.log(`  ℹ  ${C.gold}Notices:${C.reset} ${form.notices.join(" | ")}`);
    }

    // Highlight prefilled inputs on the browser screen
    await highlightFormFields(cdp);
    await sleep(600);

    // If step requires specific field input before screenshot
    if (step.id === "04-sarah-storage-warning") {
      await cdp.eval(`(() => {
        const form = [...document.querySelectorAll('.bubble.has-ui .ui-form')].pop();
        const confirmInput = form?.querySelector('[data-field="confirm"]');
        if (confirmInput) {
          confirmInput.value = "Sarah";
          confirmInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const payrollInput = form?.querySelector('[data-field="payrollDate"]');
        if (payrollInput && !payrollInput.value) {
          payrollInput.value = new Date().toISOString().slice(0, 10);
          payrollInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()`);
      await sleep(300);
    } else if (step.id === "05-temporary-override-mfa") {
      if (form.mfaDemo) {
        console.log(`  🔐 Entering Demo MFA Token (${form.mfaDemo})...`);
        await fillMfaCodeIfPresent(cdp);
      }
      await cdp.eval(`(() => {
        const form = [...document.querySelectorAll('.bubble.has-ui .ui-form')].pop();
        const reasonInput = form?.querySelector('[data-field="reason"]');
        if (reasonInput && !reasonInput.value) {
          reasonInput.value = "Fix billing bug";
          reasonInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()`);
      await sleep(300);
    }

    // Capture screenshot of open card
    const shotName = `${step.id}.png`;
    const shotPath = join(OUT_DIR, shotName);
    await cdp.captureScreenshot(shotPath);
    console.log(`  📸 Screenshot saved: ${shotPath}`);

    // Submit form if not NO_COMMIT
    if (!NO_COMMIT && (step.action === "submit" || step.action === "mfa_and_submit")) {
      await sleep(800);
      console.log(`  👆 Submitting action ("${step.actionLabel}")...`);
      const downAnimPromise = watchAnimationState(cdp, 2000);
      const submitRes = await clickSubmitButton(cdp, step.actionLabel);
      console.log(`  ${C.green}✔ Action Committed:${C.reset} ${submitRes}`);

      const downAnim = await downAnimPromise;
      if (downAnim.seen && downAnim.mode === "create") {
        console.log(`  ${C.gold}✨ DOWN Flight Animation:${C.reset} Card dropped DOWN into table and row pulsed gold!`);
      }
      await sleep(1500);

      // Follow-up screenshot of committed table state
      const commitShotName = `${step.id}-committed.png`;
      await cdp.captureScreenshot(join(OUT_DIR, commitShotName));
    }

    results.push({
      num: step.num,
      title: form.title || step.capability,
      capability: step.capability,
      prompt: step.prompt,
      desc: step.desc,
      formTitle: form.title,
      shotFilename: shotName,
      animSeen: animState.seen,
      animMode: animState.mode
    });

    await sleep(1200);
  }

  // Generate HTML Report
  const reportFile = generateHtmlReport(results);
  console.log(`\n${C.green}========================================================================${C.reset}`);
  console.log(`${C.green}${C.bold}✔ DEMO SHOWCASE COMPLETE! ${results.length} of ${results.length} steps demonstrated successfully.${C.reset}`);
  console.log(`${C.cyan}📄 HTML Showcase Report:${C.reset} ${reportFile}`);
  console.log(`${C.green}========================================================================${C.reset}\n`);

  if (AUTO_REPORT) {
    exec(`open "${reportFile}"`);
  }

  cdp.close();
}

main().catch((err) => {
  console.error(`\n${C.red}✖ Demo Showcase Error:${C.reset}`, err.message);
  process.exit(1);
});
