// BR Sisloja - Fase 3 - Contas a Pagar
// As parcelas (duplicatas) entram sozinhas pela Entrada de Mercadoria (XML da NF-e).
// Aqui: ver por vencimento, ler o boleto e ligar à parcela certa, dar baixa e lançar contas avulsas.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { lerBoleto, formatarLinha, type Boleto } from './boleto';

type Usuario = { id: string; email: string; nome: string; perfil: string; codigo_loja: string; loja_nome: string };

type Conta = {
  id: string;
  codigo_loja: string;
  fornecedor_id: string | null;
  descricao: string;
  documento: string | null;
  valor: number;
  vencimento: string;
  status: 'aberto' | 'pago' | 'cancelado';
  forma: string | null;
  data_pagamento: string | null;
  valor_pago: number | null;
  juros: number | null;
  desconto: number | null;
  linha_digitavel: string | null;
  observacao: string | null;
  origem: string | null;
  origem_id: string | null;
  fornecedores?: { nome: string; nome_fantasia: string | null } | null;
};

type FornecedorRes = { id: string; nome: string; nome_fantasia: string | null; prazo_pagamento_dias: number | null };

type Filtro = 'abertas' | 'vencidas' | 'semana' | 'pagas' | 'todas';

export const FORMAS_PAGAMENTO = [
  { id: 'boleto', rotulo: 'Boleto' },
  { id: 'pix', rotulo: 'Pix' },
  { id: 'transferencia', rotulo: 'Transferência' },
  { id: 'dinheiro', rotulo: 'Dinheiro' },
  { id: 'cartao', rotulo: 'Cartão' },
  { id: 'debito_automatico', rotulo: 'Débito automático' },
  { id: 'cheque', rotulo: 'Cheque' },
];

const SELECT = '*, fornecedores(nome, nome_fantasia)';

const brl = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
const dataBR = (s: string | null | undefined) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');
const numInput = (s: string) => {
  const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const hojeISO = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no fuso do computador
export function somarDias(iso: string, dias: number) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString('sv-SE');
}
function somarMeses(iso: string, meses: number) {
  const [a, m, d] = iso.split('-').map(Number);
  const ultimo = new Date(a, m - 1 + meses + 1, 0).getDate();
  return new Date(a, m - 1 + meses, Math.min(d, ultimo), 12).toLocaleDateString('sv-SE');
}
export const diasAte = (iso: string) =>
  Math.round((new Date(iso + 'T12:00:00').getTime() - new Date(hojeISO() + 'T12:00:00').getTime()) / 86400000);
const diaSemana = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const nomeForn = (c: Conta) => c.fornecedores?.nome_fantasia || c.fornecedores?.nome || '—';

export default function ContasPagarModule({ loggedUser }: { loggedUser: Usuario }) {
  const perfil = (loggedUser?.perfil || '').toLowerCase();
  const podeEditar = ['admin', 'gerente', 'financeiro'].includes(perfil);
  const podeEstornar = ['admin', 'gerente'].includes(perfil);

  const [abertas, setAbertas] = useState<Conta[]>([]);
  const [historico, setHistorico] = useState<Conta[]>([]);
  const [fornecedores, setFornecedores] = useState<FornecedorRes[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const [filtro, setFiltro] = useState<Filtro>('abertas');
  const [de, setDe] = useState(() => hojeISO().slice(0, 8) + '01');
  const [ate, setAte] = useState(() => somarDias(somarMeses(hojeISO().slice(0, 8) + '01', 1), -1));
  const [busca, setBusca] = useState('');

  const [lendoBoleto, setLendoBoleto] = useState(false);
  const [form, setForm] = useState<Partial<Conta> | null>(null);
  const [baixa, setBaixa] = useState<Conta | null>(null);

  const carregarAbertas = async () => {
    const { data, error } = await supabase
      .from('contas_pagar')
      .select(SELECT)
      .eq('codigo_loja', loggedUser.codigo_loja)
      .eq('status', 'aberto')
      .order('vencimento')
      .limit(5000);
    if (error) {
      setErro(
        error.message.includes('column')
          ? 'Falta atualizar o banco: rode o arquivo fase3_financeiro.sql no SQL Editor do Supabase. (' + error.message + ')'
          : 'Erro ao carregar as contas: ' + error.message
      );
      return;
    }
    setAbertas((data as Conta[]) || []);
  };

  const carregarHistorico = async () => {
    const base = supabase.from('contas_pagar').select(SELECT).eq('codigo_loja', loggedUser.codigo_loja);
    const q =
      filtro === 'pagas'
        ? base.eq('status', 'pago').gte('data_pagamento', de).lte('data_pagamento', ate).order('data_pagamento')
        : base.gte('vencimento', de).lte('vencimento', ate).order('vencimento');
    const { data, error } = await q.limit(5000);
    if (error) return setErro('Erro ao carregar as contas: ' + error.message);
    setHistorico((data as Conta[]) || []);
  };

  const recarregar = async () => {
    setCarregando(true);
    setErro('');
    await carregarAbertas();
    if (filtro === 'pagas' || filtro === 'todas') await carregarHistorico();
    setCarregando(false);
  };

  useEffect(() => {
    recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedUser.codigo_loja, filtro, de, ate]);

  useEffect(() => {
    supabase
      .from('fornecedores')
      .select('id, nome, nome_fantasia, prazo_pagamento_dias')
      .eq('codigo_loja', loggedUser.codigo_loja)
      .eq('ativo', true)
      .order('nome')
      .then(({ data }) => setFornecedores((data as FornecedorRes[]) || []));
  }, [loggedUser.codigo_loja]);

  const resumo = useMemo(() => {
    const soma = (l: Conta[]) => r2(l.reduce((s, c) => s + Number(c.valor), 0));
    const vencidas = abertas.filter((c) => diasAte(c.vencimento) < 0);
    const hoje = abertas.filter((c) => diasAte(c.vencimento) === 0);
    const semana = abertas.filter((c) => diasAte(c.vencimento) > 0 && diasAte(c.vencimento) <= 7);
    return {
      vencidas: { qtd: vencidas.length, total: soma(vencidas) },
      hoje: { qtd: hoje.length, total: soma(hoje) },
      semana: { qtd: semana.length, total: soma(semana) },
      aberto: { qtd: abertas.length, total: soma(abertas) },
    };
  }, [abertas]);

  const visiveis = useMemo(() => {
    let l: Conta[] =
      filtro === 'abertas'
        ? abertas
        : filtro === 'vencidas'
        ? abertas.filter((c) => diasAte(c.vencimento) < 0)
        : filtro === 'semana'
        ? abertas.filter((c) => diasAte(c.vencimento) <= 7)
        : historico;
    const t = busca.trim().toLowerCase();
    if (t) {
      l = l.filter((c) =>
        [nomeForn(c), c.fornecedores?.nome, c.descricao, c.documento].some((x) => (x || '').toLowerCase().includes(t))
      );
    }
    return l;
  }, [filtro, abertas, historico, busca]);

  // agrupa por dia (vencimento, ou data do pagamento na visão "pagas")
  const grupos = useMemo(() => {
    const mapa = new Map<string, Conta[]>();
    for (const c of visiveis) {
      const dia = (filtro === 'pagas' ? c.data_pagamento : c.vencimento) || c.vencimento;
      if (!mapa.has(dia)) mapa.set(dia, []);
      mapa.get(dia)!.push(c);
    }
    return Array.from(mapa.entries());
  }, [visiveis, filtro]);

  const totalVisivel = r2(visiveis.reduce((s, c) => s + Number(c.status === 'pago' ? c.valor_pago ?? c.valor : c.valor), 0));

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setAviso('Linha digitável copiada. Cole no app do banco para pagar.');
    } catch {
      window.prompt('Copie a linha digitável:', texto);
    }
  };

  const cancelar = async (c: Conta) => {
    if (!window.confirm(`Cancelar a conta "${c.descricao}" de ${brl(c.valor)}?\nEla deixa de aparecer nas contas em aberto.`)) return;
    const { error } = await supabase.from('contas_pagar').update({ status: 'cancelado' }).eq('id', c.id);
    if (error) return setErro('Não foi possível cancelar: ' + error.message);
    recarregar();
  };

  const reabrir = async (c: Conta) => {
    if (!window.confirm(`Desfazer o pagamento / cancelamento de "${c.descricao}"?\nA conta volta para "em aberto".`)) return;
    const { error } = await supabase
      .from('contas_pagar')
      .update({ status: 'aberto', data_pagamento: null, valor_pago: null, juros: 0, desconto: 0, forma: null })
      .eq('id', c.id);
    if (error) return setErro('Não foi possível reabrir: ' + error.message);
    recarregar();
  };

  const novaConta = (parcial: Partial<Conta> = {}) =>
    setForm({ descricao: '', documento: '', valor: 0, vencimento: hojeISO(), fornecedor_id: null, linha_digitavel: null, observacao: '', ...parcial });

  return (
    <div className="space-y-4">
      {/* resumo */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cartao titulo="Vencidas" cor="red" qtd={resumo.vencidas.qtd} total={resumo.vencidas.total} onClick={() => setFiltro('vencidas')} />
        <Cartao titulo="Vencem hoje" cor="amber" qtd={resumo.hoje.qtd} total={resumo.hoje.total} onClick={() => setFiltro('semana')} />
        <Cartao titulo="Próximos 7 dias" cor="blue" qtd={resumo.semana.qtd} total={resumo.semana.total} onClick={() => setFiltro('semana')} />
        <Cartao titulo="Total em aberto" cor="gray" qtd={resumo.aberto.qtd} total={resumo.aberto.total} onClick={() => setFiltro('abertas')} />
      </div>

      {/* barra de ações e filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-sm">
        {(
          [
            ['abertas', 'Em aberto'],
            ['vencidas', 'Vencidas'],
            ['semana', 'Até 7 dias'],
            ['pagas', 'Pagas'],
            ['todas', 'Todas'],
          ] as [Filtro, string][]
        ).map(([id, rot]) => (
          <button
            key={id}
            onClick={() => setFiltro(id)}
            className={`rounded-lg px-3 py-1.5 text-sm ${filtro === id ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            {rot}
          </button>
        ))}
        {(filtro === 'pagas' || filtro === 'todas') && (
          <span className="flex items-center gap-1 text-sm text-gray-600">
            {filtro === 'pagas' ? 'pagas de' : 'vencimento de'}
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded border px-2 py-1" />
            até
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded border px-2 py-1" />
          </span>
        )}
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar fornecedor, descrição, nº…"
          className="min-w-[180px] flex-1 rounded-lg border px-3 py-1.5 text-sm"
        />
        {podeEditar && (
          <>
            <button onClick={() => setLendoBoleto(true)} className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-900">
              ▥ Ler boleto
            </button>
            <button onClick={() => novaConta()} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              + Nova conta
            </button>
          </>
        )}
      </div>

      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {aviso && (
        <p className="flex items-center rounded-lg bg-green-50 p-3 text-sm text-green-800">
          <span className="flex-1">{aviso}</span>
          <button onClick={() => setAviso('')} className="ml-2 text-green-700">✕</button>
        </p>
      )}

      {/* lista agrupada por dia */}
      <div className="rounded-xl bg-white shadow-sm">
        {carregando ? (
          <p className="p-6 text-center text-sm text-gray-500">Carregando…</p>
        ) : !visiveis.length ? (
          <p className="p-6 text-center text-sm text-gray-500">Nenhuma conta aqui.</p>
        ) : (
          <>
            {grupos.map(([dia, contas]) => {
              const d = diasAte(dia);
              const corDia = filtro === 'pagas' ? 'text-gray-700' : d < 0 ? 'text-red-700' : d === 0 ? 'text-amber-700' : 'text-gray-700';
              return (
                <div key={dia} className="border-b last:border-b-0">
                  <div className={`flex items-center justify-between bg-gray-50 px-4 py-2 text-sm font-semibold ${corDia}`}>
                    <span className="capitalize">{diaSemana(dia)}</span>
                    <span>{brl(contas.reduce((s, c) => s + Number(c.valor), 0))}</span>
                  </div>
                  {contas.map((c) => (
                    <Linha
                      key={c.id}
                      c={c}
                      podeEditar={podeEditar}
                      podeEstornar={podeEstornar}
                      aoPagar={() => setBaixa(c)}
                      aoEditar={() => setForm(c)}
                      aoCancelar={() => cancelar(c)}
                      aoReabrir={() => reabrir(c)}
                      aoCopiar={copiar}
                    />
                  ))}
                </div>
              );
            })}
            <div className="flex justify-end px-4 py-3 text-sm font-bold text-gray-800">
              {visiveis.length} conta(s) · {brl(totalVisivel)}
            </div>
          </>
        )}
      </div>

      {lendoBoleto && (
        <LerBoleto
          abertas={abertas}
          codigoLoja={loggedUser.codigo_loja}
          aoFechar={() => setLendoBoleto(false)}
          aoVincular={(msg) => {
            setLendoBoleto(false);
            setAviso(msg);
            recarregar();
          }}
          aoNovaConta={(b) => {
            setLendoBoleto(false);
            novaConta({
              valor: b.valor,
              vencimento: b.vencimento || hojeISO(),
              linha_digitavel: b.linha_digitavel,
              descricao: b.tipo === 'arrecadacao' ? 'Conta de consumo / tributo' : '',
            });
          }}
        />
      )}
      {form && (
        <FormConta
          inicial={form}
          fornecedores={fornecedores}
          codigoLoja={loggedUser.codigo_loja}
          aoFechar={() => setForm(null)}
          aoSalvar={(msg) => {
            setForm(null);
            setAviso(msg);
            recarregar();
          }}
        />
      )}
      {baixa && (
        <Baixa
          conta={baixa}
          aoFechar={() => setBaixa(null)}
          aoSalvar={(msg) => {
            setBaixa(null);
            setAviso(msg);
            recarregar();
          }}
        />
      )}
    </div>
  );
}

// =====================================================================
function Cartao({ titulo, cor, qtd, total, onClick }: { titulo: string; cor: 'red' | 'amber' | 'blue' | 'gray'; qtd: number; total: number; onClick: () => void }) {
  const cores = {
    red: 'border-red-500 text-red-700',
    amber: 'border-amber-500 text-amber-700',
    blue: 'border-blue-500 text-blue-700',
    gray: 'border-gray-400 text-gray-800',
  };
  return (
    <button onClick={onClick} className={`rounded-xl border-l-4 bg-white p-3 text-left shadow-sm hover:shadow ${cores[cor]}`}>
      <div className="text-xs font-medium uppercase text-gray-500">{titulo}</div>
      <div className="text-lg font-bold">{brl(total)}</div>
      <div className="text-xs text-gray-500">{qtd} conta(s)</div>
    </button>
  );
}

function Situacao({ c }: { c: Conta }) {
  if (c.status === 'pago')
    return <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Paga {dataBR(c.data_pagamento)}</span>;
  if (c.status === 'cancelado') return <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">Cancelada</span>;
  const d = diasAte(c.vencimento);
  if (d < 0) return <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Vencida há {-d} dia(s)</span>;
  if (d === 0) return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Vence hoje</span>;
  return <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">Em {d} dia(s)</span>;
}

function Linha({
  c,
  podeEditar,
  podeEstornar,
  aoPagar,
  aoEditar,
  aoCancelar,
  aoReabrir,
  aoCopiar,
}: {
  c: Conta;
  podeEditar: boolean;
  podeEstornar: boolean;
  aoPagar: () => void;
  aoEditar: () => void;
  aoCancelar: () => void;
  aoReabrir: () => void;
  aoCopiar: (t: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-sm first:border-t-0">
      <div className="min-w-[200px] flex-1">
        <div className="font-medium text-gray-800">{nomeForn(c)}</div>
        <div className="text-xs text-gray-500">
          {c.descricao}
          {c.documento && ` · nº ${c.documento}`}
          {c.origem === 'nota_entrada' && ' · NF-e'}
        </div>
      </div>
      <div className="w-24 text-xs text-gray-500">vence {dataBR(c.vencimento)}</div>
      <Situacao c={c} />
      {c.linha_digitavel ? (
        <button
          onClick={() => aoCopiar(c.linha_digitavel!)}
          title={formatarLinha(c.linha_digitavel)}
          className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100"
        >
          ▥ copiar boleto
        </button>
      ) : (
        <span className="w-[92px] text-xs text-gray-400">{c.status === 'aberto' ? 'sem boleto' : ''}</span>
      )}
      <div className="w-28 text-right font-semibold text-gray-800">
        {brl(c.status === 'pago' ? c.valor_pago ?? c.valor : c.valor)}
        {c.status === 'pago' && c.valor_pago != null && Number(c.valor_pago) !== Number(c.valor) && (
          <div className="text-[11px] font-normal text-gray-500">original {brl(c.valor)}</div>
        )}
      </div>
      <div className="flex w-full justify-end gap-1 sm:w-auto">
        {podeEditar && c.status === 'aberto' && (
          <>
            <button onClick={aoPagar} className="rounded bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700">
              Pagar
            </button>
            <button onClick={aoEditar} className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100">
              Editar
            </button>
            <button onClick={aoCancelar} className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">
              Cancelar
            </button>
          </>
        )}
        {podeEstornar && c.status !== 'aberto' && (
          <button onClick={aoReabrir} className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100">
            Reabrir
          </button>
        )}
      </div>
    </div>
  );
}

function Janela({ titulo, aoFechar, children }: { titulo: string; aoFechar: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-8" onMouseDown={aoFechar}>
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center">
          <h3 className="flex-1 text-lg font-bold text-gray-800">{titulo}</h3>
          <button onClick={aoFechar} className="text-gray-500 hover:text-gray-800">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// =====================================================================
// LER BOLETO -> achar a parcela (mesmo valor, vencimento mais próximo) e gravar a linha digitável nela
// =====================================================================
function LerBoleto({
  abertas,
  codigoLoja,
  aoFechar,
  aoVincular,
  aoNovaConta,
}: {
  abertas: Conta[];
  codigoLoja: string;
  aoFechar: () => void;
  aoVincular: (msg: string) => void;
  aoNovaConta: (b: Boleto) => void;
}) {
  const [codigo, setCodigo] = useState('');
  const [boleto, setBoleto] = useState<Boleto | null>(null);
  const [erro, setErro] = useState('');
  const [jaLancada, setJaLancada] = useState<Conta | null>(null);
  const [usarVencimento, setUsarVencimento] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => ref.current?.focus(), []);

  const ler = async (texto: string) => {
    setErro('');
    setBoleto(null);
    setJaLancada(null);
    if (!texto.trim()) return;
    try {
      const b = lerBoleto(texto);
      setBoleto(b);
      const { data } = await supabase
        .from('contas_pagar')
        .select(SELECT)
        .eq('codigo_loja', codigoLoja)
        .eq('linha_digitavel', b.linha_digitavel)
        .neq('status', 'cancelado')
        .maybeSingle();
      setJaLancada((data as Conta) || null);
    } catch (e: any) {
      setErro(e.message);
    }
  };

  // parcelas candidatas: mesmo valor (ou todas, se o boleto não traz valor), sem boleto ainda; vencimento mais próximo primeiro
  const candidatas = useMemo(() => {
    if (!boleto) return [];
    const venc = boleto.vencimento;
    const dist = (c: Conta) => (venc ? Math.abs(diasAte(c.vencimento) - diasAte(venc)) : Math.abs(diasAte(c.vencimento)));
    return abertas
      .filter((c) => !c.linha_digitavel)
      .filter((c) => !boleto.valor || Math.abs(Number(c.valor) - boleto.valor) < 0.01)
      .sort((a, b) => dist(a) - dist(b))
      .slice(0, 8);
  }, [boleto, abertas]);

  const vincular = async (c: Conta) => {
    if (!boleto) return;
    setSalvando(true);
    const dados: any = { linha_digitavel: boleto.linha_digitavel };
    if (usarVencimento && boleto.vencimento && boleto.vencimento !== c.vencimento) dados.vencimento = boleto.vencimento;
    const { error } = await supabase.from('contas_pagar').update(dados).eq('id', c.id);
    setSalvando(false);
    if (error) return setErro('Não foi possível gravar: ' + error.message);
    aoVincular(`Boleto ligado à conta de ${nomeForn(c)} (${brl(c.valor)}, vence ${dataBR(dados.vencimento || c.vencimento)}).`);
  };

  return (
    <Janela titulo="Ler boleto" aoFechar={aoFechar}>
      <p className="mb-2 text-sm text-gray-600">
        Passe o leitor no código de barras ou digite/cole a linha digitável e tecle Enter.
      </p>
      <input
        ref={ref}
        value={codigo}
        onChange={(e) => setCodigo(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && ler(codigo)}
        onPaste={(e) => {
          const t = e.clipboardData.getData('text');
          setTimeout(() => ler(t), 0);
        }}
        placeholder="00190.00009 01234.567890 ..."
        className="w-full rounded-lg border px-3 py-2 font-mono text-sm"
      />
      <button onClick={() => ler(codigo)} className="mt-2 rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white">
        Ler
      </button>
      {erro && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      {boleto && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg bg-gray-50 p-3 text-sm">
            <div className="font-mono text-xs text-gray-600">{formatarLinha(boleto.linha_digitavel)}</div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div>
                <div className="text-xs text-gray-500">Banco</div>
                <div className="font-medium">{boleto.banco}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Vencimento</div>
                <div className="font-medium">{boleto.vencimento ? dataBR(boleto.vencimento) : 'não informado'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Valor</div>
                <div className="font-medium">{boleto.valor ? brl(boleto.valor) : 'não informado'}</div>
              </div>
            </div>
            {!boleto.dv_ok && (
              <p className="mt-2 text-xs font-medium text-red-700">⚠ O dígito verificador não confere. Confira se o código foi digitado certo.</p>
            )}
          </div>

          {jaLancada ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              Este boleto já está lançado: {nomeForn(jaLancada)} · {brl(jaLancada.valor)} · vence {dataBR(jaLancada.vencimento)} (
              {jaLancada.status === 'pago' ? 'paga' : 'em aberto'}).
            </p>
          ) : (
            <>
              <div className="text-sm font-semibold text-gray-800">
                {candidatas.length ? 'Qual parcela é este boleto?' : 'Nenhuma conta em aberto com esse valor.'}
              </div>
              {candidatas.length > 0 && boleto.vencimento && (
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={usarVencimento} onChange={(e) => setUsarVencimento(e.target.checked)} />
                  se a data for diferente, usar o vencimento do boleto
                </label>
              )}
              <div className="divide-y rounded-lg border">
                {candidatas.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <div className="flex-1">
                      <div className="font-medium">
                        {nomeForn(c)} {i === 0 && <span className="ml-1 rounded bg-green-100 px-1.5 text-[11px] text-green-800">mais provável</span>}
                      </div>
                      <div className="text-xs text-gray-500">
                        {c.descricao} · vence {dataBR(c.vencimento)} · {brl(c.valor)}
                      </div>
                    </div>
                    <button
                      disabled={salvando}
                      onClick={() => vincular(c)}
                      className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      É esta
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={() => aoNovaConta(boleto)} className="text-sm font-medium text-blue-700 hover:underline">
                + Não é nenhuma destas: lançar como conta nova
              </button>
            </>
          )}
        </div>
      )}
    </Janela>
  );
}

// =====================================================================
// NOVA CONTA / EDITAR (com opção de repetir todo mês: aluguel, luz, internet…)
// =====================================================================
function FormConta({
  inicial,
  fornecedores,
  codigoLoja,
  aoFechar,
  aoSalvar,
}: {
  inicial: Partial<Conta>;
  fornecedores: FornecedorRes[];
  codigoLoja: string;
  aoFechar: () => void;
  aoSalvar: (msg: string) => void;
}) {
  const editando = !!inicial.id;
  const [f, setF] = useState({
    fornecedor_id: inicial.fornecedor_id || '',
    descricao: inicial.descricao || '',
    documento: inicial.documento || '',
    valor: inicial.valor ? String(inicial.valor).replace('.', ',') : '',
    vencimento: inicial.vencimento || hojeISO(),
    linha_digitavel: inicial.linha_digitavel || '',
    observacao: inicial.observacao || '',
  });
  const [parcelas, setParcelas] = useState(1);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const set = (campo: keyof typeof f, v: string) => setF((x) => ({ ...x, [campo]: v }));

  const aoMudarLinha = (v: string) => {
    set('linha_digitavel', v);
    try {
      const b = lerBoleto(v);
      setF((x) => ({
        ...x,
        linha_digitavel: b.linha_digitavel,
        valor: b.valor ? String(b.valor).replace('.', ',') : x.valor,
        vencimento: b.vencimento || x.vencimento,
      }));
    } catch {
      /* ainda digitando */
    }
  };

  const salvar = async () => {
    const valor = numInput(f.valor);
    if (!f.descricao.trim()) return setErro('Informe a descrição (ex.: Aluguel, Energia, NF 1234).');
    if (valor <= 0) return setErro('Informe o valor.');
    if (!f.vencimento) return setErro('Informe o vencimento.');
    let linha: string | null = null;
    if (f.linha_digitavel.trim()) {
      try {
        linha = lerBoleto(f.linha_digitavel).linha_digitavel;
      } catch (e: any) {
        return setErro(e.message);
      }
    }
    setSalvando(true);
    setErro('');
    const base = {
      codigo_loja: codigoLoja,
      fornecedor_id: f.fornecedor_id || null,
      descricao: f.descricao.trim(),
      documento: f.documento.trim() || null,
      valor: r2(valor),
      observacao: f.observacao.trim() || null,
    };
    let error;
    if (editando) {
      ({ error } = await supabase
        .from('contas_pagar')
        .update({ ...base, vencimento: f.vencimento, linha_digitavel: linha })
        .eq('id', inicial.id!));
    } else {
      const n = Math.max(1, Math.min(120, parcelas));
      const linhas = Array.from({ length: n }, (_, i) => ({
        ...base,
        descricao: n > 1 ? `${base.descricao} (${i + 1}/${n})` : base.descricao,
        vencimento: somarMeses(f.vencimento, i),
        linha_digitavel: i === 0 ? linha : null,
        origem: 'manual',
      }));
      ({ error } = await supabase.from('contas_pagar').insert(linhas));
    }
    setSalvando(false);
    if (error) return setErro('Não foi possível salvar: ' + error.message);
    aoSalvar(editando ? 'Conta alterada.' : parcelas > 1 ? `${parcelas} contas lançadas.` : 'Conta lançada.');
  };

  return (
    <Janela titulo={editando ? 'Editar conta' : 'Nova conta a pagar'} aoFechar={aoFechar}>
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="text-gray-600">Fornecedor / favorecido</span>
          <select value={f.fornecedor_id} onChange={(e) => set('fornecedor_id', e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2">
            <option value="">— sem fornecedor —</option>
            {fornecedores.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nome_fantasia || x.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-gray-600">Descrição</span>
          <input value={f.descricao} onChange={(e) => set('descricao', e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="text-gray-600">Nº documento</span>
            <input value={f.documento} onChange={(e) => set('documento', e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
          </label>
          <label className="block">
            <span className="text-gray-600">Valor</span>
            <input value={f.valor} onChange={(e) => set('valor', e.target.value)} inputMode="decimal" placeholder="0,00" className="mt-1 w-full rounded-lg border px-3 py-2 text-right" />
          </label>
          <label className="block">
            <span className="text-gray-600">{parcelas > 1 ? '1º vencimento' : 'Vencimento'}</span>
            <input type="date" value={f.vencimento} onChange={(e) => set('vencimento', e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2" />
          </label>
        </div>
        <label className="block">
          <span className="text-gray-600">Linha digitável do boleto (opcional, preenche valor e vencimento)</span>
          <input value={f.linha_digitavel} onChange={(e) => aoMudarLinha(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-xs" />
        </label>
        {!editando && (
          <label className="flex items-center gap-2">
            <span className="text-gray-600">Repetir</span>
            <input
              type="number"
              min={1}
              max={120}
              value={parcelas}
              onChange={(e) => setParcelas(parseInt(e.target.value, 10) || 1)}
              className="w-16 rounded-lg border px-2 py-1 text-right"
            />
            <span className="text-gray-600">vez(es), todo mês no mesmo dia</span>
          </label>
        )}
        <label className="block">
          <span className="text-gray-600">Observação</span>
          <input value={f.observacao} onChange={(e) => set('observacao', e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
        </label>
        {erro && <p className="rounded-lg bg-red-50 p-3 text-red-700">{erro}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={aoFechar} className="rounded-lg px-4 py-2 text-gray-600 hover:bg-gray-100">
            Voltar
          </button>
          <button onClick={salvar} disabled={salvando} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </Janela>
  );
}

// =====================================================================
// BAIXA (PAGAMENTO)
// =====================================================================
function Baixa({ conta, aoFechar, aoSalvar }: { conta: Conta; aoFechar: () => void; aoSalvar: (msg: string) => void }) {
  const [data, setData] = useState(hojeISO());
  const [forma, setForma] = useState(conta.linha_digitavel ? 'boleto' : 'pix');
  const [juros, setJuros] = useState('');
  const [desconto, setDesconto] = useState('');
  const [obs, setObs] = useState(conta.observacao || '');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const pago = r2(Number(conta.valor) + numInput(juros) - numInput(desconto));

  const salvar = async () => {
    if (pago <= 0) return setErro('O valor pago precisa ser maior que zero.');
    setSalvando(true);
    const { error } = await supabase
      .from('contas_pagar')
      .update({
        status: 'pago',
        data_pagamento: data,
        forma,
        juros: r2(numInput(juros)),
        desconto: r2(numInput(desconto)),
        valor_pago: pago,
        observacao: obs.trim() || null,
      })
      .eq('id', conta.id)
      .eq('status', 'aberto');
    setSalvando(false);
    if (error) return setErro('Não foi possível dar baixa: ' + error.message);
    aoSalvar(`Pagamento de ${brl(pago)} registrado (${nomeForn(conta)}).`);
  };

  return (
    <Janela titulo="Dar baixa (pagar)" aoFechar={aoFechar}>
      <div className="space-y-3 text-sm">
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="font-medium">{nomeForn(conta)}</div>
          <div className="text-xs text-gray-500">
            {conta.descricao} · vence {dataBR(conta.vencimento)} · {brl(conta.valor)}
          </div>
          {conta.linha_digitavel && <div className="mt-1 font-mono text-[11px] text-gray-600">{formatarLinha(conta.linha_digitavel)}</div>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-gray-600">Data do pagamento</span>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2" />
          </label>
          <label className="block">
            <span className="text-gray-600">Forma</span>
            <select value={forma} onChange={(e) => setForma(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2">
              {FORMAS_PAGAMENTO.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.rotulo}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-gray-600">Juros / multa</span>
            <input value={juros} onChange={(e) => setJuros(e.target.value)} inputMode="decimal" placeholder="0,00" className="mt-1 w-full rounded-lg border px-3 py-2 text-right" />
          </label>
          <label className="block">
            <span className="text-gray-600">Desconto</span>
            <input value={desconto} onChange={(e) => setDesconto(e.target.value)} inputMode="decimal" placeholder="0,00" className="mt-1 w-full rounded-lg border px-3 py-2 text-right" />
          </label>
        </div>
        <label className="block">
          <span className="text-gray-600">Observação</span>
          <input value={obs} onChange={(e) => setObs(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
        </label>
        <div className="flex items-center justify-between rounded-lg bg-green-50 p-3">
          <span className="text-green-800">Valor pago</span>
          <span className="text-lg font-bold text-green-800">{brl(pago)}</span>
        </div>
        {erro && <p className="rounded-lg bg-red-50 p-3 text-red-700">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={aoFechar} className="rounded-lg px-4 py-2 text-gray-600 hover:bg-gray-100">
            Voltar
          </button>
          <button onClick={salvar} disabled={salvando} className="rounded-lg bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-700 disabled:opacity-50">
            {salvando ? 'Gravando…' : '✓ Confirmar pagamento'}
          </button>
        </div>
      </div>
    </Janela>
  );
}
