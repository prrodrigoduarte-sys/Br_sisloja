import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { buscarTodos } from './buscarTodos';
import NotaFiscalVenda from './NotaFiscalVenda';
import { SeletorCliente, type Cliente } from './ClienteVenda';
import type { Orcamento } from './OrcamentoModule';

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
  tabelaId: string; // '' = preço padrão; cada item pode ir por uma tabela diferente
}

interface VendaFeita {
  id?: string;
  cliente?: string | null;
  numero: number;
  total: number;
  troco: number;
  forma: string;
  parcelas: number;
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
// 'a4meia' = meia folha A4 (parte de cima da folha, com linha de corte) | 'cupom' = bobina estreita (80 mm)
type FormatoRecibo = 'a4meia' | 'cupom';

function imprimirRecibo(v: VendaFeita, loja: string, formato: FormatoRecibo = 'a4meia') {
  const forma =
    (FORMAS.find((f) => f.id === v.forma)?.rotulo || v.forma) +
    (v.forma === 'cartao_credito' ? (v.parcelas > 1 ? ` ${v.parcelas}x de ${moeda(v.total / v.parcelas)}` : ' à vista') : '');
  const html = formato === 'cupom' ? htmlCupom(v, loja, forma) : htmlMeiaA4(v, loja, forma);

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

function htmlMeiaA4(v: VendaFeita, loja: string, forma: string) {
  const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const linhas = v.itens
    .map(
      (i, k) =>
        `<tr><td class="c">${k + 1}</td><td>${esc(i.nome)}</td><td class="d">${qtd(i.quantidade)}</td><td class="d">${moeda(i.preco)}</td><td class="d">${moeda(i.subtotal)}</td></tr>`
    )
    .join('');
  const bruto = v.itens.reduce((s, i) => s + i.subtotal, 0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Venda ${v.numero}</title>
<style>
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;font-size:11px;margin:0;color:#000}
.folha{width:210mm;min-height:148.5mm;padding:9mm 12mm 7mm;border-bottom:1px dashed #888;display:flex;flex-direction:column}
.topo{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:4px}
h1{font-size:17px;margin:0}
.num{text-align:right;font-size:12px}
.num b{font-size:15px}
table.itens{width:100%;border-collapse:collapse;margin-top:6px}
.itens th{font-size:9px;text-transform:uppercase;text-align:left;border-bottom:1px solid #000;padding:3px 4px}
.itens td{padding:3px 4px;border-bottom:1px dotted #bbb;vertical-align:top}
.c{text-align:center;width:22px}.d{text-align:right;white-space:nowrap}
.rodape{margin-top:auto;display:flex;justify-content:space-between;gap:16px;padding-top:6px;border-top:1px solid #000}
.pag td{padding:1px 0}
.tot{min-width:200px}.tot td{padding:1px 0}.tot .g td{font-size:15px;font-weight:bold;border-top:1px solid #000;padding-top:3px}
.obs{font-size:9px;color:#444;margin-top:4px;text-align:center}
</style></head><body><div class="folha">
<div class="topo">
  <div><h1>${esc(loja)}</h1><div>Comprovante de venda</div></div>
  <div class="num">Venda nº <b>${v.numero}</b><br>${esc(v.data)}</div>
</div>
<table class="itens">
  <thead><tr><th class="c">#</th><th>Produto</th><th class="d">Qtd</th><th class="d">Unitário</th><th class="d">Total</th></tr></thead>
  <tbody>${linhas}</tbody>
</table>
<div class="rodape">
  <table class="pag">
    ${v.cliente ? `<tr><td><b>Cliente:</b> ${esc(v.cliente)}</td></tr>` : ''}
    <tr><td><b>Pagamento:</b> ${esc(forma)}</td></tr>
    ${v.forma === 'dinheiro' && v.recebido != null ? `<tr><td>Recebido: ${moeda(v.recebido)} · Troco: ${moeda(v.troco)}</td></tr>` : ''}
    <tr><td>Itens: ${v.itens.length}</td></tr>
  </table>
  <table class="tot">
    ${v.desconto > 0 ? `<tr><td>Subtotal</td><td class="d">${moeda(bruto)}</td></tr><tr><td>Desconto</td><td class="d">- ${moeda(v.desconto)}</td></tr>` : ''}
    <tr class="g"><td>TOTAL</td><td class="d">${moeda(v.total)}</td></tr>
  </table>
</div>
<div class="obs">Documento sem valor fiscal · Obrigado pela preferência!</div>
</div></body></html>`;
}

function htmlCupom(v: VendaFeita, loja: string, forma: string) {
  const linhas = v.itens
    .map(
      (i) =>
        `<tr><td>${esc(i.nome)}<br><small>${i.quantidade} x ${moeda(i.preco)}</small></td><td style="text-align:right">${moeda(i.subtotal)}</td></tr>`
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Venda ${v.numero}</title>
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
${v.cliente ? `<p>Cliente: ${esc(v.cliente)}</p>` : ''}
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
}

// ---------- Vendas do dia: ver itens, reimprimir e cancelar ----------
const cancelada = (v: any) => !!v.cancelada_em || String(v.status || '').toLowerCase().startsWith('cancel');

function VendasDoDia({ nomeLoja, aoFechar, aoCancelar }: { nomeLoja: string; aoFechar: () => void; aoCancelar: () => void }) {
  const [dia, setDia] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const [vendas, setVendas] = useState<any[]>([]);
  const [itens, setItens] = useState<Record<string, any[]>>({});
  const [aberta, setAberta] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<any | null>(null);
  const [motivo, setMotivo] = useState('');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await buscarTodos(() =>
      supabase
        .from('vendas')
        .select('*')
        .gte('created_at', new Date(dia + 'T00:00:00').toISOString())
        .lte('created_at', new Date(dia + 'T23:59:59.999').toISOString())
        .order('created_at', { ascending: false })
        .order('id')
    );
    setCarregando(false);
    if (error) return setMsg({ tipo: 'erro', texto: 'Não consegui carregar as vendas: ' + error.message });
    setVendas(data || []);
  }, [dia]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const itensDe = async (id: string) => {
    if (itens[id]) return itens[id];
    const { data } = await supabase.from('venda_itens').select('nome, quantidade, preco_unitario, subtotal').eq('venda_id', id);
    const l = (data as any[]) || [];
    setItens((x) => ({ ...x, [id]: l }));
    return l;
  };

  const abrir = async (v: any) => {
    if (aberta === v.id) return setAberta(null);
    setAberta(v.id);
    await itensDe(v.id);
  };

  const reimprimir = async (v: any, formato: FormatoRecibo) => {
    const l = await itensDe(v.id);
    const cli = v.cliente_id ? ((await supabase.rpc('obter_cliente', { p_id: v.cliente_id })).data as any) : null;
    imprimirRecibo(
      {
        cliente: cli?.nome || null,
        numero: Number(v.numero),
        total: Number(v.total),
        troco: Number(v.troco || 0),
        forma: v.forma_pagamento,
        parcelas: Number(v.parcelas || 1),
        recebido: v.valor_recebido != null ? Number(v.valor_recebido) : null,
        desconto: Number(v.desconto || 0),
        itens: l.map((i) => ({ nome: i.nome, quantidade: Number(i.quantidade), preco: Number(i.preco_unitario), subtotal: Number(i.subtotal) })),
        data: new Date(v.created_at).toLocaleString('pt-BR'),
      },
      nomeLoja,
      formato
    );
  };

  const confirmarCancelamento = async () => {
    if (motivo.trim().length < 5) return setMsg({ tipo: 'erro', texto: 'Escreva o motivo do cancelamento.' });
    if (!senha) return setMsg({ tipo: 'erro', texto: 'Digite a senha do administrador.' });
    setOcupado(true);
    setMsg(null);
    const { error } = await supabase.rpc('cancelar_venda', { p_venda_id: cancelando.id, p_motivo: motivo.trim(), p_senha: senha });
    setOcupado(false);
    setSenha('');
    if (error) {
      return setMsg({
        tipo: 'erro',
        texto: error.message.includes('cancelar_venda') ? 'Falta atualizar o banco: rode o arquivo fase7_cancelar_venda.sql no SQL Editor do Supabase.' : error.message,
      });
    }
    setMsg({ tipo: 'ok', texto: `Venda nº ${cancelando.numero} cancelada. Os produtos voltaram ao estoque e o Contas a receber foi cancelado.` });
    setCancelando(null);
    setMotivo('');
    carregar();
    aoCancelar();
  };

  const validas = vendas.filter((v) => !cancelada(v));
  const totalDia = validas.reduce((s, v) => s + Number(v.total || 0), 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <h3 className="font-black text-slate-800 mr-auto">🧾 Vendas</h3>
          <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="text-sm border border-slate-300 rounded-lg px-2 py-1" />
          <button type="button" onClick={aoFechar} className="text-slate-500 font-bold text-xl px-2 cursor-pointer" aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="px-4 py-2 text-xs text-slate-600 border-b bg-slate-50">
          {validas.length} venda(s) · <b>{moeda(totalDia)}</b>
          {vendas.length > validas.length && <span className="text-rose-600"> · {vendas.length - validas.length} cancelada(s)</span>}
        </div>
        {msg && (
          <p className={`mx-4 mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${msg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{msg.texto}</p>
        )}

        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {carregando && <p className="text-center text-sm text-slate-500 py-8">Carregando...</p>}
          {!carregando && vendas.length === 0 && <p className="text-center text-sm text-slate-500 py-8">Nenhuma venda neste dia.</p>}
          {vendas.map((v) => {
            const cancel = cancelada(v);
            const forma = (FORMAS.find((f) => f.id === v.forma_pagamento)?.rotulo || v.forma_pagamento) + (v.forma_pagamento === 'cartao_credito' && Number(v.parcelas) > 1 ? ` ${v.parcelas}x` : '');
            return (
              <div key={v.id} className={`rounded-xl border p-3 text-sm ${cancel ? 'border-rose-200 bg-rose-50/50' : 'border-slate-200'}`}>
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => abrir(v)}>
                  <span className="text-slate-400">{aberta === v.id ? '▾' : '▸'}</span>
                  <div className="min-w-0 mr-auto">
                    <p className={`font-bold ${cancel ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                      Nº {v.numero} · {new Date(v.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {forma}
                      {v.operador ? ` · ${v.operador}` : ''}
                    </p>
                  </div>
                  {cancel && <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">CANCELADA</span>}
                  <span className={`font-black whitespace-nowrap ${cancel ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{moeda(Number(v.total))}</span>
                </div>

                {aberta === v.id && (
                  <div className="mt-2 border-t pt-2 text-xs">
                    {(itens[v.id] || []).map((i, k) => (
                      <div key={k} className="flex justify-between gap-2 py-0.5">
                        <span className="text-slate-700">
                          {Number(i.quantidade)} × {i.nome}
                        </span>
                        <span className="text-slate-600 whitespace-nowrap">{moeda(Number(i.subtotal))}</span>
                      </div>
                    ))}
                    {Number(v.desconto) > 0 && <p className="text-slate-500">Desconto: {moeda(Number(v.desconto))}</p>}
                    {cancel && (
                      <p className="mt-1 text-rose-700">
                        Cancelada {v.cancelada_em ? `em ${new Date(v.cancelada_em).toLocaleString('pt-BR')}` : ''}
                        {v.cancelada_por ? ` por ${v.cancelada_por}` : ''}
                        {v.motivo_cancelamento ? ` · motivo: ${v.motivo_cancelamento}` : ''}
                      </p>
                    )}
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => reimprimir(v, 'a4meia')} className="rounded-lg bg-blue-900 px-3 py-1.5 font-bold text-white cursor-pointer">
                        🖨️ Meia A4
                      </button>
                      <button type="button" onClick={() => reimprimir(v, 'cupom')} className="rounded-lg border border-blue-900 px-3 py-1.5 font-bold text-blue-900 cursor-pointer">
                        🧾 Cupom
                      </button>
                      {!cancel && (
                        <button
                          type="button"
                          onClick={() => {
                            setCancelando(v);
                            setMsg(null);
                          }}
                          className="rounded-lg border border-rose-300 px-3 py-1.5 font-bold text-rose-700 cursor-pointer hover:bg-rose-50"
                        >
                          Cancelar venda
                        </button>
                      )}
                    </div>
                    <NotaFiscalVenda vendaId={v.id} cancelada={cancel} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {cancelando && (
          <div className="border-t p-4 bg-rose-50 rounded-b-2xl">
            <p className="font-black text-rose-800 text-sm">
              Cancelar a venda nº {cancelando.numero} ({moeda(Number(cancelando.total))})?
            </p>
            <p className="text-[11px] text-rose-700 mt-0.5">
              Os produtos voltam ao estoque e o lançamento no Contas a receber é cancelado. A venda continua no histórico, marcada como cancelada.
            </p>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo (ex.: cliente desistiu, lançada errada)"
              className="mt-2 w-full border border-rose-300 rounded-lg px-2 py-2 text-sm"
            />
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="Senha do administrador"
              autoComplete="off"
              className="mt-2 w-full border border-rose-300 rounded-lg px-2 py-2 text-sm"
            />
            <div className="mt-2 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setCancelando(null);
                  setSenha('');
                }}
                className="rounded-lg border px-3 py-2 text-sm font-bold text-slate-600 bg-white cursor-pointer"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={confirmarCancelamento}
                disabled={ocupado}
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-black text-white cursor-pointer disabled:opacity-50"
              >
                {ocupado ? 'Cancelando...' : 'Confirmar cancelamento'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Tela do PDV ----------
// preços de cada tabela (Padrão, Varejo, Atacado...): tocar numa etiqueta põe o item no carrinho com aquele preço
function PrecosTabelas({
  lista,
  selecionada,
  aoEscolher,
}: {
  lista: { id: string; nome: string; preco: number }[];
  selecionada: string;
  aoEscolher?: (tabelaId: string) => void;
}) {
  if (lista.length < 2) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {lista.map((x) => (
        <span
          key={x.id || 'padrao'}
          role={aoEscolher ? 'button' : undefined}
          title={aoEscolher ? `Vender pelo preço ${x.nome}` : undefined}
          onMouseDown={(e) => aoEscolher && e.preventDefault()}
          onClick={(e) => {
            if (!aoEscolher) return;
            e.stopPropagation();
            aoEscolher(x.id);
          }}
          className={`rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap ${aoEscolher ? 'cursor-pointer hover:ring-2 hover:ring-amber-400' : ''} ${
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
  const [parcelas, setParcelas] = useState(1); // só no crédito (1 a 10)
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [recebido, setRecebido] = useState('');
  const [desconto, setDesconto] = useState('');

  const [carrinhoAberto, setCarrinhoAberto] = useState(false);
  const [camera, setCamera] = useState(false);
  const [verVendas, setVerVendas] = useState(false);
  const [idxSel, setIdxSel] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [vendaFeita, setVendaFeita] = useState<VendaFeita | null>(null);
  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([]); // prontos para carregar na venda
  const [orcamentoAtual, setOrcamentoAtual] = useState<Orcamento | null>(null); // carregado no carrinho
  const buscaRef = useRef<HTMLInputElement>(null);

  const nomeLoja = loggedUser?.loja_nome || loggedUser?.codigo_loja || 'Loja';
  const operador = loggedUser?.nome || loggedUser?.email || 'Balcão';

  // ---- carga inicial ----
  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    const [p, s, t, pp] = await Promise.all([
      buscarTodos(() => supabase.from('produtos').select('id, sku, codigo_barras, nome, unidade, preco_venda').eq('ativo', true).order('nome').order('id')),
      buscarTodos(() => supabase.from('estoque_saldos').select('produto_id, saldo').eq('tipo', 'fisico').order('produto_id')),
      supabase.from('tabelas_preco').select('id, nome').order('nome'),
      buscarTodos(() => supabase.from('precos_produto').select('tabela_id, produto_id, preco').order('produto_id').order('tabela_id')),
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

  // orçamentos prontos (sem a tabela no banco, o quadro só não aparece)
  const carregarOrcamentos = useCallback(async () => {
    const { data } = await supabase.from('orcamentos').select('*').eq('status', 'pronto').order('created_at', { ascending: false }).limit(30);
    setOrcamentos(((data as any[]) || []).map((o) => ({ ...o, total: Number(o.total), desconto: Number(o.desconto) })));
  }, []);

  useEffect(() => {
    carregarOrcamentos();
  }, [carregarOrcamentos]);

  // ---- preço pela tabela escolhida ----
  // preço do produto numa tabela ('' ou sem preço na tabela = preço padrão)
  const precoTab = useCallback(
    (p: Produto, tab: string) => (tab && precos[tab] && precos[tab][p.id] != null ? precos[tab][p.id] : p.preco_venda),
    [precos]
  );
  const precoDe = useCallback((p: Produto) => precoTab(p, tabelaId), [precoTab, tabelaId]);

  // trocar a tabela no topo muda a venda inteira (cada item ainda pode ser trocado no carrinho)
  const trocarTabelaGeral = (id: string) => {
    setTabelaId(id);
    setCarrinho((prev) => prev.map((x) => ({ ...x, tabelaId: id })));
  };
  const trocarTabelaItem = (produtoId: string, id: string) =>
    setCarrinho((prev) => prev.map((x) => (x.produto.id === produtoId ? { ...x, tabelaId: id } : x)));

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
  // tab: tabela escolhida na etiqueta; sem ela, usa a tabela do topo
  const adicionar = useCallback(
    (produto: Produto, qtd = 1, tab?: string) => {
      setAviso('');
      setCarrinho((prev) => {
        const i = prev.findIndex((x) => x.produto.id === produto.id);
        if (i >= 0)
          return prev.map((x, k) => (k === i ? { ...x, quantidade: x.quantidade + qtd, tabelaId: tab ?? x.tabelaId } : x));
        return [...prev, { produto, quantidade: qtd, tabelaId: tab ?? tabelaId }];
      });
      if (navigator.vibrate) navigator.vibrate(30);
    },
    [tabelaId]
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

  const escolher = (p: Produto, tab?: string) => {
    adicionar(p, qtdBusca > 0 ? qtdBusca : 1, tab);
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

  // ---- orçamento pronto -> carrinho ----
  const carregarOrcamento = async (o: Orcamento) => {
    if (carrinho.length && !window.confirm(`Trocar os itens da venda atual pelos do orçamento nº ${o.numero}?`)) return;
    const faltando: string[] = [];
    const novos: ItemCarrinho[] = [];
    o.itens.forEach((i) => {
      const p = produtos.find((x) => x.id === i.produto_id);
      if (!p) return faltando.push(i.nome);
      // a tabela só vale se ainda existir; senão vai pelo preço padrão
      novos.push({ produto: p, quantidade: Number(i.quantidade), tabelaId: i.tabela_id && tabelas.some((t) => t.id === i.tabela_id) ? i.tabela_id : '' });
    });
    setCarrinho(novos);
    setTabelaId(o.tabela_id && tabelas.some((t) => t.id === o.tabela_id) ? o.tabela_id : '');
    setDesconto(o.desconto ? String(o.desconto).replace('.', ',') : '');
    setOrcamentoAtual(o);
    setCliente(null);
    if (o.cliente_id) {
      const { data } = await supabase.rpc('obter_cliente', { p_id: o.cliente_id });
      if (data) setCliente(data as Cliente);
    }
    // o preço da venda é o de hoje (o banco recalcula): avisa se mudou desde o orçamento
    const hoje = novos.reduce((a, x) => a + Math.round(precoTab(x.produto, x.tabelaId) * x.quantidade * 100) / 100, 0) - (o.desconto || 0);
    const avisos: string[] = [];
    if (faltando.length) avisos.push(`Fora da venda (produto inativo ou excluído): ${faltando.join(', ')}.`);
    if (!faltando.length && Math.abs(hoje - o.total) >= 0.01) avisos.push(`Os preços mudaram desde o orçamento: era ${moeda(o.total)}, hoje dá ${moeda(Math.max(hoje, 0))}.`);
    setAviso(avisos.length ? `Orçamento nº ${o.numero} carregado. ${avisos.join(' ')}` : `Orçamento nº ${o.numero} carregado na venda.`);
    setCarrinhoAberto(true);
  };

  // ---- totais ----
  const subtotal = carrinho.reduce((a, x) => a + Math.round(precoTab(x.produto, x.tabelaId) * x.quantidade * 100) / 100, 0);
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
      p_itens: carrinho.map((x) => ({ produto_id: x.produto.id, quantidade: x.quantidade, tabela_id: x.tabelaId || null })),
      p_forma: forma,
      p_recebido: forma === 'dinheiro' ? valorRecebido : null,
      p_desconto: valorDesconto,
      p_tabela: tabelaId || null,
      p_cliente: cliente?.id || null,
      p_operador: operador,
      p_parcelas: forma === 'cartao_credito' ? parcelas : 1,
    });
    setSalvando(false);
    if (error) {
      setAviso('Venda NÃO registrada: ' + error.message);
      return;
    }
    const r: any = data;
    if (orcamentoAtual) {
      await supabase.from('orcamentos').update({ status: 'convertido', venda_id: r.id || null, venda_numero: Number(r.numero) || null }).eq('id', orcamentoAtual.id);
      setOrcamentoAtual(null);
      carregarOrcamentos();
    }
    setVendaFeita({
      id: r.id,
      cliente: cliente?.nome || null,
      numero: Number(r.numero),
      total: Number(r.total),
      troco: Number(r.troco),
      forma,
      parcelas: forma === 'cartao_credito' ? parcelas : 1,
      recebido: forma === 'dinheiro' ? valorRecebido : null,
      desconto: valorDesconto,
      itens: carrinho.map((x) => ({
        nome: x.produto.nome,
        quantidade: x.quantidade,
        preco: precoTab(x.produto, x.tabelaId),
        subtotal: Math.round(precoTab(x.produto, x.tabelaId) * x.quantidade * 100) / 100,
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
    setParcelas(1);
    setCliente(null);
    setCarrinhoAberto(false);
  }, [salvando, carrinho, forma, parcelas, cliente, valorRecebido, total, valorDesconto, tabelaId, operador, precoTab, orcamentoAtual, carregarOrcamentos]);

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
          <h2 className="text-base sm:text-lg font-black text-slate-800 mr-auto">🛒 Frente de Caixa</h2>
          <button
            type="button"
            onClick={() => setVerVendas(true)}
            title="Vendas do dia: ver, reimprimir e cancelar"
            className="text-xs font-bold border border-slate-300 rounded-lg px-2 py-1.5 bg-white cursor-pointer hover:bg-slate-50"
          >
            🧾 Vendas
          </button>
          {tabelas.length > 0 && (
            <select
              value={tabelaId}
              onChange={(e) => trocarTabelaGeral(e.target.value)}
              title="Tabela de preço da venda (muda todos os itens; cada item pode ser trocado no carrinho)"
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
                          {tabelas.length > 0 && <PrecosTabelas lista={precosDe(p)} selecionada={tabelaId} aoEscolher={(tab) => escolher(p, tab)} />}
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

        {orcamentos.length > 0 && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-2">
            <p className="mb-1.5 text-[11px] font-black text-emerald-900">📝 Orçamentos prontos: toque para carregar na venda</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {orcamentos.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => carregarOrcamento(o)}
                  className={`shrink-0 rounded-lg px-3 py-2 text-left text-xs cursor-pointer border ${
                    orcamentoAtual?.id === o.id ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-800 border-emerald-200 hover:border-emerald-500'
                  }`}
                >
                  <span className="block font-black">
                    Nº {o.numero} · {moeda(o.total)}
                  </span>
                  <span className={`block text-[11px] ${orcamentoAtual?.id === o.id ? 'text-emerald-100' : 'text-slate-500'}`}>
                    {o.cliente_nome || 'sem cliente'} · {o.itens.length} item(ns)
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

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
                  {tabelas.length > 0 && (
                    <PrecosTabelas
                      lista={precosDe(p)}
                      selecionada={tabelaId}
                      aoEscolher={(tab) => {
                        adicionar(p, 1, tab);
                        setBusca('');
                      }}
                    />
                  )}
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
          <h3 className="font-black text-sm text-slate-800">
            Venda atual
            {orcamentoAtual && (
              <span className="ml-2 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white align-middle">
                orçamento nº {orcamentoAtual.numero}
                <button type="button" onClick={() => setOrcamentoAtual(null)} className="ml-1 cursor-pointer" title="Desligar do orçamento (os itens continuam)">
                  ✕
                </button>
              </span>
            )}
          </h3>
          <button type="button" onClick={() => setCarrinhoAberto(false)} className="lg:hidden text-slate-500 font-bold text-xl px-2 cursor-pointer" aria-label="Fechar carrinho">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-2 min-h-[120px]">
          {carrinho.length === 0 && <p className="text-center text-xs text-slate-400 py-10">Nenhum item. Leia um código ou toque num produto.</p>}
          {carrinho.map((x) => {
            const preco = precoTab(x.produto, x.tabelaId);
            const opcoes = precosDe(x.produto);
            return (
              <div key={x.produto.id} className="bg-slate-50 rounded-xl p-2.5 text-xs">
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 leading-tight">{x.produto.nome}</p>
                    {opcoes.length > 1 && (
                      <select
                        value={x.tabelaId}
                        onChange={(e) => trocarTabelaItem(x.produto.id, e.target.value)}
                        className="mt-1 rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[11px] font-bold text-amber-900"
                        aria-label="Tabela de preço do item"
                      >
                        {opcoes.map((o) => (
                          <option key={o.id || 'padrao'} value={o.id}>
                            {o.nome} · {moeda(o.preco)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
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
          <SeletorCliente cliente={cliente} aoMudar={setCliente} />
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

          {forma === 'cartao_credito' && (
            <label className="text-[11px] font-bold text-slate-500">
              PARCELAS
              <select
                value={parcelas}
                onChange={(e) => setParcelas(Number(e.target.value))}
                className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm font-semibold text-slate-800 bg-white"
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? `À vista (1x de ${moeda(total)})` : `${n}x de ${moeda(total / n)}`}
                  </option>
                ))}
              </select>
            </label>
          )}

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

      {/* estoque na tela é recarregado depois de cancelar (o banco já devolveu) */}
      {verVendas && <VendasDoDia nomeLoja={nomeLoja} aoFechar={() => setVerVendas(false)} aoCancelar={carregar} />}

      {/* Venda concluída */}
      {vendaFeita && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 text-center max-h-[92dvh] overflow-y-auto">
            <p className="text-4xl">✅</p>
            <h3 className="font-black text-lg text-slate-800 mt-1">Venda nº {vendaFeita.numero} registrada</h3>
            <p className="text-2xl font-black text-emerald-700 mt-2">{moeda(vendaFeita.total)}</p>
            {vendaFeita.forma === 'cartao_credito' && vendaFeita.parcelas > 1 && (
              <p className="text-sm font-bold text-slate-700 mt-1">
                Crédito {vendaFeita.parcelas}x de {moeda(vendaFeita.total / vendaFeita.parcelas)}
              </p>
            )}
            {vendaFeita.troco > 0 &&<p className="text-sm font-bold text-slate-700 mt-1">Troco: {moeda(vendaFeita.troco)}</p>}
            <div className="grid grid-cols-2 gap-2 mt-5">
              <button type="button" onClick={() => imprimirRecibo(vendaFeita, nomeLoja, 'a4meia')} className="py-3 rounded-xl bg-blue-900 text-white font-black cursor-pointer">
                🖨️ Meia A4
              </button>
              <button
                type="button"
                onClick={() => imprimirRecibo(vendaFeita, nomeLoja, 'cupom')}
                className="py-3 rounded-xl border-2 border-blue-900 text-blue-900 font-black cursor-pointer"
              >
                🧾 Cupom
              </button>
              <button type="button" onClick={novaVenda} className="col-span-2 py-3 rounded-xl bg-amber-400 text-slate-900 font-black cursor-pointer">
                Nova venda
              </button>
            </div>
            {vendaFeita.id && (
              <div className="text-left">
                <NotaFiscalVenda vendaId={vendaFeita.id} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
