// BR Sisloja - Contas a Receber
// Vendas do PDV entram aqui JÁ RECEBIDAS (cartão pelo valor líquido, com a taxa da tabela descontada).
// Em aberto ficam as contas lançadas aqui (crediário, fiado, serviço...). Na baixa no cartão, a taxa da tabela é descontada.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { buscarTodos } from './buscarTodos';
import { SeletorCliente, type Cliente } from './ClienteVenda';

type Usuario = { id: string; email: string; nome: string; perfil: string; codigo_loja: string; loja_nome: string };

export type ContaReceber = {
  id: string;
  cliente_id: string | null;
  descricao: string;
  documento: string | null;
  parcela: string | null;
  valor: number;
  valor_bruto: number | null;
  taxa_cartao: number | null;
  valor_recebido: number | null;
  juros: number | null;
  desconto: number | null;
  vencimento: string;
  status: 'aberto' | 'recebido' | 'cancelado';
  forma: string | null;
  data_recebimento: string | null;
  origem: string | null;
  observacao: string | null;
  recebido_por: string | null;
};

type Filtro = 'abertas' | 'vencidas' | 'semana' | 'recebidas' | 'todas';

export const FORMAS_RECEBER: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  cartao_debito: 'Cartão débito',
  cartao_credito: 'Cartão crédito',
  transferencia: 'Transferência',
  boleto: 'Boleto',
  cheque: 'Cheque',
};

const brl = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const numInput = (s: string) => {
  const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
};
const hojeISO = () => new Date().toLocaleDateString('sv-SE');
const diasAte = (iso: string) => Math.round((new Date(iso + 'T12:00:00').getTime() - new Date(hojeISO() + 'T12:00:00').getTime()) / 86400000);
const diaSemana = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const dataBR = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');
const erroBanco = (m: string) =>
  /lancar_receber|receber_conta|cancelar_receber|reabrir_receber|column|function/i.test(m)
    ? 'Falta atualizar o banco: rode o arquivo fase10_contas_receber.sql no SQL Editor do Supabase. (' + m + ')'
    : m;

// nomes dos clientes (com cache entre as telas)
const cacheNomes: Record<string, string> = {};
export async function nomesClientes(ids: (string | null)[]) {
  const faltam = Array.from(new Set(ids.filter((x): x is string => !!x && !(x in cacheNomes))));
  await Promise.all(
    faltam.map(async (id) => {
      const { data } = await supabase.rpc('obter_cliente', { p_id: id });
      cacheNomes[id] = (data as any)?.nome || 'Cliente';
    })
  );
  return { ...cacheNomes };
}

export default function ContasReceberModule({ loggedUser }: { loggedUser: Usuario }) {
  const perfil = (loggedUser?.perfil || '').toLowerCase();
  const podeEditar = ['admin', 'gerente', 'financeiro'].includes(perfil);
  const podeReabrir = ['admin', 'gerente'].includes(perfil);

  const [abertas, setAbertas] = useState<ContaReceber[]>([]);
  const [historico, setHistorico] = useState<ContaReceber[]>([]);
  const [recebidoHoje, setRecebidoHoje] = useState({ qtd: 0, total: 0 });
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const [filtro, setFiltro] = useState<Filtro>('abertas');
  const [de, setDe] = useState(() => hojeISO().slice(0, 8) + '01');
  const [ate, setAte] = useState(hojeISO);
  const [busca, setBusca] = useState('');

  const [lancando, setLancando] = useState(false);
  const [baixa, setBaixa] = useState<ContaReceber | null>(null);

  const recarregar = async () => {
    setCarregando(true);
    setErro('');
    const a = await buscarTodos(() =>
      supabase.from('contas_receber').select('*').eq('codigo_loja', loggedUser.codigo_loja).eq('status', 'aberto').order('vencimento').order('id')
    );
    if (a.error) {
      setErro(erroBanco('Erro ao carregar: ' + a.error.message));
      setCarregando(false);
      return;
    }
    let h: ContaReceber[] = [];
    if (filtro === 'recebidas' || filtro === 'todas') {
      const r = await buscarTodos(() => {
        const base = supabase.from('contas_receber').select('*').eq('codigo_loja', loggedUser.codigo_loja);
        return filtro === 'recebidas'
          ? base.eq('status', 'recebido').gte('data_recebimento', de).lte('data_recebimento', ate).order('data_recebimento').order('id')
          : base.gte('vencimento', de).lte('vencimento', ate).order('vencimento').order('id');
      });
      h = (r.data as ContaReceber[]) || [];
    }
    const hoje = await buscarTodos(() =>
      supabase.from('contas_receber').select('valor, valor_recebido').eq('codigo_loja', loggedUser.codigo_loja).eq('status', 'recebido').eq('data_recebimento', hojeISO()).order('id')
    );
    const lh = (hoje.data as any[]) || [];
    setRecebidoHoje({ qtd: lh.length, total: r2(lh.reduce((s, x) => s + Number(x.valor_recebido ?? x.valor), 0)) });
    setAbertas((a.data as ContaReceber[]) || []);
    setHistorico(h);
    setNomes(await nomesClientes([...(a.data || []), ...h].map((c: any) => c.cliente_id)));
    setCarregando(false);
  };

  useEffect(() => {
    recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedUser.codigo_loja, filtro, de, ate]);

  const nome = (c: ContaReceber) => (c.cliente_id && nomes[c.cliente_id]) || 'Consumidor';

  const resumo = useMemo(() => {
    const soma = (l: ContaReceber[]) => r2(l.reduce((s, c) => s + Number(c.valor), 0));
    const venc = abertas.filter((c) => diasAte(c.vencimento) < 0);
    const hoje = abertas.filter((c) => diasAte(c.vencimento) === 0);
    const sem = abertas.filter((c) => diasAte(c.vencimento) > 0 && diasAte(c.vencimento) <= 7);
    return {
      vencidas: { qtd: venc.length, total: soma(venc) },
      hoje: { qtd: hoje.length, total: soma(hoje) },
      semana: { qtd: sem.length, total: soma(sem) },
      aberto: { qtd: abertas.length, total: soma(abertas) },
    };
  }, [abertas]);

  const visiveis = useMemo(() => {
    let l =
      filtro === 'abertas'
        ? abertas
        : filtro === 'vencidas'
        ? abertas.filter((c) => diasAte(c.vencimento) < 0)
        : filtro === 'semana'
        ? abertas.filter((c) => diasAte(c.vencimento) <= 7)
        : historico;
    const t = busca.trim().toLowerCase();
    if (t) l = l.filter((c) => [nome(c), c.descricao, c.documento].some((x) => (x || '').toLowerCase().includes(t)));
    return l;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro, abertas, historico, busca, nomes]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, ContaReceber[]>();
    for (const c of visiveis) {
      const dia = (filtro === 'recebidas' ? c.data_recebimento : c.vencimento) || c.vencimento;
      if (!mapa.has(dia)) mapa.set(dia, []);
      mapa.get(dia)!.push(c);
    }
    return Array.from(mapa.entries());
  }, [visiveis, filtro]);

  const valorLinha = (c: ContaReceber) => (c.status === 'recebido' ? Number(c.valor_recebido ?? c.valor) : Number(c.valor));
  const totalVisivel = r2(visiveis.reduce((s, c) => s + valorLinha(c), 0));

  const cancelar = async (c: ContaReceber) => {
    const motivo = window.prompt(`Cancelar "${c.descricao}" de ${brl(c.valor)}?\nEscreva o motivo:`);
    if (motivo == null) return;
    const { error } = await supabase.rpc('cancelar_receber', { p_id: c.id, p_motivo: motivo });
    if (error) return setErro(erroBanco(error.message));
    setAviso('Conta cancelada.');
    recarregar();
  };

  const reabrir = async (c: ContaReceber) => {
    if (!window.confirm(`Desfazer o recebimento / cancelamento de "${c.descricao}"?\nA conta volta para "em aberto".`)) return;
    const { error } = await supabase.rpc('reabrir_receber', { p_id: c.id });
    if (error) return setErro(erroBanco(error.message));
    setAviso('Conta reaberta.');
    recarregar();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Cartao titulo="Vencidas" cor="text-red-700" qtd={resumo.vencidas.qtd} total={resumo.vencidas.total} onClick={() => setFiltro('vencidas')} />
        <Cartao titulo="Vencem hoje" cor="text-amber-700" qtd={resumo.hoje.qtd} total={resumo.hoje.total} onClick={() => setFiltro('semana')} />
        <Cartao titulo="Próximos 7 dias" cor="text-blue-700" qtd={resumo.semana.qtd} total={resumo.semana.total} onClick={() => setFiltro('semana')} />
        <Cartao titulo="Total em aberto" cor="text-gray-800" qtd={resumo.aberto.qtd} total={resumo.aberto.total} onClick={() => setFiltro('abertas')} />
        <Cartao
          titulo="Recebido hoje"
          cor="text-green-700"
          qtd={recebidoHoje.qtd}
          total={recebidoHoje.total}
          onClick={() => {
            setDe(hojeISO());
            setAte(hojeISO());
            setFiltro('recebidas');
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-sm">
        {(
          [
            ['abertas', 'Em aberto'],
            ['vencidas', 'Vencidas'],
            ['semana', 'Até 7 dias'],
            ['recebidas', 'Recebidas'],
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
        {(filtro === 'recebidas' || filtro === 'todas') && (
          <span className="flex items-center gap-1 text-sm text-gray-600">
            {filtro === 'recebidas' ? 'recebidas de' : 'vencimento de'}
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded border px-2 py-1" />
            até
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded border px-2 py-1" />
          </span>
        )}
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar cliente, descrição, nº…"
          className="min-w-[180px] flex-1 rounded-lg border px-3 py-1.5 text-sm"
        />
        {podeEditar && (
          <button onClick={() => setLancando(true)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            + Nova conta a receber
          </button>
        )}
      </div>

      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {aviso && (
        <p className="flex items-center rounded-lg bg-green-50 p-3 text-sm text-green-800">
          <span className="flex-1">{aviso}</span>
          <button onClick={() => setAviso('')} className="ml-2 text-green-700">
            ✕
          </button>
        </p>
      )}

      <div className="rounded-xl bg-white shadow-sm">
        {carregando ? (
          <p className="p-6 text-center text-sm text-gray-500">Carregando…</p>
        ) : !visiveis.length ? (
          <p className="p-6 text-center text-sm text-gray-500">Nenhuma conta aqui.</p>
        ) : (
          <>
            {grupos.map(([dia, contas]) => {
              const d = diasAte(dia);
              const cor = filtro === 'recebidas' ? 'text-gray-700' : d < 0 ? 'text-red-700' : d === 0 ? 'text-amber-700' : 'text-gray-700';
              return (
                <div key={dia} className="border-b last:border-b-0">
                  <div className={`flex items-center justify-between bg-gray-50 px-4 py-2 text-sm font-semibold ${cor}`}>
                    <span className="capitalize">{diaSemana(dia)}</span>
                    <span>{brl(contas.reduce((s, c) => s + valorLinha(c), 0))}</span>
                  </div>
                  {contas.map((c) => {
                    const venc = c.status === 'aberto' && diasAte(c.vencimento) < 0;
                    return (
                      <div key={c.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-sm ${c.status === 'cancelado' ? 'opacity-50' : ''}`}>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-800">
                            {nome(c)} <span className="font-normal text-gray-600">· {c.descricao}</span>
                            {c.parcela && <span className="ml-1 rounded bg-gray-100 px-1 text-[11px] text-gray-600">{c.parcela}</span>}
                          </p>
                          <p className="text-[11px] text-gray-500">
                            venc. {dataBR(c.vencimento)}
                            {venc && <b className="text-red-600"> · vencida há {-diasAte(c.vencimento)} dia(s)</b>}
                            {c.status === 'recebido' && (
                              <>
                                {' '}
                                · recebida {dataBR(c.data_recebimento)} · {FORMAS_RECEBER[c.forma || ''] || c.forma}
                                {Number(c.taxa_cartao) > 0 && <span className="text-red-600"> · taxa {brl(c.taxa_cartao)}</span>}
                                {Number(c.juros) > 0 && <span> · juros {brl(c.juros)}</span>}
                                {Number(c.desconto) > 0 && <span> · desc. {brl(c.desconto)}</span>}
                              </>
                            )}
                            {c.documento && <> · doc. {c.documento}</>}
                            {c.origem === 'venda' && <> · venda do PDV</>}
                          </p>
                        </div>
                        <Situacao c={c} />
                        <span className="w-28 text-right font-semibold text-gray-900">{brl(valorLinha(c))}</span>
                        <div className="flex gap-1">
                          {podeEditar && c.status === 'aberto' && (
                            <>
                              <button onClick={() => setBaixa(c)} className="rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-700">
                                Receber
                              </button>
                              <button onClick={() => cancelar(c)} className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                                Cancelar
                              </button>
                            </>
                          )}
                          {podeReabrir && c.status !== 'aberto' && c.origem !== 'venda' && (
                            <button onClick={() => reabrir(c)} className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100">
                              Reabrir
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div className="flex justify-end px-4 py-3 text-sm font-bold text-gray-800">
              {visiveis.length} conta(s) · {brl(totalVisivel)}
            </div>
          </>
        )}
      </div>
      <p className="text-[11px] text-gray-400">
        Vendas do PDV entram já recebidas (cartão pelo valor líquido, com a taxa de Configurações → Taxas de cartão descontada). Use "+ Nova conta a
        receber" para crediário, fiado ou serviço.
      </p>

      {lancando && (
        <NovaConta
          aoFechar={() => setLancando(false)}
          aoSalvar={(n) => {
            setLancando(false);
            setAviso(n > 1 ? `${n} parcelas lançadas.` : 'Conta lançada.');
            recarregar();
          }}
        />
      )}
      {baixa && (
        <Baixa
          conta={baixa}
          nomeCliente={nome(baixa)}
          aoFechar={() => setBaixa(null)}
          aoReceber={(msg) => {
            setBaixa(null);
            setAviso(msg);
            recarregar();
          }}
        />
      )}
    </div>
  );
}

function Situacao({ c }: { c: ContaReceber }) {
  if (c.status === 'recebido') return <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Recebida</span>;
  if (c.status === 'cancelado') return <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">Cancelada</span>;
  const d = diasAte(c.vencimento);
  if (d < 0) return <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Vencida</span>;
  if (d === 0) return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Vence hoje</span>;
  return <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">Em aberto</span>;
}

function Cartao({ titulo, cor, qtd, total, onClick }: { titulo: string; cor: string; qtd: number; total: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-xl bg-white p-3 text-left shadow-sm hover:ring-2 hover:ring-gray-200">
      <div className="text-[11px] font-medium uppercase text-gray-500">{titulo}</div>
      <div className={`text-lg font-bold ${cor}`}>{brl(total)}</div>
      <div className="text-[11px] text-gray-500">{qtd} conta(s)</div>
    </button>
  );
}

// ---------- lançar ----------
function NovaConta({ aoFechar, aoSalvar }: { aoFechar: () => void; aoSalvar: (n: number) => void }) {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [parcelas, setParcelas] = useState('1');
  const [vencimento, setVencimento] = useState(hojeISO);
  const [documento, setDocumento] = useState('');
  const [obs, setObs] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const total = numInput(valor);
  const n = Math.max(1, Math.min(60, parseInt(parcelas) || 1));

  const salvar = async () => {
    if (total <= 0) return setErro('Informe o valor.');
    if (descricao.trim().length < 2) return setErro('Informe a descrição.');
    setSalvando(true);
    setErro('');
    const { data, error } = await supabase.rpc('lancar_receber', {
      p_dados: { cliente_id: cliente?.id || null, descricao: descricao.trim(), valor: total, parcelas: n, vencimento, documento, observacao: obs },
    });
    setSalvando(false);
    if (error) return setErro(erroBanco(error.message));
    aoSalvar(Number(data) || n);
  };

  const campo = 'mt-1 w-full rounded-lg border px-3 py-2 text-sm';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
      <div className="max-h-[92dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-bold text-gray-800">Nova conta a receber</h3>
        <SeletorCliente cliente={cliente} aoMudar={setCliente} />
        <label className="block text-sm text-gray-600">
          Descrição *
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: crediário, serviço, fiado" className={campo} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-gray-600">
            Valor total (R$) *
            <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" className={campo} />
          </label>
          <label className="block text-sm text-gray-600">
            Parcelas (mensais)
            <input value={parcelas} onChange={(e) => setParcelas(e.target.value)} inputMode="numeric" className={campo} />
          </label>
          <label className="block text-sm text-gray-600">
            1º vencimento
            <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className={campo} />
          </label>
          <label className="block text-sm text-gray-600">
            Documento / nº
            <input value={documento} onChange={(e) => setDocumento(e.target.value)} className={campo} />
          </label>
        </div>
        {n > 1 && total > 0 && (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            {n} parcelas de {brl(r2(total / n))}, uma por mês a partir de {dataBR(vencimento)}.
          </p>
        )}
        <label className="block text-sm text-gray-600">
          Observação
          <input value={obs} onChange={(e) => setObs(e.target.value)} className={campo} />
        </label>
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

// ---------- receber (baixa) ----------
function Baixa({ conta, nomeCliente, aoFechar, aoReceber }: { conta: ContaReceber; nomeCliente: string; aoFechar: () => void; aoReceber: (msg: string) => void }) {
  const [forma, setForma] = useState('dinheiro');
  const [parcelas, setParcelas] = useState(1);
  const [data, setData] = useState(hojeISO);
  const [juros, setJuros] = useState('');
  const [desconto, setDesconto] = useState('');
  const [obs, setObs] = useState('');
  const [taxas, setTaxas] = useState<Record<string, number>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    supabase
      .from('taxas_cartao')
      .select('forma, parcelas, taxa')
      .then(({ data }) => {
        const m: Record<string, number> = {};
        ((data as any[]) || []).forEach((t) => (m[`${t.forma}|${t.parcelas}`] = Number(t.taxa)));
        setTaxas(m);
      });
  }, []);

  const bruto = r2(Number(conta.valor) + numInput(juros) - numInput(desconto));
  const cartao = forma === 'cartao_debito' || forma === 'cartao_credito';
  const pct = cartao ? taxas[`${forma}|${forma === 'cartao_credito' ? parcelas : 1}`] || 0 : 0;
  const taxa = r2((bruto * pct) / 100);
  const liquido = r2(bruto - taxa);

  const receber = async () => {
    if (bruto <= 0) return setErro('Valor a receber inválido.');
    setSalvando(true);
    setErro('');
    const { error } = await supabase.rpc('receber_conta', {
      p_id: conta.id,
      p_forma: forma,
      p_data: data,
      p_juros: numInput(juros),
      p_desconto: numInput(desconto),
      p_parcelas: forma === 'cartao_credito' ? parcelas : 1,
      p_obs: obs || null,
    });
    setSalvando(false);
    if (error) return setErro(erroBanco(error.message));
    aoReceber(`Recebido ${brl(liquido)}${taxa > 0 ? ` (taxa do cartão ${brl(taxa)})` : ''}.`);
  };

  const campo = 'mt-1 w-full rounded-lg border px-3 py-2 text-sm';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
      <div className="max-h-[92dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-bold text-gray-800">Receber</h3>
        <p className="text-sm text-gray-600">
          <b>{nomeCliente}</b> · {conta.descricao}
          {conta.parcela ? ` (${conta.parcela})` : ''} · venc. {dataBR(conta.vencimento)} · <b>{brl(conta.valor)}</b>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-gray-600">
            Forma
            <select value={forma} onChange={(e) => setForma(e.target.value)} className={`${campo} bg-white`}>
              {Object.entries(FORMAS_RECEBER).map(([id, rot]) => (
                <option key={id} value={id}>
                  {rot}
                </option>
              ))}
            </select>
          </label>
          {forma === 'cartao_credito' ? (
            <label className="block text-sm text-gray-600">
              Parcelas no cartão
              <select value={parcelas} onChange={(e) => setParcelas(Number(e.target.value))} className={`${campo} bg-white`}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}x
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block text-sm text-gray-600">
              Data
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={campo} />
            </label>
          )}
          <label className="block text-sm text-gray-600">
            Juros / multa (R$)
            <input value={juros} onChange={(e) => setJuros(e.target.value)} inputMode="decimal" placeholder="0,00" className={campo} />
          </label>
          <label className="block text-sm text-gray-600">
            Desconto (R$)
            <input value={desconto} onChange={(e) => setDesconto(e.target.value)} inputMode="decimal" placeholder="0,00" className={campo} />
          </label>
        </div>
        <div className="rounded-lg bg-gray-50 p-3 text-sm">
          <div className="flex justify-between">
            <span>Cliente paga</span>
            <b>{brl(bruto)}</b>
          </div>
          {cartao && (
            <div className="flex justify-between text-red-700">
              <span>Taxa do cartão ({pct.toLocaleString('pt-BR')}%)</span>
              <span>− {brl(taxa)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t pt-1 text-base">
            <span>Entra no caixa</span>
            <b className="text-green-700">{brl(liquido)}</b>
          </div>
          {cartao && pct === 0 && <p className="mt-1 text-[11px] text-amber-700">Sem taxa cadastrada para esta forma (Configurações → Taxas de cartão).</p>}
        </div>
        <label className="block text-sm text-gray-600">
          Observação
          <input value={obs} onChange={(e) => setObs(e.target.value)} className={campo} />
        </label>
        {erro && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={aoFechar} className="rounded-lg border px-4 py-2 text-sm">
            Voltar
          </button>
          <button onClick={receber} disabled={salvando} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {salvando ? 'Salvando…' : 'Confirmar recebimento'}
          </button>
        </div>
      </div>
    </div>
  );
}
