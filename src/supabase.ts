import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://imjhixclzntgttibiajo.supabase.co';
const supabaseKey = 'sb_publishable_dX3JFcesfxuwZTuStD06Nw_obcQha1U';

export const supabase = createClient(supabaseUrl, supabaseKey);