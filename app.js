import { supabase } from './SupabaseClient.js'
import { buildKnecPrompt } from './prompts.js'
import { GoogleGenAI } from 'https://esm.run/@google/genai';

// Initialize the Gemini client directly with your personal API key
const ai = new GoogleGenAI({ apiKey: 'AQ.Ab8RN6JQ3eCN62zeTWvaPwku1d3OgDMryIngp8fiVG4gMZH-oQ' });

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

    // Determine cumulative grade scope following national exam rules
    let targetGrades = [gradeClean];
    if (gradeClean === 'Grade 8') {
        targetGrades = ['Grade 7', 'Grade 8'];
    } else if (gradeClean === 'Grade 9') {
        targetGrades = ['Grade 7', 'Grade 8', 'Grade 9'];
    }

    outputArea.innerHTML = `Synthesizing national blueprint and generating unique exam questions via Gemini AI for ${targetGrades.join(', ')}...`;

    try {
        // 1. Fetch curriculum design strands from Supabase
        const { data, error } = await supabase
            .from('curriculum_designs')
            .select('strand_name, sub_strand_name, learning_area, grade')
            .in('grade', targetGrades)
            .ilike('learning_area', `%${subjectClean}%`);

        if (error) throw error;

        if (!data || data.length === 0) {
            outputArea.innerHTML = `<span class="text-amber-600 font-medium">No curriculum records found for ${subjectClean} in grades ${targetGrades.join(', ')}.</span>`;
            return;
        }

        // 2. Build the prompt
        const knecPromptText = buildKnecPrompt(standard, gradeClean, subjectClean, data, customPrompt, imagesInput);

        // 3. Call the Gemini API using high-availability flash-lite model
        const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash-lite',
            contents: knecPromptText,
            config: {
                systemInstruction: "You are an expert KNEC Chief Examiner. Output ONLY raw LaTeX question text for Section A and Section B.",
                temperature: 0.7
            }
        });

        const generatedQuestionsLatex = response.text;

        // 4. Wrap everything into the Master LaTeX document container
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
        latexCode += `    \\item Answer \\textbf{all} questions in the spaces provided.\n`;
        latexCode += `    \\item Mathematical tables and non-programmable electronic calculators may be used where appropriate.\n`;
        latexCode += `\\end{enumerate}\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;

        // Inject the live AI questions
        latexCode += generatedQuestionsLatex;

        latexCode += `\n\\end{document}`;

        let html = `<p class="font-semibold text-green-700 mb-2">Live KNEC Exam Generated Successfully!</p>`;
        html += `<div class="space-y-4">`;
        html += `<div>`;
        html += `<p class="text-xs font-semibold text-slate-700 mb-1">Master LaTeX Code (Ready for Overleaf):</p>`;
        html += `<textarea readonly class="w-full h-64 font-mono text-xs bg-slate-900 text-green-400 p-3 rounded-lg">${latexCode}</textarea>`;
        html += `</div>`;
        html += `</div>`;
        
        outputArea.innerHTML = html;

    } catch (err) {
        console.error('Error generating exam:', err);
        outputArea.innerHTML = `<span class="text-red-600 font-medium">Error: ${err.message}</span>`;
    }
});
