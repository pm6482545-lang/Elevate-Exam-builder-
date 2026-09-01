// examGenerator.js
// KJSEA-style Mathematics paper generator. Questions come from a
// self-hosted open-source AI model (aiQuestionGenerator.js) when
// configured — no third-party AI API — with every AI-generated question
// arithmetic-verified before acceptance. Falls back automatically to a
// hand-written, rule-based template bank when AI is disabled, unreachable,
// or fails to produce a verifiable question for a given curriculum row.
// Handles: grade-cumulative curriculum boundaries, cross-batch
// de-duplication, and KNEC-style paper structure/layout.

import { generateVerifiedMcq, generateVerifiedSectionB } from './aiQuestionGenerator.js';

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
                const digits = String(n).split('').map(Number);
                // digits[0] is the hundred-thousands place, digits[5] is ones
                const placeNames = ['hundred thousands', 'ten thousands', 'thousands', 'hundreds', 'tens', 'ones'];
                const idx = r.int(0, 3); // keep to hundreds-and-above, matching the exam's usual range
                const place = placeNames[idx];
                const correctDigit = digits[idx];
                const otherDigits = digits.filter((d, i) => i !== idx);
                const distract = r.shuffle([...new Set(otherDigits)]).slice(0, 3);
                while (distract.length < 3) distract.push((correctDigit + distract.length + 1) % 10);
                return mcqFromCorrect(r, `In the number ${n.toLocaleString()}, what digit is in the ${place} position?`, correctDigit, distract);
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
                        '(a) Work out the distance walked. \\hfill (1 mark)',
                        '(b) Write the distance run in words. \\hfill (1 mark)',
                        '(c) Round off the distance run to the nearest hundred. \\hfill (1 mark)'
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
                return mcqFromCorrect(r, `Work out $${whole.toFixed(1)} \\times ${factor}$.`, ans, distract);
            },
            (r) => {
                // "Which calculation gives the extra time" style — an
                // expression-selection question rather than a computed one,
                // mirroring the real paper's format.
                const seedlings = r.int(40, 100);
                // Ensure the "took" fraction (d2) is genuinely larger than
                // the "allocated" fraction (d1) — i.e. d2 < d1 as a
                // denominator — so the extra-time story is physically
                // sensible (more time per seedling than planned).
                const denomPair = r.pick([[5, 4], [4, 3], [5, 3], [3, 2]]);
                const [d1, d2] = denomPair;
                const name = r.pick(['Kamau', 'Wanjiku', 'Otieno', 'Achieng']);
                const pronoun = r.pick(['He', 'She']);
                const correct = `\\left(\\frac{1}{${d2}} - \\frac{1}{${d1}}\\right) \\times ${seedlings}`;
                const distract = [
                    `\\left(\\frac{1}{${d1}} + \\frac{1}{${d2}}\\right) \\times ${seedlings}`,
                    `\\left(\\frac{1}{${d2}} \\div \\frac{1}{${d1}}\\right) \\times ${seedlings}`,
                    `\\left(\\frac{1}{${d1}} - \\frac{1}{${d2}}\\right) \\times ${seedlings}`
                ];
                return mcqFromCorrect(r, `${name} intended to plant ${seedlings} seedlings. ${pronoun} allocated $\\frac{1}{${d1}}$ of an hour to plant each seedling. During the planting, ${pronoun.toLowerCase()} took $\\frac{1}{${d2}}$ of an hour to plant each seedling instead. Which of the following calculations gives the extra time ${name} used to plant all the seedlings?`, `$${correct}$`, distract.map(d => `$${d}$`));
            }
        ],
        sectionB: [
            (r) => {
                const price = r.int(80, 300);
                const frac = r.pick(['1/4', '2/5', '3/8', '3/4']);
                return {
                    q: `A trader bought a bag of maize for ${money(price)}. She sold ${frac} of it and stored the rest.`,
                    parts: [
                        '(a) Calculate the fraction of the maize that was stored. \\hfill (1 mark)',
                        '(b) If the maize sold earned her a profit of 10\\%, calculate the selling price of the portion sold. \\hfill (3 marks)'
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
                        '(a) Determine the number of men who attended. \\hfill (3 marks)',
                        '(b) Calculate how many more women than men attended. \\hfill (2 marks)'
                    ],
                    marks: 5
                };
            }
        ]
    },
    {
        key: 'money',
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
                        '(a) Calculate the amount saved every month. \\hfill (2 marks)',
                        '(b) Calculate the amount remaining after saving. \\hfill (2 marks)'
                    ],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'squares-roots-indices',
        match: ['square root', 'squares and square', 'cube root', 'cubes and cube', 'indices', 'index notation'],
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
            },
            (r) => {
                const base = r.pick([2, 3, 4, 5]);
                const power = r.int(2, 4);
                const ans = Math.pow(base, power);
                const distract = [base * power, ans + base, ans - power];
                return mcqFromCorrect(r, `Evaluate $${base}^{${power}}$.`, ans, distract);
            }
        ],
        sectionB: [
            (r) => {
                const side = r.int(6, 15);
                const areaShown = side * side;
                return {
                    q: `A square plot of land has an area of $${areaShown}\\text{ m}^2$.`,
                    parts: [
                        '(a) Determine the length of one side of the plot. \\hfill (2 marks)',
                        `(b) A fence is to be built around the plot. Calculate the total length of fencing wire required. \\hfill (2 marks)`
                    ],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'temperature',
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
                        '(a) Determine the difference between the highest and lowest temperature recorded. \\hfill (2 marks)',
                        '(b) Calculate the mean temperature over the five days. \\hfill (2 marks)'
                    ],
                    marks: 4
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
            },
            (r) => {
                // Percentage-error expression-selection, mirroring the
                // real paper's "which calculation gives..." format.
                const estimated = (r.int(10, 40) / 10).toFixed(1);
                const actualDelta = (r.int(1, 8) / 10).toFixed(1);
                const actual = (parseFloat(estimated) - parseFloat(actualDelta)).toFixed(1);
                const diff = actualDelta;
                const correct = `\\frac{${diff}}{${actual}} \\times 100\\%`;
                const distract = [
                    `\\frac{${diff}}{${estimated}} \\times 100\\%`,
                    `\\frac{${actual}}{${estimated}} \\times 100\\%`,
                    `\\frac{${estimated}}{${actual}} \\times 100\\%`
                ];
                const item = r.pick(['window', 'table', 'door', 'shelf']);
                return mcqFromCorrect(r, `${r.pick(['Salome', 'Kevin', 'Aisha'])} estimated the height of a ${item} to be $${estimated}\\text{ m}$. ${r.pick(['She', 'He'])} measured it and found that the actual height was $${actual}\\text{ m}$. Which of the following calculations gives the percentage error in the estimation?`, `$${correct}$`, distract.map(d => `$${d}$`));
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
                        '(a) Calculate the import duty payable. \\hfill (2 marks)',
                        '(b) Calculate the excise duty payable. \\hfill (2 marks)',
                        '(c) Calculate the Value Added Tax payable. \\hfill (1 mark)'
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
            },
            (r) => {
                // Forming an algebraic expression from a word scenario
                // (animal-farm style: total minus multiples of x), mirroring
                // the real paper's "which of the following represents" format.
                const total = r.int(20, 60);
                const multiplier = r.int(2, 4);
                const animal2 = r.pick(['goats', 'ducks', 'chickens']);
                const animal3 = r.pick(['sheep', 'cows', 'pigs'].filter(a => a !== animal2));
                const animal1 = r.pick(['donkeys', 'rabbits', 'geese']);
                const correct = `${total} - ${multiplier + 1}x`;
                const distract = [`${total} - ${multiplier}x`, `${total} - x`, `${total} + ${multiplier + 1}x`];
                return mcqFromCorrect(r, `The total number of animals in a farm is ${total}. There are $x$ ${animal1} in the farm. The number of ${animal2} is ${multiplier} times the number of ${animal1}. The remaining animals are ${animal3}. Which of the following represents the number of ${animal3} in the farm?`, `$${correct}$`, distract.map(d => `$${d}$`));
            },
            (r) => {
                // Simple inequality selection, kept here too since it's an
                // algebra sub-strand in many curriculum designs.
                const low = r.pick([15, 25, 35, 45]);
                const high = low + r.pick([10, 20, 30]);
                const combos = [['<', '<'], ['<', '\\leq'], ['\\leq', '<'], ['\\leq', '\\leq']];
                const correctCombo = r.pick(combos);
                const fmt = ([lo, hi]) => `$${low} ${lo} x ${hi} ${high}$`;
                const distractCombos = combos.filter(c => c !== correctCombo);
                return mcqFromCorrect(r, `A quantity $x$ must be at ${correctCombo[0] === '\\leq' ? 'least' : 'more than'} ${low} and ${correctCombo[1] === '\\leq' ? 'at most' : 'less than'} ${high}. Which inequality represents this?`, fmt(correctCombo), distractCombos.map(fmt));
            }
        ],
        sectionB: [
            (r) => {
                const books = r.int(3, 8), pens = r.int(2, 6), total1 = r.int(200, 600);
                const books2 = books * 2, pens2 = r.int(1, 4), total2 = r.int(300, 900);
                return {
                    q: `${r.pick(['Regina', 'Kevin', 'Amina'])} bought ${books} books and ${pens} pens for ${money(total1)}. ${r.pick(['Hamisi', 'Otieno', 'Njeri'])} bought ${books2} books and ${pens2} pens of the same type for ${money(total2)}.`,
                    parts: ['Form a pair of simultaneous equations and use them to determine the cost of one book and one pen. \\hfill (5 marks)'],
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
                        '(a) Determine the volume of the container in cubic metres. \\hfill (2 marks)',
                        `(b) Smaller cubes of side ${smallSide}\\text{ cm} were packed into the container. Determine the number of smaller cubes that were packed. \\hfill (2 marks)`
                    ],
                    marks: 4
                };
            },
            (r) => {
                const radius = (r.int(12, 24) / 10).toFixed(1);
                const ballRadius = (parseFloat(radius) - r.int(1, 3) / 10).toFixed(1);
                return {
                    q: `A cylindrical tin of radius ${radius}\\text{ cm} contains water. A spherical ball bearing of radius ${ballRadius}\\text{ cm} is fully immersed in the water.`,
                    parts: ['Determine the rise in the water level, correct to 1 decimal place. \\hfill (4 marks)'],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'geometry-pythagoras',
        match: ['pythagoras', 'pythagorean', 'right angle', 'angle', 'triangle', 'construction', 'similarity', 'enlargement'],
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
                        '(a) Calculate the length of the rod. \\hfill (2 marks)',
                        `(b) The rod has a mass of $${mass}\\text{ kg}$ and a volume of $${vol}\\text{ cm}^3$. Calculate its density in $\\text{g/cm}^3$. \\hfill (2 marks)`
                    ],
                    marks: 4
                };
            },
            (r) => {
                const ab = r.int(4, 8), ad = r.int(3, 6), angle = r.pick([30, 45, 60, 75]);
                return {
                    q: `Using a ruler and a pair of compasses only, construct a parallelogram $ABCD$ in which $AB = ${ab}\\text{ cm}$, $AD = ${ad}\\text{ cm}$ and angle $DAB = ${angle}^\\circ$.`,
                    parts: ['Drop a perpendicular from $D$ to meet $AB$ at $E$ and measure $DE$. \\hfill (5 marks)'],
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
                        '(a) Prepare a frequency distribution table for the data using suitable class intervals. \\hfill (2 marks)',
                        '(b) Determine the mean mark and the median mark. \\hfill (3 marks)'
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
                const total = r.int(4, 12), fav = r.int(1, total - 1);
                const g = gcd(fav, total);
                const ans = `${fav / g}/${total / g}`;
                const complement = `${total - fav}/${total}`;
                const distract = [complement, `${fav}/${total}`, `1/${total}`];
                return mcqFromCorrect(r, `A bag contains ${total} identical balls, ${fav} of which are red. A ball is picked at random. Find the probability that it is red.`, ans, distract);
            },
            (r) => {
                const words = ['ELEMENTAITA', 'MATHEMATICS', 'PROBABILITY', 'ASSESSMENT', 'CURRICULUM'];
                const word = r.pick(words);
                const letters = word.split('');
                const targetLetter = r.pick([...new Set(letters)]);
                const count = letters.filter(l => l === targetLetter).length;
                const total = letters.length;
                const g = gcd(count, total);
                const ans = `${count / g}/${total / g}`;
                const distract = [`1/${total}`, `${count}/${total}`, `${count + 1}/${total}`];
                return mcqFromCorrect(r, `The letters of the word ${word} were written on cards, one letter per card, and placed in a bucket. A card is picked at random. What is the probability that the letter picked is ${targetLetter}?`, ans, distract);
            }
        ],
        sectionB: [
            (r) => {
                return {
                    q: `${r.pick(['Rebecca', 'Otieno', 'Amina'])} tossed a fair coin and rolled a regular six-sided die simultaneously.`,
                    parts: [
                        '(a) Write down the probability space showing all possible outcomes. \\hfill (2 marks)',
                        `(b) Determine the probability of obtaining a head on the coin and a ${r.int(1, 6)} on the die. \\hfill (1 mark)`
                    ],
                    marks: 3
                };
            }
        ]
    },
    {
        key: 'primes-gcf-lcm',
        match: ['prime number', 'gcf', 'hcf', 'greatest common', 'lowest common', 'common factor'],
        mcq: [
            (r) => {
                const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23];
                const nonPrimes = [4, 6, 8, 9, 10, 12, 14, 15, 16];
                const chosenPrimes = r.shuffle(primes).slice(0, 2).sort((a, b) => a - b);
                const chosenNonPrimes = r.shuffle(nonPrimes).slice(0, 2);
                const cards = r.shuffle([...chosenPrimes, ...chosenNonPrimes]);
                const ans = chosenPrimes.join(' and ');
                // Enumerate all 6 possible pairs from the 4 cards and remove
                // whichever one is the correct (both-prime) pair, guaranteeing
                // the 3 distractors can never coincide with the answer.
                const allPairs = [];
                for (let i = 0; i < cards.length; i++) {
                    for (let j = i + 1; j < cards.length; j++) {
                        allPairs.push([cards[i], cards[j]].sort((a, b) => a - b).join(' and '));
                    }
                }
                const wrongPairs = r.shuffle(allPairs.filter(p => p !== ans)).slice(0, 3);
                const opts = r.shuffle([ans, ...wrongPairs]);
                return { q: `A packet contains number cards. A learner picked cards with numbers ${cards.join(', ')} from the packet. Which of the following sets has prime numbers \\textbf{only}?`,
                    a: opts[0], b: opts[1], c: opts[2], d: opts[3] };
            },
            (r) => {
                const groups = [r.pick([60, 80, 90, 120]), r.pick([40, 50, 70, 100]), r.pick([12, 18, 24, 30])];
                let g = groups[0];
                for (let i = 1; i < groups.length; i++) g = gcd(g, groups[i]);
                const distract = [g * 2, groups[0], g + 4];
                return mcqFromCorrect(r, `There are ${groups[0]} boys, ${groups[1]} girls and ${groups[2]} teachers in a school. The school formed groups with equal numbers of boys, girls and teachers. What is the largest number of groups formed?`, g, distract);
            }
        ],
        sectionB: []
    },
    {
        key: 'indices',
        match: ['indices', 'index notation', 'powers of'],
        mcq: [
            (r) => {
                const base = r.pick([2, 3, 5]);
                const known = r.int(1, 3);
                const total = r.int(known + 1, known + 4);
                // base^x * base^known = base^total  =>  x = total - known
                const x = total - known;
                const rhs = Math.pow(base, total);
                const distract = [x * 2, x + known, Math.max(1, x - known)];
                return mcqFromCorrect(r, `A flash card contains the question $${base}^x \\times ${base}^{${known}} = ${rhs}$. What is the value of $x$ in the equation?`, x, distract);
            }
        ],
        sectionB: []
    },
    {
        key: 'matrices',
        match: ['matrix', 'matrices'],
        mcq: [
            (r) => {
                const rows = r.int(2, 4), cols = r.int(3, 6);
                const distract = [`${cols} \\times ${rows}`, `${rows + cols} \\times 1`, `1 \\times ${rows * cols}`];
                return mcqFromCorrect(r, `A matrix has ${rows} rows and ${cols} columns. What is the order of the matrix?`, `${rows} \\times ${cols}`, distract);
            }
        ],
        sectionB: [
            (r) => {
                const items = ['Oranges', 'Mangoes', 'Bananas'];
                const famA1 = [r.int(4, 10), r.int(8, 20), r.int(2, 8)];
                const famB1 = [r.int(4, 10), r.int(8, 20), r.int(2, 8)];
                const famA2 = [r.int(4, 10), r.int(8, 20), r.int(2, 8)];
                const famB2 = [r.int(4, 10), r.int(8, 20), r.int(2, 8)];
                return {
                    q: `Two families, A and B, bought oranges, mangoes and bananas over two weeks. Week 1 — Family A: ${famA1.join(', ')}; Family B: ${famB1.join(', ')}. Week 2 — Family A: ${famA2.join(', ')}; Family B: ${famB2.join(', ')} (in that order: ${items.join(', ')}).`,
                    parts: [
                        '(a) Form matrices to represent the information for Week 1 and Week 2. \\hfill (2 marks)',
                        '(b) Determine the total number of fruits of each type bought by each family over the two weeks. \\hfill (2 marks)'
                    ],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'quadrilaterals',
        match: ['quadrilateral', 'polygon', 'parallelogram propert', 'rhombus', 'trapezium'],
        mcq: [
            (r) => {
                const shapes = [
                    { name: 'Rhombus', props: ['All sides are equal', 'Diagonals bisect at $90^\\circ$', 'Opposite angles are equal'] },
                    { name: 'Rectangle', props: ['Opposite sides are equal and parallel', 'All angles are $90^\\circ$', 'Diagonals are equal'] },
                    { name: 'Parallelogram', props: ['Opposite sides are equal and parallel', 'Opposite angles are equal', 'Diagonals bisect each other'] },
                    { name: 'Trapezium', props: ['One pair of opposite sides is parallel', 'The parallel sides are of different lengths'] },
                    { name: 'Square', props: ['All sides are equal', 'All angles are $90^\\circ$', 'Diagonals bisect at $90^\\circ$'] }
                ];
                const shape = r.pick(shapes);
                const others = r.shuffle(shapes.filter(s => s.name !== shape.name)).slice(0, 3);
                const opts = r.shuffle([shape.name, others[0].name, others[1].name, others[2].name]);
                return { q: `The following are properties of a quadrilateral:\\newline ${shape.props.map((p, i) => `(${['i', 'ii', 'iii'][i]}) ${p}`).join('\\newline ')}\\newline What is the name of the quadrilateral?`,
                    a: opts[0], b: opts[1], c: opts[2], d: opts[3] };
            }
        ],
        sectionB: []
    },
    {
        key: 'circles-arcs',
        match: ['circle', 'arc', 'sector', 'chord', 'circumference'],
        mcq: [
            (r) => {
                const radius = (r.int(50, 150) / 100).toFixed(2);
                const angle = r.pick([36, 45, 60, 72, 90, 120]);
                const arcLength = (2 * Math.PI * parseFloat(radius) * (angle / 360));
                const distract = [(arcLength * 2), (arcLength / 2), (2 * Math.PI * parseFloat(radius))];
                return mcqFromCorrect(r, `The width of a door is $${radius}\\text{ m}$. The door is opened through an angle of $${angle}^\\circ$. What is the length which the tip of the door sweeps through?`, arcLength.toFixed(2), distract.map(v => v.toFixed(2)));
            }
        ],
        sectionB: []
    },
    {
        key: 'scale-drawing',
        match: ['scale drawing', 'map scale', 'architectural drawing', 'representative fraction'],
        mcq: [
            (r) => {
                const scaleDenom = r.pick([50, 100, 200, 500]);
                const actualM = r.pick([2, 3, 4, 5, 10]);
                const drawingCm = (actualM * 100) / scaleDenom;
                const distract = [drawingCm * 10, drawingCm / 10, actualM];
                return mcqFromCorrect(r, `The scale on an architectural drawing was 1:${scaleDenom}. A wall constructed using the drawing was ${actualM}\\text{ m} long. What was the length of the wall on the drawing?`, `${drawingCm} cm`, distract.map(v => `${v} cm`));
            }
        ],
        sectionB: []
    },
    {
        key: 'coordinate-geometry',
        match: ['gradient', 'equation of a line', 'straight line', 'coordinate geometry', 'linear graph'],
        mcq: [
            (r) => {
                const m = r.pick([1, 2, 3, 4, -1, -2, -3, -4]);
                // Perpendicular gradient is -1/m; format as a clean fraction
                // (matching the real paper's style) rather than a decimal.
                const fmtRecip = (val) => {
                    // val is -1/m in lowest terms already since m is an integer
                    if (val === 1 || val === -1) return String(val);
                    const sign = val < 0 ? '-' : '';
                    return `${sign}1/${Math.abs(m)}`;
                };
                const correctGrad = -1 / m;
                const correctStr = fmtRecip(correctGrad);
                const distract = [String(m), String(-m), fmtRecip(1 / m)];
                return mcqFromCorrect(r, `A line $L_1$ has a gradient of ${m}. A line $L_2$ is perpendicular to $L_1$. What is the gradient of $L_2$?`, correctStr, distract);
            }
        ],
        sectionB: [
            (r) => {
                const px = r.int(-4, 6), py = r.int(-4, 8);
                const m = r.pick([1, 2, 3, -1, -2, 0.5]);
                return {
                    q: `A line passes through the point $(${px}, ${py})$ with a gradient of $${m}$.`,
                    parts: [
                        '(a) Determine the equation of the line. \\hfill (2 marks)',
                        '(b) Determine the coordinates of the $x$-intercept of the line. \\hfill (2 marks)'
                    ],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'enlargement-similarity',
        match: ['enlargement', 'scale factor', 'similarity'],
        mcq: [
            (r) => {
                const original = r.int(5, 20);
                const factor = r.pick([2, 3, 0.5]);
                const ans = original * factor;
                const distract = [original + factor, original / factor, original * (factor + 1)];
                return mcqFromCorrect(r, `A photograph was enlarged by a scale factor of ${factor}. The original photograph had a length of $${original}\\text{ cm}$. What was the new length of the photograph?`, ans, distract);
            }
        ],
        sectionB: []
    },
    {
        key: 'cones-cylinders-nets',
        match: ['cone', 'net of a solid', 'surface area of a solid', 'total surface area'],
        mcq: [],
        sectionB: [
            (r) => {
                const slant = r.int(10, 25), radius = (r.int(30, 60) / 10).toFixed(1);
                return {
                    q: `A learner moulded a solid in the shape of a cone. The slant height of the cone was ${slant}\\text{ cm}$. The base radius of the cone was ${radius}\\text{ cm}$.`,
                    parts: ['Calculate the total surface area of the solid, correct to 2 decimal places. \\hfill (5 marks)'],
                    marks: 5
                };
            },
            (r) => {
                const l = r.int(3, 8), w = r.int(2, 6), h = r.int(2, 5);
                return {
                    q: `A cuboid has dimensions $${l}\\text{ cm}$ by $${w}\\text{ cm}$ by $${h}\\text{ cm}$.`,
                    parts: [
                        '(a) Draw the net of the cuboid. \\hfill (2 marks)',
                        '(b) Calculate the total surface area of the cuboid from the net. \\hfill (3 marks)'
                    ],
                    marks: 5
                };
            }
        ]
    },
    {
        key: 'longitude-time',
        match: ['longitude', 'latitude', 'local time', 'great circle'],
        mcq: [],
        sectionB: [
            (r) => {
                const lonP = r.int(20, 80), lonQ = r.int(20, 80);
                const hour = r.int(1, 11), minute = r.pick([0, 15, 30, 45]);
                const ampm = r.pick(['a.m.', 'p.m.']);
                return {
                    q: `A town P lies on longitude ${lonP}$^\\circ$W. A town Q lies on longitude ${lonQ}$^\\circ$E. The local time at town Q is ${hour}.${minute.toString().padStart(2, '0')} ${ampm}.`,
                    parts: ['Determine the local time at town P. \\hfill (4 marks)'],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'elevation-depression',
        match: ['angle of elevation', 'angle of depression', 'bearing and distance'],
        mcq: [],
        sectionB: [
            (r) => {
                const distance = r.int(20, 80), angle = r.pick([25, 30, 35, 40, 45]);
                return {
                    q: `${r.pick(['Daudi', 'Wanjiru', 'Kiptoo'])} was standing on a balcony and observed an object on the ground, $${distance}\\text{ m}$ from the foot of the building. The angle of depression of the object from that position was $${angle}^\\circ$.`,
                    parts: ['Calculate the height from the ground to where the observer was standing. \\hfill (2 marks)'],
                    marks: 2
                };
            }
        ]
    },
    {
        key: 'bearings',
        match: ['bearing', 'compass direction'],
        mcq: [],
        sectionB: [
            (r) => {
                const d1 = r.int(30, 80), b1 = r.pick([30, 60, 120, 150, 210, 240]);
                const d2 = r.int(30, 80), b2 = r.pick([30, 60, 120, 150, 210, 240]);
                return {
                    q: `A learner marked three points A, B and C on a playing field. From point A she walked ${d1}\\text{ m}$ on a bearing of ${b1}^\\circ$ to reach point B. From point B she walked ${d2}\\text{ m}$ on a bearing of ${b2}^\\circ$ to reach point C.`,
                    parts: [
                        `(a) Using a scale of 1 cm to represent 10 m, show the relative positions of points A, B and C. \\hfill (3 marks)`,
                        '(b)(i) Determine the distance from A to C. \\hfill (1 mark)',
                        '(b)(ii) Determine the bearing of C from A. \\hfill (1 mark)'
                    ],
                    marks: 5
                };
            }
        ]
    },
    {
        key: 'work-rate',
        match: ['rate of work', 'work and time', 'inverse proportion'],
        mcq: [],
        sectionB: [
            (r) => {
                const men1 = r.int(3, 8), hours1 = r.int(4, 8), days1 = r.int(8, 15);
                const men2 = r.int(2, men1 - 1 || 2);
                const hours2 = r.int(5, 10);
                return {
                    q: `A factory employed ${men1} people working ${hours1} hours per day to complete a task in ${days1} days. Determine how many more days ${men2} people working ${hours2} hours per day will take to complete the same task.`,
                    parts: [],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'decimal-fraction-conversion',
        match: ['recurring decimal', 'decimal to fraction', 'fraction to decimal'],
        mcq: [],
        sectionB: [
            (r) => {
                const decimal = (r.int(5, 95) / 100).toFixed(2);
                return {
                    q: `A quantity was expressed as a fraction of a total and written in decimal form as ${decimal}.`,
                    parts: ['Express the decimal in fraction form, in its simplest form. \\hfill (4 marks)'],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'inequalities',
        match: ['inequalit'],
        mcq: [
            (r) => {
                const low = r.pick([10, 20, 30, 40, 50]);
                const high = low + r.pick([15, 20, 25, 30]);
                const lowInclusive = r.pick([true, false]);
                const highInclusive = r.pick([true, false]);
                const context = r.pick([
                    { subject: 'a school planning to transport', unit: 'learners', verb: 'transport' },
                    { subject: 'a bus company planning to carry', unit: 'passengers', verb: 'carry' },
                    { subject: 'a hall that can seat', unit: 'guests', verb: 'seat' }
                ]);
                const lowWord = lowInclusive ? 'at least' : 'more than';
                const highWord = highInclusive ? 'at most' : 'less than';
                // Only 4 possible symbol combinations exist (</<=  for each
                // side) — enumerate all 4 so the 3 distractors are exactly
                // the "other" combos and can never collide with the correct one.
                const combos = [['<', '<'], ['<', '\\leq'], ['\\leq', '<'], ['\\leq', '\\leq']];
                const fmt = ([lo, hi]) => `$${low} ${lo} x ${hi} ${high}$`;
                const correctCombo = [lowInclusive ? '\\leq' : '<', highInclusive ? '\\leq' : '<'];
                const distractCombos = combos.filter(c => !(c[0] === correctCombo[0] && c[1] === correctCombo[1]));
                return mcqFromCorrect(r, `${context.subject[0].toUpperCase()}${context.subject.slice(1)} $x$ number of ${context.unit}. For cost efficiency, they must ${context.verb} ${lowWord} ${low} but ${highWord} ${high} ${context.unit}. Which of the following inequalities represents this information?`, fmt(correctCombo), distractCombos.map(fmt));
            }
        ],
        sectionB: []
    }
];

function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; }
function gcf3(a, b, c) { return gcd(gcd(a, b), c); }

// ---------------------------------------------------------------------
// 3b. SUBJECT CONFIG — paper structure differs by subject (KJSEA doesn't
//     give every subject a 20-mark MCQ + 80-mark structured layout the
//     way Mathematics gets). Falls back to a sane generic shape for any
//     subject in the database that isn't explicitly configured yet, so
//     nothing errors out — it just won't have a bespoke topic bank until
//     one is added below.
// ---------------------------------------------------------------------
const SUBJECT_CONFIG = {
    'mathematics': { time: '2 hours', sectionAMarks: 20, sectionACount: 20, sectionBMarks: 80, sectionBCount: 10, hasMcqSection: true },
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

// Formats a raw numeric value for display: rounds to at most 2 decimal
// places so floating-point artifacts (e.g. 7.300000000000001) never reach
// a printed exam. Non-numeric values (fractions like "3/4", words) pass
// through unchanged.
function formatVal(v) {
    if (typeof v === 'number') {
        if (Number.isInteger(v)) return String(v);
        const rounded = Math.round(v * 100) / 100;
        return String(rounded);
    }
    return String(v);
}

// Nudges a distractor that collides with an already-used option so every
// MCQ ends up with four genuinely distinct answers. Numeric strings are
// bumped by a small increment; "a/b" fraction strings bump the numerator;
// anything else gets a small distinguishing suffix as a last resort.
function makeDistinct(value, usedSet, bumpSeed) {
    let candidate = value;
    let attempts = 0;
    while (usedSet.has(candidate) && attempts < 8) {
        attempts++;
        const asNum = Number(candidate);
        if (!Number.isNaN(asNum) && /^-?\d+(\.\d+)?$/.test(candidate)) {
            const bumped = Number.isInteger(asNum) ? asNum + attempts : Math.round((asNum + attempts * 0.5) * 100) / 100;
            candidate = String(bumped);
            continue;
        }
        const fracMatch = candidate.match(/^(-?\d+)\/(-?\d+)$/);
        if (fracMatch) {
            candidate = `${Number(fracMatch[1]) + attempts}/${fracMatch[2]}`;
            continue;
        }
        // Last resort for non-numeric, non-fraction strings (e.g. symbolic
        // expressions): make the collision visibly distinct rather than
        // invisibly different, since an invisible nudge would ship two
        // options that look identical to the candidate reading the paper.
        candidate = `${value}`.trim() + ` (${'i'.repeat(attempts)})`;
    }
    return candidate;
}

// Builds an MCQ object from a correct answer plus distractors, shuffling
// option order with the paper's own RNG so the correct letter varies.
// Guarantees all four displayed options are distinct — duplicate options
// (e.g. two "16"s) make a question unanswerable and must never ship.
function mcqFromCorrect(r, q, correct, distractors) {
    const correctStr = formatVal(correct);
    const used = new Set([correctStr]);
    const distractStrs = distractors.map(formatVal).map(d => {
        const distinct = makeDistinct(d, used, 1);
        used.add(distinct);
        return distinct;
    });
    const options = r.shuffle([correctStr, ...distractStrs]);
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
                '(a) Explain the concept, giving one worked example. \\hfill (2 marks)',
                '(b) Apply the concept to solve a related problem of your own. \\hfill (3 marks)'
            ],
            marks: 5
        };
    }
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
        if (!item) continue; // template declined (e.g. couldn't form a valid question this draw)
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
async function buildSectionA(records, rng, ctx, usedSignatures, count = 20) {
    const items = [];
    // Weight the pool toward the target grade's own rows, but keep
    // carried-forward rows from lower grades available too.
    const targetRows = records.filter(r => r.sourceGrade === ctx.gradeClean);
    const otherRows = records.filter(r => r.sourceGrade !== ctx.gradeClean);
    const weightedPool = rng.shuffle([...targetRows, ...targetRows, ...otherRows]);

    let cursor = 0;
    let guard = 0;
    // Circuit breaker: if the AI model fails 5 times in a row (misconfigured
    // endpoint, model that can't follow the JSON schema, etc.), stop paying
    // the retry cost on every remaining row and fall back to templates for
    // the rest of this paper — a real self-hosted model can take 10-30s per
    // call, so a silent failure mode must not turn into a multi-minute hang.
    let consecutiveAiFailures = 0;
    const AI_FAILURE_CIRCUIT_BREAKER = 5;

    while (items.length < count && guard < count * 15) {
        guard++;
        const row = weightedPool.length ? weightedPool[cursor % weightedPool.length] : null;
        cursor++;
        let item = null;

        // AI-first: attempt a genuinely reasoned question from the
        // self-hosted model before falling back to templates. Every AI
        // question has already been arithmetic-verified by this point —
        // see aiQuestionGenerator.js. We still run it through the same
        // signature-dedup as templates so it can't repeat across a batch.
        if (ctx.ai && ctx.ai.enabled && row && consecutiveAiFailures < AI_FAILURE_CIRCUIT_BREAKER) {
            const aiResult = await generateVerifiedMcq({
                endpoint: ctx.ai.endpoint, model: ctx.ai.model,
                gradeClean: ctx.gradeClean, subject: ctx.subject, row
            });
            if (aiResult) {
                consecutiveAiFailures = 0;
                const mcq = mcqFromCorrect(rng, aiResult.q, aiResult.correctAnswer, aiResult.distractors);
                mcq.source = 'ai';
                const sig = signatureOf(mcq);
                if (!usedSignatures.has(sig)) {
                    usedSignatures.add(sig);
                    item = mcq;
                }
            } else {
                consecutiveAiFailures++;
            }
        }

        if (!item) {
            const topic = row ? findTopic(row) : null;
            if (topic && topic.mcq && topic.mcq.length) {
                item = generateUniqueFrom(topic.mcq, [ctx], rng, usedSignatures);
            }
            if (!item && row) {
                item = generateUniqueFrom(FALLBACK_MCQ_TEMPLATES, [row, ctx], rng, usedSignatures);
            }
        }
        if (item) items.push(item);
    }
    return items;
}

async function buildSectionB(records, rng, ctx, usedSignatures, count = 10) {
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
    const rowPool = rng.shuffle(rowsInScope.length ? rowsInScope : []);

    let cursor = 0;
    let untopickedCursor = 0;
    let rowCursor = 0;
    let guard = 0;
    let consecutiveAiFailures = 0;
    const AI_FAILURE_CIRCUIT_BREAKER = 5;
    const perQuestionMarks = Math.max(3, Math.round((ctx.subjectConfig?.sectionBMarks || 80) / count));

    while (items.length < count && guard < count * 15) {
        guard++;
        let item = null;
        const aiAvailable = ctx.ai && ctx.ai.enabled && rowPool.length && consecutiveAiFailures < AI_FAILURE_CIRCUIT_BREAKER;

        if (aiAvailable) {
            const row = rowPool[rowCursor % rowPool.length];
            rowCursor++;
            const aiResult = await generateVerifiedSectionB({
                endpoint: ctx.ai.endpoint, model: ctx.ai.model,
                gradeClean: ctx.gradeClean, subject: ctx.subject, row, marks: perQuestionMarks
            });
            if (aiResult) {
                consecutiveAiFailures = 0;
                const sig = signatureOf(aiResult);
                if (!usedSignatures.has(sig)) {
                    usedSignatures.add(sig);
                    item = aiResult;
                }
            } else {
                consecutiveAiFailures++;
            }
        }

        if (!item) {
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
        }

        if (!item) {
            // Nothing left to try (bespoke topics exhausted, no untopicked rows) — stop rather than repeat.
            if (!availableTopics.length && !untopicked.length && !aiAvailable) break;
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
    tex += `\\usepackage{amsmath,amssymb,tikz,graphicx,multicol,longtable,array}\n`;
    tex += `\\usepackage{geometry}\n`;
    tex += `\\usepackage{eso-pic}\n`;
    tex += `\\usepackage{transparent}\n`;
    tex += `\\usepackage{fancyhdr}\n`;
    tex += `\\geometry{top=20mm, bottom=20mm, left=15mm, right=15mm}\n\n`;
    tex += `\\AddToShipoutPictureBG{\n  \\AtPageCenter{\\put(0,0){\\makebox(0,0){\\transparent{0.08}\\includegraphics[width=9cm]{logo.png}\\transparent{1}}}}\n}\n\n`;
    tex += `\\begin{document}\n\n`;

    const standardName = trackFor(ctx.gradeClean) === 'KPSEA'
        ? 'KENYA PRIMARY SCHOOL EDUCATION ASSESSMENT'
        : 'KENYA JUNIOR SCHOOL EDUCATION ASSESSMENT';
    tex += `\\begin{titlepage}\n\\centering\n`;
    tex += `\\begin{minipage}{0.18\\textwidth}\\centering\\includegraphics[width=2.2cm]{logo.png}\\end{minipage}\n`;
    tex += `\\begin{minipage}{0.6\\textwidth}\\centering\n`;
    tex += `{\\large \\textbf{REPUBLIC OF KENYA}} \\\\[0.3em]\n`;
    tex += `{\\normalsize \\textbf{MINISTRY OF EDUCATION}} \\\\[0.2em]\n`;
    tex += `{\\large \\textbf{${standardName}, ${new Date().getFullYear()}}} \\\\[0.3em]\n`;
    tex += `{\\normalsize \\textit{Elevate Kenya Predictions — ${ctx.gradeClean.toUpperCase()}}}\n\\end{minipage}\n`;
    tex += `\\begin{minipage}{0.18\\textwidth}\\centering\\includegraphics[width=2.2cm]{logo.png}\\end{minipage}\n`;
    tex += `\\vspace{1cm}\\hrule\\vspace{0.5cm}\n`;
    tex += `{\\Large \\textbf{${ctx.subject.toUpperCase()}}}\\\\[0.4em]\n`;
    tex += `{\\large \\textbf{Paper 1}}\\\\[0.4em]\n`;
    tex += `{\\normalsize \\textbf{TIME: ${ctx.subjectConfig.time.toUpperCase()}}}\\\\[0.5cm]\\hrule\\vspace{1cm}\n`;
    tex += `\\begin{flushleft}\n`;
    tex += `\\textbf{Name:} \\rule{9.5cm}{0.4pt} \\hfill \\textbf{Adm. No.:} \\rule{3cm}{0.4pt} \\\\[0.9cm]\n`;
    tex += `\\textbf{School:} \\rule{10.5cm}{0.4pt} \\\\[0.9cm]\n`;
    tex += `\\textbf{Candidate's Signature:} \\rule{6.5cm}{0.4pt} \\hfill \\textbf{Date:} \\rule{4cm}{0.4pt} \\\\[1cm]\n`;
    tex += `\\end{flushleft}\n`;
    tex += `\\noindent \\textbf{Instructions to Candidates}\n\\begin{enumerate}\n`;
    tex += `    \\item Write your name and admission number in the spaces provided above.\n`;
    tex += `    \\item Sign and write the date of examination in the spaces provided above.\n`;
    tex += `    \\item This paper consists of two sections: Section A and Section B.\n`;
    tex += `    \\item Answer \\textbf{all} the questions in both sections in the spaces provided.\n`;
    tex += `    \\item All working must be clearly shown in the spaces provided.\n`;
    tex += `    \\item Non-programmable calculators and KNEC mathematical tables may be used, except where stated otherwise.\n`;
    tex += `    \\item This paper consists of printed pages. Candidates should check to ascertain that all pages are printed and that no questions are missing.\n`;
    tex += `\\end{enumerate}\n\\vspace{0.6cm}\n`;
    tex += `\\noindent \\textbf{For Examiner's Use Only}\\\\[0.3em]\n`;
    tex += `\\begin{tabular}{|c|c|c|}\n\\hline\n`;
    tex += `\\textbf{Section} & \\textbf{Maximum Score} & \\textbf{Candidate's Score} \\\\\n\\hline\n`;
    tex += `A & ${ctx.subjectConfig.sectionAMarks} & \\\\\n\\hline\n`;
    tex += `B & ${ctx.subjectConfig.sectionBMarks} & \\\\\n\\hline\n`;
    tex += `\\textbf{Total} & \\textbf{${ctx.subjectConfig.sectionAMarks + ctx.subjectConfig.sectionBMarks}} & \\\\\n\\hline\n`;
    tex += `\\end{tabular}\n`;
    tex += `\\vfill\n{\\footnotesize This paper is set independently by Elevate Kenya Predictions and is not an official KNEC paper.}\\\\\n`;
    tex += `{\\small \\textbf{PUBLISHED AND PRODUCED BY ELEVATE KENYA PREDICTIONS}}\n\\end{titlepage}\n\n`;

    // Running footer on every content page (not the cover), matching the
    // real paper's style of a centered exam label with a page number.
    tex += `\\pagestyle{fancy}\n\\fancyhf{}\n`;
    tex += `\\fancyfoot[C]{\\footnotesize ${standardName}, Mock (Elevate Kenya Predictions) \\quad -- \\thepage --}\n`;
    tex += `\\renewcommand{\\headrulewidth}{0pt}\n\\renewcommand{\\footrulewidth}{0.4pt}\n\n`;
    if (ctx.subjectConfig.hasMcqSection && mcqs.length) {
        tex += `\\newpage\n\\noindent \\textbf{\\large SECTION A (${ctx.subjectConfig.sectionAMarks} marks)}\\\\[0.2em]\n`;
        tex += `\\noindent \\textit{Answer all the questions in this section on the answer sheet provided.}\n\\hrule\\vspace{1em}\n\n`;
        // Question column | Working Space column, with a real vertical rule
        // between them and the "Working Space" header repeating on every
        // page automatically, matching the real KJSEA layout.
        tex += `{\\renewcommand{\\arraystretch}{1.3}\n`;
        tex += `\\begin{longtable}{@{}p{0.62\\textwidth} @{}|@{} p{0.30\\textwidth}@{}}\n`;
        tex += `\\textbf{} & \\textbf{Working Space} \\\\\n\\hline\n`;
        tex += `\\endfirsthead\n`;
        tex += `\\multicolumn{2}{l}{\\textit{(continued)}} \\\\\n & \\textbf{Working Space} \\\\\n\\hline\n\\endhead\n`;
        mcqs.forEach((item, i) => {
            const optionLines = [`A.\\ ${item.a}`, `B.\\ ${item.b}`, `C.\\ ${item.c}`, `D.\\ ${item.d}`].join('\\newline ');
            tex += `${i + 1}.\\ ${item.q}\\newline ${optionLines} & \\\\\n\\hline\n`;
        });
        tex += `\\end{longtable}}\n\n`;
    }

    tex += `\\newpage\n`;
    tex += `\\noindent \\textbf{\\large SECTION B (${ctx.subjectConfig.sectionBMarks} marks)}\\\\[0.2em]\n`;
    tex += `\\noindent \\textit{Answer all the questions in the spaces provided.}\n\\hrule\\vspace{1em}\n\n`;
    tex += `\\begin{enumerate}\n`;
    sectionB.forEach(item => {
        tex += `    \\item ${item.q}\\\\[0.3em]\n`;
        (item.parts || []).forEach(p => { tex += `    ${p}\\\\[0.2em]\n`; });
        tex += `    \\vspace{4cm}\n    \\hfill{\\textit{\\tiny Working Space}}\\hrule\n    \\vspace{1em}\n`;
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
 *
 * `ai`: optional { enabled, endpoint, model } pointing at YOUR OWN
 * self-hosted Ollama-compatible server (e.g. http://localhost:11434,
 * or your VPS's private address). When omitted or enabled=false, this
 * behaves exactly as the pure-template system did — fully backward
 * compatible with no AI dependency at all.
 */
async function generatePaper(supabase, { rawGrade, subject, assessmentType, seed, usedSignatures, ai }) {
    const gradeClean = normalizeGradeLabel(rawGrade);
    const records = await fetchCurriculumForGrade(supabase, gradeClean, subject);
    const rng = makeRng(seed);
    const subjectConfig = configFor(subject);
    const ctx = { gradeClean, subject, assessmentType, subjectConfig, ai };

    const sig = usedSignatures || new Set();
    const mcqs = subjectConfig.hasMcqSection
        ? await buildSectionA(records, rng, ctx, sig, subjectConfig.sectionACount)
        : [];
    const sectionB = await buildSectionB(records, rng, ctx, sig, subjectConfig.sectionBCount);
    const latex = buildLatex(ctx, mcqs, sectionB);
    const aiSourcedCount = mcqs.filter(m => m.source === 'ai').length + sectionB.filter(s => s.source === 'ai').length;
    return { latex, gradeClean, mcqCount: mcqs.length, sectionBCount: sectionB.length, aiSourcedCount };
}

/**
 * Generate up to `count` distinct papers for the same grade/subject/
 * blueprint, sharing one de-duplication set so none of them repeat a
 * question. Papers may come back with fewer questions than requested if
 * the curriculum pool + topic bank genuinely runs out of fresh variants
 * (guarded rather than silently repeating).
 */
async function generateBatch(supabase, { rawGrade, subject, assessmentType, count = 20, ai }) {
    const usedSignatures = new Set();
    const papers = [];
    for (let i = 0; i < count; i++) {
        const seed = Date.now() % 100000 + i * 7919; // distinct seed per paper
        const paper = await generatePaper(supabase, {
            rawGrade, subject, assessmentType, seed, usedSignatures, ai
        });
        papers.push({ index: i + 1, ...paper });
    }
    return papers;
}

export { generatePaper, generateBatch, normalizeGradeLabel, allowedGradesFor, checkCurriculumCoverage };
