#!/usr/bin/env node
/**
 * Browser driver for Enterprise jev via Chrome DevTools Protocol.
 * Expects Chrome running with --remote-debugging-port=9222 on localhost:4731.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const CDP_HTTP = "http://127.0.0.1:9222";
const OUT = "/tmp/jev-browser-demo";
mkdirSync(OUT, { recursive: true });

const STEPS = [
  { id: "01-role", text: "Promote Dana to Admin", waitMs: 4500, note: "Choice: lasting role change" },
  { id: "02-group-vs-role", text: "Add Dana to the Admin team", waitMs: 4500, note: "Choice rubric: Admin team ≠ Admin role" },
  { id: "03-compound", text: "Can you add Cecil to the support team", waitMs: 4500, note: "Composition: create + assign" },
  { id: "04-override", text: "Give me superadmin access for 2 hours to fix the billing bug", waitMs: 5000, note: "Noul: temporary override" },
  { id: "05-storage-warn", text: "Hard-delete Sarah Chen", waitMs: 5000, note: "Storage warn-only on offboard" },
  { id: "06-rls", text: "Add an RLS policy so people only read their own profile", waitMs: 7000, note: "Escalation to OpenAI for USING" }
];

class Cdp {
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
      this.ws.addEventListener("open", () => resolve());
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

  close() {
    this.ws.close();
  }
}

async function findPage() {
  const list = await fetch(`${CDP_HTTP}/json/list`).then((r) => r.json());
  const page = list.find((item) => item.type === "page" && item.url.includes("localhost:4731"));
  if (!page) throw new Error("No Enterprise jev tab found on CDP. Open http://localhost:4731 in the debug Chrome.");
  return page;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const page = await findPage();
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url: "http://localhost:4731/" });
  await sleep(2000);

  const results = [];
  for (const step of STEPS) {
    console.log(`\n→ ${step.id}: ${step.note}`);
    console.log(`  prompt: ${step.text}`);

    // Clear composer and send
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const ta = document.querySelector('textarea');
        if (!ta) throw new Error('no composer');
        ta.value = ${JSON.stringify(step.text)};
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        const send = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Send');
        if (!send) throw new Error('no send');
        send.click();
        return true;
      })()`
    });

    await sleep(step.waitMs);

    const snapshot = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const bubbles = [...document.querySelectorAll('.bubble')];
        const last = bubbles[bubbles.length - 1];
        const form = last?.querySelector('.ui-form');
        const title = form?.querySelector('h3')?.textContent || null;
        const notices = [...(form?.querySelectorAll('.notice') || [])].map(n => n.textContent.trim());
        const fields = [...(form?.querySelectorAll('.field, .checks') || [])].map(f => {
          const label = f.querySelector('span, legend')?.textContent?.trim() || '';
          const input = f.querySelector('input:not([type=checkbox]), select, textarea');
          const checks = [...f.querySelectorAll('input[type=checkbox]:checked')].map(c => c.parentElement?.textContent?.trim());
          return { label, value: input ? input.value : (checks.length ? checks : null) };
        }).filter(f => f.label);
        const buttons = [...(form?.querySelectorAll('.modal-foot button, .ui-actions button') || [])].map(b => b.textContent.trim());
        const text = last?.querySelector('p')?.textContent?.trim() || '';
        return { role: last?.className || '', text, title, notices, fields, buttons, bubbleCount: bubbles.length };
      })()`,
      returnByValue: true
    });

    const info = snapshot.result?.value || {};
    console.log(`  card: ${info.title || "(none)"}`);
    if (info.notices?.length) console.log(`  notices: ${info.notices.join(" | ")}`);
    if (info.fields?.length) {
      for (const field of info.fields.slice(0, 6)) {
        console.log(`  · ${field.label}: ${JSON.stringify(field.value)}`);
      }
    }
    if (info.buttons?.length) console.log(`  buttons: ${info.buttons.join(" · ")}`);

    const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    const file = join(OUT, `${step.id}.png`);
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    console.log(`  screenshot: ${file}`);
    results.push({ ...step, ui: info, screenshot: file });
  }

  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  console.log(`\nSaved ${results.length} screenshots to ${OUT}`);
  cdp.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
