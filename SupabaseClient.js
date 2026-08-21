import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://jakdpkzswcxcspoyoqck.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impha2Rwa3pzd2N4Y3Nwb3lvcWNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NDA3MTQsImV4cCI6MjEwMjExNjcxNH0.jCnp-k_oZtHB0LveOZBbMvBSttu3ExoH9I_R5DjC0rc'

export const supabase = createClient(supabaseUrl, supabaseKey)
