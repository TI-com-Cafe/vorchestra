import { Template } from "../types";

export const PYTHON_TEMPLATES: Template[] = [
  { id: "none", name: "Empty Environment", pkgs: [] },
  { 
    id: "fastapi", 
    name: "API: FastAPI Service",
    pkgs: ["fastapi", "uvicorn[standard]", "pydantic-settings", "httpx", "sqlalchemy", "alembic"]
  },
  { 
    id: "django", 
    name: "Web: Django + REST API",
    pkgs: ["django", "djangorestframework", "django-cors-headers", "gunicorn", "whitenoise", "psycopg[binary]"]
  },
  { 
    id: "flask", 
    name: "Web: Flask Service",
    pkgs: ["flask", "flask-sqlalchemy", "flask-cors", "python-dotenv", "gunicorn"]
  },
  {
    id: "streamlit",
    name: "Data App: Streamlit Dashboard",
    pkgs: ["streamlit", "pandas", "plotly", "altair", "python-dotenv"]
  },
  { 
    id: "data", 
    name: "Data: Notebook Analytics",
    pkgs: ["numpy", "pandas", "polars", "matplotlib", "seaborn", "scipy", "jupyterlab", "ipykernel"]
  },
  {
    id: "ml",
    name: "ML: Classical Machine Learning",
    pkgs: ["scikit-learn", "pandas", "numpy", "joblib", "matplotlib", "shap"]
  },
  { 
    id: "llm", 
    name: "AI: LLM Apps & RAG",
    pkgs: ["openai", "anthropic", "langchain", "langchain-community", "chromadb", "tiktoken", "python-dotenv"]
  },
  { 
    id: "scraping", 
    name: "Automation: Web Scraping",
    pkgs: ["requests", "httpx", "beautifulsoup4", "lxml", "playwright", "selectolax"]
  },
  {
    id: "cli",
    name: "Automation: CLI & Local Tools",
    pkgs: ["typer", "rich", "click", "pydantic-settings", "python-dotenv", "schedule"]
  },
  {
    id: "workers",
    name: "Backend: Workers & Queues",
    pkgs: ["celery", "redis", "rq", "apscheduler", "python-dotenv"]
  },
  {
    id: "api-client",
    name: "Integration: API Client",
    pkgs: ["httpx", "requests", "tenacity", "pydantic", "python-dotenv"]
  },
  { 
    id: "testing", 
    name: "Quality: Modern Testing & QA",
    pkgs: ["pytest", "pytest-cov", "ruff", "mypy", "pre-commit", "tox"]
  },
  {
    id: "library",
    name: "Package: Library Authoring",
    pkgs: ["build", "twine", "hatchling", "pytest", "ruff", "mypy"]
  },
  {
    id: "docs",
    name: "Docs: MkDocs Site",
    pkgs: ["mkdocs-material", "mkdocstrings[python]", "pymdown-extensions"]
  },
];
