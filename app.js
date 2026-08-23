import { supabase } from './SupabaseClient.js'
import { buildKnecPrompt } from './prompts.js'

document.getElementById('fetchCurriculumBtn').addEventListener('click', async () => {
    const rawGrade = document.getElementById('gradeSelect').value;
    const subject = document.getElementById('subjectSelect').value;
    const standard = document.getElementById('blueprintSelect').value;
    const customPrompt = document.getElementById('customPrompt').value;
    const imagesInput = document.getElementById('imageFilenames').value;
    const outputArea = document.getElementById('outputArea');

    if (!rawGrade || !subject) {
        outputArea.innerHTML = `<span class="text-red-500 font-medium">Please select both a Grade and a Subject first.</span>`;
        return;
    }

    const gradeClean = rawGrade.replace(/[\(\–\-].*$/, '').trim();
    const subjectClean = subject.trim();

    // Determine grade scope following KNEC rules (Cumulative testing for Junior School)
    let targetGrades = [gradeClean];
    if (gradeClean === 'Grade 8') {
        targetGrades = ['Grade 7', 'Grade 8'];
    } else if (gradeClean === 'Grade 9') {
        targetGrades = ['Grade 7', 'Grade 8', 'Grade 9'];
    }

    outputArea.innerHTML = `Synthesizing national blueprint and pulling cumulative strands for ${targetGrades.join(', ')}...`;

    try {
        // Fetch curriculum designs across the cumulative grades
        const { data, error } = await supabase
            .from('curriculum_designs')
            .select('strand_name, sub_strand_name, learning_area, grade')
            .in('grade', targetGrades)
            .ilike('learning_area', `%${subjectClean}%`);

        if (error) throw error;

        if (!data || data.length === 0) {
            outputArea.innerHTML = `<span class="text-amber-600 font-medium">No curriculum records found for ${subjectClean} across grades ${targetGrades.join(', ')}.</span>`;
            return;
        }

        // Build the advanced KNEC Chief Examiner prompt
        const knecPromptText = buildKnecPrompt(standard, gradeClean, subjectClean, data, customPrompt, imagesInput);

        // Build Master LaTeX framework
        let latexCode = `\\documentclass[12pt,a4paper]{article}\n`;
        latexCode += `\\usepackage[utf8]{inputenc}\n`;
        latexCode += `\\usepackage{amsmath,amssymb,tikz,graphicx}\n`;
        latexCode += `\\usepackage{geometry}\n`;
        latexCode += `\\geometry{top=25mm, bottom=25mm, left=20mm, right=20mm}\n\n`;
        latexCode += `\\begin{document}\n\n`;

        // Official KNEC Header
        latexCode += `\\begin{center}\n`;
        latexCode += `    \\textbf{\\Large REPUBLIC OF KENYA}\\\\[0.4em]\n`;
        latexCode += `    \\textbf{\\large KENYA NATIONAL EXAMINATIONS COUNCIL}\\\\[0.2em]\n`;
        latexCode += `    \\textbf{\\normalsize \\uppercase{${standard} ASSESSMENT -- ${subjectClean.toUpperCase()}}}\n`;
        latexCode += `\\end{center}\n\n`;

        latexCode += `\\noindent \\textbf{Target Grade:} ${gradeClean} (Cumulative Scope: ${targetGrades.join(', ')}) \\hfill \\textbf{Standard:} ${standard}\\\\[0.5em]\n`;
        latexCode += `\\noindent \\textbf{Learner's Name:} \\rule{7cm}{0.4pt} \\hfill \\textbf{Assessment No:} \\rule{4cm}{0.4pt}\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;

        // Instructions
        latexCode += `\\section*{Instructions to Candidates}\n`;
        latexCode += `\\begin{enumerate}\n`;
        latexCode += `    \\item Answer \\textbf{all} questions in the spaces provided in this booklet.\n`;
        latexCode += `    \\item Mathematical tables, statistical tables, and non-programmable electronic calculators may be used where appropriate.\n`;
        latexCode += `    \\item Candidates should check the question paper to ascertain that all pages are printed as indicated and that no questions are missing.\n`;
        latexCode += `\\end{enumerate}\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;

        // Section A: Multiple Choice
        latexCode += `\\section*{SECTION A: Multiple Choice Questions (20 Marks)}\n`;
        latexCode += `\\textit{Answer all questions in this section by writing the correct choice (A, B, C, or D).}\\\\[0.5em]\n\n`;

        // Generate dynamic mock/AI structured items representing deep curriculum distribution
        let qNum = 1;
        for (let i = 0; i < 10; i++) {
            const curriculumItem = data[i % data.length];
            latexCode += `\\textbf{Q${qNum}.} [Strid/Grade: ${curriculumItem.grade} - ${curriculumItem.strand_name}] \\\n`;
            latexCode += `(Here, the AI engine populates a unique, non-repeating multiple-choice question testing competency in \\textit{${curriculumItem.sub_strand_name}} using realistic Kenyan context.) \\\\[0.4em]\n`;
            latexCode += `A. \\hspace{1.5cm} B. \\hspace{1.5cm} C. \\hspace{1.5cm} D. \\\\[1em]\n`;
            qNum++;
        }

        // Section B: Structured Questions
        latexCode += `\\section*{SECTION B: Structured & Extended Response (30 Marks)}\n`;
        latexCode += `\\textit{Answer all questions in the spaces provided after each question.}\\\\[0.5em]\n\n`;

        for (let i = 0; i < 10; i++) {
            const curriculumItem = data[(i + 3) % data.length];
            latexCode += `\\textbf{Q${qNum}.} [${curriculumItem.grade}: ${curriculumItem.sub_strand_name}] \\hfill \\textbf{[${(i % 3) + 2} marks]} \\\n`;
            latexCode += `(Here, the AI engine populates a rigorous structured problem requiring calculation, step-by-step reasoning, or practical application based on ${curriculumItem.strand_name}.) \\\\[1.5em]\n`;
            
            // Handle optional image attachments if requested
            if (imagesInput && i === 2) {
                const imgName = imagesInput.split(',')[0].trim();
                latexCode += `\\begin{center}\n`;
                latexCode += `    \\includegraphics[width=0.45\\textwidth]{${imgName}}\\\\[0.3em]\n`;
                latexCode += `    {\\small \\textit{Figure for Question ${qNum}}}\n`;
                latexCode += `\\end{center}\n\\vspace{1em}\n`;
            }
            qNum++;
        }

        latexCode += `\\end{document}`;

        let html = `<p class="font-semibold text-green-700 mb-2">Professional Cumulative ${standard} Exam Compiled Successfully!</p>`;
        html += `<div class="space-y-4">`;
        html += `<div>`;
        html += `<p class="text-xs font-semibold text-slate-700 mb-1">Master LaTeX Code (Copy & paste into Overleaf):</p>`;
        html += `<textarea readonly class="w-full h-64 font-mono text-xs bg-slate-900 text-green-400 p-3 rounded-lg">${latexCode}</textarea>`;
        html += `</div>`;
        html += `</div>`;
        
        outputArea.innerHTML = html;

    } catch (err) {
        console.error('Error generating exam:', err);
        outputArea.innerHTML = `<span class="text-red-600 font-medium">Error: ${err.message}</span>`;
    }
});
