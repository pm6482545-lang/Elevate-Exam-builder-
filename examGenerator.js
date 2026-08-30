// examGenerator.js
// Pure rule-based (no AI API) KJSEA-style Mathematics paper generator.
//
// THIS VERSION — CHANGE LOG (read this before touching TOPICS below)
// --------------------------------------------------------------------
// Scope for this pass: JUNIOR SCHOOL (Grade 7/8/9) MATHEMATICS ONLY.
// KPSEA (Grade 4-6) support is left in place structurally (grade-track
// map, boundary logic) but is NOT populated with topics yet — that is
// the next phase, after Junior School Math + English are done. Do not
// add KPSEA topics here; add them in the primary-school pass instead.
//
// 1. COVER PAGE
//    - Was bleeding a full-opacity logo across the ENTIRE document
//      (every page), and the "background" image was legible enough to
//      visually compete with the title-page text. Fixed by:
//        a) scoping the watermark to the title page ONLY, using a
//           tikz `overlay` node placed inside \begin{titlepage} instead
//           of a document-wide eso-pic ShipoutPictureBG hook.
//        b) setting opacity ~0.05 so it never competes with text again,
//           regardless of stacking order.
//    - Tightened vertical spacing so the cover page reliably fits one
//      physical page, and reworded the instructions block to match the
//      register of a real KNEC/KICD assessment cover.
//
// 2. DIAGRAMS
//    - Added a small TikZ diagram library (see DIAGRAMS below) so
//      generated questions that need a figure (right triangles, cones,
//      cylinders with a submerged sphere, nets of cuboids, blank
//      Cartesian grids for graph-plotting questions) actually render a
//      figure, the way the real KJSEA paper does, instead of describing
//      a shape in prose only.
//
// 3. QUESTION DEPTH / CURRICULUM FIDELITY
//    - The old TOPICS bank was too shallow relative to the real paper
//      (single-step arithmetic dressed up in a sentence). Existing
//      topics were rewritten to be multi-step and contextual, and new
//      topics were added to cover sub-strands the real paper draws on
//      that the old bank had no coverage for at all: matrices,
//      inverse-proportion/work-rate, longitude & time, bearings +
//      scale drawing, angle of elevation/depression, cone & frustum
//      surface area, sector/arc length, percentage error, enlargement,
//      quadrilateral properties, linear graphs/equation-of-a-line,
//      inequalities, and the Kelvin/Celsius conversion.
//    - Every topic still carries a minGrade tag and is still filtered
//      through allowedGradesFor() exactly as before — nothing here
//      relaxes the "Grade 7 paper never sees Grade 8/9-only content"
//      guarantee; it only makes what Grade 7 (etc.) IS allowed to see
//      richer and better-shaped.
//    - Fixed Section B question count for Mathematics: the real KJSEA
//      paper runs questions 21-40 in Section B (20 short-structured
//      items worth ~3-5 marks each, total 80), not 10 longer ones.
//      SUBJECT_CONFIG.mathematics.sectionBCount is now 20 to match.
// --------------------------------------------------------------------

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
//
//    NOTE: KPSEA is structurally present but intentionally has no
//    TOPICS entries yet (see change log above) — this phase is
//    Junior School Mathematics only.
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
        const candidateKeys = ['description', 'text', 'summary', 'details', 'content', 'value'];
        for (const key of candidateKeys) {
            if (typeof content[key] === 'string' && content[key].trim()) return content[key];
        }
        if (Array.isArray(content)) {
            const strs = content.filter(v => typeof v === 'string');
            if (strs.length) return strs.join('; ');
        }
        return '';
    }
    return String(content);
}

// ---------------------------------------------------------------------
// 2b. TIKZ DIAGRAM LIBRARY
//     Small, dependency-free (amsmath/tikz only, already imported)
//     helpers that produce a centred figure block. Every function
//     returns a ready-to-splice LaTeX string. Question templates attach
//     one of these to their returned object under `diagram`, and
//     buildLatex() renders it directly under the question text — this
//     is what makes generated papers actually show a figure instead of
//     describing one in prose, matching the real KJSEA paper's style.
// ---------------------------------------------------------------------
function tikzBlock(body, opts = '') {
    return `\n\\begin{center}\n\\begin{tikzpicture}[${opts}]\n${body}\n\\end{tikzpicture}\n\\end{center}\n`;
}

const DIAGRAMS = {
    // A right-angled triangle with the two legs labelled and a small
    // square marking the right angle. Used for Pythagoras / rod-against-
    // wall / angle-of-elevation style questions.
    rightTriangle(legA, legB, { rightAngleAt = 'A', hypotenuseLabel = null, angleLabel = null } = {}) {
        const bx = Math.min(6, Math.max(3, legA / 2));
        const by = Math.min(6, Math.max(3, legB / 2));
        const hyp = hypotenuseLabel ? `\\node[above right] at (${bx / 2},${by / 2}) {${hypotenuseLabel}};` : '';
        const ang = angleLabel ? `\\node[above right=1pt] at (${bx},0) {${angleLabel}};` : '';
        return tikzBlock(`
  \\coordinate (A) at (0,0);
  \\coordinate (B) at (${bx},0);
  \\coordinate (C) at (0,${by});
  \\draw[thick] (A) -- (B) -- (C) -- cycle;
  \\draw (0,0.28) -- (0.28,0.28) -- (0.28,0);
  \\node[below] at (${bx / 2},-0.15) {${legA}};
  \\node[left] at (-0.15,${by / 2}) {${legB}};
  ${hyp}
  ${ang}
`, 'scale=0.7, line cap=round');
    },

    // A cone: outline only, with slant height and base diameter labelled.
    cone(radius, slant) {
        const rx = Math.min(3, Math.max(1.2, radius / 2));
        const ry = rx * 0.32;
        const h = Math.min(5, Math.max(2.5, slant / 3));
        return tikzBlock(`
  \\draw[thick] (-${rx},0) arc (180:360:${rx} and ${ry});
  \\draw[thick, dashed] (-${rx},0) arc (180:0:${rx} and ${ry});
  \\draw[thick] (-${rx},0) -- (0,${h});
  \\draw[thick] (${rx},0) -- (0,${h});
  \\draw[<->] (-${rx},-0.6) -- (${rx},-0.6);
  \\node[below] at (0,-0.6) {diameter};
  \\node[left] at (${-rx / 2 - 0.15},${h / 2 + 0.1}) {slant height = ${slant} cm};
`, 'scale=0.8');
    },

    // A cylinder (tin) partly filled with water, with a circle
    // representing a fully-submerged sphere inside it.
    cylinderWithSphere(tinRadius, ballRadius) {
        const rx = Math.min(2.4, Math.max(1, tinRadius / 1.2));
        const ry = rx * 0.28;
        const height = 4.2;
        const waterH = 2.4;
        const br = Math.min(1, Math.max(0.35, ballRadius / 1.5));
        return tikzBlock(`
  \\draw[thick] (-${rx},0) -- (-${rx},${height});
  \\draw[thick] (${rx},0) -- (${rx},${height});
  \\draw[thick] (-${rx},${height}) arc (180:360:${rx} and ${ry});
  \\draw[thick, dashed] (-${rx},${height}) arc (180:0:${rx} and ${ry});
  \\draw[thick] (-${rx},0) arc (180:360:${rx} and ${ry});
  \\draw[thick, dashed] (-${rx},0) arc (180:0:${rx} and ${ry});
  \\fill[gray!15] (-${rx},0) rectangle (${rx},${waterH});
  \\draw[thick] (-${rx},${waterH}) -- (${rx},${waterH});
  \\draw[thick, fill=gray!35] (0,${waterH / 2}) circle (${br});
  \\node[right] at (${rx + 0.2},${waterH / 2}) {ball, r = ${ballRadius} cm};
  \\node[right] at (${rx + 0.2},${height - 0.3}) {tin, r = ${tinRadius} cm};
`, 'scale=0.75');
    },

    // Net of a cuboid: six labelled rectangles laid out in a cross.
    cuboidNet(l, w, h) {
        return tikzBlock(`
  \\draw[thick] (0,0) rectangle (${w},${h});
  \\node at (${w / 2},${h / 2}) {\\small ${w}$\\times$${h}};
  \\draw[thick] (${w},0) rectangle (${w + l},${h});
  \\node at (${w + l / 2},${h / 2}) {\\small ${l}$\\times$${h}};
  \\draw[thick] (${w + l},0) rectangle (${2 * w + l},${h});
  \\node at (${w + l + w / 2},${h / 2}) {\\small ${w}$\\times$${h}};
  \\draw[thick] (${2 * w + l},0) rectangle (${2 * w + 2 * l},${h});
  \\node at (${2 * w + l + l / 2},${h / 2}) {\\small ${l}$\\times$${h}};
  \\draw[thick] (0,${h}) rectangle (${w},${h + l});
  \\node at (${w / 2},${h + l / 2}) {\\small ${w}$\\times$${l}};
  \\draw[thick] (0,-${l}) rectangle (${w},0);
  \\node at (${w / 2},-${l / 2}) {\\small ${w}$\\times$${l}};
`, 'scale=0.65');
    },

    // A blank Cartesian grid with labelled axes, for "draw the graph of
    // ..." questions — deliberately left unplotted since the answer is
    // the student's own line.
    blankGrid(xMax, yMax, xLabel = 'x', yLabel = 'y') {
        return tikzBlock(`
  \\draw[step=1cm,gray!40,very thin] (0,0) grid (${xMax},${yMax / 25});
  \\draw[->,thick] (0,0) -- (${xMax + 0.5},0) node[right] {${xLabel}};
  \\draw[->,thick] (0,0) -- (0,${yMax / 25 + 0.5}) node[above] {${yLabel}};
`, 'scale=1');
    },

    // A simple north-referenced compass rose, for bearing / scale-drawing
    // questions where the student constructs the rest of the figure.
    compassRose() {
        return tikzBlock(`
  \\draw[->,thick] (0,-1) -- (0,1) node[above] {N};
  \\draw[thick] (-0.15,0.85) -- (0,1) -- (0.15,0.85);
`, 'scale=0.6');
    }
};

// ---------------------------------------------------------------------
// 3. TOPIC-AWARE QUESTION BANK
//    Each entry is keyed by match keywords (checked against the
//    sub_strand_name / strand_name / content of a curriculum row) AND a
//    `minGrade` — the earliest grade (within the KJSEA track) at which
//    that concept is examinable per the KICD design.
//
//    CRITICAL: a topic is only eligible for a paper if minGrade is in
//    allowedGradesFor(targetGrade) (see findTopic below). This is what
//    stops e.g. a Grade 7 paper from drawing an indices, cube-root,
//    simultaneous-equations, density, matrices, longitude-time, or VAT
//    question — those concepts genuinely don't appear until Grade 8/9.
// ---------------------------------------------------------------------

function money(n) { return `Ksh ${n.toLocaleString()}`; }
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; }

const TOPICS = [
    // ---------------- Grade 7 topics ----------------
    {
        key: 'whole-numbers',
        minGrade: 'Grade 7',
        match: ['whole number', 'place value', 'operations on whole', 'number sense', 'factor', 'multiple', 'divisib'],
        mcq: [
            (r) => {
                const set = r.shuffle([2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 4).sort((a, b) => a - b);
                const isPrime = n => { if (n < 2) return false; for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
                const primesInSet = set.filter(isPrime);
                const correctPair = primesInSet.length >= 2 ? `${primesInSet[0]} and ${primesInSet[1]}` : `${set[0]} and ${set[1]}`;
                const distract = r.shuffle(set).slice(0, 2);
                return {
                    q: `A packet contains number cards. A learner picked cards with numbers ${set.join(', ')} from the packet. Which of the following sets has prime numbers \\textbf{only}?`,
                    a: `${set[0]} and ${set[1]}`, b: `${set[0]} and ${set[2]}`, c: `${set[1]} and ${set[3]}`, d: correctPair
                };
            },
            (r) => {
                const g1 = r.pick([60, 90, 120, 150, 180]), g2 = r.pick([80, 100, 140, 160]), t = r.pick([12, 18, 24, 30]);
                const h = gcd(gcd(g1, g2), t);
                const distract = [h * 2, h + 4, Math.max(1, h - 3)];
                return mcqFromCorrect(r, `There are ${g1} boys, ${g2} girls and ${t} teachers in a school. The school formed groups with equal numbers of boys, girls and teachers. What is the largest number of groups formed?`, h, distract);
            },
            (r) => {
                const a1 = r.int(1200, 98000), a2 = r.int(150, 4000);
                const op = r.pick(['+', '-', '\\times']);
                let ans;
                if (op === '+') ans = a1 + a2;
                else if (op === '-') ans = a1 - a2;
                else ans = a1 * a2;
                const distract = [ans + r.int(10, 300), ans - r.int(10, 300), Math.abs(ans - r.int(300, 900))];
                return mcqFromCorrect(r, `Work out $${a1.toLocaleString()} ${op} ${a2.toLocaleString()}$.`, ans, distract);
            }
        ],
        sectionB: [
            (r, ctx) => {
                const total = r.int(6000, 15000);
                const ran = r.int(2000, total - 800);
                const walked = total - ran;
                return {
                    q: `${r.pick(['Anita', 'Brian', 'Chebet', 'Dennis'])}, a ${ctx.gradeClean} learner, participated in a ${total.toLocaleString()} m race. ${r.pick(['She', 'He'])} ran ${ran.toLocaleString()} m and walked the remaining distance.`,
                    parts: [
                        '(a) Work out the distance walked. \\hfill \\textbf{[1 mark]}',
                        '(b) Write the distance ran in words. \\hfill \\textbf{[1 mark]}',
                        '(c) Write the distance ran, rounded off to the nearest hundred. \\hfill \\textbf{[1 mark]}'
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
            }
        ],
        sectionB: [
            (r) => {
                const denom = r.pick([4, 5, 8]);
                const num = r.int(1, denom - 1);
                const total = r.int(40, 120);
                const perSeedling = num / denom, alloc = 1 / r.pick([4, 5]);
                return {
                    q: `${r.pick(['Kamau', 'Njoki', 'Barasa'])} intended to plant ${total} seedlings. He allocated $\\frac{1}{${r.pick([4, 5])}}$ of an hour to plant each seedling. During the planting, he actually took $\\frac{1}{${r.pick([3, 6])}}$ of an hour to plant each seedling.`,
                    parts: ['Determine the extra total time used to plant all the seedlings, giving your answer in hours. \\hfill \\textbf{[3 marks]}'],
                    marks: 3
                };
            },
            (r) => {
                const price = r.int(80, 300);
                const frac = r.pick(['1/4', '2/5', '3/8', '3/4']);
                return {
                    q: `A trader bought a bag of maize for ${money(price)}. She sold $${frac}$ of it and stored the rest.`,
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
        key: 'commercial-profit-loss',
        minGrade: 'Grade 7',
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
        match: ['money', 'currency', 'bank', 'postal', 'shopping', 'mobile money'],
        mcq: [
            (r) => {
                const rows = [
                    ['1 - 150', 'Free', 'Free'],
                    ['151 - 300', '10', '10'],
                    ['301 - 500', '15', '23'],
                    ['501 - 1 000', '25', '28'],
                    ['1 001 - 2 500', '30', '35'],
                ];
                const balance = r.int(2000, 6000);
                const sent = r.int(500, Math.min(2500, balance - 800));
                const withdraw = r.int(200, 900);
                const sendCharge = sent <= 150 ? 0 : sent <= 300 ? 10 : sent <= 500 ? 15 : sent <= 1000 ? 25 : 30;
                const wCharge = withdraw <= 150 ? 0 : withdraw <= 300 ? 10 : withdraw <= 500 ? 23 : withdraw <= 1000 ? 28 : 35;
                const ans = balance - sent - sendCharge - withdraw - wCharge;
                const distract = [ans + sendCharge, ans - wCharge, balance - sent - withdraw];
                const table = `\\begin{center}\\begin{tabular}{|l|c|c|}\\hline\nTransaction range (Ksh) & Sending charge (Ksh) & Withdrawal charge (Ksh) \\\\\\hline\n${rows.map(row => row.join(' & ')).join(' \\\\\\hline\n')} \\\\\\hline\n\\end{tabular}\\end{center}`;
                return mcqFromCorrect(r, `The table below shows mobile money transaction charges for a service provider.\\\\ ${table} A customer had Ksh ${balance.toLocaleString()} in the account. They sent Ksh ${sent.toLocaleString()} and then withdrew Ksh ${withdraw.toLocaleString()}. How much money remained in the account?`, ans, distract);
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
        minGrade: 'Grade 7',
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
                    q: `A square plot of land has an area of $${areaShown}\\text{ m}^2$.`,
                    parts: [
                        '(a) Determine the length of one side of the plot. \\hfill \\textbf{[2 marks]}',
                        '(b) A fence is to be built around the plot. Calculate the total length of fencing wire required. \\hfill \\textbf{[2 marks]}'
                    ],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'temperature',
        minGrade: 'Grade 7',
        match: ['temperature', 'celsius', 'thermometer'],
        mcq: [
            (r) => {
                const start = r.int(-15, -2), rise = r.int(4, 20);
                const ans = start + rise;
                const distract = [start - rise, rise, ans + 2];
                return mcqFromCorrect(r, `The temperature of a deep freezer was $${start}^\\circ\\text{C}$. It was adjusted and the temperature was increased by $${rise}^\\circ\\text{C}$. What was the temperature of the freezer after it was adjusted?`, ans, distract);
            }
        ],
        sectionB: []
    },
    {
        key: 'temperature-kelvin',
        minGrade: 'Grade 9', // Kelvin/absolute-temperature conversion is examined only at G9 alongside SI-unit work.
        match: ['kelvin', 'absolute temperature'],
        mcq: [
            (r) => {
                const kelvin = -r.int(5, 40);
                const ans = kelvin + 273;
                const distract = [kelvin - 273, kelvin * 273, kelvin / 273];
                return { q: `The temperature of a liquid was recorded as ${kelvin} K. Which of the following calculations gives the correct temperature in degrees Celsius?`,
                    a: `${kelvin} \\times 273`, b: `${kelvin} \\div 273`, c: `${kelvin} + 273`, d: `${kelvin} - 273` };
            }
        ],
        sectionB: []
    },
    {
        key: 'algebra',
        minGrade: 'Grade 7',
        match: ['algebra', 'expression', 'equation', 'substitution', 'linear equation'],
        mcq: [
            (r) => {
                const total = r.int(15, 40), x = r.pick(['x']);
                const donkeys = `x`;
                const goats = `2x`;
                const distract = [`${total} - 2x`, `${total} - x`, `${total} + 3x`];
                return { q: `The total number of animals in a farm is ${total}. There are $x$ donkeys in the farm. The number of goats in the farm is twice the number of donkeys. The remaining animals are sheep. Which of the following represents the number of sheep in the farm?`,
                    a: `${total} - 3x`, b: `${total} - 2x`, c: `${total} - x`, d: `${total} + 3x` };
            },
            (r) => {
                const a = r.int(2, 9), b = r.int(1, 20), c = r.int(20, 90);
                const x = (c - b) / a;
                const clean = Number.isInteger(x);
                const ans = clean ? x : x.toFixed(1);
                const distract = [ans + 1, ans - 2, (c + b) / a];
                return mcqFromCorrect(r, `Solve for $x$: $${a}x + ${b} = ${c}$.`, ans, distract);
            }
        ],
        sectionB: [
            (r) => {
                const cost = r.int(30, 150);
                const items = r.int(3, 10);
                const extra = r.int(100, 400);
                return {
                    q: `${r.pick(['Fatuma', 'Otieno', 'Wanjala'])} bought $x$ items each costing Ksh ${cost}, then bought one more item for Ksh ${extra}. In total ${r.pick(['she', 'he'])} spent Ksh ${(items * cost + extra).toLocaleString()}.`,
                    parts: [`Form a linear equation in $x$ and solve it to find the number of items bought at Ksh ${cost} each. \\hfill \\textbf{[4 marks]}`],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'measurement-length-area-volume',
        minGrade: 'Grade 7',
        match: ['area', 'volume', 'length', 'perimeter', 'mensuration', 'cube', 'cuboid', 'cylinder', 'capacity'],
        mcq: [
            (r) => {
                const l = r.int(4, 12) + 0.5 * r.int(0, 1), w = r.int(3, 8), h = r.int(3, 15);
                const litres = (l * w * h) / 1000;
                const distract = [litres * 1000, litres / 10, litres * 10];
                return mcqFromCorrect(r, `A packet of milk is in the shape of a cuboid. The length of the packet is ${l} cm, the width is ${w} cm and the height is ${h} cm. What is the capacity of the packet in litres?`, litres, distract);
            }
        ],
        sectionB: [
            (r) => {
                const side = r.int(2, 5) + 0.5 * r.int(0, 1);
                const smallSide = r.pick([25, 30, 40, 50]);
                return {
                    q: `A metallic container is in the shape of a cube of side length ${side} m.`,
                    parts: [
                        '(a) Determine the volume of the container in cubic metres. \\hfill \\textbf{[2 marks]}',
                        `(b) Smaller cubes of side ${smallSide} cm were packed into the container. Determine the number of smaller cubes that were packed. \\hfill \\textbf{[2 marks]}`
                    ],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'cuboid-net',
        minGrade: 'Grade 7', // Nets of solids — G7 3.4 (Cubes, Cuboids and Cylinders)
        match: ['net of a', 'nets of solids', 'net of solid'],
        mcq: [],
        sectionB: [
            (r) => {
                const l = r.int(3, 8), w = r.int(2, 6), h = r.int(2, 5);
                const sa = 2 * (l * w + l * h + w * h);
                return {
                    q: `${r.pick(['Karen', 'Otieno', 'Chebet'])} modelled a cuboid of dimensions ${l} cm by ${w} cm by ${h} cm as shown.${DIAGRAMS.cuboidNet(l, w, h)}`,
                    parts: [
                        '(a) Draw the net of the cuboid. \\hfill \\textbf{[2 marks]}',
                        '(b) Calculate the total surface area of the cuboid from the net. \\hfill \\textbf{[3 marks]}'
                    ],
                    marks: 5
                };
            }
        ]
    },
    {
        key: 'pythagoras',
        minGrade: 'Grade 7',
        match: ['pythagoras', 'pythagorean'],
        mcq: [
            (r) => {
                const pairs = [[3, 4], [6, 8], [5, 12], [9, 12], [8, 15]];
                const [a, b] = r.pick(pairs);
                const scale = r.pick([1, 2]);
                const ans = Math.sqrt(a * a + b * b) * scale;
                const distract = [a * scale + b * scale, ans + 1, ans - 2];
                return mcqFromCorrect(r, `A right-angled triangle has legs of length ${a * scale} cm and ${b * scale} cm. Find the length of the hypotenuse.`, ans, distract);
            }
        ],
        sectionB: [
            (r) => {
                const dist = r.int(2, 6), height = r.int(3, 8);
                return {
                    q: `${r.pick(['Juma', 'Wanjiru', 'Kiptoo'])} placed a metal rod against a vertical wall such that the foot of the rod is ${dist} m from the wall and the top of the rod is ${height} m above the ground.${DIAGRAMS.rightTriangle(dist, height, { hypotenuseLabel: 'rod' })}`,
                    parts: ['(a) Calculate the length of the rod, correct to 2 decimal places. \\hfill \\textbf{[2 marks]}'],
                    marks: 2
                };
            }
        ]
    },
    {
        key: 'quadrilateral-properties',
        minGrade: 'Grade 7', // Properties of quadrilaterals — G7 4.2 Geometry
        match: ['quadrilateral', 'rhombus', 'trapezium', 'properties of a parallelogram'],
        mcq: [
            (r) => {
                const shapes = [
                    { name: 'Parallelogram', props: ['Opposite sides are equal and parallel', 'Diagonals bisect each other', 'Opposite angles are equal'] },
                    { name: 'Rhombus', props: ['All sides are equal', 'Diagonals bisect each other at 90°', 'Opposite angles are equal'] },
                    { name: 'Rectangle', props: ['Opposite sides are equal and parallel', 'All angles are 90°', 'Diagonals are equal and bisect each other'] }
                ];
                const shape = r.pick(shapes);
                const others = shapes.filter(s => s.name !== shape.name).map(s => s.name);
                const distractNames = ['Trapezium', ...others].filter(n => n !== shape.name).slice(0, 3);
                return {
                    q: `The following are properties of a quadrilateral.\\\\ (i) ${shape.props[0]}\\\\ (ii) ${shape.props[1]}\\\\ (iii) ${shape.props[2]}\\\\ What is the name of the quadrilateral?`,
                    a: shape.name, b: distractNames[0], c: distractNames[1], d: distractNames[2]
                };
            }
        ],
        sectionB: []
    },
    {
        key: 'angles-basic',
        minGrade: 'Grade 7',
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
        minGrade: 'Grade 7',
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

    // ---------------- Grade 8 topics (also reachable from Grade 9) ----------------
    {
        key: 'ratio-proportion',
        minGrade: 'Grade 8',
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
                    q: `A thanksgiving ceremony was attended by men, women and children in the ratio ${a}:${b}:${c}. There were ${children} children in the ceremony.`,
                    parts: [
                        '(a) Determine the number of men who attended. \\hfill \\textbf{[3 marks]}',
                        '(b) Determine how many more women than men attended. \\hfill \\textbf{[2 marks]}'
                    ],
                    marks: 5
                };
            }
        ]
    },
    {
        key: 'inverse-proportion-rates',
        minGrade: 'Grade 8', // Direct & inverse proportion — G8 1.5 Rates, Ratio, Proportion and Percentages
        match: ['inverse proportion', 'direct proportion', 'person-days', 'work rate'],
        mcq: [],
        sectionB: [
            (r) => {
                const men1 = r.pick([4, 5, 6]), hrs1 = r.pick([6, 7, 8]), days1 = r.pick([10, 12, 15]);
                const men2 = r.pick([2, 3]);
                const totalManHours = men1 * hrs1 * days1;
                const hrs2 = r.pick([6, 8, 9]);
                const days2 = totalManHours / (men2 * hrs2);
                const extraDays = Math.round((days2 - days1) * 10) / 10;
                return {
                    q: `A factory employed ${men1} men working ${hrs1} hours per day to pack flour into packets. The men worked for ${days1} days. Determine how many more days ${men2} men working for ${hrs2} hours per day will take to pack the same amount of flour.`,
                    parts: ['\\hfill \\textbf{[4 marks]}'],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'percentage-error',
        minGrade: 'Grade 8', // Approximation and error — G8 1.6
        match: ['percentage error', 'estimation', 'accuracy', 'approximation'],
        mcq: [
            (r) => {
                const actual = (r.int(8, 30) / 10).toFixed(1);
                const estimate = (parseFloat(actual) + r.pick([-0.3, -0.2, 0.2, 0.3])).toFixed(1);
                const diff = Math.abs(parseFloat(estimate) - parseFloat(actual)).toFixed(1);
                return { q: `${r.pick(['Salome', 'Otieno', 'Wangari'])} estimated the height of a window to be ${estimate} m. She measured it and found that the actual height was ${actual} m. Which of the following calculations gives the percentage error in her estimation?`,
                    a: `\\frac{${diff}}{${estimate}} \\times 100\\%`, b: `\\frac{${diff}}{${actual}} \\times 100\\%`, c: `\\frac{${actual}}{${estimate}} \\times 100\\%`, d: `\\frac{${estimate}}{${actual}} \\times 100\\%` };
            }
        ],
        sectionB: []
    },
    {
        key: 'inequalities',
        minGrade: 'Grade 8', // Linear inequalities in one unknown — G8 2.3
        match: ['inequality', 'inequalities'],
        mcq: [
            (r) => {
                const lo = r.int(10, 40), hi = lo + r.int(10, 30);
                const loStrict = r.pick([true, false]);
                const hiStrict = r.pick([true, false]);
                const build = (a, b, ls, hs) => `${a} ${ls ? '<' : '\\le'} x ${hs ? '<' : '\\le'} ${b}`;
                const correct = build(lo, hi, loStrict, hiStrict);
                const distract = [build(lo, hi, !loStrict, hiStrict), build(lo, hi, loStrict, !hiStrict), build(lo, hi, !loStrict, !hiStrict)];
                return { q: `A school is planning to transport $x$ learners for drama festivals. For cost efficiency, the school has to transport ${loStrict ? 'more than' : 'at least'} ${lo} learners but ${hiStrict ? 'less than' : 'not more than'} ${hi} learners. Which of the following inequalities represents this information?`,
                    a: correct, b: distract[0], c: distract[1], d: distract[2] };
            }
        ],
        sectionB: []
    },
    {
        key: 'simultaneous-equations',
        minGrade: 'Grade 8',
        match: ['simultaneous', 'two unknowns', 'elimination'],
        mcq: [],
        sectionB: [
            (r) => {
                const books = r.int(3, 8), pens = r.int(2, 6), total1 = r.int(200, 600);
                const books2 = books * 2, pens2 = r.int(1, 4), total2 = r.int(300, 900);
                return {
                    q: `${r.pick(['Regina', 'Kevin', 'Amina'])} bought ${books} books and ${pens} pens for ${money(total1)}. ${r.pick(['Hamisi', 'Otieno', 'Njeri'])} bought ${books2} books and ${pens2} pens of the same type for ${money(total2)}.`,
                    parts: ['Determine the cost of one book and one pen. \\hfill \\textbf{[4 marks]}'],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'geometric-construction',
        minGrade: 'Grade 8',
        match: ['construction', 'perpendicular', 'parallel lines', 'bisect', 'compass', 'parallelogram'],
        mcq: [],
        sectionB: [
            (r) => {
                const ab = r.int(4, 8), ad = r.int(3, 6), angle = r.pick([30, 45, 60, 75]);
                return {
                    q: `A table top is in the shape of a parallelogram represented by a drawing $ABCD$ such that $AB = ${ab}$ cm, $AD = ${ad}$ cm and angle $DAB = ${angle}^\\circ$. Using a ruler and a pair of compasses only, construct:`,
                    parts: [
                        '(a) parallelogram $ABCD$; \\hfill \\textbf{[3 marks]}',
                        '(b) a perpendicular line from $D$ to meet $AB$ at $E$. Measure $DE$. \\hfill \\textbf{[2 marks]}'
                    ],
                    marks: 5
                };
            }
        ]
    },
    {
        key: 'enlargement-scale-factor',
        minGrade: 'Grade 8', // Transformations: enlargement — G8 4.3
        match: ['enlargement', 'scale factor', 'similar figures'],
        mcq: [
            (r) => {
                const length = r.int(5, 20);
                const factor = r.pick([1.5, 2, 2.5, 3]);
                const ans = length * factor;
                const distract = [length / factor, length + factor, ans - length];
                return mcqFromCorrect(r, `A photograph was enlarged by a scale factor of ${factor}. The original photograph had a length of ${length} cm. What was the new length of the photograph?`, ans, distract);
            }
        ],
        sectionB: []
    },
    {
        key: 'scale-drawing',
        minGrade: 'Grade 8', // Scale drawing — G8 4.2
        match: ['scale drawing', 'architectural drawing', 'map scale'],
        mcq: [
            (r) => {
                const scaleDen = r.pick([50, 100, 200]);
                const actual = r.int(2, 10);
                const drawingCm = (actual * 100) / scaleDen;
                const distract = [drawingCm * 10, drawingCm / 10, actual];
                return mcqFromCorrect(r, `The scale on an architectural drawing is $1:${scaleDen}$. A wall constructed using the drawing was ${actual} m long. What was the length of the wall on the drawing?`, `${drawingCm} cm`, distract.map(d => `${d} cm`));
            }
        ],
        sectionB: []
    },
    {
        key: 'statistics',
        minGrade: 'Grade 8',
        match: ['mean', 'measures of central tendency', 'mode', 'median of discrete'],
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
                const scores = Array.from({ length: n }, () => r.int(15, 33));
                const mean = (scores.reduce((s, v) => s + v, 0) / n).toFixed(2);
                return {
                    q: `The marks scored by ${n} learners in a test were recorded as: ${scores.join(', ')}.`,
                    parts: [
                        '(a) Prepare a frequency distribution table for the data. \\hfill \\textbf{[2 marks]}',
                        '(b) Determine the: (i) mean mark; \\hfill \\textbf{[2 marks]} (ii) median mark. \\hfill \\textbf{[1 mark]}'
                    ],
                    marks: 5
                };
            }
        ]
    },
    {
        key: 'probability-basic',
        minGrade: 'Grade 8',
        match: ['probability', 'chance'],
        mcq: [
            (r) => {
                const word = r.pick(['ELEMENTAITA', 'MATHEMATICS', 'PROBABILITY']);
                const letter = r.pick(['E', 'A', 'T']);
                const count = [...word].filter(ch => ch === letter).length || 1;
                const g = gcd(count, word.length);
                const ans = `${count / g}/${word.length / g}`;
                const distract = [`1/${word.length}`, `${count}/${word.length}`, `${word.length - count}/${word.length}`];
                return mcqFromCorrect(r, `The letters of the word ${word} were written on cards, each letter on its own card. The cards were placed in a bucket and one was picked at random. What is the probability that the card picked had the letter ${letter}?`, ans, distract);
            }
        ],
        sectionB: []
    },

    // ---------------- Grade 9-only topics ----------------
    {
        key: 'indices-logarithms',
        minGrade: 'Grade 9',
        match: ['indices', 'index notation', 'logarithm'],
        mcq: [
            (r) => {
                const base = r.pick([2, 3, 5]);
                const p1 = r.int(2, 4);
                const rhsPower = p1 + r.int(1, 3);
                const rhs = Math.pow(base, rhsPower);
                const x = rhsPower - p1;
                const distract = [rhsPower, x + 2, (1 / x).toFixed(2)];
                return mcqFromCorrect(r, `A Grade 9 teacher had flash cards containing questions on indices. A learner picked a flash card containing the question $${base}^{x} \\times ${base}^{${p1}} = ${rhs}$. What is the value of $x$ in the equation?`, x, distract);
            }
        ],
        sectionB: []
    },
    {
        key: 'cubes-cube-roots',
        minGrade: 'Grade 9',
        match: ['cube root', 'cubes and cube'],
        mcq: [
            (r) => {
                const base = r.int(2, 12);
                const ans = base ** 3;
                const distract = [ans + base, base * 3, ans - base];
                return mcqFromCorrect(r, `Find the cube of ${base}.`, ans, distract);
            }
        ],
        sectionB: []
    },
    {
        key: 'matrices',
        minGrade: 'Grade 9', // Matrices (order, addition) — G9 2.3
        match: ['matrix', 'matrices'],
        mcq: [
            (r) => {
                const rows = r.pick([2, 3]), cols = r.pick([4, 5]);
                const total = rows * cols;
                const distract = [`${total} \\times 1`, `1 \\times ${total}`, `${cols} \\times ${rows}`];
                const example = Array.from({ length: rows }, () => Array.from({ length: cols }, () => r.int(0, 9)).join(' & ')).join(' \\\\ ');
                return { q: `Learners presented results using the matrix: $\\begin{pmatrix} ${example} \\end{pmatrix}$. What is the order of the matrix?`,
                    a: `${rows} \\times ${cols}`, b: distract[0], c: distract[1], d: distract[2] };
            }
        ],
        sectionB: [
            (r) => {
                const items = ['Oranges', 'Mangoes', 'Bananas'];
                const week1 = { A: [r.int(4, 10), r.int(8, 20), r.int(2, 8)], B: [r.int(4, 15), r.int(8, 22), r.int(2, 8)] };
                const week2 = { A: [r.int(4, 10), r.int(8, 20), r.int(2, 8)], B: [r.int(4, 15), r.int(8, 22), r.int(2, 8)] };
                const table = (title, data) => `\\textbf{${title}}\\\\\\begin{tabular}{|l|c|c|c|}\\hline\nFamily & ${items.join(' & ')} \\\\\\hline\nA & ${data.A.join(' & ')} \\\\\\hline\nB & ${data.B.join(' & ')} \\\\\\hline\n\\end{tabular}`;
                return {
                    q: `Two families, A and B, bought oranges, mangoes and bananas in two weeks as shown in the tables below.\\\\ ${table('Week 1', week1)} \\\\[0.5em] ${table('Week 2', week2)}`,
                    parts: [
                        '(a) Form matrices to represent the information provided in Week 1 and Week 2. \\hfill \\textbf{[1 mark]}',
                        '(b) Determine the total number of fruits of each type bought by each family (add the two matrices). \\hfill \\textbf{[1 mark]}'
                    ],
                    marks: 2
                };
            }
        ]
    },
    {
        key: 'linear-graphs',
        minGrade: 'Grade 9', // Equation of a line, gradient, graphs — G9 2.1/2.2
        match: ['equation of a line', 'gradient', 'linear graph', 'graph of a line', 'graphs of linear equations'],
        mcq: [
            (r) => {
                const a = r.pick([1, 2, 3]), b = r.pick([1, 2, 3, 5]), c = r.int(1, 8);
                const gradient = -a / b;
                const perpGradient = -1 / gradient;
                const asFrac = n => (Number.isInteger(n) ? `${n}` : `\\frac{${n > 0 ? 1 : -1}}{${Math.round(1 / Math.abs(n))}}`);
                const distract = [asFrac(gradient), asFrac(-gradient), asFrac(1 / gradient)];
                return { q: `A line $L_1$ has equation $${b}y = ${a}x + ${c}$. A line $L_2$ is perpendicular to $L_1$. What is the gradient of $L_2$?`,
                    a: asFrac(perpGradient), b: distract[0], c: distract[1], d: distract[2] };
            }
        ],
        sectionB: [
            (r) => {
                const gradient = r.pick(['1/2', '1/3', '2', '3']);
                const px = r.int(1, 4), py = r.int(2, 8);
                return {
                    q: `A line drawn on a grid passes through the point $(${px},${py})$ with a gradient of $${gradient}$. Determine:`,
                    parts: [
                        '(a) the equation of the line; \\hfill \\textbf{[2 marks]}',
                        '(b) the coordinates of the $x$-intercept of the line. \\hfill \\textbf{[2 marks]}'
                    ],
                    marks: 4
                };
            },
            (r) => {
                const m = r.pick([30, 40, 50, 60]);
                return {
                    q: `The amount of money ($y$) that a farmer gets from selling milk is given by the equation $y = ${m}x$, where $x$ is the amount of milk in litres.${DIAGRAMS.blankGrid(4, m * 4, 'x', 'y')}`,
                    parts: [
                        '(a) Use the equation to complete a table of values for $x = 0, 0.5, 1, 1.5, 2$. \\hfill \\textbf{[1 mark]}',
                        `(b) On the grid provided, draw the graph of $y = ${m}x$. \\hfill \\textbf{[2 marks]}`
                    ],
                    marks: 3
                };
            }
        ]
    },
    {
        key: 'circles-sectors-solids',
        minGrade: 'Grade 9', // Sector of a circle / arc length, and volume & surface area of cone, sphere, frustum — G9 3.1/3.2
        match: ['sphere', 'frustum', 'cone', 'sector of a circle', 'segment of a circle', 'arc length'],
        mcq: [
            (r) => {
                const width = (r.int(60, 120) / 100).toFixed(2);
                const angle = r.pick([45, 60, 72, 90]);
                const sweep = (2 * Math.PI * parseFloat(width) * angle) / 360;
                const ans = sweep.toFixed(2);
                const distract = [(sweep * 2).toFixed(2), (sweep / 2).toFixed(2), (sweep + 0.3).toFixed(2)];
                return mcqFromCorrect(r, `The width of a door is ${width} m. The door is opened through an angle of $${angle}^\\circ$. What is the length which the tip of the door sweeps through?`, `${ans} m`, distract.map(d => `${d} m`));
            }
        ],
        sectionB: [
            (r) => {
                const radius = (r.int(12, 24) / 10).toFixed(1);
                const ballRadius = (parseFloat(radius) - r.int(1, 3) / 10).toFixed(1);
                return {
                    q: `A cylindrical tin of radius ${radius} cm contains some water. A spherical ball bearing of radius ${ballRadius} cm is immersed in the water in the tin.${DIAGRAMS.cylinderWithSphere(radius, ballRadius)}`,
                    parts: ['Determine the rise in the water level in the tin, correct to 1 decimal place. \\hfill \\textbf{[4 marks]}'],
                    marks: 4
                };
            },
            (r) => {
                const slant = r.int(12, 25), radius = (r.int(30, 55) / 10).toFixed(1);
                return {
                    q: `A learner moulded a solid in the shape of a cone. The slant height of the cone was ${slant} cm. The base radius of the cone was ${radius} cm.${DIAGRAMS.cone(radius, slant)}`,
                    parts: ['Calculate the total surface area of the solid, correct to 2 decimal places. \\hfill \\textbf{[5 marks]}'],
                    marks: 5
                };
            }
        ]
    },
    {
        key: 'density',
        minGrade: 'Grade 9',
        match: ['density', 'mass, volume and weight', 'weight and density'],
        mcq: [],
        sectionB: [
            (r) => {
                const dist = r.int(2, 6), height = r.int(3, 8);
                const vol = r.int(300, 900), mass = (r.int(10, 40) / 10);
                return {
                    q: `${r.pick(['Juma', 'Wanjiru', 'Kiptoo'])} placed a metal rod against a wall. The foot of the rod was ${dist} m away from the wall. The top of the rod was ${height} m above the ground.${DIAGRAMS.rightTriangle(dist, height, { hypotenuseLabel: 'rod' })}`,
                    parts: [
                        '(a) Calculate the length of the rod. \\hfill \\textbf{[2 marks]}',
                        `(b) If the rod has a volume of ${vol}\\text{ cm}^3$ and a mass of ${mass} kg, calculate the density of the rod. \\hfill \\textbf{[2 marks]}`
                    ],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'longitude-time',
        minGrade: 'Grade 9', // Longitude and time — G9 4.2
        match: ['longitude', 'time zones', 'local time', 'greenwich'],
        mcq: [],
        sectionB: [
            (r) => {
                const lonP = r.int(20, 70), lonQ = r.int(20, 70);
                const dirP = r.pick(['W', 'E']), dirQ = dirP === 'W' ? 'E' : r.pick(['W', 'E']);
                const totalDiff = dirP === dirQ ? Math.abs(lonP - lonQ) : lonP + lonQ;
                const hourDiff = totalDiff / 15;
                const hourQ = r.int(1, 11), minQ = r.pick(['00', '30']);
                return {
                    q: `A town P lies on longitude $${lonP}^\\circ${dirP}$. A town Q lies on longitude $${lonQ}^\\circ${dirQ}$. The local time at town Q is ${hourQ}.${minQ} p.m. Determine the local time at town P.`,
                    parts: ['\\hfill \\textbf{[4 marks]}'],
                    marks: 4
                };
            }
        ]
    },
    {
        key: 'bearings-scale-drawing',
        minGrade: 'Grade 9', // Bearings and scale drawing of routes — G9 4.3
        match: ['bearing', 'compass direction', 'true bearing'],
        mcq: [],
        sectionB: [
            (r) => {
                const distAB = r.pick([40, 50, 60]), distBC = r.pick([50, 60, 70]);
                const bearingAB = r.pick([30, 60, 120, 150]), bearingBC = r.pick([200, 210, 240, 250]);
                const scale = r.pick([10, 20]);
                return {
                    q: `A learner marked three points $A$, $B$ and $C$ on a playing field. From point $A$ she walked ${distAB} m on a bearing of $${bearingAB}^\\circ$ to reach point $B$. From point $B$ she walked ${distBC} m on a bearing of $${bearingBC}^\\circ$ to reach point $C$.${DIAGRAMS.compassRose()}`,
                    parts: [
                        `(a) Using a scale of 1 cm to represent ${scale} m, show the relative positions of points $A$, $B$ and $C$. \\hfill \\textbf{[3 marks]}`,
                        '(b) Use the diagram to determine: (i) the distance from $A$ to $C$; \\hfill \\textbf{[1 mark]} (ii) the bearing of $C$ from $A$. \\hfill \\textbf{[1 mark]}'
                    ],
                    marks: 5
                };
            }
        ]
    },
    {
        key: 'angle-elevation-depression',
        minGrade: 'Grade 9', // Angles of elevation and depression — G9 4.4
        match: ['angle of elevation', 'angle of depression', 'clinometer'],
        mcq: [],
        sectionB: [
            (r) => {
                const distGround = r.int(20, 60), angle = r.pick([25, 30, 35, 40, 45]);
                return {
                    q: `${r.pick(['Daudi', 'Achieng', 'Kiplangat'])} was standing on a balcony. ${r.pick(['He', 'She'])} observed a ball on the ground, ${distGround} m from the foot of the building. The angle of depression of the ball from ${r.pick(['his', 'her'])} position was $${angle}^\\circ$.${DIAGRAMS.rightTriangle(distGround, Math.round(distGround * Math.tan(angle * Math.PI / 180)), { angleLabel: `${angle}^\\circ` })}`,
                    parts: ['Calculate the height from the ground to where the observer was standing, correct to 2 decimal places. \\hfill \\textbf{[3 marks]}'],
                    marks: 3
                };
            }
        ]
    },
    {
        key: 'money-import-export-vat',
        minGrade: 'Grade 9',
        match: ['import duty', 'export', 'excise', 'value added tax', 'vat', 'currency'],
        mcq: [],
        sectionB: [
            (r) => {
                const value = r.int(600000, 2000000);
                const dImport = r.pick([10, 15, 20, 25]);
                const dExcise = r.pick([10, 15, 18]);
                const vat = 16;
                return {
                    q: `${r.pick(['Festus', 'Naliaka', 'Otieno'])} imported a machine with a customs value of ${money(value)}. He was charged an import duty at the rate of ${dImport}\\%, excise duty at the rate of ${dExcise}\\% (on value plus import duty), and Value Added Tax (VAT) at the rate of ${vat}\\% (on value plus import duty plus excise duty). Determine the amount of money he paid as:`,
                    parts: [
                        '(a) import duty; \\hfill \\textbf{[2 marks]}',
                        '(b) excise duty; \\hfill \\textbf{[2 marks]}',
                        '(c) Value Added Tax. \\hfill \\textbf{[1 mark]}'
                    ],
                    marks: 5
                };
            }
        ]
    },
    {
        key: 'statistics-grouped',
        minGrade: 'Grade 9',
        match: ['grouped data', 'class width', 'frequency distribution', 'modal class'],
        mcq: [],
        sectionB: []
    },
    {
        key: 'probability-combined',
        minGrade: 'Grade 9',
        match: ['mutually exclusive', 'independent events', 'tree diagram', 'combined events'],
        mcq: [],
        sectionB: [
            (r) => {
                return {
                    q: `${r.pick(['Rebecca', 'Otieno', 'Amina'])} tossed a coin and rolled a die at the same time.`,
                    parts: [
                        '(a) Write down the probability space to show the possible outcomes. \\hfill \\textbf{[2 marks]}',
                        `(b) Determine the probability that ${r.pick(['Rebecca', 'Otieno', 'Amina'])} obtained a head on the coin and a ${r.int(1, 6)} on the die. \\hfill \\textbf{[1 mark]}`
                    ],
                    marks: 3
                };
            }
        ]
    }
];

// ---------------------------------------------------------------------
// 3b. SUBJECT CONFIG — paper structure differs by subject. Only
//     Mathematics is finalised in this pass; other subjects use the
//     generic fallback shape until their own pass.
//     NOTE: sectionBCount fixed to 20 (was 10) — the real KJSEA
//     Mathematics paper runs Section B as questions 21-40 (20 items of
//     roughly 2-5 marks each, totalling 80), not 10 longer ones.
// ---------------------------------------------------------------------
const SUBJECT_CONFIG = {
    'mathematics': { time: '2 hours', sectionAMarks: 20, sectionACount: 20, sectionBMarks: 80, sectionBCount: 20, hasMcqSection: true },
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
// or whose only matching TOPICS entries were rejected by the grade filter.
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
 * minGrade is actually reachable for this paper's target grade.
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
    return null;
}

// ---------------------------------------------------------------------
// 5. SECTION BUILDERS
// ---------------------------------------------------------------------
function buildSectionA(records, rng, ctx, usedSignatures, count = 20) {
    const items = [];
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

function buildSectionB(records, rng, ctx, usedSignatures, count = 20) {
    const items = [];
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
// 6. LATEX BUILDER
//    Cover page rebuilt: watermark is now scoped to the title page only
//    (a low-opacity tikz overlay node inside \begin{titlepage}, not a
//    document-wide eso-pic background hook), spacing tightened to fit
//    one page, and instruction wording matches a real KNEC/KICD cover.
// ---------------------------------------------------------------------
function buildLatex(ctx, mcqs, sectionB) {
    let tex = '';
    tex += `\\documentclass[12pt,a4paper]{article}\n`;
    tex += `\\usepackage[utf8]{inputenc}\n`;
    tex += `\\usepackage{amsmath,amssymb,tikz,graphicx,multicol}\n`;
    tex += `\\usepackage{geometry}\n`;
    tex += `\\geometry{top=15mm, bottom=15mm, left=15mm, right=15mm}\n\n`;
    tex += `\\begin{document}\n\n`;

    const standardName = trackFor(ctx.gradeClean) === 'KPSEA'
        ? 'KENYA PRIMARY SCHOOL EDUCATION ASSESSMENT'
        : 'KENYA JUNIOR SCHOOL EDUCATION ASSESSMENT';

    tex += `\\begin{titlepage}\n\\centering\n`;
    // Watermark: scoped to THIS page only, drawn as a faint overlay node
    // rather than a document-wide background hook, so it never bleeds
    // onto content pages and never competes visually with the text.
    tex += `\\begin{tikzpicture}[remember picture, overlay]\n`;
    tex += `  \\node[opacity=0.05] at (current page.center) {\\includegraphics[width=9cm]{logo.png}};\n`;
    tex += `\\end{tikzpicture}\n\n`;

    tex += `\\vspace*{-5mm}\n`;
    tex += `\\begin{minipage}{0.16\\textwidth}\\centering\\includegraphics[width=2cm]{logo.png}\\end{minipage}\n`;
    tex += `\\begin{minipage}{0.68\\textwidth}\\centering\n`;
    tex += `{\\large \\textbf{REPUBLIC OF KENYA}} \\\\[0.15em]\n`;
    tex += `{\\normalsize \\textbf{MINISTRY OF EDUCATION}} \\\\[0.15em]\n`;
    tex += `{\\large \\textbf{${standardName}}} \\\\[0.2em]\n`;
    tex += `{\\normalsize \\textbf{ELEVATE KENYA PREDICTIONS -- ${ctx.gradeClean.toUpperCase()}}}\n\\end{minipage}\n`;
    tex += `\\begin{minipage}{0.16\\textwidth}\\centering\\includegraphics[width=2cm]{logo.png}\\end{minipage}\n`;
    tex += `\\vspace{0.6cm}\n{\\Large \\textbf{${ctx.subject.toUpperCase()}}}\\\\[0.3em]\n`;
    tex += `{\\large \\textbf{Paper 1 (${ctx.assessmentType})}}\\\\[0.5cm]\n`;
    tex += `{\\normalsize \\textbf{Time: ${ctx.subjectConfig.time}}}\\\\[0.7cm]\n`;
    tex += `\\begin{flushleft}\n`;
    tex += `\\textbf{Name of Learner:} \\rule{9.5cm}{0.4pt} \\\\[0.5cm]\n`;
    tex += `\\textbf{Assessment Number:} \\rule{8cm}{0.4pt} \\\\[0.5cm]\n`;
    tex += `\\textbf{Name of School:} \\rule{9cm}{0.4pt} \\\\[0.5cm]\n`;
    tex += `\\textbf{Candidate's Signature:} \\rule{8cm}{0.4pt} \\\\[0.5cm]\n`;
    tex += `\\textbf{Date:} \\rule{10cm}{0.4pt} \\\\[0.7cm]\n\\end{flushleft}\n`;
    tex += `\\noindent \\textbf{Instructions to Candidates:}\n\\begin{enumerate}[itemsep=1pt, topsep=2pt]\n`;
    tex += `    \\item Write your name and assessment number in the spaces provided above.\n`;
    tex += `    \\item Sign and write the date of the assessment in the spaces provided above.\n`;
    tex += `    \\item This paper consists of two sections: Section A (${ctx.subjectConfig.sectionAMarks} marks) and Section B (${ctx.subjectConfig.sectionBMarks} marks).\n`;
    tex += `    \\item Answer \\textbf{all} the questions in both sections in the spaces provided.\n`;
    tex += `    \\item All working must be clearly shown in the spaces provided.\n`;
    tex += `    \\item Mathematical tables and non-programmable electronic calculators may be used.\n`;
    tex += `    \\item Candidates should check the question paper to ascertain that all pages are printed and no questions are missing.\n`;
    tex += `\\end{enumerate}\n`;
    tex += `\\vfill\n{\\footnotesize \\textbf{PUBLISHED AND PRODUCED BY ELEVATE KENYA PREDICTIONS}}\n\\end{titlepage}\n\n`;

    if (ctx.subjectConfig.hasMcqSection && mcqs.length) {
        tex += `\\noindent \\textbf{\\large SECTION A (${ctx.subjectConfig.sectionAMarks} marks)}\\\\[0.2em]\n`;
        tex += `\\noindent \\textit{Answer all the questions in this section in the spaces provided.}\n\\hrule\\vspace{1em}\n\n`;
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
        tex += `    \\vspace{2.5cm}\n    {\\raggedleft \\textit{\\tiny Working Space} \\hrule}\\\\[1em]\n`;
    });
    tex += `\\end{enumerate}\n\n\\end{document}`;
    return tex;
}

// ---------------------------------------------------------------------
// 7. PUBLIC API
// ---------------------------------------------------------------------
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

async function generateBatch(supabase, { rawGrade, subject, assessmentType, count = 20 }) {
    const usedSignatures = new Set();
    const papers = [];
    for (let i = 0; i < count; i++) {
        const seed = Date.now() % 100000 + i * 7919;
        const paper = await generatePaper(supabase, {
            rawGrade, subject, assessmentType, seed, usedSignatures
        });
        papers.push({ index: i + 1, ...paper });
    }
    return papers;
}

export { generatePaper, generateBatch, normalizeGradeLabel, allowedGradesFor, checkCurriculumCoverage, DIAGRAMS };
