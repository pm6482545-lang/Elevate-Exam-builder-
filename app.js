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

    // Determine cumulative grade scope following national exam rules
    let targetGrades = [gradeClean];
    if (gradeClean === 'Grade 8') {
        targetGrades = ['Grade 7', 'Grade 8'];
    } else if (gradeClean === 'Grade 9') {
        targetGrades = ['Grade 7', 'Grade 8', 'Grade 9'];
    }

    outputArea.innerHTML = `Extracting curriculum design records for ${subjectClean} (${targetGrades.join(', ')})...`;

    try {
        // 1. Fetch curriculum design rows including the actual content column
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

        // 2. Shuffle and select unique curriculum nodes
        const shuffledRows = data.sort(() => 0.5 - Math.random()).slice(0, 10);

        let generatedQuestionsLatex = `\\section*{SECTION A: Structured Assessment}\n`;
        generatedQuestionsLatex += `\\begin{enumerate}\n`;

        shuffledRows.forEach((row) => {
            const strand = row.strand_name || "Core Strand";
            const subStrand = row.sub_strand_name || "Specific Concept";
            const dbContent = row.content ? row.content.trim() : `Examine the principles governing ${subStrand}.`;

            // Use the actual database content/learning outcome to drive the question text
            generatedQuestionsLatex += `    \\item \\textbf{(${strand} -- ${subStrand})} \\\\\n`;
            generatedQuestionsLatex += `    ${dbContent}\\\\[0.4em]\n`;
            generatedQuestionsLatex += `    \\textit{(a)} Explain the core concepts involved in this learning outcome within a Kenyan context. \\hfill \\textbf{[3 marks]}\\\\[0.5em]\n`;
            generatedQuestionsLatex += `    \\textit{(b)} Give two practical applications of this concept in daily life. \\hfill \\textbf{[2 marks]}\\\\[1.2em]\n`;
        });

        generatedQuestionsLatex += `\\end{enumerate}\n\n`;

        if (customPrompt) {
            generatedQuestionsLatex += `\\section*{SECTION B: Applied Task}\n`;
            generatedQuestionsLatex += `\\noindent \\textbf{Instructions:} ${customPrompt}\\\\[0.5em]\n`;
            generatedQuestionsLatex += `Using relevant methodologies, address the thematic requirements stated above with precise calculations or descriptive breakdowns.\n`;
        }

        // 3. Assemble Master LaTeX Document Structure
        let latexCode = `\\documentclass[12pt,a4paper]{article}\n`;
        latexCode += `\\usepackage[utf8]{inputenc}\n`;
        latexCode += `\\usepackage{amsmath,amssymb,tikz,graphicx}\n`;
        latexCode += `\\usepackage{geometry}\n`;
        latexCode += `\\geometry{top=25mm, bottom=25mm, left=20mm, right=20mm}\n\n`;
        latexCode += `\\begin{document}\n\n`;

        latexCode += `\\begin{center}\n`;
        latexCode += `    \\textbf{\\Large REPUBLIC OF KENYA}\\\\[0.4em]\n`;
        latexCode += `    \\textbf{\\large KENYA NATIONAL EXAMINATIONS COUNCIL}\\\\[0.2em]\n`;
        latexCode += `    \\textbf{\\normalsize \\uppercase{${standard} ASSESSMENT -- ${subjectClean.toUpperCase()}}}\n`;
        latexCode += `\\end{center}\n\n`;

        latexCode += `\\noindent \\textbf{Target Grade:} ${gradeClean} (Scope: ${targetGrades.join(', ')}) \\hfill \\textbf{Standard:} ${standard}\\\\[0.5em]\n`;
        latexCode += `\\noindent \\textbf{Learner's Name:} \\rule{7cm}{0.4pt} \\hfill \\textbf{Assessment No:} \\rule{4cm}{0.4pt}\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;

        latexCode += `\\section*{Instructions to Candidates}\n`;
        latexCode += `\\begin{enumerate}\n`;
        latexCode += `    \\item Answer \\textbf{all} questions in the spaces provided.\n`;
        latexCode += `    \\item This paper is generated directly from your database curriculum designs.\n`;
        latexCode += `\\end{enumerate}\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;

        latexCode += generatedQuestionsLatex;
        latexCode += `\n\\end{document}`;

        outputArea.innerHTML = `
            <p class="font-semibold text-green-700 mb-2">Exam Successfully Built from Database Records for ${subjectClean}!</p>
            <div class="space-y-4">
                <textarea readonly class="w-full h-64 font-mono text-xs bg-slate-900 text-green-400 p-3 rounded-lg">${latexCode}</textarea>
            </div>
        `;

    } catch (err) {
        console.error('Generation error:', err);
        outputArea.innerHTML = `<span class="text-red-600 font-medium">Error: ${err.message}</span>`;
    }
});
