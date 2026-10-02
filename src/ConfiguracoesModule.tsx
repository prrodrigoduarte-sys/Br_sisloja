// BR Sisloja - Configurações (só administrador)
// - Registro de atividades: quem incluiu, alterou ou excluiu o quê (vendas, produtos, notas, contas...).
//   Só abre com a senha do administrador logado, conferida no banco a cada consulta.
// - Usuários: liga logins à loja, define perfil (o que cada um pode fazer) e bloqueia acesso.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';

type Usuario = { id: string; email: string; nome: string; perfil: string; codigo_loja: string; loja_nome: string };

type Registro = {
  id: number;
  usuario: string | null;
  acao: string;
  tabela: string | null;
  registro_id: string | null;
  descricao: string | null;
  motivo: string | null;
  antes: Record<string, any> | null;
  depois: Record<string, any> | null;
  created_at: string;
};

type UsuarioLoja = {
  user_id: string;
  email: string;
  nome: string | null;
  perfil: string | null;
  ativo: boolean;
  vinculado: boolean;
  ultimo_acesso: string | null;
  criado_em: string;
};

const TABELAS: Record<string, string> = {
  vendas: 'Vendas',
  produtos: 'Produtos',
  precos_produto: 'Preços',
  tabelas_preco: 'Tabelas de preço',
  margens_lucro: 'Margens de lucro',
  notas_entrada: 'Notas de entrada',
  fornecedores: 'Fornecedores',
  clientes: 'Clientes',
  contas_pagar: 'Contas a pagar',
  contas_receber: 'Contas a receber',
  perfis: 'Usuários',
  lojas: 'Loja',
  ajustes_estoque: 'Ajustes de estoque',
};

const ACOES: Record<string, { rotulo: string; cor: string }> = {
  inclusao: { rotulo: 'Incluiu', cor: 'bg-green-100 text-green-800' },
  alteracao: { rotulo: 'Alterou', cor: 'bg-blue-100 text-blue-800' },
  exclusao: { rotulo: 'Excluiu', cor: 'bg-red-100 text-red-800' },
  exclusao_nota_entrada: { rotulo: 'Excluiu nota de entrada', cor: 'bg-red-600 text-white' },
};

export const PERFIS: { id: string; rotulo: string; pode: string }[] = [
  { id: 'admin', rotulo: 'Administrador', pode: 'tudo, inclusive Configurações e registro de atividades' },
  { id: 'gerente', rotulo: 'Gerente', pode: 'PDV, produtos, preços, notas, financeiro e relatórios' },
  { id: 'colaborador', rotulo: 'Colaborador', pode: 'tudo, menos o que exige a senha do administrador (Configurações e exclusão de nota)' },
  { id: 'financeiro', rotulo: 'Financeiro', pode: 'financeiro, fornecedores e relatórios' },
  { id: 'estoquista', rotulo: 'Estoquista', pode: 'produtos, estoque, notas de entrada e fornecedores' },
  { id: 'caixa', rotulo: 'Caixa', pode: 'PDV (vendas)' },
];

const BLOQUEIO_MIN = 10; // fecha o registro depois de 10 min sem uso

const IGNORAR = new Set(['updated_at', 'created_at', 'xml']);
const dataHora = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : '—');
const hoje = () => new Date().toLocaleDateString('sv-SE');
const valorTexto = (v: any) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const brl = (n: any) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function titulo(r: Registro) {
  const x = r.depois || r.antes || {};
  if (r.tabela === 'vendas') return `Venda nº ${x.numero ?? ''} · ${brl(x.total)} · ${x.forma_pagamento || ''}${x.operador ? ` · operador ${x.operador}` : ''}`;
  if (r.tabela === 'contas_pagar' || r.tabela === 'contas_receber') return `${x.descricao || ''} · ${brl(x.valor)}`;
  return r.descricao || x.descricao || x.nome || x.razao_social || (x.numero ? `NF ${x.numero}` : '') || r.registro_id || '';
}

function diferencas(r: Registro) {
  const a = r.antes || {};
  const d = r.depois || {};
  const campos = Array.from(new Set([...Object.keys(a), ...Object.keys(d)])).filter((c) => !IGNORAR.has(c));
  if (!r.depois) return campos.map((c) => ({ campo: c, antes: a[c], depois: undefined }));
  if (!r.antes) return campos.map((c) => ({ campo: c, antes: undefined, depois: d[c] }));
  return campos.filter((c) => JSON.stringify(a[c]) !== JSON.stringify(d[c])).map((c) => ({ campo: c, antes: a[c], depois: d[c] }));
}

export default function ConfiguracoesModule({ loggedUser }: { loggedUser: Usuario }) {
  const ehAdmin = (loggedUser?.perfil || '').toLowerCase() === 'admin';
  const [sub, setSub] = useState<'registro' | 'ajustes' | 'usuarios' | 'taxas'>('registro');
  if (!ehAdmin) return <p className="p-6 text-center text-sm text-gray-500">Somente o administrador acessa as Configurações.</p>;

  return (
    <div className="mx-auto max-w-7xl p-3 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-bold text-gray-800">⚙️ Configurações</h2>
        {(
          [
            ['registro', '📜 Registro de atividades'],
            ['ajustes', '📦 Ajustes de estoque'],
            ['usuarios', '👥 Usuários'],
            ['taxas', '💳 Taxas de cartão'],
          ] as const
        ).map(([id, rot]) => (
          <button
            key={id}
            onClick={() => setSub(id)}
            className={`rounded-lg px-3 py-2 text-sm ${sub === id ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            {rot}
          </button>
        ))}
      </div>
      {sub === 'registro' && <RegistroAtividades loggedUser={loggedUser} />}
      {sub === 'ajustes' && <AjustesEstoque loggedUser={loggedUser} />}
      {sub === 'usuarios' && <Usuarios loggedUser={loggedUser} />}
      {sub === 'taxas' && <TaxasCartao />}
    </div>
  );
}

// =====================================================================
// TAXAS DE CARTÃO (% da maquininha): descontadas do lucro de cada venda
// =====================================================================
const LINHAS_TAXA: { forma: string; parcelas: number; rotulo: string }[] = [
  { forma: 'cartao_debito', parcelas: 1, rotulo: 'Débito' },
  ...Array.from({ length: 10 }, (_, i) => ({ forma: 'cartao_credito', parcelas: i + 1, rotulo: i === 0 ? 'Crédito à vista (1x)' : `Crédito ${i + 1}x` })),
];
const chaveTaxa = (forma: string, parcelas: number) => `${forma}|${parcelas}`;

function TaxasCartao() {
  const [valores, setValores] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('taxas_cartao').select('forma, parcelas, taxa');
      setCarregando(false);
      if (error) {
        setMsg({
          tipo: 'erro',
          texto: error.message.includes('taxas_cartao') ? 'Falta atualizar o banco: rode o arquivo fase6_taxas_cartao.sql no SQL Editor do Supabase.' : 'Erro: ' + error.message,
        });
        return;
      }
      const v: Record<string, string> = {};
      ((data as any[]) || []).forEach((x) => (v[chaveTaxa(x.forma, x.parcelas)] = String(x.taxa).replace('.', ',')));
      setValores(v);
    })();
  }, []);

  const salvar = async () => {
    const taxas = LINHAS_TAXA.map((l) => ({ ...l, taxa: Number((valores[chaveTaxa(l.forma, l.parcelas)] || '0').replace(',', '.')) }));
    const ruim = taxas.find((t) => !isFinite(t.taxa) || t.taxa < 0 || t.taxa >= 100);
    if (ruim) return setMsg({ tipo: 'erro', texto: `Taxa inválida em "${ruim.rotulo}".` });
    setSalvando(true);
    setMsg(null);
    const { error } = await supabase.rpc('salvar_taxas_cartao', { p_taxas: taxas.map(({ forma, parcelas, taxa }) => ({ forma, parcelas, taxa })) });
    setSalvando(false);
    setMsg(error ? { tipo: 'erro', texto: error.message } : { tipo: 'ok', texto: 'Taxas salvas. Valem para as próximas vendas.' });
  };

  if (carregando) return <p className="p-6 text-center text-sm text-gray-500">Carregando…</p>;

  return (
    <div className="max-w-md space-y-3">
      {msg && <p className={`rounded-lg p-3 text-sm ${msg.tipo === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{msg.texto}</p>}
      <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-900">
        Informe a taxa que a maquininha cobra (% sobre o valor da venda). O preço para o cliente não muda: a taxa é descontada do lucro da venda e
        do valor que entra no Contas a receber. Deixe 0 se não houver taxa.
      </div>
      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-[11px] uppercase text-gray-500">
            <tr>
              <th className="p-2">Forma</th>
              <th className="p-2 text-right">Taxa (%)</th>
            </tr>
          </thead>
          <tbody>
            {LINHAS_TAXA.map((l) => {
              const k = chaveTaxa(l.forma, l.parcelas);
              return (
                <tr key={k} className="border-t">
                  <td className="p-2 text-gray-800">{l.rotulo}</td>
                  <td className="p-2 text-right">
                    <input
                      value={valores[k] ?? ''}
                      onChange={(e) => setValores((v) => ({ ...v, [k]: e.target.value }))}
                      inputMode="decimal"
                      placeholder="0,00"
                      className="w-24 rounded border px-2 py-1 text-right"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button onClick={salvar} disabled={salvando} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
        {salvando ? 'Salvando…' : 'Salvar taxas'}
      </button>
    </div>
  );
}

// =====================================================================
// REGISTRO DE ATIVIDADES (pede a senha do administrador)
// =====================================================================
function RegistroAtividades({ loggedUser }: { loggedUser: Usuario }) {
  const [senha, setSenha] = useState(''); // fica só na memória desta tela
  const [digitada, setDigitada] = useState('');
  const [liberado, setLiberado] = useState(false);
  const [lista, setLista] = useState<Registro[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [de, setDe] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toLocaleDateString('sv-SE');
  });
  const [ate, setAte] = useState(hoje());
  const [tabela, setTabela] = useState('');
  const [acao, setAcao] = useState('');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<number | null>(null);
  const ultimoUso = useRef(Date.now());

  const consultar = async (s: string) => {
    setCarregando(true);
    setErro('');
    const { data, error } = await supabase.rpc('auditoria_consultar', {
      p_senha: s,
      p_de: new Date(de + 'T00:00:00').toISOString(),
      p_ate: new Date(ate + 'T23:59:59.999').toISOString(),
      p_tabela: tabela || null,
      p_acao: acao || null,
    });
    setCarregando(false);
    if (error) {
      if (error.message.includes('Senha')) {
        bloquear();
        setErro('Senha do administrador incorreta.');
      } else
        setErro(
          error.message.includes('auditoria_consultar')
            ? 'Falta atualizar o banco: rode o arquivo fase4_usuarios.sql no SQL Editor do Supabase.'
            : 'Erro: ' + error.message
        );
      return false;
    }
    setLista((data as Registro[]) || []);
    ultimoUso.current = Date.now();
    return true;
  };

  const bloquear = () => {
    setLiberado(false);
    setSenha('');
    setLista([]);
  };

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!digitada) return;
    if (await consultar(digitada)) {
      setSenha(digitada);
      setLiberado(true);
    }
    setDigitada('');
  };

  // refaz a consulta quando muda o filtro
  useEffect(() => {
    if (liberado && senha) consultar(senha);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de, ate, tabela, acao]);

  // tranca sozinho depois de um tempo sem uso
  useEffect(() => {
    if (!liberado) return;
    const marcar = () => (ultimoUso.current = Date.now());
    window.addEventListener('mousemove', marcar);
    window.addEventListener('keydown', marcar);
    const t = setInterval(() => {
      if (Date.now() - ultimoUso.current > BLOQUEIO_MIN * 60000) bloquear();
    }, 30000);
    return () => {
      clearInterval(t);
      window.removeEventListener('mousemove', marcar);
      window.removeEventListener('keydown', marcar);
    };
  }, [liberado]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return lista;
    return lista.filter((r) => [r.usuario, titulo(r), r.motivo, r.descricao].some((x) => (x || '').toLowerCase().includes(t)));
  }, [lista, busca]);

  if (!liberado) {
    return (
      <form onSubmit={entrar} className="mx-auto max-w-sm space-y-3 rounded-xl bg-white p-6 text-sm shadow-sm">
        <div className="text-center text-3xl">🔒</div>
        <h3 className="text-center text-lg font-bold text-gray-800">Registro de atividades</h3>
        <p className="text-center text-gray-600">
          Digite a sua senha de administrador ({loggedUser.email}) para ver quem fez o quê no sistema.
        </p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={digitada}
          onChange={(e) => setDigitada(e.target.value)}
          className="w-full rounded-lg border px-3 py-2"
          placeholder="Senha"
        />
        {erro && <p className="rounded-lg bg-red-50 p-2 text-center text-red-700">{erro}</p>}
        <button type="submit" disabled={carregando || !digitada} className="w-full rounded-lg bg-gray-800 py-2 font-semibold text-white disabled:opacity-50">
          {carregando ? 'Conferindo…' : 'Abrir registro'}
        </button>
        <p className="text-center text-[11px] text-gray-400">O registro tranca sozinho depois de {BLOQUEIO_MIN} minutos sem uso.</p>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 text-sm shadow-sm">
        de <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded border px-2 py-1" />
        até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded border px-2 py-1" />
        <select value={tabela} onChange={(e) => setTabela(e.target.value)} className="rounded border px-2 py-1">
          <option value="">Tudo</option>
          {Object.entries(TABELAS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={acao} onChange={(e) => setAcao(e.target.value)} className="rounded border px-2 py-1">
          <option value="">Todas as ações</option>
          {Object.entries(ACOES).map(([k, v]) => (
            <option key={k} value={k}>
              {v.rotulo}
            </option>
          ))}
        </select>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar usuário, produto, motivo…"
          className="min-w-[180px] flex-1 rounded-lg border px-3 py-1"
        />
        <button onClick={bloquear} className="rounded-lg border px-3 py-1 hover:bg-gray-50" title="Fechar o registro">
          🔒 Trancar
        </button>
      </div>

      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      <div className="rounded-xl bg-white shadow-sm">
        {carregando ? (
          <p className="p-6 text-center text-sm text-gray-500">Carregando…</p>
        ) : !filtrados.length ? (
          <p className="p-6 text-center text-sm text-gray-500">Nenhuma atividade no período.</p>
        ) : (
          filtrados.map((r) => {
            const a = ACOES[r.acao] || { rotulo: r.acao, cor: 'bg-gray-100 text-gray-700' };
            const difs = aberto === r.id ? diferencas(r) : [];
            return (
              <div key={r.id} className="border-t first:border-t-0">
                <button
                  onClick={() => setAberto(aberto === r.id ? null : r.id)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-left text-sm hover:bg-gray-50"
                >
                  <span className="w-36 text-xs text-gray-500">{dataHora(r.created_at)}</span>
                  <span className="w-32 truncate font-medium text-gray-800">{r.usuario || '—'}</span>
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${a.cor}`}>{a.rotulo}</span>
                  <span className="text-xs text-gray-500">{TABELAS[r.tabela || ''] || r.tabela}</span>
                  <span className="min-w-0 flex-1 truncate text-gray-700">{titulo(r)}</span>
                  {r.motivo && <span className="truncate text-xs italic text-gray-500">motivo: {r.motivo}</span>}
                </button>
                {aberto === r.id && (
                  <div className="overflow-x-auto bg-gray-50 px-4 py-2">
                    {r.descricao && <p className="mb-2 text-sm text-gray-700">{r.descricao}</p>}
                    {difs.length ? (
                      <table className="text-xs">
                        <thead className="text-left text-gray-500">
                          <tr>
                            <th className="pr-4">Campo</th>
                            {r.antes && <th className="pr-4">Antes</th>}
                            {r.depois && <th>{r.antes ? 'Depois' : 'Valor'}</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {difs.map((d) => (
                            <tr key={d.campo} className="border-t align-top">
                              <td className="py-1 pr-4 font-medium">{d.campo}</td>
                              {r.antes && <td className="max-w-[360px] break-all py-1 pr-4 text-red-700">{valorTexto(d.antes)}</td>}
                              {r.depois && <td className="max-w-[360px] break-all py-1 text-green-700">{valorTexto(d.depois)}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-xs text-gray-500">Sem detalhes de campos.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// =====================================================================
// AJUSTES DE ESTOQUE (relatório só do administrador)
// =====================================================================
type Ajuste = {
  id: number;
  produto_nome: string;
  sku: string;
  modo: string;
  saldo_anterior: number;
  quantidade: number;
  saldo_novo: number;
  custo_unitario: number | null;
  valor: number | null;
  motivo: string;
  observacao: string | null;
  usuario: string | null;
  created_at: string;
  excluido_em: string | null;
  excluido_por: string | null;
  motivo_exclusao: string | null;
};

function AjustesEstoque({ loggedUser }: { loggedUser: Usuario }) {
  const [lista, setLista] = useState<Ajuste[]>([]);
  const [versao, setVersao] = useState(0);
  const [permiteExcluir, setPermiteExcluir] = useState<boolean | null>(null);
  const [excluir, setExcluir] = useState<Ajuste | null>(null);
  const [aviso, setAviso] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [de, setDe] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toLocaleDateString('sv-SE');
  });
  const [ate, setAte] = useState(hoje());
  const [usuario, setUsuario] = useState('');
  const [motivo, setMotivo] = useState('');
  const [busca, setBusca] = useState('');

  useEffect(() => {
    (async () => {
      setCarregando(true);
      setErro('');
      const { data, error } = await supabase
        .from('ajustes_estoque')
        .select('*')
        .eq('codigo_loja', loggedUser.codigo_loja)
        .gte('created_at', new Date(de + 'T00:00:00').toISOString())
        .lte('created_at', new Date(ate + 'T23:59:59.999').toISOString())
        .order('created_at', { ascending: false })
        .limit(5000);
      if (error)
        setErro(error.message.includes('ajustes_estoque') ? 'Falta atualizar o banco: rode o fase5_ajuste_estoque.sql no Supabase.' : 'Erro: ' + error.message);
      setLista(((data as any[]) || []).map((x) => ({ ...x, quantidade: Number(x.quantidade), valor: x.valor == null ? null : Number(x.valor) })));
      const { data: loja } = await supabase.from('lojas').select('permite_excluir_ajuste').eq('codigo_loja', loggedUser.codigo_loja).maybeSingle();
      setPermiteExcluir(loja ? !!(loja as any).permite_excluir_ajuste : null);
      setCarregando(false);
    })();
  }, [loggedUser.codigo_loja, de, ate, versao]);

  const alternarExclusao = async (v: boolean) => {
    if (!v && !window.confirm('Desligar a exclusão de ajustes? Depois disso nenhum ajuste poderá ser excluído (até ligar de novo).')) return;
    const { error } = await supabase.rpc('config_excluir_ajuste', { p_permitir: v });
    if (error) return setErro('Não foi possível mudar: ' + error.message);
    setPermiteExcluir(v);
  };

  const usuarios = useMemo(() => Array.from(new Set(lista.map((a) => a.usuario || '—'))).sort(), [lista]);
  const motivos = useMemo(() => Array.from(new Set(lista.map((a) => a.motivo))).sort(), [lista]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return lista.filter(
      (a) =>
        (!usuario || (a.usuario || '—') === usuario) &&
        (!motivo || a.motivo === motivo) &&
        (!t || a.produto_nome.toLowerCase().includes(t) || (a.sku || '').toLowerCase().includes(t))
    );
  }, [lista, usuario, motivo, busca]);

  // ajustes excluídos aparecem riscados e não entram nos totais
  const tot = useMemo(() => {
    const validos = filtrados.filter((a) => !a.excluido_em);
    const entrou = validos.filter((a) => a.quantidade > 0).reduce((s, a) => s + (a.valor || 0), 0);
    const saiu = validos.filter((a) => a.quantidade < 0).reduce((s, a) => s + (a.valor || 0), 0);
    return { qtd: validos.length, entrou, saiu, saldo: entrou + saiu };
  }, [filtrados]);

  const qtd = (n: number) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

  const exportarCsv = () => {
    const sep = ';';
    const n = (v: any) => String(v ?? '').replace('.', ',');
    const cab = ['Data/hora', 'Usuário', 'Código', 'Produto', 'Tipo', 'Antes', 'Ajuste', 'Depois', 'Custo unit.', 'Valor', 'Motivo', 'Observação'];
    const linhas = filtrados.map((a) =>
      [dataHora(a.created_at), a.usuario || '', a.sku, a.produto_nome, a.modo, n(a.saldo_anterior), n(a.quantidade), n(a.saldo_novo), n(a.custo_unitario), n(a.valor), a.motivo, a.observacao || '']
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(sep)
    );
    const blob = new Blob(['﻿' + [cab.join(sep), ...linhas].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ajustes-estoque-${de}-a-${ate}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 text-sm shadow-sm">
        de <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded border px-2 py-1" />
        até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded border px-2 py-1" />
        <select value={usuario} onChange={(e) => setUsuario(e.target.value)} className="rounded border px-2 py-1">
          <option value="">Todos os usuários</option>
          {usuarios.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className="rounded border px-2 py-1">
          <option value="">Todos os motivos</option>
          {motivos.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Produto ou código" className="min-w-[150px] flex-1 rounded-lg border px-3 py-1" />
        <button onClick={exportarCsv} disabled={!filtrados.length} className="rounded-lg border px-3 py-1 hover:bg-gray-50 disabled:opacity-40">
          ⬇ Excel (CSV)
        </button>
        <button onClick={() => window.print()} className="rounded-lg border px-3 py-1 hover:bg-gray-50">
          🖨 Imprimir
        </button>
      </div>

      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {aviso && (
        <p className="flex items-center rounded-lg bg-green-50 p-3 text-sm text-green-800">
          <span className="flex-1">{aviso}</span>
          <button onClick={() => setAviso('')}>✕</button>
        </p>
      )}

      {permiteExcluir !== null && (
        <div
          className={`flex flex-wrap items-center gap-3 rounded-xl p-3 text-sm ${
            permiteExcluir ? 'bg-amber-50 border border-amber-300 text-amber-900' : 'bg-gray-100 text-gray-700'
          }`}
        >
          <label className="flex items-center gap-2 font-semibold">
            <input type="checkbox" checked={permiteExcluir} onChange={(e) => alternarExclusao(e.target.checked)} className="h-4 w-4" />
            Permitir excluir ajustes
          </label>
          <span className="text-xs">
            {permiteExcluir
              ? 'Ligado: o administrador pode excluir um ajuste lançado em duplicidade (o estoque volta ao que era). Desligue quando fechar o inventário.'
              : 'Desligado: nenhum ajuste pode ser excluído.'}
          </span>
        </div>
      )}

      {excluir && (
        <ExcluirAjuste
          ajuste={excluir}
          aoFechar={() => setExcluir(null)}
          aoExcluir={(msg) => {
            setExcluir(null);
            setAviso(msg);
            setVersao((v) => v + 1);
          }}
        />
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Ajustes', String(tot.qtd), 'text-gray-800'],
          ['Entrou (a custo)', brl(tot.entrou), 'text-green-700'],
          ['Saiu (a custo)', brl(tot.saiu), 'text-red-700'],
          ['Resultado', brl(tot.saldo), tot.saldo < 0 ? 'text-red-700' : 'text-green-700'],
        ].map(([t, v, c]) => (
          <div key={t} className="rounded-xl bg-white p-3 shadow-sm">
            <div className="text-[11px] font-medium uppercase text-gray-500">{t}</div>
            <div className={`text-lg font-bold ${c}`}>{v}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        {carregando ? (
          <p className="p-6 text-center text-sm text-gray-500">Carregando…</p>
        ) : !filtrados.length ? (
          <p className="p-6 text-center text-sm text-gray-500">Nenhum ajuste no período.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-[11px] uppercase text-gray-600">
              <tr>
                <th className="p-2">Data</th>
                <th className="p-2">Usuário</th>
                <th className="p-2">Produto</th>
                <th className="p-2 text-right">Antes</th>
                <th className="p-2 text-right">Ajuste</th>
                <th className="p-2 text-right">Depois</th>
                <th className="p-2 text-right">Valor</th>
                <th className="p-2">Motivo</th>
                {permiteExcluir && <th />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtrados.map((a) => (
                <tr key={a.id} className={a.excluido_em ? 'bg-gray-50 text-gray-400 line-through' : ''}>
                  <td className="p-2 whitespace-nowrap text-xs text-gray-500">{dataHora(a.created_at)}</td>
                  <td className="p-2 whitespace-nowrap">{a.usuario || '—'}</td>
                  <td className="p-2">
                    <div className="font-medium text-gray-800">{a.produto_nome}</div>
                    <div className="text-[10px] text-gray-400">
                      Cód. {a.sku} · {a.modo === 'contagem' ? 'contagem' : 'soma/subtração'}
                    </div>
                  </td>
                  <td className="p-2 text-right">{qtd(a.saldo_anterior)}</td>
                  <td className={`p-2 text-right font-bold ${a.quantidade < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {a.quantidade > 0 ? '+' : ''}
                    {qtd(a.quantidade)}
                  </td>
                  <td className="p-2 text-right">{qtd(a.saldo_novo)}</td>
                  <td className={`p-2 text-right whitespace-nowrap ${(a.valor || 0) < 0 ? 'text-red-600' : 'text-green-700'}`}>{brl(a.valor)}</td>
                  <td className="p-2 text-xs">
                    {a.motivo}
                    {a.observacao && <div className="italic text-gray-500">{a.observacao}</div>}
                    {a.excluido_em && (
                      <div className="mt-1 inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700 no-underline" style={{ textDecoration: 'none' }}>
                        EXCLUÍDO por {a.excluido_por} em {dataHora(a.excluido_em)}
                        {a.motivo_exclusao ? ` · ${a.motivo_exclusao}` : ''}
                      </div>
                    )}
                  </td>
                  {permiteExcluir && (
                    <td className="p-2 text-right" style={{ textDecoration: 'none' }}>
                      {!a.excluido_em && (
                        <button onClick={() => setExcluir(a)} className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">
                          Excluir
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ExcluirAjuste({ ajuste, aoFechar, aoExcluir }: { ajuste: Ajuste; aoFechar: () => void; aoExcluir: (msg: string) => void }) {
  const [motivo, setMotivo] = useState('Lançado em duplicidade');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [excluindo, setExcluindo] = useState(false);
  const q = (n: number) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!senha) return setErro('Digite a sua senha de administrador.');
    setExcluindo(true);
    setErro('');
    const { error } = await supabase.rpc('excluir_ajuste_estoque', { p_id: ajuste.id, p_senha: senha, p_motivo: motivo.trim() });
    setExcluindo(false);
    setSenha('');
    if (error) return setErro(error.message);
    aoExcluir(`Ajuste de "${ajuste.produto_nome}" excluído. O estoque voltou ${ajuste.quantidade > 0 ? '−' : '+'}${q(Math.abs(ajuste.quantidade))}.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-8" onMouseDown={aoFechar}>
      <form onSubmit={confirmar} onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 text-sm shadow-xl">
        <h3 className="text-lg font-bold text-red-700">Excluir ajuste de estoque</h3>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="font-medium">{ajuste.produto_nome}</p>
          <p className="text-xs text-gray-500">
            {dataHora(ajuste.created_at)} · por {ajuste.usuario || '—'} · {q(ajuste.saldo_anterior)} → {q(ajuste.saldo_novo)} ({ajuste.quantidade > 0 ? '+' : ''}
            {q(ajuste.quantidade)})
          </p>
        </div>
        <p className="text-xs text-gray-600">
          O estoque recebe o contrário deste ajuste ({ajuste.quantidade > 0 ? '−' : '+'}
          {q(Math.abs(ajuste.quantidade))}). O registro continua no relatório, riscado.
        </p>
        <label className="block">
          <span className="text-gray-600">Motivo</span>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-gray-600">Sua senha de administrador</span>
          <input type="password" autoComplete="off" value={senha} onChange={(e) => setSenha(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
        </label>
        {erro && <p className="rounded-lg bg-red-50 p-2 text-red-700">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={aoFechar} className="rounded-lg px-4 py-2 text-gray-600 hover:bg-gray-100">
            Voltar
          </button>
          <button type="submit" disabled={excluindo} className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
            {excluindo ? 'Excluindo…' : 'Excluir ajuste'}
          </button>
        </div>
      </form>
    </div>
  );
}

// =====================================================================
// USUÁRIOS
// =====================================================================
function Usuarios({ loggedUser }: { loggedUser: Usuario }) {
  const [lista, setLista] = useState<UsuarioLoja[]>([]);
  const [edicao, setEdicao] = useState<Record<string, { nome: string; perfil: string; ativo: boolean }>>({});
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const carregar = async () => {
    setCarregando(true);
    const { data, error } = await supabase.rpc('admin_usuarios');
    setCarregando(false);
    if (error) {
      setMsg({
        tipo: 'erro',
        texto: error.message.includes('admin_usuarios') ? 'Falta atualizar o banco: rode o arquivo fase4_usuarios.sql no SQL Editor do Supabase.' : 'Erro: ' + error.message,
      });
      return;
    }
    const l = (data as UsuarioLoja[]) || [];
    setLista(l);
    const ed: Record<string, { nome: string; perfil: string; ativo: boolean }> = {};
    l.forEach((u) => (ed[u.user_id] = { nome: u.nome || '', perfil: (u.perfil || 'caixa').toLowerCase(), ativo: u.vinculado ? u.ativo : true }));
    setEdicao(ed);
  };

  useEffect(() => {
    carregar();
  }, []);

  const salvar = async (u: UsuarioLoja) => {
    const e = edicao[u.user_id];
    if (!e.nome.trim()) return setMsg({ tipo: 'erro', texto: 'Informe o nome do usuário.' });
    if (u.user_id === loggedUser.id && (e.perfil !== 'admin' || !e.ativo) && !window.confirm('Você vai tirar o seu próprio acesso de administrador. Continuar?'))
      return;
    setSalvando(u.user_id);
    setMsg(null);
    const { error } = await supabase.rpc('admin_salvar_usuario', { p_user_id: u.user_id, p_nome: e.nome.trim(), p_perfil: e.perfil, p_ativo: e.ativo });
    setSalvando(null);
    if (error) return setMsg({ tipo: 'erro', texto: error.message });
    setMsg({ tipo: 'ok', texto: u.vinculado ? `${e.nome} atualizado.` : `${e.nome} agora tem acesso à loja.` });
    carregar();
  };

  const mudar = (id: string, m: Partial<{ nome: string; perfil: string; ativo: boolean }>) =>
    setEdicao((x) => ({ ...x, [id]: { ...x[id], ...m } }));

  const pendentes = lista.filter((u) => !u.vinculado);
  const daLoja = lista.filter((u) => u.vinculado);

  const linha = (u: UsuarioLoja) => {
    const e = edicao[u.user_id];
    if (!e) return null;
    const alterado = !u.vinculado || e.nome !== (u.nome || '') || e.perfil !== (u.perfil || '').toLowerCase() || e.ativo !== u.ativo;
    return (
      <tr key={u.user_id} className={`border-t ${u.vinculado && !u.ativo ? 'opacity-60' : ''}`}>
        <td className="p-2">
          <input value={e.nome} onChange={(ev) => mudar(u.user_id, { nome: ev.target.value })} placeholder="Nome" className="w-44 rounded border px-2 py-1" />
          <div className="mt-0.5 text-[11px] text-gray-500">
            {u.email}
            {u.user_id === loggedUser.id && ' · você'}
          </div>
        </td>
        <td className="p-2">
          <select value={e.perfil} onChange={(ev) => mudar(u.user_id, { perfil: ev.target.value })} className="rounded border px-2 py-1">
            {PERFIS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.rotulo}
              </option>
            ))}
          </select>
          <div className="mt-0.5 max-w-[220px] text-[11px] text-gray-500">{PERFIS.find((p) => p.id === e.perfil)?.pode}</div>
        </td>
        <td className="p-2">
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={e.ativo} onChange={(ev) => mudar(u.user_id, { ativo: ev.target.checked })} /> acesso liberado
          </label>
        </td>
        <td className="p-2 text-xs text-gray-500">{dataHora(u.ultimo_acesso)}</td>
        <td className="p-2 text-right">
          <button
            onClick={() => salvar(u)}
            disabled={!alterado || salvando === u.user_id}
            className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-30"
          >
            {salvando === u.user_id ? 'Salvando…' : u.vinculado ? 'Salvar' : 'Liberar acesso'}
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-3">
      {msg && (
        <p className={`rounded-lg p-3 text-sm ${msg.tipo === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{msg.texto}</p>
      )}

      <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-900">
        <p className="font-semibold">Como cadastrar um funcionário</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          <li>
            No Supabase: <b>Authentication → Users → Add user → Create new user</b>. Digite o e-mail e uma senha, marque <b>Auto Confirm User</b> e
            clique em Create.
          </li>
          <li>
            Volte aqui e clique em <b>Atualizar</b>. O login aparece em "Aguardando liberação".
          </li>
          <li>Coloque o nome, escolha o perfil e clique em <b>Liberar acesso</b>. Cada um entra com o próprio e-mail e senha.</li>
        </ol>
        <p className="mt-2 text-xs">
          Cada venda, cadastro, alteração e exclusão fica registrada com o nome de quem estava logado. Para tirar o acesso de alguém, desmarque{' '}
          <b>acesso liberado</b> e salve (o histórico continua guardado).
        </p>
      </div>

      <div className="flex items-center">
        <h3 className="flex-1 font-semibold text-gray-800">Usuários da loja</h3>
        <button onClick={carregar} className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50">
          ↻ Atualizar
        </button>
      </div>

      {carregando ? (
        <p className="p-6 text-center text-sm text-gray-500">Carregando…</p>
      ) : (
        <>
          {pendentes.length > 0 && (
            <div className="overflow-x-auto rounded-xl border-2 border-amber-300 bg-white shadow-sm">
              <div className="bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">Aguardando liberação ({pendentes.length})</div>
              <table className="w-full text-sm">
                <tbody>{pendentes.map(linha)}</tbody>
              </table>
            </div>
          )}
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-[11px] uppercase text-gray-500">
                <tr>
                  <th className="p-2">Nome / e-mail</th>
                  <th className="p-2">Perfil</th>
                  <th className="p-2">Acesso</th>
                  <th className="p-2">Último acesso</th>
                  <th />
                </tr>
              </thead>
              <tbody>{daLoja.map(linha)}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
