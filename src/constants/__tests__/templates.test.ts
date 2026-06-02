import { describe, expect, it } from "vitest";

import { PYTHON_TEMPLATES } from "../templates";

describe("python environment templates", () => {
  it("keeps template identifiers unique and package lists deduplicated", () => {
    const ids = PYTHON_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const template of PYTHON_TEMPLATES) {
      expect(template.name.trim()).not.toBe("");
      expect(new Set(template.pkgs).size).toBe(template.pkgs.length);
    }
  });

  it("covers common community workflows", () => {
    expect(PYTHON_TEMPLATES.map((template) => template.id)).toEqual(expect.arrayContaining([
      "fastapi",
      "django",
      "streamlit",
      "data",
      "ml",
      "llm",
      "scraping",
      "cli",
      "workers",
      "testing",
      "library",
      "docs"
    ]));
  });

  it("uses modern tooling choices for quality and packaging templates", () => {
    const testing = PYTHON_TEMPLATES.find((template) => template.id === "testing");
    const library = PYTHON_TEMPLATES.find((template) => template.id === "library");

    expect(testing?.pkgs).toEqual(expect.arrayContaining(["pytest", "ruff", "mypy", "pre-commit"]));
    expect(library?.pkgs).toEqual(expect.arrayContaining(["build", "twine", "hatchling"]));
  });
});
