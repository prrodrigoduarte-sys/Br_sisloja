// BR Sisloja - Contas & Caixa
// Saldos de cada conta (caixa da loja, banco...), extrato (conta corrente), lançamentos manuais, transferências
// (sangria/depósito), fluxo de caixa (realizado + previsto) e cadastro de contas com o destino de cada forma de pagamento.
// Vendas, recebimentos e pagamentos entram no extrato sozinhos (fase13_contas_caixa.sql).
import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { buscarTodos } from './buscarTodos';

type Usuario = { id: string; email: string; nome: string; perfil: string; codigo_loja: string; loja_nome: string };
type Conta = {
  id: string;
  nome: string;
  tipo: string;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  saldo_inicial: number;
  data_saldo_inicial: string;
  ativo: boolean;
};
type Mov = { id: string; conta_id: string; data: string; tipo: 'entrada' | 'saida'; valor: number; descricao: string; categoria: string | null; origem: string; usuario: string | null };

const TIPOS: Record<string, string> = { caixa: '💵 Caixa', banco: '🏦 Banco (conta corrente)', carteira: '📱 Carteira digital', maquininha: '💳 Maquininha', outra: 'Outra' };
const FORMAS: { id: string; rotulo: string }[] = [
  { id: 'dinheiro', rotulo: 'Dinheiro' },
  { id: 'pix', rotulo: 'Pix' },
  { id: 'cartao_debito', rotulo: 'Cartão de débito' },
  { id: 'cartao_credito', rotulo: 'Cartão de crédito' },
  { id: 'transferencia', rotulo: 'Transferência' },
  { id: 'boleto', rotulo: 'Boleto' },
  { id: 'cheque', rotulo: 'Cheque' },
  { id: 'cartao', rotulo: 'Cartão (pagamentos)' },
  { id: 'debito_automatico', rotulo: 'Débito automático' },
];
const ORIGENS: Record<string, string> = { venda: 'Venda PDV', receber: 'Contas a receber', pagar: 'Contas a pagar', transferencia: 'Transferência', manual: 'Lançamento manual' };

const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const hojeISO = () => new Date().toLocaleDateString('sv-SE');
const somarDias = (iso: string, d: number) => {
  const x = new Date(iso + 'T12:00:00');
  x.setDate(x.getDate() + d);
  return x.toLocaleDateString('sv-SE');
};
const dataBR = (s: string) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');
const diaSemana = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' });
const numInput = (s: string) => {
  const t = String(s ?? '').replace(/\s/g, '');
  const n = parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return isFinite(n) ? n : 0;
};
const erroBanco = (m: string) =>
  /contas_financeiras|movimentos_financeiros|fin_saldos|fin_lancar|fin_transferir|formas_destino/.test(m)
    ? 'Falta atualizar o banco: rode o arquivo fase13_contas_caixa.sql no SQL Editor do Supabase.'
    : m;

async function saldos(ate?: string) {
  const { data, error } = await supabase.rpc('fin_saldos', { p_ate: ate || null });
  const m: Record<string, number> = {};
  ((data as any[]) || []).forEach((x) => (m[x.conta_id] = Number(x.saldo)));
  return { m, error };
}

export default function CaixaModule({ loggedUser }: { loggedUser: Usuario }) {
  const [sub, setSub] = useState<'extrato' | 'fluxo' | 'cadastro'>('extrato');
  const [contas, setContas] = useState<Conta[]>([]);
  const [erro, setErro] = useState('');
  const [versao, setVersao] = useState(0);
  const podeExcluir = ['admin', 'gerente'].includes((loggedUser.perfil || '').toLowerCase());

  useEffect(() => {
    supabase
      .from('contas_financeiras')
      .select('*')
      .order('created_at')
      .then(({ data, error }) => {
        if (error) return setErro(erroBanco(error.message));
        setErro('');
        setContas(((data as any[]) || []).map((c) => ({ ...c, saldo_inicial: Number(c.saldo_inicial) })));
      });
  }, [versao]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['extrato', '💰 Saldos e extrato'],
            ['fluxo', '📈 Fluxo de caixa'],
            ['cadastro', '⚙️ Cadastro de contas'],
          ] as const
        ).map(([id, rot]) => (
          <button
            key={id}
            onClick={() => setSub(id)}
            className={`rounded-lg px-3 py-1.5 text-sm ${sub === id ? 'bg-blue-900 text-white' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-50'}`}
          >
            {rot}
          </button>
        ))}
      </div>
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {!erro && sub === 'extrato' && <Extrato contas={contas} podeExcluir={podeExcluir} lojaNome={loggedUser.loja_nome} />}
      {!erro && sub === 'fluxo' && <Fluxo contas={contas} lojaNome={loggedUser.loja_nome} />}
      {!erro && sub === 'cadastro' && <Cadastro contas={contas} codigoLoja={loggedUser.codigo_loja} aoMudar={() => setVersao((v) => v + 1)} />}
    </div>
  );
}

// =====================================================================
// SALDOS + EXTRATO (conta corrente / caixa)
// =====================================================================
function Extrato({ contas, podeExcluir, lojaNome }: { contas: Conta[]; podeExcluir: boolean; lojaNome: string }) {
  const ativas = contas.filter((c) => c.ativo);
  const [contaId, setContaId] = useState('');
  const [de, setDe] = useState(() => hojeISO().slice(0, 8) + '01');
  const [ate, setAte] = useState(hojeISO);
  const [saldoAtual, setSaldoAtual] = useState<Record<string, number>>({});
  const [saldoAnterior, setSaldoAnterior] = useState(0);
  const [movs, setMovs] = useState<Mov[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [modal, setModal] = useState<'entrada' | 'saida' | 'transferencia' | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (!contaId && ativas.length) setContaId(ativas[0].id);
  }, [ativas, contaId]);

  useEffect(() => {
    saldos().then(({ m, error }) => (error ? setErro(erroBanco(error.message)) : setSaldoAtual(m)));
  }, [versao, contas]);

  useEffect(() => {
    if (!contaId) return;
    (async () => {
      setCarregando(true);
      const conta = contas.find((c) => c.id === contaId);
      // saldo no fim do dia anterior ao período (antes do saldo inicial, a conta não existia: 0)
      const antes = somarDias(de, -1);
      const { m } = await saldos(antes);
      setSaldoAnterior(conta && de <= conta.data_saldo_inicial ? (de === conta.data_saldo_inicial ? conta.saldo_inicial : 0) : m[contaId] ?? 0);
      const r = await buscarTodos(() =>
        supabase.from('movimentos_financeiros').select('*').eq('conta_id', contaId).gte('data', de).lte('data', ate).order('data').order('created_at').order('id')
      );
      setCarregando(false);
      if (r.error) return setErro(erroBanco(r.error.message));
      setMovs(((r.data as any[]) || []).map((x) => ({ ...x, valor: Number(x.valor) })));
    })();
  }, [contaId, de, ate, versao, contas]);

  const conta = contas.find((c) => c.id === contaId);
  // linhas com saldo corrido (o saldo inicial da conta entra como linha no dia dele)
  const linhas = useMemo(() => {
    let s = saldoAnterior;
    return movs.map((m) => {
      if (conta && m.data < conta.data_saldo_inicial) return { ...m, saldo: null as number | null, historico: true };
      s = r2(s + (m.tipo === 'entrada' ? m.valor : -m.valor));
      return { ...m, saldo: s as number | null, historico: false };
    });
  }, [movs, saldoAnterior, conta]);
  const validas = linhas.filter((l) => !l.historico);
  const entradas = r2(validas.filter((l) => l.tipo === 'entrada').reduce((s, l) => s + l.valor, 0));
  const saidas = r2(validas.filter((l) => l.tipo === 'saida').reduce((s, l) => s + l.valor, 0));
  const saldoFinal = r2(saldoAnterior + entradas - saidas);
  const total = r2(ativas.reduce((s, c) => s + (saldoAtual[c.id] ?? c.saldo_inicial), 0));

  const excluir = async (m: Mov) => {
    if (!window.confirm(`Excluir "${m.descricao}" (${brl(m.valor)})?${m.origem === 'transferencia' ? '\nAs duas pontas da transferência saem.' : ''}`)) return;
    const { error } = await supabase.rpc('fin_excluir', { p_id: m.id });
    if (error) return setErro(error.message);
    setAviso('Lançamento excluído.');
    setVersao((v) => v + 1);
  };

  const exportarCsv = () => {
    const q = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const n = (x: number | null) => (x == null ? '' : String(x).replace('.', ','));
    const l = [
      ['Data', 'Descrição', 'Categoria', 'Origem', 'Entrada', 'Saída', 'Saldo'].map(q).join(';'),
      ['', 'Saldo anterior', '', '', '', '', n(saldoAnterior)].map(q).join(';'),
      ...linhas.map((m) => [dataBR(m.data), m.descricao, m.categoria || '', ORIGENS[m.origem] || m.origem, m.tipo === 'entrada' ? n(m.valor) : '', m.tipo === 'saida' ? n(m.valor) : '', n(m.saldo)].map(q).join(';')),
    ];
    const blob = new Blob(['﻿' + l.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `extrato-${(conta?.nome || 'conta').replace(/[^\w-]+/g, '-')}-${de}-a-${ate}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!ativas.length) return <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm">Nenhuma conta cadastrada. Vá em ⚙️ Cadastro de contas.</p>;

  return (
    <div className="space-y-4">
      {/* saldos */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ativas.map((c) => {
          const s = saldoAtual[c.id] ?? c.saldo_inicial;
          return (
            <button
              key={c.id}
              onClick={() => setContaId(c.id)}
              className={`rounded-xl bg-white p-3 text-left shadow-sm ${contaId === c.id ? 'ring-2 ring-blue-700' : 'hover:ring-2 hover:ring-gray-200'}`}
            >
              <div className="text-[11px] font-medium uppercase text-gray-500">{TIPOS[c.tipo]?.split(' ')[0]} {c.nome}</div>
              <div className={`text-lg font-bold ${s < 0 ? 'text-red-700' : 'text-gray-900'}`}>{brl(s)}</div>
              <div className="text-[11px] text-gray-500">saldo atual</div>
            </button>
          );
        })}
        <div className="rounded-xl bg-blue-900 p-3 text-white shadow-sm">
          <div className="text-[11px] font-medium uppercase text-blue-200">Total disponível</div>
          <div className="text-lg font-bold">{brl(total)}</div>
          <div className="text-[11px] text-blue-200">soma de todas as contas</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 text-sm shadow-sm print:hidden">
        <select value={contaId} onChange={(e) => setContaId(e.target.value)} className="rounded border bg-white px-2 py-1 font-semibold">
          {ativas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
        de <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded border px-2 py-1" />
        até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded border px-2 py-1" />
        <div className="flex-1" />
        <button onClick={() => setModal('entrada')} className="rounded-lg bg-green-600 px-3 py-1.5 font-semibold text-white">
          + Entrada
        </button>
        <button onClick={() => setModal('saida')} className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white">
          − Saída
        </button>
        <button onClick={() => setModal('transferencia')} className="rounded-lg bg-gray-800 px-3 py-1.5 font-semibold text-white" title="Sangria do caixa, depósito no banco, saque…">
          ⇄ Transferência
        </button>
        <button onClick={exportarCsv} className="rounded-lg border px-3 py-1.5 hover:bg-gray-50">
          ⬇ Planilha
        </button>
        <button onClick={() => window.print()} className="rounded-lg border px-3 py-1.5 hover:bg-gray-50">
          🖨 Imprimir
        </button>
      </div>
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {aviso && (
        <p className="flex rounded-lg bg-green-50 p-3 text-sm text-green-800">
          <span className="flex-1">{aviso}</span>
          <button onClick={() => setAviso('')}>✕</button>
        </p>
      )}

      {/* extrato */}
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <div className="flex flex-wrap items-baseline gap-x-4 border-b px-4 py-3">
          <h3 className="mr-auto font-bold text-gray-800">
            Extrato · {conta?.nome}
            {conta?.banco && <span className="ml-1 text-xs font-normal text-gray-500">{[conta.banco, conta.agencia && `ag. ${conta.agencia}`, conta.conta && `c/c ${conta.conta}`].filter(Boolean).join(' · ')}</span>}
          </h3>
          <span className="text-xs text-gray-500">
            {lojaNome} · {dataBR(de)} a {dataBR(ate)}
          </span>
        </div>
        {carregando ? (
          <p className="p-6 text-center text-sm text-gray-500">Carregando…</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-[11px] uppercase text-gray-600">
              <tr>
                <th className="p-2">Data</th>
                <th className="p-2">Descrição</th>
                <th className="p-2">Origem</th>
                <th className="p-2 text-right">Entrada</th>
                <th className="p-2 text-right">Saída</th>
                <th className="p-2 text-right">Saldo</th>
                <th className="print:hidden" />
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr className="bg-gray-50 font-semibold">
                <td className="p-2" colSpan={5}>
                  Saldo anterior
                </td>
                <td className="p-2 text-right">{brl(saldoAnterior)}</td>
                <td className="print:hidden" />
              </tr>
              {!linhas.length && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-gray-500">
                    Nenhum lançamento no período.
                  </td>
                </tr>
              )}
              {linhas.map((m) => (
                <tr key={m.id} className={m.historico ? 'text-gray-400' : ''} title={m.historico ? 'Antes do saldo inicial da conta: só histórico, não soma no saldo' : undefined}>
                  <td className="p-2 whitespace-nowrap">
                    {dataBR(m.data)} <span className="text-[11px] text-gray-400">{diaSemana(m.data)}</span>
                  </td>
                  <td className="p-2">
                    {m.descricao}
                    {m.usuario && <span className="ml-1 text-[11px] text-gray-400">· {m.usuario}</span>}
                  </td>
                  <td className="p-2 text-xs text-gray-600">{ORIGENS[m.origem] || m.origem}</td>
                  <td className="p-2 text-right text-green-700">{m.tipo === 'entrada' ? brl(m.valor) : ''}</td>
                  <td className="p-2 text-right text-red-700">{m.tipo === 'saida' ? brl(m.valor) : ''}</td>
                  <td className={`p-2 text-right font-semibold ${(m.saldo ?? 0) < 0 ? 'text-red-700' : ''}`}>{m.saldo == null ? '—' : brl(m.saldo)}</td>
                  <td className="p-2 text-right print:hidden">
                    {podeExcluir && (m.origem === 'manual' || m.origem === 'transferencia') && (
                      <button onClick={() => excluir(m)} className="text-xs text-red-600 hover:underline">
                        excluir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 bg-gray-100 font-bold">
              <tr>
                <td className="p-2" colSpan={3}>
                  Saldo final em {dataBR(ate)}
                </td>
                <td className="p-2 text-right text-green-700">{brl(entradas)}</td>
                <td className="p-2 text-right text-red-700">{brl(saidas)}</td>
                <td className={`p-2 text-right ${saldoFinal < 0 ? 'text-red-700' : 'text-gray-900'}`}>{brl(saldoFinal)}</td>
                <td className="print:hidden" />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      <p className="text-[11px] text-gray-400 print:hidden">
        Vendas do PDV, recebimentos e pagamentos entram sozinhos, na conta de destino de cada forma de pagamento (⚙️ Cadastro de contas). Para desfazer um
        lançamento automático, cancele a venda ou reabra a conta a receber/pagar.
      </p>

      {modal && (
        <Lancamento
          tipo={modal}
          contas={ativas}
          contaId={contaId}
          aoFechar={() => setModal(null)}
          aoSalvar={(msg) => {
            setModal(null);
            setAviso(msg);
            setVersao((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

function Lancamento({
  tipo,
  contas,
  contaId,
  aoFechar,
  aoSalvar,
}: {
  tipo: 'entrada' | 'saida' | 'transferencia';
  contas: Conta[];
  contaId: string;
  aoFechar: () => void;
  aoSalvar: (msg: string) => void;
}) {
  const caixa = contas.find((c) => c.tipo === 'caixa');
  const banco = contas.find((c) => c.tipo === 'banco');
  const [origem, setOrigem] = useState(tipo === 'transferencia' ? caixa?.id || contaId : contaId);
  const [destino, setDestino] = useState(tipo === 'transferencia' ? banco?.id || contas.find((c) => c.id !== contaId)?.id || '' : '');
  const [valor, setValor] = useState('');
  const [data, setData] = useState(hojeISO);
  const [descricao, setDescricao] = useState(tipo === 'transferencia' ? 'Sangria do caixa / depósito' : '');
  const [categoria, setCategoria] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const salvar = async () => {
    const v = numInput(valor);
    if (v <= 0) return setErro('Informe o valor.');
    setSalvando(true);
    const { error } =
      tipo === 'transferencia'
        ? await supabase.rpc('fin_transferir', { p_origem: origem, p_destino: destino, p_valor: v, p_data: data, p_descricao: descricao })
        : await supabase.rpc('fin_lancar', { p_conta: origem, p_tipo: tipo, p_valor: v, p_data: data, p_descricao: descricao, p_categoria: categoria || null });
    setSalvando(false);
    if (error) return setErro(erroBanco(error.message));
    aoSalvar(tipo === 'transferencia' ? `Transferência de ${brl(v)} lançada.` : `${tipo === 'entrada' ? 'Entrada' : 'Saída'} de ${brl(v)} lançada.`);
  };

  const campo = 'mt-1 w-full rounded-lg border px-3 py-2 text-sm';
  const sel = (v: string, f: (x: string) => void) => (
    <select value={v} onChange={(e) => f(e.target.value)} className={`${campo} bg-white`}>
      {contas.map((c) => (
        <option key={c.id} value={c.id}>
          {c.nome}
        </option>
      ))}
    </select>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-bold text-gray-800">
          {tipo === 'entrada' ? '+ Entrada' : tipo === 'saida' ? '− Saída' : '⇄ Transferência entre contas'}
        </h3>
        {tipo === 'transferencia' ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-gray-600">
              Sai de
              {sel(origem, setOrigem)}
            </label>
            <label className="block text-sm text-gray-600">
              Entra em
              {sel(destino, setDestino)}
            </label>
          </div>
        ) : (
          <label className="block text-sm text-gray-600">
            Conta
            {sel(origem, setOrigem)}
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-gray-600">
            Valor (R$)
            <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" className={campo} autoFocus />
          </label>
          <label className="block text-sm text-gray-600">
            Data
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={campo} />
          </label>
        </div>
        <label className="block text-sm text-gray-600">
          Descrição
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder={tipo === 'entrada' ? 'Ex.: suprimento de troco, aporte' : 'Ex.: compra de material, tarifa bancária, retirada'}
            className={campo}
          />
        </label>
        {tipo !== 'transferencia' && (
          <label className="block text-sm text-gray-600">
            Categoria (opcional)
            <input value={categoria} onChange={(e) => setCategoria(e.target.value)} list="cat-fin" className={campo} />
            <datalist id="cat-fin">
              {['Suprimento de troco', 'Aporte do sócio', 'Retirada do sócio', 'Tarifa bancária', 'Despesa da loja', 'Ajuste de caixa'].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
        )}
        {erro && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={aoFechar} className="rounded-lg border px-4 py-2 text-sm">
            Voltar
          </button>
          <button onClick={salvar} disabled={salvando} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {salvando ? 'Salvando…' : 'Lançar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// FLUXO DE CAIXA: realizado (extrato) até hoje + previsto (contas em aberto), saldo dia a dia
// =====================================================================
function Fluxo({ contas, lojaNome }: { contas: Conta[]; lojaNome: string }) {
  const hoje = hojeISO();
  const [de, setDe] = useState(() => somarDias(hoje, -7));
  const [ate, setAte] = useState(() => somarDias(hoje, 30));
  const [dias, setDias] = useState<{ dia: string; entR: number; saiR: number; entP: number; saiP: number; saldo: number }[]>([]);
  const [saldoIni, setSaldoIni] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    (async () => {
      setCarregando(true);
      setErro('');
      const ativas = new Set(contas.filter((c) => c.ativo).map((c) => c.id));
      const { m, error } = await saldos(somarDias(de, -1));
      if (error) {
        setErro(erroBanco(error.message));
        setCarregando(false);
        return;
      }
      const ini = r2(Object.entries(m).filter(([id]) => ativas.has(id)).reduce((s, [, v]) => s + v, 0));
      const fimReal = ate < hoje ? ate : hoje;
      const [mv, rec, pag] = await Promise.all([
        de <= fimReal
          ? buscarTodos(() => supabase.from('movimentos_financeiros').select('conta_id, data, tipo, valor, origem').gte('data', de).lte('data', fimReal).order('data').order('id'))
          : Promise.resolve({ data: [], error: null }),
        buscarTodos(() => supabase.from('contas_receber').select('valor, vencimento').eq('status', 'aberto').lte('vencimento', ate).order('vencimento').order('id')),
        buscarTodos(() => supabase.from('contas_pagar').select('valor, vencimento').eq('status', 'aberto').lte('vencimento', ate).order('vencimento').order('id')),
      ]);
      const mapa = new Map<string, { entR: number; saiR: number; entP: number; saiP: number }>();
      for (let d = de; d <= ate; d = somarDias(d, 1)) mapa.set(d, { entR: 0, saiR: 0, entP: 0, saiP: 0 });
      const contaInicio: Record<string, string> = {};
      contas.forEach((c) => (contaInicio[c.id] = c.data_saldo_inicial));
      ((mv.data as any[]) || []).forEach((x) => {
        // transferência entre contas não muda o total; antes do saldo inicial é só histórico
        if (x.origem === 'transferencia' || !ativas.has(x.conta_id) || x.data < (contaInicio[x.conta_id] || '')) return;
        const b = mapa.get(x.data);
        if (b) x.tipo === 'entrada' ? (b.entR += Number(x.valor)) : (b.saiR += Number(x.valor));
      });
      // previsto: o que vence a partir de hoje; o vencido e não pago/recebido entra hoje
      const prev = (l: any[], campo: 'entP' | 'saiP') =>
        l.forEach((x) => {
          const d = x.vencimento < hoje ? hoje : x.vencimento;
          const b = mapa.get(d);
          if (b) b[campo] += Number(x.valor);
        });
      prev((rec.data as any[]) || [], 'entP');
      prev((pag.data as any[]) || [], 'saiP');
      // conta que começa dentro do período: o saldo inicial dela entra no dia em que ela começa
      const inicio: Record<string, number> = {};
      contas.filter((c) => c.ativo && c.data_saldo_inicial > de && c.data_saldo_inicial <= ate).forEach((c) => (inicio[c.data_saldo_inicial] = (inicio[c.data_saldo_inicial] || 0) + c.saldo_inicial));
      let s = ini;
      const lista = Array.from(mapa.entries()).map(([dia, b]) => {
        s = r2(s + (inicio[dia] || 0) + b.entR - b.saiR + b.entP - b.saiP);
        return { dia, entR: r2(b.entR), saiR: r2(b.saiR), entP: r2(b.entP), saiP: r2(b.saiP), saldo: s };
      });
      setSaldoIni(ini);
      setDias(lista);
      setCarregando(false);
    })();
  }, [de, ate, contas]);

  const soma = (k: 'entR' | 'saiR' | 'entP' | 'saiP') => r2(dias.reduce((s, d) => s + d[k], 0));
  const menor = dias.length ? dias.reduce((a, b) => (b.saldo < a.saldo ? b : a)) : null;
  const final = dias.length ? dias[dias.length - 1].saldo : saldoIni;
  const visiveis = dias.filter((d) => d.entR || d.saiR || d.entP || d.saiP || d.dia === hoje);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 text-sm shadow-sm print:hidden">
        de <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded border px-2 py-1" />
        até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded border px-2 py-1" />
        {[30, 60, 90].map((n) => (
          <button
            key={n}
            onClick={() => {
              setDe(hoje);
              setAte(somarDias(hoje, n));
            }}
            className="rounded-lg border px-2.5 py-1 hover:bg-gray-50"
          >
            próximos {n} dias
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={() => window.print()} className="rounded-lg border px-3 py-1 hover:bg-gray-50">
          🖨 Imprimir
        </button>
      </div>
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Quadro titulo={`Saldo em ${dataBR(somarDias(de, -1))}`} valor={brl(saldoIni)} />
        <Quadro titulo="Entradas (realizadas + previstas)" valor={brl(r2(soma('entR') + soma('entP')))} cor="text-green-700" sub={`previsto ${brl(soma('entP'))}`} />
        <Quadro titulo="Saídas (realizadas + previstas)" valor={brl(r2(soma('saiR') + soma('saiP')))} cor="text-red-700" sub={`previsto ${brl(soma('saiP'))}`} />
        <Quadro
          titulo={`Saldo projetado em ${dataBR(ate)}`}
          valor={brl(final)}
          cor={final < 0 ? 'text-red-700' : 'text-blue-800'}
          sub={menor && menor.saldo < 0 ? `⚠ fica negativo em ${dataBR(menor.dia)} (${brl(menor.saldo)})` : '✓ não fica negativo no período'}
        />
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <div className="border-b px-4 py-3">
          <h3 className="font-bold text-gray-800">Fluxo de caixa diário</h3>
          <p className="text-xs text-gray-500">
            {lojaNome} · todas as contas · até hoje: realizado (extrato); de hoje em diante: previsto (contas a receber e a pagar em aberto; as vencidas entram
            hoje). Transferências entre contas não mudam o total.
          </p>
        </div>
        {carregando ? (
          <p className="p-6 text-center text-sm text-gray-500">Carregando…</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-[11px] uppercase text-gray-600">
              <tr>
                <th className="p-2">Dia</th>
                <th className="p-2 text-right">Entrou</th>
                <th className="p-2 text-right">Saiu</th>
                <th className="p-2 text-right">A receber</th>
                <th className="p-2 text-right">A pagar</th>
                <th className="p-2 text-right">Saldo do dia</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visiveis.map((d) => (
                <tr key={d.dia} className={d.dia === hoje ? 'bg-blue-50 font-semibold' : d.dia > hoje ? 'text-gray-700' : ''}>
                  <td className="p-2 whitespace-nowrap">
                    {dataBR(d.dia)} <span className="text-[11px] text-gray-400">{diaSemana(d.dia)}</span>
                    {d.dia === hoje && <span className="ml-1 rounded bg-blue-700 px-1 text-[10px] text-white">HOJE</span>}
                  </td>
                  <td className="p-2 text-right text-green-700">{d.entR ? brl(d.entR) : ''}</td>
                  <td className="p-2 text-right text-red-700">{d.saiR ? brl(d.saiR) : ''}</td>
                  <td className="p-2 text-right text-green-700 italic">{d.entP ? brl(d.entP) : ''}</td>
                  <td className="p-2 text-right text-red-700 italic">{d.saiP ? brl(d.saiP) : ''}</td>
                  <td className={`p-2 text-right font-semibold ${d.saldo < 0 ? 'text-red-700' : 'text-gray-900'}`}>{brl(d.saldo)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 bg-gray-100 font-bold">
              <tr>
                <td className="p-2">Total</td>
                <td className="p-2 text-right text-green-700">{brl(soma('entR'))}</td>
                <td className="p-2 text-right text-red-700">{brl(soma('saiR'))}</td>
                <td className="p-2 text-right text-green-700">{brl(soma('entP'))}</td>
                <td className="p-2 text-right text-red-700">{brl(soma('saiP'))}</td>
                <td className="p-2 text-right">{brl(final)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

function Quadro({ titulo, valor, sub, cor = 'text-gray-900' }: { titulo: string; valor: string; sub?: string; cor?: string }) {
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <div className="text-[11px] font-medium uppercase text-gray-500">{titulo}</div>
      <div className={`text-lg font-bold ${cor}`}>{valor}</div>
      {sub && <div className="text-[11px] text-gray-500">{sub}</div>}
    </div>
  );
}

// =====================================================================
// CADASTRO DE CONTAS + DESTINO DE CADA FORMA DE PAGAMENTO
// =====================================================================
function Cadastro({ contas, codigoLoja, aoMudar }: { contas: Conta[]; codigoLoja: string; aoMudar: () => void }) {
  const [form, setForm] = useState<Partial<Conta> | null>(null);
  const [destinos, setDestinos] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  useEffect(() => {
    supabase
      .from('formas_destino')
      .select('forma, conta_id')
      .then(({ data }) => {
        const m: Record<string, string> = {};
        ((data as any[]) || []).forEach((d) => (m[d.forma] = d.conta_id));
        setDestinos(m);
      });
  }, [contas]);

  const salvarConta = async () => {
    if (!form) return;
    if (!(form.nome || '').trim()) return setMsg({ tipo: 'erro', texto: 'Informe o nome da conta.' });
    const dados = {
      nome: (form.nome || '').trim(),
      tipo: form.tipo || 'banco',
      banco: form.banco || null,
      agencia: form.agencia || null,
      conta: form.conta || null,
      saldo_inicial: Number(form.saldo_inicial) || 0,
      data_saldo_inicial: form.data_saldo_inicial || hojeISO(),
      ativo: form.ativo ?? true,
    };
    const { error } = form.id
      ? await supabase.from('contas_financeiras').update(dados).eq('id', form.id)
      : await supabase.from('contas_financeiras').insert({ ...dados, codigo_loja: codigoLoja });
    if (error) return setMsg({ tipo: 'erro', texto: erroBanco(error.message) });
    setForm(null);
    setMsg({ tipo: 'ok', texto: 'Conta salva.' });
    aoMudar();
  };

  const mudarDestino = async (forma: string, conta_id: string) => {
    setDestinos((d) => ({ ...d, [forma]: conta_id }));
    const { error } = await supabase.from('formas_destino').upsert({ codigo_loja: codigoLoja, forma, conta_id }, { onConflict: 'codigo_loja,forma' });
    setMsg(error ? { tipo: 'erro', texto: erroBanco(error.message) } : { tipo: 'ok', texto: 'Destino salvo. Vale para os próximos recebimentos e pagamentos.' });
  };

  const campo = 'mt-1 w-full rounded-lg border px-3 py-2 text-sm';
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="flex items-center">
          <h3 className="flex-1 font-bold text-gray-800">Contas</h3>
          <button
            onClick={() => setForm({ nome: '', tipo: 'banco', saldo_inicial: 0, data_saldo_inicial: hojeISO(), ativo: true })}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white"
          >
            + Nova conta
          </button>
        </div>
        {msg && <p className={`rounded-lg p-2 text-sm ${msg.tipo === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{msg.texto}</p>}
        <ul className="divide-y rounded-xl bg-white shadow-sm">
          {contas.map((c) => (
            <li key={c.id} className={`flex items-center gap-3 px-4 py-3 ${c.ativo ? '' : 'opacity-50'}`}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-800">{c.nome}</p>
                <p className="text-xs text-gray-500">
                  {TIPOS[c.tipo] || c.tipo}
                  {c.banco && ` · ${c.banco}`}
                  {c.agencia && ` · ag. ${c.agencia}`}
                  {c.conta && ` · c/c ${c.conta}`} · saldo inicial {brl(c.saldo_inicial)} em {dataBR(c.data_saldo_inicial)}
                  {!c.ativo && ' · inativa'}
                </p>
              </div>
              <button onClick={() => setForm(c)} className="text-sm text-blue-700 hover:underline">
                editar
              </button>
            </li>
          ))}
        </ul>
        {form && (
          <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
            <h4 className="font-bold text-gray-800">{form.id ? 'Editar conta' : 'Nova conta'}</h4>
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 block text-sm text-gray-600">
                Nome *
                <input value={form.nome || ''} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Caixa da loja, Banco do Brasil" className={campo} />
              </label>
              <label className="block text-sm text-gray-600">
                Tipo
                <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className={`${campo} bg-white`}>
                  {Object.entries(TIPOS).map(([id, r]) => (
                    <option key={id} value={id}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-gray-600">
                Banco
                <input value={form.banco || ''} onChange={(e) => setForm({ ...form, banco: e.target.value })} className={campo} />
              </label>
              <label className="block text-sm text-gray-600">
                Agência
                <input value={form.agencia || ''} onChange={(e) => setForm({ ...form, agencia: e.target.value })} className={campo} />
              </label>
              <label className="block text-sm text-gray-600">
                Conta
                <input value={form.conta || ''} onChange={(e) => setForm({ ...form, conta: e.target.value })} className={campo} />
              </label>
              <label className="block text-sm text-gray-600">
                Saldo inicial (R$)
                <input
                  defaultValue={String(form.saldo_inicial ?? 0).replace('.', ',')}
                  onChange={(e) => setForm({ ...form, saldo_inicial: numInput(e.target.value) })}
                  inputMode="decimal"
                  className={campo}
                />
              </label>
              <label className="block text-sm text-gray-600">
                Saldo em (data)
                <input type="date" value={form.data_saldo_inicial || ''} onChange={(e) => setForm({ ...form, data_saldo_inicial: e.target.value })} className={campo} />
              </label>
              <label className="col-span-2 flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.ativo ?? true} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> conta ativa
              </label>
            </div>
            <p className="text-[11px] text-gray-500">
              Saldo inicial: quanto havia na conta no começo do dia informado (confira o extrato do banco / conte o caixa). Lançamentos antes dessa data ficam
              só como histórico.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setForm(null)} className="rounded-lg border px-4 py-2 text-sm">
                Voltar
              </button>
              <button onClick={salvarConta} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
                Salvar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="font-bold text-gray-800">Destino de cada forma de pagamento</h3>
        <p className="text-xs text-gray-500">
          Em qual conta cai o dinheiro de cada forma — vale para as vendas do PDV, para o Contas a receber (entrada) e para o Contas a pagar (saída).
        </p>
        <div className="divide-y rounded-xl bg-white shadow-sm">
          {FORMAS.map((f) => (
            <label key={f.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="flex-1 text-gray-800">{f.rotulo}</span>
              <select value={destinos[f.id] || ''} onChange={(e) => mudarDestino(f.id, e.target.value)} className="rounded border bg-white px-2 py-1">
                <option value="" disabled>
                  escolha…
                </option>
                {contas
                  .filter((c) => c.ativo)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
