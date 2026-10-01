// BR Sisloja - Ajuste de preços (dentro de Produtos & Estoque)
// Lista editável: muda o preço e o índice (margem sobre o custo) se recalcula; muda o índice e o preço se recalcula.
// Reajuste em lote nos produtos marcados. Nada vai para o banco até clicar em "Salvar".
// Toda alteração fica no Registro de atividades (Configurações).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';

type Produto = {
  id: string;
  sku: string;
  codigo_barras: string | null;
  nome: string;
  unidade: string;
  grupo: string | null;
  custo: number;
  preco_venda: number;
  ativo: boolean;
};
type Tabela = { id: string; nome: string };
type Coluna = { id: string; nome: string }; // 'padrao' = preço padrão do produto

const PADRAO = 'padrao';
const POR_PAGINA = 200;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const brl = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (n: number | null) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }));
const lerNumero = (s: string) => {
  const t = String(s).trim().replace(/\s|R\$|%/g, '');
  if (!t) return null;
  const n = parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return isFinite(n) ? n : null;
};
const chave = (produtoId: string, coluna: string) => `${produtoId}|${coluna}`;

// índice = margem sobre o custo: preço = custo × (1 + índice%)
const indiceDe = (custo: number, preco: number | null) => (preco == null || !custo ? null : r2((preco / custo - 1) * 100));
const precoDoIndice = (custo: number, indice: number) => r2(custo * (1 + indice / 100));

type Arred = 'nenhum' | '90' | '99' | '05' | 'inteiro';
function arredondar(p: number, modo: Arred) {
  if (p <= 0) return 0;
  if (modo === '05') return r2(Math.ceil(r2(p) * 20) / 20);
  if (modo === 'inteiro') return Math.ceil(r2(p));
  if (modo === '90' || modo === '99') {
    const fim = modo === '90' ? 0.9 : 0.99;
    let v = Math.floor(p) + fim;
    if (v < r2(p)) v += 1;
    return r2(v);
  }
  return r2(p);
}

type AcaoLote = 'reajuste' | 'indice' | 'multiplicar' | 'valor';
const ACOES: { id: AcaoLote; rotulo: string; ajuda: string }[] = [
  { id: 'reajuste', rotulo: 'Reajustar preço em %', ajuda: 'ex.: 10 sobe 10%, -5 baixa 5%' },
  { id: 'indice', rotulo: 'Aplicar índice (margem) %', ajuda: 'preço = custo × (1 + índice%)' },
  { id: 'multiplicar', rotulo: 'Multiplicar preço por', ajuda: 'ex.: 1,08' },
  { id: 'valor', rotulo: 'Definir preço R$', ajuda: 'mesmo preço para todos os marcados' },
];

export default function AjustePrecosModule({ loggedUser, aoVoltar }: { loggedUser: any; aoVoltar: () => void }) {
  const perfil = String(loggedUser?.perfil || '').toLowerCase();
  const podeEditar = ['admin', 'gerente'].includes(perfil);

  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [tabelas, setTabelas] = useState<Tabela[]>([]);
  const [original, setOriginal] = useState<Record<string, number | null>>({});
  const [rascunho, setRascunho] = useState<Record<string, number | null>>({});
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const [busca, setBusca] = useState('');
  const [grupo, setGrupo] = useState('');
  const [inativos, setInativos] = useState(false);
  const [limite, setLimite] = useState(POR_PAGINA);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  const [loteColuna, setLoteColuna] = useState<string>(PADRAO);
  const [loteAcao, setLoteAcao] = useState<AcaoLote>('reajuste');
  const [loteValor, setLoteValor] = useState('');
  const [arred, setArred] = useState<Arred>('nenhum');

  const carregar = async () => {
    setCarregando(true);
    const [p, t, pp] = await Promise.all([
      supabase.from('produtos').select('id, sku, codigo_barras, nome, unidade, grupo, custo, preco_venda, ativo').order('nome').limit(10000),
      supabase.from('tabelas_preco').select('id, nome').order('nome'),
      supabase.from('precos_produto').select('tabela_id, produto_id, preco').limit(50000),
    ]);
    if (p.error) setMsg({ tipo: 'erro', texto: 'Erro ao carregar: ' + p.error.message });
    const lista = ((p.data as any[]) || []).map((x) => ({ ...x, custo: Number(x.custo) || 0, preco_venda: Number(x.preco_venda) || 0 }));
    const orig: Record<string, number | null> = {};
    lista.forEach((x) => (orig[chave(x.id, PADRAO)] = x.preco_venda));
    ((pp.data as any[]) || []).forEach((x) => (orig[chave(x.produto_id, x.tabela_id)] = Number(x.preco)));
    setProdutos(lista);
    setTabelas((t.data as Tabela[]) || []);
    setOriginal(orig);
    setRascunho({});
    setCarregando(false);
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const colunas: Coluna[] = useMemo(() => [{ id: PADRAO, nome: 'Preço padrão' }, ...tabelas], [tabelas]);
  const grupos = useMemo(() => Array.from(new Set(produtos.map((p) => p.grupo || '').filter(Boolean))).sort(), [produtos]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return produtos.filter((p) => {
      if (!inativos && !p.ativo) return false;
      if (grupo && (p.grupo || '') !== grupo) return false;
      if (!q) return true;
      return p.nome.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.codigo_barras || '').includes(q);
    });
  }, [produtos, busca, grupo, inativos]);

  const visiveis = filtrados.slice(0, limite);

  const precoAtual = (id: string, col: string) => {
    const k = chave(id, col);
    return k in rascunho ? rascunho[k] : original[k] ?? null;
  };
  const mudou = (id: string, col: string) => {
    const k = chave(id, col);
    return k in rascunho && rascunho[k] !== (original[k] ?? null);
  };

  const definir = (id: string, col: string, preco: number | null) =>
    setRascunho((r) => {
      const k = chave(id, col);
      const novo = { ...r };
      if (preco === (original[k] ?? null)) delete novo[k];
      else novo[k] = preco;
      return novo;
    });

  const alteracoes = useMemo(() => Object.keys(rascunho).filter((k) => rascunho[k] !== (original[k] ?? null)), [rascunho, original]);

  // ---------- lote ----------
  const marcarTodos = (sim: boolean) => setMarcados(sim ? new Set(filtrados.map((p) => p.id)) : new Set());
  const alternar = (id: string) =>
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const aplicarLote = () => {
    const v = lerNumero(loteValor);
    if (v == null) return setMsg({ tipo: 'erro', texto: 'Informe o valor do ajuste.' });
    const alvos = produtos.filter((p) => marcados.has(p.id));
    if (!alvos.length) return setMsg({ tipo: 'erro', texto: 'Marque os produtos que vão receber o ajuste.' });
    const cols = loteColuna === '*' ? colunas.map((c) => c.id) : [loteColuna];
    let n = 0;
    let semCusto = 0;
    const novo = { ...rascunho };
    for (const p of alvos) {
      for (const c of cols) {
        const atual = precoAtual(p.id, c);
        let preco: number | null = null;
        if (loteAcao === 'reajuste') preco = atual == null ? null : atual * (1 + v / 100);
        else if (loteAcao === 'multiplicar') preco = atual == null ? null : atual * v;
        else if (loteAcao === 'valor') preco = v;
        else if (loteAcao === 'indice') {
          if (!p.custo) {
            semCusto++;
            continue;
          }
          preco = p.custo * (1 + v / 100);
        }
        if (preco == null) continue;
        preco = arredondar(preco, arred);
        const k = chave(p.id, c);
        if (preco === (original[k] ?? null)) delete novo[k];
        else novo[k] = preco;
        n++;
      }
    }
    setRascunho(novo);
    setMsg({
      tipo: 'ok',
      texto: `${n} preço(s) ajustado(s) na tela${semCusto ? ` (${semCusto} sem custo cadastrado ficaram de fora)` : ''}. Confira e clique em "Salvar".`,
    });
  };

  // ---------- salvar ----------
  const salvar = async () => {
    if (!alteracoes.length) return;
    if (alteracoes.some((k) => (rascunho[k] ?? 0) <= 0 && k.endsWith('|' + PADRAO)))
      return setMsg({ tipo: 'erro', texto: 'O preço padrão não pode ficar zerado ou vazio.' });
    if (!window.confirm(`Gravar ${alteracoes.length} preço(s) alterado(s)?`)) return;
    setSalvando(true);
    setMsg(null);
    const codigoLoja = loggedUser?.codigo_loja;
    const padroes = alteracoes.filter((k) => k.endsWith('|' + PADRAO));
    const tabs = alteracoes.filter((k) => !k.endsWith('|' + PADRAO));
    const erros: string[] = [];

    for (let i = 0; i < padroes.length; i += 20) {
      const res = await Promise.all(
        padroes.slice(i, i + 20).map((k) => supabase.from('produtos').update({ preco_venda: rascunho[k] }).eq('id', k.split('|')[0]))
      );
      res.forEach((r) => r.error && erros.push(r.error.message));
    }
    const upserts = tabs
      .filter((k) => rascunho[k] != null && (rascunho[k] as number) > 0)
      .map((k) => {
        const [produto_id, tabela_id] = k.split('|');
        return { codigo_loja: codigoLoja, tabela_id, produto_id, preco: rascunho[k] };
      });
    if (upserts.length) {
      const { error } = await supabase.from('precos_produto').upsert(upserts, { onConflict: 'tabela_id,produto_id' });
      if (error) erros.push(error.message);
    }
    // tabela deixada vazia = produto sai daquela tabela
    for (const k of tabs.filter((k) => rascunho[k] == null || (rascunho[k] as number) <= 0)) {
      const [produto_id, tabela_id] = k.split('|');
      const { error } = await supabase.from('precos_produto').delete().eq('tabela_id', tabela_id).eq('produto_id', produto_id);
      if (error) erros.push(error.message);
    }

    setSalvando(false);
    if (erros.length) return setMsg({ tipo: 'erro', texto: 'Alguns preços não foram gravados: ' + Array.from(new Set(erros)).join(' | ') });
    setMsg({ tipo: 'ok', texto: `✅ ${alteracoes.length} preço(s) gravado(s).` });
    setMarcados(new Set());
    carregar();
  };

  const sair = () => {
    if (alteracoes.length && !window.confirm('Há alterações não salvas. Sair mesmo assim?')) return;
    aoVoltar();
  };

  const todosMarcados = filtrados.length > 0 && filtrados.every((p) => marcados.has(p.id));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={sair} className="px-3 py-2 bg-slate-100 rounded-xl font-bold text-sm cursor-pointer">
          ← Produtos
        </button>
        <div className="mr-auto">
          <h2 className="text-lg font-black text-slate-800">💲 Ajuste de preços</h2>
          <p className="text-xs text-slate-500">
            Índice = margem sobre o custo (preço = custo × (1 + índice%)). Mudou um, o outro se recalcula.
          </p>
        </div>
        {podeEditar && (
          <>
            {alteracoes.length > 0 && (
              <button type="button" onClick={() => setRascunho({})} className="px-3 py-2 text-sm font-bold text-slate-600 cursor-pointer">
                Descartar
              </button>
            )}
            <button
              type="button"
              onClick={salvar}
              disabled={!alteracoes.length || salvando}
              className="px-4 py-2.5 bg-blue-900 text-white rounded-xl font-bold text-sm cursor-pointer disabled:opacity-40"
            >
              {salvando ? 'Gravando…' : `Salvar ${alteracoes.length ? `(${alteracoes.length})` : ''}`}
            </button>
          </>
        )}
      </div>

      {/* filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setLimite(POR_PAGINA);
          }}
          placeholder="Buscar por nome, código ou código de barras"
          className="flex-1 min-w-[200px] border border-slate-300 rounded-xl px-3 py-2 text-sm"
        />
        <select value={grupo} onChange={(e) => setGrupo(e.target.value)} className="border border-slate-300 rounded-xl px-2 py-2 text-sm">
          <option value="">Todos os grupos</option>
          {grupos.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs font-bold text-slate-600">
          <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> inativos
        </label>
      </div>

      {/* ajuste em lote */}
      {podeEditar && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 p-2 text-sm">
          <span className="font-bold text-amber-900">Em lote ({marcados.size} marcado{marcados.size === 1 ? '' : 's'}):</span>
          <select value={loteAcao} onChange={(e) => setLoteAcao(e.target.value as AcaoLote)} className="border rounded-lg px-2 py-1">
            {ACOES.map((a) => (
              <option key={a.id} value={a.id}>
                {a.rotulo}
              </option>
            ))}
          </select>
          <input
            value={loteValor}
            onChange={(e) => setLoteValor(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && aplicarLote()}
            placeholder={ACOES.find((a) => a.id === loteAcao)?.ajuda}
            inputMode="decimal"
            className="w-44 border rounded-lg px-2 py-1 text-right"
          />
          <span className="text-slate-600">em</span>
          <select value={loteColuna} onChange={(e) => setLoteColuna(e.target.value)} className="border rounded-lg px-2 py-1">
            {colunas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
            {colunas.length > 1 && <option value="*">Todas as colunas</option>}
          </select>
          <span className="text-slate-600">arredondar</span>
          <select value={arred} onChange={(e) => setArred(e.target.value as Arred)} className="border rounded-lg px-2 py-1">
            <option value="nenhum">não</option>
            <option value="90">final ,90</option>
            <option value="99">final ,99</option>
            <option value="05">de 5 em 5 centavos</option>
            <option value="inteiro">real inteiro</option>
          </select>
          <button type="button" onClick={aplicarLote} className="px-3 py-1.5 bg-amber-600 text-white rounded-lg font-bold cursor-pointer">
            Aplicar
          </button>
        </div>
      )}

      {msg && (
        <div
          className={`text-xs font-semibold rounded-lg px-3 py-2 border ${
            msg.tipo === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {msg.texto}
        </div>
      )}
      {carregando && <p className="text-sm text-slate-500">Carregando...</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-[11px] uppercase text-slate-600">
              {podeEditar && (
                <th className="p-2 w-8">
                  <input type="checkbox" checked={todosMarcados} onChange={(e) => marcarTodos(e.target.checked)} title="Marcar todos os filtrados" />
                </th>
              )}
              <th className="p-2">Código</th>
              <th className="p-2">Produto</th>
              <th className="p-2 text-right">Custo</th>
              {colunas.map((c) => (
                <th key={c.id} className="p-2 text-center border-l" colSpan={2}>
                  {c.nome}
                </th>
              ))}
            </tr>
            <tr className="border-b bg-slate-50 text-[10px] uppercase text-slate-500">
              {podeEditar && <th />}
              <th />
              <th />
              <th />
              {colunas.map((c) => (
                <React.Fragment key={c.id}>
                  <th className="px-2 pb-1 text-right border-l">índice %</th>
                  <th className="px-2 pb-1 text-right">R$</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {visiveis.map((p) => (
              <tr key={p.id} className={`${p.ativo ? '' : 'opacity-50'} ${marcados.has(p.id) ? 'bg-amber-50/50' : ''}`}>
                {podeEditar && (
                  <td className="p-2">
                    <input type="checkbox" checked={marcados.has(p.id)} onChange={() => alternar(p.id)} />
                  </td>
                )}
                <td className="p-2 whitespace-nowrap text-xs text-slate-600">
                  {p.sku}
                  {p.codigo_barras && p.codigo_barras !== p.sku && <div className="text-[10px] text-slate-400">{p.codigo_barras}</div>}
                </td>
                <td className="p-2 min-w-[200px]">
                  <div className="font-bold text-slate-800 leading-tight">{p.nome}</div>
                  <div className="text-[10px] text-slate-400">
                    {p.unidade}
                    {p.grupo ? ` · ${p.grupo}` : ''}
                  </div>
                </td>
                <td className="p-2 text-right whitespace-nowrap text-slate-600">{brl(p.custo)}</td>
                {colunas.map((c) => {
                  const preco = precoAtual(p.id, c.id);
                  const orig = original[chave(p.id, c.id)] ?? null;
                  const alterado = mudou(p.id, c.id);
                  const indice = indiceDe(p.custo, preco);
                  const prejuizo = preco != null && p.custo > 0 && preco < p.custo;
                  return (
                    <React.Fragment key={c.id}>
                      <td className={`px-1 py-1 border-l ${alterado ? 'bg-yellow-100' : ''}`}>
                        <CelulaNumero
                          valor={indice}
                          formatar={pct}
                          desabilitado={!podeEditar || !p.custo}
                          titulo={!p.custo ? 'Produto sem custo: informe o preço direto' : ''}
                          aoConfirmar={(n) => definir(p.id, c.id, n == null ? (c.id === PADRAO ? orig : null) : precoDoIndice(p.custo, n))}
                          largura="w-16"
                          vermelho={prejuizo}
                        />
                      </td>
                      <td className={`px-1 py-1 ${alterado ? 'bg-yellow-100' : ''}`}>
                        <CelulaNumero
                          valor={preco}
                          formatar={brl}
                          desabilitado={!podeEditar}
                          aoConfirmar={(n) => definir(p.id, c.id, n == null ? (c.id === PADRAO ? orig : null) : r2(n))}
                          largura="w-20"
                          negrito
                          vermelho={prejuizo}
                        />
                        {alterado && (
                          <div className="text-right text-[10px] text-slate-500" title="Preço antes">
                            era {brl(orig)}
                            {orig ? ` (${(preco ?? 0) >= orig ? '+' : ''}${pct(r2((((preco ?? 0) - orig) / orig) * 100))}%)` : ''}
                          </div>
                        )}
                      </td>
                    </React.Fragment>
                  );
                })}
              </tr>
            ))}
            {!carregando && filtrados.length === 0 && (
              <tr>
                <td colSpan={4 + colunas.length * 2 + (podeEditar ? 1 : 0)} className="p-6 text-center text-slate-500 text-sm">
                  Nenhum produto.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {filtrados.length > limite && (
        <button type="button" onClick={() => setLimite((l) => l + POR_PAGINA)} className="w-full py-2 text-sm font-bold text-blue-800 cursor-pointer">
          Mostrar mais ({filtrados.length - limite} restantes)
        </button>
      )}
      <p className="text-[11px] text-slate-400">
        Dica: digite o valor e tecle Enter ou Tab. Célula amarela = alterada e ainda não salva. Valor em vermelho = abaixo do custo. Apagar o preço
        de uma tabela tira o produto daquela tabela.
      </p>
    </div>
  );
}

// campo numérico que só confirma ao sair (Tab/clique fora) ou Enter; Esc desfaz
function CelulaNumero({
  valor,
  formatar,
  aoConfirmar,
  desabilitado,
  largura,
  negrito,
  vermelho,
  titulo,
}: {
  valor: number | null;
  formatar: (n: number | null) => string;
  aoConfirmar: (n: number | null) => void;
  desabilitado?: boolean;
  largura: string;
  negrito?: boolean;
  vermelho?: boolean;
  titulo?: string;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const cancelado = useRef(false);
  const mostrar = valor == null ? '' : formatar(valor);

  const confirmar = () => {
    setEditando(false);
    if (cancelado.current) {
      cancelado.current = false;
      return;
    }
    if (texto === mostrar) return;
    aoConfirmar(lerNumero(texto));
  };

  return (
    <input
      value={editando ? texto : mostrar}
      placeholder="—"
      title={titulo}
      disabled={desabilitado}
      inputMode="decimal"
      onFocus={(e) => {
        setTexto(mostrar);
        setEditando(true);
        setTimeout(() => e.target.select(), 0);
      }}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          cancelado.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={`${largura} rounded border border-transparent hover:border-slate-300 focus:border-blue-700 px-1 py-1 text-right text-sm outline-none bg-transparent disabled:text-slate-400 ${
        negrito ? 'font-bold' : ''
      } ${vermelho ? 'text-rose-600' : ''}`}
    />
  );
}
