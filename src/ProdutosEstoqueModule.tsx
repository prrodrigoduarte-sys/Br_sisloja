import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import AjustePrecosModule from './AjustePrecosModule';

// Produtos, tabelas de preço e estoque (físico / fiscal / administrativo).
// Quem altera saldo é sempre a função movimentar_estoque do banco (fica registrado no histórico).

interface Produto {
  id: string;
  sku: string;
  codigo_barras: string | null;
  nome: string;
  unidade: string;
  custo: number;
  preco_venda: number;
  estoque_minimo: number;
  ncm: string | null;
  cest: string | null;
  cfop_padrao: string | null;
  origem: string | null;
  csosn_cst: string | null;
  ativo: boolean;
}

interface TabelaPreco {
  id: string;
  nome: string;
}

type TipoEstoque = 'fisico' | 'fiscal' | 'administrativo';
const TIPOS: { id: TipoEstoque; rotulo: string }[] = [
  { id: 'fisico', rotulo: 'Físico' },
  { id: 'fiscal', rotulo: 'Fiscal' },
  { id: 'administrativo', rotulo: 'Administrativo' },
];

const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v: string) => Number(String(v).replace(',', '.'));

const formVazio = {
  sku: '',
  codigo_barras: '',
  nome: '',
  unidade: 'UN',
  custo: '',
  preco_venda: '',
  estoque_minimo: '',
  ncm: '',
  cest: '',
  cfop_padrao: '5102',
  origem: '0',
  csosn_cst: '102',
  ativo: true,
};

export default function ProdutosEstoqueModule({ loggedUser }: { loggedUser: any }) {
  const codigoLoja: string = loggedUser?.codigo_loja || '';
  const perfil: string = loggedUser?.perfil || '';
  const podeCadastrar = ['admin', 'gerente', 'estoquista'].includes(perfil);

  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [saldos, setSaldos] = useState<Record<string, Record<string, number>>>({});
  const [tabelas, setTabelas] = useState<TabelaPreco[]>([]);
  const [busca, setBusca] = useState('');
  const [soBaixo, setSoBaixo] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [msg, setMsg] = useState('');
  const [ajustandoPrecos, setAjustandoPrecos] = useState(false);

  // modal produto
  const [modalProduto, setModalProduto] = useState(false);
  const [editando, setEditando] = useState<Produto | null>(null);
  const [form, setForm] = useState({ ...formVazio });
  const [precosTab, setPrecosTab] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [novaTabela, setNovaTabela] = useState('');

  // modal movimento
  const [movProduto, setMovProduto] = useState<Produto | null>(null);
  const [mov, setMov] = useState({ tipo_estoque: 'fisico' as TipoEstoque, tipo_mov: 'entrada', quantidade: '', custo: '', obs: '' });

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [p, s, t] = await Promise.all([
      supabase.from('produtos').select('*').order('nome').limit(5000),
      supabase.from('estoque_saldos').select('produto_id, tipo, saldo').limit(20000),
      supabase.from('tabelas_preco').select('id, nome').order('nome'),
    ]);
    if (p.error) setMsg('Erro ao carregar: ' + p.error.message);
    setProdutos(
      ((p.data as any[]) || []).map((x) => ({
        ...x,
        custo: Number(x.custo),
        preco_venda: Number(x.preco_venda),
        estoque_minimo: Number(x.estoque_minimo),
      }))
    );
    const mapa: Record<string, Record<string, number>> = {};
    (s.data || []).forEach((x: any) => {
      (mapa[x.produto_id] ||= {})[x.tipo] = Number(x.saldo);
    });
    setSaldos(mapa);
    setTabelas((t.data as TabelaPreco[]) || []);
    setCarregando(false);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return produtos.filter((p) => {
      if (soBaixo && !((saldos[p.id]?.fisico || 0) <= p.estoque_minimo)) return false;
      if (!q) return true;
      return p.nome.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.codigo_barras || '').includes(q);
    });
  }, [produtos, busca, soBaixo, saldos]);

  const valorEstoque = useMemo(() => produtos.reduce((a, p) => a + (saldos[p.id]?.administrativo || 0) * p.custo, 0), [produtos, saldos]);

  // ---------- produto ----------
  const abrirNovo = () => {
    setEditando(null);
    setForm({ ...formVazio });
    setPrecosTab({});
    setMsg('');
    setModalProduto(true);
  };

  const abrirEditar = async (p: Produto) => {
    setEditando(p);
    setForm({
      sku: p.sku,
      codigo_barras: p.codigo_barras || '',
      nome: p.nome,
      unidade: p.unidade,
      custo: String(p.custo),
      preco_venda: String(p.preco_venda),
      estoque_minimo: String(p.estoque_minimo),
      ncm: p.ncm || '',
      cest: p.cest || '',
      cfop_padrao: p.cfop_padrao || '',
      origem: p.origem || '',
      csosn_cst: p.csosn_cst || '',
      ativo: p.ativo,
    });
    const { data } = await supabase.from('precos_produto').select('tabela_id, preco').eq('produto_id', p.id);
    const m: Record<string, string> = {};
    (data || []).forEach((x: any) => (m[x.tabela_id] = String(x.preco)));
    setPrecosTab(m);
    setMsg('');
    setModalProduto(true);
  };

  const salvarProduto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codigoLoja) {
      setMsg('Seu usuário não está ligado a uma loja.');
      return;
    }
    if (!form.sku.trim() || !form.nome.trim()) {
      setMsg('Preencha SKU e nome.');
      return;
    }
    setSalvando(true);
    const payload = {
      codigo_loja: codigoLoja,
      sku: form.sku.trim(),
      codigo_barras: form.codigo_barras.trim() || null,
      nome: form.nome.trim(),
      unidade: form.unidade.trim() || 'UN',
      custo: num(form.custo) || 0,
      preco_venda: num(form.preco_venda) || 0,
      estoque_minimo: num(form.estoque_minimo) || 0,
      ncm: form.ncm.trim() || null,
      cest: form.cest.trim() || null,
      cfop_padrao: form.cfop_padrao.trim() || null,
      origem: form.origem.trim() || null,
      csosn_cst: form.csosn_cst.trim() || null,
      ativo: form.ativo,
    };
    let id = editando?.id;
    if (editando) {
      const { error } = await supabase.from('produtos').update(payload).eq('id', editando.id);
      if (error) {
        setSalvando(false);
        setMsg('Erro ao salvar: ' + error.message);
        return;
      }
    } else {
      const { data, error } = await supabase.from('produtos').insert([payload]).select('id').single();
      if (error || !data) {
        setSalvando(false);
        setMsg(error?.message?.includes('duplicate') ? 'Já existe um produto com esse SKU.' : 'Erro ao salvar: ' + (error?.message || ''));
        return;
      }
      id = (data as any).id;
    }

    // preços por tabela
    if (id) {
      for (const t of tabelas) {
        const v = (precosTab[t.id] || '').trim();
        if (v === '') {
          await supabase.from('precos_produto').delete().eq('tabela_id', t.id).eq('produto_id', id);
        } else {
          await supabase.from('precos_produto').upsert({ codigo_loja: codigoLoja, tabela_id: t.id, produto_id: id, preco: num(v) || 0 }, { onConflict: 'tabela_id,produto_id' });
        }
      }
    }
    setSalvando(false);
    setModalProduto(false);
    setMsg('✅ Produto salvo.');
    carregar();
  };

  const criarTabela = async () => {
    const nome = novaTabela.trim();
    if (!nome || !codigoLoja) return;
    const { error } = await supabase.from('tabelas_preco').insert([{ codigo_loja: codigoLoja, nome }]);
    if (error) {
      setMsg('Erro ao criar tabela: ' + error.message);
      return;
    }
    setNovaTabela('');
    carregar();
  };

  // ---------- movimento ----------
  const abrirMov = (p: Produto) => {
    setMovProduto(p);
    setMov({ tipo_estoque: 'fisico', tipo_mov: 'entrada', quantidade: '', custo: p.custo ? String(p.custo) : '', obs: '' });
    setMsg('');
  };

  const salvarMov = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!movProduto) return;
    let q = num(mov.quantidade);
    if (!isFinite(q) || q === 0) {
      setMsg('Informe a quantidade.');
      return;
    }
    // entrada soma, saída subtrai, ajuste/inventário aceita o sinal digitado
    if (mov.tipo_mov === 'entrada') q = Math.abs(q);
    if (mov.tipo_mov === 'saida') q = -Math.abs(q);
    setSalvando(true);
    const { error } = await supabase.rpc('movimentar_estoque', {
      p_produto: movProduto.id,
      p_tipo_estoque: mov.tipo_estoque,
      p_quantidade: q,
      p_tipo_mov: mov.tipo_mov,
      p_custo: mov.tipo_mov === 'entrada' && mov.custo ? num(mov.custo) : null,
      p_obs: mov.obs.trim() || null,
    });
    setSalvando(false);
    if (error) {
      setMsg('Erro no movimento: ' + error.message);
      return;
    }
    setMovProduto(null);
    setMsg('✅ Estoque atualizado.');
    carregar();
  };

  if (ajustandoPrecos) {
    return (
      <AjustePrecosModule
        loggedUser={loggedUser}
        aoVoltar={() => {
          setAjustandoPrecos(false);
          carregar();
        }}
      />
    );
  }

  const campo = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-700';
  const rotulo = 'block text-[11px] font-bold text-slate-500 mb-1';

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-slate-800">📦 Produtos & Estoque</h2>
          <p className="text-xs text-slate-500">Valor do estoque (administrativo, a custo): <strong>{moeda(valorEstoque)}</strong></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAjustandoPrecos(true)}
            className="px-4 py-2.5 bg-amber-100 text-amber-900 rounded-xl font-bold text-sm cursor-pointer"
          >
            💲 Ajuste de preços
          </button>
          {podeCadastrar && (
            <button type="button" onClick={abrirNovo} className="px-4 py-2.5 bg-blue-900 text-white rounded-xl font-bold text-sm cursor-pointer">
              + Novo produto
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, SKU ou código de barras"
          className="flex-1 min-w-[200px] border border-slate-300 rounded-xl px-3 py-2.5 text-sm"
        />
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
          <input type="checkbox" checked={soBaixo} onChange={(e) => setSoBaixo(e.target.checked)} className="w-4 h-4" />
          Só estoque baixo
        </label>
      </div>

      {msg && <div className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">{msg}</div>}
      {carregando && <p className="text-sm text-slate-500">Carregando...</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-[11px] uppercase text-slate-600">
              <th className="p-2">Produto</th>
              <th className="p-2 text-right">Preço</th>
              {TIPOS.map((t) => (
                <th key={t.id} className="p-2 text-right">
                  {t.rotulo}
                </th>
              ))}
              <th className="p-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtrados.map((p) => {
              const s = saldos[p.id] || {};
              const baixo = (s.fisico || 0) <= p.estoque_minimo;
              return (
                <tr key={p.id} className={p.ativo ? '' : 'opacity-50'}>
                  <td className="p-2">
                    <p className="font-bold text-slate-800 leading-tight">{p.nome}</p>
                    <p className="text-[11px] text-slate-500">
                      {p.sku}
                      {p.codigo_barras ? ` · ${p.codigo_barras}` : ''}
                      {!p.ativo ? ' · inativo' : ''}
                    </p>
                  </td>
                  <td className="p-2 text-right font-bold whitespace-nowrap">{moeda(p.preco_venda)}</td>
                  {TIPOS.map((t) => (
                    <td key={t.id} className={`p-2 text-right whitespace-nowrap ${t.id === 'fisico' && baixo ? 'text-rose-600 font-black' : ''}`}>
                      {s[t.id] || 0}
                    </td>
                  ))}
                  <td className="p-2 text-right whitespace-nowrap space-x-1">
                    {podeCadastrar && (
                      <>
                        <button type="button" onClick={() => abrirMov(p)} className="px-2.5 py-1 bg-emerald-50 text-emerald-800 font-bold text-xs rounded-lg cursor-pointer">
                          Movimentar
                        </button>
                        <button type="button" onClick={() => abrirEditar(p)} className="px-2.5 py-1 bg-blue-50 text-blue-800 font-bold text-xs rounded-lg cursor-pointer">
                          Editar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {!carregando && filtrados.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500 text-sm">
                  Nenhum produto.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ===== Modal produto ===== */}
      {modalProduto && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form onSubmit={salvarProduto} className="bg-white w-full sm:max-w-2xl max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-slate-800">{editando ? 'Editar produto' : 'Novo produto'}</h3>
              <button type="button" onClick={() => setModalProduto(false)} className="text-slate-500 font-bold text-xl cursor-pointer">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={rotulo}>SKU *</label>
                <input className={campo} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required />
              </div>
              <div>
                <label className={rotulo}>CÓDIGO DE BARRAS</label>
                <input className={campo} inputMode="numeric" value={form.codigo_barras} onChange={(e) => setForm({ ...form, codigo_barras: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className={rotulo}>NOME *</label>
                <input className={campo} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
              </div>
              <div>
                <label className={rotulo}>UNIDADE</label>
                <input className={campo} value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })} />
              </div>
              <div>
                <label className={rotulo}>ESTOQUE MÍNIMO</label>
                <input className={campo} inputMode="decimal" value={form.estoque_minimo} onChange={(e) => setForm({ ...form, estoque_minimo: e.target.value })} />
              </div>
              <div>
                <label className={rotulo}>CUSTO (R$)</label>
                <input className={campo} inputMode="decimal" value={form.custo} onChange={(e) => setForm({ ...form, custo: e.target.value })} />
              </div>
              <div>
                <label className={rotulo}>PREÇO PADRÃO (R$)</label>
                <input className={campo} inputMode="decimal" value={form.preco_venda} onChange={(e) => setForm({ ...form, preco_venda: e.target.value })} />
              </div>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs font-black text-slate-700 mb-2">Tabelas de preço (deixe vazio para usar o preço padrão)</p>
              <div className="grid grid-cols-2 gap-3">
                {tabelas.map((t) => (
                  <div key={t.id}>
                    <label className={rotulo}>{t.nome.toUpperCase()} (R$)</label>
                    <input className={campo} inputMode="decimal" value={precosTab[t.id] || ''} onChange={(e) => setPrecosTab({ ...precosTab, [t.id]: e.target.value })} />
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <input className={campo} placeholder="Nova tabela (ex.: Atacado)" value={novaTabela} onChange={(e) => setNovaTabela(e.target.value)} />
                <button type="button" onClick={criarTabela} className="px-3 rounded-lg bg-slate-100 font-bold text-xs cursor-pointer whitespace-nowrap">
                  + Criar
                </button>
              </div>
            </div>

            <details className="border-t pt-3">
              <summary className="text-xs font-black text-slate-700 cursor-pointer">Dados fiscais (para a nota fiscal)</summary>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className={rotulo}>NCM</label>
                  <input className={campo} value={form.ncm} onChange={(e) => setForm({ ...form, ncm: e.target.value })} />
                </div>
                <div>
                  <label className={rotulo}>CEST</label>
                  <input className={campo} value={form.cest} onChange={(e) => setForm({ ...form, cest: e.target.value })} />
                </div>
                <div>
                  <label className={rotulo}>CFOP PADRÃO</label>
                  <input className={campo} value={form.cfop_padrao} onChange={(e) => setForm({ ...form, cfop_padrao: e.target.value })} />
                </div>
                <div>
                  <label className={rotulo}>ORIGEM</label>
                  <input className={campo} value={form.origem} onChange={(e) => setForm({ ...form, origem: e.target.value })} />
                </div>
                <div>
                  <label className={rotulo}>CSOSN / CST</label>
                  <input className={campo} value={form.csosn_cst} onChange={(e) => setForm({ ...form, csosn_cst: e.target.value })} />
                </div>
              </div>
            </details>

            <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} className="w-4 h-4" />
              Produto ativo (aparece no PDV)
            </label>

            {msg && <p className="text-xs font-semibold text-rose-700">{msg}</p>}

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setModalProduto(false)} className="px-4 py-2.5 bg-slate-100 rounded-xl font-bold text-sm cursor-pointer">
                Cancelar
              </button>
              <button type="submit" disabled={salvando} className="px-5 py-2.5 bg-blue-900 text-white rounded-xl font-bold text-sm cursor-pointer disabled:opacity-60">
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===== Modal movimento ===== */}
      {movProduto && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form onSubmit={salvarMov} className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-slate-800 leading-tight">Movimentar: {movProduto.nome}</h3>
              <button type="button" onClick={() => setMovProduto(null)} className="text-slate-500 font-bold text-xl cursor-pointer">
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={rotulo}>ESTOQUE</label>
                <select className={campo} value={mov.tipo_estoque} onChange={(e) => setMov({ ...mov, tipo_estoque: e.target.value as TipoEstoque })}>
                  {TIPOS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.rotulo}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={rotulo}>OPERAÇÃO</label>
                <select className={campo} value={mov.tipo_mov} onChange={(e) => setMov({ ...mov, tipo_mov: e.target.value })}>
                  <option value="entrada">Entrada (soma)</option>
                  <option value="saida">Saída (subtrai)</option>
                  <option value="ajuste">Ajuste (use − para tirar)</option>
                  <option value="inventario">Inventário (use − para tirar)</option>
                </select>
              </div>
              <div>
                <label className={rotulo}>QUANTIDADE</label>
                <input className={campo} inputMode="decimal" value={mov.quantidade} onChange={(e) => setMov({ ...mov, quantidade: e.target.value })} autoFocus />
              </div>
              {mov.tipo_mov === 'entrada' && (
                <div>
                  <label className={rotulo}>CUSTO UNITÁRIO (R$)</label>
                  <input className={campo} inputMode="decimal" value={mov.custo} onChange={(e) => setMov({ ...mov, custo: e.target.value })} />
                </div>
              )}
              <div className="col-span-2">
                <label className={rotulo}>OBSERVAÇÃO</label>
                <input className={campo} value={mov.obs} onChange={(e) => setMov({ ...mov, obs: e.target.value })} placeholder="Ex.: compra do fornecedor X, contagem, perda..." />
              </div>
            </div>
            {msg && <p className="text-xs font-semibold text-rose-700">{msg}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setMovProduto(null)} className="px-4 py-2.5 bg-slate-100 rounded-xl font-bold text-sm cursor-pointer">
                Cancelar
              </button>
              <button type="submit" disabled={salvando} className="px-5 py-2.5 bg-emerald-700 text-white rounded-xl font-bold text-sm cursor-pointer disabled:opacity-60">
                {salvando ? 'Salvando...' : 'Confirmar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
