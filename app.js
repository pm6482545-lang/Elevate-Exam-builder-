import { supabase } from './SupabaseClient.js'

document.getElementById('fetchCurriculumBtn').addEventListener('click', async () => {
    const grade = document.getElementById('gradeSelect').value;
    const subject = document.getElementById('subjectSelect').value;
    const outputArea = document.getElementById('outputArea');

    if (!grade || !subject) {
        outputArea.innerHTML = `<span class="text-red-500 font-medium">Please select both a Grade and a Subject first.</span>`;
        return;
    }

    outputArea.innerHTML = `Loading curriculum data from Supabase for ${grade} - ${subject}...`;

    try {
        // Query your Supabase curriculum_designs table
        // Based on your database columns: grade_level, learning_area, strand_name, sub_strand_name
        const { data, error } = await supabase
            .from('curriculum_designs')
            .select('strand_name, sub_strand_name, strand')
            .eq('grade_level', grade)
            .eq('learning_area', subject);

        if (error) {
            throw error;
        }

        if (!data || data.length === 0) {
            outputArea.innerHTML = `<span class="text-amber-600 font-medium">No curriculum records found for ${grade} ${subject}. Check your database filters or table column names.</span>`;
            return;
        }

        // Format and display the results cleanly
        let html = `<p class="font-semibold text-slate-800 mb-2">Found ${data.length} curriculum entries:</p>`;
        html += `<ul class="list-disc pl-5 space-y-1 max-h-60 overflow-y-auto">`;
        
        data.forEach((item) => {
            html += `<li><strong class="text-slate-700">${item.strand_name || 'Strand'}</strong>: ${item.sub_strand_name || JSON.stringify(item.strand || 'N/A')}</li>`;
        });
        
        html += `</ul>`;
        outputArea.innerHTML = html;

    } catch (err) {
        console.error('Error fetching curriculum:', err);
        outputArea.innerHTML = `<span class="text-red-600 font-medium">Error loading data: ${err.message}</span>`;
    }
});
