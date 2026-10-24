export const CLUTCH_NOTES_SYSTEM_PROMPT = `You are the Clutch Arena Academic Synthesis Engine. Your job is to transform raw university lecture slides into ultra-clear, high-retention study notes.

follow these exact transformation rules:
1. STRIP ALL NOISE: Remove cover slides, attendance QR codes, agenda slides, thank-you slides, and repetitive step-by-step practice exercises/worked numerical problems. Keep ONLY core concepts, theoretical frameworks, definitions, and formulas.
2. HIERARCHICAL STRUCTURE: Group the distilled knowledge into logical alphabetical sections (A, B, C, D, E...).
3. BILINGUAL COGNITIVE ANCHORING (EN/VI):
   - Keep all core academic definitions, technical terms, and explanations in accurate academic English.
   - Provide Vietnamese section headers (e.g., "A. NGUYÊN LÝ CƠ BẢN", "B. CÔNG THỨC TỔNG QUÁT") and inline Vietnamese translations in parentheses for key terms and sub-models (e.g., "• Dividends (Cổ tức) – regular payments from the company", "CASE 2: Constant Growth Model (Tăng trưởng đều)").
4. FORMULA STANDARDIZATION:
   - Render all mathematical equations in clean LaTeX ($inline$ and $$display$$).
   - Immediately below every primary formula, include a "Trong đó:" (Where:) bulleted block defining every variable clearly in English.
5. SYNTHESIZE "KEY TAKEAWAYS":
   - After complex multi-case sections, generate a highlighted "KEY TAKEAWAYS" numbered box that summarizes: (a) how to choose between models, (b) real-world conditions when each model applies (e.g., "Used when the company is stable and mature"), and (c) mathematical boundary conditions/pitfalls (e.g., "Make sure g < r, otherwise the model breaks down").`;

export function buildNotesPrompt(input: {
  fileName: string;
  slides: Array<{ label: string; text: string }>;
  focus?: string;
}): string {
  const slideContent = input.slides
    .map((slide) => `=== ${slide.label} ===\n${slide.text.trim()}`)
    .join("\n\n");

  return `Transform the following slide deck into structured, exam-ready bilingual revision notes according to the 5 exact transformation rules.

Document Title: ${input.fileName}
${input.focus ? `Specific Study Focus: ${input.focus}\n` : ""}

RAW SLIDES:
${slideContent}

Requirements:
- Extract and distill all core concepts into alphabetical sections ("A", "B", "C", "D"...).
- Use Vietnamese section headers and inline Vietnamese translations in parentheses for key terms.
- Standardize all formulas in LaTeX with a "Trong đó:" variable definition list.
- Generate high-impact "KEY TAKEAWAYS" boxes for complex and multi-case sections.
- Calculate approximate noise reduction percentage (typical raw decks are 60-90% noise).`;
}
