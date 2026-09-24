const PROMPTS = [
  "Add Jenson to the Admin team",
  "Create a Platform group for on-call engineers",
  "Add an RLS policy so people only read their own profile",
  "Who can read invoices under the current policies?",
  "Show me Dana's profile and metadata",
  "Can you give me an export of support users as csv",
  "Export admins over 40 as CSV",
  "Remove Sarah next Friday after payroll clears, and route her direct reports to Alice.",
  "Promote Dana to Admin",
  "Give me superadmin access for 2 hours to fix the billing bug"
];

const TONES = ["#c46b4a", "#1f6a56", "#3d5a80", "#8a5a16", "#6b4c7a", "#3f6f4a"];
const DOCK_TABS = [
  { id: "users", label: "Users" },
  { id: "groups", label: "Groups" },
  { id: "rbac", label: "RBAC" },
  { id: "policies", label: "Policies" },
  { id: "rls", label: "RLS" }
];
const DOCK_MIN = 140;
const DOCK_MAX = 480;
const DOCK_DEFAULT = 220;

const state = {
  directory: null,
  health: null,
  view: "chat",
  messages: [
    {
      id: "welcome",
      role: "assistant",
      text: "Hi! I'm Enterprise Jev, your Enterprise SaaS co-pilot.\n\nDescribe the changes you'd like to make in plain English, and I'll automatically route the request and pre-fill the forms for you.\n\nTry asking me to:\n• **Manage onboarding:** \"Add Cecil to the support team.\"\n• **Update roles & groups:** \"Promote Dana to Admin.\"\n• **Request temporary access:** \"Give me superadmin access for 2 hours to fix billing.\"\n• **Handle deprovisioning:** \"Hard-delete Sarah Chen.\"\n• **Set security & RLS policies:** \"Add an RLS policy so users can only read their own profiles.\""
    }
  ],
  decisionId: null,
  pending: false,
  fresh: new Set(),
  query: "",
  dockTab: sessionStorage.getItem("dockTab") || "users",
  dockOpen: sessionStorage.getItem("dockOpen") !== "0",
  dockHeight: Number(sessionStorage.getItem("dockHeight")) || DOCK_DEFAULT
};

const nodes = {};

function h(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "value") node.value = value;
    else if (key === "checked") node.checked = Boolean(value);
    else if (key === "disabled") node.disabled = Boolean(value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const kid of [].concat(kids)) {
    if (kid == null || kid === false || kid === "") continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function uid() {
  return Math.random().toString(36).slice(2);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function saveFile(file) {
  const blob = new Blob([file.content], { type: file.mime || "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: file.filename || "export.csv" });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function tone(id) {
  const total = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return TONES[total % TONES.length];
}

function roleName(id) {
  return state.directory?.roles.find((role) => role.id === id)?.name || id;
}

function groupName(id) {
  return state.directory?.groups.find((group) => group.id === id)?.name || id;
}

function setDockTab(id) {
  state.dockTab = id;
  state.dockOpen = true;
  sessionStorage.setItem("dockTab", id);
  sessionStorage.setItem("dockOpen", "1");
  applyDockLayout();
  renderPeople();
}

function toggleDock() {
  state.dockOpen = !state.dockOpen;
  sessionStorage.setItem("dockOpen", state.dockOpen ? "1" : "0");
  applyDockLayout();
}

function applyDockLayout() {
  const app = nodes.app;
  if (!app) return;
  app.classList.toggle("dock-closed", !state.dockOpen);
  app.style.setProperty("--dock-height", `${Math.min(DOCK_MAX, Math.max(DOCK_MIN, state.dockHeight))}px`);
  if (nodes.dockToggle) {
    nodes.dockToggle.textContent = state.dockOpen ? "Hide" : "Show";
    nodes.dockToggle.setAttribute("aria-label", state.dockOpen ? "Hide directory panel" : "Show directory panel");
  }
  for (const chip of nodes.chips || []) {
    chip.classList.toggle("is-on", chip.dataset.tab === state.dockTab);
  }
}

function startDockResize(event) {
  if (!state.dockOpen) return;
  event.preventDefault();
  const origin = event.clientY;
  const start = state.dockHeight;
  const move = (next) => {
    state.dockHeight = Math.min(DOCK_MAX, Math.max(DOCK_MIN, start - (next.clientY - origin)));
    applyDockLayout();
  };
  const stop = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", stop);
    sessionStorage.setItem("dockHeight", String(state.dockHeight));
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", stop);
}

function mount() {
  const root = document.querySelector("#app");
  const search = h("input", {
    type: "search",
    placeholder: "Filter this panel",
    "aria-label": "Filter directory panel",
    onInput: (event) => {
      state.query = event.target.value;
      renderPeople();
    }
  });
  const composer = h("textarea", {
    rows: "1",
    placeholder: "Ask Enterprise jev",
    "aria-label": "Message"
  });
  composer.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      // If there's an active staged preview card, deploy it in full!
      const previewMsg = previewMessage();
      if (previewMsg && previewMsg.uiStatus === "open") {
        if (previewMsg.staged) {
          deployCard(previewMsg);
          return;
        }
        const form = nodes.log.querySelector(".bubble.has-ui .ui-form");
        if (form) {
          const submitBtn = form.querySelector("[type=submit], button.btn-primary, button.primary");
          if (submitBtn && !submitBtn.disabled) {
            submitBtn.click();
            return;
          }
        }
      }
      send(composer.value);
    } else if (event.key === "/" && !composer.value.trim()) {
      event.preventDefault();
      openReflexPalette();
    }
  });
  composer.addEventListener("input", () => {
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, 120)}px`;
    scheduleLivePreview();
  });

  nodes.tableNote = h("div", { class: "empty-note table-note" });
  nodes.dockTitle = h("span", { class: "count" }, "Users");
  nodes.overrides = h("div", { class: "overrides" });
  nodes.foot = h("div", { class: "foot" }, "");
  nodes.banner = h("div");
  nodes.log = h("div", { class: "log", "aria-live": "polite" });
  nodes.meta = h("div", { class: "topbar-actions" });
  nodes.send = h("button", {
    class: "primary send",
    type: "button",
    onClick: () => {
      const previewMsg = previewMessage();
      if (previewMsg && previewMsg.uiStatus === "open" && previewMsg.staged) {
        deployCard(previewMsg);
        return;
      }
      send(composer.value);
    }
  }, "Send");
  nodes.composer = composer;
  nodes.dockToggle = h("button", { class: "ghost icon-btn", type: "button", onClick: toggleDock }, "Hide");
  nodes.dockBody = h("div", { class: "term-body" });
  nodes.demoHud = h("div", { class: "demo-hud-host" });
  nodes.chips = DOCK_TABS.map((tab) => h("button", {
    class: "chip",
    type: "button",
    "data-tab": tab.id,
    onClick: () => setDockTab(tab.id)
  }, tab.label));

  nodes.navChat = h("button", {
    type: "button",
    class: "topbar-nav-btn is-active",
    onClick: () => setView("chat")
  }, [
    h("span", { class: "nav-icon" }, "💬"),
    h("span", {}, "Control Plane")
  ]);

  nodes.navExplainer = h("button", {
    type: "button",
    class: "topbar-nav-btn",
    onClick: () => setView("explainer")
  }, [
    h("span", { class: "nav-icon" }, "📖"),
    h("span", {}, "How Jev Works")
  ]);

  nodes.topbarNav = h("nav", { class: "topbar-nav", "aria-label": "Views" }, [
    nodes.navChat,
    nodes.navExplainer
  ]);

  nodes.chatView = h("main", { class: "chat", "aria-label": "Chat" }, [
    h("header", { class: "chat-bar" }, [
      h("h2", {}, "Chat"),
      nodes.foot
    ]),
    nodes.banner,
    nodes.demoHud,
    h("div", { class: "stage" }, [
      nodes.log,
      h("form", { class: "composer", onSubmit: (event) => event.preventDefault() }, [
        h("div", { class: "composer-box" }, [composer, nodes.send]),
        h("div", { class: "prompts" }, [
          h("button", {
            type: "button",
            class: "prompt-palette-btn",
            title: "Browse every Jev action (press /)",
            onClick: () => openReflexPalette()
          }, [h("span", { class: "prompt-palette-kbd" }, "/"), "All actions"]),
          ...PROMPTS.map((prompt) => h("button", {
            type: "button",
            onClick: () => send(prompt)
          }, prompt))
        ])
      ])
    ])
  ]);

  nodes.termResize = h("div", {
    class: "term-resize",
    role: "separator",
    "aria-orientation": "horizontal",
    "aria-label": "Resize directory panel",
    tabIndex: 0,
    onMouseDown: startDockResize
  });

  nodes.terminal = h("section", { class: "terminal", "aria-label": "Directory terminal" }, [
    h("div", { class: "term-bar" }, [
      h("div", { class: "chips", "aria-label": "Directory views" }, nodes.chips),
      h("label", { class: "search" }, search),
      nodes.dockToggle
    ]),
    nodes.overrides,
    nodes.dockBody,
    nodes.tableNote
  ]);

  nodes.explainerView = buildExplainerView();

  nodes.reflexHud = h("div", { class: "reflex-hud is-idle", "aria-hidden": "true" }, [
    h("span", { class: "reflex-hud-dot" }),
    h("span", { class: "reflex-hud-text" }, "System One · ready")
  ]);
  nodes.palette = h("div", { class: "reflex-palette", "aria-hidden": "true" });

  nodes.app = h("div", { class: "app" });

  nodes.app.append(
    h("header", { class: "topbar" }, [
      h("div", { class: "topbar-left" }, [
        h("div", { class: "brand" }, [
          h("div", { class: "kicker" }, "Directory control plane"),
          h("h1", {}, "Enterprise jev")
        ]),
        nodes.topbarNav
      ]),
      nodes.meta
    ]),
    nodes.chatView,
    nodes.termResize,
    nodes.terminal,
    nodes.explainerView,
    nodes.reflexHud,
    nodes.palette
  );
  root.append(nodes.app);
  applyDockLayout();
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (reflexPalette.open) {
        closeReflexPalette();
        return;
      }
      dismissUi(latestUiMessage());
    }
  });
}

function setView(view) {
  state.view = view;
  const isChat = view === "chat";
  if (nodes.navChat) nodes.navChat.classList.toggle("is-active", isChat);
  if (nodes.navExplainer) nodes.navExplainer.classList.toggle("is-active", !isChat);

  if (nodes.chatView) nodes.chatView.style.display = isChat ? "flex" : "none";
  if (nodes.termResize) nodes.termResize.style.display = isChat ? "" : "none";
  if (nodes.terminal) nodes.terminal.style.display = isChat ? "" : "none";
  if (nodes.explainerView) nodes.explainerView.style.display = isChat ? "none" : "block";
  if (nodes.reflexHud) nodes.reflexHud.style.display = isChat ? "" : "none";
  if (!isChat) closeReflexPalette();

  if (isChat) {
    applyDockLayout();
    renderLog();
  } else if (nodes.explainerView) {
    nodes.explainerView.scrollTop = 0;
  }
}

function tryPrompt(promptText) {
  const clean = String(promptText || "").trim().replace(/\.$/, "");
  if (state.view !== "chat") setView("chat");
  if (nodes.composer) {
    nodes.composer.value = clean;
    nodes.composer.focus();
  }
  send(clean);
}

function renderUseCaseRow(item) {
  return h("article", { class: "use-case-row" }, [
    h("div", { class: "use-case-meta" }, [
      h("span", { class: "use-case-category" }, item.category),
      h("span", { class: "use-case-badge" }, item.badge)
    ]),
    h("div", { class: "use-case-content" }, [
      h("h4", { class: "use-case-title" }, item.title),
      h("p", { class: "use-case-desc" }, item.desc),
      h("div", { class: "use-case-prompt" }, [
        h("span", { class: "prompt-label" }, "Prompt:"),
        h("code", { class: "prompt-code" }, `"${item.prompt}"`)
      ])
    ]),
    h("div", { class: "use-case-action" }, [
      h("button", {
        type: "button",
        class: "btn-try-use-case",
        title: `Try asking: "${item.prompt}"`,
        onClick: () => tryPrompt(item.prompt)
      }, [
        h("span", {}, "Try in Chat"),
        h("span", { class: "arrow" }, "→")
      ])
    ])
  ]);
}

function buildExplainerView() {
  const container = h("main", { class: "explainer-view", style: "display:none;", "aria-label": "How Enterprise Jev Works" });
  const inner = h("div", { class: "explainer-container" });

  const hero = h("section", { class: "explainer-hero" }, [
    h("div", { class: "explainer-kicker" }, "Architecture & Intent"),
    h("h2", { class: "explainer-title" }, "How Enterprise Jev Powers the Directory Control Plane"),
    h("p", { class: "explainer-lead" }, 
      "Enterprise Jev replaces fragmented, high-risk administrative forms with an ultra-fast System One classification layer. It connects human language to live directory state with zero-hallucination auto-fill, deterministic compliance guardrails, and directional UI motion."
    ),
    h("div", { class: "explainer-hero-actions" }, [
      h("button", {
        type: "button",
        class: "btn-explainer-primary",
        onClick: () => setView("chat")
      }, [
        h("span", {}, "💬 Open Control Plane"),
        h("span", { class: "arrow" }, "→")
      ]),
      h("button", {
        type: "button",
        class: "btn-explainer-secondary",
        onClick: () => {
          setView("chat");
          if (typeof window.toggleDemoTour === "function") window.toggleDemoTour();
        }
      }, [
        h("span", {}, "🎬 Launch Interactive Tour")
      ])
    ])
  ]);

  // Section 1: What It Intends to Do
  const intentSection = h("section", { class: "explainer-section" }, [
    h("div", { class: "section-header" }, [
      h("span", { class: "section-tag" }, "Purpose"),
      h("h3", {}, "What Enterprise Jev Intends to Do"),
      h("p", { class: "section-desc" }, 
        "Modern enterprise SaaS directories (Okta, Workday, Supabase, Google Workspace) force administrators through dozens of nested submenus. Enterprise Jev eliminates that friction through three architectural pillars:"
      )
    ]),
    h("div", { class: "explainer-grid three-col" }, [
      h("article", { class: "explainer-card" }, [
        h("div", { class: "card-icon" }, "⚡"),
        h("h4", {}, "Eliminate LLM Latency & Guesswork"),
        h("p", {}, "Generic LLMs (GPT-4 / Claude) take 2–5 seconds and attempt to parse JSON without schema context. Jev evaluates requests in parallel against a live directory snapshot in ~150ms, returning typed, probabilistic choices.")
      ]),
      h("article", { class: "explainer-card" }, [
        h("div", { class: "card-icon" }, "🛡️"),
        h("h4", {}, "Enforce Hard Compliance Gates"),
        h("p", {}, "Offboarding a user requires payroll cycle synchronization. Deleting a manager requires direct-report reassignment. Temporary superadmin access enforces time bounds and authenticator MFA challenges.")
      ]),
      h("article", { class: "explainer-card" }, [
        h("div", { class: "card-icon" }, "✍️"),
        h("h4", {}, "Zero Re-typing (Read-then-Write)"),
        h("p", {}, "Every card opens 100% pre-filled with live record state, inferred defaults (e.g. emails, roles, group squads), and exact deltas. The operator only verifies and confirms with a single click.")
      ])
    ])
  ]);

  // Section 2: Dual-Engine Pipeline (System One + System Two)
  const pipelineSection = h("section", { class: "explainer-section" }, [
    h("div", { class: "section-header" }, [
      h("span", { class: "section-tag" }, "Architecture"),
      h("h3", {}, "Dual-Engine Pipeline: System One Meets System Two"),
      h("p", { class: "section-desc" }, 
        "Enterprise Jev splits cognitive work between an ultra-fast instinctual classifier and a generative language worker."
      )
    ]),
    h("div", { class: "pipeline-diagram" }, [
      h("div", { class: "pipeline-step" }, [
        h("div", { class: "pipeline-step-badge" }, "Step 1"),
        h("h4", {}, "Natural Language Request"),
        h("p", {}, "Operator sends plain English instruction (e.g., 'Promote Dana to Admin' or 'Add Cecil to the support team').")
      ]),
      h("div", { class: "pipeline-arrow" }, "➔"),
      h("div", { class: "pipeline-step is-highlight" }, [
        h("div", { class: "pipeline-step-badge s1-badge" }, "System One (Jev) ~150ms"),
        h("h4", {}, "Parallel Typed Classification"),
        h("p", {}, "Evaluates 15 structured questions in parallel against live directory records: Intent Choice, Risk Score, and Noul Truth Gates.")
      ]),
      h("div", { class: "pipeline-arrow" }, "➔"),
      h("div", { class: "pipeline-split" }, [
        h("div", { class: "pipeline-substep" }, [
          h("span", { class: "badge-s1" }, "90%+ of Requests"),
          h("h5", {}, "Deterministic Rule Engine"),
          h("p", {}, "Forms are auto-filled and validated locally without generative LLM overhead.")
        ]),
        h("div", { class: "pipeline-substep" }, [
          h("span", { class: "badge-s2" }, "needs_generation >= 0.7"),
          h("h5", {}, "System Two (OpenAI)"),
          h("p", {}, "Invoked only for creative drafting (e.g. PostgreSQL RLS SQL expressions or group charters).")
        ])
      ]),
      h("div", { class: "pipeline-arrow" }, "➔"),
      h("div", { class: "pipeline-step" }, [
        h("div", { class: "pipeline-step-badge" }, "Step 3"),
        h("h4", {}, "Deterministic Commit & Audit"),
        h("p", {}, "Operator verifies the pre-filled modal. Gateway asserts schema, logs immutable audit trail, and applies live state.")
      ])
    ])
  ]);

  // Section 3: The Three Question Types Jev Evaluates
  const questionsSection = h("section", { class: "explainer-section" }, [
    h("div", { class: "section-header" }, [
      h("span", { class: "section-tag" }, "Jev Schema"),
      h("h3", {}, "The Three Question Types Evaluated by Jev"),
      h("p", { class: "section-desc" }, 
        "Jev rejects ambiguous open-ended tokens in favor of three mathematically grounded, typed question constructs:"
      )
    ]),
    h("div", { class: "explainer-grid three-col" }, [
      h("article", { class: "explainer-card question-card" }, [
        h("div", { class: "question-header" }, [
          h("span", { class: "pill-type" }, "Choice"),
          h("h4", {}, "Disambiguation & Routing")
        ]),
        h("p", {}, "Selects one option from a strictly defined categorical set with associated confidence scores."),
        h("ul", { class: "explainer-bullets" }, [
          h("li", {}, [h("strong", {}, "primary_intent: "), "Routes across 12 screens (add_user, edit_rbac, delete_user, manage_rls, etc.)"]),
          h("li", {}, [h("strong", {}, "target_group vs target_role: "), "Accurately distinguishes between group squads (e.g., 'Admin team') and lasting RBAC roles (e.g., 'Admin') without confusing permissions."]),
          h("li", {}, [h("strong", {}, "subject_user: "), "Identifies existing records or unmapped candidate names."])
        ])
      ]),
      h("article", { class: "explainer-card question-card" }, [
        h("div", { class: "question-header" }, [
          h("span", { class: "pill-type score-type" }, "Score"),
          h("h4", {}, "Calibrated Risk Severity")
        ]),
        h("p", {}, "Calculates operational and security impact on a calibrated 4-level scale (low, medium, high, critical)."),
        h("ul", { class: "explainer-bullets" }, [
          h("li", {}, [h("strong", {}, "Low: "), "Routine changes like group or squad additions."]),
          h("li", {}, [h("strong", {}, "Medium: "), "Role promotions and reporting line updates."]),
          h("li", {}, [h("strong", {}, "High: "), "Inactivating accounts or expanding privileges."]),
          h("li", {}, [h("strong", {}, "Critical: "), "Offboarding, hard-deleting users, or granting break-glass superadmin access."])
        ])
      ]),
      h("article", { class: "explainer-card question-card" }, [
        h("div", { class: "question-header" }, [
          h("span", { class: "pill-type noul-type" }, "Noul"),
          h("h4", {}, "Probabilistic Truth Gates (0.0 – 1.0)")
        ]),
        h("p", {}, "Calibrated binary truth probabilities that activate safety gates when crossing NOUL_GATE = 0.70."),
        h("ul", { class: "explainer-bullets" }, [
          h("li", {}, [h("strong", {}, "payroll_dependency: "), "Enforces payroll cutoff verification on offboarding."]),
          h("li", {}, [h("strong", {}, "requires_manager_reassignment: "), "Prevents orphaned direct reports."]),
          h("li", {}, [h("strong", {}, "is_temporary_override: "), "Detects break-glass elevation requiring MFA."]),
          h("li", {}, [h("strong", {}, "check_duplicate: "), "Flags existing inactive profiles to offer reactivation."]),
          h("li", {}, [h("strong", {}, "needs_generation: "), "Triggers System Two for SQL drafting."])
        ])
      ])
    ])
  ]);

  // Section 4: Interactive Use Cases
  const useCasesSection = h("section", { class: "explainer-section" }, [
    h("div", { class: "section-header" }, [
      h("span", { class: "section-tag" }, "Live Capabilities"),
      h("h3", {}, "Explore Core Use Cases"),
      h("p", { class: "section-desc" }, 
        "Click any action below to switch into the Control Plane and watch Jev execute the flow with pre-filled forms and directional motion."
      )
    ]),
    h("div", { class: "use-case-list" }, [
      renderUseCaseRow({
        id: "live-draft",
        category: "Draft as You Type",
        badge: "Live Preview → Deploy",
        prompt: "update Dana's role to admin",
        title: "Live Draft Preview & One-Key Deploy",
        desc: "The instant a request is recognized, the matching card is drafted in place — the right person, action, and values auto-filled — while a loader runs into it. Press Enter once to open the full, editable card; press Enter again to commit. Nothing is submitted until you decide.",
        motion: "Draft resolves in place, then opens in full"
      }),
      renderUseCaseRow({
        id: "onboard",
        category: "Manage Onboarding",
        badge: "Compound Add",
        prompt: "Add Cecil to the support team",
        title: "Compound Provisioning (Add Cecil to Support)",
        desc: "Cecil doesn't exist yet. Jev detects this, folds user creation and Support squad assignment into a single pre-filled form. On save, the card drops DOWN into the directory table with a gold landing pulse.",
        motion: "Drops DOWN into directory table"
      }),
      renderUseCaseRow({
        id: "roles",
        category: "Update Roles & Groups",
        badge: "Entity Disambiguation",
        prompt: "Promote Dana to Admin",
        title: "Role Elevation vs. Squad Membership",
        desc: "Jev knows 'Admin' as a lasting RBAC role is separate from the 'Admin team' operational squad. Prompts targeting the squad pre-check the group; prompts targeting promotion open the lasting role form.",
        motion: "Lifts UP from directory table"
      }),
      renderUseCaseRow({
        id: "override",
        category: "Temporary Access",
        badge: "Noul + MFA Gate",
        prompt: "Give me superadmin access for 2 hours to fix billing",
        title: "Break-Glass Elevation with Authenticator MFA",
        desc: "Evaluates is_temporary_override (0.98 probability). Never grants permanent superadmin; locks the duration window to 2 hours and presents a real-time authenticator MFA code challenge.",
        motion: "Opens elevated MFA card"
      }),
      renderUseCaseRow({
        id: "offboard",
        category: "Deprovisioning",
        badge: "Payroll & Manager Gating",
        prompt: "Hard-delete Sarah Chen",
        title: "Offboarding with Strict Downstream Dependency Checks",
        desc: "Sarah manages Marcus and Leo. Jev flags requires_manager_reassignment and payroll_dependency. The offboarding card cannot be submitted until a successor manager and payroll run date are selected.",
        motion: "Gated confirmation card"
      }),
      renderUseCaseRow({
        id: "rls",
        category: "Security & RLS",
        badge: "Hybrid S1 + S2",
        prompt: "Add an RLS policy so users can only read their own profiles",
        title: "Row-Level Security Policy Drafting with OpenAI",
        desc: "Jev classifies manage_rls and triggers needs_generation (0.92). OpenAI drafts the Postgres SQL USING expression (auth.uid() = id) on public.profiles, pre-filling the security policy card.",
        motion: "Auto-fills SQL policy card"
      })
    ])
  ]);

  // Section 5: Directional Motion & Prefill Philosophy
  const motionSection = h("section", { class: "explainer-section" }, [
    h("div", { class: "section-header" }, [
      h("span", { class: "section-tag" }, "UX Philosophy"),
      h("h3", {}, "Directional Data Motion & Seamless Prefill"),
      h("p", { class: "section-desc" }, 
        "Motion in Enterprise Jev is not decorative—it communicates data flow between the persistent directory store and active conversation."
      )
    ]),
    h("div", { class: "explainer-grid two-col" }, [
      h("article", { class: "explainer-card motion-card" }, [
        h("div", { class: "motion-header" }, [
          h("span", { class: "motion-badge up" }, "↑ Retrieval Motion"),
          h("h4", {}, "Existing Data Lifts UP into Chat")
        ]),
        h("p", {}, "When an existing user, squad, or policy is referenced, data flies UP from the directory dock into the chat card with a subtle cinematic backdrop. The card mirrors the live record so the operator only adjusts the deltas.")
      ]),
      h("article", { class: "explainer-card motion-card" }, [
        h("div", { class: "motion-header" }, [
          h("span", { class: "motion-badge down" }, "↓ Creation Motion"),
          h("h4", {}, "New Records Drop DOWN into the Directory")
        ]),
        h("p", {}, "When a new identity is provisioned (like Cecil), confirming the card animates it DOWN from the chat into the directory table, landing on the newly created row with an amber gold landing pulse.")
      ])
    ])
  ]);

  // Section 6: Live API Questions Schema Preview
  const schemaSection = h("section", { class: "explainer-section" }, [
    h("div", { class: "section-header" }, [
      h("span", { class: "section-tag" }, "API Schema"),
      h("h3", {}, "Live Payload Sent to /v1/systemone"),
      h("p", { class: "section-desc" }, 
        "Every message dispatches this typed JSON payload to the Jev System One engine. All questions are evaluated simultaneously in one fast network round-trip."
      )
    ]),
    h("pre", { class: "schema-code-block" }, [
      h("code", {}, `{
  "model": "jev-latest",
  "state": {
    "message": "Remove Sarah next Friday after payroll clears, and route her direct reports to Alice.",
    "directory": [
      { "id": "sarah_chen", "name": "Sarah Chen", "role": "admin", "reports": ["marcus_hale", "leo_park"] },
      { "id": "alice_okonkwo", "name": "Alice Okonkwo", "role": "admin", "status": "active" }
    ]
  },
  "questions": {
    "primary_intent": {
      "type": "Choice",
      "options": ["add_user", "edit_rbac", "override_rbac", "update_manager", "edit_groups", "delete_user", "manage_rls", ...],
      "instructions": "Identify the primary user management action requested in the state."
    },
    "risk_severity": {
      "type": "Score",
      "levels": ["low", "medium", "high", "critical"],
      "instructions": "Score security and operational risk. Overriding RBAC or deleting users is critical."
    },
    "payroll_dependency": {
      "type": "Noul",
      "statement": "This request involves offboarding or terminating a user, which must be synchronized with a final payroll cycle."
    },
    "requires_manager_reassignment": {
      "type": "Noul",
      "statement": "The requested action removes or inactivates a user who manages direct reports, requiring their team to be reassigned."
    },
    "is_temporary_override": {
      "type": "Noul",
      "statement": "This request asks for a temporary elevation of permissions or a time-bound access override."
    },
    "check_duplicate": {
      "type": "Noul",
      "statement": "This request provisions a new user and requires checking against existing identities."
    }
  }
}`)
    ])
  ]);

  // Footer Banner
  const footerBanner = h("div", { class: "explainer-footer-cta" }, [
    h("h3", {}, "Ready to test Enterprise Jev?"),
    h("p", {}, "Switch back to the Control Plane to execute directory actions, or launch the self-guided Demo Tour."),
    h("div", { class: "footer-cta-actions" }, [
      h("button", {
        type: "button",
        class: "btn-explainer-primary",
        onClick: () => setView("chat")
      }, "💬 Return to Control Plane"),
      h("button", {
        type: "button",
        class: "btn-explainer-secondary",
        onClick: () => {
          setView("chat");
          if (typeof window.toggleDemoTour === "function") window.toggleDemoTour();
        }
      }, "🎬 Launch Demo Tour")
    ])
  ]);

  inner.append(
    hero,
    intentSection,
    pipelineSection,
    questionsSection,
    useCasesSection,
    motionSection,
    schemaSection,
    footerBanner
  );
  container.append(inner);

  return container;
}

function matchesQuery(text) {
  const query = state.query.trim().toLowerCase();
  return !query || String(text).toLowerCase().includes(query);
}

function renderPeople() {
  const directory = state.directory;
  nodes.dockBody.replaceChildren();
  nodes.tableNote.replaceChildren();
  if (!directory) return;
  const tab = DOCK_TABS.find((item) => item.id === state.dockTab) || DOCK_TABS[0];
  nodes.dockTitle.textContent = tab.label;
  if (state.dockTab === "users") renderUsersDock(directory);
  else if (state.dockTab === "groups") renderGroupsDock(directory);
  else if (state.dockTab === "rbac") renderRbacDock(directory);
  else if (state.dockTab === "policies") renderPoliciesDock(directory, { expressions: false });
  else renderPoliciesDock(directory, { expressions: true });

  nodes.overrides.replaceChildren();
  for (const override of directory.overrides) {
    const when = new Date(override.expiresAt).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
    nodes.overrides.append(h("div", { class: "override" }, [
      h("p", {}, `Superadmin for ${override.subjectName} until ${when}.`),
      h("p", { class: "meta" }, override.reason),
      h("button", { type: "button", onClick: revoke }, "Revoke")
    ]));
  }
}

function renderUsersDock(directory) {
  const rank = { active: 0, inactive: 1, offboarded: 2 };
  const visible = directory.users
    .filter((user) => matchesQuery(`${user.name} ${user.email} ${user.title} ${user.role} ${user.status} ${(user.groups || []).map(groupName).join(" ")}`))
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.name.localeCompare(b.name));
  nodes.dockTitle.textContent = `Users · ${visible.length}`;
  const body = h("tbody");
  for (const user of visible) {
    const banned = user.bannedUntil && new Date(user.bannedUntil) > new Date();
    body.append(h("tr", { class: state.fresh.has(user.id) ? "is-fresh" : "", "data-person": user.id }, [
      h("td", {}, [
        h("div", { class: "who" }, [
          h("div", { class: "avatar", style: `background:${tone(user.id)}` }, initials(user.name)),
          h("div", {}, [h("strong", {}, user.name), h("div", { class: "meta" }, user.title)])
        ])
      ]),
      h("td", {}, roleName(user.role)),
      h("td", {}, (user.groups || []).map(groupName).join(", ") || "—"),
      h("td", {}, h("span", { class: `status status-${user.status}` }, user.status)),
      h("td", {}, banned ? "Banned" : user.managerName || "—")
    ]));
  }
  nodes.dockBody.append(h("div", { class: "table-wrap" }, h("table", { class: "user-table" }, [
    h("thead", {}, h("tr", {}, [h("th", {}, "Person"), h("th", {}, "Role"), h("th", {}, "Groups"), h("th", {}, "Status"), h("th", {}, "Notes")])),
    body
  ])));
  if (!visible.length) nodes.tableNote.append("No one matches.");
}

function renderGroupsDock(directory) {
  const queryHits = directory.groups.filter((group) => matchesQuery(`${group.name} ${group.detail} ${group.id}`));
  nodes.dockTitle.textContent = `Groups · ${queryHits.length}`;
  const list = h("div", { class: "term-grid" });
  for (const group of queryHits) {
    const members = directory.users.filter((user) => user.status === "active" && user.groups.includes(group.id));
    list.append(h("article", { class: "term-card" }, [
      h("strong", {}, group.name),
      h("div", { class: "meta" }, group.detail),
      h("div", { class: "meta" }, members.length ? members.map((user) => user.name).join(", ") : "No active members")
    ]));
  }
  nodes.dockBody.append(list);
  if (!queryHits.length) nodes.tableNote.append("No groups match.");
}

function renderRbacDock(directory) {
  const roles = directory.roles.filter((role) => matchesQuery(`${role.name} ${role.detail} ${role.id}`));
  nodes.dockTitle.textContent = `RBAC · ${roles.length}`;
  const list = h("div", { class: "term-grid" });
  for (const role of roles) {
    const holders = directory.users.filter((user) => user.role === role.id);
    list.append(h("article", { class: "term-card" }, [
      h("strong", {}, role.name),
      h("div", { class: "meta" }, role.detail),
      h("div", { class: "meta" }, holders.length ? holders.map((user) => `${user.name} (${user.status})`).join(", ") : "No holders")
    ]));
  }
  nodes.dockBody.append(list);
  if (!roles.length) nodes.tableNote.append("No roles match.");
}

function renderPoliciesDock(directory, { expressions }) {
  const policies = (directory.policies || []).filter((policy) => matchesQuery(`${policy.name} ${policy.table} ${policy.command} ${policy.grantee} ${policy.usingExpr}`));
  nodes.dockTitle.textContent = `${expressions ? "RLS" : "Policies"} · ${policies.length}`;
  const body = h("tbody");
  for (const policy of policies) {
    body.append(h("tr", { "data-policy": policy.id }, [
      h("td", {}, policy.name),
      h("td", {}, `${commandLabel(policy.command)} · ${policy.table}`),
      h("td", {}, policy.grantee),
      h("td", {}, expressions ? h("code", {}, policy.usingExpr || "—") : (policy.enabled ? "Enabled" : "Disabled")),
      expressions ? h("td", {}, h("code", {}, policy.withCheck || "—")) : h("td", {}, policy.usingExpr || "—")
    ]));
  }
  const heads = expressions
    ? [h("th", {}, "Policy"), h("th", {}, "On"), h("th", {}, "Grantee"), h("th", {}, "USING"), h("th", {}, "WITH CHECK")]
    : [h("th", {}, "Policy"), h("th", {}, "Command"), h("th", {}, "Applies to"), h("th", {}, "State"), h("th", {}, "USING")];
  nodes.dockBody.append(h("div", { class: "table-wrap" }, h("table", { class: "user-table" }, [
    h("thead", {}, h("tr", {}, heads)),
    body
  ])));
  if (!policies.length) nodes.tableNote.append("No policies match.");
}

function commandLabel(id) {
  return ({ select: "SELECT", insert: "INSERT", update: "UPDATE", delete: "DELETE", all: "ALL" })[id] || id;
}

function renderBanner() {
  nodes.banner.replaceChildren();
  if (!state.health || state.health.configured) return;
  nodes.banner.append(h("div", { class: "banner" }, "Set TYPESAFE_API_KEY in .env and restart to classify messages with Jev."));
  nodes.foot.textContent = "The API key stays on the server. It is not set yet.";
}

function renderMeta() {
  nodes.meta.className = "topbar-actions";
  nodes.meta.replaceChildren(
    h("div", { class: "topbar-status", title: "Jev System One classification active" }, [
      h("span", { class: "status-dot" }),
      h("span", {}, "Jev System One Active")
    ]),
    h("button", {
      type: "button",
      class: "btn-demo-tour",
      id: "btn-demo-tour",
      title: "Play interactive walkthrough of Jev capabilities",
      onClick: () => {
        if (typeof window.toggleDemoTour === "function") window.toggleDemoTour();
      }
    }, [
      h("span", { class: "demo-dot" }),
      h("span", {}, window.__demoRunning ? "Stop Tour" : "🎬 Demo Tour")
    ])
  );
}

function parseInlineFormatting(text) {
  const parts = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|"([^"]+)")/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(h("strong", {}, token.slice(2, -2)));
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(h("code", {}, token.slice(1, -1)));
    } else if (token.startsWith('"') && token.endsWith('"')) {
      const promptText = token.slice(1, -1);
      if (promptText.length >= 6) {
        parts.push(h("button", {
          type: "button",
          class: "bubble-prompt-chip",
          title: `Click to try: "${promptText}"`,
          onClick: (e) => {
            e.preventDefault();
            tryPrompt(promptText);
          }
        }, `"${promptText}"`));
      } else {
        parts.push(token);
      }
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length ? parts : [text];
}

function formatMessageContent(text) {
  if (!text) return [];
  const lines = text.split("\n");
  const elements = [];
  let currentList = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      currentList = null;
      continue;
    }

    if (line.startsWith("• ") || line.startsWith("- ")) {
      if (!currentList) {
        currentList = h("ul", { class: "bubble-list" });
        elements.push(currentList);
      }
      const itemText = line.slice(2);
      currentList.append(h("li", {}, parseInlineFormatting(itemText)));
    } else {
      currentList = null;
      elements.push(h("p", { class: "bubble-p" }, parseInlineFormatting(line)));
    }
  }
  return elements;
}

function renderLog() {
  const stick = nodes.log.scrollHeight - nodes.log.scrollTop - nodes.log.clientHeight < 80;
  nodes.log.replaceChildren(...state.messages.map(renderMessage));
  if (stick) nodes.log.scrollTop = nodes.log.scrollHeight;
  const card = nodes.log.querySelector(".bubble.has-ui:last-of-type .ui-form");
  card?.scrollIntoView({ block: "nearest" });
}

function renderMessage(message) {
  // Suppress conversational paragraph when a structured UI card is present (except initial welcome)
  // because the card already clearly communicates the target, action, and fields.
  const content = (message.preview || message.staged || (message.ui && message.id !== "welcome")) ? [] : formatMessageContent(message.text);
  const article = h("article", {
    class: `bubble ${message.role}${message.ui || message.staged ? " has-ui" : ""}${message.preview ? " is-preview" : ""}${message.staged ? " is-staged" : ""}${message.deploying ? " is-deploying" : ""}`
  });
  if (content.length) {
    article.append(h("div", { class: "bubble-prose" }, content));
  }
  if (message.id === "welcome") {
    article.append(h("div", { class: "welcome-footer" }, [
      h("button", {
        type: "button",
        class: "btn-welcome-explainer",
        onClick: () => setView("explainer")
      }, [
        h("span", { class: "icon" }, "📖"),
        h("span", {}, "How Enterprise Jev is built with System One models →")
      ])
    ]));
  }
  if (message.pending && message.staged && !message.ui) {
    article.append(renderPendingCard(message));
  } else if (message.ui) {
    if (message.uiStatus !== "dismissed") {
      article.append(renderUiCard(message));
    } else {
      article.append(h("div", { class: "ui-card-superseded" }, [
        h("span", { class: "superseded-badge" }, "Closed"),
        h("span", { class: "superseded-title" }, message.ui.title || "Form closed")
      ]));
    }
  }
  return article;
}

function renderPendingCard(message) {
  const user = message.targetUser;
  return h("div", { class: "ui-form is-staged is-evaluating" }, [
    h("div", { class: "card-topbar" }, [
      h("div", { class: "card-topbar-left" }, [
        h("div", { class: "card-preview-pill" }, [
          h("span", { class: "preview-pulse-dot" }),
          h("span", { class: "preview-title" }, "Live preview"),
          h("span", { class: "preview-ms" }, "Evaluating…")
        ])
      ])
    ]),
    h("div", { class: "card-loader-container" }, [
      h("div", { class: "card-loader-bar" }, [
        h("div", { class: "card-loader-fill" })
      ]),
      h("div", { class: "card-loader-meta" }, [
        h("span", { class: "card-loader-status" }, [
          h("span", { class: "pulse-bolt" }, "⚡"),
          h("span", {}, "Reading your request…")
        ]),
        h("span", { class: "card-loader-hint" }, "Preparing…")
      ])
    ]),
    h("div", { class: "card-title-block" }, [
      h("h3", { class: "card-title" }, user ? `Preparing action for ${user.name.split(" ")[0]}` : "Analyzing request…")
    ]),
    user
      ? h("div", { class: "entity-card" }, [
          h("div", { class: "avatar", style: `background:${tone(user.id)}` }, initials(user.name)),
          h("div", { class: "entity-info" }, [
            h("div", { class: "entity-name-row" }, [
              h("strong", { class: "entity-name" }, user.name),
              h("span", { class: `status status-${user.status}` }, user.status),
              h("span", { class: "entity-role-pill" }, roleName(user.role))
            ]),
            h("div", { class: "entity-meta" }, `${user.title || "Team member"}${(user.groups || []).length ? ` · ${(user.groups || []).map(groupName).join(", ")}` : ""}`)
          ])
        ])
      : null,
    h("div", { class: "staged-fields" }, [
      h("div", { class: "staged-field-box is-shimmer" }, [
        h("span", { class: "staged-field-val" }, "Resolving System One permissions & intent…")
      ])
    ])
  ]);
}

function renderStagedField(field, user) {
  if (field.name === "subjectId") return null;

  let displayValue = "";
  let priorValue = "";

  if (field.type === "select") {
    const opt = (field.options || []).find((o) => o.value === field.value);
    displayValue = opt ? opt.label : field.value || "—";
    if (field.name === "role" && user) {
      priorValue = roleName(user.role);
    }
  } else if (field.type === "multiselect") {
    const vals = Array.isArray(field.value) ? field.value : [];
    displayValue = vals.map(groupName).join(", ") || "None";
  } else if (field.type === "mfa") {
    displayValue = "6-digit Authenticator verification required";
  } else if (field.type === "static") {
    displayValue = field.display || field.value || "—";
  } else {
    displayValue = field.value || field.placeholder || "Pending input";
  }

  return h("div", { class: "staged-field-row" }, [
    h("div", { class: "staged-field-meta" }, [
      h("span", { class: "staged-field-label" }, field.label || field.name),
      h("span", { class: "staged-field-tag" }, "Auto-filled")
    ]),
    h("div", { class: "staged-field-box" }, [
      h("span", { class: "staged-field-val" }, displayValue),
      priorValue && priorValue !== displayValue
        ? h("span", { class: "staged-field-prior" }, [
            h("span", { class: "prior-arrow" }, "←"),
            h("span", {}, `Was: ${priorValue}`)
          ])
        : null
    ])
  ]);
}

async function deployCard(message) {
  if (!message) return;
  message.deploying = true;
  renderLog();

  const promptText = nodes.composer ? nodes.composer.value.trim() : "";
  if (nodes.composer) {
    nodes.composer.value = "";
    nodes.composer.style.height = "auto";
  }

  // Brief pause so the loader bar visibly snaps to 100% with the flash
  await new Promise((resolve) => setTimeout(resolve, 200));

  message.staged = false;
  message.deploying = false;
  message.preview = false;

  const idx = state.messages.indexOf(message);
  const userText = promptText || message.ui?.source || "";
  if (idx >= 0 && userText) {
    state.messages.splice(idx, 0, { id: uid(), role: "user", text: userText });
  }
  message.id = uid();
  livePreview.subjectId = null;
  livePreview.key = null;

  renderLog();
  renderMeta();

  // Focus the first actionable control in the deployed form
  const latestForm = nodes.log.querySelector(".bubble.has-ui:last-of-type .ui-form");
  if (latestForm) {
    const focusable = latestForm.querySelector("select, input:not([type=hidden]), textarea, button.btn-primary");
    if (focusable) focusable.focus();
  }
}

function latestUiMessage() {
  return [...state.messages].reverse().find((item) => item.ui && item.uiStatus === "open") || null;
}

function dismissUi(message) {
  if (!message || message.uiStatus !== "open") return;
  if (message.preview) {
    cancelLivePreview();
    nodes.composer.focus();
    return;
  }
  message.uiStatus = "dismissed";
  renderLog();
  nodes.composer.focus();
}

function persistForm(form, ui) {
  const data = readForm(form);
  for (const field of ui.fields || []) {
    if (!field.name) continue;
    if (field.type === "multiselect") field.value = data[field.name] || [];
    else if (data[field.name] != null) field.value = data[field.name];
  }
}

function renderUiCard(message) {
  const ui = message.ui;
  const inactive = message.uiStatus === "done";
  const error = h("div", { class: "form-error", role: "alert" });
  const form = h("form", {
    class: `ui-form${message.preview ? " is-preview" : ""}${message.staged ? " is-staged" : ""}${message.deploying ? " is-deploying" : ""}`,
    autocomplete: "off",
    onSubmit: (event) => {
      event.preventDefault();
      if (message.uiStatus !== "open") return;
      if (message.staged) {
        deployCard(message);
        return;
      }
      const button = [...ui.buttons].find((item) => item.id === event.submitter?.dataset.button) || ui.buttons.find((item) => !item.forceIntent);
      if (!button || button.forceIntent) return;
      persistForm(form, ui);
      commit(message, button.id, readForm(form), error);
    },
    onInput: () => {
      error.textContent = "";
      persistForm(form, ui);
      syncButtons(form, ui, message);
    }
  });

  const subjectVal = (ui.fields || []).find((f) => f.name === "subjectId")?.value;
  const user = subjectVal ? (state.directory?.users || []).find((u) => u.id === subjectVal) : null;

  // Top header bar: integrates live preview reflex info, signal chips, and close button into one cohesive bar
  const topBar = h("div", { class: "card-topbar" }, [
    h("div", { class: "card-topbar-left" }, [
      message.preview || message.staged
        ? h("div", { class: "card-preview-pill" }, [
            h("span", { class: "preview-pulse-dot" }),
            h("span", { class: "preview-title" }, "Live preview"),
            message.trace?.latencyMs ? h("span", { class: "preview-ms" }, `${Math.round(message.trace.latencyMs)}ms`) : null
          ])
        : inactive
          ? h("span", { class: "card-done-pill" }, [
              h("span", { class: "done-check" }, "✓"),
              h("span", {}, "Applied")
            ])
          : h("span", { class: "card-kind-pill" }, "Action"),
      (message.preview || message.staged) ? renderReflexSignals(message) : null
    ]),
    h("div", { class: "card-topbar-right" }, [
      message.staged
        ? h("span", { class: "card-key-hint" }, [
            h("kbd", {}, "↵"),
            h("span", {}, "Enter to deploy")
          ])
        : message.uiStatus === "open"
          ? h("span", { class: "card-key-hint" }, [
              h("kbd", {}, "↵"),
              h("span", {}, "Enter to confirm")
            ])
          : null,
      message.uiStatus === "open"
        ? h("button", { class: "card-close-btn", type: "button", "aria-label": "Dismiss", onClick: () => dismissUi(message) }, "×")
        : null
    ])
  ]);

  // Loader bar running into the card (when staged or deploying)
  const loaderBlock = (message.staged || message.deploying)
    ? h("div", { class: `card-loader-container${message.deploying ? " is-deploying" : ""}` }, [
        h("div", { class: "card-loader-bar" }, [
          h("div", { class: `card-loader-fill${message.deploying ? " is-deploying" : ""}` })
        ]),
        h("div", { class: "card-loader-meta" }, [
          h("span", { class: "card-loader-status" }, [
            h("span", { class: "pulse-bolt" }, "⚡"),
            h("span", {}, message.deploying ? "Opening the full card…" : "Draft ready · press Enter to open the full card")
          ]),
          h("span", { class: "card-loader-hint" }, "Hit ↵ Enter to deploy")
        ])
      ])
    : null;

  // Clean title: If the person entity card is shown, streamline "Edit role for Dana" -> "Edit role"
  const cleanTitle = user ? ui.title.replace(/\s+for\s+.*$/i, "") : ui.title;
  const titleBlock = h("div", { class: "card-title-block" }, [
    h("h3", { class: "card-title" }, cleanTitle)
  ]);

  // Filter redundant notices
  const filteredNotices = (ui.notices || []).filter((notice) => {
    if (user && notice.text.includes(`${user.name} is currently`)) return false;
    return true;
  });

  const noticesBlock = filteredNotices.length
    ? h("div", { class: "card-notices" }, filteredNotices.map((notice) =>
        h("div", { class: `card-notice ${notice.tone}` }, [
          h("span", { class: "notice-icon" }, notice.tone === "danger" ? "⚠️" : notice.tone === "warning" ? "⚠️" : "ℹ️"),
          h("span", { class: "notice-text" }, notice.text)
        ])
      ))
    : null;

  // Entity card in staged mode
  const stagedEntityBlock = message.staged && user
    ? h("div", { class: "entity-card" }, [
        h("div", { class: "avatar", style: `background:${tone(user.id)}` }, initials(user.name)),
        h("div", { class: "entity-info" }, [
          h("div", { class: "entity-name-row" }, [
            h("strong", { class: "entity-name" }, user.name),
            h("span", { class: `status status-${user.status}` }, user.status),
            h("span", { class: "entity-role-pill" }, roleName(user.role))
          ]),
          h("div", { class: "entity-meta" }, `${user.title || "Team member"}${(user.groups || []).length ? ` · ${(user.groups || []).map(groupName).join(", ")}` : ""}`)
        ]),
        h("input", { type: "hidden", "data-field": "subjectId", value: user.id })
      ])
    : null;

  // Staged fields vs Full interactive fields
  const fieldsBlock = message.staged
    ? h("div", { class: "staged-fields" }, (ui.fields || []).map((f) => renderStagedField(f, user)).filter(Boolean))
    : h("div", { class: "fields" }, (ui.fields || []).map(renderField));

  const footBlock = message.staged
    ? h("div", { class: "modal-foot is-staged" }, [
        h("button", { class: "btn-ghost ghost", type: "button", onClick: () => dismissUi(message) }, "Cancel"),
        h("button", {
          class: "btn-primary primary btn-deploy",
          type: "button",
          onClick: () => deployCard(message)
        }, [
          h("span", {}, "Deploy card in full"),
          h("kbd", { class: "btn-kbd" }, "↵")
        ])
      ])
    : message.uiStatus === "open"
      ? h("div", { class: "modal-foot" }, [
          h("button", { class: "btn-ghost ghost", type: "button", onClick: () => dismissUi(message) }, "Cancel"),
          h("div", { class: "ui-actions" }, ui.buttons.map((button) => h("button", {
            class: button.tone === "danger" ? "btn-danger danger" : button.tone === "secondary" ? "btn-ghost ghost" : "btn-primary primary",
            type: button.forceIntent ? "button" : "submit",
            "data-button": button.id,
            onClick: button.forceIntent ? () => force(message, button.forceIntent) : null
          }, [
            h("span", {}, button.label),
            !button.forceIntent ? h("kbd", { class: "btn-kbd" }, "↵") : null
          ])))
        ])
      : h("div", { class: "card-committed-foot" }, [
          h("span", { class: "committed-check" }, "✓"),
          h("span", { class: "committed-note" }, "Committed to directory")
        ]);

  const cardElements = [
    topBar,
    loaderBlock,
    titleBlock,
    stagedEntityBlock,
    noticesBlock,
    fieldsBlock,
    error,
    footBlock
  ].filter(Boolean);

  form.append(...cardElements);
  if (inactive) {
    form.querySelectorAll("input, select, textarea, button").forEach((node) => {
      node.disabled = true;
    });
  } else if (!message.staged) {
    syncButtons(form, ui, message);
  }
  return form;
}

function renderField(field) {
  // If static and it's a person subject, render the rich entity card
  if (field.type === "static" && field.name === "subjectId") {
    const user = (state.directory?.users || []).find((u) => u.id === field.value);
    if (user) {
      return h("div", { class: "entity-card" }, [
        h("div", { class: "avatar", style: `background:${tone(user.id)}` }, initials(user.name)),
        h("div", { class: "entity-info" }, [
          h("div", { class: "entity-name-row" }, [
            h("strong", { class: "entity-name" }, user.name),
            h("span", { class: `status status-${user.status}` }, user.status),
            h("span", { class: "entity-role-pill" }, roleName(user.role))
          ]),
          h("div", { class: "entity-meta" }, `${user.title || "Team member"}${(user.groups || []).length ? ` · ${(user.groups || []).map(groupName).join(", ")}` : ""}`)
        ]),
        field.name ? h("input", { type: "hidden", "data-field": field.name, value: field.value ?? "" }) : null
      ]);
    }
  }

  if (field.type === "static") {
    return h("div", { class: "field-static" }, [
      h("span", { class: "field-label" }, field.label),
      h("div", { class: "static-value" }, field.display),
      field.name ? h("input", { type: "hidden", "data-field": field.name, value: field.value ?? "" }) : null
    ]);
  }

  if (field.type === "multiselect") {
    return h("fieldset", { class: "checks" }, [
      h("legend", {}, field.label),
      h("div", { class: "checks-grid" }, (field.options || []).map((option) => h("label", { class: "check-pill" }, [
        h("input", {
          type: "checkbox",
          "data-field": field.name,
          "data-multi": "true",
          value: option.value,
          checked: (field.value || []).includes(option.value)
        }),
        h("span", {}, option.label)
      ]))),
      field.hint ? h("div", { class: "hint" }, field.hint) : null
    ]);
  }

  if (field.type === "mfa") {
    return h("label", { class: "field" }, [
      h("span", {}, field.label),
      h("div", { class: "authenticator" }, [
        h("span", {}, "Demo authenticator"),
        h("strong", {}, field.demoCode)
      ]),
      h("input", {
        class: "field-input field-code",
        "data-field": field.name,
        inputmode: "numeric",
        maxlength: "6",
        placeholder: field.placeholder || "6-digit code",
        autocomplete: "one-time-code",
        value: field.value || ""
      })
    ]);
  }

  const control = field.type === "select"
    ? h("div", { class: "select-wrap" }, [
        h("select", { "data-field": field.name, class: "field-select" }, (field.options || []).map((option) => {
          const node = h("option", { value: option.value }, option.label);
          if (String(option.value) === String(field.value ?? "")) node.selected = true;
          return node;
        })),
        h("span", { class: "select-caret", "aria-hidden": "true" }, "▾")
      ])
    : field.type === "textarea"
      ? h("textarea", {
          class: "field-textarea",
          "data-field": field.name,
          rows: "3",
          placeholder: field.placeholder || "",
          value: field.value || ""
        })
    : h("input", {
        class: "field-input",
        "data-field": field.name,
        type: field.type === "date" ? "date" : "text",
        value: field.value || "",
        placeholder: field.placeholder || (field.type === "confirm" ? field.match : ""),
        "data-match": field.match || ""
      });

  return h("label", { class: "field" }, [
    h("span", {}, field.label),
    control,
    field.hint ? h("div", { class: "hint" }, field.hint) : null
  ]);
}

function readForm(form) {
  const data = {};
  form.querySelectorAll("[data-field]").forEach((node) => {
    const name = node.dataset.field;
    if (node.dataset.multi === "true") {
      if (!Array.isArray(data[name])) data[name] = [];
      if (node.checked) data[name].push(node.value);
      return;
    }
    data[name] = node.value;
  });
  return data;
}

function fieldReady(field, data) {
  if (!field.required) return true;
  const value = data[field.name];
  if (field.type === "multiselect") return Array.isArray(value) && value.length > 0;
  if (field.type === "confirm") return String(value || "").trim().toLowerCase() === String(field.match || "").toLowerCase();
  if (field.type === "mfa") return /^\d{6}$/.test(value || "");
  return String(value || "").trim().length > 0;
}

function syncButtons(form, ui, message) {
  const data = readForm(form);
  const ready = (ui.fields || []).every((field) => fieldReady(field, data));
  form.querySelectorAll("[type=submit]").forEach((button) => {
    button.disabled = !ready || state.pending && state.decisionId === message.decisionId;
  });
}

function attachUi(message, data) {
  for (const item of state.messages) {
    if (item !== message && item.uiStatus === "open") item.uiStatus = "dismissed";
  }
  message.text = data.reply;
  message.decisionId = data.decisionId;
  message.ui = data.modal;
  message.uiStatus = data.modal ? "open" : null;
  state.decisionId = data.decisionId;
}

async function send(text) {
  const message = text.trim();
  if (!message || state.pending) return;

  // If there's an active staged preview card, hitting send/Enter deploys it directly!
  const previewMsg = previewMessage();
  if (previewMsg && previewMsg.uiStatus === "open" && previewMsg.staged) {
    await deployCard(previewMsg);
    return;
  }

  cancelLivePreview();
  nodes.composer.value = "";
  nodes.composer.style.height = "auto";
  state.pending = true;
  state.messages.push({ id: uid(), role: "user", text: message });
  nodes.send.disabled = true;

  // Immediately put the right card with a loader running into it!
  const targetUser = detectTransientSubject(message);
  const pendingId = uid();
  const pendingCard = {
    id: pendingId,
    role: "assistant",
    pending: true,
    staged: true,
    deploying: false,
    targetUser: targetUser || null,
    text: "",
    ui: null,
    uiStatus: "open"
  };
  state.messages.push(pendingCard);
  renderLog();

  let opened = null;
  try {
    const data = await api("/api/chat", { method: "POST", body: JSON.stringify({ text: message }) });
    attachUi(pendingCard, data);
    pendingCard.trace = data.trace;
    updateReflexHud(data.trace);
    opened = data;

    // Brief smooth loader finish
    pendingCard.deploying = true;
    pendingCard.pending = false;
    renderLog();
    await new Promise((r) => setTimeout(r, 180));

    // Deploy in full!
    pendingCard.staged = false;
    pendingCard.deploying = false;
    renderLog();
  } catch (error) {
    state.messages = state.messages.filter((item) => item.id !== pendingId);
    state.messages.push({ id: uid(), role: "error", text: error.message });
  } finally {
    state.pending = false;
    nodes.send.disabled = false;
    renderLog();
    renderMeta();
    if (opened) setTimeout(() => playEditIntakeAnimation(opened), 80);
  }
}

async function force(message, intent) {
  if (!message.decisionId || state.pending) return;
  state.pending = true;
  state.decisionId = message.decisionId;
  renderLog();
  let opened = null;
  try {
    const data = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ decisionId: message.decisionId, forceIntent: intent })
    });
    attachUi(message, data);
    message.trace = data.trace;
    updateReflexHud(data.trace);
    opened = data;
  } catch (error) {
    state.messages.push({ id: uid(), role: "error", text: error.message });
  } finally {
    state.pending = false;
    renderLog();
    if (opened) setTimeout(() => playEditIntakeAnimation(opened), 80);
  }
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function afterLayout(fn) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

function rectOf(node) {
  if (!node || !(node instanceof Element)) return null;
  try {
    node.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {
    /* ignore */
  }
  const rect = node.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  return rect;
}

function terminalAnchorRect() {
  return rectOf(nodes.dockBody) || rectOf(document.querySelector(".terminal")) || {
    left: window.innerWidth / 2 - 120,
    top: window.innerHeight - 120,
    width: 240,
    height: 48,
    right: window.innerWidth / 2 + 120,
    bottom: window.innerHeight - 72
  };
}

function chatAnchorRect() {
  const form = [...nodes.log.querySelectorAll(".bubble.has-ui .ui-form")].pop();
  const bubble = [...nodes.log.querySelectorAll(".bubble.assistant")].pop();
  return rectOf(form) || rectOf(bubble) || {
    left: 48,
    top: 160,
    width: 320,
    height: 120,
    right: 368,
    bottom: 280
  };
}

function openUsersDock() {
  state.dockTab = "users";
  state.dockOpen = true;
  state.query = "";
  const search = document.querySelector(".search input");
  if (search) search.value = "";
  sessionStorage.setItem("dockTab", "users");
  sessionStorage.setItem("dockOpen", "1");
  applyDockLayout();
  renderPeople();
}

function openPoliciesDock() {
  state.dockTab = "policies";
  state.dockOpen = true;
  state.query = "";
  const search = document.querySelector(".search input");
  if (search) search.value = "";
  sessionStorage.setItem("dockTab", "policies");
  sessionStorage.setItem("dockOpen", "1");
  applyDockLayout();
  renderPeople();
}

function userPayload(user) {
  return {
    avatar: initials(user.name),
    avatarColor: tone(user.id),
    title: user.name,
    subtitle: user.title || roleName(user.role),
    badge: user.status,
    badgeClass: `status status-${user.status}`
  };
}

function policyPayload(policy) {
  return {
    glyph: "RLS",
    title: policy.name,
    subtitle: `${commandLabel(policy.command)} · ${policy.table}`,
    badge: policy.enabled ? "Enabled" : "Disabled",
    badgeClass: "status status-active"
  };
}

function buildFlyCard(payload, mode) {
  return h("div", { class: `fly-card fly-${mode}`, style: "z-index:10000" }, [
    payload.avatar
      ? h("div", { class: "avatar", style: `background:${payload.avatarColor}` }, payload.avatar)
      : h("div", { class: "fly-card-glyph" }, payload.glyph || "§"),
    h("div", { class: "fly-card-info" }, [
      h("strong", {}, payload.title),
      payload.subtitle ? h("div", { class: "fly-card-meta" }, payload.subtitle) : null,
      payload.badge ? h("span", { class: payload.badgeClass || "status" }, payload.badge) : null
    ])
  ]);
}

function showCinemaBackdrop(duration) {
  const backdrop = h("div", { class: "cinema-backdrop", style: "z-index:9990" });
  document.body.append(backdrop);
  backdrop.animate(
    [{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 1, offset: 0.78 }, { opacity: 0 }],
    { duration, easing: "ease-in-out", fill: "both" }
  ).finished.then(() => backdrop.remove()).catch(() => backdrop.remove());
}

function flyBetween(fromRect, toRect, payload, mode, delay = 0) {
  const card = buildFlyCard(payload, mode);
  document.body.append(card);
  document.body.dataset.jevFlying = mode;
  const cw = card.offsetWidth || 244;
  const ch = card.offsetHeight || 72;
  const fromCX = fromRect.left + fromRect.width / 2;
  const fromCY = fromRect.top + fromRect.height / 2;
  const toCX = toRect.left + toRect.width / 2;
  const toCY = toRect.top + toRect.height / 2;
  card.style.left = `${fromCX - cw / 2}px`;
  card.style.top = `${fromCY - ch / 2}px`;
  const dx = toCX - fromCX;
  const dy = toCY - fromCY;
  // Keep keyframes to transform + opacity only — more reliable across browsers.
  const cinema = mode === "edit";
  const frames = cinema
    ? [
        { transform: "translate(0,0) scale(0.92) rotate(2deg)", opacity: 0 },
        { offset: 0.18, transform: `translate(${dx * 0.12}px, ${dy * 0.12}px) scale(1.08) rotate(0deg)`, opacity: 1 },
        { offset: 0.78, transform: `translate(${dx * 0.9}px, ${dy * 0.9}px) scale(1.02) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.88) rotate(0deg)`, opacity: 0 }
      ]
    : [
        { transform: "translate(0,0) scale(0.75) rotate(-3deg)", opacity: 0 },
        { offset: 0.14, transform: `translate(${dx * 0.1}px, ${dy * 0.1}px) scale(1.05) rotate(0deg)`, opacity: 1 },
        { offset: 0.72, transform: `translate(${dx * 0.88}px, ${dy * 0.88}px) scale(1) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.84) rotate(0deg)`, opacity: 0 }
      ];
  const duration = cinema ? 1200 : 1100;
  const anim = card.animate(frames, {
    duration,
    delay,
    easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    fill: "both"
  });
  const clear = () => {
    card.remove();
    if (document.body.dataset.jevFlying === mode) delete document.body.dataset.jevFlying;
  };
  anim.finished.then(clear).catch(clear);
  return duration + delay;
}

function pulseRow(row) {
  if (!row) return;
  row.classList.remove("row-land");
  void row.offsetWidth;
  row.classList.add("row-land");
  setTimeout(() => row.classList.remove("row-land"), 1200);
}

function pulseCard(card) {
  if (!card) return;
  card.classList.remove("form-intake");
  void card.offsetWidth;
  card.classList.add("form-intake");
  setTimeout(() => card.classList.remove("form-intake"), 1100);
}

// New / provisioned user: data flows DOWN from the chat into the terminal table.
function playCommitAnimation(affected, beforeIds, { forceDown = false } = {}) {
  if (prefersReducedMotion() || !state.directory) return;
  const ids = (affected || []).filter((id) => forceDown || !beforeIds.has(id));
  if (!ids.length) return;

  openUsersDock();
  setTimeout(() => {
    const chatRect = chatAnchorRect();
    let delay = 0;
    for (const id of ids) {
      const user = state.directory.users.find((item) => item.id === id);
      if (!user) continue;
      const row = nodes.dockBody.querySelector(`[data-person="${CSS.escape(id)}"]`);
      const rowRect = rectOf(row) || terminalAnchorRect();
      const span = flyBetween(chatRect, rowRect, userPayload(user), "create", delay);
      if (row) setTimeout(() => pulseRow(row), Math.max(0, span - 220));
      delay += 140;
    }
  }, 140);
}

function modalFieldValue(modal, name) {
  const field = (modal?.fields || []).find((item) => item.name === name);
  return field ? field.value : null;
}

// Existing user/policy retrieved into chat: data flows UP from the terminal into the card.
const EDIT_USER_SCREENS = new Set([
  "edit_rbac", "edit_groups", "update_manager", "edit_metadata",
  "ban_user", "inactivate_user", "delete_user", "view_user", "override_rbac"
]);

function playEditIntakeAnimation(data) {
  if (prefersReducedMotion() || !state.directory || !data || !data.modal) return;
  const screen = data.action?.screen || data.trace?.screen;

  const runFly = (from, to, payload) => {
    const span = flyBetween(from, to, payload, "edit");
    showCinemaBackdrop(span);
    const formCard = [...nodes.log.querySelectorAll(".bubble.has-ui .ui-form")].pop();
    setTimeout(() => pulseCard(formCard), Math.max(0, span - 280));
  };

  if (EDIT_USER_SCREENS.has(screen)) {
    const subjectId = data.action?.subjectId || modalFieldValue(data.modal, "subjectId");
    if (!subjectId || subjectId === "operator") return;
    const user = state.directory.users.find((item) => item.id === subjectId);
    if (!user) return;
    openUsersDock();
    // Wait for dock paint, then fly UP from the row (or terminal) into the chat card.
    setTimeout(() => {
      const row = nodes.dockBody.querySelector(`[data-person="${CSS.escape(user.id)}"]`);
      const from = rectOf(row) || terminalAnchorRect();
      const to = chatAnchorRect();
      runFly(from, to, userPayload(user));
    }, 140);
    return;
  }

  if (screen === "manage_rls") {
    const policyId = modalFieldValue(data.modal, "policyId");
    const policy = policyId ? (state.directory.policies || []).find((item) => item.id === policyId) : null;
    if (!policy) return;
    openPoliciesDock();
    setTimeout(() => {
      const row = nodes.dockBody.querySelector(`[data-policy="${CSS.escape(policy.id)}"]`);
      const from = rectOf(row) || terminalAnchorRect();
      const to = chatAnchorRect();
      runFly(from, to, policyPayload(policy));
    }, 140);
  }
}

// ---------------------------------------------------------------------------
// Live card preview: because Jev resolves intent + subject at reflex speed, we
// classify the half-typed request and hold the FULL, pre-filled card open in
// the chat as the operator types — no Enter required. The matched record lifts
// UP from the directory the first time a new subject appears in the card.
// ---------------------------------------------------------------------------
const PREVIEW_ID = "live-preview";
const livePreview = { timer: null, token: 0, key: null, subjectId: null };

const TRANSIENT_ACTION_CUE = /\b(update|promote|demote|add|remove|delete|offboard|inactivate|deactivate|reactivate|ban|unban|edit|change|move|reassign|assign|grant|give|view|show|lookup|manage|set)\b/i;

function detectTransientSubject(text) {
  if (!text || !state.directory) return null;
  const trimmed = text.trim();
  if (trimmed.length < 4 || !TRANSIENT_ACTION_CUE.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();

  // Prefer a full-name hit; fall back to a unique first-name hit.
  for (const user of state.directory.users) {
    if (user.status === "offboarded") continue;
    if (lower.includes(user.name.toLowerCase())) return user;
  }
  const firstNameHits = state.directory.users.filter((user) => {
    if (user.status === "offboarded") return false;
    const first = user.name.toLowerCase().split(/\s+/)[0];
    return new RegExp(`\\b${first}\\b`, "i").test(lower);
  });
  return firstNameHits.length === 1 ? firstNameHits[0] : null;
}

function previewMessage() {
  return state.messages.find((item) => item.id === PREVIEW_ID && item.preview);
}

function scheduleLivePreview() {
  if (livePreview.timer) clearTimeout(livePreview.timer);
  livePreview.timer = setTimeout(runLivePreview, 240);
}

async function runLivePreview() {
  livePreview.timer = null;
  if (state.pending || window.__demoRunning) return;
  const text = nodes.composer.value.trim();
  const user = detectTransientSubject(text);
  if (!user) {
    clearLivePreview();
    return;
  }
  const key = text.toLowerCase();
  if (key === livePreview.key && previewMessage()) return; // already showing this exact request
  const token = ++livePreview.token;
  let data;
  try {
    data = await api("/api/chat", { method: "POST", body: JSON.stringify({ text }) });
  } catch {
    return; // network hiccup — leave any existing preview untouched
  }
  if (token !== livePreview.token) return; // superseded by newer keystrokes
  if (!data.modal) {
    clearLivePreview();
    return;
  }
  livePreview.key = key;
  applyLivePreview(data);
}

function applyLivePreview(data) {
  const prevSubject = livePreview.subjectId;
  const newSubject = data.action?.subjectId || null;

  // Dismiss any unrelated open cards so only the live preview stays active.
  for (const item of state.messages) {
    if (item.id !== PREVIEW_ID && item.uiStatus === "open") item.uiStatus = "dismissed";
  }

  let msg = previewMessage();
  if (!msg) {
    msg = { id: PREVIEW_ID, role: "assistant", preview: true, staged: true, deploying: false };
    state.messages.push(msg);
  } else {
    if (msg.preview) msg.staged = true;
  }
  msg.text = data.reply;
  msg.decisionId = data.decisionId;
  msg.ui = data.modal;
  msg.uiStatus = "open";
  msg.trace = data.trace;
  // Gate the Noul flags with hysteresis so signal chips don't flicker as you type.
  const activeFlags = gateFlags(data.trace || {});
  msg.signals = (data.trace?.flags || []).filter((flag) => activeFlags.has(flag.id));
  state.decisionId = data.decisionId;
  renderLog();
  renderMeta();
  updateReflexHud(data.trace);

  livePreview.subjectId = newSubject;
  // Fly the record UP the first time a fresh subject lands in the card.
  if (newSubject && newSubject !== prevSubject && newSubject !== "operator") {
    setTimeout(() => playEditIntakeAnimation(data), 60);
  }
}

function clearLivePreview() {
  livePreview.key = null;
  livePreview.subjectId = null;
  reflexGate.on = new Set();
  const before = state.messages.length;
  state.messages = state.messages.filter((item) => !(item.id === PREVIEW_ID && item.preview));
  if (state.messages.length !== before) {
    renderLog();
    renderMeta();
  }
}

// Cancel any in-flight preview without leaving a stray card (used before a real send).
function cancelLivePreview() {
  if (livePreview.timer) {
    clearTimeout(livePreview.timer);
    livePreview.timer = null;
  }
  livePreview.token++;
  clearLivePreview();
}

// ---------------------------------------------------------------------------
// Jev Reflex HUD: an always-on, bottom-right readout of the last classification
// — latency, question fan-out, model, and detected intent — mirroring how Jev
// answers ~24 typed questions in a single ~150ms call. Updated on every live
// preview and every committed turn.
// ---------------------------------------------------------------------------
function updateReflexHud(trace) {
  if (!nodes.reflexHud || !trace) return;
  const ms = trace.latencyMs != null ? `${Math.round(trace.latencyMs)}ms` : "—";
  const q = trace.questions != null ? `${trace.questions}q` : null;
  const model = trace.model || state.health?.model || "jev";
  const intent = trace.intent?.label ? ` · ${trace.intent.label}` : "";
  const text = [ms, q, model].filter(Boolean).join(" · ") + intent;
  nodes.reflexHud.querySelector(".reflex-hud-text").textContent = text;

  const level = trace.risk?.id || null;
  nodes.reflexHud.className = `reflex-hud is-live${level ? ` risk-${level}` : ""}`;
  // Retrigger the flash animation.
  void nodes.reflexHud.offsetWidth;
  nodes.reflexHud.classList.add("flash");
  setTimeout(() => nodes.reflexHud && nodes.reflexHud.classList.remove("flash"), 420);
}

// ---------------------------------------------------------------------------
// Live compliance signals: Jev's risk score + Noul truth-gates lit up as you
// type. Hysteresis (on ≥ 0.7, off ≤ 0.5) keeps the badges from flickering
// between keystrokes — inspired by Shapeshift's calm-UI signal band.
// ---------------------------------------------------------------------------
const NOUL_ON = 0.7;
const NOUL_OFF = 0.5;
const reflexGate = { on: new Set() };

function gateFlags(trace) {
  const next = new Set();
  for (const flag of trace.flags || []) {
    const value = Number(flag.value) || 0;
    if (value >= NOUL_ON) next.add(flag.id);
    else if (value > NOUL_OFF && reflexGate.on.has(flag.id)) next.add(flag.id);
  }
  reflexGate.on = next;
  return next;
}

function renderReflexSignals(message) {
  const trace = message.trace;
  if (!trace) return null;
  const chips = [];
  if (trace.intent?.label) {
    chips.push(h("span", { class: "reflex-chip reflex-intent" }, [
      h("span", { class: "reflex-chip-k" }, "intent"),
      h("span", {}, trace.intent.label)
    ]));
  }
  if (trace.risk?.label) {
    chips.push(h("span", { class: `reflex-chip reflex-risk risk-${trace.risk.id || "low"}` }, [
      h("span", { class: "reflex-chip-k" }, "risk"),
      h("span", {}, trace.risk.label)
    ]));
  }
  for (const flag of message.signals || []) {
    chips.push(h("span", { class: "reflex-chip reflex-flag is-on" }, [
      h("span", { class: "reflex-flag-dot" }),
      flag.label
    ]));
  }
  return chips.length ? h("div", { class: "reflex-signals", role: "status", "aria-label": "Live signals" }, chips) : null;
}

// ---------------------------------------------------------------------------
// "/" Command palette: a keyboard-summoned gallery of every Jev action, each
// with an example prompt that drops into the composer and fires the live
// preview — an override and a discovery surface in one.
// ---------------------------------------------------------------------------
const REFLEX_ACTIONS = [
  { icon: "👤", label: "Add user", cat: "Provisioning", ex: "Add Priya to the support team" },
  { icon: "🧩", label: "Edit groups", cat: "Membership", ex: "Add Marcus to the billing team" },
  { icon: "⬆️", label: "Edit role", cat: "RBAC", ex: "Promote Dana to Admin" },
  { icon: "⏱️", label: "Temporary override", cat: "Break-glass", ex: "Give me superadmin access for 2 hours to fix billing" },
  { icon: "🔗", label: "Update manager", cat: "Org", ex: "Reassign Dana's reports to Alice" },
  { icon: "⏸️", label: "Inactivate", cat: "Lifecycle", ex: "Inactivate Marcus for a security review" },
  { icon: "🚫", label: "Ban user", cat: "Lifecycle", ex: "Ban Leo for 24 hours" },
  { icon: "🗑️", label: "Offboard / delete", cat: "Deprovisioning", ex: "Hard-delete Sarah Chen after payroll" },
  { icon: "🔍", label: "View profile", cat: "Directory", ex: "Show me Dana's profile and metadata" },
  { icon: "✏️", label: "Edit metadata", cat: "Directory", ex: "Set Dana's last name to Ruiz" },
  { icon: "📤", label: "Export users", cat: "Directory", ex: "Export support users under 30 as CSV" },
  { icon: "➕", label: "Create group", cat: "Groups", ex: "Create a Platform group for on-call engineers" },
  { icon: "🛡️", label: "Manage RLS", cat: "Security", ex: "Add an RLS policy so users can only read their own profiles" },
  { icon: "❓", label: "Explain access", cat: "Security", ex: "Who can read invoices under the current policies?" }
];

const reflexPalette = { open: false, index: 0, filter: "" };

function filteredReflexActions() {
  const f = reflexPalette.filter.trim().toLowerCase();
  if (!f) return REFLEX_ACTIONS;
  return REFLEX_ACTIONS.filter((a) => `${a.label} ${a.cat} ${a.ex}`.toLowerCase().includes(f));
}

function openReflexPalette() {
  if (reflexPalette.open || state.view !== "chat") return;
  reflexPalette.open = true;
  reflexPalette.index = 0;
  reflexPalette.filter = "";

  const input = h("input", {
    class: "reflex-palette-input",
    type: "text",
    placeholder: "Filter Jev actions — e.g. 'delete', 'rls', 'promote'",
    "aria-label": "Filter Jev actions"
  });
  input.addEventListener("input", () => {
    reflexPalette.filter = input.value;
    reflexPalette.index = 0;
    renderReflexPaletteList();
  });
  input.addEventListener("keydown", onReflexPaletteKey);

  nodes.paletteList = h("div", { class: "reflex-palette-list" });

  const panel = h("div", { class: "reflex-palette-panel", role: "dialog", "aria-label": "Action palette" }, [
    h("div", { class: "reflex-palette-head" }, [
      h("span", { class: "reflex-palette-kbd" }, "/"),
      h("span", {}, "Actions — pick one to pre-fill the composer")
    ]),
    input,
    nodes.paletteList,
    h("div", { class: "reflex-palette-foot" }, "↑ ↓ navigate · Enter insert · Esc close")
  ]);
  const backdrop = h("div", { class: "reflex-palette-backdrop", onClick: () => closeReflexPalette() });

  nodes.palette.replaceChildren(backdrop, panel);
  nodes.palette.classList.add("is-open");
  nodes.palette.setAttribute("aria-hidden", "false");
  renderReflexPaletteList();
  input.focus();
}

function closeReflexPalette() {
  if (!reflexPalette.open) return;
  reflexPalette.open = false;
  nodes.palette.replaceChildren();
  nodes.palette.classList.remove("is-open");
  nodes.palette.setAttribute("aria-hidden", "true");
  if (state.view === "chat") nodes.composer.focus();
}

function renderReflexPaletteList() {
  if (!nodes.paletteList) return;
  const list = filteredReflexActions();
  if (reflexPalette.index >= list.length) reflexPalette.index = Math.max(0, list.length - 1);
  if (!list.length) {
    nodes.paletteList.replaceChildren(
      h("div", { class: "reflex-palette-empty" }, "No action matches. Try 'role', 'group', or 'rls'.")
    );
    return;
  }
  nodes.paletteList.replaceChildren(
    ...list.map((action, i) =>
      h("button", {
        type: "button",
        class: `reflex-palette-item${i === reflexPalette.index ? " is-active" : ""}`,
        onMousedown: (event) => event.preventDefault(),
        onClick: () => pickReflexAction(action)
      }, [
        h("span", { class: "reflex-palette-icon" }, action.icon),
        h("span", { class: "reflex-palette-meta" }, [
          h("span", { class: "reflex-palette-label" }, action.label),
          h("span", { class: "reflex-palette-ex" }, action.ex)
        ]),
        h("span", { class: "reflex-palette-cat" }, action.cat)
      ])
    )
  );
  const active = nodes.paletteList.querySelector(".reflex-palette-item.is-active");
  active?.scrollIntoView({ block: "nearest" });
}

function onReflexPaletteKey(event) {
  const list = filteredReflexActions();
  if (event.key === "ArrowDown") {
    event.preventDefault();
    reflexPalette.index = Math.min(list.length - 1, reflexPalette.index + 1);
    renderReflexPaletteList();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    reflexPalette.index = Math.max(0, reflexPalette.index - 1);
    renderReflexPaletteList();
  } else if (event.key === "Enter") {
    event.preventDefault();
    const action = list[reflexPalette.index];
    if (action) pickReflexAction(action);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeReflexPalette();
  }
}

function pickReflexAction(action) {
  closeReflexPalette();
  nodes.composer.value = action.ex;
  nodes.composer.focus();
  nodes.composer.style.height = "auto";
  nodes.composer.style.height = `${Math.min(nodes.composer.scrollHeight, 120)}px`;
  scheduleLivePreview();
}

async function commit(message, button, fields, errorNode) {
  if (state.pending) return;
  state.pending = true;
  state.decisionId = message.decisionId;
  errorNode.closest("form")?.querySelectorAll("[type=submit]").forEach((item) => {
    item.disabled = true;
  });
  const beforeIds = new Set((state.directory?.users || []).map((item) => item.id));
  try {
    const data = await api("/api/commit", {
      method: "POST",
      body: JSON.stringify({ decisionId: message.decisionId, button, fields })
    });
    state.directory = data.snapshot;
    const affected = data.affectedIds || [];
    state.fresh = new Set(affected);
    message.uiStatus = "done";
    // If this was the live preview, promote it to a permanent turn: drop the
    // preview flag, give it a stable id, and prepend the operator's request so
    // the transcript reads naturally.
    if (message.preview) {
      message.preview = false;
      const idx = state.messages.indexOf(message);
      const requestText = message.ui?.source || nodes.composer.value.trim();
      if (idx >= 0 && requestText) {
        state.messages.splice(idx, 0, { id: uid(), role: "user", text: requestText });
      }
      message.id = uid();
      livePreview.subjectId = null;
      livePreview.key = null;
      if (nodes.composer) {
        nodes.composer.value = "";
        nodes.composer.style.height = "auto";
      }
    }
    state.messages.push({ id: uid(), role: "assistant", text: data.reply });
    if (data.download) saveFile(data.download);
    const forceDown = button === "create" || button === "reactivate";
    if (forceDown || affected.some((id) => !beforeIds.has(id))) {
      openUsersDock();
    } else {
      renderPeople();
    }
    renderLog();
    setTimeout(() => playCommitAnimation(affected, beforeIds, { forceDown }), 100);
    setTimeout(() => {
      state.fresh.clear();
      renderPeople();
    }, 2000);
  } catch (error) {
    errorNode.textContent = error.message;
    const form = errorNode.closest("form");
    if (form && message.ui) syncButtons(form, message.ui, message);
  } finally {
    state.pending = false;
  }
}

async function revoke() {
  try {
    const data = await api("/api/overrides/revoke", { method: "POST", body: "{}" });
    state.directory = data.snapshot;
    state.messages.push({ id: uid(), role: "assistant", text: data.reply });
    renderPeople();
    renderLog();
  } catch (error) {
    state.messages.push({ id: uid(), role: "error", text: error.message });
    renderLog();
  }
}

/* ============================================================================
 * Interactive Demo Tour & Showcase Engine
 * ============================================================================ */

const DEMO_STEPS = [
  {
    id: "01-dana-role",
    title: "1. Promote Dana to Admin",
    badge: "Retrieval → UP Motion",
    desc: "Existing records lift UP from the directory dock into the chat window with a cinematic vignette. The role field pre-fills to Admin.",
    prompt: "Promote Dana to Admin",
    dockTab: "users",
    action: "submit",
    actionLabel: "Update role",
    waitBeforeSubmitMs: 2200,
    waitAfterSubmitMs: 2500
  },
  {
    id: "02-dana-group",
    title: "2. Disambiguate Group vs Role",
    badge: "Choice Disambiguation",
    desc: "Jev knows 'Admin team' refers to the operator group, not the Admin RBAC role. The form pre-checks Admin team.",
    prompt: "Add Dana to the Admin team",
    dockTab: "users",
    action: "submit",
    actionLabel: "Save groups",
    waitBeforeSubmitMs: 2200,
    waitAfterSubmitMs: 2500
  },
  {
    id: "03-cecil-compound",
    title: "3. Compound Provisioning (Add Cecil to Support)",
    badge: "Creation → DOWN Motion",
    desc: "Cecil doesn't exist yet. Jev folds user creation + group assignment into one screen. On save, the card drops DOWN into the table!",
    prompt: "Can you add Cecil to the support team",
    dockTab: "users",
    action: "submit",
    actionLabel: "Add user",
    waitBeforeSubmitMs: 2200,
    waitAfterSubmitMs: 2800
  },
  {
    id: "04-sarah-storage",
    title: "4. Offboarding with Storage Warning",
    badge: "Dependency Check",
    desc: "Hard-deleting Sarah Chen flags direct reports, payroll run date, and surfaces an optional storage files notice.",
    prompt: "Hard-delete Sarah Chen",
    dockTab: "users",
    action: "submit",
    actionLabel: "Confirm offboard",
    waitBeforeSubmitMs: 2400,
    waitAfterSubmitMs: 2800
  },
  {
    id: "05-override-mfa",
    title: "5. Temporary Superadmin Elevation",
    badge: "Noul + MFA Elevation",
    desc: "Recognizes break-glass elevation request with 0.98 Noul probability. Pre-fills duration to 2 hours and displays MFA check.",
    prompt: "Give me superadmin access for 2 hours to fix the billing bug",
    dockTab: "users",
    action: "mfa_and_submit",
    actionLabel: "Grant access",
    waitBeforeSubmitMs: 2200,
    waitAfterSubmitMs: 2600
  },
  {
    id: "06-openai-rls",
    title: "6. Escalation to OpenAI for Postgres RLS",
    badge: "System One + OpenAI",
    desc: "Jev classifies manage_rls and escalates to OpenAI to draft a Postgres USING (auth.uid() = id) policy expression.",
    prompt: "Add an RLS policy so people only read their own profile",
    dockTab: "policies",
    action: "submit",
    actionLabel: "Save policy",
    waitBeforeSubmitMs: 3000,
    waitAfterSubmitMs: 2500
  }
];

const demoState = {
  running: false,
  paused: false,
  stepIndex: 0,
  speed: 1,
  runToken: 0
};

window.__demoRunning = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function demoWait(ms, token) {
  const scaled = ms / demoState.speed;
  const start = Date.now();
  while (Date.now() - start < scaled) {
    if (!demoState.running || token !== demoState.runToken) throw new Error("demo_aborted");
    while (demoState.paused) {
      if (!demoState.running || token !== demoState.runToken) throw new Error("demo_aborted");
      await sleep(100);
    }
    await sleep(50);
  }
}

async function typeComposer(text, speed = 1, token) {
  nodes.composer.value = "";
  nodes.composer.focus();
  const delay = Math.max(14, Math.floor(30 / speed));
  for (let i = 0; i < text.length; i++) {
    if (!demoState.running || token !== demoState.runToken) return false;
    nodes.composer.value += text[i];
    nodes.composer.dispatchEvent(new Event("input", { bubbles: true }));
    nodes.composer.scrollTop = nodes.composer.scrollHeight;
    await sleep(delay);
  }
  return true;
}

function highlightPrefilledFields(form) {
  if (!form) return;
  const targets = form.querySelectorAll("input:not([type=hidden]):not([type=checkbox]), select, textarea, .authenticator, .notice");
  targets.forEach((el) => {
    if (el.value || el.classList.contains("notice") || el.classList.contains("authenticator")) {
      el.classList.add("demo-highlight");
      setTimeout(() => el.classList.remove("demo-highlight"), 2400);
    }
  });
}

function renderDemoHud() {
  if (!demoState.running) {
    nodes.demoHud.replaceChildren();
    return;
  }

  const step = DEMO_STEPS[demoState.stepIndex];
  const total = DEMO_STEPS.length;
  const progressPct = ((demoState.stepIndex + 1) / total) * 100;

  nodes.demoHud.replaceChildren(
    h("div", { class: "demo-hud" }, [
      h("div", { class: "demo-hud-top" }, [
        h("div", { class: "demo-hud-tags" }, [
          h("span", { class: "demo-hud-pill" }, "DEMO SHOWCASE"),
          h("span", { class: "demo-hud-step" }, `Step ${demoState.stepIndex + 1} of ${total}`),
          step ? h("span", { class: "demo-hud-badge" }, step.badge) : null
        ]),
        h("div", { class: "demo-hud-controls" }, [
          h("button", {
            type: "button",
            class: `demo-hud-btn ${demoState.paused ? "is-active" : ""}`,
            onClick: () => demoState.paused ? resumeDemoTour() : pauseDemoTour()
          }, demoState.paused ? "▶ Resume" : "❚❚ Pause"),
          h("button", {
            type: "button",
            class: "demo-hud-btn",
            disabled: demoState.stepIndex <= 0,
            onClick: () => prevDemoStep()
          }, "⏮ Back"),
          h("button", {
            type: "button",
            class: "demo-hud-btn",
            disabled: demoState.stepIndex >= total - 1,
            onClick: () => nextDemoStep()
          }, "⏭ Skip"),
          h("button", {
            type: "button",
            class: "demo-hud-btn",
            onClick: () => setDemoSpeed(demoState.speed === 1 ? 1.5 : demoState.speed === 1.5 ? 2 : 1)
          }, `${demoState.speed}x`),
          h("button", {
            type: "button",
            class: "demo-hud-btn",
            onClick: () => stopDemoTour()
          }, "✕ Exit")
        ])
      ]),
      h("div", { class: "demo-hud-body" }, [
        h("div", { class: "demo-hud-title" }, step ? step.title : "Showcase Finished"),
        h("div", { class: "demo-hud-desc" }, step ? step.desc : "All 6 Jev workflows completed successfully.")
      ]),
      h("div", { class: "demo-hud-progress" }, [
        h("div", { class: "demo-hud-progress-fill", style: `width: ${progressPct}%` })
      ])
    ])
  );
}

function setDemoSpeed(spd) {
  demoState.speed = spd;
  renderDemoHud();
}

async function startDemoTour(options = {}) {
  if (state.view !== "chat") setView("chat");
  demoState.running = true;
  demoState.paused = false;
  demoState.speed = options.speed || 1;
  demoState.stepIndex = options.stepIndex || 0;
  demoState.runToken = ++demoState.runToken;
  window.__demoRunning = true;

  try {
    const data = await api("/api/reset", { method: "POST" });
    state.directory = data;
    state.messages = [];
    state.fresh = new Set();
    renderPeople();
    renderLog();
  } catch (err) {
    console.warn("Reset directory failed:", err);
  }

  renderMeta();
  renderDemoHud();
  runDemoLoop(demoState.runToken);
}

function stopDemoTour() {
  demoState.running = false;
  demoState.paused = false;
  demoState.runToken = ++demoState.runToken;
  window.__demoRunning = false;
  nodes.demoHud.replaceChildren();
  renderMeta();
}

function toggleDemoTour() {
  if (demoState.running) stopDemoTour();
  else startDemoTour();
}

function pauseDemoTour() {
  demoState.paused = true;
  renderDemoHud();
}

function resumeDemoTour() {
  demoState.paused = false;
  renderDemoHud();
}

function nextDemoStep() {
  if (demoState.stepIndex < DEMO_STEPS.length - 1) {
    demoState.stepIndex++;
    demoState.runToken = ++demoState.runToken;
    renderDemoHud();
    runDemoLoop(demoState.runToken);
  }
}

function prevDemoStep() {
  if (demoState.stepIndex > 0) {
    demoState.stepIndex--;
    demoState.runToken = ++demoState.runToken;
    renderDemoHud();
    runDemoLoop(demoState.runToken);
  }
}

async function runDemoLoop(token) {
  while (demoState.running && token === demoState.runToken && demoState.stepIndex < DEMO_STEPS.length) {
    const step = DEMO_STEPS[demoState.stepIndex];
    renderDemoHud();

    if (step.dockTab && step.dockTab !== state.dockTab) {
      setDockTab(step.dockTab);
      await sleep(200);
    }

    try {
      const typed = await typeComposer(step.prompt, demoState.speed, token);
      if (!typed) break;

      await demoWait(350, token);
      await send(step.prompt);

      await sleep(500);
      const latestForm = nodes.log.querySelector(".bubble.has-ui:last-of-type .ui-form");
      if (latestForm) {
        highlightPrefilledFields(latestForm);
      }

      await demoWait(step.waitBeforeSubmitMs, token);

      if (step.action === "mfa_and_submit") {
        const form = nodes.log.querySelector(".bubble.has-ui:last-of-type .ui-form");
        const mfaInput = form?.querySelector('[data-field="mfa"]');
        const badge = form?.querySelector(".authenticator strong");
        if (mfaInput && badge) {
          mfaInput.value = badge.textContent.trim();
          mfaInput.dispatchEvent(new Event("input", { bubbles: true }));
          mfaInput.dispatchEvent(new Event("change", { bubbles: true }));
          await demoWait(300, token);
        }
        const reasonInput = form?.querySelector('[data-field="reason"]');
        if (reasonInput && !reasonInput.value) {
          reasonInput.value = "Fix billing bug";
          reasonInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }

      if (step.id === "04-sarah-storage") {
        const form = nodes.log.querySelector(".bubble.has-ui:last-of-type .ui-form");
        const confirmInput = form?.querySelector('[data-field="confirm"]');
        if (confirmInput) {
          confirmInput.value = "Sarah";
          confirmInput.dispatchEvent(new Event("input", { bubbles: true }));
          confirmInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const payrollInput = form?.querySelector('[data-field="payrollDate"]');
        if (payrollInput && !payrollInput.value) {
          payrollInput.value = new Date().toISOString().slice(0, 10);
          payrollInput.dispatchEvent(new Event("input", { bubbles: true }));
          payrollInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
        await demoWait(300, token);
      }

      if (step.action === "submit" || step.action === "mfa_and_submit") {
        const form = nodes.log.querySelector(".bubble.has-ui:last-of-type .ui-form");
        if (form) {
          const buttons = [...form.querySelectorAll("button")];
          let btn = buttons.find((b) => b.textContent.trim().toLowerCase() === step.actionLabel.toLowerCase());
          if (!btn) btn = buttons.find((b) => b.getAttribute("type") === "submit");
          if (!btn) btn = buttons.find((b) => !b.classList.contains("close") && !b.classList.contains("ghost"));
          if (btn && !btn.disabled) {
            btn.click();
          }
        }
        await demoWait(step.waitAfterSubmitMs, token);
      }

      demoState.stepIndex++;
    } catch (err) {
      if (err.message === "demo_aborted") break;
      console.error("Demo step error:", err);
      break;
    }
  }

  if (demoState.running && token === demoState.runToken && demoState.stepIndex >= DEMO_STEPS.length) {
    renderDemoComplete();
  }
}

function renderDemoComplete() {
  nodes.demoHud.replaceChildren(
    h("div", { class: "demo-complete-card" }, [
      h("h3", {}, "🎉 Demo Showcase Complete!"),
      h("p", {}, "All 6 Jev workflows demonstrated: UP retrieval motion, group vs role disambiguation, compound provisioning with DOWN motion, offboard storage warnings, temporary MFA elevation, and OpenAI Postgres RLS generation."),
      h("div", { style: "display:flex; justify-content:center; gap:10px;" }, [
        h("button", {
          type: "button",
          class: "btn-demo-tour",
          onClick: () => startDemoTour({ stepIndex: 0 })
        }, "↻ Replay Tour"),
        h("button", {
          type: "button",
          class: "demo-hud-btn",
          onClick: () => stopDemoTour()
        }, "Close")
      ])
    ])
  );
}

window.__demoState = demoState;
window.startDemoTour = startDemoTour;
window.stopDemoTour = stopDemoTour;
window.toggleDemoTour = toggleDemoTour;
window.pauseDemoTour = pauseDemoTour;
window.resumeDemoTour = resumeDemoTour;
window.nextDemoStep = nextDemoStep;
window.prevDemoStep = prevDemoStep;
window.setView = setView;

async function init() {
  mount();
  const [health, directory] = await Promise.all([api("/api/health"), api("/api/state")]);
  state.health = health;
  state.directory = directory;
  if (!health.configured) {
    nodes.foot.textContent = "The API key stays on the server. It is not set yet.";
  } else {
    nodes.foot.textContent = "";
  }
  if (nodes.reflexHud) {
    nodes.reflexHud.querySelector(".reflex-hud-text").textContent = `System One · ${health.model || "ready"}`;
  }
  renderBanner();
  renderPeople();
  renderLog();
  renderMeta();

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("demo") === "1" || urlParams.get("showcase") === "1" || urlParams.get("autoplay") === "1") {
    setTimeout(() => startDemoTour(), 600);
  }
}

init();
