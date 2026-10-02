// BR Sisloja - Dashboard (abre só com a senha, igual ao Estoque valorizado; tranca de novo ao sair da aba)
// Faturamento, lucro real (já sem custo e taxa do cartão), ticket, financeiro em aberto, estoque e alertas.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { buscarTodos } from './buscarTodos';
import { ComSenha } from './RelatoriosModule';

type Usuario = { id: string; email: string; nome: string; perfil: string; codigo_loja: string; loja_nome: string };
type Periodo = 'hoje' | '7' | '30' | 'mes' | 'mes_ant';

const PERIODOS: { id: Periodo; rotulo: string }[] = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: '7', rotulo: '7 dias' },
  { id: '30', rotulo: '30 dias' },
  { id: 'mes', rotulo: 'Este mês' },
  { id: 'mes_ant', rotulo: 'Mês passado' },
];
const FORMAS: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'Pix', cartao_debito: 'Débito', cartao_credito: 'Crédito' };

// cores (paleta validada: série azul; status só com ícone + texto)
const SERIE = '#2a78d6';
const GRADE = '#e1e0d9';
const BASE = '#c3c2b7';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCurto = (n: number) =>
  Math.abs(n) >= 1000 ? 'R$ ' + (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : brl(n);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const iso = (d: Date) => d.toLocaleDateString('sv-SE');
const dataBR = (s: string) => s.slice(8, 10) + '/' + s.slice(5, 7);
const pct = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';

// período escolhido e o período anterior do mesmo tamanho (para comparar)
function intervalo(p: Periodo) {
  const hoje = new Date();
  let ini = new Date(hoje);
  let fim = new Date(hoje);
  if (p === '7') ini.setDate(hoje.getDate() - 6);
  if (p === '30') ini.setDate(hoje.getDate() - 29);
  if (p === 'mes') ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  if (p === 'mes_ant') {
    ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
  }
  const dias = Math.round((new Date(iso(fim) + 'T12:00').getTime() - new Date(iso(ini) + 'T12:00').getTime()) / 86400000) + 1;
  const antFim = new Date(ini);
  antFim.setDate(ini.getDate() - 1);
  const antIni = new Date(antFim);
  antIni.setDate(antFim.getDate() - (dias - 1));
  return { de: iso(ini), ate: iso(fim), antDe: iso(antIni), antAte: iso(antFim), dias };
}

export default function DashboardModule({ loggedUser }: { loggedUser: Usuario }) {
  return (
    <ComSenha titulo="Dashboard">
      <Painel loggedUser={loggedUser} />
    </ComSenha>
  );
}

function Painel({ loggedUser }: { loggedUser: Usuario }) {
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [vendas, setVendas] = useState<any[]>([]);
  const [itens, setItens] = useState<any[]>([]);
  const [receber, setReceber] = useState<any[]>([]);
  const [pagar, setPagar] = useState<any[]>([]);
  const [estoque, setEstoque] = useState({ custo: 0, venda: 0, itens: 0, baixo: [] as { nome: string; saldo: number; minimo: number }[] });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const int = useMemo(() => intervalo(periodo), [periodo]);
  const loja = loggedUser.codigo_loja;

  // financeiro e estoque não dependem do período
  useEffect(() => {
    (async () => {
      const [cr, cp, pr, sa] = await Promise.all([
        buscarTodos(() => supabase.from('contas_receber').select('valor, vencimento').eq('codigo_loja', loja).eq('status', 'aberto').order('id')),
        buscarTodos(() => supabase.from('contas_pagar').select('valor, vencimento').eq('codigo_loja', loja).eq('status', 'aberto').order('id')),
        buscarTodos(() => supabase.from('produtos').select('id, nome, custo, preco_venda, estoque_minimo, ativo, nao_listar_estoque').eq('ativo', true).order('id')),
        buscarTodos(() => supabase.from('estoque_saldos').select('produto_id, tipo, saldo').in('tipo', ['fisico', 'administrativo']).order('produto_id').order('tipo')),
      ]);
      setReceber(cr.data || []);
      setPagar(cp.data || []);
      const fis: Record<string, number> = {};
      const adm: Record<string, number> = {};
      (sa.data || []).forEach((s: any) => ((s.tipo === 'fisico' ? fis : adm)[s.produto_id] = Number(s.saldo)));
      let custo = 0;
      let venda = 0;
      let itens = 0;
      const baixo: { nome: string; saldo: number; minimo: number }[] = [];
      (pr.data || []).forEach((p: any) => {
        if (p.nao_listar_estoque) return;
        const q = Math.max(adm[p.id] || 0, 0);
        custo += q * Number(p.custo || 0);
        venda += q * Number(p.preco_venda || 0);
        if (q > 0) itens++;
        const min = Number(p.estoque_minimo || 0);
        if (min > 0 && (fis[p.id] || 0) <= min) baixo.push({ nome: p.nome, saldo: fis[p.id] || 0, minimo: min });
      });
      baixo.sort((a, b) => a.saldo - a.minimo - (b.saldo - b.minimo));
      setEstoque({ custo: r2(custo), venda: r2(venda), itens, baixo });
    })();
  }, [loja]);

  // vendas do período + período anterior, e os itens das vendas do período
  useEffect(() => {
    (async () => {
      setCarregando(true);
      setErro('');
      const v = await buscarTodos(() =>
        supabase
          .from('vendas')
          .select('id, numero, total, desconto, forma_pagamento, custo_total, taxa_cartao_valor, status, cancelada_em, created_at')
          .eq('codigo_loja', loja)
          .gte('created_at', new Date(int.antDe + 'T00:00:00').toISOString())
          .lte('created_at', new Date(int.ate + 'T23:59:59.999').toISOString())
          .order('created_at')
          .order('id')
      );
      if (v.error) {
        setErro(
          /custo_total|taxa_cartao|cancelada_em/.test(v.error.message)
            ? 'Falta atualizar o banco: rode o fase6_taxas_cartao.sql e o fase7_cancelar_venda.sql no SQL Editor do Supabase.'
            : 'Erro ao carregar as vendas: ' + v.error.message
        );
        setCarregando(false);
        return;
      }
      const validas = (v.data || []).filter((x: any) => !x.cancelada_em && !String(x.status || '').toLowerCase().startsWith('cancel'));
      setVendas(validas);
      const ids = validas.filter((x: any) => new Date(x.created_at).toLocaleDateString('sv-SE') >= int.de).map((x: any) => x.id);
      const todos: any[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        const r = await buscarTodos(() =>
          supabase.from('venda_itens').select('produto_id, nome, quantidade, subtotal, custo_unitario').in('venda_id', ids.slice(i, i + 150)).order('id')
        );
        todos.push(...(r.data || []));
      }
      setItens(todos);
      setCarregando(false);
    })();
  }, [loja, int]);

  const dia = (x: any) => new Date(x.created_at).toLocaleDateString('sv-SE');
  const lucro = (x: any) => Number(x.total || 0) - Number(x.custo_total || 0) - Number(x.taxa_cartao_valor || 0);

  const k = useMemo(() => {
    const atual = vendas.filter((x) => dia(x) >= int.de);
    const ant = vendas.filter((x) => dia(x) <= int.antAte);
    const soma = (l: any[], f: (x: any) => number) => r2(l.reduce((s, x) => s + f(x), 0));
    const fat = soma(atual, (x) => Number(x.total));
    const fatAnt = soma(ant, (x) => Number(x.total));
    const luc = soma(atual, lucro);
    const lucAnt = soma(ant, lucro);
    return {
      fat,
      fatAnt,
      luc,
      lucAnt,
      qtd: atual.length,
      qtdAnt: ant.length,
      ticket: atual.length ? r2(fat / atual.length) : 0,
      ticketAnt: ant.length ? r2(fatAnt / ant.length) : 0,
      taxa: soma(atual, (x) => Number(x.taxa_cartao_valor || 0)),
      desconto: soma(atual, (x) => Number(x.desconto || 0)),
      margem: fat > 0 ? (luc / fat) * 100 : 0,
      atual,
    };
  }, [vendas, int]);

  // gráfico principal: por dia (ou por hora, quando o período é 1 dia)
  const serie = useMemo(() => {
    if (int.dias === 1) {
      const h = Array.from({ length: 24 }, (_, i) => ({ rotulo: `${i}h`, valor: 0, lucro: 0, qtd: 0 }));
      k.atual.forEach((x) => {
        const b = h[new Date(x.created_at).getHours()];
        b.valor += Number(x.total);
        b.lucro += lucro(x);
        b.qtd++;
      });
      const usadas = h.map((b, i) => (b.qtd ? i : -1)).filter((i) => i >= 0);
      const ini = usadas.length ? Math.min(...usadas, 8) : 8;
      const fim = usadas.length ? Math.max(...usadas, 18) : 18;
      return h.slice(ini, fim + 1);
    }
    const mapa = new Map<string, { rotulo: string; valor: number; lucro: number; qtd: number }>();
    for (let d = new Date(int.de + 'T12:00'); iso(d) <= int.ate; d.setDate(d.getDate() + 1)) mapa.set(iso(d), { rotulo: dataBR(iso(d)), valor: 0, lucro: 0, qtd: 0 });
    k.atual.forEach((x) => {
      const b = mapa.get(dia(x));
      if (b) {
        b.valor += Number(x.total);
        b.lucro += lucro(x);
        b.qtd++;
      }
    });
    return Array.from(mapa.values());
  }, [k, int]);

  // movimento por hora (períodos com mais de um dia)
  const porHora = useMemo(() => {
    const h = Array.from({ length: 24 }, (_, i) => ({ rotulo: `${i}h`, valor: 0, lucro: 0, qtd: 0 }));
    k.atual.forEach((x) => {
      const b = h[new Date(x.created_at).getHours()];
      b.qtd++;
      b.valor += Number(x.total);
      b.lucro += lucro(x);
    });
    const usadas = h.map((b, i) => (b.qtd ? i : -1)).filter((i) => i >= 0);
    if (!usadas.length) return [];
    return h.slice(Math.min(...usadas), Math.max(...usadas) + 1);
  }, [k]);

  const formas = useMemo(() => {
    const m: Record<string, number> = {};
    k.atual.forEach((x) => (m[x.forma_pagamento] = (m[x.forma_pagamento] || 0) + Number(x.total)));
    return Object.entries(m)
      .map(([f, v]) => ({ rotulo: FORMAS[f] || f, valor: r2(v), sub: k.fat ? pct((v / k.fat) * 100) : '' }))
      .sort((a, b) => b.valor - a.valor);
  }, [k]);

  const top = useMemo(() => {
    const m = new Map<string, { rotulo: string; valor: number; qtd: number; lucro: number }>();
    itens.forEach((i) => {
      const key = i.produto_id || i.nome;
      if (!m.has(key)) m.set(key, { rotulo: i.nome, valor: 0, qtd: 0, lucro: 0 });
      const t = m.get(key)!;
      t.valor += Number(i.subtotal);
      t.qtd += Number(i.quantidade);
      t.lucro += Number(i.subtotal) - Number(i.quantidade) * Number(i.custo_unitario || 0);
    });
    return Array.from(m.values())
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 10)
      .map((t) => ({ rotulo: t.rotulo, valor: r2(t.valor), sub: `${t.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} un · lucro ${brlCurto(r2(t.lucro))}` }));
  }, [itens]);

  // a pagar e a receber: em dia × vencido (contas em aberto, posição de hoje)
  const fin = useMemo(() => {
    const hoje = iso(new Date());
    const em7 = new Date();
    em7.setDate(em7.getDate() + 7);
    const ate7 = iso(em7);
    const resumo = (l: any[]) => {
      const s = (f: (c: any) => boolean) => {
        const x = l.filter(f);
        return { qtd: x.length, total: r2(x.reduce((t, c) => t + Number(c.valor), 0)) };
      };
      return {
        total: s(() => true),
        emDia: s((c) => c.vencimento >= hoje),
        vencido: s((c) => c.vencimento < hoje),
        hoje: s((c) => c.vencimento === hoje),
        prox7: s((c) => c.vencimento > hoje && c.vencimento <= ate7),
      };
    };
    return { receber: resumo(receber), pagar: resumo(pagar) };
  }, [receber, pagar]);

  const nomePeriodo = int.dias === 1 ? dataBR(int.de) : `${dataBR(int.de)} a ${dataBR(int.ate)}`;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-xl font-black text-gray-800">📈 Dashboard</h2>
          <p className="text-xs text-gray-500">
            {loggedUser.loja_nome} · {nomePeriodo} · comparado com os {int.dias} dia(s) anteriores
          </p>
        </div>
        <div className="flex overflow-hidden rounded-lg border bg-white text-sm shadow-sm">
          {PERIODOS.map((p) => (
            <button key={p.id} onClick={() => setPeriodo(p.id)} className={`px-3 py-1.5 ${periodo === p.id ? 'bg-gray-800 font-semibold text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              {p.rotulo}
            </button>
          ))}
        </div>
      </div>
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      {/* indicadores principais */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador titulo="Faturamento" valor={brl(k.fat)} atual={k.fat} anterior={k.fatAnt} destaque />
        <Indicador titulo="Lucro real" valor={brl(k.luc)} atual={k.luc} anterior={k.lucAnt} sub={`margem ${pct(k.margem)} · já sem custo e taxa`} />
        <Indicador titulo="Vendas" valor={k.qtd.toLocaleString('pt-BR')} atual={k.qtd} anterior={k.qtdAnt} />
        <Indicador titulo="Ticket médio" valor={brl(k.ticket)} atual={k.ticket} anterior={k.ticketAnt} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini titulo="Taxas de cartão" valor={brl(k.taxa)} sub={k.fat ? `${pct((k.taxa / k.fat) * 100)} do faturamento` : ''} />
        <Mini titulo="Descontos dados" valor={brl(k.desconto)} />
        <Mini titulo="Estoque a preço de custo" valor={brl(estoque.custo)} sub={`${estoque.itens.toLocaleString('pt-BR')} produto(s) com saldo`} />
        <Mini
          titulo="Estoque a preço de venda"
          valor={brl(estoque.venda)}
          sub={estoque.custo > 0 ? `lucro potencial ${brl(r2(estoque.venda - estoque.custo))} (${pct(((estoque.venda - estoque.custo) / estoque.custo) * 100)} sobre o custo)` : ''}
        />
      </div>

      {/* financeiro em aberto: em dia × vencido */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PainelConta titulo="📥 A receber" r={fin.receber} />
        <PainelConta titulo="📤 A pagar" r={fin.pagar} />
      </div>

      {/* gráfico principal */}
      <Cartao titulo={int.dias === 1 ? 'Faturamento por hora' : 'Faturamento por dia'} sub="Passe o mouse (ou toque) nas barras para ver o lucro e o nº de vendas.">
        {carregando ? <Vazio texto="Carregando…" /> : k.qtd === 0 ? <Vazio texto="Nenhuma venda no período." /> : <Colunas dados={serie} formatar={brlCurto} />}
      </Cartao>

      <div className="grid gap-4 lg:grid-cols-2">
        <Cartao titulo="Mais vendidos (faturamento)">
          {carregando ? <Vazio texto="Carregando…" /> : top.length ? <Barras itens={top} /> : <Vazio texto="Nenhuma venda no período." />}
        </Cartao>
        <div className="space-y-4">
          <Cartao titulo="Formas de pagamento">{formas.length ? <Barras itens={formas} /> : <Vazio texto="Nenhuma venda no período." />}</Cartao>
          {int.dias > 1 && porHora.length > 0 && (
            <Cartao titulo="Movimento por hora (nº de vendas)" sub="Bom para escalar o atendimento nos horários de pico.">
              <Colunas dados={porHora.map((b) => ({ ...b, valor: b.qtd, faturamento: b.valor }))} formatar={(n) => String(Math.round(n))} contagem altura={120} />
            </Cartao>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Cartao titulo="Estoque">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-gray-50 p-2.5">
              <div className="text-[11px] uppercase text-gray-500">A preço de custo</div>
              <div className="text-lg font-bold text-gray-900">{brl(estoque.custo)}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-2.5">
              <div className="text-[11px] uppercase text-gray-500">A preço de venda</div>
              <div className="text-lg font-bold text-gray-900">{brl(estoque.venda)}</div>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">Estoque administrativo × custo do cadastro e × preço padrão de venda.</p>
          <p className="mt-3 mb-1 text-xs font-bold uppercase text-gray-500">Abaixo do mínimo ({estoque.baixo.length})</p>
          {estoque.baixo.length === 0 ? (
            <p className="text-sm text-gray-500">✓ Nenhum produto abaixo do estoque mínimo.</p>
          ) : (
            <ul className="max-h-64 divide-y overflow-y-auto text-sm">
              {estoque.baixo.slice(0, 50).map((p, i) => (
                <li key={i} className="flex justify-between gap-2 py-1.5">
                  <span className="truncate text-gray-800">
                    <span aria-hidden>⚠</span> {p.nome}
                  </span>
                  <span className="whitespace-nowrap text-gray-600">
                    tem <b className={p.saldo <= 0 ? 'text-red-700' : 'text-gray-900'}>{p.saldo.toLocaleString('pt-BR')}</b> · mín. {p.minimo.toLocaleString('pt-BR')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
        <Cartao titulo="Resumo do período">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-gray-600">Faturamento</dt>
            <dd className="text-right font-semibold">{brl(k.fat)}</dd>
            <dt className="text-gray-600">(−) Custo dos produtos</dt>
            <dd className="text-right">{brl(r2(k.atual.reduce((s, x) => s + Number(x.custo_total || 0), 0)))}</dd>
            <dt className="text-gray-600">(−) Taxas de cartão</dt>
            <dd className="text-right">{brl(k.taxa)}</dd>
            <dt className="border-t pt-2 font-bold text-gray-800">= Lucro real</dt>
            <dd className={`border-t pt-2 text-right text-lg font-black ${k.luc >= 0 ? 'text-green-700' : 'text-red-700'}`}>{brl(k.luc)}</dd>
            <dt className="text-gray-600">Margem sobre a venda</dt>
            <dd className="text-right">{pct(k.margem)}</dd>
            <dt className="text-gray-600">Média por dia</dt>
            <dd className="text-right">{brl(r2(k.fat / int.dias))}</dd>
          </dl>
          <p className="mt-3 text-[11px] text-gray-400">Vendas canceladas não entram. Despesas da loja (aluguel, salários) não estão descontadas.</p>
        </Cartao>
      </div>
    </div>
  );
}

// ---------- peças ----------
function Cartao({ titulo, sub, children }: { titulo: string; sub?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm">
      <h3 className="font-bold text-gray-800">{titulo}</h3>
      {sub && <p className="mb-2 text-[11px] text-gray-500">{sub}</p>}
      <div className={sub ? '' : 'mt-2'}>{children}</div>
    </section>
  );
}

const Vazio = ({ texto }: { texto: string }) => <p className="py-8 text-center text-sm text-gray-500">{texto}</p>;

function Indicador({ titulo, valor, atual, anterior, sub, destaque }: { titulo: string; valor: string; atual: number; anterior: number; sub?: string; destaque?: boolean }) {
  const varia = anterior ? ((atual - anterior) / Math.abs(anterior)) * 100 : null;
  return (
    <div className={`rounded-xl p-4 shadow-sm ${destaque ? 'bg-blue-900 text-white' : 'bg-white'}`}>
      <div className={`text-[11px] font-medium uppercase ${destaque ? 'text-blue-200' : 'text-gray-500'}`}>{titulo}</div>
      <div className={`text-2xl font-black ${destaque ? 'text-white' : 'text-gray-900'}`}>{valor}</div>
      <div className={`text-[11px] ${destaque ? 'text-blue-100' : 'text-gray-600'}`}>
        {varia == null ? (
          'sem período anterior para comparar'
        ) : (
          <>
            <span aria-hidden>{varia >= 0 ? '▲' : '▼'}</span> <b>{pct(Math.abs(varia))}</b> {varia >= 0 ? 'acima' : 'abaixo'} do período anterior
          </>
        )}
      </div>
      {sub && <div className={`text-[11px] ${destaque ? 'text-blue-100' : 'text-gray-500'}`}>{sub}</div>}
    </div>
  );
}

function Mini({ titulo, valor, sub, alerta }: { titulo: string; valor: string; sub?: string; alerta?: boolean }) {
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <div className="text-[11px] font-medium uppercase text-gray-500">{titulo}</div>
      <div className="text-lg font-bold text-gray-900">{valor}</div>
      {sub && <div className={`text-[11px] ${alerta ? 'font-semibold text-red-700' : 'text-gray-500'}`}>{sub}</div>}
    </div>
  );
}

// a pagar / a receber: total em aberto, em dia (destaque) e em atraso
type Parte = { qtd: number; total: number };
function PainelConta({ titulo, r }: { titulo: string; r: { total: Parte; emDia: Parte; vencido: Parte; hoje: Parte; prox7: Parte } }) {
  const semAtraso = r.vencido.qtd === 0;
  const pctDia = r.total.total > 0 ? (r.emDia.total / r.total.total) * 100 : 100;
  return (
    <section className={`rounded-xl bg-white p-4 shadow-sm border-l-4 ${semAtraso ? 'border-green-600' : 'border-red-600'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-bold text-gray-800">{titulo}</h3>
        <span className="text-xs text-gray-500">{r.total.qtd} conta(s) em aberto</span>
      </div>
      <div className="text-2xl font-black text-gray-900">{brl(r.total.total)}</div>

      {semAtraso ? (
        <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm font-bold text-green-800">✓ Nenhuma conta em atraso — tudo em dia</p>
      ) : (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-800">
          ⚠ {r.vencido.qtd} conta(s) em atraso: {brl(r.vencido.total)}
        </p>
      )}

      {/* barra: parte em dia × parte vencida */}
      {r.total.total > 0 && (
        <div className="mt-3">
          <div className="flex h-2.5 gap-[2px] overflow-hidden rounded">
            <div style={{ width: `${pctDia}%`, background: '#0ca30c' }} />
            {!semAtraso && <div style={{ width: `${100 - pctDia}%`, background: '#d03b3b' }} />}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-gray-600">
            <span>✓ Em dia {brl(r.emDia.total)} ({pct(pctDia)})</span>
            {!semAtraso && <span>⚠ Vencido {brl(r.vencido.total)}</span>}
          </div>
        </div>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-gray-600">Vence hoje</dt>
        <dd className="text-right font-semibold">{r.hoje.qtd ? `${brl(r.hoje.total)} (${r.hoje.qtd})` : '—'}</dd>
        <dt className="text-gray-600">Próximos 7 dias</dt>
        <dd className="text-right font-semibold">{r.prox7.qtd ? `${brl(r.prox7.total)} (${r.prox7.qtd})` : '—'}</dd>
      </dl>
    </section>
  );
}

// colunas verticais com grade, eixo e dica ao passar o mouse
function Colunas({
  dados,
  formatar,
  contagem,
  altura = 200,
}: {
  dados: { rotulo: string; valor: number; lucro: number; qtd: number; faturamento?: number }[];
  formatar: (n: number) => string;
  contagem?: boolean;
  altura?: number;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(...dados.map((d) => d.valor), 0);
  // topo "redondo" para a grade
  const passo = max > 0 ? Math.pow(10, Math.floor(Math.log10(max))) : 1;
  const topo = max > 0 ? Math.ceil(max / passo) * passo : 1;
  const linhas = [topo, topo / 2, 0];
  const cada = Math.max(1, Math.ceil(dados.length / 12)); // rótulos do eixo sem amontoar
  const d = sel != null ? dados[sel] : null;

  return (
    <div className="flex gap-2">
      <div className="flex flex-col justify-between text-right text-[10px] tabular-nums text-gray-500" style={{ height: altura }}>
        {linhas.map((l, i) => (
          <span key={i} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
            {formatar(l)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height: altura }} onMouseLeave={() => setSel(null)}>
          {linhas.map((l, i) => (
            <div key={i} className="absolute inset-x-0" style={{ top: `${(1 - l / topo) * 100}%`, borderTop: `1px solid ${l === 0 ? BASE : GRADE}` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {dados.map((b, i) => (
              <div
                key={i}
                className="flex h-full flex-1 cursor-default items-end"
                onMouseEnter={() => setSel(i)}
                onClick={() => setSel(sel === i ? null : i)}
              >
                <div
                  className="w-full"
                  style={{
                    height: `${topo ? (b.valor / topo) * 100 : 0}%`,
                    minHeight: b.valor > 0 ? 2 : 0,
                    background: SERIE,
                    opacity: sel == null || sel === i ? 1 : 0.45,
                    borderRadius: '4px 4px 0 0',
                    maxWidth: 48,
                    margin: '0 auto',
                  }}
                />
              </div>
            ))}
          </div>
          {d && sel != null && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border bg-white px-2.5 py-1.5 text-xs shadow-lg"
              style={{ left: `${((sel + 0.5) / dados.length) * 100}%`, top: 0 }}
            >
              <div className="font-bold text-gray-800">{d.rotulo}</div>
              {contagem ? (
                <>
                  <div className="text-gray-700">{d.qtd} venda(s)</div>
                  <div className="text-gray-500">{brl(r2(d.faturamento || 0))}</div>
                </>
              ) : (
                <>
                  <div className="text-gray-700">Faturamento {brl(r2(d.valor))}</div>
                  <div className="text-gray-700">Lucro {brl(r2(d.lucro))}</div>
                  <div className="text-gray-500">{d.qtd} venda(s)</div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="mt-1 flex gap-[2px] text-[10px] text-gray-500">
          {dados.map((b, i) => (
            <span key={i} className="flex-1 overflow-hidden text-center whitespace-nowrap">
              {i % cada === 0 ? b.rotulo : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// barras horizontais com o valor escrito ao lado
function Barras({ itens }: { itens: { rotulo: string; valor: number; sub?: string }[] }) {
  const max = Math.max(...itens.map((i) => i.valor), 0) || 1;
  return (
    <ul className="space-y-2.5">
      {itens.map((i, k) => (
        <li key={k} title={`${i.rotulo}: ${brl(i.valor)}`}>
          <div className="flex justify-between gap-2 text-xs">
            <span className="truncate text-gray-800">{i.rotulo}</span>
            <span className="whitespace-nowrap font-semibold text-gray-900">
              {brl(i.valor)}
              {i.sub && <span className="ml-1 font-normal text-gray-500">· {i.sub}</span>}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-r" style={{ width: `${(i.valor / max) * 100}%`, minWidth: 2, background: SERIE, borderRadius: '0 4px 4px 0' }} />
        </li>
      ))}
    </ul>
  );
}
