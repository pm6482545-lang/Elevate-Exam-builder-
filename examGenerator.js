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
//    Grade 7 paper -> Grade 7 content only
//    Grade 8 paper -> Grade 7 + Grade 8 content (Grade 8 weighted higher)
//    Grade 9 paper -> Grade 7 + 8 + 9 content (Grade 9 weighted higher)
// ---------------------------------------------------------------------
const GRADE_ORDER = ['Grade 7', 'Grade 8', 'Grade 9'];

function normalizeGradeLabel(rawGrade) {
    const cleaned = String(rawGrade).replace(/[\(\u2013\-].*$/, '').trim();
    const m = cleaned.match(/(\d+)/);
    if (!m) return cleaned;
    return `Grade ${m[1]}`;
}

function allowedGradesFor(targetGradeLabel) {
    const idx = GRADE_ORDER.indexOf(targetGradeLabel);
    if (idx === -1) return [targetGradeLabel]; // unknown grade label: don't guess, restrict to itself
    return GRADE_ORDER.slice(0, idx + 1); // itself and everything below, NEVER above
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
            records.push({ ...row, sourceGrade: grades[i] });
        });
    });
    return records;
}

// ---------------------------------------------------------------------
// 3. TOPIC-AWARE QUESTION BANK
//    Each entry is keyed by a set of match keywords (checked against the
//    sub_strand_name / strand_name / content of a curriculum row).
//    Each topic has SEVERAL template functions so the same topic never
//    reads the same way twice. Every template returns:
//      { q, a, b, c, d } for MCQs (Section A)
//      { q, parts:[...], marks } for Section B
// ---------------------------------------------------------------------

function money(n) { return `Ksh ${n.toLocaleString()}`; }

const TOPICS = [
    {
        key: 'whole-numbers',
        match: ['whole number', 'place value', 'operations on whole', 'number sense'],
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
        key: 'percentages-commercial',
        match: ['percentage', 'commercial arithmetic', 'profit', 'loss', 'discount', 'tax', 'import duty', 'vat'],
        mcq: [
            (r) => {
                const price = r.int(500, 5000);
                const pct = r.pick([5, 8, 10, 12, 15, 20]);
                const ans = price + (price * pct) / 100;
                const distract = [price - (price * pct) / 100, price * pct / 100, price + pct];
                return mcqFromCorrect(r, `An item marked at ${money(price)} is sold at a profit of ${pct}\\%. Find the selling price.`, ans, distract);
            }
        ],
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
        key: 'algebra',
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
        key: 'measurement-length-area-volume',
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
            },
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
        key: 'geometry-pythagoras',
        match: ['pythagoras', 'right angle', 'angle', 'triangle', 'construction', 'similarity', 'enlargement'],
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
                const rodLen = Math.sqrt(dist * dist + height * height).toFixed(2);
                const mass = r.int(1, 5), vol = r.int(200, 900);
                return {
                    q: `${r.pick(['Juma', 'Wanjiru', 'Kiptoo'])} placed a metal rod against a vertical wall such that the foot of the rod is ${dist}\\text{ m} from the wall and the top of the rod reaches ${height}\\text{ m} up the wall.`,
                    parts: [
                        '(a) Calculate the length of the rod. \\hfill \\textbf{[2 marks]}',
                        `(b) The rod has a mass of ${mass}\\text{ kg} and a volume of ${vol}\\text{ cm}^3$. Calculate its density in $\\text{g/cm}^3$. \\hfill \\textbf{[2 marks]}`
                    ],
                    marks: 4
                };
            },
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
        key: 'statistics',
        match: ['statistic', 'data handling', 'mean', 'median', 'frequency', 'measures of central tendency'],
        mcq: [
            (r) => {
                const nums = Array.from({ length: 5 }, () => r.int(5, 30));
                const mean = (nums.reduce((s, n) => s + n, 0) / nums.length).toFixed(1);
                const distract = [(parseFloat(mean) + 1).toFixed(1), (parseFloat(mean) - 2).toFixed(1), Math.max(...nums).toString()];
                return mcqFromCorrect(r, `Find the mean of the numbers ${nums.join(', ')}.`, mean, distract);
            }
        ],
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
        key: 'probability',
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

// Generic fallback for any curriculum sub-strand that isn't in TOPICS yet.
// Still varies phrasing/numbers using the row's own content text instead
// of one canned sentence, so unmapped topics degrade gracefully rather
// than reverting to the old filler question.
const FALLBACK_MCQ_TEMPLATES = [
    (r, row, ctx) => {
        const n1 = r.int(5, 60), n2 = r.int(2, 20);
        return { q: `Under the sub-strand "${row.sub_strand_name || row.strand_name}" (${ctx.gradeClean} ${ctx.subject}: ${row.content || 'as described in the curriculum design'}), which of the following best applies the concept when combining a value of ${n1} with ${n2}?`,
            a: `${n1 + n2}`, b: `${n1 - n2}`, c: `${n1 * n2}`, d: `${Math.abs(n1 - n2) + 1}` };
    },
    (r, row, ctx) => {
        return { q: `Which of the following statements correctly describes an aspect of "${row.sub_strand_name || row.strand_name}" under ${row.strand_name || ctx.subject} for ${ctx.gradeClean}, as covered by "${row.content || 'this sub-strand'}"?`,
            a: 'It is correctly applied as described in the curriculum design',
            b: 'It is unrelated to this strand',
            c: 'It only applies to a different grade level',
            d: 'It cannot be assessed in a written paper' };
    }
];
const FALLBACK_SECTIONB_TEMPLATES = [
    (r, row, ctx) => ({
        q: `With reference to "${row.sub_strand_name || row.strand_name}" (${row.content || 'as outlined in the curriculum design'}) for ${ctx.gradeClean} ${ctx.subject}, respond to the following.`,
        parts: [
            '(a) Explain the concept in your own words. \\hfill \\textbf{[2 marks]}',
            '(b) Give one real-life application of this concept. \\hfill \\textbf{[3 marks]}'
        ],
        marks: 5
    })
];

function findTopic(row) {
    const hay = `${row.sub_strand_name || ''} ${row.strand_name || ''} ${row.content || ''}`.toLowerCase();
    return TOPICS.find(t => t.match.some(kw => hay.includes(kw)));
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
        const topic = row ? findTopic(row) : null;
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
    // allowed curriculum rows (never the full TOPICS bank), otherwise a
    // Grade 7 paper could pull in a Grade 8/9-only topic like Pythagoras
    // or Probability just because a template exists for it.
    const rowsInScope = records; // already grade-filtered upstream
    const topicKeysInScope = new Set(
        rowsInScope.map(row => findTopic(row)).filter(Boolean).map(t => t.key)
    );
    let availableTopics = rng.shuffle(
        TOPICS.filter(t => t.sectionB && t.sectionB.length && topicKeysInScope.has(t.key))
    );
    const untopicked = rng.shuffle(rowsInScope.filter(row => !findTopic(row)));

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

    tex += `\\begin{titlepage}\n\\centering\n`;
    tex += `\\begin{minipage}{0.2\\textwidth}\\centering\\includegraphics[width=2.5cm]{logo.png}\\end{minipage}\n`;
    tex += `\\begin{minipage}{0.55\\textwidth}\\centering\n`;
    tex += `{\\large \\textbf{REPUBLIC OF KENYA}} \\\\[0.3em]\n`;
    tex += `{\\normalsize \\textbf{MINISTRY OF EDUCATION}} \\\\[0.2em]\n`;
    tex += `{\\large \\textbf{KENYA JUNIOR SCHOOL EDUCATION ASSESSMENT}} \\\\[0.3em]\n`;
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
