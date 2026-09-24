#!/usr/bin/env node
/** Quick visual check: UP (retrieve) and DOWN (create) fly-card appears. */
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = "/tmp/jev-anim-check";
mkdirSync(OUT, { recursive: true });

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
        if (msg.error) reject(new Error(msg.error.message));
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
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "eval failed");
    return result.result?.value;
  }
  close() { this.ws.close(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await fetch("http://127.0.0.1:9222/json/list").then((r) => r.json());
  const page = list.find((p) => p.type === "page" && p.url.includes("localhost:4731"));
  if (!page) throw new Error("No CDP page");
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url: "http://localhost:4731/?anim=1" });
  await sleep(1800);

  // UP: retrieve Dana
  await cdp.eval(`(() => {
    const ta = document.querySelector('textarea');
    ta.value = 'Promote Dana to Admin';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Send').click();
    return true;
  })()`);

  let sawUp = false;
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    const n = await cdp.eval(`document.querySelectorAll('.fly-card').length`);
    if (n > 0) { sawUp = true; break; }
  }
  const shotUp = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(`${OUT}/up.png`, Buffer.from(shotUp.data, "base64"));
  console.log("UP fly-card seen:", sawUp);

  await sleep(2000);

  // DOWN: create unique user then commit
  const name = `Anim${Date.now().toString(36).slice(-4)}`;
  await cdp.eval(`(() => {
    const ta = document.querySelector('textarea');
    ta.value = ${JSON.stringify(`add ${name} as a new user`)};
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Send').click();
    return true;
  })()`);
  await sleep(3500);

  // Fill and submit Add user — wait until submit is enabled
  const submitted = await cdp.eval(`(() => {
    const form = [...document.querySelectorAll('.ui-form')].pop();
    if (!form) return 'no-form';
    const nameInput = form.querySelector('[data-field=name]');
    const emailInput = form.querySelector('[data-field=email]');
    if (nameInput) { nameInput.value = ${JSON.stringify(name)}; nameInput.dispatchEvent(new Event('input', { bubbles: true })); }
    if (emailInput) { emailInput.value = ${JSON.stringify(`${name.toLowerCase()}@halden.example`)}; emailInput.dispatchEvent(new Event('input', { bubbles: true })); }
    form.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = form.querySelector('[type=submit]');
    if (!btn) return 'no-btn';
    btn.disabled = false;
    btn.click();
    return 'clicked';
  })()`);
  console.log("submit:", submitted);

  // Wait until the commit reply appears, then watch for the fly card / flag.
  let sawDown = false;
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    const state = await cdp.eval(`({
      flying: document.body.dataset.jevFlying || '',
      cards: document.querySelectorAll('.fly-card').length,
      added: [...document.querySelectorAll('.bubble.assistant p')].some(p => /Added /.test(p.textContent || ''))
    })`);
    if (state.flying === "create" || state.cards > 0) { sawDown = true; break; }
    if (i > 20 && !state.added) continue;
  }
  const shotDown = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(`${OUT}/down.png`, Buffer.from(shotDown.data, "base64"));
  console.log("DOWN fly-card seen:", sawDown);
  console.log("shots:", OUT);
  cdp.close();
  if (!sawUp || !sawDown) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
