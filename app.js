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

    outputArea.innerHTML = `Querying curriculum and compiling structured KNEC exam for "${gradeClean}"...`;

    try {
        const { data, error } = await supabase
            .from('curriculum_designs')
            .select('strand_name, sub_strand_name, learning_area, grade')
            .eq('grade', gradeClean)
            .eq('learning_area', subjectClean);

        if (error) throw error;

        if (!data || data.length === 0) {
            outputArea.innerHTML = `<span class="text-amber-600 font-medium">No records found for grade "${gradeClean}" and learning area "${subjectClean}".</span>`;
            return;
        }

        const knecPromptText = buildKnecPrompt(standard, gradeClean, subjectClean, data, customPrompt, imagesInput);

        // Build Professional LaTeX code with graphics support
        let latexCode = `\\documentclass[12pt,a4paper]{article}\n`;
        latexCode += `\\usepackage[utf8]{inputenc}\n`;
        latexCode += `\\usepackage{amsmath,amssymb,tikz,graphicx}\n`;
        latexCode += `\\usepackage{geometry}\n`;
        latexCode += `\\geometry{top=25mm, bottom=25mm, left=20mm, right=20mm}\n\n`;
        latexCode += `\\begin{document}\n\n`;

        // KNEC Header
        latexCode += `\\begin{center}\n`;
        latexCode += `    \\textbf{\\Large REPUBLIC OF KENYA}\\\\[0.4em]\n`;
        latexCode += `    \\textbf{\\large KENYA NATIONAL EXAMINATIONS COUNCIL}\\\\[0.2em]\n`;
        latexCode += `    \\textbf{\\normalsize \\uppercase{${standard} ASSESSMENT -- ${subjectClean.toUpperCase()}}}\n`;
        latexCode += `\\end{center}\n\n`;

        latexCode += `\\noindent \\textbf{Grade:} ${gradeClean} \\hfill \\textbf{Standard:} ${standard}\\\\[0.5em]\n`;
        latexCode += `\\noindent \\textbf{Learner's Name:} \\rule{7cm}{0.4pt} \\hfill \\textbf{Assessment No:} \\rule{4cm}{0.4pt}\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;

        // Instructions
        latexCode += `\\section*{Instructions to Candidates}\n`;
        latexCode += `\\begin{enumerate}\n`;
        latexCode += `    \\item Answer \\textbf{all} questions in the spaces provided.\n`;
        latexCode += `    \\item Mathematical tables and non-programmable electronic calculators may be used.\n`;
        latexCode += `    \\item This paper consists of two sections: Section A and Section B.\n`;
        latexCode += `\\end{enumerate}\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;

        // Split questions into Section A (Multiple Choice) and Section B (Structured)
        latexCode += `\\section*{SECTION A: Multiple Choice Questions}\n`;
        latexCode += `\\textit{Answer all questions in this section.}\\\\[0.5em]\n\n`;

        let qNum = 1;
        // Take first half or up to 5 items for Section A
        const midPoint = Math.ceil(data.length / 2);
        
        for (let i = 0; i < midPoint; i++) {
            const item = data[i];
            const strand = item.strand_name || 'Strand';
            const subStrand = item.sub_strand_name || 'Concept';
            latexCode += `\\textbf{Q${qNum}.} [Strand: ${strand} - ${subStrand}] \\\n`;
            latexCode += `(AI generated multiple-choice question goes here...) \\\\[0.5em]\n`;
            latexCode += `A. \\hspace{1cm} B. \\hspace{1cm} C. \\hspace{1cm} D. \\\\[1em]\n`;
            qNum++;
        }

        latexCode += `\\section*{SECTION B: Structured Questions}\n`;
        latexCode += `\\textit{Answer all questions in the spaces provided.}\\\\[0.5em]\n\n`;

        for (let i = midPoint; i < data.length; i++) {
            const item = data[i];
            const strand = item.strand_name || 'Strand';
            const subStrand = item.sub_strand_name || 'Concept';
            latexCode += `\\textbf{Q${qNum}.} [Strand: ${strand} - ${subStrand}] \\hfill \\textbf{[3 marks]} \\\n`;
            latexCode += `(AI generated structured or essay question goes here...) \\\\[1.5em]\n`;
            
            // If images were specified, insert an example placeholder graphic command
            if (imagesInput && i === midPoint) {
                const firstImg = imagesInput.split(',')[0].trim();
                latexCode += `\\begin{center}\n`;
                latexCode += `    \\includegraphics[width=0.5\\textwidth]{${firstImg}}\\\\[0.5em]\n`;
                latexCode += `    \\textit{Figure for Question ${qNum}}\n`;
                latexCode += `\\end{center}\n\\vspace{1em}\n`;
            }
            qNum++;
        }

        latexCode += `\\end{document}`;

        let html = `<p class="font-semibold text-green-700 mb-2">Structured KNEC Exam Generated Successfully!</p>`;
        html += `<div class="space-y-4">`;
        html += `<div>`;
        html += `<p class="text-xs font-semibold text-slate-700 mb-1">Master LaTeX Exam Code (Ready for Overleaf):</p>`;
        html += `<textarea readonly class="w-full h-64 font-mono text-xs bg-slate-900 text-green-400 p-3 rounded-lg">${latexCode}</textarea>`;
        html += `</div>`;
        html += `</div>`;
        
        outputArea.innerHTML = html;

    } catch (err) {
        console.error('Error generating exam:', err);
        outputArea.innerHTML = `<span class="text-red-600 font-medium">Error: ${err.message}</span>`;
    }
});
