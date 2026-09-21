import { useEffect, useState } from "react";
import "./App.css";
import "./Sidebar.css";
import BatchUpload from "./components/BatchUpload";

const API = process.env.REACT_APP_API_URL || "http://localhost:3000/api";
const slugifyKit = (kit) =>
  `${kit?.source?.company || "company"} ${kit?.source?.role || "interview-kit"}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "interview-kit";
const kitPath = (kit, id, section = "") =>
  `/kits/${slugifyKit(kit)}${section ? `/${section}` : ""}?id=${id}`;
const request = async (path, options = {}) => {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
  } catch {
    throw new Error(`The API is unavailable at ${API}. Start the backend and try again.`);
  }
  const raw = response.status === 204 ? "" : await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(
      `Server returned an unexpected response (${response.status}). Restart the backend and try again.`,
    );
  }
  if (!response.ok)
    throw new Error(
      body?.error?.message || `Request failed (${response.status}).`,
    );
  return body;
};

function Auth({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    try {
      await request(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(form),
      });
      onAuthenticated();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <main className="auth-shell">
      <section className="auth-copy">
        <span className="eyebrow">INTERVIEW KIT</span>
        <h1>Turn a job description into a sharper interview day.</h1>
        <p>
          Research the company, map every requirement, and practice with a plan
          that respects the time you actually have.
        </p>
      </section>
      <form className="auth-card" onSubmit={submit}>
        <span className="eyebrow">
          {mode === "login" ? "WELCOME BACK" : "GET STARTED"}
        </span>
        <h2>{mode === "login" ? "Sign in" : "Create your account"}</h2>
        <label>
          Email
          <input
            type="email"
            required
            value={form.email}
            onChange={(event) =>
              setForm({ ...form, email: event.target.value })
            }
          />
        </label>
        <label>
          Password
          <input
            type="password"
            minLength="8"
            required
            value={form.password}
            onChange={(event) =>
              setForm({ ...form, password: event.target.value })
            }
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit">
          {mode === "login" ? "Open workspace" : "Create workspace"}
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login"
            ? "Need an account? Register"
            : "Already have an account? Sign in"}
        </button>
      </form>
    </main>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [kits, setKits] = useState([]);
  const [active, setActive] = useState(null);
  const [path, setPath] = useState(window.location.pathname);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingKit, setEditingKit] = useState(null);
  const deleteFromDashboard = (kit) => {
    if (window.confirm("Delete this preparation? This cannot be undone."))
      deleteKit(kit._id);
  };
  const renameKit = async (kit) => {
    const displayName = window.prompt(
      "Preparation name",
      kit.displayName || kit.kit?.source?.role || "Interview preparation",
    );
    if (displayName === null) return;
    try {
      const updated = await request(`/kits/${kit._id}`, {
        method: "PATCH",
        body: JSON.stringify({ displayName }),
      });
      setKits((current) => current.map((item) => item._id === kit._id ? { ...item, displayName: updated.displayName } : item));
      setActive((current) => current?._id === kit._id ? { ...current, displayName: updated.displayName } : current);
    } catch (err) {
      setError(err.message);
    }
  };
  const navigate = (nextPath) => {
    window.history.pushState({}, "", nextPath);
    setPath(new URL(nextPath, window.location.origin).pathname);
  };
  const load = async () => {
    try {
      const me = await request("/auth/me");
      setUser(me.user);
      try {
        const data = await request("/kits");
        setKits(data.kits);
      } catch (err) {
        setError(err.message);
      }
    } catch (err) {
      if (!err.message.includes("API is unavailable")) setError(err.message);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    const match = path.match(/^\/kits\/([^/]+)/);
    const kitId =
      new URLSearchParams(window.location.search).get("id") || match?.[1];
    if (!user || !kitId || active?._id === kitId) return;
    request(`/kits/${kitId}`)
      .then(setActive)
      .catch((err) => setError(`Unable to open this kit: ${err.message}`));
  }, [path, user, active]);
  if (loading) return <div className="loading">Loading workspace...</div>;
  if (!user) return <Auth onAuthenticated={load} />;
  const kitMatch = path.match(
    /^\/kits\/([^/]+)(?:\/(practice|weak-spots|company|role|questions|flashcards|schedule))?$/,
  );
  const view =
    path === "/create"
      ? "create"
      : kitMatch?.[2] || (kitMatch ? "kit" : "dashboard");
  const openKit = async (id) => {
    try {
      const data = await request(`/kits/${id}`);
      setActive(data);
      navigate(kitPath(data.kit, id));
    } catch (err) {
      setError(err.message);
    }
  };
  const openPractice = () => {
    if (!active?.kit?.flashcards?.length)
      return setError("This kit has no flashcards available for practice.");
    setError("");
    navigate(kitPath(active.kit, active._id, "practice"));
  };
  const deleteKit = async (id) => {
    try {
      await request(`/kits/${id}`, { method: "DELETE" });
      setActive(null);
      await load();
      navigate("/");
    } catch (err) {
      setError(err.message);
    }
  };
  const logout = async () => {
    try {
      await request("/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      setActive(null);
      navigate("/");
    }
  };
  const sectionPath = (section) => kitPath(active.kit, active._id, section);
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <button className="brand brand-button" onClick={() => navigate("/")}>
          prep<span>/</span>room
        </button>
        <p className="side-note">
          A focused preparation studio for your next conversation.
        </p>
        <nav className="sidebar-nav" aria-label="Workspace navigation">
          <button
            className={`sidebar-nav-item ${view === "dashboard" ? "selected" : ""}`}
            aria-current={view === "dashboard" ? "page" : undefined}
            onClick={() => navigate("/")}
          >
            Workspace
          </button>
          <button
            className="sidebar-new-preparation"
            onClick={() => navigate("/create")}
          >
            + New preparation
          </button>
          {active && (
            <>
              <span className="nav-label">CURRENT KIT</span>
              <button
                className="sidebar-kit-title"
                onClick={() => openKit(active._id)}
              >
                {active.displayName || active.kit?.source.company || "Active kit"}
              </button>
              {active.kit && (
                <>
                  <button
                    className={`sidebar-nav-item ${view === "company" ? "selected" : ""}`} aria-current={view === "company" ? "page" : undefined}
                    onClick={() => navigate(sectionPath("company"))}
                  >
                    Company brief
                  </button>
                  <button
                    className={`sidebar-nav-item ${view === "role" ? "selected" : ""}`} aria-current={view === "role" ? "page" : undefined}
                    onClick={() => navigate(sectionPath("role"))}
                  >
                    Role breakdown
                  </button>
                  <button
                    className={`sidebar-nav-item ${view === "questions" ? "selected" : ""}`} aria-current={view === "questions" ? "page" : undefined}
                    onClick={() => navigate(sectionPath("questions"))}
                  >
                    Questions
                  </button>
                  <button
                    className={`sidebar-nav-item ${view === "flashcards" ? "selected" : ""}`} aria-current={view === "flashcards" ? "page" : undefined}
                    onClick={() => navigate(sectionPath("flashcards"))}
                  >
                    Flashcards
                  </button>
                  <button
                    className={`sidebar-nav-item ${view === "schedule" ? "selected" : ""}`} aria-current={view === "schedule" ? "page" : undefined}
                    onClick={() => navigate(sectionPath("schedule"))}
                  >
                    Study schedule
                  </button>
                  <button
                    className={`sidebar-nav-item ${view === "practice" ? "selected" : ""}`} aria-current={view === "practice" ? "page" : undefined}
                    onClick={openPractice}
                  >
                    Practice mode
                  </button>
                  <button
                    className={`sidebar-nav-item ${view === "weak-spots" ? "selected" : ""}`} aria-current={view === "weak-spots" ? "page" : undefined}
                    onClick={() => navigate(sectionPath("weak-spots"))}
                  >
                    Weak spots
                  </button>
                </>
              )}
            </>
          )}
        </nav>
        <button className="logout" onClick={logout}>
          Sign out
        </button>
      </aside>
      <main className="main-content">
        <header>
          <div>
            <span className="eyebrow">
              {view === "dashboard"
                ? "YOUR WORKSPACE"
                : view.replace("-", " ").toUpperCase()}
            </span>
            <h1>
              {view === "dashboard"
                ? "Prepare with intent."
                : view === "create"
                  ? "Build a new kit."
                  : active?.displayName || active?.kit?.source.company || "Preparation kit"}
            </h1>
          </div>
          <span className="user-chip">{user.email}</span>
        </header>
        {error && <div className="error-banner">{error}</div>}
        {view === "dashboard" && (
          <Dashboard
            kits={kits}
            onOpen={(record) => openKit(record._id)}
            onCreate={() => navigate("/create")}
            onRename={renameKit}
            onEdit={setEditingKit}
            onDelete={deleteFromDashboard}
          />
        )}{" "}
        {view === "create" && (
          <Create
            onCreated={async (id) => {
              await load();
              openKit(id);
            }}
          />
        )}{" "}
        {view === "kit" && active && (
          <KitView
            record={active}
            onRefresh={() => openKit(active._id)}
            onPractice={openPractice}
            onDelete={deleteKit}
            onChanged={setActive}
          />
        )}{" "}
        {["company", "role", "questions", "flashcards", "schedule"].includes(
          view,
        ) &&
          active?.kit && (
            <KitSection
              view={view}
              kit={active.kit}
              record={active}
              onChanged={setActive}
              onRefresh={() => openKit(active._id)}
            />
          )}{" "}
        {view === "practice" &&
          (active?.kit ? (
            <Practice kit={active.kit} kitId={active._id} />
          ) : (
            <div className="loading">Loading practice...</div>
          ))}{" "}
        {view === "weak-spots" && active?.kit && <WeakSpots id={active._id} />}
      </main>
      {editingKit && (
        <EditPreparation
          kit={editingKit}
          onClose={() => setEditingKit(null)}
          onSaved={async () => {
            const editedId = editingKit._id;
            setEditingKit(null);
            await load();
            if (active?._id === editedId) await openKit(editedId);
          }}
        />
      )}
    </div>
  );
}

const fallbackRename = async (kit) => {
  const displayName = window.prompt(
    "Preparation name",
    kit.displayName || "Interview preparation",
  );
  if (displayName === null) return;
  try {
    await request(`/kits/${kit._id}`, {
      method: "PATCH",
      body: JSON.stringify({ displayName }),
    });
    window.location.reload();
  } catch (error) {
    window.alert(error.message);
  }
};
const fallbackEdit = () =>
  window.alert("Open the preparation and use its edit controls.");
const fallbackDelete = async (kit) => {
  if (window.confirm("Delete this preparation? This cannot be undone.")) {
    await request(`/kits/${kit._id}`, { method: "DELETE" });
    window.location.reload();
  }
};
function Dashboard({
  kits,
  onOpen,
  onCreate,
  onRename = fallbackRename,
  onEdit = fallbackEdit,
  onDelete = fallbackDelete,
}) {
  return (
    <section className="content">
      <div className="welcome-panel">
        <div>
          <span className="eyebrow">MAKE THE NEXT DAYS COUNT</span>
          <h2>One clear plan beats ten open tabs.</h2>
          <p>
            Start with the role and the company. We will turn them into
            requirements, questions, flashcards, and a schedule.
          </p>
        </div>
        <button className="primary" onClick={onCreate}>
          Create a kit <span>→</span>
        </button>
      </div>
      <div className="section-heading">
        <h2>Recent preparations</h2>
        <span>{kits.length} kits</span>
      </div>
      {kits.length === 0 ? (
        <div className="empty">
          <h3>Your workspace is quiet.</h3>
          <p>Create your first preparation kit to see it here.</p>
        </div>
      ) : (
        <div className="kit-grid">
          {kits.map((kit) => (
            <div className="kit-card-wrap" key={kit._id}>
              <button className="kit-card" onClick={() => onOpen(kit)}>
                <span className={`status ${kit.status}`}>{kit.status}</span>
                <h3>
                  {kit.displayName ||
                    kit.kit?.source?.company ||
                    kit.companyUrl}
                </h3>
                <p>
                  {kit.displayName
                    ? kit.kit?.source?.role || kit.companyUrl
                    : kit.kit?.source?.role || "Research in progress"}
                </p>
                <small>{kit.generationStage}</small>
              </button>
              <PreparationMenu
                onRename={() => onRename(kit)}
                onEdit={() => onEdit(kit)}
                onDelete={() => onDelete(kit)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PreparationMenu({ onRename, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const choose = (action) => {
    setOpen(false);
    action();
  };
  return (
    <div className="preparation-menu">
      <button
        type="button"
        className="dots-button"
        aria-label="Preparation actions"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        ⋮
      </button>
      {open && (
        <div className="menu-popover">
          <button type="button" onClick={() => choose(onRename)}>
            Rename
          </button>
          <button type="button" onClick={() => choose(onEdit)}>
            Edit preparation
          </button>
          <button
            type="button"
            className="danger-text"
            onClick={() => choose(onDelete)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function EditPreparation({ kit, onClose, onSaved }) {
  const [form, setForm] = useState({
    displayName: kit.displayName || "",
    jd: kit.jd || "",
    company_url: kit.companyUrl || "",
    days: kit.days || 5,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await request(`/kits/${kit._id}`, {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      await onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="edit-overlay">
      <form className="edit-panel" onSubmit={save}>
        <div className="section-heading">
          <div>
            <span className="eyebrow">EDIT PREPARATION</span>
            <h2>Update your source</h2>
          </div>
          <button type="button" className="text-button" onClick={onClose}>
            Close
          </button>
        </div>
        <label>
          Preparation name
          <input
            value={form.displayName}
            onChange={(event) =>
              setForm({ ...form, displayName: event.target.value })
            }
            placeholder="e.g. Acme backend interview"
          />
        </label>
        <label>
          Job description
          <textarea
            required
            minLength="10"
            value={form.jd}
            onChange={(event) => setForm({ ...form, jd: event.target.value })}
          />
        </label>
        <label>
          Company website
          <input
            required
            type="url"
            value={form.company_url}
            onChange={(event) =>
              setForm({ ...form, company_url: event.target.value })
            }
          />
        </label>
        <label>
          Days available
          <input
            type="number"
            min="1"
            max="30"
            required
            value={form.days}
            onChange={(event) => setForm({ ...form, days: event.target.value })}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "Saving and regenerating..." : "Save changes"}
        </button>
      </form>
    </div>
  );
}
function Create({ onCreated }) {
  const [form, setForm] = useState({ jd: "", company_url: "", days: 5 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await request("/kits", {
        method: "POST",
        body: JSON.stringify(form),
      });
      await onCreated(result.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <section className="content narrow">
      <form className="create-form" onSubmit={submit}>
        <div className="form-intro">
          <span className="eyebrow">NEW PREPARATION</span>
          <h2>Give the role some context.</h2>
          <p>
            The analysis only uses evidence from your job description. Company
            research discovers relevant pages from the site you provide.
          </p>
        </div>
        <label>
          Job description
          <textarea
            required
            minLength="10"
            value={form.jd}
            onChange={(event) => setForm({ ...form, jd: event.target.value })}
          />
        </label>
        <label>
          Company website
          <input
            required
            type="url"
            value={form.company_url}
            onChange={(event) =>
              setForm({ ...form, company_url: event.target.value })
            }
          />
        </label>
        <label>
          Days until interview
          <div className="days-row">
            {[1, 3, 5, 7, 14, 30].map((day) => (
              <button
                type="button"
                key={day}
                className={Number(form.days) === day ? "day selected" : "day"}
                onClick={() => setForm({ ...form, days: day })}
              >
                {day}
              </button>
            ))}
          </div>
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "Starting research..." : "Generate preparation kit →"}
        </button>
      </form>
      <BatchUpload onComplete={() => window.location.reload()} />
    </section>
  );
}

function KitView({ record, onRefresh, onPractice, onDelete, onChanged }) {
  const kit = record.kit;
  const isRegenerating = ["queued", "analyzing", "researching", "generating", "validating"].includes(record.status);
  useEffect(() => {
    if (!isRegenerating || !kit) return undefined;
    const timer = setTimeout(onRefresh, 1800);
    return () => clearTimeout(timer);
  }, [isRegenerating, kit, onRefresh]);
  if (!kit) return <Progress record={record} onRefresh={onRefresh} />;
  const requirementCount = kit.role.requirements.length;
  const coverage = requirementCount
    ? Math.round(
        (1 - kit.coverage.uncovered_requirement_ids.length / requirementCount) *
          100,
      )
    : 0;
  const confirmDelete = () => {
    if (window.confirm("Delete this preparation kit? This cannot be undone."))
      onDelete(record._id);
  };
  return (
    <section className="content">
      <div className="kit-summary">
        <div>
          <span className="eyebrow">
            {record.displayName || kit.source.company} · {kit.schedule.days_available} DAYS
          </span>
          <h2>{kit.role.title}</h2>
          <p>{kit.company_brief.summary}</p>
        </div>
        {kit.flashcards.length > 0 && (
          <button className="primary" onClick={onPractice}>
            Start practice →
          </button>
        )}
      </div>
      <div className="stat-row">
        <div>
          <strong>{requirementCount}</strong>
          <span>requirements</span>
        </div>
        <div>
          <strong>{kit.questions.length}</strong>
          <span>questions</span>
        </div>
        <div>
          <strong>{kit.flashcards.length}</strong>
          <span>flashcards</span>
        </div>
        <div>
          <strong>{requirementCount ? `${coverage}%` : "—"}</strong>
          <span>coverage</span>
        </div>
      </div>
      {requirementCount === 0 && (
        <div className="empty">
          <h3>No explicit requirements were found.</h3>
          <p>Add a fuller JD and regenerate this kit.</p>
        </div>
      )}
      {isRegenerating && <p className="builder-feedback" role="status">Regeneration in progress. Your saved edits remain protected.</p>}
      {record.status === "failed" && record.error && (
        <p className="error" role="alert">
          Regeneration failed: {record.error.message || "Please try again."}
        </p>
      )}
      <RegenerationControls record={record} onChanged={onChanged} />
      <div className="kit-columns">
        <article>
          <span className="eyebrow">ROLE BREAKDOWN</span>
          <h3>What to prepare for</h3>
          {kit.role.requirements.map((requirement) => (
            <div className="requirement" key={requirement.id}>
              <span className={requirement.priority}>
                {requirement.priority}
              </span>
              <div>
                <strong>{requirement.text}</strong>
                <small>
                  {requirement.kind} · {requirement.id}
                </small>
              </div>
            </div>
          ))}
        </article>
        <article>
          <span className="eyebrow">STUDY SCHEDULE</span>
          <h3>Your next {kit.schedule.days_available} days</h3>
          {kit.schedule.days.slice(0, 7).map((day) => (
            <div className="schedule" key={day.day}>
              <b>{String(day.day).padStart(2, "0")}</b>
              <div>
                <strong>{day.focus}</strong>
                <small>
                  {day.minutes} minutes · {day.question_ids.length} questions
                </small>
              </div>
            </div>
          ))}
        </article>
      </div>
      <QuestionManager record={record} onChanged={onChanged} />
      <button className="delete-button" onClick={confirmDelete}>
        Delete kit
      </button>
    </section>
  );
}

function RegenerationControls({ record, onChanged }) {
  const [busySection, setBusySection] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const regenerate = async (section, category) => {
    if (busySection) return;
    setBusySection(section);
    setError("");
    setMessage("");
    try {
      const result = await request(`/kits/${record._id}/regenerate`, {
        method: "POST",
        body: JSON.stringify({ section, ...(category ? { category } : {}) }),
      });
      onChanged({ ...record, status: result.status, generationStage: "queued" });
      setMessage(`${category || section.replace("_", " ")} regeneration queued.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusySection("");
    }
  };
  return (
    <section className="regeneration-controls" aria-labelledby="regenerate-heading">
      <div>
        <span className="eyebrow">REFRESH CONTENT</span>
        <h3 id="regenerate-heading">Regenerate a section</h3>
      </div>
      <div className="builder-actions">
        {[
          ["company_brief", "Company brief"],
          ["questions", "Technical", "technical"],
          ["questions", "Behavioural", "behavioural"],
          ["questions", "System design", "system-design"],
          ["questions", "Company fit", "company-fit"],
          ["flashcards", "Flashcards"],
          ["schedule", "Schedule"],
        ].map(([section, label, category]) => (
          <button key={`${section}-${category || "all"}`} type="button" className="secondary" disabled={Boolean(busySection)} onClick={() => regenerate(section, category)}>
            {busySection === section ? "Queuing…" : `Regenerate ${label}`}
          </button>
        ))}
      </div>
      {message && <p className="success" role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="builder-note">Edited, pinned, and manually added content is preserved by section regeneration.</p>
    </section>
  );
}

function QuestionManager({ record, onChanged }) {
  const [questions, setQuestions] = useState(record.kit.questions);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requirements = record.kit.role.requirements;
  useEffect(() => setQuestions(record.kit.questions), [record.kit.questions]);
  const sync = async () => {
    const refreshed = await request(`/kits/${record._id}`);
    setQuestions(refreshed.kit.questions);
    onChanged(refreshed);
  };
  const save = async (question) => {
    setBusy(true);
    setError("");
    try {
      await request(
        `/kits/${record._id}/questions/${question.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            ...draft,
            difficulty: Number(draft.difficulty),
            pinned: Boolean(draft.pinned),
          }),
        },
      );
      await sync();
      setEditing(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id) => {
    if (!window.confirm("Delete this question?")) return;
    setBusy(true);
    setError("");
    try {
      await request(`/kits/${record._id}/questions/${id}`, { method: "DELETE" });
      await sync();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };
  const move = async (index, direction) => {
    const next = [...questions];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true);
    setError("");
    try {
      await request(`/kits/${record._id}/questions/reorder`, {
        method: "POST",
        body: JSON.stringify({ question_ids: next.map((item) => item.id) }),
      });
      await sync();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };
  const add = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request(`/kits/${record._id}/questions`, {
        method: "POST",
        body: JSON.stringify({
          ...draft,
          difficulty: Number(draft.difficulty || 2),
          requirement_ids: draft.requirement_ids || [requirements[0]?.id],
        }),
      });
      await sync();
      setDraft({});
      setAdding(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const editor = (
    <div className="question-editor">
      <textarea
        value={draft.prompt || ""}
        onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
        placeholder="Interview question"
      />
      <textarea
        value={draft.answer_outline || ""}
        onChange={(event) =>
          setDraft({ ...draft, answer_outline: event.target.value })
        }
        placeholder="Answer outline"
      />
      <select
        aria-label="Question category"
        value={draft.category || "technical"}
        onChange={(event) => setDraft({ ...draft, category: event.target.value })}
      >
        <option value="technical">Technical</option>
        <option value="behavioural">Behavioural</option>
        <option value="system-design">System design</option>
        <option value="company-fit">Company fit</option>
      </select>
      <select
        aria-label="Question difficulty"
        value={draft.difficulty || 2}
        onChange={(event) =>
          setDraft({ ...draft, difficulty: event.target.value })
        }
      >
        <option value="1">Difficulty 1</option>
        <option value="2">Difficulty 2</option>
        <option value="3">Difficulty 3</option>
      </select>
      <label className="pin-toggle">
        <input
          type="checkbox"
          checked={Boolean(draft.pinned)}
          onChange={(event) =>
            setDraft({ ...draft, pinned: event.target.checked })
          }
        />{" "}
        Pinned
      </label>
    </div>
  );
  return (
    <article className="questions">
      <div className="section-heading">
        <div>
          <span className="eyebrow">QUESTION BANK</span>
          <h3>Questions grounded in the role</h3>
        </div>
        <button
          className="secondary"
          onClick={() => {
            setAdding(true);
            setDraft({ requirement_ids: [requirements[0]?.id] });
          }}
        >
          + Add question
        </button>
      </div>
      {adding && (
        <form onSubmit={add}>
          {editor}
          <button className="primary" disabled={busy}>
            Save question
          </button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {questions.map((question, index) => (
        <div className="managed-question" key={question.id}>
          {editing === question.id ? (
            <>
              {editor}
              <button
                className="secondary"
                disabled={busy}
                onClick={() => save(question)}
              >
                Save
              </button>
              <button className="text-button" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <div>
                <strong>{question.prompt}</strong>
                <p>{question.answer_outline}</p>
                <small>
                  Difficulty {question.difficulty} · {question.id}
                </small>
              </div>
              <div className="question-actions">
                <button
                  className="text-button"
                  onClick={() => {
                    setEditing(question.id);
                    setDraft(question);
                  }}
                >
                  Edit
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => remove(question.id)}
                >
                  Delete
                </button>
                <button
                  className="text-button"
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  className="text-button"
                  disabled={busy || index === questions.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </article>
  );
}

function CompanyBriefEditor({ record, onChanged }) {
  const [draft, setDraft] = useState(record.kit.company_brief);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => setDraft(record.kit.company_brief), [record.kit.company_brief]);
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await request(`/kits/${record._id}/company-brief`, {
        method: "PATCH",
        body: JSON.stringify({ summary: draft.summary, what_they_do: draft.what_they_do }),
      });
      onChanged({ ...record, kit: { ...record.kit, company_brief: result.company_brief } });
      setMessage("Company brief saved.");
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };
  return (
    <form className="section-page builder-form" onSubmit={save}>
      <span className="eyebrow">COMPANY BRIEF</span>
      <h2>{record.displayName || record.kit.source.company}</h2>
      <label>Summary<textarea value={draft.summary || ""} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
      <label>What they do<textarea value={draft.what_they_do || ""} onChange={(event) => setDraft({ ...draft, what_they_do: event.target.value })} /></label>
      <div className="builder-actions"><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save company brief"}</button></div>
      {message && <p className="success" role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <h3>Research sources</h3>
      {record.kit.company_brief.sources.map((source) => <a className="source-link" href={source} target="_blank" rel="noreferrer" key={source}>{source}</a>)}
    </form>
  );
}

function FlashcardManager({ record, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const save = async (card) => {
    setBusy(true);
    setError("");
    try {
      const result = await request(`/kits/${record._id}/flashcards/${card.id}`, { method: "PATCH", body: JSON.stringify({ front: draft.front, back: draft.back, pinned: Boolean(draft.pinned) }) });
      const flashcards = record.kit.flashcards.map((item) => item.id === card.id ? result.flashcard : item);
      onChanged({ ...record, kit: { ...record.kit, flashcards } });
      setEditing(null);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const add = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await request(`/kits/${record._id}/flashcards`, { method: "POST", body: JSON.stringify({ front: draft.front, back: draft.back, requirement_ids: draft.requirement_ids }) });
      onChanged({ ...record, kit: { ...record.kit, flashcards: [...record.kit.flashcards, result.flashcard] } });
      setDraft({});
      setAdding(false);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const remove = async (card) => {
    if (!window.confirm("Delete this flashcard?")) return;
    setBusy(true);
    setError("");
    try {
      await request(`/kits/${record._id}/flashcards/${card.id}`, { method: "DELETE" });
      const refreshed = await request(`/kits/${record._id}`);
      onChanged(refreshed);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <article className="section-page">
      <span className="eyebrow">FLASHCARDS</span>
      <h2>Recall prompts</h2>
      <button type="button" className="secondary" disabled={busy || !record.kit.role.requirements.length} onClick={() => { setAdding(true); setDraft({ requirement_ids: [record.kit.role.requirements[0]?.id] }); }}>+ Add flashcard</button>
      {error && <p className="error" role="alert">{error}</p>}
      {adding && <form className="question-editor" onSubmit={add}><textarea aria-label="New flashcard front" value={draft.front || ""} onChange={(event) => setDraft({ ...draft, front: event.target.value })} placeholder="Flashcard prompt" /><textarea aria-label="New flashcard back" value={draft.back || ""} onChange={(event) => setDraft({ ...draft, back: event.target.value })} placeholder="Flashcard answer" /><select aria-label="Flashcard requirement" value={draft.requirement_ids?.[0] || ""} onChange={(event) => setDraft({ ...draft, requirement_ids: [event.target.value] })}>{record.kit.role.requirements.map((requirement) => <option key={requirement.id} value={requirement.id}>{requirement.text}</option>)}</select><div className="builder-actions"><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save flashcard"}</button><button type="button" className="text-button" disabled={busy} onClick={() => setAdding(false)}>Cancel</button></div></form>}
      {record.kit.flashcards.length === 0 && <div className="empty"><h3>No flashcards yet.</h3><p>Add one tied to a role requirement to start practice.</p></div>}
      {record.kit.flashcards.map((card) => (
        <div className="flashcard-list-item" key={card.id}>
          {editing === card.id ? <div className="question-editor"><textarea aria-label={`Flashcard ${card.id} front`} value={draft.front || ""} onChange={(event) => setDraft({ ...draft, front: event.target.value })} /><textarea aria-label={`Flashcard ${card.id} back`} value={draft.back || ""} onChange={(event) => setDraft({ ...draft, back: event.target.value })} /><label className="pin-toggle"><input type="checkbox" checked={Boolean(draft.pinned)} onChange={(event) => setDraft({ ...draft, pinned: event.target.checked })} /> Pinned</label><div className="builder-actions"><button type="button" className="secondary" disabled={busy} onClick={() => save(card)}>{busy ? "Saving…" : "Save flashcard"}</button><button type="button" className="text-button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button></div></div> : <><strong>{card.front}</strong><p>{card.back}</p><small>{card.requirement_ids.join(", ")}</small><div className="builder-actions"><button type="button" className="text-button" disabled={busy} onClick={() => { setEditing(card.id); setDraft(card); }}>Edit flashcard</button><button type="button" className="text-button danger-text" disabled={busy} onClick={() => remove(card)}>Delete flashcard</button></div></>}
        </div>
      ))}
      <p className="builder-note">Flashcards are tied to requirements and manual cards are preserved during flashcard regeneration.</p>
    </article>
  );
}

function KitSection({ view, kit, record, onChanged }) {
  if (view === "company")
    return (
      <section className="content narrow">
        <CompanyBriefEditor record={record} onChanged={onChanged} />
      </section>
    );
  if (view === "role")
    return (
      <section className="content narrow">
        <article className="section-page">
          <span className="eyebrow">ROLE BREAKDOWN</span>
          <h2>{kit.role.title}</h2>
          <p>
            {kit.role.seniority || "Seniority not specified"}
            {kit.source.location ? ` · ${kit.source.location}` : ""}
          </p>
          {kit.role.responsibilities.map((responsibility, index) => (
            <p key={`${responsibility}-${index}`}>{responsibility}</p>
          ))}
          <h3>Requirements</h3>
          {kit.role.requirements.map((requirement) => (
            <div className="requirement" key={requirement.id}>
              <span className={requirement.priority}>
                {requirement.priority}
              </span>
              <div>
                <strong>{requirement.text}</strong>
                <small>{requirement.kind}</small>
              </div>
            </div>
          ))}
        </article>
      </section>
    );
  if (view === "questions")
    return (
      <section className="content">
        <QuestionManager record={record} onChanged={onChanged} />
      </section>
    );
  if (view === "schedule")
    return (
      <section className="content narrow">
        <article className="section-page">
          <span className="eyebrow">STUDY SCHEDULE</span>
          <h2>{kit.schedule.days_available} days to prepare</h2>
          {kit.schedule.days.map((day) => (
            <div className="schedule" key={day.day}>
              <b>{String(day.day).padStart(2, "0")}</b>
              <div>
                <strong>{day.focus}</strong>
                <small>
                  {day.minutes} minutes · {day.question_ids.length} questions
                </small>
              </div>
            </div>
          ))}
        </article>
      </section>
    );
  return (
    <section className="content narrow">
      <FlashcardManager record={record} onChanged={onChanged} />
    </section>
  );
}

function Progress({ record, onRefresh }) {
  useEffect(() => {
    const timer = setTimeout(onRefresh, 1800);
    return () => clearTimeout(timer);
  }, [record.status, onRefresh]);
  return (
    <section className="content narrow">
      <div className="progress-card">
        <span className="eyebrow">BUILDING YOUR KIT</span>
        <h2>Turning research into a plan.</h2>
        <p>
          We are working through the job description and the public company
          site.
        </p>
        <div className="progress-stage current">● {record.generationStage}</div>
        {record.status === "failed" && (
          <p className="error">
            {record.error?.message || "Generation failed."}
          </p>
        )}
      </div>
    </section>
  );
}
function Practice({ kit, kitId }) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState("");
  const card = kit?.flashcards?.[index % (kit.flashcards.length || 1)];
  const total = kit?.flashcards?.length || 0;
  const position = (index % total) + 1;
  const progress = Math.round((position / total) * 100);
  if (!card)
    return (
      <section className="content narrow">
        <div className="empty">
          <h3>No flashcards available yet.</h3>
        </div>
      </section>
    );
  const rate = async (confidence) => {
    try {
      await request(`/kits/${kitId}/practice/confidence`, {
        method: "POST",
        body: JSON.stringify({ flashcard_id: card.id, confidence }),
      });
      setRevealed(false);
      setIndex(index + 1);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <section className="content narrow">
      <span className="eyebrow">PRACTICE MODE</span>
      <h2>Build recall, not recognition.</h2>
      <div className="practice-progress"><span>Flashcard {position} of {total}</span><span>{progress}%</span><div className="progress-track" role="progressbar" aria-label="Flashcard progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div></div>
      {error && <p className="error">{error}</p>}
      <div className="flashcard">
        <span className="eyebrow">PROMPT</span>
        <h3>{card.front}</h3>
        {revealed ? (
          <div className="answer">
            <span className="eyebrow">ANSWER OUTLINE</span>
            <p>{card.back}</p>
          </div>
        ) : (
          <button className="reveal-button" onClick={() => setRevealed(true)}>
            Reveal answer
          </button>
        )}
      </div>
      {revealed && (
        <div className="confidence">
          <span>How confident were you?</span>
          <button onClick={() => rate(1)}>1 · Not confident</button>
          <button onClick={() => rate(2)}>2 · Somewhat</button>
          <button onClick={() => rate(3)}>3 · Confident</button>
        </div>
      )}
    </section>
  );
}
function WeakSpots({ id }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    request(`/kits/${id}/weak-spots`)
      .then(setData)
      .catch(() => {});
  }, [id]);
  return (
    <section className="content narrow">
      <div className="section-heading">
        <div>
          <span className="eyebrow">PERSONALIZED REVIEW</span>
          <h2>Weak spots</h2>
        </div>
      </div>
      {data?.weak_spots.map((spot) => (
        <div className="weak-row" key={spot.requirement_id}>
          <div>
            <strong>{spot.area}</strong>
            <small>
              {spot.confidence === 0
                ? "Not practiced yet"
                : "Keep strengthening this area"}
            </small>
          </div>
          <b>{spot.confidence}%</b>
          <div className="meter">
            <i style={{ width: `${spot.confidence}%` }} />
          </div>
        </div>
      ))}
    </section>
  );
}
export { CompanyBriefEditor, FlashcardManager, QuestionManager, RegenerationControls, Practice };
export default App;
