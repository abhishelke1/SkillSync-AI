# 🎯 AI Skill Gap Checker

An AI-powered tool that compares your resume against a job description to identify skill gaps, match percentage, and hiring readiness.

## Architecture

```
┌──────────────┐         ┌──────────────────┐         ┌─────────────┐
│    React     │  axios  │    FastAPI        │  API    │  Groq AI    │
│   Frontend   │────────▶│    Backend        │────────▶│  (LLaMA)    │
│  (Vite)      │◀────────│                   │◀────────│             │
└──────────────┘   JSON  │  ┌────────────┐   │  JSON   └─────────────┘
                         │  │  PyMuPDF   │   │
                         │  │ (PDF Parse) │  │
                         │  └────────────┘   │
                         └──────────────────┘
```

**Flow:**
1. User uploads resume PDF + pastes job description
2. Backend extracts text from PDF using PyMuPDF
3. Groq AI (LLaMA model) extracts skills from both texts
4. Backend compares skills using Python set operations
5. Groq AI generates a verdict (Qualified / Almost There / Not Yet)
6. Frontend displays results in styled cards

## Tech Stack

| Layer    | Technology         | Why                                      |
|----------|--------------------|------------------------------------------|
| Frontend | React + Vite       | Fast dev server, component-based UI      |
| Styling  | TailwindCSS (CDN)  | Utility-first CSS, no build config       |
| HTTP     | Axios              | Simple promise-based HTTP client         |
| Backend  | FastAPI             | Async Python, auto-docs, Pydantic models |
| PDF      | PyMuPDF             | Fast, reliable PDF text extraction       |
| AI       | Groq (LLaMA 3.3 70B)| Free tier, ultra-fast inference          |

## API Endpoints

| Method | Endpoint          | Input                      | Output                                  |
|--------|-------------------|----------------------------|------------------------------------------|
| POST   | `/extract-skills` | PDF file + JD text         | `{resume_skills, jd_skills}`            |
| POST   | `/compare`        | Two skill lists            | `{matched_skills, missing_skills, %}`   |
| POST   | `/verdict`        | Match data                 | `{verdict, reasons[]}`                  |
| GET    | `/`               | None                       | Health check                             |

## Installation & Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- Groq API Key ([Get free key here](https://console.groq.com/))

### 1. Clone the Repository

```bash
git clone <repo-url>
cd ai-skill-gap-checker
```

### 2. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate it
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file with your API key
cp .env.example .env
# Edit .env and add your GROQ_API_KEY
```

### 3. Frontend Setup

```bash
cd frontend
npm install
```

## Running the Application

### Start Backend (Terminal 1)

```bash
cd backend
python -m uvicorn main:app --reload
```

Backend runs at: http://localhost:8000
API docs at: http://localhost:8000/docs

### Start Frontend (Terminal 2)

```bash
cd frontend
npm run dev
```

Frontend runs at: http://localhost:5173

## Environment Variables

| Variable        | Required | Description                          |
|-----------------|----------|--------------------------------------|
| `GROQ_API_KEY`  | Yes      | Groq API key                         |

## Project Structure

```
├── backend/
│   ├── main.py              # Entire backend (endpoints, models, AI)
│   ├── requirements.txt     # Python dependencies
│   ├── .env.example         # Environment variable template
│   └── .env                 # Your actual API key (git-ignored)
│
├── frontend/
│   ├── index.html           # HTML entry + TailwindCSS CDN
│   ├── src/
│   │   ├── main.jsx         # React entry point
│   │   ├── App.jsx          # Entire UI (single component)
│   │   └── App.css          # Custom animations (spinner, toast)
│   ├── package.json         # Node dependencies
│   └── vite.config.js       # Vite configuration
│
├── README.md                # This file
└── INTERVIEW_PREP.md        # Interview Q&A and architecture notes
```

## Screenshots

> Screenshots will be added after first run.

| Screen | Description |
|--------|-------------|
| ![Home](screenshots/home.png) | Initial upload screen |
| ![Results](screenshots/results.png) | Analysis results |

## Future Improvements

- **Authentication** — Add user login to save analysis history
- **Database** — Store past analyses in PostgreSQL
- **Multiple AI Providers** — Support OpenAI, Anthropic as alternatives
- **Batch Analysis** — Upload multiple resumes at once
- **Skill Recommendations** — Suggest courses for missing skills
- **Export** — Download results as PDF report
- **Docker** — Containerize for one-command deployment

## License

MIT
