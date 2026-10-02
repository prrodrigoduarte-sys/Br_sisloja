// BR Sisloja — nota fiscal de uma venda (NFC-e e NF-e pela Focus NFe)
// Quem fala com a SEFAZ é a função "nota-fiscal" do Supabase (supabase/functions/nota-fiscal).
// Aqui: emitir NFC-e (CPF na nota opcional) ou NF-e (com os dados do cliente), ver o DANFE, consultar e cancelar.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

type Nota = {
  id: string;
  modelo: 'nfce' | 'nfe';
  status: 'processando' | 'autorizada' | 'erro' | 'cancelada';
  numero: string | null;
  serie: string | null;
  chave: string | null;
  url_danfe: string | null;
  url_xml: string | null;
  mensagem: string | null;
  created_at: string;
  motivo_cancelamento: string | null;
};

const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
const STATUS: Record<string, { rotulo: string; cor: string }> = {
  autorizada: { rotulo: 'Autorizada', cor: 'bg-emerald-600 text-white' },
  processando: { rotulo: 'Processando', cor: 'bg-amber-400 text-slate-900' },
  erro: { rotulo: 'Recusada', cor: 'bg-rose-100 text-rose-800' },
  cancelada: { rotulo: 'Cancelada', cor: 'bg-slate-300 text-slate-700' },
};
const destVazio = { cpf_cnpj: '', nome: '', ie: '', logradouro: '', numero: '', bairro: '', municipio: '', uf: '', cep: '', email: '', telefone: '' };

async function chamar(corpo: Record<string, unknown>): Promise<{ ok: boolean; nota?: Nota; erro?: string }> {
  const { data, error } = await supabase.functions.invoke('nota-fiscal', { body: corpo });
  if (error) {
    return {
      ok: false,
      erro: /not found|404|Failed to send/i.test(error.message)
        ? 'A função nota-fiscal ainda não foi publicada no Supabase (veja o LEIA-ME_nota_fiscal.txt).'
        : error.message,
    };
  }
  return data;
}

export default function NotaFiscalVenda({ vendaId, cancelada = false }: { vendaId: string; cancelada?: boolean }) {
  const [notas, setNotas] = useState<Nota[]>([]);
  const [modo, setModo] = useState<'' | 'nfce' | 'nfe' | 'cancelar'>('');
  const [dest, setDest] = useState(destVazio);
  const [justificativa, setJustificativa] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('notas_fiscais').select('*').eq('venda_id', vendaId).order('created_at', { ascending: false });
    setNotas((data as Nota[]) || []);
  }, [vendaId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const valida = notas.find((n) => n.status === 'autorizada' || n.status === 'processando');

  const executar = async (corpo: Record<string, unknown>, ok: string) => {
    setOcupado(true);
    setMsg(null);
    const r = await chamar(corpo);
    setOcupado(false);
    await carregar();
    if (!r.ok) return setMsg({ tipo: 'erro', texto: r.erro || 'Não deu certo.' });
    setModo('');
    setMsg({ tipo: 'ok', texto: r.nota?.status === 'processando' ? 'Nota enviada; a SEFAZ ainda está processando. Toque em "Atualizar" em alguns segundos.' : ok });
    if (r.nota?.status === 'autorizada' && r.nota.url_danfe) window.open(r.nota.url_danfe, '_blank');
  };

  const emitir = (modelo: 'nfce' | 'nfe') => {
    const d = Object.fromEntries(Object.entries(dest).map(([k, v]) => [k, v.trim()]));
    executar({ acao: 'emitir', venda_id: vendaId, modelo, destinatario: d }, `${modelo === 'nfce' ? 'NFC-e' : 'NF-e'} autorizada.`);
  };

  const campo = 'w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs';
  const input = (k: keyof typeof destVazio, ph: string, extra = '') => (
    <input value={dest[k]} onChange={(e) => setDest({ ...dest, [k]: e.target.value })} placeholder={ph} className={`${campo} ${extra}`} />
  );

  return (
    <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50/60 p-2 text-xs">
      <p className="font-black text-violet-900">📄 Nota fiscal</p>

      {notas.map((n) => (
        <div key={n.id} className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="font-bold">{n.modelo === 'nfce' ? 'NFC-e' : 'NF-e'}</span>
          {n.numero && <span>nº {n.numero}</span>}
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS[n.status]?.cor || ''}`}>{STATUS[n.status]?.rotulo || n.status}</span>
          {n.url_danfe && n.status !== 'erro' && (
            <a href={n.url_danfe} target="_blank" rel="noreferrer" className="font-bold text-blue-800 underline">
              DANFE
            </a>
          )}
          {n.url_xml && (
            <a href={n.url_xml} target="_blank" rel="noreferrer" className="text-blue-800 underline">
              XML
            </a>
          )}
          {n.status === 'processando' && (
            <button type="button" disabled={ocupado} onClick={() => executar({ acao: 'consultar', nota_id: n.id }, 'Nota atualizada.')} className="rounded border px-1.5 py-0.5 font-bold bg-white cursor-pointer">
              ↻ Atualizar
            </button>
          )}
          {n.mensagem && n.status !== 'autorizada' && <span className="w-full text-[11px] text-slate-600">{n.mensagem}</span>}
        </div>
      ))}

      {msg && <p className={`mt-1.5 rounded px-2 py-1 font-semibold ${msg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{msg.texto}</p>}

      {!cancelada && !valida && modo === '' && (
        <div className="mt-1.5 flex gap-1.5">
          <button type="button" onClick={() => setModo('nfce')} className="rounded-lg bg-violet-700 px-2.5 py-1.5 font-bold text-white cursor-pointer">
            Emitir NFC-e
          </button>
          <button type="button" onClick={() => setModo('nfe')} className="rounded-lg border border-violet-700 bg-white px-2.5 py-1.5 font-bold text-violet-800 cursor-pointer">
            Emitir NF-e
          </button>
        </div>
      )}
      {valida?.status === 'autorizada' && modo === '' && (
        <button type="button" onClick={() => setModo('cancelar')} className="mt-1.5 rounded-lg border border-rose-300 bg-white px-2.5 py-1 font-bold text-rose-700 cursor-pointer">
          Cancelar nota
        </button>
      )}

      {modo === 'nfce' && (
        <div className="mt-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            {input('cpf_cnpj', 'CPF/CNPJ na nota (opcional)')}
            {input('nome', 'Nome (opcional)')}
          </div>
          <Botoes ocupado={ocupado} rotulo="Emitir NFC-e" aoConfirmar={() => emitir('nfce')} aoVoltar={() => setModo('')} />
        </div>
      )}

      {modo === 'nfe' && (
        <div className="mt-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            {input('cpf_cnpj', 'CPF ou CNPJ *')}
            {input('ie', 'Inscrição estadual (se tiver)')}
            {input('nome', 'Nome / razão social *', 'col-span-2')}
            {input('logradouro', 'Endereço *', 'col-span-2')}
            {input('numero', 'Número *')}
            {input('bairro', 'Bairro *')}
            {input('municipio', 'Cidade *')}
            <select value={dest.uf} onChange={(e) => setDest({ ...dest, uf: e.target.value })} className={campo}>
              <option value="">UF *</option>
              {UFS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
            {input('cep', 'CEP *')}
            {input('telefone', 'Telefone')}
            {input('email', 'E-mail (recebe a nota)', 'col-span-2')}
          </div>
          <Botoes ocupado={ocupado} rotulo="Emitir NF-e" aoConfirmar={() => emitir('nfe')} aoVoltar={() => setModo('')} />
        </div>
      )}

      {modo === 'cancelar' && valida && (
        <div className="mt-2 space-y-1.5">
          <input
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            placeholder="Justificativa (mínimo 15 letras)"
            className={campo}
          />
          <p className="text-[11px] text-slate-500">
            Prazo da SEFAZ: NFC-e em geral até 30 minutos após a emissão; NF-e até 24 horas. O estoque fiscal volta.
          </p>
          <Botoes
            ocupado={ocupado}
            perigo
            rotulo="Cancelar nota"
            aoConfirmar={() => executar({ acao: 'cancelar', nota_id: valida.id, justificativa }, 'Nota cancelada na SEFAZ.')}
            aoVoltar={() => setModo('')}
          />
        </div>
      )}
    </div>
  );
}

function Botoes({ ocupado, rotulo, perigo, aoConfirmar, aoVoltar }: { ocupado: boolean; rotulo: string; perigo?: boolean; aoConfirmar: () => void; aoVoltar: () => void }) {
  return (
    <div className="flex justify-end gap-1.5">
      <button type="button" onClick={aoVoltar} className="rounded-lg border bg-white px-2.5 py-1.5 font-bold text-slate-600 cursor-pointer">
        Voltar
      </button>
      <button
        type="button"
        onClick={aoConfirmar}
        disabled={ocupado}
        className={`rounded-lg px-2.5 py-1.5 font-black text-white cursor-pointer disabled:opacity-50 ${perigo ? 'bg-rose-600' : 'bg-violet-700'}`}
      >
        {ocupado ? 'Enviando à SEFAZ...' : rotulo}
      </button>
    </div>
  );
}
