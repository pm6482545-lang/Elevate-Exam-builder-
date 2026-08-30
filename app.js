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

    // Ensure we are strict about Mathematics
    if (!subjectClean.toLowerCase().includes('math')) {
        outputArea.innerHTML = `<span class="text-amber-600 font-medium">Please select Mathematics to use the dedicated Math item engine.</span>`;
        return;
    }

    // Cumulative tier matching (Grades 7, 8, and 9 scope integration)
    let targetGrades = [gradeClean];
    if (gradeClean === 'Grade 8') {
        targetGrades = ['Grade 7', 'Grade 8'];
    } else if (gradeClean === 'Grade 9') {
        targetGrades = ['Grade 7', 'Grade 8', 'Grade 9'];
    }

    outputArea.innerHTML = `Synthesizing KNEC Mathematics Blueprint across (${targetGrades.join(', ')})...`;

    try {
        const { data, error } = await supabase
            .from('curriculum_designs')
            .select('strand_name, sub_strand_name, learning_area, grade, content')
            .in('grade', targetGrades)
            .ilike('learning_area', `%Mathematics%`);

        if (error) throw error;

        if (!data || data.length === 0) {
            outputArea.innerHTML = `<span class="text-amber-600 font-medium">No Mathematics records found for grades ${targetGrades.join(', ')}.</span>`;
            return;
        }

        // Stratified sampling across grades 7, 8, and 9
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
        
        if (combinedRows.length < 6) {
            combinedRows = data.sort(() => 0.5 - Math.random()).slice(0, 8);
        }

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
        latexCode += `    \\textbf{\\normalsize \\uppercase{${standard} -- END OF TERM ASSESSMENT -- MATHEMATICS}}\n`;
        latexCode += `\\end{center}\n\n`;

        latexCode += `\\noindent \\textbf{Target Class:} ${gradeClean} \\hfill \\textbf{Cumulative Scope:} ${targetGrades.join(', ')}\\\\[0.4em]\n`;
        latexCode += `\\noindent \\textbf{Learner's Name:} \\rule{7cm}{0.4pt} \\hfill \\textbf{Assessment No:} \\rule{4cm}{0.4pt}\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;

        latexCode += `\\section*{Instructions to Candidates}\n`;
        latexCode += `\\begin{enumerate}\n`;
        latexCode += `    \\item Answer \\textbf{all} questions in Section A and Section B.\n`;
        latexCode += `    \\item Mathematical tables and non-programmable calculators may be used.\n`;
        latexCode += `\\end{enumerate}\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;

        // SECTION A: Pure Math Multiple Choice Items (5 Questions)
        latexCode += `\\section*{SECTION A: Multiple Choice Questions (15 Marks)}\n`;
        latexCode += `\\begin{enumerate}\n`;

        const mcqTemplates = [
            { q: "Evaluate: $\\dfrac{\\frac{3}{4} + \\frac{1}{2}}{\\frac{5}{8} \\div \\frac{1}{4}}$", a: "$\\frac{2}{5}$", b: "$\\frac{4}{5}$", c: "$1\\frac{1}{4}$", d: "$2\\frac{1}{2}$" },
            { q: "Find the value of $x$ in the equation: $3^{(2x - 1)} = 27$", a: "$1$", b: "$2$", c: "$3$", d: "$4$" },
            { q: "A cylindrical water tank has a radius of $1.4\\text{ m}$ and a height of $3\\text{ m}$. Find its capacity in litres. (Take $\\pi = \\frac{22}{7}$)", a: "$18,480\\text{ L}$", b: "$1.848\\text{ L}$", c: "$184,800\\text{ L}$", d: "$184\\text{ L}$" },
            { q: "Express $0.05467$ correct to 3 significant figures.", a: "$0.0546$", b: "$0.0547$", c: "$0.055$", d: "$0.054$" },
            { q: "Solve the inequality: $3 - 2x < 5$ and state the range of $x$.", a: "$x > -1$", b: "$x < -1$", c: "$x \\ge -1$", d: "$x \\le -1$" }
        ];

        mcqTemplates.forEach((item) => {
            latexCode += `    \\item ${item.q}\\\\[0.3em]\n`;
            latexCode += `    A. ${item.a}\\quad B. ${item.b}\\quad C. ${item.c}\\quad D. ${item.d}\\\\[0.6em]\n`;
        });
        latexCode += `\\end{enumerate}\n\n`;

        // SECTION B: Authentic Structured Mathematical Questions
        latexCode += `\\section*{SECTION B: Structured Assessment Questions (35 Marks)}\n`;
        latexCode += `\\begin{enumerate}\n`;

        combinedRows.forEach((row) => {
            const strand = row.strand_name || "Number";
            const subStrand = row.sub_strand_name || "Computation";
            const currentGrade = row.grade || gradeClean;
            const subLower = subStrand.toLowerCase();

            let coreQuestion = `Work out the mathematical problem based on \\textbf{${subStrand}}.`;
            let subParts = `
    \\textit{(a)} State the standard rule or formula applied in \\textbf{${subStrand}}. \\hfill \\textbf{[2 marks]}\\\\[0.4em]
    \\textit{(b)} Calculate the required unknown parameter under standard evaluation models. \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(c)} Solve a practical word problem involving this concept in a local market context. \\hfill \\textbf{[2 marks]}
            `;

            if (subLower.includes('square') || subLower.includes('root')) {
                coreQuestion = `A hardware shop owner measures a square metallic plate designed under ${strand}.`;
                subParts = `
    \\textit{(a)} Evaluate the expression: $\\sqrt{57.76} + \\left(14.2\\right)^2$ correct to 2 decimal places. \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(b)} Find the exact length of one side of the plate if its total area is $57.76 \\text{ m}^2$. \\hfill \\textbf{[2 marks]}\\\\[0.4em]
    \\textit{(c)} Explain why square root approximation tables are useful in field calculations. \\hfill \\textbf{[2 marks]}
                `;
            } else if (subLower.includes('fraction') || subLower.includes('ratio')) {
                coreQuestion = `During a county development project in Mombasa, funds are shared using fractional proportions.`;
                subParts = `
    \\textit{(a)} Simplify completely: $\\frac{\\frac{3}{4} \\div \\frac{2}{3} + \\frac{1}{6}}{\\frac{5}{8} \\times \\frac{4}{5}}$ \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(b)} A budget of KES $450,000$ is shared among three groups in the ratio $2:3:5$. Calculate the middle share. \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(c)} State one benefit of ratio scaling in financial distribution. \\hfill \\textbf{[1 mark]}
                `;
            } else if (subLower.includes('linear') || subLower.includes('equation') || subLower.includes('algebra')) {
                coreQuestion = `An algebraic model tracks linear distribution trends across regional supply chains.`;
                subParts = `
    \\textit{(a)} Solve for $x$ in the linear equation: $\\frac{2x - 3}{3} - \\frac{x - 1}{2} = 1$ \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(b)} Find the coordinates of the y-intercept and x-intercept for the line $2y - 4x = 12$. \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(c)} State the gradient of the line perpendicular to $2y - 4x = 12$. \\hfill \\textbf{[1 mark]}
                `;
            } else if (subLower.includes('scale') || subLower.includes('drawing') || subLower.includes('geometry')) {
                coreQuestion = `An architectural blueprint for a school laboratory is drawn under specific scaling parameters.`;
                subParts = `
    \\textit{(a)} On a map with a scale of $1:50,000$, a project site measures $4.5 \\text{ cm}$ by $3.2 \\text{ cm}$. Find the actual area in hectares. \\hfill \\textbf{[4 marks]}\\\\[0.4em]
    \\textit{(b)} Calculate the new map dimensions if the scale factor is changed to $1:25,000$. \\hfill \\textbf{[3 marks]}
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
            latexCode += `Solve the applied problem completely showing all steps of reasoning.\n`;
        }

        latexCode += `\\end{document}`;

        outputArea.innerHTML = `
            <p class="font-semibold text-green-700 mb-2">Mathematics KNEC Engine Executed Successfully (${targetGrades.join(', ')} Scope)!</p>
            <div class="space-y-4">
                <textarea readonly class="w-full h-64 font-mono text-xs bg-slate-900 text-green-400 p-3 rounded-lg">${latexCode}</textarea>
            </div>
        `;

    } catch (err) {
        console.error('Generation error:', err);
        outputArea.innerHTML = `<span class="text-red-600 font-medium">Error: ${err.message}</span>`;
    }
});
