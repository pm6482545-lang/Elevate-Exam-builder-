import { supabase } from './SupabaseClient.js';
import { generatePaper, generateBatch, checkCurriculumCoverage } from './examGenerator.js';

function downloadText(filename, content) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

document.getElementById('fetchCurriculumBtn').addEventListener('click', async () => {
    const rawGrade = document.getElementById('gradeSelect').value;
    const subject = document.getElementById('subjectSelect').value;
    const assessmentType = document.getElementById('blueprintSelect').value;
    const outputArea = document.getElementById('outputArea');

    if (!rawGrade || !subject) {
        outputArea.innerHTML = `<span class="text-red-500 font-medium">Please select both a Grade and a Subject first.</span>`;
        return;
    }

    outputArea.innerHTML = `Querying Supabase curriculum designs for ${subject} — ${rawGrade} (${assessmentType}) and generating a fresh, curriculum-bound paper...`;

    try {
        const seed = Date.now() % 100000;
        const { latex, gradeClean, mcqCount, sectionBCount } = await generatePaper(supabase, {
            rawGrade, subject, assessmentType, seed
        });

        outputArea.innerHTML = `
            <p class="font-semibold text-green-700 mb-2">
                Generated a ${gradeClean} ${assessmentType} paper (${mcqCount} Section A questions, ${sectionBCount} Section B questions),
                built only from curriculum content at or below ${gradeClean}.
            </p>
            <div class="space-y-4">
                <textarea readonly class="w-full h-64 font-mono text-xs bg-slate-900 text-green-400 p-3 rounded-lg">${latex}</textarea>
                <button id="downloadSingleBtn" class="px-3 py-1.5 rounded bg-slate-700 text-white text-sm">Download .tex</button>
            </div>
        `;
        document.getElementById('downloadSingleBtn').addEventListener('click', () => {
            downloadText(`${gradeClean.replace(/\s+/g, '_')}_${assessmentType.replace(/\s+/g, '_')}.tex`, latex);
        });
    } catch (err) {
        console.error('Generation error:', err);
        outputArea.innerHTML = `<span class="text-red-600 font-medium">Error: ${err.message}</span>`;
    }
});

// Optional: wire this up to a "Check Curriculum Coverage" button
// (id="checkCoverageBtn") to see exactly what's in curriculum_designs —
// which subjects/grades/sub-strands actually have rows, and which
// subject+grade combinations are missing entirely.
const coverageBtn = document.getElementById('checkCoverageBtn');
if (coverageBtn) {
    coverageBtn.addEventListener('click', async () => {
        const outputArea = document.getElementById('outputArea');
        outputArea.innerHTML = 'Scanning curriculum_designs for full coverage...';
        try {
            const { totalRows, subjects, report, missing } = await checkCurriculumCoverage(supabase);
            let html = `<p class="font-semibold mb-2">${totalRows} total rows across ${subjects.length} subject(s).</p>`;
            html += `<table class="w-full text-xs border-collapse mb-4"><thead><tr class="text-left border-b">
                <th class="pr-4">Subject</th><th class="pr-4">Grade</th><th>Sub-strands</th></tr></thead><tbody>`;
            report.forEach(r => {
                html += `<tr class="border-b"><td class="pr-4">${r.subject}</td><td class="pr-4">${r.grade}${r.unrecognizedGradeLabel ? ' <span class="text-amber-600">(unrecognized label)</span>' : ''}</td><td>${r.subStrandCount}</td></tr>`;
            });
            html += `</tbody></table>`;
            if (missing.length) {
                html += `<p class="font-semibold text-red-600 mb-1">Missing subject/grade combinations (no rows at all):</p><ul class="text-xs list-disc pl-5">`;
                missing.forEach(m => { html += `<li>${m.subject} — ${m.grade}</li>`; });
                html += `</ul>`;
            } else {
                html += `<p class="text-green-700 text-sm">Every subject has rows for Grade 7, 8 and 9.</p>`;
            }
            outputArea.innerHTML = html;
        } catch (err) {
            console.error('Coverage check error:', err);
            outputArea.innerHTML = `<span class="text-red-600 font-medium">Error: ${err.message}</span>`;
        }
    });
}

// Optional: wire this up to a "Generate 20 Papers" button if you add one
// to the page (id="generateBatchBtn"). Produces `count` distinct papers,
// none sharing a generated question, all respecting grade boundaries.
const batchBtn = document.getElementById('generateBatchBtn');
if (batchBtn) {
    batchBtn.addEventListener('click', async () => {
        const rawGrade = document.getElementById('gradeSelect').value;
        const subject = document.getElementById('subjectSelect').value;
        const assessmentType = document.getElementById('blueprintSelect').value;
        const outputArea = document.getElementById('outputArea');

        if (!rawGrade || !subject) {
            outputArea.innerHTML = `<span class="text-red-500 font-medium">Please select both a Grade and a Subject first.</span>`;
            return;
        }

        outputArea.innerHTML = `Generating 20 distinct ${rawGrade} papers with no repeated questions across the set...`;

        try {
            const papers = await generateBatch(supabase, { rawGrade, subject, assessmentType, count: 20 });
            outputArea.innerHTML = `
                <p class="font-semibold text-green-700 mb-2">Generated ${papers.length} unique papers.</p>
                <div class="space-y-2" id="batchList"></div>
            `;
            const list = document.getElementById('batchList');
            papers.forEach(p => {
                const row = document.createElement('div');
                row.className = 'flex items-center justify-between bg-slate-100 px-3 py-2 rounded';
                row.innerHTML = `<span>Paper ${p.index} — ${p.gradeClean} (${p.mcqCount} MCQs, ${p.sectionBCount} Section B)</span>`;
                const btn = document.createElement('button');
                btn.className = 'px-2 py-1 text-xs rounded bg-slate-700 text-white';
                btn.textContent = 'Download';
                btn.addEventListener('click', () => downloadText(`paper_${p.index}.tex`, p.latex));
                row.appendChild(btn);
                list.appendChild(row);
            });
        } catch (err) {
            console.error('Batch generation error:', err);
            outputArea.innerHTML = `<span class="text-red-600 font-medium">Error: ${err.message}</span>`;
        }
    });
}
