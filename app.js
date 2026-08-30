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

    if (!subjectClean.toLowerCase().includes('math')) {
        outputArea.innerHTML = `<span class="text-amber-600 font-medium">Please select Mathematics to build the official KJSEA paper format.</span>`;
        return;
    }

    // Cumulative tier matching across junior secondary scope (Grades 7, 8, 9)
    let targetGrades = [gradeClean];
    if (gradeClean === 'Grade 8') {
        targetGrades = ['Grade 7', 'Grade 8'];
    } else if (gradeClean === 'Grade 9') {
        targetGrades = ['Grade 7', 'Grade 8', 'Grade 9'];
    }

    outputArea.innerHTML = `Synthesizing official KJSEA Mathematics Assessment Blueprint across (${targetGrades.join(', ')})...`;

    try {
        const { data, error } = await supabase
            .from('curriculum_designs')
            .select('strand_name, sub_strand_name, learning_area, grade, content')
            .in('grade', targetGrades)
            .ilike('learning_area', `%Mathematics%`);

        if (error) throw error;

        // Fetch curriculum records or build standard KJSEA items matching national format
        let latexCode = `\\documentclass[12pt,a4paper]{article}\n`;
        latexCode += `\\usepackage[utf8]{inputenc}\n`;
        latexCode += `\\usepackage{amsmath,amssymb,tikz,graphicx,multicol}\n`;
        latexCode += `\\usepackage{geometry}\n`;
        latexCode += `\\geometry{top=20mm, bottom=20mm, left=15mm, right=15mm}\n\n`;
        latexCode += `\\begin{document}\n\n`;

        // ==========================================
        // COVER PAGE (ELEVATE KENYA PREDICTIONS)
        // ==========================================
        latexCode += `\\begin{titlepage}\n`;
        latexCode += `\\centering\n`;
        latexCode += `\\begin{minipage}{0.2\\textwidth}\n`;
        latexCode += `    \\centering\n`;
        latexCode += `    \\includegraphics[width=2.5cm]{logo.png}\n`;
        latexCode += `\\end{minipage}\n`;
        latexCode += `\\begin{minipage}{0.55\\textwidth}\n`;
        latexCode += `    \\centering\n`;
        latexCode += `    {\\large \\textbf{REPUBLIC OF KENYA}} \\\\[0.3em]\n`;
        latexCode += `    {\\normalsize \\textbf{KENYA NATIONAL EXAMINATIONS COUNCIL}} \\\\[0.2em]\n`;
        latexCode += `    {\\large \\textbf{KENYA JUNIOR SCHOOL EDUCATION ASSESSMENT}} \\\\[0.3em]\n`;
        latexCode += `    {\\large \\textbf{${standard.toUpperCase()}}}\n`;
        latexCode += `\\end{minipage}\n`;
        latexCode += `\\begin{minipage}{0.2\\textwidth}\n`;
        latexCode += `    \\centering\n`;
        latexCode += `    \\includegraphics[width=2.5cm]{logo.png}\n`;
        latexCode += `\\end{minipage}\n`;
        
        latexCode += `\\vspace{1.5cm}\n`;
        latexCode += `{\\Large \\textbf{MATHEMATICS}}\\\\[0.5em]\n`;
        latexCode += `{\\large \\textbf{Paper 1}}\\\\[1cm]\n`;
        latexCode += `{\\large \\textbf{Target Class: ${gradeClean} (Scope: ${targetGrades.join(', ')})}}\\\\[1.5cm]\n`;
        
        latexCode += `\\begin{flushleft}\n`;
        latexCode += `\\textbf{Name:} \\rule{10cm}{0.4pt} \\\\[1cm]\n`;
        latexCode += `\\textbf{Assessment Number:} \\rule{8.5cm}{0.4pt} \\\\[1cm]\n`;
        latexCode += `\\textbf{School:} \\rule{11cm}{0.4pt} \\\\[1.5cm]\n`;
        latexCode += `\\end{flushleft}\n`;

        latexCode += `\\noindent \\textbf{Instructions to Learners:}\n`;
        latexCode += `\\begin{enumerate}\n`;
        latexCode += `    \\item Answer \\textbf{all} questions in Section A and Section B.\n`;
        latexCode += `    \\item Mathematical tables and non-programmable electronic calculators may be used.\n`;
        latexCode += `    \\item Candidates should check the question paper to ascertain that all pages are printed.\n`;
        latexCode += `\\end{enumerate}\n`;

        latexCode += `\\vfill\n`;
        latexCode += `{\\small \\textbf{PUBLISHED BY ELEVATE KENYA PREDICTIONS}}\n`;
        latexCode += `\\end{titlepage}\n\n`;

        // ==========================================
        // SECTION A: 20 MCQs (2-Column Layout, No Working Space)[span_0](start_span)[span_0](end_span)
        // ==========================================
        latexCode += `\\newpage\n`;
        latexCode += `\\noindent \\textbf{\\large SECTION A (20 marks)}\\\\[0.2em]\n`;
        latexCode += `\\noindent \\textit{Answer all the questions in this section on the answer sheet provided.}[span_1](start_span)[span_1](end_span)\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;

        latexCode += `\\begin{multicols}{2}\n`;
        latexCode += `\\begin{enumerate}\n`;

        const sectionAMcqs = [
            { q: "A packet contains number cards with 2, 4, 5, and 9. Which set has prime numbers only?", a: "2 and 4", b: "2 and 5", c: "4 and 9", d: "5 and 9" },
            { q: "There are 120 boys, 180 girls, and 24 teachers. What is the largest number of equal groups formed?", a: "12", b: "60", c: "324", d: "360" },
            { q: "The temperature of a deep freezer was -8°C and increased by 15°C. What was the final temperature?", a: "-23°C", b: "-7°C", c: "7°C", d: "23°C" },
            { q: "Solve for $x$ in the equation: $2^{x} \\times 2^{3} = 32$", a: "16", b: "8", c: "2", d: "$1\\frac{2}{3}$" },
            { q: "A farm has 26 animals. There are $x$ donkeys, twice as many goats, and the rest sheep. Find the number of sheep.", a: "$26-3x$", b: "$26-2x$", c: "$26-x$", d: "$26+3x$" },
            { q: "A school transports $x$ learners where $30 \\le x < 50$. Which inequality represents this?", a: "$30<x<50$", b: "$30<x\\le 50$", c: "$30\\le x\\le 50$", d: "$30\\le x<50$" },
            { q: "What is the order of matrix $\\begin{pmatrix} 3 & 2 & 1 & 0 & 7 \\\\ 4 & 1 & 2 & 1 & 5 \\end{pmatrix}$?", a: "$10\\times 1$", b: "$1\\times 10$", c: "$5\\times 2$", d: "$2\\times 5$" },
            { q: "A door of width $0.91\\text{ m}$ opens through $72^\\circ$. What arc length does the tip sweep?", a: "$5.72\\text{ m}$", b: "$1.14\\text{ m}$", c: "$0.57\\text{ m}$", d: "$0.52\\text{ m}$" },
            { q: "A cylindrical water bucket of diameter $40\\text{ cm}$ holds water to a height of $42\\text{ cm}$. Find contact area.", a: "$1256.64$", b: "$5277.87$", c: "$6534.51$", d: "$7791.15$" },
            { q: "A cuboid milk packet measures $8.5\\text{ cm} \\times 5\\text{ cm} \\times 12\\text{ cm}$. What is its capacity in litres?", a: "$0.51\\text{ l}$", b: "$5.1\\text{ l}$", c: "$510\\text{ l}$", d: "$510,000\\text{ l}$" },
            { q: "Convert liquid temperature from $-15\\text{ K}$ to degrees Celsius.", a: "$-15\\times 273$", b: "$-15\\div 273$", c: "$-15+273$", d: "$-15-273$" },
            { q: "Salome estimated window height as $1.5\\text{ m}$, actual is $1.2\\text{ m}$. Which gives percentage error?", a: "$\\frac{0.3}{1.5}\\times 100\\%$", b: "$\\frac{0.3}{1.2}\\times 100\\%$", c: "$\\frac{1.2}{1.5}\\times 100\\%$", d: "$\\frac{1.5}{1.2}\\times 100\\%$" },
            { q: "A quadrilateral has equal opposite sides and diagonals intersecting at $90^\\circ$. Name it.", a: "Trapezium", b: "Parallelogram", c: "Rectangle", d: "Rhombus" },
            { q: "An architectural drawing scale is $1:100$. A wall is $3\\text{ m}$ long. Find length on drawing.", a: "$0.3\\text{ cm}$", b: "$3\\text{ cm}$", c: "$30\\text{ cm}$", d: "$300\\text{ cm}$" },
            { q: "Line $L_1$ has equation $2y = x + 3$. Line $L_2$ is perpendicular to $L_1$. Find gradient of $L_2$.", a: "$-\\frac{1}{2}$", b: "$\\frac{1}{2}$", c: "$-2$", d: "$2$" },
            { q: "A photograph of length $16\\text{ cm}$ was enlarged to twice its size. Find new length.", a: "$32\\text{ cm}$", b: "$18\\text{ cm}$", c: "$14\\text{ cm}$", d: "$8\\text{ cm}$" },
            { q: "Express decimal $0.17$ as a fraction in its simplest form.", a: "$\\frac{17}{100}$", b: "$\\frac{17}{10}$", c: "$\\frac{3}{17}$", d: "$\\frac{17}{99}$" },
            { q: "Solve for $x$ in the linear inequality: $3x - 5 \\le 10 + \\frac{1}{2}x$", a: "$x \\le 6$", b: "$x \\ge 6$", c: "$x < 4$", d: "$x > 5$" },
            { q: "What is the surface area of a solid cone with base radius $4.2\\text{ cm}$ and slant height $20\\text{ cm}$?", a: "$316.67\\text{ cm}^2$", b: "$307.89\\text{ cm}^2$", c: "$254.12\\text{ cm}^2$", d: "$412.50\\text{ cm}^2$" },
            { q: "Letters of the word ELEMENTAITA are placed in a bucket. What is probability of picking E?", a: "$\\frac{1}{11}$", b: "$\\frac{2}{11}$", c: "$\\frac{3}{11}$", d: "$\\frac{8}{11}$"}
        ];

        sectionAMcqs.forEach((item) => {
            latexCode += `    \\item ${item.q}\\\\[0.2em]\n`;
            latexCode += `    A. ${item.a} \\quad B. ${item.b}\\\\[0.1em]\n`;
            latexCode += `    C. ${item.c} \\quad D. ${item.d}\\\\[0.6em]\n`;
        });

        latexCode += `\\end{enumerate}\n`;
        latexCode += `\\end{multicols}\n\n`;

        // ==========================================
        // SECTION B: Structured Questions with Working Space[span_2](start_span)[span_2](end_span)
        // ==========================================
        latexCode += `\\newpage\n`;
        latexCode += `\\noindent \\textbf{\\large SECTION B (80 marks)}\\\\[0.2em]\n`;
        latexCode += `\\noindent \\textit{Answer all the questions in the spaces provided.}[span_3](start_span)[span_3](end_span)\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;

        latexCode += `\\begin{enumerate}\n`;

        const sectionBQuestions = [
            {
                q: "Anita participated in a $10,000\\text{ m}$ race. She ran $6,784\\text{ m}$ and walked the remaining distance.",
                parts: [
                    "(a) Work out the distance that Anita walked. \\hfill \\textbf{[1 mark]}",
                    "(b) Write the distance that Anita ran in words. \\hfill \\textbf{[1 mark]}",
                    "(c) Write the distance that Anita ran rounded off to the nearest hundreds. \\hfill \\textbf{[1 mark]}"
                ],
                space: "3.5cm"
            },
            {
                q: "A metallic container is in the shape of a cube of side length $2.4\\text{ m}$.",
                parts: [
                    "(a) Determine the volume of the container in cubic metres. \\hfill \\textbf{[2 marks]}",
                    "(b) Smaller cubes of side $50\\text{ cm}$ were packed in the container. Determine the number of smaller cubes packed. \\hfill \\textbf{[2 marks]}"
                ],
                space: "4cm"
            },
            {
                q: "A thanksgiving ceremony was attended by men, women, and children in the ratio $5:7:3$. There were 60 children.",
                parts: [
                    "(a) Determine the number of men who attended the ceremony. \\hfill \\textbf{[3 marks]}",
                    "(b) Calculate how many more women than men attended. \\hfill \\textbf{[2 marks]}"
                ],
                space: "4cm"
            },
            {
                q: "Regina bought 4 books and 3 pens for Ksh 315. Hamisi bought 8 books and 2 pens of the same type for Ksh 530. Determine the cost of one book and one pen using simultaneous equations.",
                parts: [],
                space: "4.5cm"
            },
            {
                q: "A cylindrical tin of radius $1.8\\text{ cm}$ contains water. A spherical ball bearing of radius $1.5\\text{ cm}$ is fully immersed in the water. Determine the rise in water level correct to 1 decimal place.",
                parts: [],
                space: "4cm"
            },
            {
                q: "Juma placed a metal rod against a vertical wall such that the foot of the rod was $3.6\\text{ m}$ away and the top reached $4.8\\text{ m}$ high.",
                parts: [
                    "(a) Calculate the length of the rod. \\hfill \\textbf{[2 marks]}",
                    "(b) If the rod has a mass of $2.4\\text{ kg}$ and a volume of $600\\text{ cm}^3$, calculate its density in $\\text{g/cm}^3$. \\hfill \\textbf{[2 marks]}"
                ],
                space: "4cm"
            },
            {
                q: "Festus imported a printing machine valued at Ksh $1,200,000$ customs value. He was charged import duty at $20\\%$, excise duty at $18\\%$, and VAT at $16\\%$. Determine the amount paid for each.",
                parts: [
                    "(a) Import duty \\hfill \\textbf{[2 marks]}",
                    "(b) Excise duty \\hfill \\textbf{[2 marks]}",
                    "(c) Value Added Tax \\hfill \\textbf{[1 mark]}"
                ],
                space: "4.5cm"
            },
            {
                q: "Construct parallelogram $ABCD$ where $AB = 6\\text{ cm}$, $AD = 4\\text{ cm}$, and angle $DAB = 45^\\circ$ using a ruler and pair of compasses only. Drop a perpendicular from $D$ to meet $AB$ at $E$ and measure $DE$.",
                parts: [],
                space: "5cm"
            },
            {
                q: "The marks scored by 20 learners in a test were: $19, 17, 19, 15, 17, 19, 22, 17, 17, 19, 18, 33, 17, 29, 18, 15, 19, 18, 22, 19$.",
                parts: [
                    "(a) Prepare a frequency distribution table for the data. \\hfill \\textbf{[2 marks]}",
                    "(b) Determine the mean mark and median mark. \\hfill \\textbf{[3 marks]}"
                ],
                space: "5cm"
            },
            {
                q: "Rebecca tossed a fair coin and rolled a regular 6-sided die simultaneously.",
                parts: [
                    "(a) Write down the probability space representing all possible outcomes. \\hfill \\textbf{[2 marks]}",
                    "(b) Determine the probability of obtaining a head on the coin and a 4 on the die. \\hfill \\textbf{[1 mark]}"
                ],
                space: "3.5cm"
            }
        ];

        sectionBQuestions.forEach((item) => {
            latexCode += `    \\item ${item.q}\\\\[0.3em]\n`;
            if (item.parts.length > 0) {
                item.parts.forEach(p => {
                    latexCode += `    ${p}\\\\[0.2em]\n`;
                });
            }
            latexCode += `    \\vspace{${item.space}}\n`;
            latexCode += `    {\\raggedleft \\textit{\\tiny Working Space} \\hrule}\\\\[1em]\n`;
        });

        latexCode += `\\end{enumerate}\n\n`;
        latexCode += `\\end{document}`;

        outputArea.innerHTML = `
            <p class="font-semibold text-green-700 mb-2">KJSEA Mathematics Paper 1 Generated Successfully with Cover Page & 2-Column Section A!</p>
            <div class="space-y-4">
                <textarea readonly class="w-full h-64 font-mono text-xs bg-slate-900 text-green-400 p-3 rounded-lg">${latexCode}</textarea>
            </div>
        `;

    } catch (err) {
        console.error('Generation error:', err);
        outputArea.innerHTML = `<span class="text-red-600 font-medium">Error: ${err.message}</span>`;
    }
});
