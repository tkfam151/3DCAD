// Supabase project used for sign-in and cloud saving.
// These two values are PUBLIC by design (they ship inside the app); your data is
// protected by the row level security rules in supabase/migrations/.
// Never put the database password or the service_role key here.
//
// They can also be set at build time with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
export const SUPABASE_URL = 'https://lfplpizvmcgvvvvpgomv.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_NZO6rqn_UsYFTJgYJOGmPA_Eh2nr-do';
