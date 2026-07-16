/*
=== PURPOSE ===
Single React component — the entire UI for the Skill Gap Checker.

=== HOW IT WORKS ===
1. User uploads PDF + pastes JD → clicks "Analyze Skills"
2. Calls 3 backend APIs sequentially with step-by-step progress
3. Displays: match %, verdict badge, color-coded skill chips, reasons, processing time

=== DESIGN ===
Dark theme inspired by Linear/Vercel. Glass cards, soft borders, minimal icons.
*/

import { useState, useEffect, useRef } from "react";
import axios from "axios";
import "./App.css";

const getApiUrl = () => {
  let url = import.meta.env.VITE_API_URL || "https://skillsync-ai-ojga.onrender.com";
  url = url.trim().replace(/\/+$/, "");
  if (url && !/^https?:\/\//i.test(url)) {
    if (/localhost|127\.0\.0\.1/i.test(url)) {
      return `http://${url}`;
    }
    return `https://${url}`;
  }
  return url;
};

const API_URL = getApiUrl();

// Axios wrapper: retries once on network errors (handles Render cold starts)
const apiPost = async (url, data, config = {}) => {
  try {
    return await axios.post(url, data, { timeout: 90000, ...config });
  } catch (err) {
    // Network error (no response) = server likely waking up — retry once
    if (!err.response) {
      return await axios.post(url, data, { timeout: 90000, ...config });
    }
    throw err;
  }
};

// Steps shown during the loading sequence
const STEPS = [
  "Reading resume...",
  "Extracting skills...",
  "Comparing skills...",
  "Generating verdict...",
];

// ── Animated Counter: counts from 0 → target over 600ms ──
function AnimatedPercent({ value }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const duration = 600; // milliseconds
    const start = performance.now();

    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      // Round to 1 decimal during animation
      setDisplay(Math.round(progress * value * 10) / 10);
      if (progress < 1) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }, [value]);

  return <>{display}%</>;
}

// ── Progress Ring: SVG-based circular match indicator ──
function ProgressRing({ value }) {
  const radius = 45;
  const stroke = 6;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (value / 100) * circumference;

  const getColor = (val) => {
    if (val >= 90) return "stroke-emerald-400";
    if (val >= 60) return "stroke-amber-400";
    return "stroke-red-400";
  };

  return (
    <div className="relative flex items-center justify-center">
      <svg height={radius * 2} width={radius * 2} className="block select-none">
        {/* Background track circle */}
        <circle
          stroke="rgba(255,255,255,0.04)"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        {/* Dynamic active circle */}
        <circle
          className={`progress-ring-circle transition-all duration-700 ease-out ${getColor(value)}`}
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={circumference + " " + circumference}
          style={{ strokeDashoffset }}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
      </svg>
      {/* Center value overlay */}
      <span className="absolute text-sm font-semibold text-white tracking-tight">
        <AnimatedPercent value={value} />
      </span>
    </div>
  );
}

// ── Skill Chip: colored pill badge for matched/missing/additional ──
function SkillChip({ skill, type }) {
  const colors = {
    matched: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    missing: "bg-red-500/10 text-red-400 border-red-500/20",
    additional: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  };

  return (
    <span
      className={`inline-block px-3 py-1 rounded-full text-sm border
        transition-transform duration-150 hover:scale-105 ${colors[type]}`}
    >
      {skill}
    </span>
  );
}

// ══════════════════════════════════════════════
// MAIN APP COMPONENT
// ══════════════════════════════════════════════

function App() {
  // ── State ──
  const [file, setFile] = useState(null);
  const [jobDescription, setJobDescription] = useState("");
  const [results, setResults] = useState(null);        // CompareResponse from backend
  const [verdict, setVerdict] = useState(null);         // VerdictResponse from backend
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);    // Active loading step (0-3)
  const [error, setError] = useState("");
  const [processingTime, setProcessingTime] = useState(null);
  const errorTimerRef = useRef(null);

  // Auto-dismiss error toast after 5 seconds
  useEffect(() => {
    if (error) {
      errorTimerRef.current = setTimeout(() => setError(""), 5000);
      return () => clearTimeout(errorTimerRef.current);
    }
  }, [error]);

  // ── Main Analysis Flow ──
  const handleSubmit = async () => {
    if (!file) return setError("Please upload a resume PDF.");
    if (!jobDescription.trim()) return setError("Please paste a job description.");

    setLoading(true);
    setError("");
    setResults(null);
    setVerdict(null);
    setProcessingTime(null);

    const startTime = performance.now();

    try {
      // Step 0 → 1: Read resume → Extract skills (one API call covers both)
      setCurrentStep(0);
      const formData = new FormData();
      formData.append("resume", file);
      formData.append("job_description", jobDescription);

      // Brief pause so user sees "Reading resume" before extraction starts
      await new Promise((r) => setTimeout(r, 400));
      setCurrentStep(1);

      const extractRes = await apiPost(`${API_URL}/extract-skills`, formData);

      // Step 2: Compare skills
      setCurrentStep(2);
      const compareRes = await apiPost(`${API_URL}/compare`, {
        resume_skills: extractRes.data.resume_skills,
        jd_skills: extractRes.data.jd_skills,
      });
      setResults(compareRes.data);

      // Step 3: Generate verdict
      setCurrentStep(3);
      const verdictRes = await apiPost(`${API_URL}/verdict`, {
        matched_skills: compareRes.data.matched_skills,
        missing_skills: compareRes.data.missing_skills,
        additional_skills: compareRes.data.additional_skills,
        match_percentage: compareRes.data.match_percentage,
      });
      setVerdict(verdictRes.data);

      // Record how long the full pipeline took
      setProcessingTime(((performance.now() - startTime) / 1000).toFixed(1));
    } catch (err) {
      // Network error (no response) = server unreachable even after retry
      const msg = !err.response
        ? "Server is starting up. Please wait a moment and try again."
        : err.response?.data?.detail || "Something went wrong. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Verdict badge styling
  const verdictStyle = {
    Qualified: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    "Almost There": "bg-amber-500/15 text-amber-400 border-amber-500/30",
    "Not Yet": "bg-red-500/15 text-red-400 border-red-500/30",
  };

  // Score color based on percentage thresholds
  const scoreColor = (pct) =>
    pct >= 90 ? "text-emerald-400" : pct >= 60 ? "text-amber-400" : "text-red-400";

  // ── Render ──
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-200">

      {/* ── Error Toast ── */}
      {error && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="bg-red-500/90 backdrop-blur text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm">
            <span>{error}</span>
            <button onClick={() => setError("")} className="text-white/60 hover:text-white ml-1">✕</button>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header className="border-b border-white/[0.06] py-8">
        <div className="max-w-5xl mx-auto px-6">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Skill Gap Checker
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Compare your resume against any job description
          </p>
        </div>
      </header>

      {/* ── Main Content: 2/3 split layout ── */}
      <main className="max-w-5xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-5 gap-10">

        {/* ════════ LEFT: Input Form (2 cols) ════════ */}
        <section className="lg:col-span-2 space-y-5">

          {/* Upload Card */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Resume</p>
            <label className="block mt-3 cursor-pointer">
              <div className={`border border-dashed rounded-xl p-6 text-center transition-all duration-200 ${
                file
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-white/10 hover:border-white/20 hover:bg-white/[0.02]"
              }`}>
                {file ? (
                  <>
                    <p className="text-emerald-400 text-sm font-medium">{file.name}</p>
                    <p className="text-slate-600 text-xs mt-1">Click to change</p>
                  </>
                ) : (
                  <>
                    <p className="text-slate-400 text-sm">Upload PDF</p>
                    <p className="text-slate-600 text-xs mt-1">Max 5MB</p>
                  </>
                )}
              </div>
              <input
                id="resume-upload"
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => setFile(e.target.files[0])}
              />
            </label>
          </div>

          {/* Job Description Card */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Job Description</p>
            <textarea
              id="job-description"
              rows={10}
              placeholder="Paste the full job description here..."
              className="mt-3 w-full bg-transparent border border-white/[0.08] rounded-xl p-4 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
            />
          </div>

          {/* Analyze Button */}
          <button
            id="analyze-button"
            onClick={handleSubmit}
            disabled={loading}
            className="w-full py-3.5 rounded-xl text-sm font-medium transition-all duration-200 bg-white text-[#0a0a0f] hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" />
                Analyzing...
              </span>
            ) : (
              "Analyze Skills"
            )}
          </button>
        </section>

        {/* ════════ RIGHT: Results (3 cols) ════════ */}
        <section className="lg:col-span-3 space-y-5">

          {/* ── Loading: Step-by-step progress ── */}
          {loading && (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-8 animate-card-in">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-5">Processing</p>
              <div className="space-y-3">
                {STEPS.map((step, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full shrink-0 transition-all duration-300 ${
                      i < currentStep
                        ? "bg-emerald-400"                        // Completed
                        : i === currentStep
                        ? "bg-white animate-pulse-dot"            // Active
                        : "bg-slate-700"                          // Pending
                    }`} />
                    <span className={`text-sm transition-colors duration-200 ${
                      i <= currentStep ? "text-slate-300" : "text-slate-600"
                    }`}>
                      {step}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Empty State ── */}
          {!results && !loading && (
            <div className="bg-white/[0.02] border border-white/[0.04] rounded-2xl p-16 text-center">
              <p className="text-slate-600 text-sm">Results will appear here</p>
            </div>
          )}

          {/* ── Results ── */}
          {results && (
            <>
              {/* Score + Verdict Row */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 flex flex-col items-center justify-center text-center animate-card-in">
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-2">Match Score</p>
                  <ProgressRing value={results.match_percentage} />
                </div>

                <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 flex flex-col items-center justify-center text-center animate-card-in">
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-3">ATS Verdict</p>
                  {verdict && (
                    <span className={`inline-block px-4 py-1.5 rounded-full text-xs font-semibold border tracking-wide uppercase ${verdictStyle[verdict.verdict]}`}>
                      {verdict.verdict}
                    </span>
                  )}
                </div>

                <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 flex flex-col justify-center text-center animate-card-in space-y-3">
                  <div>
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Resume Skills Found</p>
                    <p className="text-xl font-bold mt-0.5 text-blue-400">
                      {results.matched_skills.length + results.additional_skills.length}
                    </p>
                  </div>
                  <div className="border-t border-white/[0.04] pt-2">
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">JD Skills Required</p>
                    <p className="text-xl font-bold mt-0.5 text-violet-400">
                      {results.matched_skills.length + results.missing_skills.length}
                    </p>
                  </div>
                </div>
              </div>

              {/* Matched Skills */}
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 animate-card-in">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-emerald-400/80 uppercase tracking-wider">Matched Skills</p>
                  <span className="text-xs text-slate-600">{results.matched_skills.length}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {results.matched_skills.length > 0 ? (
                    results.matched_skills.map((s) => <SkillChip key={s} skill={s} type="matched" />)
                  ) : (
                    <p className="text-slate-600 text-sm">No matching skills</p>
                  )}
                </div>
              </div>

              {/* Missing Skills */}
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 animate-card-in">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-red-400/80 uppercase tracking-wider">Missing Skills</p>
                  <span className="text-xs text-slate-600">{results.missing_skills.length}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {results.missing_skills.length > 0 ? (
                    results.missing_skills.map((s) => <SkillChip key={s} skill={s} type="missing" />)
                  ) : (
                    <p className="text-emerald-500/60 text-sm">No gaps found</p>
                  )}
                </div>
              </div>

              {/* Additional Skills (only if any exist) */}
              {results.additional_skills?.length > 0 && (
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 animate-card-in">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-blue-400/80 uppercase tracking-wider">Additional Skills</p>
                    <span className="text-xs text-slate-600">{results.additional_skills.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {results.additional_skills.map((s) => <SkillChip key={s} skill={s} type="additional" />)}
                  </div>
                </div>
              )}

              {/* Why this Result? Card */}
              {verdict && (
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 animate-card-in space-y-4">
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Why this Result?</p>
                  
                  {/* Summary Feedback */}
                  <p className="text-sm text-slate-300 leading-relaxed bg-white/[0.01] p-3.5 rounded-xl border border-white/[0.04]">
                    {verdict.summary}
                  </p>

                  <div className="space-y-4">
                    {/* Why this profile matches */}
                    {verdict.strengths?.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider mb-2">✓ Why this profile matches</p>
                        <ul className="space-y-2">
                          {verdict.strengths.map((str, idx) => (
                            <li key={idx} className="text-sm text-slate-400 flex items-start gap-2.5">
                              <span className="text-emerald-500 shrink-0 select-none mt-0.5">•</span>
                              <span>{str}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Why it does not fully match */}
                    {verdict.gaps?.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold text-red-400 uppercase tracking-wider mb-2">✗ Why it does not fully match</p>
                        <ul className="space-y-2">
                          {verdict.gaps.map((gap, idx) => (
                            <li key={idx} className="text-sm text-slate-400 flex items-start gap-2.5">
                              <span className="text-red-500 shrink-0 select-none mt-0.5">•</span>
                              <span>{gap}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Hiring Recommendation */}
                    {verdict.recommendation && (
                      <div className="pt-3 border-t border-white/[0.06]">
                        <p className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider mb-1.5">💡 Hiring Recommendation</p>
                        <p className="text-sm text-slate-300 font-medium leading-relaxed">
                          {verdict.recommendation}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Processing Time */}
              {processingTime && (
                <p className="text-xs text-slate-600 text-right">
                  Completed in {processingTime}s
                </p>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
