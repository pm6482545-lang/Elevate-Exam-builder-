// examGenerator.js
// Pure rule-based (no AI API) KJSEA-style Mathematics paper generator.
// Handles: grade-cumulative curriculum boundaries, topic-aware question
// variety (many templates per sub-strand, not one filler sentence),
// and de-duplication across a whole batch of papers.

// ---------------------------------------------------------------------
// 1. SEEDED RNG — deterministic per paper, but different per paper/index
// ---------------------------------------------------------------------
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeRng(seed) {
    const rand = mulberry32(seed);
    return {
        int(min, max) { return Math.floor(rand() * (max - min + 1)) + min; }, // inclusive
        pick(arr) { return arr[Math.floor(rand() * arr.length)]; },
        shuffle(arr) {
            const a = arr.slice();
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(rand() * (i + 1));
                [a[i], a[j]] = [a[j], a[i]];
            }
            return a;
        },
        float() { return rand(); }
    };
}

// ---------------------------------------------------------------------
// 1b. COVERAGE CHECK — confirms what's actually in curriculum_designs
//     (grades x subjects x sub-strands) instead of assuming it's complete.
// ---------------------------------------------------------------------
async function checkCurriculumCoverage(supabase) {
    const { data, error } = await supabase
        .from('curriculum_designs')
        .select('grade, learning_area, strand_name, sub_strand_name');
    if (error) throw error;

    const bySubjectGrade = {}; // subject -> grade -> Set(sub_strand)
    (data || []).forEach(row => {
        const subject = row.learning_area || '(unlabelled subject)';
        const grade = row.grade || '(unlabelled grade)';
        bySubjectGrade[subject] = bySubjectGrade[subject] || {};
        bySubjectGrade[subject][grade] = bySubjectGrade[subject][grade] || new Set();
        bySubjectGrade[subject][grade].add(row.sub_strand_name || row.strand_name || '(unnamed sub-strand)');
    });

    const report = [];
    Object.keys(bySubjectGrade).sort().forEach(subject => {
        const grades = bySubjectGrade[subject];
        GRADE_ORDER.forEach(g => {
            if (grades[g]) {
                report.push({ subject, grade: g, subStrandCount: grades[g].size, subStrands: [...grades[g]] });
            }
        });
        // also surface any grade label that doesn't match the expected "Grade 7/8/9" format
        Object.keys(grades).filter(g => !GRADE_ORDER.includes(g)).forEach(g => {
            report.push({ subject, grade: g, subStrandCount: grades[g].size, subStrands: [...grades[g]], unrecognizedGradeLabel: true });
        });
    });

    const missing = [];
    Object.keys(bySubjectGrade).sort().forEach(subject => {
        GRADE_ORDER.forEach(g => {
            if (!bySubjectGrade[subject][g]) missing.push({ subject, grade: g });
        });
    });

    return { totalRows: (data || []).length, subjects: Object.keys(bySubjectGrade).sort(), report, missing };
}

// ---------------------------------------------------------------------
// 2. CURRICULUM GRADE BOUNDARIES
//    KPSEA (primary) and KJSEA (junior school) are separate tracks —
//    Grade 6 content must never appear in a Grade 7 paper, even though
//    7 comes right after 6 numerically. Within a track, content is
//    cumulative from the first grade of that track up to the target:
//    Grade 4 -> Grade 4 only
//    Grade 5 -> Grade 4 + 5
//    Grade 6 -> Grade 4 + 5 + 6
//    Grade 7 -> Grade 7 only (new track, no Grade 4-6 carryover)
//    Grade 8 -> Grade 7 + 8
//    Grade 9 -> Grade 7 + 8 + 9
// ---------------------------------------------------------------------
const GRADE_TRACKS = {
    KPSEA: ['Grade 4', 'Grade 5', 'Grade 6'],
    KJSEA: ['Grade 7', 'Grade 8', 'Grade 9']
};
const GRADE_ORDER = [...GRADE_TRACKS.KPSEA, ...GRADE_TRACKS.KJSEA]; // used only for coverage reporting/display order

function normalizeGradeLabel(rawGrade) {
    const cleaned = String(rawGrade).replace(/[\(\u2013\-].*$/, '').trim();
    const m = cleaned.match(/(\d+)/);
    if (!m) return cleaned;
    return `Grade ${m[1]}`;
}

function trackFor(gradeLabel) {
    return Object.keys(GRADE_TRACKS).find(track => GRADE_TRACKS[track].includes(gradeLabel)) || null;
}

function allowedGradesFor(targetGradeLabel) {
    const track = trackFor(targetGradeLabel);
    if (!track) return [targetGradeLabel]; // unknown grade label: don't guess, restrict to itself
    const seq = GRADE_TRACKS[track];
    const idx = seq.indexOf(targetGradeLabel);
    return seq.slice(0, idx + 1); // itself and everything below IN THE SAME TRACK, never the other track or above
}

/**
 * Fetch curriculum rows for every grade at-or-below the target grade and
 * tag each row with which grade it came from, so question generation can
 * weight toward the target grade while still allowing carried-forward
 * content from earlier grades (never from a later one).
 */
async function fetchCurriculumForGrade(supabase, targetGradeLabel, subject) {
    const grades = allowedGradesFor(targetGradeLabel);
    const results = await Promise.all(
        grades.map(g =>
            supabase
                .from('curriculum_designs')
                .select('strand_name, sub_strand_name, learning_area, grade, content')
                .eq('grade', g)
                .ilike('learning_area', `%${subject}%`)
        )
    );

    const records = [];
    results.forEach((res, i) => {
        if (res.error) throw res.error;
        (res.data || []).forEach(row => {
            records.push({ ...row, content: contentText(row.content), sourceGrade: grades[i] });
        });
    });
    return records;
}

/**
 * Supabase can return `content` as a jsonb object rather than a plain
 * string, which previously printed as the literal text "[object Object]"
 * straight into generated exam questions. This safely extracts readable
 * text from whatever shape `content` actually is.
 */
function contentText(content) {
    if (content == null) return '';
    if (typeof content === 'string') return content;
    if (typeof content === 'object') {
        // Try common field names a curriculum-design jsonb blob might use.
        const candidateKeys = ['description', 'text', 'summary', 'details', 'content', 'value'];
        for (const key of candidateKeys) {
            if (typeof content[key] === 'string' && content[key].trim()) return content[key];
        }
        // If it's an array of strings, join them.
        if (Array.isArray(content)) {
            const strs = content.filter(v => typeof v === 'string');
            if (strs.length) return strs.join('; ');
        }
        // Last resort: no usable string field found — return empty so
        // callers fall back to their own default text instead of dumping
        // "[object Object]" into a question.
        return '';
    }
    return String(content);
}

// ---------------------------------------------------------------------
// 3. TOPIC-AWARE QUESTION BANK
//    Each entry is keyed by a set of match keywords (checked against the
//    sub_strand_name / strand_name / content of a curriculum row) AND a
//    `minGrade` — the earliest grade (within the KJSEA track) at which
//    that concept is examinable per the KICD design.
//
//    CRITICAL: a topic is only eligible for a paper if minGrade is in
//    allowedGradesFor(targetGrade) (see findTopic below). This is what
//    stops e.g. a Grade 7 paper from drawing an indices, cube-root,
//    simultaneous-equations, density, or VAT question — those concepts
//    genuinely don't appear until Grade 8/9, and previously they were
//    bundled into the same topic bucket as a legitimate Grade 7 concept
//    (e.g. squares/square-roots), so generateUniqueFrom could pick them
//    at random for a Grade 7 row purely because the row matched a shared
//    keyword like "square". Splitting the buckets by grade and filtering
//    on minGrade closes that leak.
// ---------------------------------------------------------------------

function money(n) { return `Ksh ${n.toLocaleString()}`; }

const TOPICS = [
    {
        key: 'whole-numbers',
        minGrade: 'Grade 7',
        match: ['whole number', 'place value', 'operations on whole', 'number sense', 'factor', 'multiple', 'divisib'],
        mcq: [
            (r, ctx) => {
                const a1 = r.int(1200, 98000), a2 = r.int(150, 4000);
                const op = r.pick(['+', '-', '\u00d7']);
                let ans;
                if (op === '+') ans = a1 + a2;
                else if (op === '-') ans = a1 - a2;
                else ans = a1 * a2;
                const distract = [ans + r.int(10, 300), ans - r.int(10, 300), Math.abs(ans - r.int(300, 900))];
                return mcqFromCorrect(r, `Work out ${a1.toLocaleString()} ${op} ${a2.toLocaleString()}.`, ans, distract);
            },
            (r) => {
                const n = r.int(340000, 987000);
                const place = r.pick(['hundreds', 'thousands', 'ten thousands', 'hundred thousands']);
                return { q: `In the number ${n.toLocaleString()}, what is the place value of the digit in the ${place} position?`,
                    a: place, b: 'ones', c: 'tens', d: 'millions' };
            },
            (r) => {
                const n = r.int(24, 96);
                const factors = [];
                for (let i = 1; i <= n; i++) if (n % i === 0) factors.push(i);
                const ans = factors.length;
                const distract = [ans + 1, ans - 1, Math.max(1, ans - 2)];
                return mcqFromCorrect(r, `How many factors does ${n} have?`, ans, distract);
            },
            (r) => {
                const a = r.pick([4, 6, 8, 9, 12]), b = r.pick([6, 8, 9, 10, 15].filter(x => x !== a));
                const ans = (a * b) / gcd(a, b);
                const distract = [a * b, ans + a, Math.min(a, b)];
                return mcqFromCorrect(r, `Find the Lowest Common Multiple (LCM) of ${a} and ${b}.`, ans, distract);
            }
        ],
        sectionB: [
            (r, ctx) => {
                const total = r.int(6000, 15000);
                const ran = r.int(2000, total - 800);
                const walked = total - ran;
                return {
                    q: `${r.pick(['Anita', 'Brian', 'Chebet', 'Dennis'])} participated in a ${total.toLocaleString()}\\text{ m} race for ${ctx.gradeClean}. ${r.pick(['She', 'He'])} ran ${ran.toLocaleString()}\\text{ m} and walked the rest of the distance.`,
                    parts: [
                        '(a) Work out the distance walked. \\hfill \\textbf{[1 mark]}',
                        '(b) Write the distance run in words. \\hfill \\textbf{[1 mark]}',
                        '(c) Round off the distance run to the nearest hundred. \\hfill \\textbf{[1 mark]}'
                    ],
                    marks: 3
                };
            }
        ]
    },
    {
        key: 'fractions-decimals',
        minGrade: 'Grade 7',
        match: ['fraction', 'decimal'],
        mcq: [
            (r) => {
                const d1 = r.pick([2, 3, 4, 5, 6, 8]);
                const n1 = r.int(1, d1 - 1);
                const d2 = r.pick([2, 3, 4, 5, 6, 8].filter(x => x !== d1));
                const n2 = r.int(1, d2 - 1);
                const lcm = (d1 * d2) / gcd(d1, d2);
                const sum = (n1 * (lcm / d1) + n2 * (lcm / d2));
                const g = gcd(sum, lcm);
                const ans = `${sum / g}/${lcm / g}`;
                const distract = [`${sum}/${lcm}`, `${n1 + n2}/${d1 + d2}`, `${sum / g + 1}/${lcm / g}`];
                return mcqFromCorrect(r, `Evaluate $\\frac{${n1}}{${d1}} + \\frac{${n2}}{${d2}}$, giving your answer in its simplest form.`, ans, distract);
            },
            (r) => {
                const whole = r.int(3, 40) / 10;
                const factor = r.int(2, 8);
                const ans = (whole * factor).toFixed(2);
                const distract = [(whole + factor).toFixed(2), (whole * factor + 0.1).toFixed(2), (whole / factor).toFixed(2)];
                return mcqFromCorrect(r, `Work out ${whole.toFixed(1)} \\times ${factor}.`, ans, distract);
            }
        ],
        sectionB: [
            (r) => {
                const price = r.int(80, 300);
                const frac = r.pick(['1/4', '2/5', '3/8', '3/4']);
                return {
                    q: `A trader bought a bag of maize for ${money(price)}. She sold ${frac} of it and stored the rest.`,
                    parts: [
                        '(a) Calculate the fraction of the maize that was stored. \\hfill \\textbf{[1 mark]}',
                        '(b) If the maize sold earned her a profit of 10\\%, calculate the selling price of the portion sold. \\hfill \\textbf{[3 marks]}'
                    ],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'ratio-proportion',
        minGrade: 'Grade 8', // Ratio/Proportion first appears under "Rates, Ratio, Proportions and Percentages" (G8 1.5)
        match: ['ratio', 'proportion', 'rate'],
        mcq: [
            (r) => {
                const parts = [r.int(2, 6), r.int(2, 6), r.int(2, 6)];
                const total = r.int(20, 60) * (parts[0] + parts[1] + parts[2]);
                const unit = total / (parts[0] + parts[1] + parts[2]);
                const shares = parts.map(p => p * unit);
                const smallest = Math.min(...shares);
                const distract = [smallest + 20, smallest - 10, total];
                return mcqFromCorrect(r, `A sum of Ksh ${total.toLocaleString()} is shared among three people in the ratio ${parts.join(':')}. What is the smallest share?`, smallest, distract);
            }
        ],
        sectionB: [
            (r) => {
                const a = r.int(2, 6), b = r.int(2, 6), c = r.int(2, 6);
                const children = r.int(30, 90);
                return {
                    q: `A ceremony was attended by men, women and children in the ratio ${a}:${b}:${c}. There were ${children} children.`,
                    parts: [
                        '(a) Determine the number of men who attended. \\hfill \\textbf{[3 marks]}',
                        '(b) Calculate how many more women than men attended. \\hfill \\textbf{[2 marks]}'
                    ],
                    marks: 5
                };
            }
        ]
    },
    {
        key: 'money-interest-hire-purchase',
        minGrade: 'Grade 8', // Interest, appreciation, depreciation, hire purchase — G8 3.3 Money
        match: ['interest', 'principal', 'compound interest', 'appreciation', 'depreciation', 'hire purchase'],
        mcq: [
            (r) => {
                const principal = r.int(5000, 50000);
                const rate = r.pick([5, 8, 10, 12]);
                const time = r.int(1, 3);
                const ans = (principal * rate * time) / 100;
                const distract = [ans + 500, ans - 300, (principal * rate) / 100];
                return mcqFromCorrect(r, `Calculate the simple interest on ${money(principal)} at ${rate}\\% per annum for ${time} year(s).`, ans, distract);
            }
        ],
        sectionB: [
            (r) => {
                const price = r.int(20000, 80000);
                const deposit = r.pick([10, 20, 25, 30]);
                const depositAmt = (price * deposit) / 100;
                const installments = r.int(6, 24);
                const monthly = r.int(500, 3000);
                return {
                    q: `A shop sells an item on hire purchase for a cash price of ${money(price)}. A customer pays a deposit of ${deposit}\\% of the cash price and the balance in ${installments} equal monthly installments of ${money(monthly)} each.`,
                    parts: [
                        '(a) Calculate the deposit paid. \\hfill \\textbf{[2 marks]}',
                        '(b) Calculate the total hire purchase price. \\hfill \\textbf{[2 marks]}'
                    ],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'money-import-export-vat',
        minGrade: 'Grade 9', // Import/export duty, excise duty, VAT, currency conversion — G9 3.5 Money
        match: ['import duty', 'export', 'excise', 'value added tax', 'vat', 'currency'],
        mcq: [],
        sectionB: [
            (r) => {
                const value = r.int(600000, 2000000);
                const dImport = r.pick([10, 15, 20, 25]);
                const dExcise = r.pick([10, 15, 18]);
                const vat = 16;
                return {
                    q: `A trader imported machinery with a customs value of ${money(value)}. Import duty is charged at ${dImport}\\%, excise duty at ${dExcise}\\% (on value plus import duty), and VAT at ${vat}\\% (on value plus import duty plus excise duty).`,
                    parts: [
                        '(a) Calculate the import duty payable. \\hfill \\textbf{[2 marks]}',
                        '(b) Calculate the excise duty payable. \\hfill \\textbf{[2 marks]}',
                        '(c) Calculate the Value Added Tax payable. \\hfill \\textbf{[1 mark]}'
                    ],
                    marks: 5
                };
            }
        ]
    },
    {
        key: 'commercial-profit-loss',
        minGrade: 'Grade 7', // Profit/loss/discount/commission — G7 3.7 Money
        match: ['profit', 'loss', 'discount', 'commission', 'percentage profit', 'percentage loss'],
        mcq: [
            (r) => {
                const price = r.int(500, 5000);
                const pct = r.pick([5, 8, 10, 12, 15, 20]);
                const ans = price + (price * pct) / 100;
                const distract = [price - (price * pct) / 100, (price * pct) / 100, price + pct];
                return mcqFromCorrect(r, `An item marked at ${money(price)} is sold at a profit of ${pct}\\%. Find the selling price.`, ans, distract);
            }
        ],
        sectionB: []
    },
    {
        key: 'money',
        minGrade: 'Grade 7',
        match: ['money', 'currency', 'bank', 'postal', 'shopping'],
        mcq: [
            (r) => {
                const notes = [1000, 500, 200, 100, 50];
                const count1 = r.int(2, 8), count2 = r.int(1, 6);
                const n1 = r.pick(notes), n2 = r.pick(notes.filter(x => x !== n1));
                const ans = count1 * n1 + count2 * n2;
                const distract = [ans + n2, ans - n1, count1 * n1];
                return mcqFromCorrect(r, `A learner has ${count1} notes of Ksh ${n1} and ${count2} notes of Ksh ${n2}. Find the total amount of money.`, ans, distract);
            },
            (r) => {
                const price = r.int(50, 500);
                const items = r.int(3, 12);
                const paid = r.int(1000, 5000);
                const total = price * items;
                const ans = paid - total;
                const distract = [total, paid + total, ans + price];
                return mcqFromCorrect(r, `A shopkeeper sells an item at Ksh ${price} each. A customer buys ${items} items and pays with Ksh ${paid.toLocaleString()}. Find the balance given.`, ans, distract);
            }
        ],
        sectionB: [
            (r) => {
                const salary = r.int(15000, 60000);
                const savingsPct = r.pick([10, 15, 20, 25]);
                const savings = (salary * savingsPct) / 100;
                return {
                    q: `${r.pick(['Mwangi', 'Achieng', 'Kiplagat'])} earns a monthly salary of Ksh ${salary.toLocaleString()}. ${r.pick(['He', 'She'])} saves ${savingsPct}\\% of the salary every month.`,
                    parts: [
                        '(a) Calculate the amount saved every month. \\hfill \\textbf{[2 marks]}',
                        '(b) Calculate the amount remaining after saving. \\hfill \\textbf{[2 marks]}'
                    ],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'squares-square-roots',
        minGrade: 'Grade 7', // G7 1.5 Squares and Square Roots (also revisited G8 via tables/calculator)
        match: ['square root', 'squares and square'],
        mcq: [
            (r) => {
                const base = r.int(4, 25);
                const ans = base * base;
                const distract = [ans + base, ans - base, base * 2];
                return mcqFromCorrect(r, `Find the square of ${base}.`, ans, distract);
            },
            (r) => {
                const root = r.int(3, 15);
                const n = root * root;
                const distract = [root + 1, root - 1, n];
                return mcqFromCorrect(r, `Find $\\sqrt{${n}}$.`, root, distract);
            }
        ],
        sectionB: [
            (r) => {
                const side = r.int(6, 15);
                const areaShown = side * side;
                return {
                    q: `A square plot of land has an area of ${areaShown}\\text{ m}^2$.`,
                    parts: [
                        '(a) Determine the length of one side of the plot. \\hfill \\textbf{[2 marks]}',
                        `(b) A fence is to be built around the plot. Calculate the total length of fencing wire required. \\hfill \\textbf{[2 marks]}`
                    ],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'cubes-cube-roots',
        minGrade: 'Grade 9', // G9 1.2 Cubes and Cube Roots
        match: ['cube root', 'cubes and cube'],
        mcq: [
            (r) => {
                const base = r.int(2, 12);
                const ans = base ** 3;
                const distract = [ans + base, base * 3, ans - base];
                return mcqFromCorrect(r, `Find the cube of ${base}.`, ans, distract);
            },
            (r) => {
                const root = r.int(2, 9);
                const n = root ** 3;
                const distract = [root + 1, root - 1, n];
                return mcqFromCorrect(r, `Find $\\sqrt[3]{${n}}$.`, root, distract);
            }
        ],
        sectionB: []
    },
    {
        key: 'indices-logarithms',
        minGrade: 'Grade 9', // G9 1.3 Indices and Logarithms
        match: ['indices', 'index notation', 'logarithm'],
        mcq: [
            (r) => {
                const base = r.pick([2, 3, 4, 5]);
                const power = r.int(2, 5);
                const ans = Math.pow(base, power);
                const distract = [base * power, ans + base, ans - power];
                return mcqFromCorrect(r, `Evaluate $${base}^{${power}}$.`, ans, distract);
            },
            (r) => {
                const base = r.pick([2, 3, 5]);
                const p1 = r.int(2, 5), p2 = r.int(1, 3);
                const ans = `${base}^{${p1 + p2}}`;
                const distract = [`${base}^{${p1 * p2}}`, `${base}^{${Math.abs(p1 - p2)}}`, `${base}^{${p1 + p2 + 1}}`];
                return mcqFromCorrect(r, `Simplify $${base}^{${p1}} \\times ${base}^{${p2}}$, giving your answer as a single power of ${base}.`, ans, distract);
            }
        ],
        sectionB: []
    },
    {
        key: 'temperature',
        minGrade: 'Grade 7', // G7 3.6 Temperature
        match: ['temperature', 'celsius', 'thermometer'],
        mcq: [
            (r) => {
                const morning = r.int(10, 20), rise = r.int(3, 12);
                const ans = morning + rise;
                const distract = [morning - rise, rise, ans + 2];
                return mcqFromCorrect(r, `The temperature at 6 a.m. was $${morning}^\\circ\\text{C}$. By noon it had risen by $${rise}^\\circ\\text{C}$. Find the temperature at noon.`, ans, distract);
            },
            (r) => {
                const a = r.int(15, 30), b = r.int(1, 14);
                const ans = a - b;
                const distract = [a + b, b - a, ans + 3];
                return mcqFromCorrect(r, `Find the difference in temperature between $${a}^\\circ\\text{C}$ and $${b}^\\circ\\text{C}$.`, ans, distract);
            }
        ],
        sectionB: [
            (r) => {
                const readings = Array.from({ length: 5 }, () => r.int(-5, 25));
                return {
                    q: `The table below shows temperature readings (in $^\\circ\\text{C}$) recorded on five consecutive days: ${readings.join(', ')}.`,
                    parts: [
                        '(a) Determine the difference between the highest and lowest temperature recorded. \\hfill \\textbf{[2 marks]}',
                        '(b) Calculate the mean temperature over the five days. \\hfill \\textbf{[2 marks]}'
                    ],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'simultaneous-equations',
        minGrade: 'Grade 8', // Linear equations in TWO unknowns / elimination — G8 2.2
        match: ['simultaneous', 'two unknowns', 'elimination'],
        mcq: [],
        sectionB: [
            (r) => {
                const books = r.int(3, 8), pens = r.int(2, 6), total1 = r.int(200, 600);
                const books2 = books * 2, pens2 = r.int(1, 4), total2 = r.int(300, 900);
                return {
                    q: `${r.pick(['Regina', 'Kevin', 'Amina'])} bought ${books} books and ${pens} pens for ${money(total1)}. ${r.pick(['Hamisi', 'Otieno', 'Njeri'])} bought ${books2} books and ${pens2} pens of the same type for ${money(total2)}.`,
                    parts: ['Form a pair of simultaneous equations and use them to determine the cost of one book and one pen. \\hfill \\textbf{[5 marks]}'],
                    marks: 5
                };
            }
        ]
    },
    {
        key: 'algebra',
        minGrade: 'Grade 7', // Algebraic expressions and linear equations in ONE unknown — G7 2.1/2.2
        match: ['algebra', 'expression', 'equation', 'substitution', 'linear equation'],
        mcq: [
            (r) => {
                const a = r.int(2, 9), b = r.int(1, 20), c = r.int(20, 90);
                const x = (c - b) / a;
                const clean = Number.isInteger(x);
                const ans = clean ? x : x.toFixed(1);
                const distract = [ans + 1, ans - 2, (c + b) / a];
                return mcqFromCorrect(r, `Solve for $x$: $${a}x + ${b} = ${c}$.`, ans, distract);
            },
            (r) => {
                const x = r.int(2, 8), y = r.int(2, 8);
                const a1 = r.int(2, 5), b1 = r.int(2, 5);
                const val = a1 * x + b1 * y;
                const distract = [val + 2, val - 3, a1 * y + b1 * x];
                return mcqFromCorrect(r, `Given $x = ${x}$ and $y = ${y}$, evaluate $${a1}x + ${b1}y$.`, val, distract);
            }
        ],
        sectionB: [
            (r) => {
                const cost = r.int(30, 150);
                const items = r.int(3, 10);
                const extra = r.int(100, 400);
                return {
                    q: `${r.pick(['Fatuma', 'Otieno', 'Wanjala'])} bought $x$ items each costing Ksh ${cost}, then bought one more item for Ksh ${extra}. In total ${r.pick(['she', 'he'])} spent Ksh ${items * cost + extra}.`,
                    parts: [`Form a linear equation in $x$ and solve it to find the number of items bought at Ksh ${cost} each. \\hfill \\textbf{[4 marks]}`],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'measurement-length-area-volume',
        minGrade: 'Grade 7', // Volume of cubes/cuboids/cylinders — G7 3.4
        match: ['area', 'volume', 'length', 'perimeter', 'mensuration', 'cube', 'cuboid', 'cylinder'],
        mcq: [
            (r) => {
                const side = r.int(3, 12);
                const ans = side ** 3;
                const distract = [side ** 2, side * 3, ans + side];
                return mcqFromCorrect(r, `A cube has a side length of ${side}\\text{ cm}. Find its volume.`, ans, distract);
            }
        ],
        sectionB: [
            (r) => {
                const side = r.int(2, 5) + 0.5 * r.int(0, 1);
                const smallSide = r.pick([25, 30, 40, 50]);
                return {
                    q: `A metallic container is in the shape of a cube of side length ${side}\\text{ m}.`,
                    parts: [
                        '(a) Determine the volume of the container in cubic metres. \\hfill \\textbf{[2 marks]}',
                        `(b) Smaller cubes of side ${smallSide}\\text{ cm} were packed into the container. Determine the number of smaller cubes that were packed. \\hfill \\textbf{[2 marks]}`
                    ],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'sphere-volume',
        minGrade: 'Grade 9', // Volume of a sphere / frustum / cone — G9 3.2 Volume of Solids
        match: ['sphere', 'frustum', 'cone', 'sector of a circle', 'segment of a circle'],
        mcq: [],
        sectionB: [
            (r) => {
                const radius = (r.int(12, 24) / 10).toFixed(1);
                const ballRadius = (parseFloat(radius) - r.int(1, 3) / 10).toFixed(1);
                return {
                    q: `A cylindrical tin of radius ${radius}\\text{ cm} contains water. A spherical ball bearing of radius ${ballRadius}\\text{ cm} is fully immersed in the water.`,
                    parts: ['Determine the rise in the water level, correct to 1 decimal place. \\hfill \\textbf{[4 marks]}'],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'pythagoras',
        minGrade: 'Grade 7', // G7 3.1 Pythagorean Relationship
        match: ['pythagoras', 'pythagorean'],
        mcq: [
            (r) => {
                const pairs = [[3, 4], [6, 8], [5, 12], [9, 12], [8, 15]];
                const [a, b] = r.pick(pairs);
                const scale = r.pick([1, 2]);
                const ans = Math.sqrt(a * a + b * b) * scale;
                const distract = [a * scale + b * scale, ans + 1, ans - 2];
                return mcqFromCorrect(r, `A right-angled triangle has legs of length ${a * scale}\\text{ cm} and ${b * scale}\\text{ cm}. Find the length of the hypotenuse.`, ans, distract);
            }
        ],
        sectionB: [
            (r) => {
                const dist = r.int(2, 6), height = r.int(3, 8);
                return {
                    q: `${r.pick(['Juma', 'Wanjiru', 'Kiptoo'])} placed a metal rod against a vertical wall such that the foot of the rod is ${dist}\\text{ m} from the wall and the top of the rod reaches ${height}\\text{ m} up the wall.`,
                    parts: ['Calculate the length of the rod, correct to 2 decimal places. \\hfill \\textbf{[3 marks]}'],
                    marks: 3
                };
            }
        ]
    },
    {
        key: 'density',
        minGrade: 'Grade 9', // G9 3.3 Mass, Volume, Weight and Density
        match: ['density', 'mass, volume and weight', 'weight and density'],
        mcq: [],
        sectionB: [
            (r) => {
                const mass = r.int(50, 900), vol = r.int(20, 300);
                return {
                    q: `A block of metal has a mass of ${mass}\\text{ g} and a volume of ${vol}\\text{ cm}^3$.`,
                    parts: ['Calculate the density of the metal in $\\text{g/cm}^3$, correct to 2 decimal places. \\hfill \\textbf{[3 marks]}'],
                    marks: 3
                };
            }
        ]
    },
    {
        key: 'geometric-construction',
        minGrade: 'Grade 8', // Constructing perpendicular/parallel lines — G8 4.1 (G7 covers simpler bisection/triangle/circle constructions, handled generically via fallback)
        match: ['construction', 'perpendicular', 'parallel lines', 'bisect', 'compass', 'parallelogram'],
        mcq: [],
        sectionB: [
            (r) => {
                const ab = r.int(4, 8), ad = r.int(3, 6), angle = r.pick([30, 45, 60, 75]);
                return {
                    q: `Using a ruler and a pair of compasses only, construct a parallelogram $ABCD$ in which $AB = ${ab}\\text{ cm}$, $AD = ${ad}\\text{ cm}$ and angle $DAB = ${angle}^\\circ$.`,
                    parts: ['Drop a perpendicular from $D$ to meet $AB$ at $E$ and measure $DE$. \\hfill \\textbf{[5 marks]}'],
                    marks: 5
                };
            }
        ]
    },
    {
        key: 'angles-basic',
        minGrade: 'Grade 7', // G7 4.1 Angles (straight line, point, transversal, polygons)
        match: ['angle on a straight line', 'angles on a straight line', 'angle at a point', 'transversal', 'parallel lines and a transversal', 'interior and exterior angle', 'polygon', 'angles in a parallelogram'],
        mcq: [
            (r) => {
                const a = r.int(20, 160);
                const ans = 180 - a;
                const distract = [a, ans + 10, 360 - a];
                return mcqFromCorrect(r, `Two angles lie on a straight line. One angle is $${a}^\\circ$. Find the size of the other angle.`, ans, distract);
            }
        ],
        sectionB: []
    },
    {
        key: 'data-handling-graphs',
        minGrade: 'Grade 7', // G7 5.1 Data Handling (pictographs, bar graphs, pie charts, line graphs)
        match: ['pictograph', 'bar graph', 'pie chart', 'line graph', 'travel graph', 'organise data', 'collect data'],
        mcq: [
            (r) => {
                const values = Array.from({ length: 4 }, () => r.int(5, 40));
                const total = values.reduce((s, n) => s + n, 0);
                const distract = [total + 5, total - 5, Math.max(...values)];
                return mcqFromCorrect(r, `A pictograph shows the number of learners who chose each of four favourite fruits: ${values.join(', ')}. Find the total number of learners represented.`, total, distract);
            }
        ],
        sectionB: []
    },
    {
        key: 'statistics',
        minGrade: 'Grade 8', // Mean/median/mode of discrete data — G8 5.1 Data Presentation and Interpretation
        match: ['mean', 'measures of central tendency', 'mode', 'median of discrete'],
        mcq: [
            (r) => {
                const nums = Array.from({ length: 5 }, () => r.int(5, 30));
                const mean = (nums.reduce((s, n) => s + n, 0) / nums.length).toFixed(1);
                const distract = [(parseFloat(mean) + 1).toFixed(1), (parseFloat(mean) - 2).toFixed(1), Math.max(...nums).toString()];
                return mcqFromCorrect(r, `Find the mean of the numbers ${nums.join(', ')}.`, mean, distract);
            }
        ],
        sectionB: []
    },
    {
        key: 'statistics-grouped',
        minGrade: 'Grade 9', // Grouped-data frequency tables, class width, modal class — G9 5.1 Data Interpretation (Grouped Data)
        match: ['grouped data', 'class width', 'frequency distribution', 'modal class'],
        mcq: [],
        sectionB: [
            (r) => {
                const n = 20;
                const scores = Array.from({ length: n }, () => r.int(10, 35));
                return {
                    q: `The table below shows marks scored by ${n} learners in a mathematics test: ${scores.join(', ')}.`,
                    parts: [
                        '(a) Prepare a frequency distribution table for the data using suitable class intervals. \\hfill \\textbf{[2 marks]}',
                        '(b) Determine the mean mark and the median mark. \\hfill \\textbf{[3 marks]}'
                    ],
                    marks: 5
                };
            }
        ]
    },
    {
        key: 'probability-basic',
        minGrade: 'Grade 8', // Experimental probability as fraction/decimal/percentage — G8 5.2 Probability
        match: ['probability', 'chance'],
        mcq: [
            (r) => {
                const total = r.int(2, 6), fav = r.int(1, total - 1);
                const g = gcd(fav, total);
                const ans = `${fav / g}/${total / g}`;
                const distract = [`${total - fav}/${total}`, `1/${total}`, `${fav}/${total + 1}`];
                return mcqFromCorrect(r, `A bag contains ${total} identical balls, ${fav} of which are red. A ball is picked at random. Find the probability that it is red.`, ans, distract);
            }
        ],
        sectionB: []
    },
    {
        key: 'probability-combined',
        minGrade: 'Grade 9', // Mutually exclusive / independent events, tree diagrams — G9 5.2 Probability
        match: ['mutually exclusive', 'independent events', 'tree diagram', 'combined events'],
        mcq: [],
        sectionB: [
            (r) => {
                return {
                    q: `${r.pick(['Rebecca', 'Otieno', 'Amina'])} tossed a fair coin and rolled a regular six-sided die simultaneously.`,
                    parts: [
                        '(a) Write down the probability space showing all possible outcomes. \\hfill \\textbf{[2 marks]}',
                        `(b) Determine the probability of obtaining a head on the coin and a ${r.int(1, 6)} on the die. \\hfill \\textbf{[1 mark]}`
                    ],
                    marks: 3
                };
            }
        ]
    }
];

function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; }

// ---------------------------------------------------------------------
// 3b. SUBJECT CONFIG — paper structure differs by subject (KJSEA doesn't
//     give every subject a 20-mark MCQ + 80-mark structured layout the
//     way Mathematics gets). Falls back to a sane generic shape for any
//     subject in the database that isn't explicitly configured yet, so
//     nothing errors out — it just won't have a bespoke topic bank until
//     one is added below.
// ---------------------------------------------------------------------
const SUBJECT_CONFIG = {
    'mathematics': { time: '2 hours 15 minutes', sectionAMarks: 20, sectionACount: 20, sectionBMarks: 80, sectionBCount: 10, hasMcqSection: true },
    'english': { time: '2 hours', sectionAMarks: 40, sectionACount: 0, sectionBMarks: 60, sectionBCount: 8, hasMcqSection: false },
    'kiswahili': { time: '2 hours', sectionAMarks: 40, sectionACount: 0, sectionBMarks: 60, sectionBCount: 8, hasMcqSection: false },
    'integrated science': { time: '2 hours', sectionAMarks: 20, sectionACount: 20, sectionBMarks: 80, sectionBCount: 8, hasMcqSection: true },
    'social studies': { time: '2 hours', sectionAMarks: 20, sectionACount: 20, sectionBMarks: 80, sectionBCount: 8, hasMcqSection: true },
    'agriculture and nutrition': { time: '2 hours', sectionAMarks: 20, sectionACount: 20, sectionBMarks: 80, sectionBCount: 8, hasMcqSection: true },
    'pre-technical studies': { time: '2 hours', sectionAMarks: 20, sectionACount: 20, sectionBMarks: 80, sectionBCount: 8, hasMcqSection: true },
    'creative arts': { time: '1 hour 30 minutes', sectionAMarks: 0, sectionACount: 0, sectionBMarks: 100, sectionBCount: 6, hasMcqSection: false },
    'christian religious education': { time: '2 hours', sectionAMarks: 0, sectionACount: 0, sectionBMarks: 100, sectionBCount: 8, hasMcqSection: false },
};
const GENERIC_SUBJECT_CONFIG = { time: '2 hours', sectionAMarks: 20, sectionACount: 20, sectionBMarks: 80, sectionBCount: 8, hasMcqSection: true };

function configFor(subject) {
    return SUBJECT_CONFIG[String(subject).trim().toLowerCase()] || GENERIC_SUBJECT_CONFIG;
}

// Builds an MCQ object from a correct answer plus distractors, shuffling
// option order with the paper's own RNG so the correct letter varies.
function mcqFromCorrect(r, q, correct, distractors) {
    const options = r.shuffle([correct, ...distractors].map(String));
    const [a, b, c, d] = options;
    return { q, a, b, c, d };
}

// Generic fallback for any curriculum sub-strand that isn't in TOPICS yet,
// or whose only matching TOPICS entries were rejected by the grade filter
// (e.g. a Grade 7 row whose sub-strand text happens to share a keyword
// with a Grade 8/9-only topic). This still varies phrasing/numbers using
// the row's own content text instead of one canned sentence, and — because
// it only ever uses numbers/words supplied by the caller — it can never
// introduce an off-grade concept the way a mismatched TOPICS template can.
const FALLBACK_MCQ_TEMPLATES = [
    (r, row, ctx) => {
        const n1 = r.int(5, 60), n2 = r.int(2, 20);
        const detail = row.content ? ` (${row.content})` : '';
        return { q: `Under "${row.sub_strand_name || row.strand_name}"${detail} for ${ctx.gradeClean} ${ctx.subject}, a learner combines a value of ${n1} with ${n2}. What is their sum?`,
            a: `${n1 + n2}`, b: `${n1 - n2}`, c: `${n1 * n2}`, d: `${Math.abs(n1 - n2) + 1}` };
    },
    (r, row, ctx) => {
        const n1 = r.int(20, 100), n2 = r.int(2, 10);
        const detail = row.content ? ` (${row.content})` : '';
        return { q: `Under "${row.sub_strand_name || row.strand_name}"${detail} for ${ctx.gradeClean} ${ctx.subject}, find the product of ${n1} and ${n2}.`,
            a: `${n1 * n2}`, b: `${n1 + n2}`, c: `${n1 - n2}`, d: `${Math.round(n1 / n2)}` };
    }
];
const FALLBACK_SECTIONB_TEMPLATES = [
    (r, row, ctx) => {
        const detail = row.content ? row.content : `as outlined for ${row.sub_strand_name || row.strand_name}`;
        return {
            q: `With reference to "${row.sub_strand_name || row.strand_name}" (${detail}) for ${ctx.gradeClean} ${ctx.subject}, work through the following.`,
            parts: [
                '(a) Explain the concept, giving one worked example. \\hfill \\textbf{[2 marks]}',
                '(b) Apply the concept to solve a related problem of your own. \\hfill \\textbf{[3 marks]}'
            ],
            marks: 5
        };
    }
];

/**
 * Find the topic a curriculum row belongs to, restricted to topics whose
 * minGrade is actually reachable for this paper's target grade. `ctx` is
 * required for the grade check; pass it whenever a topic pick will be
 * used to generate an actual question (both call sites below do).
 */
function findTopic(row, ctx) {
    const hay = `${row.sub_strand_name || ''} ${row.strand_name || ''} ${row.content || ''}`.toLowerCase();
    const allowed = ctx ? allowedGradesFor(ctx.gradeClean) : null;
    return TOPICS.find(t => {
        if (allowed && !allowed.includes(t.minGrade)) return false;
        return t.match.some(kw => hay.includes(kw));
    });
}

// ---------------------------------------------------------------------
// 4. DE-DUPLICATION ACROSS A WHOLE BATCH
//    `usedSignatures` is shared across every paper in a batch run, so the
//    same generated question (same topic + same rounded numbers) never
//    appears twice across up to 20 papers.
// ---------------------------------------------------------------------
function signatureOf(item) {
    return JSON.stringify(item.q || item.parts).replace(/\s+/g, ' ');
}

function generateUniqueFrom(templates, args, rng, usedSignatures, maxAttempts = 12) {
    if (!templates || !templates.length) return null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const template = rng.pick(templates);
        const item = template(rng, ...args);
        const sig = signatureOf(item);
        if (!usedSignatures.has(sig)) {
            usedSignatures.add(sig);
            return item;
        }
    }
    return null; // exhausted variety for this topic in this run
}

// ---------------------------------------------------------------------
// 5. SECTION BUILDERS
// ---------------------------------------------------------------------
function buildSectionA(records, rng, ctx, usedSignatures, count = 20) {
    const items = [];
    // Weight the pool toward the target grade's own rows, but keep
    // carried-forward rows from lower grades available too.
    const targetRows = records.filter(r => r.sourceGrade === ctx.gradeClean);
    const otherRows = records.filter(r => r.sourceGrade !== ctx.gradeClean);
    const weightedPool = rng.shuffle([...targetRows, ...targetRows, ...otherRows]);

    let cursor = 0;
    let guard = 0;
    while (items.length < count && guard < count * 15) {
        guard++;
        const row = weightedPool.length ? weightedPool[cursor % weightedPool.length] : null;
        cursor++;
        const topic = row ? findTopic(row, ctx) : null;
        let item;
        if (topic) {
            item = generateUniqueFrom(topic.mcq, [ctx], rng, usedSignatures);
        }
        if (!item && row) {
            item = generateUniqueFrom(FALLBACK_MCQ_TEMPLATES, [row, ctx], rng, usedSignatures);
        }
        if (item) items.push(item);
    }
    return items;
}

function buildSectionB(records, rng, ctx, usedSignatures, count = 10) {
    const items = [];
    // CRITICAL: only offer topics that actually appear in this grade's
    // allowed curriculum rows (never the full TOPICS bank), AND whose
    // minGrade is reachable for this target grade (findTopic enforces
    // this) — otherwise a Grade 7 paper could pull in a Grade 8/9-only
    // topic like simultaneous equations, density, or grouped-data
    // statistics just because a template exists for it.
    const rowsInScope = records; // already grade-filtered upstream
    const topicKeysInScope = new Set(
        rowsInScope.map(row => findTopic(row, ctx)).filter(Boolean).map(t => t.key)
    );
    let availableTopics = rng.shuffle(
        TOPICS.filter(t => t.sectionB && t.sectionB.length && topicKeysInScope.has(t.key))
    );
    const untopicked = rng.shuffle(rowsInScope.filter(row => !findTopic(row, ctx)));

    let cursor = 0;
    let untopickedCursor = 0;
    let guard = 0;
    while (items.length < count && guard < count * 15) {
        guard++;
        let item = null;
        if (availableTopics.length && cursor < availableTopics.length * 3) {
            const topic = availableTopics[cursor % availableTopics.length];
            cursor++;
            item = generateUniqueFrom(topic.sectionB, [ctx], rng, usedSignatures);
        }
        if (!item && untopicked.length) {
            const row = untopicked[untopickedCursor % untopicked.length];
            untopickedCursor++;
            item = generateUniqueFrom(FALLBACK_SECTIONB_TEMPLATES, [row, ctx], rng, usedSignatures);
        }
        if (!item) {
            // Nothing left to try (bespoke topics exhausted, no untopicked rows) — stop rather than repeat.
            if (!availableTopics.length && !untopicked.length) break;
            cursor++; untopickedCursor++;
            if (guard >= count * 15) break;
            continue;
        }
        items.push(item);
    }
    return items;
}

// ---------------------------------------------------------------------
// 6. LATEX BUILDER (cover page kept in the original house style)
// ---------------------------------------------------------------------
function buildLatex(ctx, mcqs, sectionB) {
    let tex = '';
    tex += `\\documentclass[12pt,a4paper]{article}\n`;
    tex += `\\usepackage[utf8]{inputenc}\n`;
    tex += `\\usepackage{amsmath,amssymb,tikz,graphicx,multicol}\n`;
    tex += `\\usepackage{geometry}\n`;
    tex += `\\usepackage{eso-pic}\n`;
    tex += `\\geometry{top=20mm, bottom=20mm, left=15mm, right=15mm}\n\n`;
    tex += `\\AddToShipoutPictureBG{\n  \\AtPageCenter{\\put(0,0){\\makebox(0,0){\\includegraphics[width=10cm]{logo.png}}}}\n}\n\n`;
    tex += `\\begin{document}\n\n`;

    const standardName = trackFor(ctx.gradeClean) === 'KPSEA'
        ? 'KENYA PRIMARY SCHOOL EDUCATION ASSESSMENT'
        : 'KENYA JUNIOR SCHOOL EDUCATION ASSESSMENT';
    tex += `\\begin{titlepage}\n\\centering\n`;
    tex += `\\begin{minipage}{0.2\\textwidth}\\centering\\includegraphics[width=2.5cm]{logo.png}\\end{minipage}\n`;
    tex += `\\begin{minipage}{0.55\\textwidth}\\centering\n`;
    tex += `{\\large \\textbf{REPUBLIC OF KENYA}} \\\\[0.3em]\n`;
    tex += `{\\normalsize \\textbf{MINISTRY OF EDUCATION}} \\\\[0.2em]\n`;
    tex += `{\\large \\textbf{${standardName}}} \\\\[0.3em]\n`;
    tex += `{\\large \\textbf{ELEVATE KENYA PREDICTIONS - ${ctx.gradeClean.toUpperCase()}}}\n\\end{minipage}\n`;
    tex += `\\begin{minipage}{0.2\\textwidth}\\centering\\includegraphics[width=2.5cm]{logo.png}\\end{minipage}\n`;
    tex += `\\vspace{1.2cm}\n{\\Large \\textbf{${ctx.subject.toUpperCase()}}}\\\\[0.4em]\n`;
    tex += `{\\large \\textbf{Paper 1 (${ctx.assessmentType})}}\\\\[0.8cm]\n`;
    tex += `{\\normalsize \\textbf{Time: ${ctx.subjectConfig.time}}}\\\\[1.2cm]\n`;
    tex += `\\begin{flushleft}\n`;
    tex += `\\textbf{Learner's Name:} \\rule{10cm}{0.4pt} \\\\[0.8cm]\n`;
    tex += `\\textbf{Assessment Number:} \\rule{8.5cm}{0.4pt} \\\\[0.8cm]\n`;
    tex += `\\textbf{School Name:} \\rule{10.5cm}{0.4pt} \\\\[0.8cm]\n`;
    tex += `\\textbf{Learner's Signature:} \\rule{8.5cm}{0.4pt} \\\\[0.8cm]\n`;
    tex += `\\textbf{Date of Assessment:} \\rule{9cm}{0.4pt} \\\\[1.2cm]\n\\end{flushleft}\n`;
    tex += `\\noindent \\textbf{Instructions to Learners:}\n\\begin{enumerate}\n`;
    tex += `    \\item Write your name and assessment number in the spaces provided above.\n`;
    tex += `    \\item Answer \\textbf{all} questions in Section A and Section B in the spaces provided.\n`;
    tex += `    \\item Mathematical tables and non-programmable electronic calculators may be used.\n`;
    tex += `    \\item Candidates should check the question paper to ascertain that all pages are printed.\n\\end{enumerate}\n`;
    tex += `\\vfill\n{\\small \\textbf{PUBLISHED AND PRODUCED BY ELEVATE KENYA PREDICTIONS}}\n\\end{titlepage}\n\n`;

    if (ctx.subjectConfig.hasMcqSection && mcqs.length) {
        tex += `\\newpage\n\\noindent \\textbf{\\large SECTION A (${ctx.subjectConfig.sectionAMarks} marks)}\\\\[0.2em]\n`;
        tex += `\\noindent \\textit{Answer all the questions in this section on the answer sheet provided.}\n\\hrule\\vspace{1em}\n\n`;
        tex += `\\setlength{\\columnseprule}{1pt}\n\\begin{multicols}{2}\n\\begin{enumerate}\n`;
        mcqs.forEach(item => {
            tex += `    \\item ${item.q}\\\\[0.2em]\n`;
            tex += `    A. ${item.a} \\quad B. ${item.b}\\\\[0.1em]\n`;
            tex += `    C. ${item.c} \\quad D. ${item.d}\\\\[0.6em]\n`;
        });
        tex += `\\end{enumerate}\n\\end{multicols}\n\n`;
    }

    tex += `\\newpage\n\\setlength{\\columnseprule}{0pt}\n`;
    tex += `\\noindent \\textbf{\\large SECTION B (${ctx.subjectConfig.sectionBMarks} marks)}\\\\[0.2em]\n`;
    tex += `\\noindent \\textit{Answer all the questions in the spaces provided.}\n\\hrule\\vspace{1em}\n\n`;
    tex += `\\begin{enumerate}\n`;
    sectionB.forEach(item => {
        tex += `    \\item ${item.q}\\\\[0.3em]\n`;
        (item.parts || []).forEach(p => { tex += `    ${p}\\\\[0.2em]\n`; });
        tex += `    \\vspace{4cm}\n    {\\raggedleft \\textit{\\tiny Working Space} \\hrule}\\\\[1em]\n`;
    });
    tex += `\\end{enumerate}\n\n\\end{document}`;
    return tex;
}

// ---------------------------------------------------------------------
// 7. PUBLIC API
// ---------------------------------------------------------------------

/**
 * Generate one paper. `seed` should differ per paper in a batch.
 * `usedSignatures` should be a Set shared across the whole batch so no
 * two papers (even papers for different grades) repeat the exact same
 * generated question.
 */
async function generatePaper(supabase, { rawGrade, subject, assessmentType, seed, usedSignatures }) {
    const gradeClean = normalizeGradeLabel(rawGrade);
    const records = await fetchCurriculumForGrade(supabase, gradeClean, subject);
    const rng = makeRng(seed);
    const subjectConfig = configFor(subject);
    const ctx = { gradeClean, subject, assessmentType, subjectConfig };

    const sig = usedSignatures || new Set();
    const mcqs = subjectConfig.hasMcqSection
        ? buildSectionA(records, rng, ctx, sig, subjectConfig.sectionACount)
        : [];
    const sectionB = buildSectionB(records, rng, ctx, sig, subjectConfig.sectionBCount);
    const latex = buildLatex(ctx, mcqs, sectionB);
    return { latex, gradeClean, mcqCount: mcqs.length, sectionBCount: sectionB.length };
}

/**
 * Generate up to `count` distinct papers for the same grade/subject/
 * blueprint, sharing one de-duplication set so none of them repeat a
 * question. Papers may come back with fewer questions than requested if
 * the curriculum pool + topic bank genuinely runs out of fresh variants
 * (guarded rather than silently repeating).
 */
async function generateBatch(supabase, { rawGrade, subject, assessmentType, count = 20 }) {
    const usedSignatures = new Set();
    const papers = [];
    for (let i = 0; i < count; i++) {
        const seed = Date.now() % 100000 + i * 7919; // distinct seed per paper
        const paper = await generatePaper(supabase, {
            rawGrade, subject, assessmentType, seed, usedSignatures
        });
        papers.push({ index: i + 1, ...paper });
    }
    return papers;
}

export { generatePaper, generateBatch, normalizeGradeLabel, allowedGradesFor, checkCurriculumCoverage };
