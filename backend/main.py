"""
=== PURPOSE ===
This is the ONLY backend file. It contains the entire FastAPI application.

=== WHY IT EXISTS ===
- Handles 3 API endpoints: extract-skills, compare, verdict
- Parses PDF resumes using PyMuPDF
- Calls Groq AI (LLaMA) to extract skills and generate assessment reasons
- Returns JSON responses to the React frontend

=== HOW IT WORKS ===
1. User uploads a PDF resume + pastes a job description
2. /extract-skills → extracts text from PDF, asks AI to find skills, validates against source
3. /compare → compares skills using normalization + synonym matching
4. /verdict → backend decides verdict deterministically, AI generates 3 concise reasons

=== HOW TO RUN ===
    python -m uvicorn main:app --reload
"""

# ──────────────────────────────────────────────
# IMPORTS
# ──────────────────────────────────────────────

import os
import json
import fitz                        # PyMuPDF — reads PDF files
from groq import Groq              # Groq AI client (fast LLaMA inference)

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ──────────────────────────────────────────────
# CONFIGURATION
# ──────────────────────────────────────────────

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY not found. Create a .env file with your key.")

client = Groq(api_key=GROQ_API_KEY)
AI_MODEL = "llama-3.3-70b-versatile"

# Reject files larger than 5MB to prevent abuse
MAX_FILE_SIZE = 5 * 1024 * 1024

# ──────────────────────────────────────────────
# FASTAPI APP SETUP
# ──────────────────────────────────────────────

app = FastAPI(title="AI Skill Gap Checker", version="2.0.0")

# Allow React frontend (localhost:5173) to call this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # Allow all origins (fine for development)
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# ──────────────────────────────────────────────
# SKILL NORMALIZATION
# Maps alternate forms → canonical name so that
# "REST APIs" and "REST API" resolve to the same key.
# Easy to extend — just add new entries.
# ──────────────────────────────────────────────

SYNONYMS: dict[str, str] = {
    "js": "javascript",
    "ts": "typescript",
    "react.js": "react",
    "reactjs": "react",
    "node.js": "nodejs",
    "node": "nodejs",
    "next.js": "nextjs",
    "vue.js": "vuejs",
    "express.js": "express",
    "fast api": "fastapi",
    "tensor flow": "tensorflow",
    "mongo db": "mongodb",
    "postgre sql": "postgresql",
    "postgres": "postgresql",
    "my sql": "mysql",
    "gen ai": "generative ai",
    "genai": "generative ai",
    "rag": "retrieval-augmented generation",
    "aws ec2": "aws",
    "aws lambda": "aws",
    "aws s3": "aws",
    "amazon web services": "aws",
    "hugging face": "huggingface",
    "rest apis": "rest api",
    "restful": "rest api",
    "restful api": "rest api",
    "restful apis": "rest api",
    "open ai": "openai",
    "openai api": "openai",
    "gcp": "google cloud",
    "google cloud platform": "google cloud",
    "k8s": "kubernetes",
    "ci cd": "ci/cd",
    "ci/cd pipelines": "ci/cd",
    "dl": "deep learning",
    "ml": "machine learning",
    "nlp": "natural language processing",
    "llm": "large language models",
    "llms": "large language models",
}


def normalize_skill(skill: str) -> str:
    """
    Converts a skill to its canonical lowercase form.
    Collapses whitespace, lowercases, then applies synonym mapping.
    Example: "REST APIs" → "rest api", "JS" → "javascript"
    """
    cleaned = " ".join(skill.lower().strip().split())
    return SYNONYMS.get(cleaned, cleaned)


# ──────────────────────────────────────────────
# PYDANTIC MODELS
# ──────────────────────────────────────────────

class CompareRequest(BaseModel):
    """Skills extracted from resume and JD, sent for comparison."""
    resume_skills: list[str]
    jd_skills: list[str]


class CompareResponse(BaseModel):
    """Comparison results with matched, missing, and bonus skills."""
    matched_skills: list[str]      # In both resume and JD
    missing_skills: list[str]      # In JD but not resume
    additional_skills: list[str]   # In resume but not JD — extra value for recruiter
    match_percentage: float        # (matched / total JD) × 100


class VerdictRequest(BaseModel):
    """Match data used to generate the hiring verdict."""
    matched_skills: list[str]
    missing_skills: list[str]
    additional_skills: list[str]
    match_percentage: float


class VerdictResponse(BaseModel):
    """Deterministic verdict + AI-generated professional evaluation."""
    verdict: str                  # "Qualified" | "Almost There" | "Not Yet"
    summary: str                  # Overview of candidate suitability
    strengths: list[str]          # Bullet points detailing why they match
    gaps: list[str]               # Bullet points detailing what is missing
    recommendation: str           # Hiring recommendation statement


# ──────────────────────────────────────────────
# HELPER FUNCTIONS
# ──────────────────────────────────────────────

def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """
    Extracts all text from a PDF loaded in memory.
    Iterates every page and concatenates the text.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    text = ""
    for page in doc:
        text += page.get_text()
    doc.close()
    return text


def validate_skills(skills: list[str], source_text: str) -> list[str]:
    """
    Anti-hallucination guard.
    Removes any AI-extracted skill that doesn't actually appear in the source text.
    Uses case-insensitive substring matching.
    Example: AI says "Kubernetes" but resume never mentions it → removed.
    """
    source_lower = source_text.lower()
    return [s for s in skills if s.lower() in source_lower]


def deduplicate_skills(skills: list[str]) -> list[str]:
    """
    Removes duplicates after normalization, preserving original casing.
    "Python" and "python" collapse to one entry. Returns sorted list.
    """
    seen: set[str] = set()
    unique: list[str] = []
    for skill in skills:
        key = normalize_skill(skill)
        if key not in seen:
            seen.add(key)
            unique.append(skill)
    return sorted(unique, key=str.lower)


async def ask_ai(prompt: str) -> dict:
    """
    Sends a prompt to Groq AI and returns parsed JSON.
    Temperature=0 for deterministic output. Strips markdown fences.
    Raises HTTPException with user-friendly message on failure.
    """
    # Call the AI — wrap in try/except for clean error messages
    try:
        response = client.chat.completions.create(
            model=AI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
    except Exception:
        raise HTTPException(status_code=503, detail="AI service is temporarily unavailable. Please try again.")

    raw_text = response.choices[0].message.content.strip()

    # Strip markdown code fences (```json ... ```) if present
    if raw_text.startswith("```"):
        raw_text = "\n".join(raw_text.split("\n")[1:-1])

    # Parse JSON — fail gracefully if AI returned garbage
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="AI returned an invalid response. Please try again.")


# ──────────────────────────────────────────────
# API ENDPOINTS
# ──────────────────────────────────────────────

@app.post("/extract-skills")
async def extract_skills(
    resume: UploadFile = File(...),
    job_description: str = Form(...)
) -> dict:
    """
    Extracts skills from both the resume PDF and job description.
    Post-validates every skill against the source text to prevent hallucination.
    """
    # ── Input validation ──
    if not resume.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    if not job_description.strip():
        raise HTTPException(status_code=400, detail="Job description cannot be empty.")

    pdf_bytes = await resume.read()

    if len(pdf_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File is too large. Maximum size is 5MB.")

    # ── PDF text extraction ──
    try:
        resume_text = extract_text_from_pdf(pdf_bytes)
    except Exception:
        raise HTTPException(status_code=400, detail="Unable to read this PDF. Please upload a valid text-based PDF.")

    if not resume_text.strip():
        raise HTTPException(status_code=400, detail="No text found in PDF. Scanned or image-based PDFs are not supported.")

    # ── AI extraction with strict anti-hallucination prompt ──
    prompt = f"""
You are a skill extraction expert.

CRITICAL RULES:
- Extract ONLY skills that are EXPLICITLY WRITTEN in the text.
- Do NOT infer, guess, or add related technologies.
- Do NOT add skills based on project descriptions or context.
- If "React" is written but "JavaScript" is NOT written, do NOT add JavaScript.
- Only include a skill if the exact word or phrase appears in the text.
- Include: languages, frameworks, tools, platforms, methodologies.

Return ONLY valid JSON:
{{"resume_skills": ["skill1", "skill2"], "jd_skills": ["skill1", "skill2"]}}

RESUME TEXT:
{resume_text}

JOB DESCRIPTION TEXT:
{job_description}
"""

    result = await ask_ai(prompt)

    # Anti-hallucination: validate each skill actually exists in its source text
    resume_skills = validate_skills(result.get("resume_skills", []), resume_text)
    jd_skills = validate_skills(result.get("jd_skills", []), job_description)

    # Normalize and remove duplicates
    resume_skills = deduplicate_skills(resume_skills)
    jd_skills = deduplicate_skills(jd_skills)

    return {"resume_skills": resume_skills, "jd_skills": jd_skills}


@app.post("/compare", response_model=CompareResponse)
async def compare_skills(data: CompareRequest) -> CompareResponse:
    """
    Compares resume vs JD skills using normalization + synonym matching.
    No AI — pure deterministic Python logic.
    Match order: exact normalized match → synonym match.
    """
    # Build lookup: normalized_form → original display name
    resume_lookup = {normalize_skill(s): s for s in data.resume_skills}
    jd_lookup = {normalize_skill(s): s for s in data.jd_skills}

    resume_keys = set(resume_lookup.keys())
    jd_keys = set(jd_lookup.keys())

    # Set operations for comparison
    matched_keys = resume_keys & jd_keys           # In both
    missing_keys = jd_keys - resume_keys            # In JD only
    additional_keys = resume_keys - jd_keys         # In resume only (bonus)

    # Percentage: matched JD skills / total JD skills
    total_jd = len(jd_keys)
    percentage = round((len(matched_keys) / total_jd) * 100, 1) if total_jd > 0 else 0.0

    # Convert normalized keys back to display names, sorted
    return CompareResponse(
        matched_skills=sorted([jd_lookup[k] for k in matched_keys], key=str.lower),
        missing_skills=sorted([jd_lookup[k] for k in missing_keys], key=str.lower),
        additional_skills=sorted([resume_lookup[k] for k in additional_keys], key=str.lower),
        match_percentage=percentage,
    )


@app.post("/verdict", response_model=VerdictResponse)
async def get_verdict(data: VerdictRequest) -> VerdictResponse:
    """
    Backend decides verdict deterministically (no AI guessing).
    AI only generates professional explanation (summary, strengths, gaps, recommendation).
    """
    # ── Deterministic verdict based on fixed thresholds ──
    pct = data.match_percentage
    if pct >= 90:
        verdict = "Qualified"
    elif pct >= 60:
        verdict = "Almost There"
    else:
        verdict = "Not Yet"

    # ── Prompt for Groq AI ──
    prompt = f"""
You are an experienced Technical Recruiter and Hiring Manager.
You are evaluating a candidate based on their skill alignment.

INPUT DETAILS:
- Match Percentage: {pct}%
- Verdict: {verdict}
- Matched Skills: {", ".join(data.matched_skills) or "None"}
- Missing Skills: {", ".join(data.missing_skills) or "None"}
- Additional Resume Skills: {", ".join(data.additional_skills) or "None"}

Write a professional evaluation of why the candidate received this verdict.

CRITICAL RULES:
- Do NOT invent or infer skills. Reference ONLY the listed skills.
- Keep explanations factual and direct.
- Avoid generic HR filler language (e.g. "The candidate shows promise").
- Every point must reference actual skills.

GUIDANCE PER VERDICT LEVEL:
- If verdict is "Not Yet" (<60% match):
  * Explain that the profile focuses elsewhere (e.g. backend/ML vs frontend) if applicable.
  * List critical missing skills.
  * Recommendation should state they are not suitable due to missing core skills.
- If verdict is "Almost There" (60%-89% match):
  * Acknowledge core backend/frontend matching skills.
  * List important missing/infrastructure technologies.
  * Recommendation should suggest upskilling or interview with focus on gaps.
- If verdict is "Qualified" (>=90% match):
  * Highlight that they match almost all requirements, listing key matching skills.
  * Mention only the very few missing skills.
  * Recommendation should suggest inviting for an interview.

Return ONLY valid JSON in this exact format:
{{
  "summary": "A 1-2 sentence overview summarizing match suitability.",
  "strengths": ["Bullet point 1 using actual matched skills", "Bullet point 2"],
  "gaps": ["Bullet point 1 using actual missing skills", "Bullet point 2"],
  "recommendation": "Overall hiring recommendation statement."
}}
"""

    result = await ask_ai(prompt)

    return VerdictResponse(
        verdict=verdict,
        summary=result.get("summary", "Assessment summary is unavailable."),
        strengths=result.get("strengths", ["Review matched skills list for details."]),
        gaps=result.get("gaps", ["Review missing skills list for details."]),
        recommendation=result.get("recommendation", "Review skill breakdown for recommendation.")
    )


# ──────────────────────────────────────────────
# HEALTH CHECK
# ──────────────────────────────────────────────

@app.get("/")
async def health_check():
    """Verify the server is running."""
    return {"status": "ok", "message": "AI Skill Gap Checker API is running"}
