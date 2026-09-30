import { createClient } from '@supabase/supabase-js';

// Os dois valores ficam no arquivo .env (na raiz do projeto) e nas variáveis do Vercel:
//   VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY=eyJ...
// Pegue no Supabase: Project Settings > API (Project URL e a chave "anon public").
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseKey) {
  // eslint-disable-next-line no-console
  console.error('Faltam VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env');
}

export const supabase = createClient(supabaseUrl || 'http://localhost', supabaseKey || 'sem-chave');
