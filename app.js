import { supabase } from './SupabaseClient.js'
import { buildKnecPrompt } from './prompts.js'

document.getElementById('fetchCurriculumBtn').addEventListener('click', async () => {
    const grade = document.getElementById('gradeSelect').value;
    const subject = document.getElementById('subjectSelect').value;
    const standard = document.getElementById('blueprintSelect').value;
    const outputArea = document.getElementById('outputArea');

    if (!grade || !subject) {
        outputArea.innerHTML = `<span class="text-red-500 font-medium">Please select both a Grade and a Subject first.</span>`;
        return;
    }

    outputArea.innerHTML = `Loading ${standard} curriculum blueprint from Supabase for ${grade} - ${subject}...`;

    try {
        // Query Supabase curriculum_designs table
        const { data, error } = await supabase
            .from('curriculum_designs')
            .select('strand_name, sub_strand_name, strand')
            .eq('grade_level', grade)
            .eq('learning_area', subject);

        if (error) {
            throw error;
        }

        if (!data || data.length === 0) {
            outputArea.innerHTML = `<span class="text-amber-600 font-medium">No curriculum records found for ${grade} ${subject}.</span>`;
            return;
        }

        // Generate the strict KNEC AI prompt using our prompts.js module
        const knecPromptText = buildKnecPrompt(standard, grade, subject, data);

        // Build a KNEC-style LaTeX preview based on the retrieved curriculum
        let latexCode = `\\documentclass[12pt,a4paper]{article}\n`;
        latexCode += `\\usepackage[utf8]{inputenc}\n`;
        latexCode += `\\usepackage{amsmath,amssymb,tikz}\n`;
        latexCode += `\\usepackage{geometry}\n`;
        latexCode += `\\geometry{top=25mm, bottom=25mm, left=20mm, right=20mm}\n\n`;
        latexCode += `\\begin{document}\n\n`;
        latexCode += `\\begin{center}\n`;
        latexCode += `    \\textbf{\\Large REPUBLIC OF KENYA}\\\\[0.4em]\n`;
        latexCode += `    \\textbf{\\large KENYA NATIONAL EXAMINATIONS COUNCIL}\\\\[0.2em]\n`;
        latexCode += `    \\textbf{\\normalsize \\uppercase{${standard} ASSESSMENT -- ${subject.toUpperCase()}}}\n`;
        latexCode += `\\end{center}\n\n`;
        latexCode += `\\noindent \\textbf{Grade:} ${grade} \\hfill \\textbf{Standard:} ${standard}\\\\[0.5em]\n`;
        latexCode += `\\noindent \\textbf{Learner's Name:} \\rule{7cm}{0.4pt} \\hfill \\textbf{Assessment No:} \\rule{4cm}{0.4pt}\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;
        latexCode += `\\section*{Verified Curriculum Scope (Strictly Enforced)}\n`;
        latexCode += `The questions below are strictly drawn from the approved ${standard} design for ${subject} (${grade}):\n`;
        latexCode += `\\begin{itemize}\n`;

        data.forEach((item) => {
            const strand = item.strand_name || 'General Strand';
            const subStrand = item.sub_strand_name || 'Core Concept';
            latexCode += `    \\item \\textbf{${strand}}: ${subStrand}\n`;
        });

        latexCode += `\\end{itemize}\n\n`;
        latexCode += `\\vspace{1em}\n`;
        latexCode += `% --- AI Question Generation Block Goes Here ---\n`;
        latexCode += `\\end{document}`;

        // Render the results and display both outputs
        let html = `<p class="font-semibold text-green-700 mb-2">Successfully compiled blueprints for ${standard} (${grade} ${subject})!</p>`;
        
        html += `<div class="space-y-4">`;
        html += `<div>`;
        html += `<p class="text-xs font-semibold text-slate-700 mb-1">1. Strict KNEC AI Prompt (Enforces syllabus boundaries & style):</p>`;
        html += `<textarea readonly class="w-full h-40 font-mono text-xs bg-slate-900 text-amber-300 p-3 rounded-lg">${knecPromptText}</textarea>`;
        html += `</div>`;

        html += `<div>`;
        html += `<p class="text-xs font-semibold text-slate-700 mb-1">2. Generated Master LaTeX Document Code:</p>`;
        html += `<textarea readonly class="w-full h-48 font-mono text-xs bg-slate-900 text-green-400 p-3 rounded-lg">${latexCode}</textarea>`;
        html += `</div>`;
        html += `</div>`;
        
        outputArea.innerHTML = html;

    } catch (err) {
        console.error('Error fetching curriculum:', err);
        outputArea.innerHTML = `<span class="text-red-600 font-medium">Error loading data: ${err.message}</span>`;
    }
});
