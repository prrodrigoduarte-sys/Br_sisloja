import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://imjhixclzntgttibiajo.supabase.co';
const supabaseKey = 'COLE_AQUI_A_CHAVE_sb_publishable_INTEIRA';

export const supabase = createClient(supabaseUrl, supabaseKey);