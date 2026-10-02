// BR Sisloja - Notas Fiscais: todas as NFC-e e NF-e emitidas (a emissão é feita no PDV, na venda).
// Aqui: filtrar por período, modelo e situação; abrir DANFE e XML; atualizar as que estão processando; cancelar.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { buscarTodos } from './buscarTodos';
import { chamar } from './NotaFiscalVenda';

type Usuario = { id: string; email: string; nome: string; perfil: string; codigo_loja: string; loja_nome: string };

const STATUS: Record<string, { rotulo: string; cor: string }> = {
  autorizada: { rotulo: 'Autorizada', cor: 'bg-green-100 text-green-800' },
  processando: { rotulo: 'Processando', cor: 'bg-amber-100 text-amber-800' },
  erro: { rotulo: 'Recusada', cor: 'bg-red-100 text-red-800' },
  cancelada: { rotulo: 'Cancelada', cor: 'bg-gray-200 text-gray-600' },
};
const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHora = (s: string) => new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export default function NotasFiscaisModule({ loggedUser }: { loggedUser: Usuario }) {
  const hoje = new Date().toLocaleDateString('sv-SE');
  const [de, setDe] = useState(hoje.slice(0, 8) + '01');
  const [ate, setAte] = useState(hoje);
  const [modelo, setModelo] = useState<'' | 'nfce' | 'nfe'>('');
  const [situacao, setSituacao] = useState('');
  const [busca, setBusca] = useState('');
  const [notas, setNotas] = useState<any[]>([]);
  const [vendas, setVendas] = useState<Record<string, any>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    const r = await buscarTodos(() =>
      supabase
        .from('notas_fiscais')
        .select('*')
        .eq('codigo_loja', loggedUser.codigo_loja)
        .gte('created_at', new Date(de + 'T00:00:00').toISOString())
        .lte('created_at', new Date(ate + 'T23:59:59.999').toISOString())
        .order('created_at', { ascending: false })
        .order('id')
    );
    if (r.error) {
      setErro(
        r.error.message.includes('notas_fiscais')
          ? 'Falta atualizar o banco: rode o arquivo fase8_nota_fiscal.sql no SQL Editor do Supabase (veja o LEIA-ME_nota_fiscal.txt).'
          : 'Erro ao carregar: ' + r.error.message
      );
      setCarregando(false);
      return;
    }
    const l = r.data || [];
    // nº e valor das vendas das notas
    const ids = Array.from(new Set(l.map((n: any) => n.venda_id)));
    const m: Record<string, any> = {};
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await supabase.from('vendas').select('id, numero, total').in('id', ids.slice(i, i + 150));
      ((data as any[]) || []).forEach((v) => (m[v.id] = v));
    }
    setVendas(m);
    setNotas(l);
    setCarregando(false);
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedUser.codigo_loja, de, ate]);

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return notas.filter(
      (n) =>
        (!modelo || n.modelo === modelo) &&
        (!situacao || n.status === situacao) &&
        (!t ||
          [n.numero, n.chave, n.destinatario?.nome, n.destinatario?.cpf_cnpj, String(vendas[n.venda_id]?.numero || '')].some((x) =>
            String(x || '').toLowerCase().includes(t)
          ))
    );
  }, [notas, modelo, situacao, busca, vendas]);

  const resumo = useMemo(() => {
    const aut = notas.filter((n) => n.status === 'autorizada');
    const soma = (l: any[]) => l.reduce((s, n) => s + Number(vendas[n.venda_id]?.total || 0), 0);
    return {
      nfce: { qtd: aut.filter((n) => n.modelo === 'nfce').length, total: soma(aut.filter((n) => n.modelo === 'nfce')) },
      nfe: { qtd: aut.filter((n) => n.modelo === 'nfe').length, total: soma(aut.filter((n) => n.modelo === 'nfe')) },
      canceladas: notas.filter((n) => n.status === 'cancelada').length,
      pendentes: notas.filter((n) => n.status === 'processando' || n.status === 'erro').length,
    };
  }, [notas, vendas]);

  const acao = async (n: any, corpo: Record<string, unknown>, ok: string) => {
    setOcupado(n.id);
    setErro('');
    const r = await chamar(corpo);
    setOcupado(null);
    if (!r.ok) setErro(r.erro || 'Não deu certo.');
    else setAviso(ok);
    carregar();
  };

  const cancelar = (n: any) => {
    const just = window.prompt(
      `Cancelar a ${n.modelo === 'nfce' ? 'NFC-e' : 'NF-e'} nº ${n.numero || ''} na SEFAZ?\n` +
        'Prazo: NFC-e em geral até 30 minutos; NF-e até 24 horas.\n\nJustificativa (mínimo 15 letras):'
    );
    if (just == null) return;
    if (just.trim().length < 15) return setErro('A justificativa precisa ter pelo menos 15 letras.');
    acao(n, { acao: 'cancelar', nota_id: n.id, justificativa: just.trim() }, 'Nota cancelada na SEFAZ. O estoque fiscal voltou.');
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-3 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-bold text-gray-800">📄 Notas Fiscais</h2>
        <span className="text-xs text-gray-500">A emissão é feita no PDV: ao finalizar a venda ou em 🧾 Vendas.</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Quadro titulo="NFC-e autorizadas" valor={`${resumo.nfce.qtd}`} sub={brl(resumo.nfce.total)} cor="text-green-700" />
        <Quadro titulo="NF-e autorizadas" valor={`${resumo.nfe.qtd}`} sub={brl(resumo.nfe.total)} cor="text-green-700" />
        <Quadro titulo="Canceladas" valor={`${resumo.canceladas}`} cor="text-gray-700" />
        <Quadro titulo="Recusadas / processando" valor={`${resumo.pendentes}`} cor={resumo.pendentes ? 'text-red-700' : 'text-gray-700'} />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 text-sm shadow-sm">
        de <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded border px-2 py-1" />
        até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded border px-2 py-1" />
        <select value={modelo} onChange={(e) => setModelo(e.target.value as any)} className="rounded border bg-white px-2 py-1">
          <option value="">NFC-e e NF-e</option>
          <option value="nfce">Só NFC-e</option>
          <option value="nfe">Só NF-e</option>
        </select>
        <select value={situacao} onChange={(e) => setSituacao(e.target.value)} className="rounded border bg-white px-2 py-1">
          <option value="">Todas as situações</option>
          {Object.entries(STATUS).map(([id, s]) => (
            <option key={id} value={id}>
              {s.rotulo}
            </option>
          ))}
        </select>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Nº da nota, chave, cliente, nº da venda…"
          className="min-w-[180px] flex-1 rounded-lg border px-3 py-1.5"
        />
        <button onClick={carregar} className="rounded-lg border px-3 py-1 hover:bg-gray-50">
          ↻ Atualizar
        </button>
      </div>

      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {aviso && (
        <p className="flex items-center rounded-lg bg-green-50 p-3 text-sm text-green-800">
          <span className="flex-1">{aviso}</span>
          <button onClick={() => setAviso('')}>✕</button>
        </p>
      )}

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        {carregando ? (
          <p className="p-6 text-center text-sm text-gray-500">Carregando…</p>
        ) : !visiveis.length ? (
          <p className="p-6 text-center text-sm text-gray-500">Nenhuma nota no período.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-[11px] uppercase text-gray-600">
              <tr>
                <th className="p-2">Emissão</th>
                <th className="p-2">Modelo</th>
                <th className="p-2">Nº / série</th>
                <th className="p-2">Venda</th>
                <th className="p-2">Destinatário</th>
                <th className="p-2 text-right">Valor</th>
                <th className="p-2">Situação</th>
                <th className="p-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visiveis.map((n) => {
                const v = vendas[n.venda_id];
                return (
                  <tr key={n.id} className={n.status === 'cancelada' ? 'text-gray-400' : ''}>
                    <td className="p-2 whitespace-nowrap">{dataHora(n.created_at)}</td>
                    <td className="p-2 font-semibold">{n.modelo === 'nfce' ? 'NFC-e' : 'NF-e'}</td>
                    <td className="p-2 whitespace-nowrap">
                      {n.numero ? `${n.numero}${n.serie ? ' / ' + n.serie : ''}` : '—'}
                      {n.chave && <div className="max-w-[170px] truncate text-[10px] text-gray-400" title={n.chave}>{n.chave}</div>}
                    </td>
                    <td className="p-2 whitespace-nowrap">{v ? `nº ${v.numero}` : '—'}</td>
                    <td className="p-2">
                      {n.destinatario?.nome || (n.destinatario?.cpf_cnpj ? '' : 'Consumidor')}
                      {n.destinatario?.cpf_cnpj && <div className="text-[11px] text-gray-500">{n.destinatario.cpf_cnpj}</div>}
                    </td>
                    <td className="p-2 text-right whitespace-nowrap">{v ? brl(v.total) : '—'}</td>
                    <td className="p-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS[n.status]?.cor || ''}`}>{STATUS[n.status]?.rotulo || n.status}</span>
                      {n.mensagem && n.status !== 'autorizada' && <div className="mt-0.5 max-w-[260px] text-[11px] text-gray-500">{n.mensagem}</div>}
                    </td>
                    <td className="p-2">
                      <div className="flex justify-end gap-1 whitespace-nowrap">
                        {n.url_danfe && n.status !== 'erro' && (
                          <a href={n.url_danfe} target="_blank" rel="noreferrer" className="rounded border px-2 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-50">
                            DANFE
                          </a>
                        )}
                        {n.url_xml && (
                          <a href={n.url_xml} target="_blank" rel="noreferrer" className="rounded border px-2 py-1 text-xs text-blue-800 hover:bg-blue-50">
                            XML
                          </a>
                        )}
                        {n.status === 'processando' && (
                          <button disabled={ocupado === n.id} onClick={() => acao(n, { acao: 'consultar', nota_id: n.id }, 'Nota atualizada.')} className="rounded border px-2 py-1 text-xs hover:bg-gray-50">
                            ↻
                          </button>
                        )}
                        {n.status === 'autorizada' && (
                          <button disabled={ocupado === n.id} onClick={() => cancelar(n)} className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                            {ocupado === n.id ? 'Enviando…' : 'Cancelar'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[11px] text-gray-400">
        Recusada: a mensagem da SEFAZ diz o que corrigir (geralmente NCM, CFOP ou CSOSN no cadastro do produto). Corrija e emita de novo pela venda no PDV.
      </p>
    </div>
  );
}

function Quadro({ titulo, valor, sub, cor }: { titulo: string; valor: string; sub?: string; cor: string }) {
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <div className="text-[11px] font-medium uppercase text-gray-500">{titulo}</div>
      <div className={`text-lg font-bold ${cor}`}>{valor}</div>
      {sub && <div className="text-[11px] text-gray-500">{sub}</div>}
    </div>
  );
}
