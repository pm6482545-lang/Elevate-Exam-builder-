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

    // Cumulative tier matching (Grades 7, 8, and 9 scope integration)
    let targetGrades = [gradeClean];
    if (gradeClean === 'Grade 8') {
        targetGrades = ['Grade 7', 'Grade 8'];
    } else if (gradeClean === 'Grade 9') {
        targetGrades = ['Grade 7', 'Grade 8', 'Grade 9'];
    }

    outputArea.innerHTML = `Synthesizing KNEC National Blueprint for ${subjectClean} across (${targetGrades.join(', ')})...`;

    try {
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

        // Stratified sampling across grades
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
        
        if (combinedRows.length < 8) {
            combinedRows = data.sort(() => 0.5 - Math.random()).slice(0, 10);
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
        latexCode += `    \\textbf{\\normalsize \\uppercase{${standard} -- END OF TERM ASSESSMENT -- ${subjectClean.toUpperCase()}}}\n`;
        latexCode += `\\end{center}\n\n`;

        latexCode += `\\noindent \\textbf{Target Class:} ${gradeClean} \\hfill \\textbf{Cumulative Scope:} ${targetGrades.join(', ')}\\\\[0.4em]\n`;
        latexCode += `\\noindent \\textbf{Learner's Name:} \\rule{7cm}{0.4pt} \\hfill \\textbf{Assessment No:} \\rule{4cm}{0.4pt}\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;

        latexCode += `\\section*{Instructions to Candidates}\n`;
        latexCode += `\\begin{enumerate}\n`;
        latexCode += `    \\item Answer \\textbf{all} questions in Section A and Section B.\n`;
        latexCode += `    \\item Show all necessary working where applicable.\n`;
        latexCode += `\\end{enumerate}\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;

        // SECTION A: Multiple Choice Items tailored to Subject Domain
        latexCode += `\\section*{SECTION A: Multiple Choice Questions (15 Marks)}\n`;
        latexCode += `\\begin{enumerate}\n`;

        const mcqPool = combinedRows.slice(0, 5);
        mcqPool.forEach((row) => {
            const sub = row.sub_strand_name || "General Concept";
            const subL = sub.toLowerCase();
            let mcqText = `Which of the following statements is correct regarding \\textbf{${sub}}?`;
            let optA = `It relies exclusively on constant baseline coefficients.`;
            let optB = `It is applied directly in standard operational measurements.`;
            let optC = `It functions independently of external environmental factors.`;
            let optD = `It has a negligible variance across regional systems.`;

            if (subjectClean.toLowerCase().includes('math')) {
                if (subL.includes('fraction') || subL.includes('ratio')) {
                    mcqText = `Evaluate the numerical proportion or simplest form associated with \\textbf{${sub}} given standard parameters.`;
                    optA = `$\\frac{3}{8}$`; optB = `$\\frac{5}{12}$`; optC = `$\\frac{7}{15}$`; optD = `$\\frac{9}{16}$`;
                } else if (subL.includes('linear') || subL.includes('equation') || subL.includes('algebra')) {
                    mcqText = `What is the gradient or core solution set for an expression governed by \\textbf{${sub}}?`;
                    optA = `$-3$`; optB = `$2.5$`; optC = `$4$`; optD = `$-1.5$`;
                }
            } else if (subjectClean.toLowerCase().includes('science')) {
                mcqText = `Which physical property or biological process is primarily associated with \\textbf{${sub}}?`;
                optA = `Catalytic thermal conversion rate`;
                optB = `Net ionic equilibrium state`;
                optC = `Homeostatic cellular adaptation`;
                optD = `Kinetic energy transference`;
            }

            latexCode += `    \\item ${mcqText}\\\\[0.3em]\n`;
            latexCode += `    A. ${optA}\\\\[0.2em]\n    B. ${optB}\\\\[0.2em]\n    C. ${optC}\\\\[0.2em]\n    D. ${optD}\\\\[0.6em]\n`;
        });
        latexCode += `\\end{enumerate}\n\n`;

        // SECTION B: Subject-Specific Structured Questions
        latexCode += `\\section*{SECTION B: Structured Assessment Questions (35 Marks)}\n`;
        latexCode += `\\begin{enumerate}\n`;

        combinedRows.forEach((row) => {
            const strand = row.strand_name || "Core Strand";
            const subStrand = row.sub_strand_name || "Specific Concept";
            const currentGrade = row.grade || gradeClean;
            const subLower = subStrand.toLowerCase();

            let coreQuestion = `Explain the theoretical principles and practical applications of \\textbf{${subStrand}} within the ${strand} domain (${currentGrade}).`;
            let subParts = `
    \\textit{(a)} Define the primary term associated with \\textbf{${subStrand}} under current CBC guidelines. \\hfill \\textbf{[2 marks]}\\\\[0.4em]
    \\textit{(b)} Describe two key characteristics or rules governing this concept. \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(c)} Explain one way this concept is applied in a practical Kenyan setup. \\hfill \\textbf{[2 marks]}
            `;

            // Subject and Sub-strand Customization for Realism
            if (subjectClean.toLowerCase().includes('math')) {
                if (subLower.includes('square')) {
                    coreQuestion = `A land surveyor is mapping out a square agricultural plot in Mombasa governed by ${strand}.`;
                    subParts = `
    \\textit{(a)} Evaluate the expression: $\\sqrt{57.76} + \\left(14.2\\right)^2$ correct to 2 decimal places. \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(b)} Calculate the exact perimeter of the plot if its total surface area is $57.76 \\text{ m}^2$. \\hfill \\textbf{[2 marks]}\\\\[0.4em]
    \\textit{(c)} Give a practical reason why accurate square root computations are essential in construction. \\hfill \\textbf{[2 marks]}
                    `;
                } else if (subLower.includes('fraction') || subLower.includes('ratio')) {
                    coreQuestion = `During a community development project, resources are partitioned using fractional ratios.`;
                    subParts = `
    \\textit{(a)} Simplify completely: $\\frac{\\frac{3}{4} \\div \\frac{2}{3} + \\frac{1}{6}}{\\frac{5}{8} \\times \\frac{4}{5}}$ \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(b)} A budget of KES $450,000$ is shared among three groups in the ratio $2:3:5$. Calculate the largest share. \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(c)} State one benefit of using ratio scaling in financial budgeting. \\hfill \\textbf{[1 mark]}
                    `;
                } else if (subLower.includes('linear') || subLower.includes('inequality') || subLower.includes('equation')) {
                    coreQuestion = `An analytical model tracks linear trends for inventory distribution across regional supply chains.`;
                    subParts = `
    \\textit{(a)} Solve the linear inequality: $3x - 5 \\le 10 + \\frac{1}{2}x$ and represent the solution on a number line. \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(b)} Find the coordinates of the y-intercept and x-intercept for the line $2y - 4x = 12$. \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(c)} State the significance of linear modeling in business forecasting. \\hfill \\textbf{[1 mark]}
                    `;
                } else if (subLower.includes('scale') || subLower.includes('drawing')) {
                    coreQuestion = `An architectural blueprint for a school laboratory is drawn under specific scaling parameters.`;
                    subParts = `
    \\textit{(a)} On a map with a scale of $1:50,000$, a project site measures $4.5 \\text{ cm}$ by $3.2 \\text{ cm}$. Find the actual area in hectares. \\hfill \\textbf{[4 marks]}\\\\[0.4em]
    \\textit{(b)} Calculate the new map dimensions if the scale factor is changed to $1:25,000$. \\hfill \\textbf{[3 marks]}
                    `;
                } else {
                    coreQuestion = `Work out the standard mathematical problem involving \\textbf{${subStrand}} under KNEC testing standards.`;
                    subParts = `
    \\textit{(a)} Compute the primary unknown parameter given standard initial conditions. \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(b)} Solve a multi-step word problem applying this mathematical principle. \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(c)} State one real-life utility of this computation. \\hfill \\textbf{[1 mark]}
                    `;
                }
            } else if (subjectClean.toLowerCase().includes('science')) {
                coreQuestion = `Investigate the scientific phenomena and experimental properties associated with \\textbf{${subStrand}}.`;
                subParts = `
    \\textit{(a)} State the scientific law or principle governing \\textbf{${subStrand}}. \\hfill \\textbf{[2 marks]}\\\\[0.4em]
    \\textit{(b)} Describe a simple laboratory experiment used to demonstrate this phenomenon. \\hfill \\textbf{[3 marks]}\\\\[0.4em]
    \\textit{(c)} Explain how this scientific concept is utilized to conserve energy or resources locally. \\hfill \\textbf{[2 marks]}
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
            latexCode += `Synthesize all required competencies across the junior secondary tiers to resolve the practical scenario presented above.\n`;
        }

        latexCode += `\\end{document}`;

        outputArea.innerHTML = `
            <p class="font-semibold text-green-700 mb-2">Subject-Specific KNEC Exam Blueprint Generated Successfully for ${subjectClean} (${targetGrades.join(', ')} Scope)!</p>
            <div class="space-y-4">
                <textarea readonly class="w-full h-64 font-mono text-xs bg-slate-900 text-green-400 p-3 rounded-lg">${latexCode}</textarea>
            </div>
        `;

    } catch (err) {
        console.error('Generation error:', err);
        outputArea.innerHTML = `<span class="text-red-600 font-medium">Error: ${err.message}</span>`;
    }
});
