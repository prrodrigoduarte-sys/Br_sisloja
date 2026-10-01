// BR Sisloja - Fase 2 - Nota de Entrada por XML (NF-e)
// Fluxo: escolher o XML -> conferir fornecedor, itens, custos e preços -> confirmar.
// Ao confirmar (função confirmar_nota_entrada no Supabase): cadastra fornecedor e produtos novos,
// atualiza custo e preços, lança o estoque e gera as contas a pagar das duplicatas.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { lerNfe, Nfe, NfeItem, precoComMargem, margemDoPreco, arred2, arred4 } from './nfeXml';
import { formatarDoc } from './FornecedoresModule';

type Usuario = { id: string; email: string; nome: string; perfil: string; codigo_loja: string; loja_nome: string };

type Tabela = { id: string; nome: string };
type ProdutoRes = {
  id: string;
  nome: string;
  codigo_barras: string | null;
  grupo: string | null;
  unidade: string | null;
  custo: number | null;
  estoque: number | null;
  precos: Record<string, number>;
};
type Margem = { grupo: string; tabela_id: string; margem: number };

type PrecoLinha = { tabela_id: string; margem: number; preco: number; manual: boolean };
type ItemConf = {
  nfe: NfeItem;
  produto: ProdutoRes | null; // produto existente vinculado
  vinculo: 'fornecedor' | 'ean' | 'manual' | null;
  novo: boolean; // cadastrar como produto novo
  nome_novo: string;
  codigo_barras_novo: string;
  grupo: string;
  fator: number; // unidades de venda por unidade da nota
  atualizar_precos: boolean;
  precos: PrecoLinha[];
};

type Preparo = {
  ja_importada: { id: string; numero: string; data_entrada: string } | null;
  fornecedor: { id: string; nome: string; nome_fantasia: string | null } | null;
  loja_cnpj: string | null;
  tabelas: Tabela[];
  margem_padrao: number;
  margens: Margem[];
  grupos: string[];
  itens: { idx: number; produto: ProdutoRes | null; fator: number | null; vinculo: 'fornecedor' | 'ean' | null }[];
};

const brl = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
const n4 = (n: number) => (n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const dataBR = (s: string) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');
const numInput = (s: string) => {
  const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
};

function margemPara(prep: Preparo | null, grupo: string, tabela_id: string) {
  if (!prep) return 0;
  const g = (grupo || '').trim().toUpperCase();
  const m =
    prep.margens.find((x) => (x.grupo || '').toUpperCase() === g && x.tabela_id === tabela_id) ||
    prep.margens.find((x) => !x.grupo && x.tabela_id === tabela_id);
  return m ? Number(m.margem) : Number(prep.margem_padrao || 0);
}

// custo por unidade de venda (custo do item / (quantidade x fator))
const custoVenda = (it: ItemConf) => {
  const q = it.nfe.quantidade * (it.fator || 1);
  return q > 0 ? arred4(it.nfe.custo_total / q) : 0;
};

function recalcularPrecos(it: ItemConf, prep: Preparo | null, forcar = false): PrecoLinha[] {
  const custo = custoVenda(it);
  return (prep?.tabelas || []).map((t) => {
    const atual = it.precos.find((p) => p.tabela_id === t.id);
    if (atual?.manual && !forcar) return { ...atual, margem: margemDoPreco(custo, atual.preco) };
    const margem = atual && !forcar ? atual.margem : margemPara(prep, it.grupo, t.id);
    return { tabela_id: t.id, margem, preco: precoComMargem(custo, margem), manual: false };
  });
}

export default function NotaEntradaModule({ loggedUser }: { loggedUser: Usuario }) {
  const [tela, setTela] = useState<'lista' | 'conferir' | 'margens'>('lista');
  const perfil = (loggedUser?.perfil || '').toLowerCase();
  const podeLancar = ['admin', 'gerente', 'estoquista'].includes(perfil);
  const podeMargens = ['admin', 'gerente'].includes(perfil);

  return (
    <div className="mx-auto max-w-7xl p-3 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-bold text-gray-800">🧾 Nota de Entrada</h2>
        <button
          onClick={() => setTela('lista')}
          className={`rounded-lg px-3 py-2 text-sm ${tela === 'lista' ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          Notas lançadas
        </button>
        {podeMargens && (
          <button
            onClick={() => setTela('margens')}
            className={`rounded-lg px-3 py-2 text-sm ${tela === 'margens' ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            % Margens de lucro
          </button>
        )}
        {podeLancar && (
          <button
            onClick={() => setTela('conferir')}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            + Importar XML
          </button>
        )}
      </div>
      {tela === 'lista' && <ListaNotas usuario={loggedUser} />}
      {tela === 'margens' && <Margens usuario={loggedUser} />}
      {tela === 'conferir' && <Conferencia usuario={loggedUser} aoTerminar={() => setTela('lista')} />}
    </div>
  );
}

// =====================================================================
// LISTA DE NOTAS LANÇADAS
// =====================================================================
function ListaNotas({ usuario }: { usuario: Usuario }) {
  const [notas, setNotas] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aberta, setAberta] = useState<string | null>(null);
  const [itens, setItens] = useState<any[]>([]);
  const [erro, setErro] = useState('');

  useEffect(() => {
    (async () => {
      setCarregando(true);
      const { data, error } = await supabase
        .from('notas_entrada')
        .select('id, numero, serie, chave_acesso, data_emissao, data_entrada, valor_total, qtd_itens, fornecedores(nome, nome_fantasia, cnpj)')
        .eq('codigo_loja', usuario.codigo_loja)
        .order('data_entrada', { ascending: false })
        .limit(200);
      if (error) setErro(error.message);
      setNotas(data || []);
      setCarregando(false);
    })();
  }, [usuario.codigo_loja]);

  const abrir = async (id: string) => {
    if (aberta === id) return setAberta(null);
    setAberta(id);
    setItens([]);
    const { data } = await supabase.from('notas_entrada_itens').select('*').eq('nota_id', id).order('item');
    setItens(data || []);
  };

  if (carregando) return <p className="p-6 text-center text-gray-500">Carregando...</p>;
  if (erro) return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Erro: {erro}</p>;
  if (!notas.length)
    return (
      <div className="rounded-xl bg-white p-8 text-center text-gray-500 shadow-sm">
        Nenhuma nota lançada ainda. Clique em <b>+ Importar XML</b> e escolha o arquivo XML da nota do fornecedor.
      </div>
    );

  return (
    <div className="space-y-2">
      {notas.map((n) => (
        <div key={n.id} className="overflow-hidden rounded-xl bg-white shadow-sm">
          <button onClick={() => abrir(n.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left hover:bg-gray-50">
            <span className="font-semibold text-gray-800">
              NF {n.numero}
              {n.serie ? `-${n.serie}` : ''}
            </span>
            <span className="flex-1 truncate text-sm text-gray-600">
              {n.fornecedores?.nome_fantasia || n.fornecedores?.nome}
            </span>
            <span className="text-xs text-gray-500">Emissão {dataBR(n.data_emissao)}</span>
            <span className="text-xs text-gray-500">Entrada {dataBR(n.data_entrada)}</span>
            <span className="font-semibold text-gray-800">{brl(n.valor_total)}</span>
          </button>
          {aberta === n.id && (
            <div className="overflow-x-auto border-t bg-gray-50 p-3">
              <p className="mb-2 font-mono text-[11px] text-gray-500">Chave: {n.chave_acesso}</p>
              <table className="w-full text-xs">
                <thead className="text-left text-gray-500">
                  <tr>
                    <th className="p-1">#</th>
                    <th className="p-1">Produto</th>
                    <th className="p-1 text-right">Qtd</th>
                    <th className="p-1 text-right">Valor</th>
                    <th className="p-1 text-right">Custo unit. final</th>
                    <th className="p-1 text-right">Preço venda</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((i) => (
                    <tr key={i.id} className="border-t">
                      <td className="p-1">{i.item}</td>
                      <td className="p-1">{i.descricao}</td>
                      <td className="p-1 text-right">
                        {n4(i.quantidade)} {i.unidade}
                        {Number(i.fator) !== 1 && <span className="text-gray-400"> ×{n4(i.fator)}</span>}
                      </td>
                      <td className="p-1 text-right">{brl(i.valor_produtos)}</td>
                      <td className="p-1 text-right">{brl(i.custo_unitario)}</td>
                      <td className="p-1 text-right">{i.preco_venda ? brl(i.preco_venda) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// =====================================================================
// TABELA DE MARGENS DE LUCRO (por grupo e tabela de preço)
// =====================================================================
function Margens({ usuario }: { usuario: Usuario }) {
  const [prep, setPrep] = useState<Preparo | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({}); // chave `${grupo}|${tabela}`
  const [grupoNovo, setGrupoNovo] = useState('');
  const [grupos, setGrupos] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = async () => {
    const { data, error } = await supabase.rpc('nfe_preparar', {
      p_codigo_loja: usuario.codigo_loja,
      p_chave: '',
      p_cnpj: '',
      p_itens: [],
    });
    if (error) return setMsg('Erro: ' + error.message);
    const p = data as Preparo;
    setPrep(p);
    const v: Record<string, string> = {};
    p.margens.forEach((m) => (v[`${(m.grupo || '').toUpperCase()}|${m.tabela_id}`] = String(m.margem).replace('.', ',')));
    setValores(v);
    const gs = new Set<string>([...(p.grupos || []), ...p.margens.map((m) => (m.grupo || '').toUpperCase()).filter(Boolean)]);
    setGrupos(Array.from(gs).sort());
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario.codigo_loja]);

  const salvar = async () => {
    if (!prep) return;
    setSalvando(true);
    setMsg('');
    const linhas: any[] = [];
    const apagar: { grupo: string; tabela_id: string }[] = [];
    for (const g of ['', ...grupos]) {
      for (const t of prep.tabelas) {
        const s = (valores[`${g}|${t.id}`] ?? '').trim();
        if (s === '') apagar.push({ grupo: g, tabela_id: t.id });
        else linhas.push({ codigo_loja: usuario.codigo_loja, grupo: g, tabela_id: t.id, margem: numInput(s) });
      }
    }
    const { error } = await supabase.from('margens_lucro').upsert(linhas, { onConflict: 'codigo_loja,grupo,tabela_id' });
    for (const a of apagar) {
      await supabase.from('margens_lucro').delete().eq('codigo_loja', usuario.codigo_loja).eq('grupo', a.grupo).eq('tabela_id', a.tabela_id);
    }
    setSalvando(false);
    setMsg(error ? 'Erro ao salvar: ' + error.message : 'Margens salvas.');
    if (!error) carregar();
  };

  if (!prep) return <p className="p-6 text-center text-gray-500">{msg || 'Carregando...'}</p>;

  const celula = (g: string, t: Tabela) => (
    <td key={t.id} className="p-1">
      <div className="flex items-center gap-1">
        <input
          className="w-20 rounded border border-gray-300 px-2 py-1 text-right text-sm"
          inputMode="decimal"
          placeholder={g ? 'padrão' : String(prep.margem_padrao)}
          value={valores[`${g}|${t.id}`] ?? ''}
          onChange={(e) => setValores((v) => ({ ...v, [`${g}|${t.id}`]: e.target.value }))}
        />
        <span className="text-xs text-gray-400">%</span>
      </div>
    </td>
  );

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm text-gray-600">
        O preço de venda é calculado assim: <b>custo final do item × (1 + margem%)</b>. O custo final já inclui frete, seguro, IPI, ST e
        outras despesas da nota, menos o desconto. Grupo sem margem usa a linha <b>Padrão da loja</b>. Deixe vazio para usar o padrão.
      </p>
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead className="text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="p-1 pr-6">Grupo</th>
              {prep.tabelas.map((t) => (
                <th key={t.id} className="p-1">
                  {t.nome}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="bg-yellow-50">
              <td className="p-1 pr-6 font-semibold">Padrão da loja</td>
              {prep.tabelas.map((t) => celula('', t))}
            </tr>
            {grupos.map((g) => (
              <tr key={g} className="border-t">
                <td className="p-1 pr-6">{g}</td>
                {prep.tabelas.map((t) => celula(g, t))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className="rounded border border-gray-300 px-2 py-1 text-sm"
          placeholder="Novo grupo (ex.: BEBIDAS)"
          value={grupoNovo}
          onChange={(e) => setGrupoNovo(e.target.value.toUpperCase())}
        />
        <button
          onClick={() => {
            const g = grupoNovo.trim();
            if (g && !grupos.includes(g)) setGrupos([...grupos, g].sort());
            setGrupoNovo('');
          }}
          className="rounded bg-gray-100 px-3 py-1 text-sm hover:bg-gray-200"
        >
          + Adicionar grupo
        </button>
        <div className="flex-1" />
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
        <button
          onClick={salvar}
          disabled={salvando}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {salvando ? 'Salvando...' : 'Salvar margens'}
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// CONFERÊNCIA DA NOTA (depois de escolher o XML)
// =====================================================================
function Conferencia({ usuario, aoTerminar }: { usuario: Usuario; aoTerminar: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [nfe, setNfe] = useState<Nfe | null>(null);
  const [xml, setXml] = useState('');
  const [prep, setPrep] = useState<Preparo | null>(null);
  const [itens, setItens] = useState<ItemConf[]>([]);
  const [erro, setErro] = useState('');
  const [lendo, setLendo] = useState(false);
  const [gerarContas, setGerarContas] = useState(true);
  const [dataEntrada, setDataEntrada] = useState(new Date().toLocaleDateString('sv-SE'));
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<any>(null);
  const [buscaIdx, setBuscaIdx] = useState<number | null>(null);

  const escolherArquivo = async (arq: File | undefined) => {
    if (!arq) return;
    setErro('');
    setNfe(null);
    setPrep(null);
    setLendo(true);
    try {
      const texto = await arq.text();
      const nota = lerNfe(texto);
      if (nota.modelo && nota.modelo !== '55') throw new Error(`Este XML é do modelo ${nota.modelo}. A entrada aceita NF-e modelo 55.`);
      const { data, error } = await supabase.rpc('nfe_preparar', {
        p_codigo_loja: usuario.codigo_loja,
        p_chave: nota.chave,
        p_cnpj: nota.emitente.cnpj_cpf,
        p_itens: nota.itens.map((i, idx) => ({ idx, codigo_fornecedor: i.codigo_fornecedor, ean: i.ean, ean_trib: i.ean_trib })),
      });
      if (error) throw new Error('Erro ao consultar o banco: ' + error.message);
      const p = data as Preparo;
      setXml(texto);
      setNfe(nota);
      setPrep(p);
      setItens(
        nota.itens.map((i, idx) => {
          const v = p.itens.find((x) => x.idx === idx);
          const produto = v?.produto || null;
          const base: ItemConf = {
            nfe: i,
            produto,
            vinculo: produto ? v!.vinculo : null,
            novo: !produto,
            nome_novo: i.descricao,
            codigo_barras_novo: (i.fator_sugerido > 1 ? i.ean_trib : i.ean) || '',
            grupo: produto?.grupo || '',
            fator: Number(v?.fator) || i.fator_sugerido || 1,
            atualizar_precos: true,
            precos: [],
          };
          base.precos = recalcularPrecos(base, p, true);
          return base;
        })
      );
    } catch (e: any) {
      setErro(e.message || String(e));
    }
    setLendo(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const alterar = (idx: number, mudanca: Partial<ItemConf>, recalc: 'manter' | 'forcar' | 'nao' = 'manter') => {
    setItens((lista) =>
      lista.map((it, i) => {
        if (i !== idx) return it;
        const novo = { ...it, ...mudanca };
        if (recalc !== 'nao') novo.precos = recalcularPrecos(novo, prep, recalc === 'forcar');
        return novo;
      })
    );
  };

  const alterarPreco = (idx: number, tabela_id: string, campo: 'margem' | 'preco', valor: number) => {
    setItens((lista) =>
      lista.map((it, i) => {
        if (i !== idx) return it;
        const custo = custoVenda(it);
        return {
          ...it,
          precos: it.precos.map((p) =>
            p.tabela_id !== tabela_id
              ? p
              : campo === 'margem'
              ? { ...p, margem: valor, preco: precoComMargem(custo, valor), manual: false }
              : { ...p, preco: valor, margem: margemDoPreco(custo, valor), manual: true }
          ),
        };
      })
    );
  };

  const resumo = useMemo(() => {
    const novos = itens.filter((i) => i.novo).length;
    const semVinculo = itens.filter((i) => !i.novo && !i.produto).length;
    const somaDup = arred2((nfe?.duplicatas || []).reduce((s, d) => s + d.valor, 0));
    return { novos, semVinculo, somaDup };
  }, [itens, nfe]);

  const confirmar = async () => {
    if (!nfe || !prep) return;
    if (resumo.semVinculo) return setErro('Há itens sem produto escolhido. Vincule a um produto ou marque como produto novo.');
    const semNome = itens.find((i) => i.novo && !i.nome_novo.trim());
    if (semNome) return setErro(`Informe o nome do produto novo do item ${semNome.nfe.item}.`);
    if (!window.confirm(`Confirmar a entrada da NF ${nfe.numero}?\n\nO estoque será lançado e ${resumo.novos} produto(s) novo(s) serão cadastrados.`)) return;
    setConfirmando(true);
    setErro('');
    const payload = {
      codigo_loja: usuario.codigo_loja,
      chave: nfe.chave,
      numero: nfe.numero,
      serie: nfe.serie,
      modelo: nfe.modelo,
      data_emissao: nfe.data_emissao || null,
      data_entrada: dataEntrada,
      natureza: nfe.natureza,
      xml,
      fornecedor: {
        cnpj_cpf: nfe.emitente.cnpj_cpf,
        razao_social: nfe.emitente.razao_social,
        nome_fantasia: nfe.emitente.nome_fantasia,
        ie: nfe.emitente.ie,
        crt: nfe.emitente.crt,
        ...nfe.emitente.endereco,
      },
      totais: nfe.totais,
      gerar_contas: gerarContas,
      duplicatas: nfe.duplicatas,
      itens: itens.map((it) => ({
        item: it.nfe.item,
        codigo_fornecedor: it.nfe.codigo_fornecedor,
        ean: it.nfe.ean,
        ean_trib: it.nfe.ean_trib,
        descricao: it.nfe.descricao,
        ncm: it.nfe.ncm,
        cest: it.nfe.cest,
        cfop: it.nfe.cfop,
        origem: it.nfe.origem,
        unidade: it.nfe.unidade,
        quantidade: it.nfe.quantidade,
        fator: it.fator || 1,
        valor_unitario: it.nfe.valor_unitario,
        valor_produtos: it.nfe.valor_produtos,
        frete: it.nfe.frete,
        seguro: it.nfe.seguro,
        desconto: it.nfe.desconto,
        outras: it.nfe.outras,
        ipi: it.nfe.ipi,
        st: it.nfe.st,
        icms: it.nfe.icms,
        custo_total: it.nfe.custo_total,
        custo_unitario_final: custoVenda(it),
        produto_id: it.novo ? null : it.produto?.id,
        novo_produto: it.novo
          ? {
              nome: it.nome_novo.trim(),
              codigo_barras: it.codigo_barras_novo || null,
              grupo: it.grupo.trim().toUpperCase() || null,
              unidade: it.fator > 1 ? it.nfe.unidade_trib || 'UN' : it.nfe.unidade,
            }
          : null,
        atualizar_precos: it.novo || it.atualizar_precos,
        precos: it.precos.map((p) => ({ tabela_id: p.tabela_id, margem: p.margem, preco: p.preco })),
      })),
    };
    const { data, error } = await supabase.rpc('confirmar_nota_entrada', { p_nota: payload });
    setConfirmando(false);
    if (error) return setErro('Não foi possível confirmar: ' + error.message);
    setResultado(data);
  };

  // ---------- resultado ----------
  if (resultado) {
    return (
      <div className="rounded-xl bg-white p-6 text-center shadow-sm">
        <div className="text-4xl">✅</div>
        <h3 className="mt-2 text-lg font-bold text-gray-800">Nota {nfe?.numero} lançada!</h3>
        <ul className="mt-3 space-y-1 text-sm text-gray-600">
          {resultado.fornecedor_criado && <li>Fornecedor cadastrado automaticamente.</li>}
          <li>{resultado.itens} item(ns) lançado(s) no estoque.</li>
          {resultado.produtos_criados > 0 && <li>{resultado.produtos_criados} produto(s) novo(s) cadastrado(s).</li>}
          {resultado.contas_criadas > 0 && <li>{resultado.contas_criadas} conta(s) a pagar gerada(s).</li>}
        </ul>
        <button onClick={aoTerminar} className="mt-5 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          Ver notas lançadas
        </button>
      </div>
    );
  }

  // ---------- escolher arquivo ----------
  if (!nfe || !prep) {
    return (
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 p-10 text-center hover:border-blue-400 hover:bg-blue-50">
          <span className="text-4xl">📄</span>
          <span className="font-semibold text-gray-700">{lendo ? 'Lendo a nota...' : 'Escolha o arquivo XML da NF-e'}</span>
          <span className="text-xs text-gray-500">O XML que o fornecedor envia por e-mail (termina em .xml)</span>
          <input ref={inputRef} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={(e) => escolherArquivo(e.target.files?.[0])} />
        </label>
        {erro && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      </div>
    );
  }

  // ---------- conferência ----------
  const lojaDiferente = prep.loja_cnpj && nfe.destinatario_cnpj && prep.loja_cnpj.replace(/\D/g, '') !== nfe.destinatario_cnpj;

  return (
    <div className="space-y-3">
      {prep.ja_importada && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          ⛔ Esta nota já foi lançada em {dataBR(prep.ja_importada.data_entrada)} (NF {prep.ja_importada.numero}). Não é possível lançar de novo.
        </div>
      )}
      {lojaDiferente && (
        <div className="rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">
          ⚠️ O destinatário desta nota ({formatarDoc(nfe.destinatario_cnpj)}) não é o CNPJ da sua loja. Confira se o XML é o certo.
        </div>
      )}

      {/* cabeçalho */}
      <div className="grid gap-3 rounded-xl bg-white p-4 shadow-sm sm:grid-cols-3">
        <div>
          <div className="text-xs uppercase text-gray-500">Nota</div>
          <div className="font-semibold">
            NF {nfe.numero} série {nfe.serie}
          </div>
          <div className="text-xs text-gray-500">Emissão {dataBR(nfe.data_emissao)}</div>
          <div className="break-all font-mono text-[10px] text-gray-400">{nfe.chave}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-gray-500">Fornecedor</div>
          <div className="font-semibold">{nfe.emitente.nome_fantasia || nfe.emitente.razao_social}</div>
          <div className="text-xs text-gray-500">
            {formatarDoc(nfe.emitente.cnpj_cpf)} · {nfe.emitente.endereco.cidade}/{nfe.emitente.endereco.uf}
          </div>
          {prep.fornecedor ? (
            <span className="mt-1 inline-block rounded bg-green-50 px-2 py-0.5 text-xs text-green-700">✓ já cadastrado</span>
          ) : (
            <span className="mt-1 inline-block rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">+ será cadastrado automaticamente</span>
          )}
        </div>
        <div>
          <label className="block">
            <span className="text-xs uppercase text-gray-500">Data de entrada</span>
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1 text-sm"
              value={dataEntrada}
              onChange={(e) => setDataEntrada(e.target.value)}
            />
          </label>
        </div>
      </div>

      {/* totais */}
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-white p-4 text-sm shadow-sm sm:grid-cols-4 lg:grid-cols-8">
        {[
          ['Produtos', nfe.totais.produtos],
          ['Frete', nfe.totais.frete],
          ['Seguro', nfe.totais.seguro],
          ['Outras desp.', nfe.totais.outras],
          ['IPI', nfe.totais.ipi],
          ['ICMS ST', nfe.totais.st],
          ['Desconto', -nfe.totais.desconto],
          ['Total da nota', nfe.totais.nota],
        ].map(([r, v]) => (
          <div key={r as string} className={r === 'Total da nota' ? 'font-bold' : ''}>
            <div className="text-xs text-gray-500">{r}</div>
            <div>{brl(v as number)}</div>
          </div>
        ))}
      </div>

      {/* itens */}
      <div className="space-y-2">
        {itens.map((it, idx) => {
          const custo = custoVenda(it);
          return (
            <div key={idx} className={`rounded-xl bg-white p-3 shadow-sm ${!it.novo && !it.produto ? 'ring-2 ring-red-300' : ''}`}>
              <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-gray-400">
                    Item {it.nfe.item} · cód. fornecedor {it.nfe.codigo_fornecedor}
                    {it.nfe.ean && ` · EAN ${it.nfe.ean}`} · NCM {it.nfe.ncm} · CFOP {it.nfe.cfop}
                  </div>
                  <div className="font-medium text-gray-800">{it.nfe.descricao}</div>
                  <div className="text-xs text-gray-600">
                    {n4(it.nfe.quantidade)} {it.nfe.unidade} × {brl(it.nfe.valor_unitario)} = {brl(it.nfe.valor_produtos)}
                    {(it.nfe.frete || it.nfe.seguro || it.nfe.outras || it.nfe.ipi || it.nfe.st || it.nfe.desconto) > 0 && (
                      <span className="text-gray-400">
                        {' '}
                        {it.nfe.frete > 0 && `+ frete ${brl(it.nfe.frete)} `}
                        {it.nfe.seguro > 0 && `+ seguro ${brl(it.nfe.seguro)} `}
                        {it.nfe.outras > 0 && `+ outras ${brl(it.nfe.outras)} `}
                        {it.nfe.ipi > 0 && `+ IPI ${brl(it.nfe.ipi)} `}
                        {it.nfe.st > 0 && `+ ST ${brl(it.nfe.st)} `}
                        {it.nfe.desconto > 0 && `− desc. ${brl(it.nfe.desconto)}`}
                      </span>
                    )}{' '}
                    = <b>{brl(it.nfe.custo_total)}</b>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">Custo final por unidade</div>
                  <div className="text-lg font-bold text-gray-800">{brl(custo)}</div>
                  {it.produto?.custo != null && Number(it.produto.custo) > 0 && (
                    <div className={`text-xs ${custo > Number(it.produto.custo) ? 'text-red-600' : 'text-green-600'}`}>
                      antes {brl(Number(it.produto.custo))}
                    </div>
                  )}
                </div>
              </div>

              {/* vínculo com produto */}
              <div className="mt-2 grid gap-2 rounded-lg bg-gray-50 p-2 sm:grid-cols-12">
                <div className="sm:col-span-6">
                  {it.novo ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">PRODUTO NOVO</span>
                        <button className="text-xs text-blue-600 underline" onClick={() => setBuscaIdx(idx)}>
                          vincular a um produto existente
                        </button>
                      </div>
                      <input
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        value={it.nome_novo}
                        onChange={(e) => alterar(idx, { nome_novo: e.target.value }, 'nao')}
                        placeholder="Nome do produto"
                      />
                      <input
                        className="w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs"
                        value={it.codigo_barras_novo}
                        onChange={(e) => alterar(idx, { codigo_barras_novo: e.target.value.replace(/\D/g, '') }, 'nao')}
                        placeholder="Código de barras (opcional)"
                        inputMode="numeric"
                      />
                    </div>
                  ) : it.produto ? (
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                          {it.vinculo === 'fornecedor' ? 'VINCULADO' : it.vinculo === 'ean' ? 'ACHADO PELO CÓD. BARRAS' : 'ESCOLHIDO'}
                        </span>
                        <button className="text-xs text-blue-600 underline" onClick={() => setBuscaIdx(idx)}>
                          trocar
                        </button>
                        <button className="text-xs text-blue-600 underline" onClick={() => alterar(idx, { produto: null, vinculo: null, novo: true }, 'forcar')}>
                          cadastrar como novo
                        </button>
                      </div>
                      <div className="text-sm font-medium">{it.produto.nome}</div>
                      <div className="text-xs text-gray-500">
                        {it.produto.codigo_barras || 'sem cód. barras'} · estoque atual {n4(Number(it.produto.estoque || 0))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-red-600">Escolha o produto:</span>
                      <button className="rounded bg-white px-2 py-1 text-xs shadow-sm" onClick={() => setBuscaIdx(idx)}>
                        buscar existente
                      </button>
                      <button className="rounded bg-white px-2 py-1 text-xs shadow-sm" onClick={() => alterar(idx, { novo: true }, 'forcar')}>
                        cadastrar novo
                      </button>
                    </div>
                  )}
                </div>
                <label className="block sm:col-span-3">
                  <span className="text-xs text-gray-500">Grupo (margem)</span>
                  <input
                    list="grupos-margem"
                    className="w-full rounded border border-gray-300 px-2 py-1 text-sm uppercase"
                    value={it.grupo}
                    onChange={(e) => alterar(idx, { grupo: e.target.value.toUpperCase() }, 'forcar')}
                    disabled={!it.novo && !!it.produto?.grupo}
                    title={!it.novo && it.produto?.grupo ? 'O grupo vem do cadastro do produto' : ''}
                  />
                </label>
                <label className="block sm:col-span-3">
                  <span className="text-xs text-gray-500">
                    Cada {it.nfe.unidade} tem quantas unidades?
                  </span>
                  <input
                    className="w-full rounded border border-gray-300 px-2 py-1 text-right text-sm"
                    inputMode="decimal"
                    value={String(it.fator).replace('.', ',')}
                    onChange={(e) => alterar(idx, { fator: numInput(e.target.value) || 1 }, 'manter')}
                  />
                  <span className="text-[11px] text-gray-500">
                    entra {n4(it.nfe.quantidade * (it.fator || 1))} no estoque
                  </span>
                </label>
              </div>

              {/* preços */}
              <div className="mt-2 flex flex-wrap items-end gap-3">
                {it.precos.map((p) => {
                  const t = prep.tabelas.find((x) => x.id === p.tabela_id);
                  const atual = it.produto?.precos?.[p.tabela_id];
                  return (
                    <div key={p.tabela_id} className="rounded-lg border border-gray-200 p-2">
                      <div className="text-xs font-semibold text-gray-600">{t?.nome}</div>
                      <div className="mt-1 flex items-center gap-1">
                        <input
                          className="w-16 rounded border border-gray-300 px-1 py-1 text-right text-sm"
                          inputMode="decimal"
                          value={String(p.margem).replace('.', ',')}
                          onChange={(e) => alterarPreco(idx, p.tabela_id, 'margem', numInput(e.target.value))}
                          disabled={!it.novo && !it.atualizar_precos}
                        />
                        <span className="text-xs text-gray-400">%</span>
                        <span className="text-xs text-gray-400">→ R$</span>
                        <input
                          className="w-24 rounded border border-gray-300 px-1 py-1 text-right text-sm font-semibold"
                          inputMode="decimal"
                          value={p.preco.toFixed(2).replace('.', ',')}
                          onChange={(e) => alterarPreco(idx, p.tabela_id, 'preco', numInput(e.target.value))}
                          disabled={!it.novo && !it.atualizar_precos}
                        />
                      </div>
                      {atual != null && <div className="mt-1 text-[11px] text-gray-500">preço atual {brl(Number(atual))}</div>}
                    </div>
                  );
                })}
                {!it.novo && it.produto && (
                  <label className="flex items-center gap-1 text-xs text-gray-600">
                    <input type="checkbox" checked={it.atualizar_precos} onChange={(e) => alterar(idx, { atualizar_precos: e.target.checked }, 'nao')} />
                    atualizar preços de venda
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <datalist id="grupos-margem">
        {Array.from(new Set([...(prep.grupos || []), ...prep.margens.map((m) => m.grupo).filter(Boolean)])).map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>

      {/* duplicatas */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h3 className="font-semibold text-gray-800">Pagamento ao fornecedor</h3>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={gerarContas} onChange={(e) => setGerarContas(e.target.checked)} />
            gerar contas a pagar
          </label>
        </div>
        {nfe.duplicatas.length ? (
          <table className="text-sm">
            <tbody>
              {nfe.duplicatas.map((d, i) => (
                <tr key={i}>
                  <td className="pr-4">Parcela {d.numero || i + 1}</td>
                  <td className="pr-4">vence {dataBR(d.vencimento)}</td>
                  <td className="text-right font-medium">{brl(d.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-500">
            A nota não traz duplicatas. {gerarContas && 'Será gerada uma conta a pagar com o valor total, vencendo no prazo padrão do fornecedor (ou em 30 dias).'}
          </p>
        )}
      </div>

      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-xl bg-white p-3 shadow-lg">
        <span className="text-sm text-gray-600">
          {itens.length} itens · {resumo.novos} novo(s)
          {resumo.semVinculo > 0 && <span className="text-red-600"> · {resumo.semVinculo} sem produto</span>}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => {
            setNfe(null);
            setPrep(null);
            setErro('');
          }}
          className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
        >
          Cancelar
        </button>
        <button
          onClick={confirmar}
          disabled={confirmando || !!prep.ja_importada}
          className="rounded-lg bg-green-600 px-6 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {confirmando ? 'Lançando...' : '✓ Confirmar entrada'}
        </button>
      </div>

      {buscaIdx !== null && (
        <BuscaProduto
          usuario={usuario}
          sugestao={itens[buscaIdx]?.nfe.descricao || ''}
          aoFechar={() => setBuscaIdx(null)}
          aoEscolher={(p) => {
            alterar(buscaIdx, { produto: p, vinculo: 'manual', novo: false, grupo: p.grupo || itens[buscaIdx].grupo }, 'forcar');
            setBuscaIdx(null);
          }}
        />
      )}
    </div>
  );
}

// janela para buscar um produto já cadastrado
function BuscaProduto({
  usuario,
  sugestao,
  aoFechar,
  aoEscolher,
}: {
  usuario: Usuario;
  sugestao: string;
  aoFechar: () => void;
  aoEscolher: (p: ProdutoRes) => void;
}) {
  const [texto, setTexto] = useState(sugestao.split(' ').slice(0, 2).join(' '));
  const [res, setRes] = useState<ProdutoRes[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (texto.trim().length < 2) return setRes([]);
      setBuscando(true);
      const { data } = await supabase.rpc('buscar_produtos_entrada', { p_codigo_loja: usuario.codigo_loja, p_texto: texto.trim() });
      setRes((data as ProdutoRes[]) || []);
      setBuscando(false);
    }, 300);
    return () => clearTimeout(t);
  }, [texto, usuario.codigo_loja]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={aoFechar}>
      <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b p-3">
          <div className="mb-1 text-xs text-gray-500">Item da nota: {sugestao}</div>
          <input
            autoFocus
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="Nome ou código de barras do produto"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </div>
        <ul className="max-h-[55vh] divide-y overflow-y-auto">
          {buscando && <li className="p-3 text-sm text-gray-500">Buscando...</li>}
          {!buscando && res.length === 0 && texto.length >= 2 && <li className="p-3 text-sm text-gray-500">Nenhum produto encontrado.</li>}
          {res.map((p) => (
            <li key={p.id}>
              <button onClick={() => aoEscolher(p)} className="w-full p-3 text-left hover:bg-blue-50">
                <div className="text-sm font-medium">{p.nome}</div>
                <div className="text-xs text-gray-500">
                  {p.codigo_barras || 'sem cód. barras'} {p.grupo && `· ${p.grupo}`} · estoque {n4(Number(p.estoque || 0))}
                </div>
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t p-2 text-right">
          <button onClick={aoFechar} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
