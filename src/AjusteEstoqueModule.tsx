// BR Sisloja - Ajuste de estoque (contagem / correção) em lista, feito para o celular.
// Várias pessoas podem usar ao mesmo tempo: cada produto é gravado na hora, com o saldo do momento,
// e quem já foi ajustado hoje ganha uma faixa laranja para todos (a lista se atualiza sozinha).
// Todo ajuste vai para o relatório "Ajustes de estoque" em Configurações (só administrador).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { buscarTodos } from './buscarTodos';

type Produto = {
  id: string;
  sku: string;
  codigo_barras: string | null;
  nome: string;
  unidade: string;
  custo: number;
  preco_venda: number;
  conferir: string | null; // sugestão de conferência (ex.: veio negativo do sistema antigo)
};

type Marca = { usuario: string; quando: string; antes: number; depois: number };
type Resultado = { saldo_anterior: number; diferenca: number; saldo_novo: number };

export const MOTIVOS = ['Contagem / inventário', 'Avaria / quebra', 'Vencido / perda', 'Uso interno', 'Correção de lançamento', 'Outro'];

const ATUALIZA_SEG = 30;
const POR_PAGINA = 60;

const moeda = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qtdFmt = (n: number) => (n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const hora = (s: string) => new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const lerNumero = (s: string) => {
  const t = String(s).trim().replace(/\s/g, '');
  if (!t) return null;
  const n = parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return isFinite(n) ? n : null;
};
const inicioDoDia = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

export default function AjusteEstoqueModule({ loggedUser, aoVoltar }: { loggedUser: any; aoVoltar: () => void }) {
  const perfil = String(loggedUser?.perfil || '').toLowerCase();
  const podeAjustar = ['admin', 'gerente', 'estoquista'].includes(perfil);

  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [saldos, setSaldos] = useState<Record<string, number>>({});
  const [marcas, setMarcas] = useState<Record<string, Marca>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [modo, setModo] = useState<'contagem' | 'ajuste'>('contagem');
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [esconderAjustados, setEsconderAjustados] = useState(false);
  const [soConferir, setSoConferir] = useState(false);
  const [viaNF, setViaNF] = useState<Set<string>>(new Set()); // produtos que entraram por nota fiscal (XML)
  const [limite, setLimite] = useState(POR_PAGINA);
  const buscaRef = useRef<HTMLInputElement>(null);

  const carregarSaldosEMarcas = async () => {
    const [s, a] = await Promise.all([
      buscarTodos(() =>
        supabase.from('estoque_saldos').select('produto_id, saldo').eq('codigo_loja', loggedUser.codigo_loja).eq('tipo', 'fisico').order('produto_id')
      ),
      supabase.rpc('ajustes_recentes', { p_desde: inicioDoDia() }),
    ]);
    if (!s.error) {
      const m: Record<string, number> = {};
      (s.data || []).forEach((x: any) => (m[x.produto_id] = Number(x.saldo) || 0));
      setSaldos(m);
    }
    if (a.error) {
      if (a.error.message.includes('ajustes_recentes')) setErro('Falta atualizar o banco: rode o fase5_ajuste_estoque.sql no Supabase.');
    } else {
      const mk: Record<string, Marca> = {};
      ((a.data as any[]) || []).forEach(
        (x) => (mk[x.produto_id] = { usuario: x.usuario, quando: x.quando, antes: Number(x.saldo_anterior), depois: Number(x.saldo_novo) })
      );
      setMarcas(mk);
    }
  };

  const carregar = async () => {
    setCarregando(true);
    const p = await buscarTodos(() =>
      supabase.from('produtos').select('*').eq('codigo_loja', loggedUser.codigo_loja).eq('ativo', true).order('nome').order('id')
    );
    if (p.error) setErro('Erro ao carregar: ' + p.error.message);
    const nf = await buscarTodos(() => supabase.from('notas_entrada_itens').select('produto_id').order('id'));
    setViaNF(new Set(((nf.data as any[]) || []).map((x) => x.produto_id).filter(Boolean)));
    setProdutos(
      ((p.data as any[]) || [])
        .filter((x) => !x.nao_listar_estoque)
        .map((x) => ({ ...x, custo: Number(x.custo) || 0, preco_venda: Number(x.preco_venda) || 0, conferir: x.conferir || null }))
    );
    await carregarSaldosEMarcas();
    setCarregando(false);
  };

  useEffect(() => {
    carregar();
    // atualiza saldos e faixas laranja de quem está ajustando em outro celular
    const t = setInterval(carregarSaldosEMarcas, ATUALIZA_SEG * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    let lista = produtos;
    if (esconderAjustados) lista = lista.filter((p) => !marcas[p.id]);
    if (soConferir) lista = lista.filter((p) => p.conferir);
    if (!q) return lista;
    // código de barras / código exato vem primeiro (leitor de código de barras)
    const exato = lista.filter((p) => p.codigo_barras === busca.trim() || p.sku.toLowerCase() === q);
    const resto = lista.filter(
      (p) => !exato.includes(p) && (p.nome.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.codigo_barras || '').includes(q))
    );
    return [...exato, ...resto];
  }, [produtos, busca, esconderAjustados, soConferir, marcas]);

  const totalAjustados = useMemo(() => produtos.filter((p) => marcas[p.id]).length, [produtos, marcas]);
  const totalConferir = useMemo(() => produtos.filter((p) => p.conferir).length, [produtos]);

  const aoGravar = (p: Produto, r: Resultado) => {
    setSaldos((s) => ({ ...s, [p.id]: Number(r.saldo_novo) }));
    // contou/ajustou: a sugestão de conferência some (o banco também limpa)
    if (p.conferir) setProdutos((l) => l.map((x) => (x.id === p.id ? { ...x, conferir: null } : x)));
    setMarcas((m) => ({
      ...m,
      [p.id]: { usuario: loggedUser?.nome || 'você', quando: new Date().toISOString(), antes: Number(r.saldo_anterior), depois: Number(r.saldo_novo) },
    }));
    if (busca) {
      setBusca('');
      setTimeout(() => buscaRef.current?.focus(), 0);
    }
  };

  if (!podeAjustar) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-sm text-slate-500">
        Seu perfil não pode ajustar estoque.
        <button type="button" onClick={aoVoltar} className="block mx-auto mt-3 px-4 py-2 bg-slate-100 rounded-xl font-bold">
          ← Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
      {/* topo fixo: título, modo, motivo e busca */}
      <div className="sticky top-0 z-10 p-3 sm:p-4 bg-white border-b border-slate-200 space-y-2 rounded-t-2xl">
        <div className="flex items-center gap-2">
          <button type="button" onClick={aoVoltar} className="px-3 py-2 bg-slate-100 rounded-xl font-bold text-sm">
            ←
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-black text-slate-800 leading-tight">📋 Ajuste de estoque</h2>
            <p className="text-[11px] text-slate-500">
              {totalAjustados} de {produtos.length} produto(s) ajustado(s) hoje
            </p>
          </div>
          <button type="button" onClick={carregar} className="px-3 py-2 bg-slate-100 rounded-xl text-sm" title="Atualizar">
            ↻
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-xs sm:text-sm font-bold">
          <button
            type="button"
            onClick={() => setModo('contagem')}
            className={`rounded-lg py-2 ${modo === 'contagem' ? 'bg-white shadow text-blue-900' : 'text-slate-500'}`}
          >
            Contei: tem na prateleira
          </button>
          <button
            type="button"
            onClick={() => setModo('ajuste')}
            className={`rounded-lg py-2 ${modo === 'ajuste' ? 'bg-white shadow text-blue-900' : 'text-slate-500'}`}
          >
            Somar / tirar (+ / −)
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className="flex-1 min-w-[180px] border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
            {MOTIVOS.map((m) => (
              <option key={m} value={m}>
                Motivo: {m}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
            <input type="checkbox" checked={esconderAjustados} onChange={(e) => setEsconderAjustados(e.target.checked)} className="w-4 h-4" />
            esconder os já ajustados hoje
          </label>
          {totalConferir > 0 && (
            <label className="flex items-center gap-2 text-xs font-bold text-amber-800">
              <input type="checkbox" checked={soConferir} onChange={(e) => setSoConferir(e.target.checked)} className="w-4 h-4" />
              ⚠ só os sugeridos para conferir ({totalConferir})
            </label>
          )}
        </div>

        <input
          ref={buscaRef}
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setLimite(POR_PAGINA);
          }}
          type="search"
          inputMode="search"
          autoComplete="off"
          placeholder="Buscar: nome, código ou código de barras"
          className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-base"
        />
      </div>

      {erro && <p className="m-3 text-sm bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-3 py-2">{erro}</p>}
      {carregando && <p className="text-sm text-slate-500 text-center py-6">Carregando…</p>}

      {/* cabeçalho da lista (telas maiores) */}
      {!carregando && filtrados.length > 0 && (
        <div className="hidden sm:grid grid-cols-[1fr_110px_110px_210px] gap-2 px-4 py-2 text-[11px] font-bold uppercase text-slate-500 bg-slate-50 border-b">
          <span>Produto / código</span>
          <span className="text-right">Valor</span>
          <span className="text-right">Estoque</span>
          <span className="text-right">{modo === 'contagem' ? 'Quantidade contada' : 'Quantidade a ajustar'}</span>
        </div>
      )}

      <div className="divide-y divide-slate-200">
        {filtrados.slice(0, limite).map((p) => (
          <LinhaAjuste
            key={p.id}
            p={p}
            saldo={saldos[p.id] || 0}
            marca={marcas[p.id]}
            viaNF={viaNF.has(p.id)}
            modo={modo}
            motivo={motivo}
            aoGravar={(r) => aoGravar(p, r)}
          />
        ))}
      </div>
      {!carregando && !filtrados.length && <p className="text-center text-sm text-slate-500 py-6">Nenhum produto encontrado.</p>}
      {filtrados.length > limite && (
        <button type="button" onClick={() => setLimite((l) => l + POR_PAGINA)} className="w-full py-3 text-sm font-bold text-blue-800">
          Mostrar mais ({filtrados.length - limite})
        </button>
      )}
      <p className="px-4 py-3 text-[11px] text-slate-400">
        "Contei": digite quanto tem na prateleira; o sistema calcula a diferença. "Somar / tirar": digite 5 para entrar 5 ou -2 para sair 2. Ajusta
        o estoque físico e o administrativo. A lista se atualiza sozinha a cada {ATUALIZA_SEG} segundos.
      </p>
    </div>
  );
}

function LinhaAjuste({
  p,
  saldo,
  marca,
  viaNF,
  modo,
  motivo,
  aoGravar,
}: {
  p: Produto;
  saldo: number;
  marca?: Marca;
  viaNF?: boolean;
  modo: 'contagem' | 'ajuste';
  motivo: string;
  aoGravar: (r: Resultado) => void;
}) {
  const [qtd, setQtd] = useState('');
  const [obs, setObs] = useState('');
  const [verObs, setVerObs] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState('');

  const n = lerNumero(qtd);
  const dif = n == null ? null : modo === 'contagem' ? n - saldo : n;
  const depois = n == null ? null : modo === 'contagem' ? n : saldo + n;
  const invalido = n == null || (modo === 'contagem' && n < 0) || (modo === 'ajuste' && n === 0) || dif === 0;

  const gravar = async () => {
    if (invalido || gravando) return;
    if (marca && !window.confirm(`"${p.nome}" já foi ajustado hoje por ${marca.usuario} às ${hora(marca.quando)}. Ajustar de novo?`)) return;
    if (depois != null && depois < 0 && !window.confirm(`O estoque de "${p.nome}" vai ficar negativo (${qtdFmt(depois)}). Gravar assim mesmo?`)) return;
    setGravando(true);
    setErro('');
    const { data, error } = await supabase.rpc('ajustar_estoque', {
      p_produto: p.id,
      p_modo: modo,
      p_quantidade: n,
      p_motivo: motivo,
      p_obs: obs.trim() || null,
    });
    setGravando(false);
    if (error) {
      setErro(error.message.includes('ajustar_estoque') ? 'Falta atualizar o banco: rode o fase5_ajuste_estoque.sql no Supabase.' : error.message);
      return;
    }
    setQtd('');
    setObs('');
    setVerObs(false);
    aoGravar(data as Resultado);
  };

  return (
    <div className={`${marca ? 'bg-orange-50' : viaNF ? 'bg-violet-50' : ''} ${viaNF ? 'border-l-4 border-l-violet-500' : ''}`}>
      {/* faixa laranja: já ajustado hoje */}
      {marca && (
        <div className="bg-orange-500 px-3 sm:px-4 py-1 text-[11px] font-bold text-white">
          ✓ AJUSTADO por {marca.usuario} às {hora(marca.quando)} · {qtdFmt(marca.antes)} → {qtdFmt(marca.depois)}
        </div>
      )}
      <div className="px-3 sm:px-4 py-2 grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_110px_110px_210px] gap-x-2 gap-y-1 items-center">
        <div className="min-w-0">
          <p className="font-bold text-sm text-slate-800 leading-tight">
            {p.nome}
            {viaNF && <span className="ml-1.5 rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold text-white align-middle">📄 via NF</span>}
          </p>
          <p className="text-[11px] text-slate-500">
            Cód. {p.sku}
            {p.codigo_barras && p.codigo_barras !== p.sku ? ` · ${p.codigo_barras}` : ''}
            <span className="sm:hidden"> · {moeda(p.preco_venda)}</span>
          </p>
          {p.conferir && <p className="mt-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-900">⚠ Conferir: {p.conferir}</p>}
        </div>
        <span className="hidden sm:block text-right text-sm text-slate-600">{moeda(p.preco_venda)}</span>
        <span className={`text-right text-base font-black ${saldo < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
          {qtdFmt(saldo)} <span className="text-[10px] font-normal text-slate-500">{p.unidade}</span>
        </span>
        <div className="col-span-2 sm:col-span-1 flex items-center gap-2 justify-end">
          <input
            value={qtd}
            onChange={(e) => setQtd(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && gravar()}
            inputMode="decimal"
            placeholder={modo === 'contagem' ? 'Contei…' : '+5 / -2'}
            className="w-full sm:w-24 border border-slate-300 rounded-lg px-2 py-2 text-base text-right font-bold bg-white"
          />
          <button
            type="button"
            onClick={gravar}
            disabled={invalido || gravando}
            className="px-3 py-2 rounded-lg bg-blue-900 text-white font-bold text-sm disabled:opacity-30 whitespace-nowrap"
          >
            {gravando ? '…' : 'Gravar'}
          </button>
        </div>
        {(n != null || verObs || erro) && (
          <div className="col-span-2 sm:col-span-4 text-xs space-y-1">
            {n != null && !invalido && (
              <p className={`font-semibold ${(dif || 0) > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {qtdFmt(saldo)} → {qtdFmt(depois || 0)} ({(dif || 0) > 0 ? '+' : ''}
                {qtdFmt(dif || 0)} {p.unidade} · {moeda((dif || 0) * p.custo)} a custo)
              </p>
            )}
            {n != null && dif === 0 && <p className="text-slate-500">Igual ao estoque do sistema: nada a ajustar.</p>}
            {verObs && (
              <input
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                placeholder="Observação (opcional)"
                className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white"
              />
            )}
            {erro && <p className="text-rose-700">{erro}</p>}
          </div>
        )}
        {!verObs && n != null && !invalido && (
          <button type="button" onClick={() => setVerObs(true)} className="col-span-2 sm:col-span-4 text-left text-[11px] text-blue-800">
            + observação
          </button>
        )}
      </div>
    </div>
  );
}
