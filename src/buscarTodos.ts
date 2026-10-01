// O Supabase devolve no máximo 1.000 linhas por consulta.
// buscarTodos repete a consulta de 1.000 em 1.000 até trazer tudo (produtos, saldos, preços...).
// Uso: buscarTodos(() => supabase.from('produtos').select('*').order('nome'))
export async function buscarTodos<T = any>(montar: () => any, tamanho = 1000): Promise<{ data: T[]; error: any }> {
    const todos: T[] = [];
    for (let de = 0; ; de += tamanho) {
      const { data, error } = await montar().range(de, de + tamanho - 1);
      if (error) return { data: todos, error };
      const lote = (data as T[]) || [];
      todos.push(...lote);
      if (lote.length < tamanho) break;
    }
    return { data: todos, error: null };
  }