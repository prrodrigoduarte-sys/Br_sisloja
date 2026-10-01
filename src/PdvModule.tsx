import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';

// ------------------------------------------------------------
// PDV (frente de caixa) — pensado para celular primeiro.
// - Leitor de código de barras: câmera do celular, leitor USB/Bluetooth (digita e dá Enter) ou digitação.
// - Digite "3*789123" para vender 3 unidades de uma vez.
// - Preço vem da tabela de preço escolhida; o servidor recalcula tudo e baixa o estoque na mesma transação.
// - Recibo impresso pelo navegador (vale para impressora Wi-Fi comum: A4 ou etiqueta).
// ------------------------------------------------------------

interface Produto {
  id: string;
  sku: string;
  codigo_barras: string | null;
  nome: string;
  unidade: string;
  preco_venda: number;
}

interface TabelaPreco {
  id: string;
  nome: string;
}

interface ItemCarrinho {
  produto: Produto;
  quantidade: number;
}

interface VendaFeita {
  numero: number;
  total: number;
  troco: number;
  forma: string;
  recebido: number | null;
  desconto: number;
  itens: { nome: string; quantidade: number; preco: number; subtotal: number }[];
  data: string;
}

const FORMAS: { id: string; rotulo: string; icone: string }[] = [
  { id: 'dinheiro', rotulo: 'Dinheiro', icone: '💵' },
  { id: 'pix', rotulo: 'Pix', icone: '⚡' },
  { id: 'cartao_debito', rotulo: 'Débito', icone: '💳' },
  { id: 'cartao_credito', rotulo: 'Crédito', icone: '💳' },
];

const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v: string) => Number(String(v).replace(',', '.'));
const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// "3*arroz" => 3 unidades de "arroz"
const separarQtd = (entrada: string) => {
  const m = entrada.trim().match(/^(\d+(?:[.,]\d+)?)\s*\*\s*(.*)$/);
  if (m) return { qtd: Number(m[1].replace(',', '.')) || 1, texto: m[2].trim() };
  return { qtd: 1, texto: entrada.trim() };
};
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

// ---------- Leitor por câmera ----------
function LeitorCamera({ aoLer, aoFechar }: { aoLer: (codigo: string) => void; aoFechar: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState('');
  const [ultimo, setUltimo] = useState('');
  const aoLerRef = useRef(aoLer);
  aoLerRef.current = aoLer;

  useEffect(() => {
    let ativo = true;
    let timer: number | undefined;
    let stream: MediaStream | null = null;
    let ultimoCodigo = '';
    let ultimoMomento = 0;

    const Detector = (window as any).BarcodeDetector;
    if (!Detector) {
      setErro('Este navegador não lê código de barras pela câmera (o Chrome do Android lê). Use um leitor USB/Bluetooth ou digite o código.');
      return;
    }
    const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'] });

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (!ativo) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = s;
        v.play().catch(() => undefined);
        const ler = async () => {
          if (!ativo) return;
          try {
            const r = await detector.detect(v);
            const codigo = r && r[0] && r[0].rawValue;
            const agora = Date.now();
            // evita ler o mesmo código várias vezes seguidas
            if (codigo && (codigo !== ultimoCodigo || agora - ultimoMomento > 2000)) {
              ultimoCodigo = codigo;
              ultimoMomento = agora;
              setUltimo(codigo);
              aoLerRef.current(codigo);
            }
          } catch {
            /* frame sem código */
          }
          timer = window.setTimeout(ler, 250);
        };
        ler();
      })
      .catch(() => setErro('Não consegui abrir a câmera. Libere a permissão da câmera no navegador (e use o endereço com https).'));

    return () => {
      ativo = false;
      if (timer) clearTimeout(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-black text-slate-800">📷 Ler código de barras</h3>
          <button type="button" onClick={aoFechar} className="text-slate-500 font-bold text-xl px-2 cursor-pointer" aria-label="Fechar">
            ✕
          </button>
        </div>
        {erro ? (
          <p className="p-4 text-sm text-rose-700">{erro}</p>
        ) : (
          <>
            <video ref={videoRef} playsInline muted className="w-full aspect-[4/3] bg-black object-cover" />
            <p className="p-3 text-xs text-slate-500 text-center">
              Aponte para o código. Cada leitura entra no carrinho.{ultimo && <span className="block font-bold text-slate-700 mt-1">Último: {ultimo}</span>}
            </p>
          </>
        )}
        <div className="p-3 border-t">
          <button type="button" onClick={aoFechar} className="w-full py-3 rounded-xl bg-blue-900 text-white font-black cursor-pointer">
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Recibo (impressão pelo navegador) ----------
function imprimirRecibo(v: VendaFeita, loja: string) {
  const linhas = v.itens
    .map(
      (i) =>
        `<tr><td>${esc(i.nome)}<br><small>${i.quantidade} x ${moeda(i.preco)}</small></td><td style="text-align:right">${moeda(i.subtotal)}</td></tr>`
    )
    .join('');
  const forma = FORMAS.find((f) => f.id === v.forma)?.rotulo || v.forma;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Venda ${v.numero}</title>
<style>
@page{margin:8mm}
body{font-family:Arial,Helvetica,sans-serif;font-size:12px;max-width:320px;margin:0 auto;color:#000}
h1{font-size:15px;text-align:center;margin:0 0 2px}
p{margin:2px 0;text-align:center}
table{width:100%;border-collapse:collapse;margin-top:8px}
td{padding:3px 0;border-bottom:1px dashed #999;vertical-align:top}
.tot{font-size:15px;font-weight:bold}
small{color:#444}
</style></head><body>
<h1>${esc(loja)}</h1>
<p>Comprovante de venda nº ${v.numero}</p>
<p>${esc(v.data)}</p>
<p><small>Documento sem valor fiscal</small></p>
<table>${linhas}</table>
<table>
${v.desconto > 0 ? `<tr><td>Desconto</td><td style="text-align:right">- ${moeda(v.desconto)}</td></tr>` : ''}
<tr class="tot"><td>TOTAL</td><td style="text-align:right">${moeda(v.total)}</td></tr>
<tr><td>Pagamento</td><td style="text-align:right">${esc(forma)}</td></tr>
${v.forma === 'dinheiro' && v.recebido != null ? `<tr><td>Recebido</td><td style="text-align:right">${moeda(v.recebido)}</td></tr><tr><td>Troco</td><td style="text-align:right">${moeda(v.troco)}</td></tr>` : ''}
</table>
<p style="margin-top:10px">Obrigado pela preferência!</p>
</body></html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
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

// ---------- Tela do PDV ----------
// preços de cada tabela (Padrão, Varejo, Atacado...) em miniatura; a tabela usada na venda fica destacada
function PrecosTabelas({ lista, selecionada }: { lista: { id: string; nome: string; preco: number }[]; selecionada: string }) {
  if (lista.length < 2) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {lista.map((x) => (
        <span
          key={x.id || 'padrao'}
          className={`rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap ${
            x.id === selecionada ? 'bg-amber-500 text-white font-bold' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {x.nome} {moeda(x.preco)}
        </span>
      ))}
    </span>
  );
}

export default function PdvModule({ loggedUser }: { loggedUser: any }) {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [saldos, setSaldos] = useState<Record<string, number>>({});
  const [tabelas, setTabelas] = useState<TabelaPreco[]>([]);
  const [precos, setPrecos] = useState<Record<string, Record<string, number>>>({});
  const [tabelaId, setTabelaId] = useState('');

  const [busca, setBusca] = useState('');
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [forma, setForma] = useState('dinheiro');
  const [recebido, setRecebido] = useState('');
  const [desconto, setDesconto] = useState('');

  const [carrinhoAberto, setCarrinhoAberto] = useState(false);
  const [camera, setCamera] = useState(false);
  const [idxSel, setIdxSel] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [vendaFeita, setVendaFeita] = useState<VendaFeita | null>(null);
  const buscaRef = useRef<HTMLInputElement>(null);

  const nomeLoja = loggedUser?.loja_nome || loggedUser?.codigo_loja || 'Loja';
  const operador = loggedUser?.nome || loggedUser?.email || 'Balcão';

  // ---- carga inicial ----
  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    const [p, s, t, pp] = await Promise.all([
      supabase.from('produtos').select('id, sku, codigo_barras, nome, unidade, preco_venda').eq('ativo', true).order('nome').limit(5000),
      supabase.from('estoque_saldos').select('produto_id, saldo').eq('tipo', 'fisico').limit(10000),
      supabase.from('tabelas_preco').select('id, nome').order('nome'),
      supabase.from('precos_produto').select('tabela_id, produto_id, preco').limit(20000),
    ]);
    if (p.error) {
      setErro('Não consegui carregar os produtos: ' + p.error.message);
      setCarregando(false);
      return;
    }
    setProdutos((p.data || []).map((x: any) => ({ ...x, preco_venda: Number(x.preco_venda) })));
    const mapaSaldo: Record<string, number> = {};
    (s.data || []).forEach((x: any) => (mapaSaldo[x.produto_id] = Number(x.saldo)));
    setSaldos(mapaSaldo);
    setTabelas((t.data as TabelaPreco[]) || []);
    const mapaPreco: Record<string, Record<string, number>> = {};
    (pp.data || []).forEach((x: any) => {
      (mapaPreco[x.tabela_id] ||= {})[x.produto_id] = Number(x.preco);
    });
    setPrecos(mapaPreco);
    setCarregando(false);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // ---- preço pela tabela escolhida ----
  const precoDe = useCallback(
    (p: Produto) => (tabelaId && precos[tabelaId] && precos[tabelaId][p.id] != null ? precos[tabelaId][p.id] : p.preco_venda),
    [tabelaId, precos]
  );

  // todos os preços do produto (padrão + cada tabela), para mostrar como sugestão
  const precosDe = useCallback(
    (p: Produto) => [
      { id: '', nome: 'Padrão', preco: p.preco_venda },
      ...tabelas.filter((t) => precos[t.id]?.[p.id] != null).map((t) => ({ id: t.id, nome: t.nome, preco: precos[t.id][p.id] })),
    ],
    [tabelas, precos]
  );

  // ---- busca: nome, SKU ou código de barras (sem depender de acento, várias palavras) ----
  const { qtd: qtdBusca, texto: textoBusca } = useMemo(() => separarQtd(busca), [busca]);

  const filtrados = useMemo(() => {
    const termos = norm(textoBusca).split(/\s+/).filter(Boolean);
    if (termos.length === 0) return produtos.slice(0, 60);
    const achados = produtos.filter((p) => {
      const alvo = norm(p.nome + ' ' + p.sku + ' ' + (p.codigo_barras || ''));
      return termos.every((t) => alvo.includes(t));
    });
    // SKU ou código que começa com o digitado vem primeiro
    const q = norm(textoBusca);
    achados.sort((a, b) => {
      const pa = norm(a.sku).startsWith(q) || (a.codigo_barras || '').startsWith(q) ? 0 : 1;
      const pb = norm(b.sku).startsWith(q) || (b.codigo_barras || '').startsWith(q) ? 0 : 1;
      return pa - pb;
    });
    return achados.slice(0, 60);
  }, [produtos, textoBusca]);

  const sugestoes = textoBusca ? filtrados.slice(0, 8) : [];
  useEffect(() => setIdxSel(0), [textoBusca]);

  // ---- carrinho ----
  const adicionar = useCallback(
    (produto: Produto, qtd = 1) => {
      setAviso('');
      setCarrinho((prev) => {
        const i = prev.findIndex((x) => x.produto.id === produto.id);
        if (i >= 0) return prev.map((x, k) => (k === i ? { ...x, quantidade: x.quantidade + qtd } : x));
        return [...prev, { produto, quantidade: qtd }];
      });
      if (navigator.vibrate) navigator.vibrate(30);
    },
    []
  );

  const ajustarQtd = (id: string, delta: number) =>
    setCarrinho((prev) =>
      prev.map((x) => (x.produto.id === id ? { ...x, quantidade: Math.max(0, Math.round((x.quantidade + delta) * 1000) / 1000) } : x)).filter((x) => x.quantidade > 0)
    );

  const definirQtd = (id: string, valor: string) => {
    const n = num(valor);
    if (!isFinite(n) || n <= 0) return;
    setCarrinho((prev) => prev.map((x) => (x.produto.id === id ? { ...x, quantidade: n } : x)));
  };

  const remover = (id: string) => setCarrinho((prev) => prev.filter((x) => x.produto.id !== id));

  // código lido (câmera, leitor ou Enter na busca): acha por código de barras ou SKU exato
  const tratarCodigo = useCallback(
    (entrada: string) => {
      const { qtd, texto } = separarQtd(entrada);
      if (!texto) return false;
      const t = texto.toLowerCase();
      const achado = produtos.find((p) => (p.codigo_barras && p.codigo_barras === texto) || p.sku.toLowerCase() === t);
      if (achado) {
        adicionar(achado, qtd > 0 ? qtd : 1);
        return true;
      }
      return false;
    },
    [produtos, adicionar]
  );

  const escolher = (p: Produto) => {
    adicionar(p, qtdBusca > 0 ? qtdBusca : 1);
    setBusca('');
    setTimeout(() => buscaRef.current?.focus(), 0);
  };

  const aoEnterBusca = () => {
    // 1) código de barras ou SKU exato entra direto (leitor de código de barras)
    if (tratarCodigo(busca)) {
      setBusca('');
      return;
    }
    // 2) senão, entra a sugestão destacada
    if (sugestoes.length > 0) {
      escolher(sugestoes[Math.min(idxSel, sugestoes.length - 1)]);
      return;
    }
    setAviso(busca.trim() ? 'Nenhum produto encontrado. Confira o cadastro do produto.' : '');
  };

  const aoLerCamera = (codigo: string) => {
    if (!tratarCodigo(codigo)) setAviso(`Código ${codigo} não encontrado.`);
  };

  // ---- totais ----
  const subtotal = carrinho.reduce((a, x) => a + precoDe(x.produto) * x.quantidade, 0);
  const valorDesconto = Math.min(Math.max(num(desconto) || 0, 0), subtotal);
  const total = Math.max(subtotal - valorDesconto, 0);
  const valorRecebido = num(recebido) || 0;
  const troco = forma === 'dinheiro' && valorRecebido > total ? valorRecebido - total : 0;
  const qtdItens = carrinho.reduce((a, x) => a + x.quantidade, 0);

  // ---- finalizar ----
  const finalizar = useCallback(async () => {
    if (salvando) return;
    if (carrinho.length === 0) {
      setAviso('O carrinho está vazio.');
      return;
    }
    if (forma === 'dinheiro' && valorRecebido < total) {
      setAviso('Informe o valor recebido (igual ou maior que o total).');
      return;
    }
    setSalvando(true);
    setAviso('');
    const { data, error } = await supabase.rpc('registrar_venda', {
      p_itens: carrinho.map((x) => ({ produto_id: x.produto.id, quantidade: x.quantidade })),
      p_forma: forma,
      p_recebido: forma === 'dinheiro' ? valorRecebido : null,
      p_desconto: valorDesconto,
      p_tabela: tabelaId || null,
      p_cliente: null,
      p_operador: operador,
    });
    setSalvando(false);
    if (error) {
      setAviso('Venda NÃO registrada: ' + error.message);
      return;
    }
    const r: any = data;
    setVendaFeita({
      numero: Number(r.numero),
      total: Number(r.total),
      troco: Number(r.troco),
      forma,
      recebido: forma === 'dinheiro' ? valorRecebido : null,
      desconto: valorDesconto,
      itens: carrinho.map((x) => ({
        nome: x.produto.nome,
        quantidade: x.quantidade,
        preco: precoDe(x.produto),
        subtotal: Math.round(precoDe(x.produto) * x.quantidade * 100) / 100,
      })),
      data: new Date().toLocaleString('pt-BR'),
    });
    // baixa o saldo na tela (o banco já baixou de verdade)
    setSaldos((prev) => {
      const novo = { ...prev };
      carrinho.forEach((x) => (novo[x.produto.id] = (novo[x.produto.id] || 0) - x.quantidade));
      return novo;
    });
    setCarrinho([]);
    setRecebido('');
    setDesconto('');
    setCarrinhoAberto(false);
  }, [salvando, carrinho, forma, valorRecebido, total, valorDesconto, tabelaId, operador, precoDe]);

  // atalho F10
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F10') {
        e.preventDefault();
        finalizar();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [finalizar]);

  const novaVenda = () => {
    setVendaFeita(null);
    setTimeout(() => buscaRef.current?.focus(), 50);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-3 lg:h-[calc(100dvh-1.5rem)] pb-20 lg:pb-0">
      {/* ===== Produtos ===== */}
      <section className="flex-1 min-w-0 bg-white rounded-2xl shadow-sm border border-slate-200 p-3 sm:p-4 flex flex-col gap-3 lg:min-h-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base sm:text-lg font-black text-slate-800">🛒 Frente de Caixa</h2>
          {tabelas.length > 0 && (
            <select
              value={tabelaId}
              onChange={(e) => setTabelaId(e.target.value)}
              className="text-xs font-bold border border-slate-300 rounded-lg px-2 py-1.5 bg-white max-w-[45%]"
              aria-label="Tabela de preço"
            >
              <option value="">Preço padrão</option>
              {tabelas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <input
              ref={buscaRef}
              type="text"
              inputMode="search"
              autoFocus
              autoComplete="off"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && sugestoes.length) {
                  e.preventDefault();
                  setIdxSel((i) => Math.min(i + 1, sugestoes.length - 1));
                } else if (e.key === 'ArrowUp' && sugestoes.length) {
                  e.preventDefault();
                  setIdxSel((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Escape') {
                  setBusca('');
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  aoEnterBusca();
                }
              }}
              placeholder="Nome, código ou código de barras  (ex.: 3*arroz)"
              className="w-full px-3 py-3 rounded-xl border border-slate-300 text-sm outline-none focus:border-blue-700"
            />
            {sugestoes.length > 0 && (
              <ul className="absolute left-0 right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-xl shadow-xl max-h-72 overflow-y-auto divide-y">
                {sugestoes.map((p, i) => {
                  const saldo = saldos[p.id] || 0;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => escolher(p)}
                        onMouseEnter={() => setIdxSel(i)}
                        className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 cursor-pointer ${i === idxSel ? 'bg-blue-50' : 'bg-white'}`}
                      >
                        <span className="min-w-0">
                          <span className="block text-[13px] font-bold text-slate-800 truncate">{p.nome}</span>
                          <span className="block text-[11px] text-slate-500 truncate">
                            {p.sku}
                            {p.codigo_barras ? ` · ${p.codigo_barras}` : ''} ·{' '}
                            <span className={saldo <= 0 ? 'text-rose-600 font-bold' : ''}>{saldo <= 0 ? 'sem estoque' : `estoque ${saldo} ${p.unidade}`}</span>
                          </span>
                          {tabelas.length > 0 && <PrecosTabelas lista={precosDe(p)} selecionada={tabelaId} />}
                        </span>
                        <span className="font-black text-[13px] text-amber-600 whitespace-nowrap">{moeda(precoDe(p))}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCamera(true)}
            className="px-4 rounded-xl bg-blue-900 text-white font-black text-lg cursor-pointer active:scale-95"
            aria-label="Ler com a câmera"
            title="Ler com a câmera"
          >
            📷
          </button>
        </div>

        {aviso && <div className="text-xs font-semibold bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">{aviso}</div>}
        {erro && <div className="text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-3 py-2">{erro}</div>}

        <div className="flex-1 lg:overflow-y-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2 content-start">
          {carregando && <p className="col-span-full text-center text-sm text-slate-500 py-8">Carregando produtos...</p>}
          {!carregando && filtrados.length === 0 && (
            <p className="col-span-full text-center text-sm text-slate-500 py-8">
              {produtos.length === 0 ? 'Nenhum produto cadastrado ainda. Cadastre em Produtos & Estoque.' : 'Nada encontrado.'}
            </p>
          )}
          {filtrados.map((p) => {
            const saldo = saldos[p.id] || 0;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  adicionar(p);
                  setBusca('');
                }}
                className="text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl p-3 flex flex-col justify-between min-h-[92px] cursor-pointer active:scale-[0.97] transition"
              >
                <div>
                  <p className="font-bold text-[13px] leading-tight text-slate-800 line-clamp-2">{p.nome}</p>
                  <p className={`text-[11px] mt-1 ${saldo <= 0 ? 'text-rose-600 font-bold' : 'text-slate-500'}`}>
                    {saldo <= 0 ? 'Sem estoque' : `Estoque: ${saldo} ${p.unidade}`}
                  </p>
                </div>
                <div className="mt-2">
                  <p className="font-black text-[15px] text-amber-600">{moeda(precoDe(p))}</p>
                  {tabelas.length > 0 && <PrecosTabelas lista={precosDe(p)} selecionada={tabelaId} />}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ===== Carrinho ===== */}
      <section
        className={`${carrinhoAberto ? 'flex' : 'hidden'} lg:flex fixed lg:static inset-x-0 bottom-0 top-12 lg:top-auto z-30 lg:z-auto lg:w-[380px] xl:w-[420px] shrink-0 bg-white lg:rounded-2xl rounded-t-2xl shadow-2xl lg:shadow-sm border border-slate-200 flex-col p-3 sm:p-4 gap-3 lg:min-h-0`}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-black text-sm text-slate-800">Venda atual</h3>
          <button type="button" onClick={() => setCarrinhoAberto(false)} className="lg:hidden text-slate-500 font-bold text-xl px-2 cursor-pointer" aria-label="Fechar carrinho">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-2 min-h-[120px]">
          {carrinho.length === 0 && <p className="text-center text-xs text-slate-400 py-10">Nenhum item. Leia um código ou toque num produto.</p>}
          {carrinho.map((x) => {
            const preco = precoDe(x.produto);
            return (
              <div key={x.produto.id} className="bg-slate-50 rounded-xl p-2.5 text-xs">
                <div className="flex justify-between gap-2">
                  <p className="font-bold text-slate-800 leading-tight">{x.produto.nome}</p>
                  <button type="button" onClick={() => remover(x.produto.id)} className="text-rose-600 font-black cursor-pointer" aria-label="Remover item">
                    ✕
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => ajustarQtd(x.produto.id, -1)} className="w-8 h-8 rounded-lg bg-white border border-slate-300 font-black cursor-pointer active:scale-95">
                      −
                    </button>
                    <input
                      key={x.quantidade}
                      defaultValue={x.quantidade}
                      inputMode="decimal"
                      onBlur={(e) => definirQtd(x.produto.id, e.target.value)}
                      className="w-12 h-8 text-center rounded-lg border border-slate-300 font-bold"
                    />
                    <button type="button" onClick={() => ajustarQtd(x.produto.id, 1)} className="w-8 h-8 rounded-lg bg-white border border-slate-300 font-black cursor-pointer active:scale-95">
                      +
                    </button>
                    <span className="text-slate-500 ml-1">× {moeda(preco)}</span>
                  </div>
                  <span className="font-black text-slate-900">{moeda(Math.round(preco * x.quantidade * 100) / 100)}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t pt-3 flex flex-col gap-2.5">
          <div className="grid grid-cols-4 gap-1.5">
            {FORMAS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setForma(f.id)}
                className={`py-2 rounded-lg text-[11px] font-bold border cursor-pointer leading-tight ${
                  forma === f.id ? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                <span className="block text-base">{f.icone}</span>
                {f.rotulo}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] font-bold text-slate-500">
              DESCONTO (R$)
              <input
                value={desconto}
                onChange={(e) => setDesconto(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm font-semibold text-slate-800"
              />
            </label>
            {forma === 'dinheiro' && (
              <label className="text-[11px] font-bold text-slate-500">
                RECEBIDO (R$)
                <input
                  value={recebido}
                  onChange={(e) => setRecebido(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm font-semibold text-slate-800"
                />
              </label>
            )}
          </div>
          {forma === 'dinheiro' && troco > 0 && <p className="text-sm font-black text-emerald-700">Troco: {moeda(troco)}</p>}

          <div className="bg-slate-900 text-white rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400">TOTAL{valorDesconto > 0 ? ` (desc. ${moeda(valorDesconto)})` : ''}</span>
            <span className="text-2xl font-black text-amber-300">{moeda(total)}</span>
          </div>

          <button
            type="button"
            onClick={finalizar}
            disabled={salvando || carrinho.length === 0}
            className="w-full py-4 rounded-xl bg-amber-400 text-slate-900 font-black text-base shadow cursor-pointer disabled:opacity-50 active:scale-[0.98]"
          >
            {salvando ? 'Registrando...' : '⚡ FINALIZAR VENDA  [F10]'}
          </button>
        </div>
      </section>

      {/* Barra fixa no celular */}
      {!carrinhoAberto && (
        <button
          type="button"
          onClick={() => setCarrinhoAberto(true)}
          className="lg:hidden fixed left-3 right-3 bottom-3 z-20 bg-slate-900 text-white rounded-2xl px-4 py-3.5 flex items-center justify-between shadow-2xl cursor-pointer active:scale-[0.99]"
        >
          <span className="text-sm font-bold">
            🛒 {qtdItens} {qtdItens === 1 ? 'item' : 'itens'}
          </span>
          <span className="text-lg font-black text-amber-300">{moeda(total)} ›</span>
        </button>
      )}

      {camera && <LeitorCamera aoLer={aoLerCamera} aoFechar={() => setCamera(false)} />}

      {/* Venda concluída */}
      {vendaFeita && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 text-center">
            <p className="text-4xl">✅</p>
            <h3 className="font-black text-lg text-slate-800 mt-1">Venda nº {vendaFeita.numero} registrada</h3>
            <p className="text-2xl font-black text-emerald-700 mt-2">{moeda(vendaFeita.total)}</p>
            {vendaFeita.troco > 0 && <p className="text-sm font-bold text-slate-700 mt-1">Troco: {moeda(vendaFeita.troco)}</p>}
            <div className="grid grid-cols-2 gap-2 mt-5">
              <button type="button" onClick={() => imprimirRecibo(vendaFeita, nomeLoja)} className="py-3 rounded-xl bg-blue-900 text-white font-black cursor-pointer">
                🖨️ Imprimir
              </button>
              <button type="button" onClick={novaVenda} className="py-3 rounded-xl bg-amber-400 text-slate-900 font-black cursor-pointer">
                Nova venda
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
