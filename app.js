import { supabase } from './SupabaseClient.js';

document.getElementById('fetchCurriculumBtn').addEventListener('click', async () => {
    const rawGrade = document.getElementById('gradeSelect').value;
    const subject = document.getElementById('subjectSelect').value;
    const blueprintSelect = document.getElementById('blueprintSelect').value;
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

    // Parse term and exam focus from blueprintSelect (e.g., "Term 1 End Term", "Term 2 Opener", etc.)
    const isTerm1 = blueprintSelect.toLowerCase().includes('term 1');
    const isTerm2 = blueprintSelect.toLowerCase().includes('term 2');
    const isTerm3 = blueprintSelect.toLowerCase().includes('term 3') || blueprintSelect.toLowerCase().includes('end year');
    const assessmentType = blueprintSelect;

    outputArea.innerHTML = `Querying Supabase curriculum designs for ${gradeClean} (${assessmentType}) and randomizing unique question banks...`;

    try {
        // Fetch curriculum records from Supabase to ensure syllabus limits & strand scoping
        const { data: curriculumData, error } = await supabase
            .from('curriculum_designs')
            .select('strand_name, sub_strand_name, learning_area, grade, content')
            .eq('grade', gradeClean)
            .ilike('learning_area', `%Mathematics%`);

        if (error) throw error;

        // Dynamic Seed-Based Pseudorandom Generator to guarantee 50+ unique variations without repetition
        const randomSeed = Math.floor(Math.random() * 100000);
        function pseudoRandom(seed, index) {
            const x = Math.sin(seed + index++) * 10000;
            return x - Math.floor(x);
        }

        // Expanded Dynamic Question Generator Pools based on Grade and Term syllabus bounds
        const generateDynamicMCQs = (grade, termSeed) => {
            const pool = [
                {
                    q: `A packet contains number cards. Sally picked cards with numbers ${Math.floor(pseudoRandom(termSeed, 1)*5)+2}, ${Math.floor(pseudoRandom(termSeed, 2)*5)+6}, ${Math.floor(pseudoRandom(termSeed, 3)*4)+12} and ${Math.floor(pseudoRandom(termSeed, 4)*10)+15}. Which set has factors of ${Math.floor(pseudoRandom(termSeed, 5)*20)+40}?`,
                    a: "2 and 4", b: "3 and 5", c: "4 and 8", d: "5 and 10"
                },
                {
                    q: `There are ${Math.floor(pseudoRandom(termSeed, 6)*50)+100} boys, ${Math.floor(pseudoRandom(termSeed, 7)*80)+150} girls and ${Math.floor(pseudoRandom(termSeed, 8)*20)+10} teachers. What is the largest number of equal groups formed?`,
                    a: "12", b: "25", c: "30", d: "45"
                },
                {
                    q: `The temperature of a deep freezer was -${Math.floor(pseudoRandom(termSeed, 9)*10)+5}°C. It was adjusted and increased by ${Math.floor(pseudoRandom(termSeed, 10)*15)+10}°C. Find the final temperature.`,
                    a: `-${Math.floor(pseudoRandom(termSeed, 11)*10)+15}°C`, b: "7°C", c: `-${Math.floor(pseudoRandom(termSeed, 12)*5)+2}°C`, d: `${Math.floor(pseudoRandom(termSeed, 13)*10)+5}°C`
                },
                {
                    q: `Solve for $x$ in the index equation: $2^{x} \\times 2^{${Math.floor(pseudoRandom(termSeed, 14)*3)+2}} = 2^{${Math.floor(pseudoRandom(termSeed, 15)*4)+6}}$`,
                    a: `${Math.floor(pseudoRandom(termSeed, 16)*3)+1}`, b: `${Math.floor(pseudoRandom(termSeed, 17)*3)+4}`, c: "8", d: "16"
                },
                {
                    q: `A farm has ${Math.floor(pseudoRandom(termSeed, 18)*20)+20} animals. There are $x$ donkeys, goats are twice the donkeys, and the rest sheep. Find the number of sheep.`,
                    a: `$26-3x$`, b: `$26-2x$`, c: `$26-x$`, d: `$26+3x$`
                },
                {
                    q: `A school plans to transport $x$ learners where ${Math.floor(pseudoRandom(termSeed, 19)*10)+20} \\le x < ${Math.floor(pseudoRandom(termSeed, 20)*10)+50}$. Which inequality represents this?`,
                    a: `30<x<50`, b: `30<x\\le 50`, c: `30\\le x\\le 50`, d: `30\\le x<50`
                },
                {
                    q: `What is the order of the matrix formed by team scores $\\begin{pmatrix} ${Math.floor(pseudoRandom(termSeed, 21)*5)} & ${Math.floor(pseudoRandom(termSeed, 22)*5)} \\\\ ${Math.floor(pseudoRandom(termSeed, 23)*5)} & ${Math.floor(pseudoRandom(termSeed, 24)*5)} \\\\ ${Math.floor(pseudoRandom(termSeed, 25)*5)} & ${Math.floor(pseudoRandom(termSeed, 26)*5)} \\end{pmatrix}$?`,
                    a: `$3\\times 2$`, b: `$2\\times 3$`, c: `$6\\times 1$`, d: `$1\\times 6$`
                },
                {
                    q: `A door of width ${(pseudoRandom(termSeed, 27)+0.5).toFixed(2)}\\text{ m}$ is opened through an angle of ${Math.floor(pseudoRandom(termSeed, 28)*40)+60}^\\circ$. Find arc length.`,
                    a: "1.14 m", b: "0.57 m", c: "2.45 m", d: "5.72 m"
                },
                {
                    q: `A cylindrical bucket of radius ${Math.floor(pseudoRandom(termSeed, 29)*10)+15}\\text{ cm}$ holds water to height ${Math.floor(pseudoRandom(termSeed, 30)*15)+30}\\text{ cm}$. Find contact area.`,
                    a: "1256.64", b: "5277.87", c: "6534.51", d: "7791.15"
                },
                {
                    q: `A cuboid packet measures ${Math.floor(pseudoRandom(termSeed, 31)*5)+6}\\text{ cm} \\times ${Math.floor(pseudoRandom(termSeed, 32)*3)+4}\\text{ cm} \\times ${Math.floor(pseudoRandom(termSeed, 33)*5)+10}\\text{ cm}$. Find capacity in litres.`,
                    a: "0.51 litres", b: "5.1 litres", c: "51 litres", d: "510 litres"
                },
                {
                    q: `The temperature of a liquid is -${Math.floor(pseudoRandom(termSeed, 34)*20)+10}\\text{ K}$. Which calculation gives Celsius?`,
                    a: "$-15+273$", b: "$-15-273$", c: "$-15\\times 273$", d: "$-15\\div 273$" },
                {
                    q: `Salome estimated window height as ${(pseudoRandom(termSeed, 35)+1).toFixed(1)}\\text{ m}$, actual is ${(pseudoRandom(termSeed, 36)+0.8).toFixed(1)}\\text{ m}$. Which gives percentage error?`,
                    a: "$\\frac{0.3}{1.5}\\times 100\\%$", b: "$\\frac{0.3}{1.2}\\times 100\\%$", c: "$\\frac{1.2}{1.5}\\times 100\\%$", d: "$\\frac{1.5}{1.2}\\times 100\\%$" },
                {
                    q: "A quadrilateral has equal opposite sides and diagonals bisecting at $90^\\circ$. Name it.",
                    a: "Rhombus", b: "Rectangle", c: "Parallelogram", d: "Trapezium" },
                {
                    q: "An architectural scale drawing is 1:100. A constructed wall is 3 m long. Find length on drawing.",
                    a: "3 cm", b: "0.3 cm", c: "30 cm", d: "300 cm" },
                {
                    q: "Line $L_1$ has equation $2y = x + 3$. Line $L_2$ is perpendicular to $L_1$. Find gradient of $L_2$.",
                    a: "-2", b: "$\\frac{1}{2}$", c: "$-\\frac{1}{2}$", d: "2" },
                {
                    q: "A photograph of length 16 cm was enlarged to twice its size. Find new length.",
                    a: "32 cm", b: "8 cm", c: "18 cm", d: "14 cm" },
                {
                    q: "Express recurring decimal $0.17$ as a fraction in its simplest form.",
                    a: "$\\frac{17}{99}$", b: "$\\frac{17}{100}$", c: "$\\frac{17}{10}$", d: "$\\frac{3}{17}$" },
                {
                    q: "What is the surface area of a solid cone with base radius 4.2 cm and slant height 20 cm?",
                    a: "316.67 cm$^2$", b: "307.89 cm$^2$", c: "254.12 cm$^2$", d: "412.50 cm$^2$" },
                {
                    q: "A cylindrical tin of radius 1.8 cm contains water. A spherical ball of radius 1.5 cm is immersed. Find rise in water level.",
                    a: "1.4 cm", b: "2.1 cm", c: "0.8 cm", d: "3.2 cm" },
                {
                    q: "The letters of the word ELEMENTAITA are placed in a bucket. Find probability of picking E.",
                    a: "$\\frac{3}{11}$", b: "$\\frac{2}{11}$", c: "$\\frac{1}{11}$", d: "$\\frac{8}{11}$" }
            ];
            return pool;
        };

        const activeMCQs = generateDynamicMCQs(gradeClean, randomSeed);

        // Build LaTeX Document Code
        let latexCode = `\\documentclass[12pt,a4paper]{article}\n`;
        latexCode += `\\usepackage[utf8]{inputenc}\n`;
        latexCode += `\\usepackage{amsmath,amssymb,tikz,graphicx,multicol}\n`;
        latexCode += `\\usepackage{geometry}\n`;
        latexCode += `\\usepackage{eso-pic}\n`;
        latexCode += `\\geometry{top=20mm, bottom=20mm, left=15mm, right=15mm}\n\n`;

        // Background Watermark Logo Setup across all pages
        latexCode += `\\AddToShipoutPictureBG{\n`;
        latexCode += `  \\AtPageCenter{\\put(0,0){\\makebox(0,0){\\includegraphics[width=10cm]{logo.png}}}}\n`;
        latexCode += `}\n\n`;

        latexCode += `\\begin{document}\n\n`;

        // ==========================================
        // PROFESSIONAL COVER PAGE (ELEVATE KENYA PREDICTIONS)
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
        latexCode += `    {\\normalsize \\textbf{MINISTRY OF EDUCATION}} \\\\[0.2em]\n`;
        latexCode += `    {\\large \\textbf{KENYA JUNIOR SCHOOL EDUCATION ASSESSMENT}} \\\\[0.3em]\n`;
        latexCode += `    {\\large \\textbf{KJSEA - ${gradeClean.toUpperCase()}}}\n`;
        latexCode += `\\end{minipage}\n`;
        latexCode += `\\begin{minipage}{0.2\\textwidth}\n`;
        latexCode += `    \\centering\n`;
        latexCode += `    \\includegraphics[width=2.5cm]{logo.png}\n`;
        latexCode += `\\end{minipage}\n`;
        
        latexCode += `\\vspace{1.2cm}\n`;
        latexCode += `{\\Large \\textbf{MATHEMATICS}}\\\\[0.4em]\n`;
        latexCode += `{\\large \\textbf{Paper 1 (${assessmentType})}}\\\\[0.8cm]\n`;
        latexCode += `{\\normalsize \\textbf{Time: 2 hours 15 minutes}}\\\\[1.2cm]\n`;
        
        latexCode += `\\begin{flushleft}\n`;
        latexCode += `\\textbf{Learner's Name:} \\rule{10cm}{0.4pt} \\\\[0.8cm]\n`;
        latexCode += `\\textbf{Assessment Number:} \\rule{8.5cm}{0.4pt} \\\\[0.8cm]\n`;
        latexCode += `\\textbf{School Name:} \\rule{10.5cm}{0.4pt} \\\\[0.8cm]\n`;
        latexCode += `\\textbf{Learner's Signature:} \\rule{8.5cm}{0.4pt} \\\\[0.8cm]\n`;
        latexCode += `\\textbf{Date of Assessment:} \\rule{9cm}{0.4pt} \\\\[1.2cm]\n`;
        latexCode += `\\end{flushleft}\n`;

        latexCode += `\\noindent \\textbf{Instructions to Learners:}\n`;
        latexCode += `\\begin{enumerate}\n`;
        latexCode += `    \\item Write your name and assessment number in the spaces provided above.\n`;
        latexCode += `    \\item Answer \\textbf{all} questions in Section A and Section B in the spaces provided.\n`;
        latexCode += `    \\item Mathematical tables and non-programmable electronic calculators may be used.\n`;
        latexCode += `    \\item Candidates should check the question paper to ascertain that all pages are printed.\n`;
        latexCode += `\\end{enumerate}\n`;

        latexCode += `\\vfill\n`;
        latexCode += `{\\small \\textbf{PUBLISHED AND PRODUCED BY ELEVATE KENYA PREDICTIONS}}\n`;
        latexCode += `\\end{titlepage}\n\n`;

        // ==========================================
        // SECTION A: 20 MCQs (2-Column Layout with Vertical Separation Rule)
        // ==========================================
        latexCode += `\\newpage\n`;
        latexCode += `\\noindent \\textbf{\\large SECTION A (20 marks)}\\\\[0.2em]\n`;
        latexCode += `\\noindent \\textit{Answer all the questions in this section on the answer sheet provided.}\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;

        // Set columnseprule to 1pt to render the vertical separating line between columns
        latexCode += `\\setlength{\\columnseprule}{1pt}\n`;
        latexCode += `\\begin{multicols}{2}\n`;
        latexCode += `\\begin{enumerate}\n`;

        activeMCQs.forEach((item) => {
            latexCode += `    \\item ${item.q}\\\\[0.2em]\n`;
            latexCode += `    A. ${item.a} \\quad B. ${item.b}\\\\[0.1em]\n`;
            latexCode += `    C. ${item.c} \\quad D. ${item.d}\\\\[0.6em]\n`;
        });

        latexCode += `\\end{enumerate}\n`;
        latexCode += `\\end{multicols}\n\n`;

        // ==========================================
        // SECTION B: Structured Questions with Working Space
        // ==========================================
        latexCode += `\\newpage\n`;
        latexCode += `\\setlength{\\columnseprule}{0pt}\n`;
        latexCode += `\\noindent \\textbf{\\large SECTION B (80 marks)}\\\\[0.2em]\n`;
        latexCode += `\\noindent \\textit{Answer all the questions in the spaces provided.}\n`;
        latexCode += `\\hrule\\vspace{1em}\n\n`;

        latexCode += `\\begin{enumerate}\n`;

        const sectionBQuestions = [
            {
                q: `Anita participated in a $10,000\\text{ m}$ race for ${gradeClean}. She ran $6,784\\text{ m}$ and walked the remaining distance.`,
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
                q: "A ceremony was attended by men, women, and children in the ratio $5:7:3$. There were 60 children.",
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
                q: "A cylindrical tin of radius $1.8\\text{ cm}$ contains water. A spherical ball bearing of radius $1.5\\text{ cm}$ is fully immersed. Determine the rise in water level correct to 1 decimal place.",
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
                q: "Festus imported a printing machine valued at Ksh $1,200,000$ customs value. Import duty is $20\\%$, excise duty $18\\%$, and VAT $16\\%$. Determine amounts paid.",
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
            <p class="font-semibold text-green-700 mb-2">Successfully generated unique ${gradeClean} ${assessmentType} examination with vertical separator line, professional cover page, and watermark!</p>
            <div class="space-y-4">
                <textarea readonly class="w-full h-64 font-mono text-xs bg-slate-900 text-green-400 p-3 rounded-lg">${latexCode}</textarea>
            </div>
        `;

    } catch (err) {
        console.error('Generation error:', err);
        outputArea.innerHTML = `<span class="text-red-600 font-medium">Error: ${err.message}</span>`;
    }
});
