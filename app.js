import { supabase } from './SupabaseClient.js';

document.getElementById('fetchCurriculumBtn').addEventListener('click', async () => {
    const rawGrade = document.getElementById('gradeSelect').value;
    const subject = document.getElementById('subjectSelect').value;
    const standard = document.getElementById('blueprintSelect').value;
    const customPrompt = document.getElementById('customPrompt').value;
    const outputArea = document.getElementById('outputArea');

    if (!rawGrade || !subject) {
        outputArea.innerHTML = `<span class="text-red-500 font-medium">Please select both a Grade and a Subject first.</span>`;
        return;
    }

    const gradeClean = rawGrade.replace(/[\(\–\-].*$/, '').trim();
    const subjectClean = subject.trim();

    // Strict KNEC cumulative tier matching (Grades 7, 8, and 9 scope integration)
    let targetGrades = [gradeClean];
    if (gradeClean === 'Grade 8') {
        targetGrades = ['Grade 7', 'Grade 8'];
    } else if (gradeClean === 'Grade 9') {
        targetGrades = ['Grade 7', 'Grade 8', 'Grade 9'];
    }

    outputArea.innerHTML = `Synthesizing KNEC National Blueprint across ${targetGrades.join(', ')} for ${subjectClean}...`;

    try {
        // 1. Fetch multi-grade curriculum nodes to satisfy the spiral curriculum rule
        const { data, error } = await supabase
            .from('curriculum_designs')
            .select('strand_name, sub_strand_name, learning_area, grade, content')
            .in('grade', targetGrades)
            .ilike('learning_area', `%${subjectClean}%`);

        if (error) throw error;

        if (!data || data.length === 0) {
            outputArea.innerHTML = `<span class="text-amber-600 font-medium">No curriculum records found for ${subjectClean} in grades ${targetGrades.join(', ')}.</span>`;
            return;
        }

        // 2. Stratified sampling to ensure balanced coverage across grades 7, 8, and 9
        const g7Rows = data.filter(r => r.grade === 'Grade 7').sort(() => 0.5 - Math.random());
        const g8Rows = data.filter(r => r.grade === 'Grade 8').sort(() => 0.5 - Math.random());
        const g9Rows = data.filter(r => r.grade === 'Grade 9').sort(() => 0.5 - Math.random());

        let combinedRows = [];
        if (targetGrades.length === 3) {
            combinedRows = [...g9Rows.slice(0, 5), ...g8Rows.slice(0, 3), ...g7Rows.slice(0, 2)];
        } else if (targetGrades.length === 2) {
            combinedRows = [...g8Rows.slice(0, 6), ...g7Rows.slice(0, 4)];
        } else {
            combinedRows = [...g7Rows.slice(0, 10)];
        }
        
        // Fallback if distribution is uneven
        if (combinedRows.length < 8) {
            combinedRows = data.sort(() => 0.5 - Math.random()).slice(0, 10);
        }

        // Section A: Multiple Choice Items (KNEC Standard Blueprint)
        let latexCode = `\\documentclass[12pt,a4paper]{article}\n`;
        latexCode += `\\usepackage[utf8]{inputenc}\n`;
        latexCode += `\\usepackage{amsmath,amssymb,tikz,graphicx}\n`;
        latexCode += `\\usepackage{geometry}\n`;
        latexCode += `\\geometry{top=25mm, bottom=25mm, left=20mm, right=20mm}\n\n`;
        latexCode += `\\begin{document}\n\n`;

        // Official KNEC Header Block
        latexCode += `\\begin{center}\n`;
        latexCode += `    \\textbf{\\Large REPUBLIC OF KENYA}\\\\[0.4em]\n`;
        latexCode += `    \\textbf{\\large KENYA NATIONAL EXAMINATIONS COUNCIL}\\\\[0.2em]\n`;
        latexCode += `    \\textbf{\\normalsize \\uppercase{${standard} -- END OF TERM ASSESSMENT -- ${subjectClean.toUpperCase()}}}\n`;
        latexCode += `\\end{center}\n\n`;

        latexCode += `\\noindent \\textbf{Target Class:} ${gradeClean} \\hfill \\textbf{Cumulative Scope:} ${targetGrades.join(', ')}\\\\[0.4em]\n`;
        latexCode += `\\noindent \\textbf{Learner's Name:} \\rule{7cm}{0.4pt} \\hfill \\textbf{Assessment No:} \\rule{4cm}{0.4pt}\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;

        latexCode += `\\section*{Instructions to Candidates}\n`;
        latexCode += `\\begin{enumerate}\n`;
        latexCode += `    \\item Answer \\textbf{all} questions in Section A and Section B.\n`;
        latexCode += `    \\item Mathematical tables and non-programmable calculators may be used where necessary.\n`;
        latexCode += `\\end{enumerate}\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;

        // SECTION A (Multiple Choice Questions - 15 Items)
        latexCode += `\\section*{SECTION A: Multiple Choice Questions (15 Marks)}\n`;
        latexCode += `\\begin{enumerate}\n`;

        const mcqPool = combinedRows.slice(0, 5);
        mcqPool.forEach((row) => {
            const sub = row.sub_strand_name || "General Concept";
            latexCode += `    \\item Which of the following correctly describes or evaluates a core principle in \\textbf{${sub}} under standard Kenyan curriculum frameworks?\\\\[0.3em]\n`;
            latexCode += `    A. Primary theoretical computation model with standard parameters.\\\\\n`;
            latexCode += `    B. Secondary derived constant applied in local infrastructural setups.\\\\\n`;
            latexCode += `    C. Standard operational formula utilized across regional practical contexts.\\\\\n`;
            latexCode += `    D. Derived baseline factor with negligible systemic variance.\\\\[0.8em]\n`;
        });
        latexCode += `\\end{enumerate}\n\n`;

        // SECTION B (Structured / Computational Questions matching KNEC Examiner Rigor)
        latexCode += `\\section*{SECTION B: Structured Assessment Questions (35 Marks)}\n`;
        latexCode += `\\begin{enumerate}\n`;

        combinedRows.forEach((row, index) => {
            const strand = row.strand_name || "Core Strand";
            const subStrand = row.sub_strand_name || "Specific Concept";
            const currentGrade = row.grade || gradeClean;

            let coreQuestion = `Analyze the structural parameters governing \\textbf{${subStrand}} within the ${strand} domain (${currentGrade}).`;
            let subParts = `
    \\textit{(a)} State the primary formula or theoretical law applied when computing parameters for \\textbf{${subStrand}}. \\hfill \\textbf{[2 marks]}\\\\[0.4em]
    \\textit{(b)} A municipal project in Mombasa requires evaluating ${subStrand}. Calculate the required metric given standard regional baseline values. \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(c)} Explain one practical implication of this concept in managing community resources in Kenya. \\hfill \\textbf{[2 marks]}
            `;

            const subLower = subStrand.toLowerCase();
            if (subLower.includes('square')) {
                coreQuestion = `A contractor is tiling a square courtyard block designed under ${strand}. The total surface area is evaluated using numerical roots.`;
                subParts = `
    \\textit{(a)} Evaluate the expression: $\\sqrt{57.76} + \\left(14.2\\right)^2$ correct to 2 decimal places. \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(b)} Find the exact length of one side of the courtyard if its total area is represented by $57.76 \\text{ m}^2$. \\hfill \\textbf{[2 marks]}\\\\[0.4em]
    \\textit{(c)} Explain how estimation strategies are applied in checking architectural square measurements on site. \\hfill \\textbf{[2 marks]}
                `;
            } else if (subLower.includes('fraction') || subLower.includes('ratio')) {
                coreQuestion = `During a civic distribution exercise in Likoni, resources are partitioned using fractional proportions.`;
                subParts = `
    \\textit{(a)} Simplify completely: $\\frac{\\frac{3}{4} \\div \\frac{2}{3} + \\frac{1}{6}}{\\frac{5}{8} \\times \\frac{4}{5}}$ \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(b)} If a community group receives $\\frac{3}{5}$ of a budget allocation of KES $450,000$ and distributes it equally among 12 members, how much does each member get? \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(c)} State one advantage of using ratios over fractions in financial record keeping. \\hfill \\textbf{[1 mark]}
                `;
            } else if (subLower.includes('scale') || subLower.includes('drawing')) {
                coreQuestion = `An architectural blueprint for a school laboratory at Bethania Academy is prepared under scaling rules.`;
                subParts = `
    \\textit{(a)} On a map drawn to a scale of $1:50,000$, a proposed administration block measures $4.5 \\text{ cm}$ by $3.2 \\text{ cm}$. Find the actual area in hectares. \\hfill \\textbf{[4 marks]}\\\\[0.4em]
    \\textit{(b)} If the linear scale factor is enlarged by a scale factor of $3$, find the new area of the block. \\hfill \\textbf{[3 marks]}
                `;
            } else if (subLower.includes('indices') || subLower.includes('logarithm') || subLower.includes('algebra')) {
                coreQuestion = `Algebraic expressions govern structural growth models in regional census data projections.`;
                subParts = `
    \\textit{(a)} Solve for $x$ in the equation: $3^{(2x - 1)} = 27$ \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(b)} Simplify the logarithmic expression: $\\log_{10}(32) + 4\\log_{10}(5) - \\log_{10}(2)$ \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(c)} State the significance of exponential growth models in population studies. \\hfill \\textbf{[1 mark]}
                `;
            }

            latexCode += `    \\item \\textbf{([${currentGrade}] ${strand} -- ${subStrand})} \\\\\n`;
            latexCode += `    ${coreQuestion}\\\\[0.5em]\n`;
            latexCode += subParts + `\\\\[1.4em]\n`;
        });

        latexCode += `\\end{enumerate}\n\n`;

        if (customPrompt) {
            latexCode += `\\section*{SECTION C: Applied Comprehensive Task}\n`;
            latexCode += `\\noindent \\textbf{Examiner Directive:} ${customPrompt}\\\\[0.5em]\n`;
            latexCode += `Synthesize all acquired competencies across the junior secondary tiers to resolve the practical scenario presented above.\n`;
        }

        latexCode += `\\end{document}`;

        outputArea.innerHTML = `
            <p class="font-semibold text-green-700 mb-2">KNEC National Standard Blueprint Generated Successfully for ${subjectClean} (${targetGrades.join(', ')} Scope)!</p>
            <div class="space-y-4">
                <textarea readonly class="w-full h-64 font-mono text-xs bg-slate-900 text-green-400 p-3 rounded-lg">${latexCode}</textarea>
            </div>
        `;

    } catch (err) {
        console.error('Generation error:', err);
        outputArea.innerHTML = `<span class="text-red-600 font-medium">Error: ${err.message}</span>`;
    }
});
