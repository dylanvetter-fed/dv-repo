import { useState } from "react";
import "./App.css";

const customers = [
  {
    id: 1,
    name: "Westfield Mutual",
    csm: "Angela Chan",
    renewalDate: "2026-08-15",
    scores: { usage: 82, nps: 71, projects: 90, tickets: 55, engagement: 78, renewal: 85, value: 80 },
  },
  {
    id: 2,
    name: "Brightline Insurance",
    csm: "Will Rowan",
    renewalDate: "2026-07-01",
    scores: { usage: 30, nps: 22, projects: 45, tickets: 25, engagement: 35, renewal: 40, value: 28 },
  },
  {
    id: 3,
    name: "Crestview P&C",
    csm: "Sarah Webb",
    renewalDate: "2026-09-20",
    scores: { usage: 60, nps: 55, projects: 70, tickets: 62, engagement: 50, renewal: 65, value: 58 },
  },
  {
    id: 4,
    name: "Harborlight MGA",
    csm: "Brian Wilkes",
    renewalDate: "2026-10-05",
    scores: { usage: 91, nps: 88, projects: 95, tickets: 85, engagement: 90, renewal: 92, value: 89 },
  },
  {
    id: 5,
    name: "Summit Re Group",
    csm: "Angela Chan",
    renewalDate: "2026-07-18",
    scores: { usage: 42, nps: 38, projects: 55, tickets: 30, engagement: 45, renewal: 50, value: 40 },
  },
  {
    id: 6,
    name: "Irongate Specialty",
    csm: "Will Rowan",
    renewalDate: "2026-11-01",
    scores: { usage: 74, nps: 68, projects: 80, tickets: 72, engagement: 70, renewal: 76, value: 73 },
  },
  {
    id: 7,
    name: "Bluestone Carriers",
    csm: "Sarah Webb",
    renewalDate: "2026-06-28",
    scores: { usage: 18, nps: 15, projects: 22, tickets: 20, engagement: 12, renewal: 25, value: 18 },
  },
];

const weights = {
  usage: 0.20,
  nps: 0.15,
  projects: 0.15,
  tickets: 0.15,
  engagement: 0.15,
  renewal: 0.10,
  value: 0.10,
};

const categoryMeta = {
  usage: { label: "Platform Usage", source: "Superset", icon: "📊" },
  nps: { label: "NPS Score", source: "Superset", icon: "⭐" },
  projects: { label: "Project Completion", source: "Wrike", icon: "✅" },
  tickets: { label: "Support Health", source: "Zendesk", icon: "🎫" },
  engagement: { label: "Meeting Engagement", source: "Gong", icon: "🤝" },
  renewal: { label: "Renewal & Upsell", source: "Salesforce", icon: "🔄" },
  value: { label: "Value Realization", source: "Internal", icon: "💡" },
};

const recommendations = {
  red: [
    "Schedule an executive business review within 2 weeks to address declining engagement.",
    "Escalate to CSM leadership — renewal risk is critical at current trajectory.",
    "Identify top 3 unused features and run a targeted enablement session.",
    "Review open support tickets and prioritize resolution before next check-in.",
  ],
  amber: [
    "Proactively share a product roadmap update to reinforce long-term value.",
    "Run a mid-cycle check-in focused on project timeline and blockers.",
    "Send NPS follow-up survey with a personal note from the CSM.",
    "Identify upsell opportunity aligned to customer's current workflow gaps.",
  ],
  green: [
    "Request a case study or testimonial while sentiment is strong.",
    "Introduce customer to beta features — strong adoption signals readiness.",
    "Propose expanded seat count or LOB expansion ahead of renewal.",
    "Nominate for Federato customer advisory board.",
  ],
};

function getOverallScore(scores) {
  return Math.round(
    Object.entries(scores).reduce((sum, [key, val]) => sum + val * weights[key], 0)
  );
}

function getRag(score) {
  if (score >= 70) return "green";
  if (score >= 45) return "amber";
  return "red";
}

function getRagLabel(score) {
  const r = getRag(score);
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function daysUntilRenewal(dateStr) {
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function App() {
  const [selectedId, setSelectedId] = useState(customers[0].id);
  const [sortBy, setSortBy] = useState("score");

  const customer = customers.find((c) => c.id === selectedId);
  const overallScore = getOverallScore(customer.scores);
  const rag = getRag(overallScore);
  const days = daysUntilRenewal(customer.renewalDate);

  const sorted = [...customers].sort((a, b) => {
    if (sortBy === "score") return getOverallScore(a.scores) - getOverallScore(b.scores);
    if (sortBy === "renewal") return new Date(a.renewalDate) - new Date(b.renewalDate);
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="header-logo">Federato</span>
          <span className="header-divider" />
          <span className="header-title">Customer Health Score</span>
        </div>
        <div className="header-right">
          <span className="header-badge">CSM 2 · Hackathon 2026</span>
        </div>
      </header>

      <div className="layout">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-controls">
            <span className="sidebar-label">Sort by</span>
            <select className="sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="score">Health Score</option>
              <option value="renewal">Renewal Date</option>
              <option value="name">Name</option>
            </select>
          </div>
          <div className="customer-list">
            {sorted.map((c) => {
              const score = getOverallScore(c.scores);
              const r = getRag(score);
              const d = daysUntilRenewal(c.renewalDate);
              return (
                <div
                  key={c.id}
                  className={`customer-item ${selectedId === c.id ? "selected" : ""}`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <div className="customer-item-top">
                    <span className="customer-name">{c.name}</span>
                    <span className={`rag-badge rag-${r}`}>{getRagLabel(score)}</span>
                  </div>
                  <div className="customer-item-bottom">
                    <span className="customer-score">Score: {score}</span>
                    <span className={`renewal-tag ${d < 30 ? "urgent" : ""}`}>
                      {d < 0 ? "Overdue" : `${d}d`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Main */}
        <main className="main">
          {/* Customer Header */}
          <div className="customer-header">
            <div>
              <h1 className="customer-heading">{customer.name}</h1>
              <p className="customer-meta">CSM: {customer.csm} · Renewal: {customer.renewalDate} ({days < 0 ? "Overdue" : `${days} days`})</p>
            </div>
            <div className={`overall-score rag-bg-${rag}`}>
              <span className="overall-number">{overallScore}</span>
              <span className="overall-label">{getRagLabel(overallScore)}</span>
            </div>
          </div>

          {/* Score Cards */}
          <div className="section-title">Health Breakdown</div>
          <div className="score-grid">
            {Object.entries(customer.scores).map(([key, val]) => {
              const r = getRag(val);
              const meta = categoryMeta[key];
              return (
                <div key={key} className={`score-card border-${r}`}>
                  <div className="score-card-top">
                    <span className="score-icon">{meta.icon}</span>
                    <span className={`score-tag rag-${r}`}>{val}</span>
                  </div>
                  <div className="score-card-label">{meta.label}</div>
                  <div className="score-card-source">{meta.source}</div>
                  <div className="score-bar-track">
                    <div className={`score-bar-fill fill-${r}`} style={{ width: `${val}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Recommendations */}
          <div className="section-title">Recommended Actions</div>
          <div className="recommendations">
            {recommendations[rag].map((rec, i) => (
              <div key={i} className={`rec-item rec-${rag}`}>
                <span className="rec-number">{i + 1}</span>
                <span className="rec-text">{rec}</span>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
