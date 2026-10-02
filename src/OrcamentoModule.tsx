import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { buscarTodos } from './buscarTodos';
import { SeletorCliente, type Cliente } from './ClienteVenda';

// ------------------------------------------------------------
// Orçamentos — NÃO mexe no estoque.
// aberto (em montagem) -> pronto (aparece no PDV para carregar na venda) -> convertido (virou venda)
// O banco precisa do arquivo fase13_orcamentos.sql.txt (rodar no SQL Editor do Supabase).
// ------------------------------------------------------------

export type OrcamentoItem = { produto_id: string; nome: string; unidade: string; quantidade: number; tabela_id: string; preco: number };

export type Orcamento = {
  id: string;
  numero: number;
  status: 'aberto' | 'pronto' | 'convertido' | 'cancelado';
  cliente_id: string | null;
  cliente_nome: string | null;
  tabela_id: string | null;
  itens: OrcamentoItem[];
  desconto: number;
  total: number;
  validade: string | null;
  observacao: string | null;
  vendedor: string | null;
  venda_numero: number | null;
  created_at: string;
};

interface Produto {
  id: string;
  sku: string;
  codigo_barras: string | null;
  nome: string;
  unidade: string;
  preco_venda: number;
}

const STATUS: Record<Orcamento['status'], { rotulo: string; cor: string }> = {
  aberto: { rotulo: 'Em aberto', cor: 'bg-slate-200 text-slate-700' },
  pronto: { rotulo: 'Pronto', cor: 'bg-emerald-600 text-white' },
  convertido: { rotulo: 'Virou venda', cor: 'bg-blue-900 text-white' },
  cancelado: { rotulo: 'Cancelado', cor: 'bg-rose-600 text-white' },
};

const moeda = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v: string) => Number(String(v).replace(',', '.'));
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dataBR = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const subtotalDe = (itens: OrcamentoItem[]) => itens.reduce((a, i) => a + Math.round(i.preco * i.quantidade * 100) / 100, 0);

export const erroOrcamento = (m: string) =>
  /orcamentos/i.test(m) && /exist|schema|relation/i.test(m) ? 'Falta criar a tabela no banco: rode o arquivo fase13_orcamentos.sql.txt no SQL Editor do Supabase.' : m;

export function imprimirOrcamento(o: Orcamento, loja: string) {
  const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const linhas = o.itens
    .map(
      (i, k) =>
        `<tr><td class="c">${k + 1}</td><td>${esc(i.nome)}</td><td class="d">${qtd(i.quantidade)} ${esc(i.unidade || '')}</td><td class="d">${moeda(i.preco)}</td><td class="d">${moeda(
          Math.round(i.preco * i.quantidade * 100) / 100
        )}</td></tr>`
    )
    .join('');
  const bruto = subtotalDe(o.itens);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Orçamento ${o.numero}</title>
<style>
@page{size:A4 portrait;margin:12mm}
body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000;margin:0}
.topo{display:flex;justify-content:space-between;border-bottom:2px solid #000;padding-bottom:6px}
h1{font-size:18px;margin:0}
table{width:100%;border-collapse:collapse;margin-top:10px}
th{font-size:10px;text-transform:uppercase;text-align:left;border-bottom:1px solid #000;padding:4px}
td{padding:4px;border-bottom:1px dotted #bbb}
.c{text-align:center;width:24px}.d{text-align:right;white-space:nowrap}
.tot{margin-left:auto;width:260px}.tot td{border:0}.g td{font-size:16px;font-weight:bold;border-top:1px solid #000}
.obs{margin-top:14px;font-size:11px}
.rod{margin-top:24px;font-size:10px;color:#444;text-align:center}
</style></head><body>
<div class="topo"><div><h1>${esc(loja)}</h1><div>ORÇAMENTO</div></div>
<div style="text-align:right">Nº <b style="font-size:16px">${o.numero}</b><br>${new Date(o.created_at).toLocaleDateString('pt-BR')}${
    o.validade ? `<br>Válido até ${dataBR(o.validade)}` : ''
  }</div></div>
${o.cliente_nome ? `<p><b>Cliente:</b> ${esc(o.cliente_nome)}</p>` : ''}
<table><thead><tr><th class="c">#</th><th>Produto</th><th class="d">Qtd</th><th class="d">Unitário</th><th class="d">Total</th></tr></thead><tbody>${linhas}</tbody></table>
<table class="tot">
${o.desconto > 0 ? `<tr><td>Subtotal</td><td class="d">${moeda(bruto)}</td></tr><tr><td>Desconto</td><td class="d">- ${moeda(o.desconto)}</td></tr>` : ''}
<tr class="g"><td>TOTAL</td><td class="d">${moeda(o.total)}</td></tr></table>
${o.observacao ? `<div class="obs"><b>Observações:</b> ${esc(o.observacao)}</div>` : ''}
${o.vendedor ? `<div class="obs">Atendido por: ${esc(o.vendedor)}</div>` : ''}
<div class="rod">Orçamento sem valor fiscal. Preços e disponibilidade sujeitos a confirmação na data da compra.</div>
</body></html>`;
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc || !iframe.contentWindow) return;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 2000);
  }, 250);
}

export default function OrcamentoModule({ loggedUser }: { loggedUser: any }) {
  const [lista, setLista] = useState<Orcamento[]>([]);
  const [filtro, setFiltro] = useState<'ativos' | Orcamento['status'] | 'todos'>('ativos');
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [editando, setEditando] = useState<Orcamento | 'novo' | null>(null);
  const nomeLoja = loggedUser?.loja_nome || loggedUser?.codigo_loja || 'Loja';

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.from('orcamentos').select('*').order('created_at', { ascending: false }).limit(300);
    setCarregando(false);
    if (error) return setMsg({ tipo: 'erro', texto: erroOrcamento(error.message) });
    setLista(((data as any[]) || []).map((o) => ({ ...o, total: Number(o.total), desconto: Number(o.desconto) })));
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const filtrados = useMemo(() => {
    const q = norm(busca.trim());
    return lista.filter((o) => {
      if (filtro === 'ativos' && !['aberto', 'pronto'].includes(o.status)) return false;
      if (filtro !== 'ativos' && filtro !== 'todos' && o.status !== filtro) return false;
      if (!q) return true;
      return String(o.numero).includes(q) || norm(o.cliente_nome || '').includes(q);
    });
  }, [lista, filtro, busca]);

  const mudarStatus = async (o: Orcamento, status: Orcamento['status']) => {
    if (status === 'cancelado' && !window.confirm(`Cancelar o orçamento nº ${o.numero}?`)) return;
    const { error } = await supabase.from('orcamentos').update({ status }).eq('id', o.id);
    if (error) return setMsg({ tipo: 'erro', texto: erroOrcamento(error.message) });
    setMsg({
      tipo: 'ok',
      texto: status === 'pronto' ? `Orçamento nº ${o.numero} pronto: já aparece no PDV para carregar na venda.` : `Orçamento nº ${o.numero} atualizado.`,
    });
    carregar();
  };

  if (editando) {
    return (
      <EditorOrcamento
        loggedUser={loggedUser}
        orcamento={editando === 'novo' ? null : editando}
        aoVoltar={(texto) => {
          setEditando(null);
          if (texto) setMsg({ tipo: 'ok', texto });
          carregar();
        }}
      />
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-slate-800">📝 Orçamentos</h2>
          <p className="text-xs text-slate-500">Não mexe no estoque. Marque como "pronto" para carregar na venda pelo PDV.</p>
        </div>
        <button type="button" onClick={() => setEditando('novo')} className="px-4 py-2.5 bg-blue-900 text-white rounded-xl font-bold text-sm cursor-pointer">
          + Novo orçamento
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por número ou cliente"
          className="flex-1 min-w-[200px] border border-slate-300 rounded-xl px-3 py-2.5 text-sm"
        />
        <select value={filtro} onChange={(e) => setFiltro(e.target.value as any)} className="border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-bold bg-white">
          <option value="ativos">Em aberto e prontos</option>
          <option value="aberto">Só em aberto</option>
          <option value="pronto">Só prontos</option>
          <option value="convertido">Viraram venda</option>
          <option value="cancelado">Cancelados</option>
          <option value="todos">Todos</option>
        </select>
      </div>

      {msg && (
        <p className={`rounded-lg px-3 py-2 text-xs font-semibold ${msg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{msg.texto}</p>
      )}
      {carregando && <p className="text-sm text-slate-500">Carregando...</p>}
      {!carregando && filtrados.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Nenhum orçamento.</p>}

      <div className="flex flex-col gap-2">
        {filtrados.map((o) => (
          <div key={o.id} className="rounded-xl border border-slate-200 p-3 text-sm flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 mr-auto">
              <p className="font-bold text-slate-800">
                Nº {o.numero} · {o.cliente_nome || 'sem cliente'}{' '}
                <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold align-middle ${STATUS[o.status].cor}`}>{STATUS[o.status].rotulo}</span>
              </p>
              <p className="text-[11px] text-slate-500">
                {new Date(o.created_at).toLocaleDateString('pt-BR')} · {o.itens.length} item(ns)
                {o.validade ? ` · válido até ${dataBR(o.validade)}` : ''}
                {o.vendedor ? ` · ${o.vendedor}` : ''}
                {o.status === 'convertido' && o.venda_numero ? ` · venda nº ${o.venda_numero}` : ''}
              </p>
            </div>
            <span className="font-black text-slate-900 whitespace-nowrap">{moeda(o.total)}</span>
            <div className="flex flex-wrap gap-1">
              <button type="button" onClick={() => imprimirOrcamento(o, nomeLoja)} className="px-2.5 py-1 bg-slate-100 font-bold text-xs rounded-lg cursor-pointer">
                🖨️ Imprimir
              </button>
              {['aberto', 'pronto'].includes(o.status) && (
                <button type="button" onClick={() => setEditando(o)} className="px-2.5 py-1 bg-blue-50 text-blue-800 font-bold text-xs rounded-lg cursor-pointer">
                  Editar
                </button>
              )}
              {o.status === 'aberto' && (
                <button type="button" onClick={() => mudarStatus(o, 'pronto')} className="px-2.5 py-1 bg-emerald-600 text-white font-bold text-xs rounded-lg cursor-pointer">
                  ✓ Marcar pronto
                </button>
              )}
              {o.status === 'pronto' && (
                <button type="button" onClick={() => mudarStatus(o, 'aberto')} className="px-2.5 py-1 bg-slate-100 font-bold text-xs rounded-lg cursor-pointer">
                  Voltar para aberto
                </button>
              )}
              {['aberto', 'pronto'].includes(o.status) && (
                <button type="button" onClick={() => mudarStatus(o, 'cancelado')} className="px-2.5 py-1 border border-rose-300 text-rose-700 font-bold text-xs rounded-lg cursor-pointer">
                  Cancelar
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- montar / editar orçamento ----------
function EditorOrcamento({ loggedUser, orcamento, aoVoltar }: { loggedUser: any; orcamento: Orcamento | null; aoVoltar: (msg?: string) => void }) {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [tabelas, setTabelas] = useState<{ id: string; nome: string }[]>([]);
  const [precos, setPrecos] = useState<Record<string, Record<string, number>>>({});
  const [tabelaId, setTabelaId] = useState(orcamento?.tabela_id || '');
  const [itens, setItens] = useState<OrcamentoItem[]>(orcamento?.itens || []);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [desconto, setDesconto] = useState(orcamento?.desconto ? String(orcamento.desconto).replace('.', ',') : '');
  const [validade, setValidade] = useState(orcamento?.validade || new Date(Date.now() + 7 * 864e5).toLocaleDateString('sv-SE'));
  const [observacao, setObservacao] = useState(orcamento?.observacao || '');
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    (async () => {
      const [p, t, pp] = await Promise.all([
        buscarTodos(() => supabase.from('produtos').select('id, sku, codigo_barras, nome, unidade, preco_venda').eq('ativo', true).order('nome').order('id')),
        supabase.from('tabelas_preco').select('id, nome').order('nome'),
        buscarTodos(() => supabase.from('precos_produto').select('tabela_id, produto_id, preco').order('produto_id').order('tabela_id')),
      ]);
      setProdutos(((p.data as any[]) || []).map((x) => ({ ...x, preco_venda: Number(x.preco_venda) })));
      setTabelas((t.data as any[]) || []);
      const m: Record<string, Record<string, number>> = {};
      ((pp.data as any[]) || []).forEach((x) => ((m[x.tabela_id] ||= {})[x.produto_id] = Number(x.preco)));
      setPrecos(m);
      if (orcamento?.cliente_id) {
        const { data } = await supabase.rpc('obter_cliente', { p_id: orcamento.cliente_id });
        if (data) setCliente(data as Cliente);
      }
    })();
  }, [orcamento?.cliente_id]);

  const precoTab = (p: { id: string; preco_venda: number }, tab: string) => (tab && precos[tab]?.[p.id] != null ? precos[tab][p.id] : p.preco_venda);

  const sugestoes = useMemo(() => {
    const termos = norm(busca).split(/\s+/).filter(Boolean);
    if (!termos.length) return [];
    return produtos.filter((p) => termos.every((t) => norm(p.nome + ' ' + p.sku + ' ' + (p.codigo_barras || '')).includes(t))).slice(0, 8);
  }, [produtos, busca]);

  const adicionar = (p: Produto) => {
    setItens((l) => {
      const i = l.findIndex((x) => x.produto_id === p.id);
      if (i >= 0) return l.map((x, k) => (k === i ? { ...x, quantidade: x.quantidade + 1 } : x));
      return [...l, { produto_id: p.id, nome: p.nome, unidade: p.unidade, quantidade: 1, tabela_id: tabelaId, preco: precoTab(p, tabelaId) }];
    });
    setBusca('');
  };

  const mudarItem = (idx: number, m: Partial<OrcamentoItem>) => setItens((l) => l.map((x, k) => (k === idx ? { ...x, ...m } : x)));

  const trocarTabelaItem = (idx: number, tab: string) => {
    const it = itens[idx];
    const p = produtos.find((x) => x.id === it.produto_id);
    mudarItem(idx, { tabela_id: tab, preco: p ? precoTab(p, tab) : it.preco });
  };

  const trocarTabelaGeral = (tab: string) => {
    setTabelaId(tab);
    setItens((l) =>
      l.map((it) => {
        const p = produtos.find((x) => x.id === it.produto_id);
        return { ...it, tabela_id: tab, preco: p ? precoTab(p, tab) : it.preco };
      })
    );
  };

  const subtotal = subtotalDe(itens);
  const valorDesconto = Math.min(Math.max(num(desconto) || 0, 0), subtotal);
  const total = Math.max(subtotal - valorDesconto, 0);

  const salvar = async (status: 'aberto' | 'pronto') => {
    if (!itens.length) return setErro('Coloque pelo menos um produto.');
    setSalvando(true);
    setErro('');
    const payload = {
      status,
      cliente_id: cliente?.id || null,
      cliente_nome: cliente?.nome || null,
      tabela_id: tabelaId || null,
      itens,
      desconto: valorDesconto,
      total,
      validade: validade || null,
      observacao: observacao.trim() || null,
      vendedor: orcamento?.vendedor || loggedUser?.nome || loggedUser?.email || null,
    };
    const r = orcamento
      ? await supabase.from('orcamentos').update(payload).eq('id', orcamento.id).select('numero').single()
      : await supabase.from('orcamentos').insert([{ ...payload, codigo_loja: loggedUser?.codigo_loja }]).select('numero').single();
    setSalvando(false);
    if (r.error) return setErro(erroOrcamento(r.error.message));
    const n = (r.data as any)?.numero;
    aoVoltar(status === 'pronto' ? `Orçamento nº ${n} pronto: já aparece no PDV para carregar na venda.` : `Orçamento nº ${n} salvo (em aberto).`);
  };

  const campo = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-700';

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-black text-slate-800">{orcamento ? `📝 Orçamento nº ${orcamento.numero}` : '📝 Novo orçamento'}</h2>
        <button type="button" onClick={() => aoVoltar()} className="px-3 py-2 bg-slate-100 rounded-xl font-bold text-sm cursor-pointer">
          ← Voltar
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SeletorCliente cliente={cliente} aoMudar={setCliente} />
        {tabelas.length > 0 && (
          <select value={tabelaId} onChange={(e) => trocarTabelaGeral(e.target.value)} className={campo + ' font-bold bg-white'} aria-label="Tabela de preço">
            <option value="">Preço padrão</option>
            {tabelas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="relative">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && sugestoes[0]) {
              e.preventDefault();
              adicionar(sugestoes[0]);
            }
          }}
          placeholder="Buscar produto por nome, código ou código de barras"
          className="w-full px-3 py-3 rounded-xl border border-slate-300 text-sm outline-none focus:border-blue-700"
        />
        {sugestoes.length > 0 && (
          <ul className="absolute left-0 right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-xl shadow-xl max-h-72 overflow-y-auto divide-y">
            {sugestoes.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => adicionar(p)} className="w-full text-left px-3 py-2.5 flex justify-between gap-3 hover:bg-blue-50 cursor-pointer">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-bold text-slate-800 truncate">{p.nome}</span>
                    <span className="block text-[11px] text-slate-500">
                      {p.sku}
                      {p.codigo_barras ? ` · ${p.codigo_barras}` : ''}
                    </span>
                  </span>
                  <span className="font-black text-[13px] text-amber-600 whitespace-nowrap">{moeda(precoTab(p, tabelaId))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {itens.length === 0 && <p className="py-6 text-center text-xs text-slate-400">Nenhum item. Busque um produto acima.</p>}
        {itens.map((it, idx) => (
          <div key={it.produto_id} className="bg-slate-50 rounded-xl p-2.5 text-xs flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-bold text-slate-800 leading-tight">{it.nome}</p>
              {tabelas.length > 0 && (
                <select
                  value={it.tabela_id}
                  onChange={(e) => trocarTabelaItem(idx, e.target.value)}
                  className="mt-1 rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[11px] font-bold text-amber-900"
                >
                  <option value="">Padrão</option>
                  {tabelas.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <input
              key={it.quantidade}
              defaultValue={String(it.quantidade).replace('.', ',')}
              inputMode="decimal"
              onBlur={(e) => {
                const n = num(e.target.value);
                if (isFinite(n) && n > 0) mudarItem(idx, { quantidade: n });
              }}
              className="w-16 h-8 text-center rounded-lg border border-slate-300 font-bold"
              aria-label="Quantidade"
            />
            <span className="text-slate-500">
              {it.unidade} × {moeda(it.preco)}
            </span>
            <span className="w-24 text-right font-black text-slate-900">{moeda(Math.round(it.preco * it.quantidade * 100) / 100)}</span>
            <button type="button" onClick={() => setItens((l) => l.filter((_, k) => k !== idx))} className="text-rose-600 font-black cursor-pointer" aria-label="Remover">
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-[11px] font-bold text-slate-500">
          DESCONTO (R$)
          <input value={desconto} onChange={(e) => setDesconto(e.target.value)} inputMode="decimal" placeholder="0,00" className={campo + ' mt-1'} />
        </label>
        <label className="text-[11px] font-bold text-slate-500">
          VÁLIDO ATÉ
          <input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} className={campo + ' mt-1'} />
        </label>
        <div className="bg-slate-900 text-white rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-400">TOTAL</span>
          <span className="text-xl font-black text-amber-300">{moeda(total)}</span>
        </div>
      </div>
      <label className="block text-[11px] font-bold text-slate-500">
        OBSERVAÇÕES (saem na impressão)
        <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} className={campo + ' mt-1'} placeholder="Ex.: entrega em 5 dias, pagamento à vista" />
      </label>

      {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">{erro}</p>}

      <div className="flex flex-wrap gap-2 justify-end">
        <button type="button" onClick={() => salvar('aberto')} disabled={salvando} className="px-4 py-2.5 bg-slate-100 rounded-xl font-bold text-sm cursor-pointer disabled:opacity-50">
          Salvar em aberto
        </button>
        <button type="button" onClick={() => salvar('pronto')} disabled={salvando} className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm cursor-pointer disabled:opacity-50">
          {salvando ? 'Salvando...' : '✓ Salvar como pronto (vai para o PDV)'}
        </button>
      </div>
    </div>
  );
}
