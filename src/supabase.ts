import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://o-seu-projeto.supabase.co';
const supabaseKey = 'a-sua-chave-anon-aqui';

export const supabase = createClient(supabaseUrl, supabaseKey);
