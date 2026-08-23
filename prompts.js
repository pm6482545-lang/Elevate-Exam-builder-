// prompts.js

export function buildKnecPrompt(standard, grade, subject, curriculumData, customPrompt, imagesList) {
    const cumulativeSummary = curriculumData.map(item => `[${item.grade}] ${item.strand_name} -> ${item.sub_strand_name}`).join('\n');

    return `
You are the Chief National Examiner for the Kenya National Examinations Council (KNEC). 
Your task is to generate an original, highly rigorous ${standard} assessment paper for ${subject} tailored for ${grade}.

=== SPIRAL CURRICULUM RULE (CUMULATIVE SCOPE) ===
Since this is a ${grade} national examination, questions must spiral downwards to test foundational competencies across Grade 7, Grade 8, and Grade 9 based on this official database scope:
${cumulativeSummary}

=== EXAMINER CREATIVITY & VARIATION RULES ===
1. NO REPETITION: Create unique numbers, values, and scenarios so that no two questions test the exact same angle. If generating multiple items from the same sub-strand, vary the cognitive depth (using Bloom's Taxonomy: Knowledge, Comprehension, Application, Analysis).
2. KENYAN CONTEXT: Use local names (e.g., Juma, Chebet, Wanjiru), Kenyan currency (KES), local towns, schools, and real-world agricultural or commercial settings.
3. CUSTOM EXAMINER DIRECTIVE: ${customPrompt ? customPrompt : 'Maintain standard KNEC blueprint proportions.'}
4. ASSETS: ${imagesList ? `Incorporate image references: ${imagesList}` : 'Use TikZ code for geometric or scientific diagrams where necessary.'}
`;
}
