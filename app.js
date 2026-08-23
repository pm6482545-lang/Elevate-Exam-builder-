// prompts.js

export function buildKnecPrompt(standard, grade, subject, curriculumData, customPrompt, imagesList) {
    const cumulativeSummary = curriculumData.map(item => `[${item.grade}] ${item.strand_name} -> ${item.sub_strand_name}`).join('\n');

    return `
You are the Chief National Examiner for the Kenya National Examinations Council (KNEC) under the CBC curriculum. 
Generate a complete, high-quality ${standard} assessment exam paper for ${subject} tailored for ${grade}.

=== CUMULATIVE SCOPE (SPIRAL CURRICULUM) ===
Incorporate competencies spanning the following database records across Grades 7, 8, and 9:
${cumulativeSummary}

=== FORMAT REQUIREMENTS ===
Provide output strictly in valid LaTeX question format divided into two sections:
1. \\section*{SECTION A: Multiple Choice Questions (20 Marks)}
   - Provide 10 distinct, rigorous multiple-choice questions with options A, B, C, D using \\textbf{Q1.}, \\textbf{Q2.}, etc.
2. \\section*{SECTION B: Structured Questions (30 Marks)}
   - Provide 10 rigorous open-ended / structured questions with mark allocations like \\hfill \\textbf{[3 marks]} and vertical spacing for working.

=== RULES ===
- Use realistic Kenyan contexts (local names, KES currency, geographic features, local schools).
- Custom Examiner Instructions: ${customPrompt ? customPrompt : 'Maintain standard KNEC balance.'}
- Image References to include: ${imagesList ? imagesList : 'None'}
`;
}
