// BR Sisloja - Relatórios
// Estoque valorizado: quantidade × preço de custo e quantidade × preço de venda, por produto, com totais.
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { buscarTodos } from './buscarTodos';

type Usuario = { id: string; email: string; nome: string; perfil: string; codigo_loja: string; loja_nome: string };

type Rel = 'estoque' | 'vendas';
const RELATORIOS: { id: Rel; rotulo: string }[] = [
  { id: 'estoque', rotulo: '📦 Estoque valorizado' },
  { id: 'vendas', rotulo: '🧑‍💼 Vendas por usuário' },
];

export default function RelatoriosModule({ loggedUser }: { loggedUser: Usuario }) {
  const [rel, setRel] = useState<Rel>('estoque');
  return (
    <div className="mx-auto max-w-7xl p-3 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <h2 className="mr-auto text-xl font-bold text-gray-800">📊 Relatórios</h2>
        {RELATORIOS.map((r) => (
          <button
            key={r.id}
            onClick={() => setRel(r.id)}
            className={`rounded-lg px-3 py-2 text-sm ${rel === r.id ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            {r.rotulo}
          </button>
        ))}
      </div>
      {rel === 'estoque' && (
        <ComSenha>
          <EstoqueValorizado loggedUser={loggedUser} />
        </ComSenha>
      )}
      {rel === 'vendas' && <VendasPorUsuario loggedUser={loggedUser} />}
    </div>
  );
}

// =====================================================================
// SENHA SIMPLES para abrir o relatório (tranca de novo ao sair da aba)
// =====================================================================
const SENHA_ESTOQUE = '1234';

function ComSenha({ children }: { children: React.ReactNode }) {
  const [liberado, setLiberado] = useState(false);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState(false);

  if (liberado) return <>{children}</>;

  const entrar = (e: React.FormEvent) => {
    e.preventDefault();
    if (senha === SENHA_ESTOQUE) {
      setLiberado(true);
      return;
    }
    setErro(true);
    setSenha('');
  };

  return (
    <form onSubmit={entrar} className="mx-auto max-w-xs space-y-3 rounded-xl bg-white p-6 text-center text-sm shadow-sm">
      <div className="text-3xl">🔒</div>
      <p className="font-bold text-gray-800">Estoque valorizado</p>
      <p className="text-gray-500">Digite a senha para abrir.</p>
      <input
        type="password"
        inputMode="numeric"
        autoFocus
        autoComplete="off"
        maxLength={10}
        value={senha}
        onChange={(e) => {
          setSenha(e.target.value);
          setErro(false);
        }}
        className="w-full rounded-lg border px-3 py-2 text-center text-lg tracking-widest"
        placeholder="••••"
      />
      {erro && <p className="text-red-600">Senha incorreta.</p>}
      <button type="submit" disabled={!senha} className="w-full rounded-lg bg-gray-800 py-2 font-semibold text-white disabled:opacity-40">
        Abrir
      </button>
    </form>
  );
}

// =====================================================================
// ESTOQUE VALORIZADO
// =====================================================================
type Linha = {
  id: string;
  sku: string;
  codigo_barras: string | null;
  nome: string;
  unidade: string;
  grupo: string;
  ativo: boolean;
  qtd: number;
  custo: number;
  preco: number;
  total_custo: number;
  total_venda: number;
  lucro: number;
  margem: number | null; // % sobre o custo
};

type Ordem = 'nome' | 'qtd' | 'total_custo' | 'total_venda' | 'lucro' | 'margem';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qtdFmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const pctFmt = (n: number | null) => (n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%');
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const TIPOS = [
  { id: 'fisico', rotulo: 'Físico' },
  { id: 'administrativo', rotulo: 'Administrativo' },
  { id: 'fiscal', rotulo: 'Fiscal' },
];

function EstoqueValorizado({ loggedUser }: { loggedUser: Usuario }) {
  const [produtos, setProdutos] = useState<any[]>([]);
  const [saldos, setSaldos] = useState<Record<string, Record<string, number>>>({});
  const [tabelas, setTabelas] = useState<{ id: string; nome: string }[]>([]);
  const [precosTab, setPrecosTab] = useState<Record<string, number>>({}); // `${tabela}|${produto}`
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const [tipo, setTipo] = useState('fisico');
  const [tabela, setTabela] = useState('padrao');
  const [grupo, setGrupo] = useState('');
  const [busca, setBusca] = useState('');
  const [mostrar, setMostrar] = useState<'com' | 'todos' | 'negativos'>('com');
  const [inativos, setInativos] = useState(false);
  const [porGrupo, setPorGrupo] = useState(false);
  const [ordem, setOrdem] = useState<Ordem>('nome');
  const [desc, setDesc] = useState(false);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      const [p, s, t, pp] = await Promise.all([
        buscarTodos(() =>
          supabase
            .from('produtos')
            .select('id, sku, codigo_barras, nome, unidade, grupo, custo, preco_venda, ativo, nao_listar_estoque')
            .eq('codigo_loja', loggedUser.codigo_loja)
            .order('id')
        ),
        buscarTodos(() => supabase.from('estoque_saldos').select('produto_id, tipo, saldo').eq('codigo_loja', loggedUser.codigo_loja).order('produto_id').order('tipo')),
        supabase.from('tabelas_preco').select('id, nome').order('nome'),
        buscarTodos(() => supabase.from('precos_produto').select('tabela_id, produto_id, preco').order('produto_id').order('tabela_id')),
      ]);
      if (p.error || s.error) setErro('Erro ao carregar: ' + (p.error || s.error)!.message);
      setProdutos(p.data || []);
      const mapa: Record<string, Record<string, number>> = {};
      (s.data || []).forEach((x: any) => ((mapa[x.produto_id] ||= {})[x.tipo] = Number(x.saldo) || 0));
      setSaldos(mapa);
      setTabelas(t.data || []);
      const pt: Record<string, number> = {};
      (pp.data || []).forEach((x: any) => (pt[`${x.tabela_id}|${x.produto_id}`] = Number(x.preco) || 0));
      setPrecosTab(pt);
      setCarregando(false);
    })();
  }, [loggedUser.codigo_loja]);

  const grupos = useMemo(() => Array.from(new Set(produtos.filter((p) => !p.nao_listar_estoque).map((p) => p.grupo || '').filter(Boolean))).sort(), [produtos]);

  const linhas: Linha[] = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const lista = produtos
      .filter((p) => !p.nao_listar_estoque) // item não circulante: fora da lista e dos cálculos
      .filter((p) => inativos || p.ativo)
      .filter((p) => !grupo || (p.grupo || '') === grupo)
      .filter((p) => !q || p.nome.toLowerCase().includes(q) || String(p.sku).toLowerCase().includes(q) || (p.codigo_barras || '').includes(q))
      .map((p) => {
        const qtd = saldos[p.id]?.[tipo] || 0;
        const custo = Number(p.custo) || 0;
        const preco = tabela === 'padrao' ? Number(p.preco_venda) || 0 : precosTab[`${tabela}|${p.id}`] ?? (Number(p.preco_venda) || 0);
        const total_custo = r2(qtd * custo);
        const total_venda = r2(qtd * preco);
        return {
          id: p.id,
          sku: p.sku,
          codigo_barras: p.codigo_barras,
          nome: p.nome,
          unidade: p.unidade,
          grupo: p.grupo || '',
          ativo: p.ativo,
          qtd,
          custo,
          preco,
          total_custo,
          total_venda,
          lucro: r2(total_venda - total_custo),
          margem: custo > 0 ? r2((preco / custo - 1) * 100) : null,
        };
      })
      .filter((l) => (mostrar === 'todos' ? true : mostrar === 'negativos' ? l.qtd < 0 : l.qtd > 0));
    const fator = desc ? -1 : 1;
    return lista.sort((a, b) => {
      if (ordem === 'nome') return a.nome.localeCompare(b.nome) * fator;
      return (((a[ordem] ?? -Infinity) as number) - ((b[ordem] ?? -Infinity) as number)) * fator;
    });
  }, [produtos, saldos, precosTab, tipo, tabela, grupo, busca, mostrar, inativos, ordem, desc]);

  const totais = useMemo(() => soma(linhas), [linhas]);

  const blocos = useMemo(() => {
    if (!porGrupo) return [{ grupo: '', linhas }];
    const m = new Map<string, Linha[]>();
    linhas.forEach((l) => {
      const g = l.grupo || 'SEM GRUPO';
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(l);
    });
    return Array.from(m.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([g, ls]) => ({ grupo: g, linhas: ls }));
  }, [linhas, porGrupo]);

  const ordenar = (o: Ordem) => {
    if (ordem === o) setDesc(!desc);
    else {
      setOrdem(o);
      setDesc(o !== 'nome');
    }
  };

  const nomeTabela = tabela === 'padrao' ? 'Preço padrão' : tabelas.find((t) => t.id === tabela)?.nome || '';
  const nomeTipo = TIPOS.find((t) => t.id === tipo)?.rotulo || '';

  const exportarCsv = () => {
    const sep = ';';
    const n = (v: number) => String(v).replace('.', ',');
    const cab = ['Código', 'Código de barras', 'Produto', 'Grupo', 'Unidade', 'Quantidade', 'Custo unit.', 'Total custo', 'Preço venda', 'Total venda', 'Lucro bruto', 'Margem %'];
    const corpo = linhas.map((l) =>
      [l.sku, l.codigo_barras || '', l.nome, l.grupo, l.unidade, n(l.qtd), n(l.custo), n(l.total_custo), n(l.preco), n(l.total_venda), n(l.lucro), l.margem == null ? '' : n(l.margem)]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(sep)
    );
    const total = ['', '', 'TOTAL', '', '', n(totais.qtd), '', n(totais.custo), '', n(totais.venda), n(totais.lucro), totais.margem == null ? '' : n(totais.margem)].join(sep);
    const blob = new Blob(['﻿' + [cab.join(sep), ...corpo, total].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `estoque-valorizado-${new Date().toLocaleDateString('sv-SE')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const Th = ({ o, children, direita }: { o?: Ordem; children: React.ReactNode; direita?: boolean }) => (
    <th
      onClick={o ? () => ordenar(o) : undefined}
      className={`p-2 ${direita ? 'text-right' : ''} ${o ? 'cursor-pointer select-none hover:text-gray-900' : ''} whitespace-nowrap`}
    >
      {children}
      {o && ordem === o ? (desc ? ' ▼' : ' ▲') : ''}
    </th>
  );

  return (
    <div className="space-y-3">
      {/* filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 text-sm shadow-sm print:hidden">
        <label className="flex items-center gap-1">
          Estoque
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded border px-2 py-1">
            {TIPOS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Preço de venda
          <select value={tabela} onChange={(e) => setTabela(e.target.value)} className="rounded border px-2 py-1">
            <option value="padrao">Preço padrão</option>
            {tabelas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        </label>
        <select value={grupo} onChange={(e) => setGrupo(e.target.value)} className="rounded border px-2 py-1">
          <option value="">Todos os grupos</option>
          {grupos.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select value={mostrar} onChange={(e) => setMostrar(e.target.value as any)} className="rounded border px-2 py-1">
          <option value="com">Só com estoque</option>
          <option value="todos">Todos os produtos</option>
          <option value="negativos">Só estoque negativo</option>
        </select>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={porGrupo} onChange={(e) => setPorGrupo(e.target.checked)} /> agrupar por grupo
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> inativos
        </label>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto ou código" className="min-w-[160px] flex-1 rounded-lg border px-3 py-1" />
        <button onClick={exportarCsv} disabled={!linhas.length} className="rounded-lg border px-3 py-1 hover:bg-gray-50 disabled:opacity-40">
          ⬇ Excel (CSV)
        </button>
        <button onClick={() => window.print()} className="rounded-lg border px-3 py-1 hover:bg-gray-50">
          🖨 Imprimir
        </button>
      </div>

      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      {/* cabeçalho do relatório (aparece também na impressão) */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold text-gray-800">Estoque valorizado</h3>
            <p className="text-xs text-gray-500">
              {loggedUser.loja_nome} · estoque {nomeTipo} · venda pela tabela {nomeTabela}
              {grupo && ` · grupo ${grupo}`} · {new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Quadro titulo="Produtos" valor={String(linhas.length)} />
          <Quadro titulo="Quantidade total" valor={qtdFmt(totais.qtd)} />
          <Quadro titulo="Qtd × preço de custo" valor={brl(totais.custo)} destaque="text-gray-900" />
          <Quadro titulo="Qtd × preço de venda" valor={brl(totais.venda)} destaque="text-blue-800" />
          <Quadro
            titulo="Lucro bruto potencial"
            valor={brl(totais.lucro)}
            sub={totais.margem == null ? '' : `margem média ${pctFmt(totais.margem)} sobre o custo`}
            destaque={totais.lucro >= 0 ? 'text-green-700' : 'text-red-700'}
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        {carregando ? (
          <p className="p-6 text-center text-sm text-gray-500">Carregando…</p>
        ) : !linhas.length ? (
          <p className="p-6 text-center text-sm text-gray-500">Nenhum produto com esses filtros.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-[11px] uppercase text-gray-600">
              <tr>
                <th className="p-2">Código</th>
                <Th o="nome">Produto</Th>
                <Th o="qtd" direita>
                  Qtd
                </Th>
                <th className="p-2 text-right whitespace-nowrap">Custo unit.</th>
                <Th o="total_custo" direita>
                  Qtd × custo
                </Th>
                <th className="p-2 text-right whitespace-nowrap">Preço venda</th>
                <Th o="total_venda" direita>
                  Qtd × venda
                </Th>
                <Th o="lucro" direita>
                  Lucro bruto
                </Th>
                <Th o="margem" direita>
                  Margem
                </Th>
              </tr>
            </thead>
            {blocos.map((b) => {
              const st = soma(b.linhas);
              return (
                <tbody key={b.grupo || 'todos'} className="divide-y">
                  {porGrupo && (
                    <tr className="bg-gray-100">
                      <td colSpan={9} className="p-2 text-xs font-bold uppercase text-gray-700">
                        {b.grupo}
                      </td>
                    </tr>
                  )}
                  {b.linhas.map((l) => (
                    <tr key={l.id} className={l.ativo ? '' : 'opacity-50'}>
                      <td className="p-2 text-xs text-gray-500 whitespace-nowrap">{l.sku}</td>
                      <td className="p-2">
                        <div className="font-medium text-gray-800">{l.nome}</div>
                        {!porGrupo && l.grupo && <div className="text-[10px] text-gray-400">{l.grupo}</div>}
                      </td>
                      <td className={`p-2 text-right whitespace-nowrap ${l.qtd < 0 ? 'font-bold text-red-600' : ''}`}>
                        {qtdFmt(l.qtd)} <span className="text-[10px] text-gray-400">{l.unidade}</span>
                      </td>
                      <td className={`p-2 text-right whitespace-nowrap ${!l.custo ? 'text-amber-600' : 'text-gray-600'}`} title={!l.custo ? 'Produto sem custo' : ''}>
                        {brl(l.custo)}
                      </td>
                      <td className="p-2 text-right font-semibold whitespace-nowrap">{brl(l.total_custo)}</td>
                      <td className="p-2 text-right text-gray-600 whitespace-nowrap">{brl(l.preco)}</td>
                      <td className="p-2 text-right font-semibold text-blue-800 whitespace-nowrap">{brl(l.total_venda)}</td>
                      <td className={`p-2 text-right whitespace-nowrap ${l.lucro < 0 ? 'text-red-600' : 'text-green-700'}`}>{brl(l.lucro)}</td>
                      <td className={`p-2 text-right whitespace-nowrap ${l.margem != null && l.margem < 0 ? 'text-red-600' : ''}`}>{pctFmt(l.margem)}</td>
                    </tr>
                  ))}
                  {porGrupo && (
                    <tr className="bg-gray-50 text-xs font-bold">
                      <td colSpan={2} className="p-2 text-right">
                        Subtotal {b.grupo}
                      </td>
                      <td className="p-2 text-right">{qtdFmt(st.qtd)}</td>
                      <td />
                      <td className="p-2 text-right">{brl(st.custo)}</td>
                      <td />
                      <td className="p-2 text-right text-blue-800">{brl(st.venda)}</td>
                      <td className="p-2 text-right">{brl(st.lucro)}</td>
                      <td className="p-2 text-right">{pctFmt(st.margem)}</td>
                    </tr>
                  )}
                </tbody>
              );
            })}
            <tfoot className="border-t-2 bg-gray-100 text-sm font-bold">
              <tr>
                <td colSpan={2} className="p-2 text-right">
                  TOTAL GERAL
                </td>
                <td className="p-2 text-right">{qtdFmt(totais.qtd)}</td>
                <td />
                <td className="p-2 text-right">{brl(totais.custo)}</td>
                <td />
                <td className="p-2 text-right text-blue-800">{brl(totais.venda)}</td>
                <td className="p-2 text-right">{brl(totais.lucro)}</td>
                <td className="p-2 text-right">{pctFmt(totais.margem)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      <p className="text-[11px] text-gray-400 print:hidden">
        Custo = custo atual do cadastro (última entrada, com frete, IPI e ST). Lucro bruto potencial = quanto renderia vender todo o estoque pelo preço
        escolhido, sem impostos de venda. Itens marcados como "Não listar no estoque" (não circulantes) ficam fora. Clique no título das colunas para ordenar.
      </p>
    </div>
  );
}

// =====================================================================
// VENDAS POR USUÁRIO (quem vendeu)
// =====================================================================
const FORMAS: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'Pix', cartao_debito: 'Débito', cartao_credito: 'Crédito' };

function VendasPorUsuario({ loggedUser }: { loggedUser: Usuario }) {
  const [de, setDe] = useState(() => new Date().toLocaleDateString('sv-SE').slice(0, 8) + '01');
  const [ate, setAte] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const [vendas, setVendas] = useState<any[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      setErro('');
      const [v, n] = await Promise.all([
        buscarTodos(() =>
          supabase
            .from('vendas')
            .select('id, numero, total, desconto, forma_pagamento, parcelas, taxa_cartao_valor, custo_total, operador, status, created_by, created_at')
            .eq('codigo_loja', loggedUser.codigo_loja)
            .gte('created_at', new Date(de + 'T00:00:00').toISOString())
            .lte('created_at', new Date(ate + 'T23:59:59.999').toISOString())
            .order('created_at')
            .order('id')
        ),
        supabase.rpc('nomes_usuarios'),
      ]);
      if (v.error)
        setErro(
          v.error.message.includes('taxa_cartao') || v.error.message.includes('custo_total')
            ? 'Falta atualizar o banco: rode o arquivo fase6_taxas_cartao.sql no SQL Editor do Supabase.'
            : 'Erro ao carregar as vendas: ' + v.error.message
        );
      setVendas(v.data || []);
      const m: Record<string, string> = {};
      ((n.data as any[]) || []).forEach((x) => (m[x.user_id] = x.nome));
      setNomes(m);
      setCarregando(false);
    })();
  }, [loggedUser.codigo_loja, de, ate]);

  const cancelada = (v: any) => String(v.status || '').toLowerCase().startsWith('cancel');

  const grupos = useMemo(() => {
    const mapa = new Map<string, { chave: string; nome: string; vendas: any[]; canceladas: number }>();
    for (const v of vendas) {
      const chave = v.created_by || 'op:' + (v.operador || '—');
      const nome = (v.created_by && nomes[v.created_by]) || v.operador || 'Sem identificação';
      if (!mapa.has(chave)) mapa.set(chave, { chave, nome, vendas: [], canceladas: 0 });
      const g = mapa.get(chave)!;
      if (cancelada(v)) g.canceladas++;
      else g.vendas.push(v);
    }
    return Array.from(mapa.values())
      .map((g) => {
        const total = r2(g.vendas.reduce((s, v) => s + Number(v.total || 0), 0));
        const desconto = r2(g.vendas.reduce((s, v) => s + Number(v.desconto || 0), 0));
        const taxa = r2(g.vendas.reduce((s, v) => s + Number(v.taxa_cartao_valor || 0), 0));
        const lucro = r2(g.vendas.reduce((s, v) => s + lucroVenda(v), 0));
        const porForma: Record<string, number> = {};
        g.vendas.forEach((v) => (porForma[v.forma_pagamento || 'outros'] = r2((porForma[v.forma_pagamento || 'outros'] || 0) + Number(v.total || 0))));
        return { ...g, total, desconto, taxa, lucro, porForma, ticket: g.vendas.length ? r2(total / g.vendas.length) : 0 };
      })
      .sort((a, b) => b.total - a.total);
  }, [vendas, nomes]);

  const geral = useMemo(() => {
    const total = r2(grupos.reduce((s, g) => s + g.total, 0));
    const qtd = grupos.reduce((s, g) => s + g.vendas.length, 0);
    const taxa = r2(grupos.reduce((s, g) => s + g.taxa, 0));
    const lucro = r2(grupos.reduce((s, g) => s + g.lucro, 0));
    return { total, qtd, taxa, lucro, ticket: qtd ? r2(total / qtd) : 0, canceladas: grupos.reduce((s, g) => s + g.canceladas, 0) };
  }, [grupos]);

  const formas = Array.from(new Set(grupos.flatMap((g) => Object.keys(g.porForma))));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 text-sm shadow-sm print:hidden">
        de <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded border px-2 py-1" />
        até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded border px-2 py-1" />
        <div className="flex-1" />
        <button onClick={() => window.print()} className="rounded-lg border px-3 py-1 hover:bg-gray-50">
          🖨 Imprimir
        </button>
      </div>
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h3 className="text-lg font-bold text-gray-800">Vendas por usuário</h3>
        <p className="mb-3 text-xs text-gray-500">
          {loggedUser.loja_nome} · {de.split('-').reverse().join('/')} a {ate.split('-').reverse().join('/')}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Quadro titulo="Vendas" valor={String(geral.qtd)} />
          <Quadro titulo="Total vendido" valor={brl(geral.total)} destaque="text-blue-800" />
          <Quadro titulo="Ticket médio" valor={brl(geral.ticket)} />
          <Quadro titulo="Taxas de cartão" valor={brl(geral.taxa)} destaque={geral.taxa ? 'text-red-700' : undefined} />
          <Quadro
            titulo="Lucro real"
            valor={brl(geral.lucro)}
            sub={geral.total > 0 ? `${pctFmt(r2((geral.lucro / geral.total) * 100))} do vendido` : ''}
            destaque={geral.lucro >= 0 ? 'text-green-700' : 'text-red-700'}
          />
          <Quadro titulo="Canceladas" valor={String(geral.canceladas)} destaque={geral.canceladas ? 'text-red-700' : undefined} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        {carregando ? (
          <p className="p-6 text-center text-sm text-gray-500">Carregando…</p>
        ) : !grupos.length ? (
          <p className="p-6 text-center text-sm text-gray-500">Nenhuma venda no período.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-[11px] uppercase text-gray-600">
              <tr>
                <th className="p-2">Usuário</th>
                <th className="p-2 text-right">Vendas</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-right">Ticket médio</th>
                <th className="p-2 text-right">Descontos</th>
                <th className="p-2 text-right">Taxas cartão</th>
                <th className="p-2 text-right" title="Venda − custo − taxa do cartão">
                  Lucro real
                </th>
                {formas.map((f) => (
                  <th key={f} className="p-2 text-right">
                    {FORMAS[f] || f}
                  </th>
                ))}
                <th className="p-2 text-right">Canceladas</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {grupos.map((g) => (
                <React.Fragment key={g.chave}>
                  <tr onClick={() => setAberto(aberto === g.chave ? null : g.chave)} className="cursor-pointer hover:bg-gray-50">
                    <td className="p-2 font-medium text-gray-800">
                      {aberto === g.chave ? '▾' : '▸'} {g.nome}
                    </td>
                    <td className="p-2 text-right">{g.vendas.length}</td>
                    <td className="p-2 text-right font-semibold text-blue-800">{brl(g.total)}</td>
                    <td className="p-2 text-right">{brl(g.ticket)}</td>
                    <td className="p-2 text-right text-gray-600">{brl(g.desconto)}</td>
                    <td className="p-2 text-right text-red-700">{g.taxa ? brl(g.taxa) : '—'}</td>
                    <td className={`p-2 text-right font-semibold ${g.lucro < 0 ? 'text-red-600' : 'text-green-700'}`}>{brl(g.lucro)}</td>
                    {formas.map((f) => (
                      <td key={f} className="p-2 text-right text-gray-600">
                        {g.porForma[f] ? brl(g.porForma[f]) : '—'}
                      </td>
                    ))}
                    <td className={`p-2 text-right ${g.canceladas ? 'font-bold text-red-600' : 'text-gray-400'}`}>{g.canceladas}</td>
                  </tr>
                  {aberto === g.chave &&
                    g.vendas.map((v) => (
                      <tr key={v.id} className="bg-gray-50 text-xs text-gray-600">
                        <td className="p-1 pl-8">
                          Venda nº {v.numero} · {new Date(v.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td />
                        <td className="p-1 text-right">{brl(Number(v.total))}</td>
                        <td />
                        <td className="p-1 text-right">{Number(v.desconto) ? brl(Number(v.desconto)) : ''}</td>
                        <td className="p-1 text-right text-red-700">{Number(v.taxa_cartao_valor) ? brl(Number(v.taxa_cartao_valor)) : ''}</td>
                        <td className="p-1 text-right">{brl(lucroVenda(v))}</td>
                        <td colSpan={formas.length + 1} className="p-1">
                          {FORMAS[v.forma_pagamento] || v.forma_pagamento}
                          {v.forma_pagamento === 'cartao_credito' && Number(v.parcelas) > 1 ? ` ${v.parcelas}x` : ''}
                        </td>
                      </tr>
                    ))}
                </React.Fragment>
              ))}
            </tbody>
            <tfoot className="border-t-2 bg-gray-100 font-bold">
              <tr>
                <td className="p-2 text-right">TOTAL</td>
                <td className="p-2 text-right">{geral.qtd}</td>
                <td className="p-2 text-right text-blue-800">{brl(geral.total)}</td>
                <td className="p-2 text-right">{brl(geral.ticket)}</td>
                <td className="p-2 text-right">{brl(r2(grupos.reduce((s, g) => s + g.desconto, 0)))}</td>
                <td className="p-2 text-right text-red-700">{brl(geral.taxa)}</td>
                <td className="p-2 text-right text-green-700">{brl(geral.lucro)}</td>
                {formas.map((f) => (
                  <td key={f} className="p-2 text-right">
                    {brl(r2(grupos.reduce((s, g) => s + (g.porForma[f] || 0), 0)))}
                  </td>
                ))}
                <td className="p-2 text-right">{geral.canceladas}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      <p className="text-[11px] text-gray-400 print:hidden">
        Clique no nome do usuário para ver as vendas dele. Vendas canceladas não entram nos totais. Lucro real = venda − custo dos produtos − taxa
        do cartão (taxas em Configurações → Taxas de cartão).
      </p>
    </div>
  );
}

// lucro real da venda: total − custo dos produtos − taxa do cartão
const lucroVenda = (v: any) => r2(Number(v.total || 0) - Number(v.custo_total || 0) - Number(v.taxa_cartao_valor || 0));

function soma(ls: Linha[]) {
  const qtd = ls.reduce((s, l) => s + l.qtd, 0);
  const custo = r2(ls.reduce((s, l) => s + l.total_custo, 0));
  const venda = r2(ls.reduce((s, l) => s + l.total_venda, 0));
  const lucro = r2(venda - custo);
  return { qtd, custo, venda, lucro, margem: custo > 0 ? r2((venda / custo - 1) * 100) : null };
}

function Quadro({ titulo, valor, sub, destaque }: { titulo: string; valor: string; sub?: string; destaque?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="text-[11px] font-medium uppercase text-gray-500">{titulo}</div>
      <div className={`text-lg font-bold ${destaque || 'text-gray-800'}`}>{valor}</div>
      {sub && <div className="text-[11px] text-gray-500">{sub}</div>}
    </div>
  );
}
