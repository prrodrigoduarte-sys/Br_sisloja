// BR Sisloja - Cotação de preços
// Compara o preço de cada produto em várias empresas (no mínimo 4: A, B, C, D...) e monta a decisão:
// em qual empresa comprar cada produto, quanto se economiza e o pedido de cada empresa.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { buscarTodos } from './buscarTodos';

type Usuario = { id: string; email: string; nome: string; perfil: string; codigo_loja: string; loja_nome: string };
type Produto = { id: string; sku: string; nome: string; unidade: string; custo: number };
type Item = { produto_id: string | null; sku: string; descricao: string; unidade: string; quantidade: string; precos: string[]; custo_atual: number | null };
type Cotacao = { id?: string; nome: string; empresas: string[]; itens: Item[]; observacao: string; status: string; created_at?: string };

const MIN_EMPRESAS = 4;
const LETRAS = 'ABCDEFGHIJ';
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const brl2 = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
// aceita "1.234,56", "12,5" e "12.5"
const num = (s: string) => {
  const t = String(s ?? '').replace(/\s/g, '');
  const n = parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return isFinite(n) && n > 0 ? n : null;
};
const pct = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nova = (): Cotacao => ({
  nome: 'Cotação ' + new Date().toLocaleDateString('pt-BR'),
  empresas: Array.from({ length: MIN_EMPRESAS }, (_, i) => `Empresa ${LETRAS[i]}`),
  itens: [],
  observacao: '',
  status: 'aberta',
});

// análise de um item: menor preço, quem ganhou (empates entram todos), maior preço e economia
function analisar(it: Item) {
  const p = it.precos.map(num);
  const validos = p.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v != null);
  if (!validos.length) return null;
  const min = Math.min(...validos.map((x) => x.v));
  const max = Math.max(...validos.map((x) => x.v));
  const media = validos.reduce((s, x) => s + x.v, 0) / validos.length;
  const ganhadores = validos.filter((x) => x.v === min).map((x) => x.i);
  return { p, min, max, media, ganhadores, cotaram: validos.length, economiaPct: max > 0 ? ((max - min) / max) * 100 : 0 };
}

export default function CotacaoModule({ loggedUser }: { loggedUser: Usuario }) {
  const [lista, setLista] = useState<any[]>([]);
  const [atual, setAtual] = useState<Cotacao | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);

  const carregar = async () => {
    setCarregando(true);
    const { data, error } = await supabase.from('cotacoes').select('id, nome, empresas, itens, status, created_at').order('created_at', { ascending: false }).limit(200);
    setCarregando(false);
    if (error) {
      setErro(error.message.includes('cotacoes') ? 'Falta atualizar o banco: rode o arquivo fase11_cotacao.sql no SQL Editor do Supabase.' : 'Erro: ' + error.message);
      return;
    }
    setErro('');
    setLista(data || []);
  };

  useEffect(() => {
    carregar();
  }, []);

  const abrir = async (id: string) => {
    const { data, error } = await supabase.from('cotacoes').select('*').eq('id', id).single();
    if (error) return setErro(error.message);
    setAtual({
      id: data.id,
      nome: data.nome,
      empresas: data.empresas || [],
      observacao: data.observacao || '',
      status: data.status,
      created_at: data.created_at,
      itens: (data.itens || []).map((i: any) => ({
        ...i,
        quantidade: String(i.quantidade ?? 1).replace('.', ','),
        precos: (data.empresas || []).map((_: any, k: number) => (i.precos?.[k] != null ? String(i.precos[k]).replace('.', ',') : '')),
      })),
    });
  };

  if (atual)
    return (
      <Editor
        loggedUser={loggedUser}
        inicial={atual}
        aoFechar={() => {
          setAtual(null);
          carregar();
        }}
      />
    );

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-xl font-bold text-gray-800">💲 Cotação de preços</h2>
          <p className="text-xs text-gray-500">Compare o preço de cada produto em pelo menos 4 empresas e veja onde comprar cada um.</p>
        </div>
        <button onClick={() => setAtual(nova())} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          + Nova cotação
        </button>
      </div>
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      <div className="rounded-xl bg-white shadow-sm">
        {carregando ? (
          <p className="p-6 text-center text-sm text-gray-500">Carregando…</p>
        ) : !lista.length ? (
          <p className="p-6 text-center text-sm text-gray-500">Nenhuma cotação ainda. Clique em "+ Nova cotação".</p>
        ) : (
          <ul className="divide-y">
            {lista.map((c) => (
              <li key={c.id}>
                <button onClick={() => abrir(c.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-800">{c.nome}</p>
                    <p className="truncate text-xs text-gray-500">
                      {new Date(c.created_at).toLocaleDateString('pt-BR')} · {(c.itens || []).length} produto(s) · {(c.empresas || []).join(', ')}
                    </p>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${c.status === 'fechada' ? 'bg-gray-200 text-gray-600' : 'bg-blue-50 text-blue-800'}`}>
                    {c.status === 'fechada' ? 'Fechada' : 'Aberta'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Editor({ loggedUser, inicial, aoFechar }: { loggedUser: Usuario; inicial: Cotacao; aoFechar: () => void }) {
  const [c, setC] = useState<Cotacao>(inicial);
  const [alterado, setAlterado] = useState(!inicial.id);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [fornecedores, setFornecedores] = useState<string[]>([]);
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  useEffect(() => {
    buscarTodos(() => supabase.from('produtos').select('id, sku, nome, unidade, custo').eq('ativo', true).order('nome').order('id')).then((r) =>
      setProdutos(((r.data as any[]) || []).map((p) => ({ ...p, custo: Number(p.custo) || 0 })))
    );
    supabase
      .from('fornecedores')
      .select('nome, nome_fantasia')
      .eq('codigo_loja', loggedUser.codigo_loja)
      .order('nome')
      .then(({ data }) => setFornecedores(((data as any[]) || []).map((f) => f.nome_fantasia || f.nome)));
  }, [loggedUser.codigo_loja]);

  const mudar = (f: (x: Cotacao) => Cotacao) => {
    setC(f);
    setAlterado(true);
  };
  const mudarItem = (i: number, m: Partial<Item>) => mudar((x) => ({ ...x, itens: x.itens.map((it, k) => (k === i ? { ...it, ...m } : it)) }));
  const mudarPreco = (i: number, e: number, v: string) =>
    mudar((x) => ({ ...x, itens: x.itens.map((it, k) => (k === i ? { ...it, precos: it.precos.map((p, j) => (j === e ? v : p)) } : it)) }));

  const addEmpresa = () =>
    mudar((x) => ({ ...x, empresas: [...x.empresas, `Empresa ${LETRAS[x.empresas.length] || x.empresas.length + 1}`], itens: x.itens.map((it) => ({ ...it, precos: [...it.precos, ''] })) }));
  const tirarEmpresa = (e: number) => {
    if (c.empresas.length <= MIN_EMPRESAS) return;
    if (!window.confirm(`Tirar "${c.empresas[e]}" e os preços dela?`)) return;
    mudar((x) => ({ ...x, empresas: x.empresas.filter((_, j) => j !== e), itens: x.itens.map((it) => ({ ...it, precos: it.precos.filter((_, j) => j !== e) })) }));
  };

  const addItem = (p: Produto | null, texto?: string) => {
    if (p && c.itens.some((it) => it.produto_id === p.id)) {
      setMsg({ tipo: 'erro', texto: `"${p.nome}" já está na cotação.` });
      return;
    }
    mudar((x) => ({
      ...x,
      itens: [
        ...x.itens,
        {
          produto_id: p?.id || null,
          sku: p?.sku || '',
          descricao: p?.nome || (texto || '').trim(),
          unidade: p?.unidade || 'UN',
          quantidade: '1',
          precos: x.empresas.map(() => ''),
          custo_atual: p ? p.custo : null,
        },
      ],
    }));
    setBusca('');
    setMsg(null);
  };

  const sugestoes = useMemo(() => {
    const t = norm(busca).split(/\s+/).filter(Boolean);
    if (!t.length) return [];
    return produtos.filter((p) => t.every((w) => norm(p.nome + ' ' + p.sku).includes(w))).slice(0, 8);
  }, [busca, produtos]);

  // ---------- análise ----------
  const an = useMemo(() => {
    const n = c.empresas.length;
    const porEmpresa = c.empresas.map((nome) => ({ nome, ganhou: 0, cotou: 0, totalCotado: 0, itens: [] as { it: Item; preco: number; qtd: number }[], pedido: 0 }));
    let ideal = 0; // comprar cada item no mais barato
    let pior = 0; // comprar cada item no mais caro
    let semPreco = 0;
    const linhas = c.itens.map((it) => {
      const a = analisar(it);
      const qtd = num(it.quantidade) ?? 1;
      if (!a) {
        semPreco++;
        return { it, a, qtd };
      }
      ideal += a.min * qtd;
      pior += a.max * qtd;
      a.p.forEach((v, e) => {
        if (v != null && e < n) {
          porEmpresa[e].cotou++;
          porEmpresa[e].totalCotado += v * qtd;
        }
      });
      // o item vai para a 1ª empresa do empate (as outras aparecem como "empate")
      const g = a.ganhadores[0];
      a.ganhadores.forEach((e) => porEmpresa[e].ganhou++);
      porEmpresa[g].itens.push({ it, preco: a.min, qtd });
      porEmpresa[g].pedido += a.min * qtd;
      return { it, a, qtd };
    });
    const comPreco = c.itens.length - semPreco;
    // empresa que cotou tudo e sai mais barata comprando tudo nela
    const completas = porEmpresa.filter((e) => e.cotou === comPreco && comPreco > 0).sort((a, b) => a.totalCotado - b.totalCotado);
    return { linhas, porEmpresa, ideal: r2(ideal), pior: r2(pior), semPreco, comPreco, melhorUnica: completas[0] || null };
  }, [c]);

  const salvar = async (fechar = false) => {
    if (c.nome.trim().length < 2) return setMsg({ tipo: 'erro', texto: 'Dê um nome à cotação.' });
    if (c.empresas.length < MIN_EMPRESAS || c.empresas.some((e) => !e.trim())) return setMsg({ tipo: 'erro', texto: `Informe o nome das ${c.empresas.length} empresas.` });
    setSalvando(true);
    const dados = {
      nome: c.nome.trim(),
      empresas: c.empresas.map((e) => e.trim()),
      observacao: c.observacao || null,
      status: fechar ? 'fechada' : c.status,
      updated_at: new Date().toISOString(),
      itens: c.itens.map((it) => ({ ...it, quantidade: num(it.quantidade) ?? 1, precos: it.precos.map(num) })),
    };
    const r = c.id ? await supabase.from('cotacoes').update(dados).eq('id', c.id).select('id').single() : await supabase.from('cotacoes').insert(dados).select('id').single();
    setSalvando(false);
    if (r.error) return setMsg({ tipo: 'erro', texto: r.error.message.includes('cotacoes') ? 'Falta rodar o fase11_cotacao.sql no Supabase.' : r.error.message });
    setC((x) => ({ ...x, id: r.data.id, status: dados.status }));
    setAlterado(false);
    setMsg({ tipo: 'ok', texto: fechar ? 'Cotação fechada e salva.' : 'Cotação salva.' });
  };

  const excluir = async () => {
    if (!c.id) return aoFechar();
    if (!window.confirm(`Excluir a cotação "${c.nome}"?`)) return;
    const { error } = await supabase.from('cotacoes').delete().eq('id', c.id);
    if (error) return setMsg({ tipo: 'erro', texto: error.message });
    aoFechar();
  };

  const voltar = () => {
    if (alterado && !window.confirm('Há alterações não salvas. Sair mesmo assim?')) return;
    aoFechar();
  };

  const exportarCsv = () => {
    const sep = ';';
    const n = (x: number | null) => (x == null ? '' : String(x).replace('.', ','));
    const q = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const linhas = [
      ['Código', 'Produto', 'Qtd', 'Custo atual', ...c.empresas, 'Menor preço', 'Comprar em', 'Economia vs maior'].map(q).join(sep),
      ...an.linhas.map(({ it, a, qtd }) =>
        [
          it.sku,
          it.descricao,
          n(qtd),
          n(it.custo_atual),
          ...c.empresas.map((_, e) => n(num(it.precos[e]))),
          a ? n(a.min) : '',
          a ? a.ganhadores.map((g) => c.empresas[g]).join(' / ') : 'sem cotação',
          a ? n(r2((a.max - a.min) * qtd)) : '',
        ]
          .map(q)
          .join(sep)
      ),
    ];
    const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const el = document.createElement('a');
    el.href = URL.createObjectURL(blob);
    el.download = `${c.nome.replace(/[^\w-]+/g, '-')}.csv`;
    el.click();
    URL.revokeObjectURL(el.href);
  };

  const fechada = c.status === 'fechada';
  const campo = 'rounded border px-2 py-1 text-sm';

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      {/* cabeçalho */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-sm print:shadow-none">
        <button onClick={voltar} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 print:hidden">
          ← Cotações
        </button>
        <input value={c.nome} onChange={(e) => mudar((x) => ({ ...x, nome: e.target.value }))} className="min-w-[200px] flex-1 rounded-lg border px-3 py-1.5 font-bold text-gray-800" />
        {fechada && <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">Fechada</span>}
        <div className="flex gap-2 print:hidden">
          <button onClick={exportarCsv} disabled={!c.itens.length} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40">
            ⬇ Planilha
          </button>
          <button onClick={() => window.print()} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">
            🖨 Imprimir
          </button>
          <button onClick={excluir} className="rounded-lg px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
            Excluir
          </button>
          {!fechada && (
            <button onClick={() => salvar(true)} disabled={salvando} className="rounded-lg border border-gray-800 px-3 py-1.5 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40">
              Fechar cotação
            </button>
          )}
          <button onClick={() => salvar()} disabled={salvando || !alterado} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
            {salvando ? 'Salvando…' : alterado ? 'Salvar' : 'Salvo ✓'}
          </button>
        </div>
      </div>
      {msg && <p className={`rounded-lg p-3 text-sm ${msg.tipo === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{msg.texto}</p>}

      {/* empresas */}
      <div className="rounded-xl bg-white p-3 shadow-sm">
        <p className="mb-2 text-xs font-bold uppercase text-gray-500">Empresas cotadas (mínimo {MIN_EMPRESAS})</p>
        <div className="flex flex-wrap gap-2">
          {c.empresas.map((e, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-800 text-xs font-bold text-white">{LETRAS[i] || i + 1}</span>
              <input
                list="cot-fornecedores"
                value={e}
                onChange={(ev) => mudar((x) => ({ ...x, empresas: x.empresas.map((v, j) => (j === i ? ev.target.value : v)) }))}
                className={`${campo} w-44`}
              />
              {c.empresas.length > MIN_EMPRESAS && (
                <button onClick={() => tirarEmpresa(i)} className="px-1 text-red-500 print:hidden" aria-label="Tirar empresa">
                  ✕
                </button>
              )}
            </div>
          ))}
          {c.empresas.length < LETRAS.length && (
            <button onClick={addEmpresa} className="rounded-lg border border-dashed px-3 py-1 text-sm text-gray-600 hover:bg-gray-50 print:hidden">
              + Empresa
            </button>
          )}
        </div>
        <datalist id="cot-fornecedores">
          {fornecedores.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </div>

      {/* tabela de preços */}
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50 text-left text-[11px] uppercase text-gray-600">
            <tr>
              <th className="p-2">Produto</th>
              <th className="p-2 text-right">Qtd</th>
              <th className="p-2 text-right" title="Último custo de compra no cadastro">
                Custo atual
              </th>
              {c.empresas.map((e, i) => (
                <th key={i} className="p-2 text-right">
                  <span className="mr-1 rounded bg-gray-800 px-1 text-white">{LETRAS[i] || i + 1}</span>
                  <span className="normal-case">{e}</span>
                </th>
              ))}
              <th className="p-2">Comprar em</th>
              <th className="p-2 text-right">Economia</th>
              <th className="print:hidden" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {an.linhas.map(({ it, a, qtd }, i) => {
              const subiu = a && it.custo_atual ? ((a.min - it.custo_atual) / it.custo_atual) * 100 : null;
              return (
                <tr key={i}>
                  <td className="p-2">
                    <div className="font-medium text-gray-800">{it.descricao}</div>
                    <div className="text-[11px] text-gray-500">
                      {it.sku || 'sem cadastro'} · {it.unidade}
                    </div>
                  </td>
                  <td className="p-2 text-right">
                    <input value={it.quantidade} onChange={(e) => mudarItem(i, { quantidade: e.target.value })} inputMode="decimal" className={`${campo} w-16 text-right`} />
                  </td>
                  <td className="p-2 text-right whitespace-nowrap text-gray-600">{it.custo_atual ? brl(it.custo_atual) : '—'}</td>
                  {c.empresas.map((_, e) => {
                    const v = a?.p[e];
                    const melhor = a && v != null && v === a.min;
                    const maior = a && v != null && v === a.max && a.cotaram > 1 && a.max !== a.min;
                    return (
                      <td key={e} className="p-1.5 text-right">
                        <input
                          value={it.precos[e] ?? ''}
                          onChange={(ev) => mudarPreco(i, e, ev.target.value)}
                          inputMode="decimal"
                          placeholder="—"
                          aria-label={`Preço ${c.empresas[e]}`}
                          className={`w-24 rounded border px-2 py-1 text-right text-sm ${melhor ? 'border-green-600 bg-green-50 font-bold text-green-800' : maior ? 'border-red-200 bg-red-50 text-red-700' : ''}`}
                        />
                        {melhor && <div className="text-[10px] font-bold text-green-700">✓ menor</div>}
                      </td>
                    );
                  })}
                  <td className="p-2">
                    {a ? (
                      <>
                        <div className="font-bold text-green-800">
                          {a.ganhadores.map((g) => c.empresas[g]).join(' / ')}
                          {a.ganhadores.length > 1 && <span className="ml-1 text-[10px] font-normal text-gray-500">(empate)</span>}
                        </div>
                        <div className="text-[11px] text-gray-600">
                          {brl(a.min)} · total {brl2(r2(a.min * qtd))}
                          {subiu != null && Math.abs(subiu) >= 0.5 && (
                            <span className={subiu > 0 ? 'text-red-600' : 'text-green-700'}>
                              {' '}
                              · {subiu > 0 ? '▲' : '▼'} {pct(Math.abs(subiu))} vs custo atual
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">sem cotação</span>
                    )}
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">
                    {a && a.cotaram > 1 ? (
                      <>
                        <div className="font-semibold">{brl2(r2((a.max - a.min) * qtd))}</div>
                        <div className="text-[11px] text-gray-500">{pct(a.economiaPct)} vs maior</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="p-2 print:hidden">
                    <button onClick={() => mudar((x) => ({ ...x, itens: x.itens.filter((_, k) => k !== i) }))} className="text-red-500" aria-label="Tirar produto">
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* incluir produto */}
        <div className="relative border-t p-3 print:hidden">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (sugestoes[0]) addItem(sugestoes[0]);
                else if (busca.trim()) addItem(null, busca);
              }
            }}
            placeholder="+ Incluir produto: digite o nome ou código (Enter inclui)"
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />
          {busca.trim() && (
            <ul className="absolute left-3 right-3 z-20 mt-1 max-h-72 divide-y overflow-y-auto rounded-xl border bg-white shadow-xl">
              {sugestoes.map((p) => (
                <li key={p.id}>
                  <button onClick={() => addItem(p)} className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-blue-50">
                    <span className="truncate">
                      {p.nome} <span className="text-xs text-gray-500">· {p.sku}</span>
                    </span>
                    <span className="whitespace-nowrap text-xs text-gray-500">custo {brl(p.custo)}</span>
                  </button>
                </li>
              ))}
              <li>
                <button onClick={() => addItem(null, busca)} className="w-full px-3 py-2 text-left text-sm text-blue-800 hover:bg-blue-50">
                  + Incluir "{busca.trim()}" como produto sem cadastro
                </button>
              </li>
            </ul>
          )}
        </div>
      </div>

      {/* análise */}
      {an.comPreco > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Quadro titulo="Comprando cada item no mais barato" valor={brl2(an.ideal)} cor="text-green-700" sub={`${an.comPreco} produto(s) cotado(s)${an.semPreco ? ` · ${an.semPreco} sem preço` : ''}`} />
            <Quadro titulo="Se comprasse tudo no mais caro" valor={brl2(an.pior)} cor="text-red-700" />
            <Quadro titulo="Economia da cotação" valor={brl2(r2(an.pior - an.ideal))} cor="text-blue-800" sub={an.pior > 0 ? `${pct(((an.pior - an.ideal) / an.pior) * 100)} a menos` : ''} />
            <Quadro
              titulo="Melhor empresa única"
              valor={an.melhorUnica ? an.melhorUnica.nome : '—'}
              cor="text-gray-900"
              sub={
                an.melhorUnica
                  ? `tudo nela: ${brl2(r2(an.melhorUnica.totalCotado))} (+${brl2(r2(an.melhorUnica.totalCotado - an.ideal))} que dividindo)`
                  : 'nenhuma empresa cotou todos os itens'
              }
            />
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm">
            <h3 className="font-bold text-gray-800">Classificação das empresas</h3>
            <p className="mb-2 text-[11px] text-gray-500">Quantos produtos cada empresa tem com o menor preço, quantos cotou e quanto sairia comprar nela tudo o que ela cotou.</p>
            <table className="w-full text-sm">
              <thead className="border-b text-left text-[11px] uppercase text-gray-600">
                <tr>
                  <th className="p-2">#</th>
                  <th className="p-2">Empresa</th>
                  <th className="p-2 text-right">Menor preço em</th>
                  <th className="p-2 text-right">Cotou</th>
                  <th className="p-2 text-right">Total do que cotou</th>
                  <th className="p-2 text-right">Pedido nela</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[...an.porEmpresa]
                  .map((e, i) => ({ ...e, letra: LETRAS[i] || String(i + 1) }))
                  .sort((a, b) => b.ganhou - a.ganhou || a.totalCotado - b.totalCotado)
                  .map((e, pos) => (
                    <tr key={e.letra}>
                      <td className="p-2 font-bold text-gray-500">{pos + 1}º</td>
                      <td className="p-2 font-semibold">
                        <span className="mr-1 rounded bg-gray-800 px-1 text-xs text-white">{e.letra}</span>
                        {e.nome}
                      </td>
                      <td className="p-2 text-right">
                        <b>{e.ganhou}</b> produto(s)
                      </td>
                      <td className="p-2 text-right">
                        {e.cotou} de {an.comPreco}
                      </td>
                      <td className="p-2 text-right">{e.cotou ? brl2(r2(e.totalCotado)) : '—'}</td>
                      <td className="p-2 text-right font-semibold">{e.pedido ? brl2(r2(e.pedido)) : '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="mb-2 font-bold text-gray-800">🛒 Plano de compra: o que comprar em cada empresa</h3>
            <div className="grid gap-4 md:grid-cols-2">
              {an.porEmpresa
                .map((e, i) => ({ ...e, letra: LETRAS[i] || String(i + 1) }))
                .filter((e) => e.itens.length)
                .map((e) => (
                  <div key={e.letra} className="rounded-xl bg-white p-4 shadow-sm print:break-inside-avoid">
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <p className="font-bold text-gray-800">
                        <span className="mr-1 rounded bg-gray-800 px-1.5 text-xs text-white">{e.letra}</span>
                        Comprar em {e.nome}
                      </p>
                      <span className="text-sm font-black text-green-700">{brl2(r2(e.pedido))}</span>
                    </div>
                    <table className="w-full text-xs">
                      <tbody className="divide-y">
                        {e.itens.map(({ it, preco, qtd }, k) => (
                          <tr key={k}>
                            <td className="py-1 pr-2 text-gray-800">{it.descricao}</td>
                            <td className="py-1 pr-2 text-right whitespace-nowrap text-gray-600">
                              {qtd.toLocaleString('pt-BR')} × {brl(preco)}
                            </td>
                            <td className="py-1 text-right whitespace-nowrap font-semibold">{brl2(r2(preco * qtd))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
            </div>
            <p className="mt-2 text-[11px] text-gray-400">
              Em caso de empate, o item vai para a primeira empresa empatada (as outras aparecem como "empate" na tabela). Confira também prazo de
              entrega, frete e condição de pagamento antes de fechar.
            </p>
          </div>
        </>
      )}

      <label className="block rounded-xl bg-white p-3 text-sm text-gray-600 shadow-sm">
        Observações (prazo, frete, condição de pagamento de cada empresa…)
        <textarea value={c.observacao} onChange={(e) => mudar((x) => ({ ...x, observacao: e.target.value }))} rows={2} className="mt-1 w-full rounded-lg border px-3 py-2" />
      </label>
    </div>
  );
}

function Quadro({ titulo, valor, sub, cor }: { titulo: string; valor: string; sub?: string; cor: string }) {
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <div className="text-[11px] font-medium uppercase text-gray-500">{titulo}</div>
      <div className={`text-lg font-bold ${cor}`}>{valor}</div>
      {sub && <div className="text-[11px] text-gray-500">{sub}</div>}
    </div>
  );
}
