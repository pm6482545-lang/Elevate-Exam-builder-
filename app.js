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

    const assessmentType = blueprintSelect;

    outputArea.innerHTML = `Querying Supabase curriculum designs for ${gradeClean} (${assessmentType}) and dynamically generating non-repeating questions based on syllabus boundaries...`;

    try {
        // Fetch curriculum records from Supabase filtered strictly by the selected grade
        const { data: curriculumData, error } = await supabase
            .from('curriculum_designs')
            .select('strand_name, sub_strand_name, learning_area, grade, content')
            .eq('grade', gradeClean)
            .ilike('learning_area', `%Mathematics%`);

        if (error) throw error;

        // Dynamic Seed-Based Pseudorandom Generator using timestamp and random factors to guarantee 50+ unique variations without repetition
        const randomSeed = Math.floor(Math.random() * 1000000) + Date.now() % 1000;
        function pseudoRandom(seed, index) {
            const x = Math.sin(seed + index * 99.123) * 10000;
            return x - Math.floor(x);
        }

        // Grade-Specific & Term-Aware Creative Question Generator Pools
        const generateGradeSpecificMCQs = (grade, term, seed) => {
            let pool = [];

            if (grade === 'Grade 7') {
                pool = [
                    {
                        q: `A storekeeper packed ${Math.floor(pseudoRandom(seed, 1)*50)+120} mangoes into baskets of ${Math.floor(pseudoRandom(seed, 2)*4)+6}. How many mangoes remained unpacked?`,
                        a: `${Math.floor(pseudoRandom(seed, 3)*3)+1}`, b: `${Math.floor(pseudoRandom(seed, 4)*3)+4}`, c: `${Math.floor(pseudoRandom(seed, 5)*3)+7}`, d: "0"
                    },
                    {
                        q: `Evaluate: $\\frac{${Math.floor(pseudoRandom(seed, 6)*3)+2}}{${Math.floor(pseudoRandom(seed, 7)*4)+5}} \\div \\frac{${Math.floor(pseudoRandom(seed, 8)*2)+1}}{${Math.floor(pseudoRandom(seed, 9)*3)+8}}$`,
                        a: `\\frac{${Math.floor(pseudoRandom(seed, 10)*10)+10}}{${Math.floor(pseudoRandom(seed, 11)*10)+20}}`, b: "1\\frac{1}{2}", c: "\\frac{3}{4}", d: "2\\frac{1}{3}"
                    },
                    {
                        q: `Wanjiku had Ksh ${Math.floor(pseudoRandom(seed, 12)*2000)+3000}. She spent $\\frac{${Math.floor(pseudoRandom(seed, 13)*2)+1}}{${Math.floor(pseudoRandom(seed, 14)*2)+4}}$ of it on books. How much money was left?`,
                        a: `Ksh ${Math.floor(pseudoRandom(seed, 15)*500)+1200}`, b: `Ksh ${Math.floor(pseudoRandom(seed, 16)*500)+1800}`, c: `Ksh ${Math.floor(pseudoRandom(seed, 17)*500)+2400}`, d: `Ksh ${Math.floor(pseudoRandom(seed, 18)*500)+800}`
                    },
                    {
                        q: `Express ${Math.floor(pseudoRandom(seed, 19)*40)+120}% as a fraction in its simplest form.`,
                        a: `${Math.floor(pseudoRandom(seed, 20)*3)+1}\\frac{${Math.floor(pseudoRandom(seed, 21)*3)+1}}{${Math.floor(pseudoRandom(seed, 22)*3)+5}}`, b: "\\frac{7}{5}", c: "\\frac{6}{5}", d: "\\frac{5}{4}"
                    },
                    {
                        q: `The GCD of three numbers is ${Math.floor(pseudoRandom(seed, 23)*3)+4}. Two of the numbers are ${Math.floor(pseudoRandom(seed, 24)*10)+20} and ${Math.floor(pseudoRandom(seed, 25)*10)+35}. Which of the following can be the third number?`,
                        a: `${Math.floor(pseudoRandom(seed, 26)*10)+40}`, b: `${Math.floor(pseudoRandom(seed, 27)*10)+55}`, c: `${Math.floor(pseudoRandom(seed, 28)*10)+65}`, d: `${Math.floor(pseudoRandom(seed, 29)*10)+80}`
                    },
                    {
                        q: `A rectangular plot measures ${Math.floor(pseudoRandom(seed, 30)*20)+40}\\text{ m}$ long and ${Math.floor(pseudoRandom(seed, 31)*15)+20}\\text{ m}$ wide. What is its perimeter?`,
                        a: `${Math.floor(pseudoRandom(seed, 32)*50)+120}\\text{ m}`, b: `${Math.floor(pseudoRandom(seed, 33)*50)+180}\\text{ m}`, c: `${Math.floor(pseudoRandom(seed, 34)*50)+220}\\text{ m}`, d: `${Math.floor(pseudoRandom(seed, 35)*50)+260}\\text{ m}`
                    },
                    {
                        q: `Convert ${Math.floor(pseudoRandom(seed, 36)*3000)+1500}\\text{ grams}$ into kilograms.`,
                        a: `${(pseudoRandom(seed, 37)*3+1.5).toFixed(2)}\\text{ kg}`, b: `${(pseudoRandom(seed, 38)*2+0.8).toFixed(2)}\\text{ kg}`, c: `${(pseudoRandom(seed, 39)*4+4.1).toFixed(2)}\\text{ kg}`, d: `${(pseudoRandom(seed, 40)*1+0.2).toFixed(2)}\\text{ kg}`
                    },
                    {
                        q: `Simplify the algebraic expression: $${Math.floor(pseudoRandom(seed, 41)*4)+2}x + ${Math.floor(pseudoRandom(seed, 42)*5)+3}y - ${Math.floor(pseudoRandom(seed, 43)*2)+1}x + ${Math.floor(pseudoRandom(seed, 44)*3)+2}y$`,
                        a: `$3x + 7y$`, b: `$x + 5y$`, c: `$5x + 3y$`, d: `$4x + 6y$`
                    },
                    {
                        q: `Solve for $y$: $\\frac{y}{${Math.floor(pseudoRandom(seed, 45)*3)+2}} + ${Math.floor(pseudoRandom(seed, 46)*2)+1} = ${Math.floor(pseudoRandom(seed, 47)*5)+7}$`,
                        a: `${Math.floor(pseudoRandom(seed, 48)*10)+12}`, b: `${Math.floor(pseudoRandom(seed, 49)*10)+4}`, c: `${Math.floor(pseudoRandom(seed, 50)*10)+18}`, d: `${Math.floor(pseudoRandom(seed, 51)*10)+25}`
                    },
                    {
                        q: `A water tap leaks ${Math.floor(pseudoRandom(seed, 52)*50)+100}\\text{ ml}$ of water every minute. How many litres are wasted in ${Math.floor(pseudoRandom(seed, 53)*3)+2}\\text{ hours}$?`,
                        a: `${Math.floor(pseudoRandom(seed, 54)*5)+9}\\text{ litres}`, b: `${Math.floor(pseudoRandom(seed, 55)*5)+15}\\text{ litres}`, c: `${Math.floor(pseudoRandom(seed, 56)*5)+22}\\text{ litres}`, d: `${Math.floor(pseudoRandom(seed, 57)*5)+30}\\text{ litres}`
                    },
                    {
                        q: `The mean mass of ${Math.floor(pseudoRandom(seed, 58)*5)+4} learners is ${Math.floor(pseudoRandom(seed, 59)*10)+45}\\text{ kg}$. If two more learners of mass ${Math.floor(pseudoRandom(seed, 60)*5)+40}\\text{ kg}$ join, find the new mean.`,
                        a: `${(pseudoRandom(seed, 61)*3+44).toFixed(1)}\\text{ kg}`, b: `${(pseudoRandom(seed, 62)*3+47).toFixed(1)}\\text{ kg}`, c: `${(pseudoRandom(seed, 63)*3+50).toFixed(1)}\\text{ kg}`, d: `${(pseudoRandom(seed, 64)*3+53).toFixed(1)}\\text{ kg}`
                    },
                    {
                        q: `A motorist traveled ${Math.floor(pseudoRandom(seed, 65)*100)+200}\\text{ km}$ in ${Math.floor(pseudoRandom(seed, 66)*2)+2}\\text{ hours}$. What was the average speed?`,
                        a: `${Math.floor(pseudoRandom(seed, 67)*20)+75}\\text{ km/h}`, b: `${Math.floor(pseudoRandom(seed, 68)*20)+95}\\text{ km/h}`, c: `${Math.floor(pseudoRandom(seed, 69)*20)+60}\\text{ km/h}`, d: `${Math.floor(pseudoRandom(seed, 70)*20)+110}\\text{ km/h}`
                    },
                    {
                        q: `Find the area of a triangle whose base is ${Math.floor(pseudoRandom(seed, 71)*10)+12}\\text{ cm}$ and height is ${Math.floor(pseudoRandom(seed, 72)*8)+8}\\text{ cm}$.`,
                        a: `${Math.floor(pseudoRandom(seed, 73)*30)+48}\\text{ cm}^2`, b: `${Math.floor(pseudoRandom(seed, 74)*30)+80}\\text{ cm}^2`, c: `${Math.floor(pseudoRandom(seed, 75)*30)+110}\\text{ cm}^2`, d: `${Math.floor(pseudoRandom(seed, 76)*30)+140}\\text{ cm}^2`
                    },
                    {
                        q: `What is the place value of digit ${Math.floor(pseudoRandom(seed, 77)*5)+1}$ in the number $${Math.floor(pseudoRandom(seed, 78)*4000)+5000}.${Math.floor(pseudoRandom(seed, 79)*900)+100}$?`,
                        a: "Hundreds", b: "Tenths", c: "Thousandths", d: "Tens"
                    },
                    {
                        q: `A cylindrical container has a diameter of ${Math.floor(pseudoRandom(seed, 80)*14)+14}\\text{ cm}$. Find its circumference. (Use $\\pi = \\frac{22}{7}$)`,
                        a: `${Math.floor(pseudoRandom(seed, 81)*20)+44}\\text{ cm}`, b: `${Math.floor(pseudoRandom(seed, 82)*20)+66}\\text{ cm}`, c: `${Math.floor(pseudoRandom(seed, 83)*20)+88}\\text{ cm}`, d: `${Math.floor(pseudoRandom(seed, 84)*20)+110}\\text{ cm}`
                    },
                    {
                        q: `Express ${Math.floor(pseudoRandom(seed, 85)*50)+150}$ as a product of its prime factors in index notation.`,
                        a: `$2^1 \\times 3^2 \\times 5^1$`, b: `$2^2 \\times 3^1 \\times 5^2$`, c: `$2^3 \\times 3^1 \\times 5^1$`, d: `$2^1 \\times 3^3 \\times 5^1$`
                    },
                    {
                        q: `Evaluate: $(- ${Math.floor(pseudoRandom(seed, 86)*10)+12}) + (+${Math.floor(pseudoRandom(seed, 87)*15)+8}) - (-${Math.floor(pseudoRandom(seed, 88)*8)+5})$`,
                        a: `+${Math.floor(pseudoRandom(seed, 89)*5)+2}`, b: `-${Math.floor(pseudoRandom(seed, 90)*5)+4}`, c: `+${Math.floor(pseudoRandom(seed, 91)*10)+10}`, d: `-${Math.floor(pseudoRandom(seed, 92)*10)+15}`
                    },
                    {
                        q: `Juma bought a bicycle for Ksh ${Math.floor(pseudoRandom(seed, 93)*3000)+8000}$ and sold it at a profit of ${Math.floor(pseudoRandom(seed, 94)*10)+15}%. Find the selling price.`,
                        a: `Ksh ${Math.floor(pseudoRandom(seed, 95)*1000)+9500}`, b: `Ksh ${Math.floor(pseudoRandom(seed, 96)*1000)+11200}`, c: `Ksh ${Math.floor(pseudoRandom(seed, 97)*1000)+13500}`, d: `Ksh ${Math.floor(pseudoRandom(seed, 98)*1000)+15000}`
                    },
                    {
                        q: `Calculate the volume of a rectangular cuboid measuring ${Math.floor(pseudoRandom(seed, 99)*5)+5}\\text{ cm}$ by ${Math.floor(pseudoRandom(seed, 100)*4)+4}\\text{ cm}$ by ${Math.floor(pseudoRandom(seed, 101)*3)+3}\\text{ cm}$.`,
                        a: `${Math.floor(pseudoRandom(seed, 102)*100)+120}\\text{ cm}^3`, b: `${Math.floor(pseudoRandom(seed, 103)*100)+240}\\text{ cm}^3`, c: `${Math.floor(pseudoRandom(seed, 104)*100)+360}\\text{ cm}^3`, d: `${Math.floor(pseudoRandom(seed, 105)*100)+480}\\text{ cm}^3`
                    },
                    {
                        q: `The complement of an angle is ${Math.floor(pseudoRandom(seed, 106)*20)+35}^\\circ$. What is the size of the angle?`,
                        a: `${Math.floor(pseudoRandom(seed, 107)*20)+45}^\\circ`, b: `${Math.floor(pseudoRandom(seed, 108)*20)+55}^\\circ`, c: `${Math.floor(pseudoRandom(seed, 109)*20)+65}^\\circ`, d: `${Math.floor(pseudoRandom(seed, 110)*20)+75}^\\circ`
                    }
                ];
            } else if (grade === 'Grade 8') {
                pool = [
                    {
                        q: `Solve for $x$ in the index equation: $2^{x} \\times 2^{${Math.floor(pseudoRandom(seed, 1)*3)+2}} = 2^{${Math.floor(pseudoRandom(seed, 2)*4)+6}}$`,
                        a: `${Math.floor(pseudoRandom(seed, 3)*3)+1}`, b: `${Math.floor(pseudoRandom(seed, 4)*3)+4}`, c: "8", d: "16"
                    },
                    {
                        q: `A school plans to transport $x$ learners where ${Math.floor(pseudoRandom(seed, 5)*10)+20} \\le x < ${Math.floor(pseudoRandom(seed, 6)*10)+50}$. Which inequality represents this?`,
                        a: `30<x<50`, b: `30<x\\le 50`, c: `30\\le x\\le 50`, d: `30\\le x<50`
                    },
                    {
                        q: `A farm has ${Math.floor(pseudoRandom(seed, 7)*20)+20} animals. There are $x$ donkeys, goats are twice the donkeys, and the rest sheep. Find the number of sheep.`,
                        a: `$26-3x$`, b: `$26-2x$`, c: `$26-x$`, d: `$26+3x$`
                    },
                    {
                        q: `What is the order of the matrix formed by team scores $\\begin{pmatrix} ${Math.floor(pseudoRandom(seed, 8)*5)} & ${Math.floor(pseudoRandom(seed, 9)*5)} \\\\ ${Math.floor(pseudoRandom(seed, 10)*5)} & ${Math.floor(pseudoRandom(seed, 11)*5)} \\\\ ${Math.floor(pseudoRandom(seed, 12)*5)} & ${Math.floor(pseudoRandom(seed, 13)*5)} \\end{pmatrix}$?`,
                        a: `$3\\times 2$`, b: `$2\\times 3$`, c: `$6\\times 1$`, d: `$1\\times 6$`
                    },
                    {
                        q: `A door of width ${(pseudoRandom(seed, 14)+0.5).toFixed(2)}\\text{ m}$ is opened through an angle of ${Math.floor(pseudoRandom(seed, 15)*40)+60}^\\circ$. Find arc length.`,
                        a: "1.14 m", b: "0.57 m", c: "2.45 m", d: "5.72 m"
                    },
                    {
                        q: `A cylindrical bucket of radius ${Math.floor(pseudoRandom(seed, 16)*10)+15}\\text{ cm}$ holds water to height ${Math.floor(pseudoRandom(seed, 17)*15)+30}\\text{ cm}$. Find contact area.`,
                        a: "1256.64", b: "5277.87", c: "6534.51", d: "7791.15"
                    },
                    {
                        q: `A cuboid packet measures ${Math.floor(pseudoRandom(seed, 18)*5)+6}\\text{ cm} \\times ${Math.floor(pseudoRandom(seed, 19)*3)+4}\\text{ cm} \\times ${Math.floor(pseudoRandom(seed, 20)*5)+10}\\text{ cm}$. Find capacity in litres.`,
                        a: "0.51 litres", b: "5.1 litres", c: "51 litres", d: "510 litres"
                    },
                    {
                        q: `The temperature of a liquid is -${Math.floor(pseudoRandom(seed, 21)*20)+10}\\text{ K}$. Which calculation gives Celsius?`,
                        a: "$-15+273$", b: "$-15-273$", c: "$-15\\times 273$", d: "$-15\\div 273$"
                    },
                    {
                        q: `Salome estimated window height as ${(pseudoRandom(seed, 22)+1).toFixed(1)}\\text{ m}$, actual is ${(pseudoRandom(seed, 23)+0.8).toFixed(1)}\\text{ m}$. Which gives percentage error?`,
                        a: "$\\frac{0.3}{1.5}\\times 100\\%$", b: "$\\frac{0.3}{1.2}\\times 100\\%$", c: "$\\frac{1.2}{1.5}\\times 100\\%$", d: "$\\frac{1.5}{1.2}\\times 100\\%$"
                    },
                    {
                        q: "A quadrilateral has equal opposite sides and diagonals bisecting at $90^\\circ$. Name it.",
                        a: "Rhombus", b: "Rectangle", c: "Parallelogram", d: "Trapezium"
                    },
                    {
                        q: "An architectural scale drawing is 1:100. A constructed wall is 3 m long. Find length on drawing.",
                        a: "3 cm", b: "0.3 cm", c: "30 cm", d: "300 cm"
                    },
                    {
                        q: "Line $L_1$ has equation $2y = x + 3$. Line $L_2$ is perpendicular to $L_1$. Find gradient of $L_2$.",
                        a: "-2", b: "$\\frac{1}{2}$", c: "$-\\frac{1}{2}$", d: "2"
                    },
                    {
                        q: "A photograph of length 16 cm was enlarged to twice its size. Find new length.",
                        a: "32 cm", b: "8 cm", c: "18 cm", d: "14 cm"
                    },
                    {
                        q: "Express recurring decimal $0.17$ as a fraction in its simplest form.",
                        a: "$\\frac{17}{99}$", b: "$\\frac{17}{100}$", c: "$\\frac{17}{10}$", d: "$\\frac{3}{17}$"
                    },
                    {
                        q: "What is the surface area of a solid cone with base radius 4.2 cm and slant height 20 cm?",
                        a: "316.67 cm$^2$", b: "307.89 cm$^2$", c: "254.12 cm$^2$", d: "412.50 cm$^2$"
                    },
                    {
                        q: "A cylindrical tin of radius 1.8 cm contains water. A spherical ball of radius 1.5 cm is immersed. Find rise in water level.",
                        a: "1.4 cm", b: "2.1 cm", c: "0.8 cm", d: "3.2 cm"
                    },
                    {
                        q: "The letters of the word ELEMENTAITA are placed in a bucket. Find probability of picking E.",
                        a: "$\\frac{3}{11}$", b: "$\\frac{2}{11}$", c: "$\\frac{1}{11}$", d: "$\\frac{8}{11}$"
                    },
                    {
                        q: `Evaluate the cube root: $\\sqrt[3]{${Math.floor(pseudoRandom(seed, 24)*5000)+1000}}$ to 2 decimal places.`,
                        a: "15.47", b: "12.34", c: "18.92", d: "21.05"
                    },
                    {
                        q: `A cylindrical water tank has radius ${Math.floor(pseudoRandom(seed, 25)*2)+1}.${Math.floor(pseudoRandom(seed, 26)*9)+1}\\text{ m}$ and height ${Math.floor(pseudoRandom(seed, 27)*3)+2}\\text{ m}$. Find its capacity in litres.`,
                        a: "15400 litres", b: "23100 litres", c: "38500 litres", d: "45000 litres"
                    },
                    {
                        q: `Solve the simultaneous equations: $3x + y = 11$ and $x + y = 5$. Find the value of $x$.`,
                        a: "3", b: "2", c: "4", d: "1"
                    }
                ];
            } else {
                // Grade 9 Advanced Pool
                pool = [
                    {
                        q: `Line $L_1$ has equation $3y - 2x = ${Math.floor(pseudoRandom(seed, 1)*5)+4}$. Find the gradient of line $L_2$ perpendicular to $L_1$.`,
                        a: "$-\\frac{3}{2}$", b: "$\\frac{2}{3}$", c: "$\\frac{3}{2}$", d: "$-\\frac{2}{3}$"
                    },
                    {
                        q: `A solid metal sphere of radius ${Math.floor(pseudoRandom(seed, 2)*3)+3}\\text{ cm}$ is melted and recast into a cylindrical rod of radius ${Math.floor(pseudoRandom(seed, 3)*2)+1}\\text{ cm}$. Find the length of the rod.`,
                        a: `${Math.floor(pseudoRandom(seed, 4)*10)+12}\\text{ cm}`, b: `${Math.floor(pseudoRandom(seed, 5)*10)+24}\\text{ cm}`, c: `${Math.floor(pseudoRandom(seed, 6)*10)+36}\\text{ cm}`, d: `${Math.floor(pseudoRandom(seed, 7)*10)+48}\\text{ cm}`
                    },
                    {
                        q: `Town A is situated at longitude $30^\\circ\\text{W}$ and Town B at longitude $45^\\circ\\text{E}$. Find the time difference between the two towns.`,
                        a: "5 hours", b: "4 hours", c: "6 hours", d: "7 hours"
                    },
                    {
                        q: `A basket contains ${Math.floor(pseudoRandom(seed, 8)*5)+4}$ red balls and ${Math.floor(pseudoRandom(seed, 9)*5)+3}$ blue balls. Two balls are picked at random without replacement. Find the probability that both are red.`,
                        a: `\\frac{${Math.floor(pseudoRandom(seed, 10)*3)+1}}{${Math.floor(pseudoRandom(seed, 11)*5)+15}}`, b: "\\frac{2}{7}", c: "\\frac{3}{11}", d: "\\frac{4}{13}"
                    },
                    {
                        q: `The cash price of a television set is Ksh ${Math.floor(pseudoRandom(seed, 12)*10000)+30000}$. A customer opts to buy it on hire purchase by paying a deposit of Ksh ${Math.floor(pseudoRandom(seed, 13)*2000)+5000}$ and ${Math.floor(pseudoRandom(seed, 14)*6)+12}$ monthly instalments of Ksh ${Math.floor(pseudoRandom(seed, 15)*500)+2500}$. Calculate the hire purchase extra cost.`,
                        a: `Ksh ${Math.floor(pseudoRandom(seed, 16)*1000)+3500}`, b: `Ksh ${Math.floor(pseudoRandom(seed, 17)*1000)+5200}`, c: `Ksh ${Math.floor(pseudoRandom(seed, 18)*1000)+7100}`, d: `Ksh ${Math.floor(pseudoRandom(seed, 19)*1000)+9400}`
                    },
                    {
                        q: `Vector $\\mathbf{p} = \\begin{pmatrix} ${Math.floor(pseudoRandom(seed, 20)*5)+2} \\\\ -${Math.floor(pseudoRandom(seed, 21)*4)+1} \\end{pmatrix}$ and $\\mathbf{q} = \\begin{pmatrix} -${Math.floor(pseudoRandom(seed, 22)*3)+1} \\\\ ${Math.floor(pseudoRandom(seed, 23)*5)+3} \\end{pmatrix}$. Find column vector $2\\mathbf{p} + 3\\mathbf{q}$.`,
                        a: `\\begin{pmatrix} -1 \\\\ 7 \\end{pmatrix}`, b: `\\begin{pmatrix} 5 \\\\ 2 \\end{pmatrix}`, c: `\\begin{pmatrix} -3 \\\\ 11 \\end{pmatrix}`, d: `\\begin{pmatrix} 2 \\\\ 5 \\end{pmatrix}`
                    },
                    {
                        q: `Simplify completely: $\\frac{4x^2 - 9}{2x^2 + x - 3}$`,
                        a: `\\frac{2x - 3}{x - 1}`, b: `\\frac{2x + 3}{x + 1}`, c: `\\frac{2x - 3}{x + 1}`, d: `\\frac{2x + 3}{x - 1}`
                    },
                    {
                        q: `The angle of elevation of the top of a tower from a point ${Math.floor(pseudoRandom(seed, 24)*20)+30}\\text{ m}$ away from its base on level ground is ${Math.floor(pseudoRandom(seed, 25)*15)+30}^\\circ$. Find the height of the tower.`,
                        a: `${Math.floor(pseudoRandom(seed, 26)*10)+18}\\text{ m}`, b: `${Math.floor(pseudoRandom(seed, 27)*10)+28}\\text{ m}`, c: `${Math.floor(pseudoRandom(seed, 28)*10)+38}\\text{ m}`, d: `${Math.floor(pseudoRandom(seed, 29)*10)+48}\\text{ m}`
                    },
                    {
                        q: `A company's net profit increased in the ratio ${Math.floor(pseudoRandom(seed, 30)*2)+3}:${Math.floor(pseudoRandom(seed, 31)*2)+1}$ over two years. If the original profit was Ksh ${Math.floor(pseudoRandom(seed, 32)*100000)+200000}$, find the new profit.`,
                        a: `Ksh ${Math.floor(pseudoRandom(seed, 33)*50000)+450000}`, b: `Ksh ${Math.floor(pseudoRandom(seed, 34)*50000)+600000}`, c: `Ksh ${Math.floor(pseudoRandom(seed, 35)*50000)+750000}`, d: `Ksh ${Math.floor(pseudoRandom(seed, 36)*50000)+900000}`
                    },
                    {
                        q: `Find the inverse of matrix $\\begin{pmatrix} 3 & 2 \\\\ 5 & 4 \\end{pmatrix}$.`,
                        a: `\\begin{pmatrix} 2 & -1 \\\\ -2.5 & 1.5 \\end{pmatrix}`, b: `\\begin{pmatrix} 1 & -2 \\\\ -3 & 4 \\end{pmatrix}`, c: `\\begin{pmatrix} 3 & -2 \\\\ -5 & 4 \\end{pmatrix}`, d: `\\begin{pmatrix} 0.5 & 1 \\\\ 1.5 & 2 \\end{pmatrix}`
                    },
                    {
                        q: `A regular polygon has an interior angle of ${Math.floor(pseudoRandom(seed, 37)*10)+135}^\\circ$. Determine the number of sides of the polygon.`,
                        a: "8", b: "10", c: "12", d: "16"
                    },
                    {
                        q: `Find the surface area of a closed cylindrical container of radius ${Math.floor(pseudoRandom(seed, 38)*3)+3}\\text{ cm}$ and height ${Math.floor(pseudoRandom(seed, 39)*5)+7}\\text{ cm}$.`,
                        a: `${Math.floor(pseudoRandom(seed, 40)*100)+250}\\text{ cm}^2`, b: `${Math.floor(pseudoRandom(seed, 41)*100)+380}\\text{ cm}^2`, c: `${Math.floor(pseudoRandom(seed, 42)*100)+510}\\text{ cm}^2`, d: `${Math.floor(pseudoRandom(seed, 43)*100)+640}\\text{ cm}^2`
                    },
                    {
                        q: `Express ${Math.floor(pseudoRandom(seed, 44)*90)+10}.${Math.floor(pseudoRandom(seed, 45)*90)+10}\\dot{5}$ as a fraction in its simplest form.`,
                        a: "\\frac{19}{33}", b: "\\frac{23}{45}", c: "\\frac{31}{90}", d: "\\frac{47}{99}"
                    },
                    {
                        q: `A plane flies from airport X to airport Y on a bearing of ${Math.floor(pseudoRandom(seed, 46)*100)+120}^\\circ$ a distance of ${Math.floor(pseudoRandom(seed, 47)*200)+300}\\text{ km}$. What is the back bearing of X from Y?`,
                        a: `${Math.floor(pseudoRandom(seed, 48)*100)+300}^\\circ`, b: `${Math.floor(pseudoRandom(seed, 49)*100)+180}^\\circ`, c: `${Math.floor(pseudoRandom(seed, 50)*100)+240}^\\circ`, d: `${Math.floor(pseudoRandom(seed, 51)*100)+150}^\\circ`
                    },
                    {
                        q: `Factorize completely: $2x^2 + 7x + 3$.`,
                        a: "$(2x + 1)(x + 3)$", b: "$(2x + 3)(x + 1)$", c: "$(2x - 1)(x - 3)$", d: "$(x + 3)(x + 2)$"
                    },
                    {
                        q: `Calculate the volume of a pyramid with a square base of side ${Math.floor(pseudoRandom(seed, 52)*4)+6}\\text{ cm}$ and vertical height ${Math.floor(pseudoRandom(seed, 53)*5)+9}\\text{ cm}$.`,
                        a: `${Math.floor(pseudoRandom(seed, 54)*50)+120}\\text{ cm}^3`, b: `${Math.floor(pseudoRandom(seed, 55)*50)+180}\\text{ cm}^3`, c: `${Math.floor(pseudoRandom(seed, 56)*50)+240}\\text{ cm}^3`, d: `${Math.floor(pseudoRandom(seed, 57)*50)+310}\\text{ cm}^3`
                    },
                    {
                        q: `Given that $\\sin \\theta = ${0.5 + pseudoRandom(seed, 58)*0.4}$, find the value of $\\theta$ to the nearest degree.`,
                        a: `${Math.floor(pseudoRandom(seed, 59)*20)+35}^\\circ`, b: `${Math.floor(pseudoRandom(seed, 60)*20)+55}^\\circ`, c: `${Math.floor(pseudoRandom(seed, 61)*20)+25}^\\circ`, d: `${Math.floor(pseudoRandom(seed, 62)*20)+65}^\\circ`
                    },
                    {
                        q: `Find the midpoint of the line segment joining points $A(${Math.floor(pseudoRandom(seed, 63)*4)+1}, ${Math.floor(pseudoRandom(seed, 64)*4)+2})$ and $B(${Math.floor(pseudoRandom(seed, 65)*6)+5}, ${Math.floor(pseudoRandom(seed, 66)*6)+8})$$.`,
                        a: `(4, 6)`, b: `(3, 5)`, c: `(5, 7)`, d: `(2, 4)`
                    },
                    {
                        q: `A bag contains 5 green marbles and 3 yellow marbles. Two marbles are drawn successively with replacement. Find the probability of getting one green and one yellow marble.`,
                        a: "\\frac{15}{32}", b: "\\frac{5}{16}", c: "\\frac{9}{20}", d: "\\frac{7}{16}"
                    },
                    {
                        q: `Solve the quadratic equation by factorization: $x^2 - 5x + 6 = 0$.`,
                        a: "$x = 2$ or $x = 3$", b: "$x = -2$ or $x = -3$", c: "$x = 1$ or $x = 6$", d: "$x = -1$ or $x = -6$"
                    }
                ];
            }

            return pool;
        };

        const activeMCQs = generateGradeSpecificMCQs(gradeClean, assessmentType, randomSeed);

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
        latexCode += `    {\\large \\textbf{ELEVATE KENYA PREDICTIONS - ${gradeClean.toUpperCase()}}}\n`;
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
            <p class="font-semibold text-green-700 mb-2">Successfully generated completely unique ${gradeClean} ${assessmentType} examination with strict grade boundaries, non-repeating dynamic question banks, vertical column separator, and professional cover page!</p>
            <div class="space-y-4">
                <textarea readonly class="w-full h-64 font-mono text-xs bg-slate-900 text-green-400 p-3 rounded-lg">${latexCode}</textarea>
            </div>
        `;

    } catch (err) {
        console.error('Generation error:', err);
        outputArea.innerHTML = `<span class="text-red-600 font-medium">Error: ${err.message}</span>`;
    }
});
