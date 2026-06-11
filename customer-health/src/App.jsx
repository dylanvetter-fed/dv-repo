import { useState, useRef, useEffect } from "react";
import "./App.css";
import RAW_RUNS from "./agent_account_runs_dummy.json";

// ─── ACCOUNT META ─────────────────────────────────────────────────────────────
const ACCOUNT_META = {
  missionuw: { licensed_seats: 60 },
  velocity:  { licensed_seats: 60 },
  qbe:       { licensed_seats: 120 },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function scoreToRag(s) { return s >= 80 ? "GREEN" : s >= 65 ? "AMBER" : "RED"; }
function formatDate(iso) {
  if (!iso) return "TBD";
  try { return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  catch { return iso; }
}
function formatFullDate(iso) {
  if (!iso) return "";
  try { return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return iso; }
}
const QTB_LABEL = { exceeding: "Exceeding", on_target: "On target", slightly_below: "Slightly below", below_target: "Below target", strong: "Strong" };
const NB_LABEL  = { on_track: "On track", strong: "Strong", slightly_below: "Slightly below", below_target: "Below target", above_target: "Above target" };
function qtbCls(v) { return ["exceeding","on_target","strong"].includes(v) ? "g" : v === "slightly_below" ? "a" : "r"; }
function nbCls(v)  { return ["on_track","strong","above_target"].includes(v) ? "g" : v === "slightly_below" ? "a" : "r"; }
function ragPillClass(rag) { return rag === "RED" ? "pill-red" : rag === "AMBER" ? "pill-amber" : "pill-green"; }
function bulletSummary(text, n) {
  const parts = text.match(/[^.!?]+[.!?]+/g) || [text];
  return parts.slice(0, n).map(s => s.trim());
}

function computeChurnRisk(uf, zf, inf, ef, dauPct) {
  let signals = [];
  if (dauPct < 35)                            signals.push({ label: "Low DAU", weight: 3 });
  if (uf.survey_trend === "declining")         signals.push({ label: "Declining satisfaction", weight: 3 });
  if (uf.avg_combined_score && uf.avg_combined_score < 3.5) signals.push({ label: "Low survey scores", weight: 2 });
  if (zf.sev1_open > 0)                       signals.push({ label: "Open Sev-1", weight: 3 });
  if (zf.reopens > 1)                         signals.push({ label: "Recurring issues", weight: 2 });
  if (zf.avg_full_resolution_days > 10)       signals.push({ label: "Slow resolution", weight: 1 });
  if (ef.gong_calls_30d < 2)                  signals.push({ label: "Low exec engagement", weight: 2 });
  if (ef.ebr_status !== "on_schedule")        signals.push({ label: "EBR overdue", weight: 2 });
  if (ef.expansion_conversation_logged === false && ef.renewal_days_out < 90) signals.push({ label: "No expansion talk", weight: 1 });
  if (inf.milestones_at_risk > 1)             signals.push({ label: "Milestones slipping", weight: 2 });
  if (ef.renewal_days_out < 60)               signals.push({ label: "Renewal imminent", weight: 1 });
  const score = signals.reduce((sum, s) => sum + s.weight, 0);
  const level = score >= 8 ? "high" : score >= 4 ? "medium" : "low";
  return { level, signals, score };
}

// ─── TRANSFORM ────────────────────────────────────────────────────────────────
function transformRuns(rows) {
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.account_id]) grouped[row.account_id] = {};
    grouped[row.account_id][row.agent_id] = { ...row, metadata: JSON.parse(row.metadata), alerts: JSON.parse(row.alerts) };
  }
  const customers = {};
  for (const [accountId, agents] of Object.entries(grouped)) {
    const u = agents["adoption_utilization_agent"];
    const z = agents["zendesk_support_agent"];
    const im = agents["implementation_agent"];
    const ex = agents["executive_alignment_agent"];
    if (!u || !z || !im || !ex) continue;
    const uf = u.metadata.raw_findings, zf = z.metadata.raw_findings;
    const inf = im.metadata.raw_findings, ef = ex.metadata.raw_findings;
    const meta = ACCOUNT_META[accountId] || { licensed_seats: 100 };

    const scores = [u, z, im, ex].map(a => a.health_score_value).filter(v => v != null);
    const compositeScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const rag = scoreToRag(compositeScore);

    const mapAlert = al => ({ type: al.severity, icon: al.severity === "critical" ? "🚨" : "⚠️", title: al.title, desc: al.detail, source: al.data_source });
    const alertsByVital = {
      adoption:   u.alerts.map(mapAlert),
      support:    z.alerts.map(mapAlert),
      delivery:   im.alerts.map(mapAlert),
      engagement: ex.alerts.map(mapAlert),
    };
    const allAlerts = [u, z, im, ex].flatMap(a => a.alerts).sort((a, b) => a.severity === "critical" ? -1 : 1).slice(0, 3).map(mapAlert);

    const dauPct  = Math.round((uf.active_users_prod / meta.licensed_seats) * 100);
    const dauCls  = dauPct >= 60 ? "g" : dauPct >= 35 ? "a" : "r";
    const dauTrend = uf.survey_trend === "improving" ? "↑ Improving" : uf.survey_trend === "declining" ? "↓ Declining" : "→ Stable";
    const steercoStr = `Last: ${formatDate(ef.steerco_last)} · Next: ${ef.steerco_next ? formatDate(ef.steerco_next) : "TBD"}`;
    const ebrStr     = ef.ebr_status === "on_schedule" ? `Last: ${ef.ebr_last} · On schedule` : `Last: ${ef.ebr_last} — Overdue`;
    const gongStr    = `${ef.gong_calls_30d} call${ef.gong_calls_30d !== 1 ? "s" : ""} in 30 days`;
    const gongClass  = ef.gong_calls_30d >= 3 ? "g" : ef.gong_calls_30d >= 2 ? "a" : "r";

    const fullSummary = [u, im, z, ex].map(a => a.reasoning).join(" ");
    const churnRisk   = computeChurnRisk(uf, zf, inf, ef, dauPct);
    const actions = allAlerts.map(al => ({ text: al.title, urgency: al.type === "critical" ? "Urgent" : "This week" }));
    if (actions.length < 3 && ef.renewal_days_out <= 90) actions.push({ text: `Prep renewal conversation — ${ef.renewal_days_out} days out`, urgency: "This week" });

    customers[accountId] = {
      name: u.account_name, rag, score: compositeScore,
      arr: ef.arr, csm: ef.csm, renewalDays: ef.renewal_days_out, renewal: `${ef.renewal_days_out} days`,
      flags: allAlerts, alertsByVital, fullSummary, actions, churnRisk, gongCalls: ef.gong_calls || [], gongSentiment: ef.gong_sentiment,
      agentScores: [
        { label: "Adoption",   value: u.health_score_value,  cls: u.health_score_label  },
        { label: "Support",    value: z.health_score_value,  cls: z.health_score_label  },
        { label: "Delivery",   value: im.health_score_value, cls: im.health_score_label },
        { label: "Engagement", value: ex.health_score_value, cls: ex.health_score_label },
      ],
      adoption: {
        dau: `${dauPct}%`, dauPct, dauTrend, dauClass: dauCls,
        seats: `${uf.active_users_prod} / ${meta.licensed_seats} active`, seatsClass: dauCls,
        moduleCoverage: uf.module_coverage, modulesTouched: uf.modules_touched || [],
        errorRate: uf.error_rate_pct, surveyScore: uf.avg_combined_score,
      },
      delivery: {
        milestones: `${inf.milestones_on_track} / ${inf.milestones_total} on track`,
        milestonesOn: inf.milestones_on_track, milestonesTotal: inf.milestones_total,
        milestonesClass: inf.milestones_at_risk === 0 ? "g" : inf.milestones_at_risk <= 1 ? "a" : "r",
        combinedRatio: inf.combined_ratio,
        combinedClass: parseInt(inf.combined_ratio) < 96 ? "g" : parseInt(inf.combined_ratio) < 101 ? "a" : "r",
        qtb: QTB_LABEL[inf.qtb] || inf.qtb, qtbClass: qtbCls(inf.qtb),
        newBusiness: NB_LABEL[inf.new_business] || inf.new_business, nbClass: nbCls(inf.new_business),
        renewals: NB_LABEL[inf.renewals] || inf.renewals, renClass: ["on_track","strong"].includes(inf.renewals) ? "g" : "r",
        claims: `${inf.claims_open} open / ${inf.claims_closed} closed`, claimsClass: inf.claims_open < inf.claims_closed ? "g" : "a",
      },
      support: {
        releases: `${zf.releases_6mo} releases, ${zf.patches_6mo} patches (6 mo)`,
        relClass: zf.patches_6mo <= 5 ? "g" : zf.patches_6mo <= 8 ? "a" : "r",
        sev1: `${zf.sev1_open} open`, sev1Open: zf.sev1_open,
        sev1Class: zf.sev1_open === 0 ? "g" : zf.sev1_open === 1 ? "a" : "r",
        sev2: `${zf.sev2_open} open`, sev2Open: zf.sev2_open,
        sev2Class: zf.sev2_open === 0 ? "g" : zf.sev2_open <= 2 ? "a" : "r",
        reopened: `${zf.reopens} re-opened`, reopenClass: zf.reopens === 0 ? "g" : zf.reopens <= 1 ? "a" : "r",
        resTime: `Avg ${zf.avg_full_resolution_days}d`,
        resClass: zf.avg_full_resolution_days <= 3 ? "g" : zf.avg_full_resolution_days <= 7 ? "a" : "r",
      },
      engagement: {
        steerco: steercoStr, steercoClass: ef.steerco_status === "on_schedule" ? "g" : "r",
        ebr: ebrStr, ebrClass: ef.ebr_status === "on_schedule" ? "g" : "r",
        gong: gongStr, gongClass, gongCalls30d: ef.gong_calls_30d,
      },
    };
  }
  return customers;
}

const customers = transformRuns(RAW_RUNS);

// ─── SCORE RING ───────────────────────────────────────────────────────────────
function ScoreRing({ score, rag }) {
  const r = 28, cx = 34, cy = 34, circ = 2 * Math.PI * r;
  const dash  = circ * Math.min(score, 100) / 100;
  const color = rag === "GREEN" ? "#2a7a3a" : rag === "AMBER" ? "#c87820" : "#c84040";
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e8e4dc" strokeWidth="5" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${dash} ${circ}`} strokeDashoffset={circ * 0.25} strokeLinecap="round" />
      <text x={cx} y={cy - 4} textAnchor="middle" fill={color} fontSize="15" fontWeight="700" fontFamily="-apple-system,sans-serif">{score}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="#9a9a8e" fontSize="9" fontFamily="-apple-system,sans-serif">/100</text>
    </svg>
  );
}

// ─── CHURN BADGE ──────────────────────────────────────────────────────────────
const CHURN_REASONING = {
  high:   "Multiple compounding risk signals detected — immediate intervention recommended.",
  medium: "Some friction signals present. Monitor closely and address before renewal window.",
  low:    "No significant churn indicators. Maintain engagement cadence.",
};
function ChurnBadge({ risk }) {
  const [open, setOpen] = useState(false);
  const cfg = { high: { label: "High churn risk", cls: "churn-high" }, medium: { label: "Medium churn risk", cls: "churn-medium" }, low: { label: "Low churn risk", cls: "churn-low" } }[risk.level];
  return (
    <div className={`churn-badge ${cfg.cls} ${open ? "churn-open" : ""}`} onClick={() => setOpen(!open)}>
      <span className="churn-dot" />
      <span className="churn-label">{cfg.label}</span>
      <span className="churn-chevron">▼</span>
      {open && (
        <div className="churn-panel" onClick={e => e.stopPropagation()}>
          <div className="churn-reasoning">{CHURN_REASONING[risk.level]}</div>
          {risk.signals.length > 0 ? (
            <>
              <div className="churn-signals-title">Contributing signals</div>
              {risk.signals.map((s, i) => (
                <div key={i} className="churn-signal-row">
                  <span className="churn-signal-name">{s.label}</span>
                  <div className="churn-signal-dots">{[1,2,3].map(n => <span key={n} className={`churn-dot-pip ${n <= s.weight ? "pip-on" : "pip-off"}`} />)}</div>
                </div>
              ))}
            </>
          ) : <div className="churn-no-signals">No risk signals detected across adoption, support, delivery, or engagement.</div>}
        </div>
      )}
    </div>
  );
}

// ─── VITAL ALERT BANNER ───────────────────────────────────────────────────────
function VitalBanner({ alerts }) {
  if (!alerts || alerts.length === 0) return null;
  const top = alerts[0];
  return (
    <div className={`vital-banner ${top.type === "critical" ? "vb-critical" : "vb-warning"}`}>
      <span className="vb-icon">{top.icon}</span>
      <span className="vb-text">{top.title}</span>
    </div>
  );
}

// ─── VITAL ALERTS (expanded) ──────────────────────────────────────────────────
function VitalAlerts({ alerts }) {
  const [openIdx, setOpenIdx] = useState(null);
  if (!alerts || alerts.length === 0) return null;
  return (
    <div className="vital-alerts">
      {alerts.map((a, i) => (
        <div key={i}
          className={`vital-alert-row ${a.type === "critical" ? "va-critical" : "va-warning"} ${openIdx === i ? "va-open" : ""}`}
          onClick={() => setOpenIdx(openIdx === i ? null : i)}>
          <span className="va-icon">{a.icon}</span>
          <span className="va-title">{a.title}</span>
          <span className="va-chevron">▼</span>
          {openIdx === i && <div className="va-body">{a.desc}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── VITAL CARD ───────────────────────────────────────────────────────────────
function VitalCard({ icon, label, value, sub, cls, score, alerts, children }) {
  const [open, setOpen] = useState(false);
  const scoreColor = score >= 80 ? "#2a7a3a" : score >= 65 ? "#c87820" : "#c84040";
  const hasCritical = alerts && alerts.some(a => a.type === "critical");
  const hasWarning  = alerts && alerts.length > 0 && !hasCritical;
  return (
    <div className={`vital-card ${open ? "vital-card-open" : ""}`}>
      <VitalBanner alerts={open ? [] : alerts} />
      <div className="vital-card-main" onClick={() => setOpen(!open)}>
        <div className="vital-top">
          <span className="vital-icon">{icon}</span>
          <span className="vital-label">{label}</span>
          {!open && hasCritical && <span className="vital-alert-dot vad-critical" />}
          {!open && hasWarning  && <span className="vital-alert-dot vad-warning"  />}
          {score && <span className="vital-score" style={{ color: scoreColor }}>{score}</span>}
          <span className="evc-chevron">▼</span>
        </div>
        <div className={`vital-value mr-val ${cls}`}>{value}</div>
        <div className="vital-sub">{sub}</div>
      </div>
      {open && <div className="vital-card-detail">{children}</div>}
    </div>
  );
}

// ─── METRIC ROW ───────────────────────────────────────────────────────────────
function MetricRow({ label, value, cls }) {
  return (
    <div className="metric-row">
      <span className="mr-label">{label}</span>
      <span className={`mr-val ${cls}`}>{value}</span>
    </div>
  );
}

// ─── AI SUMMARY + CHAT ────────────────────────────────────────────────────────
function AISummaryChat({ bullets, customer }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const userMsg = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    try {
      const systemPrompt = `You are a customer success intelligence assistant analyzing the account "${customer.name}" for Federato. 
Here is the account context:
- ARR: ${customer.arr} | CSM: ${customer.csm} | Renewal in: ${customer.renewalDays} days
- Health score: ${customer.score}/100 (${customer.rag})
- Churn risk: ${customer.churnRisk.level}
- Adoption: ${customer.adoption.dau} DAU, ${customer.adoption.seats}, ${customer.adoption.moduleCoverage}/8 modules active
- Delivery: ${customer.delivery.milestones}, combined ratio ${customer.delivery.combinedRatio}
- Support: ${customer.support.sev1} Sev-1, ${customer.support.sev2} Sev-2, ${customer.support.resTime}
- Engagement: ${customer.engagement.gong}, SteerCo: ${customer.engagement.steerco}
- Active flags: ${customer.flags.map(f => f.title).join("; ") || "None"}
- Summary: ${bullets.join(" ")}

Answer questions about this account concisely. Be direct, specific, and data-driven. 2-4 sentences max unless asked for more.`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: systemPrompt,
          messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      const reply = data.content?.[0]?.text || "No response.";
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
    }
    setLoading(false);
  }

  const SUGGESTIONS = ["What's the biggest churn risk?", "What should I do before the renewal?", "How does this account compare to healthy ones?"];

  return (
    <div className="ai-panel">
      {/* Left: bullets */}
      <div className="ai-summary-card">
        <div className="ai-summary-label"><span className="ai-dot" />&nbsp;AI Summary</div>
        <ul className="ai-bullets">
          {bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      </div>

      {/* Right: chat */}
      <div className="ai-chat">
        <div className="ai-chat-header">
          <span className="ai-dot" />&nbsp;Ask anything about {customer.name}
        </div>

        <div className="ai-chat-messages">
          {messages.length === 0 && (
            <div className="ai-chat-suggestions">
              {SUGGESTIONS.map((s, i) => (
                <button key={i} className="ai-suggestion" onClick={() => { setInput(s); }}>
                  {s}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`ai-msg ${m.role === "user" ? "ai-msg-user" : "ai-msg-ai"}`}>
              {m.content}
            </div>
          ))}
          {loading && <div className="ai-msg ai-msg-ai ai-typing"><span /><span /><span /></div>}
          <div ref={bottomRef} />
        </div>

        <div className="ai-chat-input-row">
          <input
            className="ai-chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()}
            placeholder="Ask about this account…"
          />
          <button className="ai-chat-send" onClick={send} disabled={!input.trim() || loading}>↑</button>
        </div>
      </div>
    </div>
  );
}

// ─── GONG TIMELINE ────────────────────────────────────────────────────────────
function GongTimeline({ calls, sentiment }) {
  if (!calls || !calls.length) return null;
  const sentCls = sentiment === "positive" ? "g" : sentiment === "negative" ? "r" : "a";
  return (
    <div className="gong-timeline-wrap">
      <div className="gong-timeline-header">
        <div className="section-eyebrow" style={{ marginBottom: 0 }}>🎙 Recent Gong calls</div>
        <span className={`gong-sentiment-chip mr-val ${sentCls}`}>{sentiment === "positive" ? "Positive sentiment" : sentiment === "negative" ? "Negative sentiment" : "Neutral sentiment"}</span>
      </div>
      <div className="gong-timeline">
        {calls.map((call, i) => <GongCallRow key={i} call={call} isLast={i === calls.length - 1} />)}
      </div>
    </div>
  );
}

function GongCallRow({ call, isLast }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`gong-item ${isLast ? "gong-item-last" : ""}`}>
      <div className="gong-item-line">
        <div className="gong-item-dot" />
        {!isLast && <div className="gong-item-connector" />}
      </div>
      <div className="gong-item-content" onClick={() => setOpen(!open)}>
        <div className="gong-item-head">
          <span className="gong-date">{formatFullDate(call.date)}</span>
          <span className="gong-title">{call.title}</span>
          <span className={`gong-chevron ${open ? "open" : ""}`}>▼</span>
        </div>
        {open && <div className="gong-takeaway"><span className="gong-takeaway-label">Key takeaway</span>{call.takeaway}</div>}
      </div>
    </div>
  );
}

// ─── CUSTOMER DETAIL ──────────────────────────────────────────────────────────
function CustomerDetail({ id, onBack }) {
  const c = customers[id];
  const bullets = bulletSummary(c.fullSummary, 4);
  const supportVal = c.support.sev1Open > 0 ? `${c.support.sev1Open} Sev-1 open` : c.support.sev2Open > 0 ? `${c.support.sev2Open} Sev-2 open` : "All clear";
  const supportCls = c.support.sev1Open > 0 ? "r" : c.support.sev2Open > 0 ? "a" : "g";

  return (
    <div className="detail-wrap">
      <button className="back-btn" onClick={onBack}>← All customers</button>

      <div className="detail-header">
        <div className="detail-header-left">
          <ScoreRing score={c.score} rag={c.rag} />
          <div className="detail-header-text">
            <div className="detail-name">{c.name}</div>
            <div className="detail-meta">{c.arr} ARR · CSM: {c.csm}</div>
            <div className="detail-header-chips">
              <ChurnBadge risk={c.churnRisk} />
              <span className={`renewal-chip ${c.renewalDays < 60 ? "renewal-chip-urgent" : c.renewalDays < 120 ? "renewal-chip-watch" : "renewal-chip-ok"}`}>
                🗓 {c.renewalDays}d to renewal
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="vitals-strip">
        <VitalCard icon="📈" label="Adoption" value={c.adoption.dau} alerts={c.alertsByVital.adoption}
          sub={c.adoption.seats} cls={c.adoption.dauClass} score={c.agentScores.find(s => s.label === "Adoption")?.value}>
          <MetricRow label="DAU trend"      value={c.adoption.dauTrend}                cls={c.adoption.dauClass} />
          <MetricRow label="Active seats"   value={c.adoption.seats}                   cls={c.adoption.seatsClass} />
          <MetricRow label="Modules active" value={`${c.adoption.moduleCoverage} / 8`} cls={c.adoption.moduleCoverage >= 5 ? "g" : c.adoption.moduleCoverage >= 3 ? "a" : "r"} />
          {c.adoption.surveyScore && <MetricRow label="Avg survey score" value={`${c.adoption.surveyScore}/7`} cls={c.adoption.surveyScore >= 5 ? "g" : c.adoption.surveyScore >= 4 ? "a" : "r"} />}
          {c.adoption.modulesTouched.length > 0 && <div className="module-chips">{c.adoption.modulesTouched.map((m, i) => <span key={i} className="module-chip">{m.replace(/_/g, " ")}</span>)}</div>}
          <VitalAlerts alerts={c.alertsByVital.adoption} />
        </VitalCard>

        <VitalCard icon="🎯" label="Delivery" alerts={c.alertsByVital.delivery}
          value={`${c.delivery.milestonesOn} / ${c.delivery.milestonesTotal} milestones`}
          sub={`Combined ratio ${c.delivery.combinedRatio}`}
          cls={c.delivery.milestonesClass} score={c.agentScores.find(s => s.label === "Delivery")?.value}>
          <MetricRow label="QTB ratio"    value={c.delivery.qtb}         cls={c.delivery.qtbClass} />
          <MetricRow label="New business" value={c.delivery.newBusiness} cls={c.delivery.nbClass} />
          <MetricRow label="Renewals"     value={c.delivery.renewals}    cls={c.delivery.renClass} />
          <MetricRow label="Claims"       value={c.delivery.claims}      cls={c.delivery.claimsClass} />
          <VitalAlerts alerts={c.alertsByVital.delivery} />
        </VitalCard>

        <VitalCard icon="🛠" label="Support" value={supportVal} alerts={c.alertsByVital.support}
          sub={`Avg ${c.support.resTime.replace("Avg ", "")} resolution`}
          cls={supportCls} score={c.agentScores.find(s => s.label === "Support")?.value}>
          <MetricRow label="Sev-1 open"     value={c.support.sev1}     cls={c.support.sev1Class} />
          <MetricRow label="Sev-2 open"     value={c.support.sev2}     cls={c.support.sev2Class} />
          <MetricRow label="Re-opened"      value={c.support.reopened} cls={c.support.reopenClass} />
          <MetricRow label="Release health" value={c.support.releases} cls={c.support.relClass} />
          <VitalAlerts alerts={c.alertsByVital.support} />
        </VitalCard>

        <VitalCard icon="🤝" label="Engagement" value={c.engagement.gong} alerts={c.alertsByVital.engagement}
          sub={c.engagement.steerco} cls={c.engagement.gongClass} score={c.agentScores.find(s => s.label === "Engagement")?.value}>
          <MetricRow label="SteerCo"  value={c.engagement.steerco} cls={c.engagement.steercoClass} />
          <MetricRow label="EBR"      value={c.engagement.ebr}     cls={c.engagement.ebrClass} />
          <MetricRow label="Gong 30d" value={c.engagement.gong}    cls={c.engagement.gongClass} />
          <VitalAlerts alerts={c.alertsByVital.engagement} />
        </VitalCard>
      </div>

      <AISummaryChat bullets={bullets} customer={c} />
      <GongTimeline calls={c.gongCalls} sentiment={c.gongSentiment} />

      <div className="actions-card">
        <div className="actions-header">
          <span className="section-eyebrow" style={{ marginBottom: 0 }}>Recommended actions</span>
        </div>
        {c.actions.map((a, i) => {
          const cls = a.urgency === "Urgent" ? "pill-red" : a.urgency === "This week" ? "pill-amber" : "pill-green";
          return (
            <div key={i} className="rec-item">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                <span className="rec-title">{a.text}</span>
                <span className={`pill ${cls}`}>{a.urgency}</span>
              </div>
            </div>
          );
        })}
        <button className="btn-full">Draft exec outreach email for {c.name} ↗</button>
      </div>
    </div>
  );
}

// ─── LANDING ──────────────────────────────────────────────────────────────────
function Landing({ customers }) {
  const all = Object.values(customers);
  const critical = all.filter(c => c.rag === "RED");
  const atRisk   = all.filter(c => c.rag === "AMBER");
  const healthy  = all.filter(c => c.rag === "GREEN");
  return (
    <div className="landing">
      <div className="landing-eyebrow">Customer Health Intelligence</div>
      <div className="landing-title">Know which accounts need you today</div>
      <div className="landing-sub">Real-time health scoring across adoption, delivery, support, and executive engagement.</div>
      <div className="landing-stats">
        <div className="ls-stat ls-stat-r"><span className="ls-num">{critical.length}</span><span className="ls-lbl">At risk</span></div>
        <div className="ls-stat ls-stat-a"><span className="ls-num">{atRisk.length}</span><span className="ls-lbl">Watch</span></div>
        <div className="ls-stat ls-stat-g"><span className="ls-num">{healthy.length}</span><span className="ls-lbl">Healthy</span></div>
      </div>
      <div className="landing-cta"><span className="landing-cta-arrow">←</span><span>Select an account to begin</span></div>
      <div className="landing-cards">
        {[
          { icon: "📈", title: "Adoption",   desc: "DAU, seat utilization, module coverage" },
          { icon: "🎯", title: "Delivery",   desc: "Milestones, business outcomes, claims" },
          { icon: "🛠",  title: "Support",    desc: "Ticket severity, resolution, patch cadence" },
          { icon: "🤝", title: "Engagement", desc: "Gong calls, SteerCo, EBR cadence" },
        ].map((card, i) => (
          <div key={i} className="landing-card">
            <div className="lc-icon">{card.icon}</div>
            <div className="lc-title">{card.title}</div>
            <div className="lc-desc">{card.desc}</div>
          </div>
        ))}
      </div>
      {critical.length > 0 && <div className="landing-alert"><strong>{critical.length} account{critical.length > 1 ? "s" : ""} require immediate attention</strong>{` — ${critical.map(c => c.name).join(" and ")}`}</div>}
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [selectedId, setSelectedId] = useState(null);
  const ragOrder = { RED: 0, AMBER: 1, GREEN: 2 };
  const customerOrder = Object.keys(customers).sort((a, b) => {
    const diff = ragOrder[customers[a].rag] - ragOrder[customers[b].rag];
    return diff !== 0 ? diff : customers[a].name.localeCompare(customers[b].name);
  });

  return (
    <div className="root">
      <div className="topnav">
        <div>
          <div className="topnav-brand">Federato Customer Health Score</div>
          <div className="topnav-sub">Customer health intelligence · Last updated 6 min ago</div>
        </div>
        <div className="topnav-right">Jun 10, 2026</div>
      </div>
      <div className="layout">
        <div className="leftnav">
          <div className="leftnav-section">Customers</div>
          {customerOrder.map((id) => {
            const c = customers[id];
            const ragClass = c.rag === "RED" ? "rag-r" : c.rag === "AMBER" ? "rag-a" : "rag-g";
            return (
              <div key={id} className={`customer-item ${selectedId === id ? "active" : ""}`} onClick={() => setSelectedId(id)}>
                <div className="cust-info">
                  <span className="cust-name">{c.name}</span>
                  {c.renewalDays < 90 && <span className="cust-renewal">{c.renewalDays}d renewal</span>}
                </div>
                <div className="cust-right">
                  {c.flags.length > 0 && <span className="cust-flag">{c.flags.length}</span>}
                  <span className={`cust-rag ${ragClass}`} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="main">
          {selectedId ? <CustomerDetail id={selectedId} onBack={() => setSelectedId(null)} /> : <Landing customers={customers} />}
        </div>
      </div>
    </div>
  );
}
