// BR Sisloja — cliente da venda: buscar (nome, CPF/CNPJ ou telefone) ou cadastrar na hora.
// Venda sem cliente mostra o aviso de pós-venda; o cliente escolhido vai para a venda e preenche a nota fiscal.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type Cliente = {
  id: string;
  nome: string;
  cpf_cnpj: string | null;
  ie: string | null;
  telefone: string | null;
  email: string | null;
  data_nascimento: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  aceita_contato: boolean;
};

const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
const novoVazio = {
  nome: '',
  telefone: '',
  cpf_cnpj: '',
  email: '',
  data_nascimento: '',
  cep: '',
  logradouro: '',
  numero: '',
  bairro: '',
  municipio: '',
  uf: '',
  aceita_contato: true,
};
const erroBanco = (m: string) =>
  /buscar_clientes|salvar_cliente|function/i.test(m) ? 'Falta atualizar o banco: rode o arquivo fase9_clientes.sql no SQL Editor do Supabase.' : m;

export function SeletorCliente({ cliente, aoMudar }: { cliente: Cliente | null; aoMudar: (c: Cliente | null) => void }) {
  const [aberto, setAberto] = useState(false);

  return (
    <div>
      {cliente ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs">
          <span className="min-w-0 mr-auto truncate">
            👤 <b className="text-emerald-900">{cliente.nome}</b>
            {cliente.telefone ? <span className="text-emerald-700"> · {cliente.telefone}</span> : ''}
          </span>
          <button type="button" onClick={() => setAberto(true)} className="font-bold text-emerald-800 underline cursor-pointer">
            trocar
          </button>
          <button type="button" onClick={() => aoMudar(null)} className="font-black text-rose-600 cursor-pointer" aria-label="Tirar cliente">
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="w-full text-left rounded-lg border border-dashed border-amber-400 bg-amber-50 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-amber-100"
        >
          <span className="font-black text-amber-900">👤 Cadastrar / escolher cliente</span>
          <span className="block text-[11px] text-amber-800">⚠ Importante para seu pós-venda e captação futura.</span>
        </button>
      )}
      {aberto && (
        <ModalCliente
          atual={cliente}
          aoEscolher={(c) => {
            aoMudar(c);
            setAberto(false);
          }}
          aoFechar={() => setAberto(false)}
        />
      )}
    </div>
  );
}

function ModalCliente({ atual, aoEscolher, aoFechar }: { atual: Cliente | null; aoEscolher: (c: Cliente) => void; aoFechar: () => void }) {
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState<Cliente[]>([]);
  const [form, setForm] = useState<typeof novoVazio | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  // busca enquanto digita (pequena pausa para não consultar a cada letra)
  useEffect(() => {
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('buscar_clientes', { p_texto: busca });
      if (error) return setErro(erroBanco(error.message));
      setErro('');
      setLista((data as Cliente[]) || []);
    }, 250);
    return () => clearTimeout(t);
  }, [busca]);

  const abrirNovo = () => {
    const so = busca.replace(/\D/g, '');
    // o que foi digitado na busca já entra no cadastro
    setForm({
      ...novoVazio,
      nome: so.length >= 8 ? '' : busca.trim(),
      cpf_cnpj: so.length === 11 || so.length === 14 ? so : '',
      telefone: so.length >= 8 && so.length !== 11 && so.length !== 14 ? so : '',
    });
    setEditId(null);
  };

  const editar = (c: Cliente) => {
    setForm({
      nome: c.nome || '',
      telefone: c.telefone || '',
      cpf_cnpj: c.cpf_cnpj || '',
      email: c.email || '',
      data_nascimento: c.data_nascimento || '',
      cep: c.cep || '',
      logradouro: c.logradouro || '',
      numero: c.numero || '',
      bairro: c.bairro || '',
      municipio: c.municipio || '',
      uf: c.uf || '',
      aceita_contato: c.aceita_contato ?? true,
    });
    setEditId(c.id);
  };

  // CEP preenche o endereço (ViaCEP, serviço público dos Correios)
  const buscarCep = async (cep: string) => {
    const so = cep.replace(/\D/g, '');
    if (so.length !== 8 || !form) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${so}/json/`);
      const j = await r.json();
      if (j.erro) return;
      setForm((f) => (f ? { ...f, logradouro: f.logradouro || j.logradouro || '', bairro: f.bairro || j.bairro || '', municipio: j.localidade || f.municipio, uf: j.uf || f.uf } : f));
    } catch {
      /* sem internet ou CEP fora do ar: digita à mão */
    }
  };

  const salvar = async () => {
    if (!form) return;
    if (form.nome.trim().length < 2) return setErro('Informe o nome do cliente.');
    if (!form.telefone.trim() && !form.email.trim()) return setErro('Informe ao menos o WhatsApp/telefone ou o e-mail: é por ele que você fala com o cliente depois.');
    setSalvando(true);
    setErro('');
    const { data, error } = await supabase.rpc('salvar_cliente', { p_dados: { ...form, id: editId } });
    setSalvando(false);
    if (error) return setErro(erroBanco(error.message));
    aoEscolher(data as Cliente);
  };

  const campo = 'w-full border border-slate-300 rounded-lg px-2 py-2 text-sm';
  const rot = 'text-[11px] font-bold text-slate-500';
  const f = form;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92dvh] flex flex-col">
        <div className="flex items-center px-4 py-3 border-b">
          <h3 className="font-black text-slate-800 mr-auto">👤 {f ? (editId ? 'Editar cliente' : 'Novo cliente') : 'Cliente da venda'}</h3>
          <button type="button" onClick={aoFechar} className="text-slate-500 font-bold text-xl px-2 cursor-pointer" aria-label="Fechar">
            ✕
          </button>
        </div>
        <p className="mx-4 mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
          ⚠ Cadastrar o cliente é <b>importante para seu pós-venda e captação futura</b>: avisar de promoções, chegada de produtos e manter o contato.
        </p>
        {erro && <p className="mx-4 mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">{erro}</p>}

        {!f ? (
          <>
            <div className="p-4 pb-2 flex gap-2">
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome, CPF/CNPJ ou telefone"
                className={campo}
              />
              <button type="button" onClick={abrirNovo} className="whitespace-nowrap rounded-lg bg-blue-900 px-3 text-sm font-black text-white cursor-pointer">
                + Novo
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4 divide-y">
              {lista.length === 0 && <p className="py-6 text-center text-sm text-slate-500">{busca ? 'Nenhum cliente encontrado. Toque em "+ Novo".' : 'Nenhum cliente cadastrado ainda.'}</p>}
              {lista.map((c) => (
                <div key={c.id} className={`flex items-center gap-2 py-2 ${atual?.id === c.id ? 'bg-emerald-50' : ''}`}>
                  <button type="button" onClick={() => aoEscolher(c)} className="min-w-0 mr-auto text-left cursor-pointer">
                    <span className="block text-sm font-bold text-slate-800 truncate">{c.nome}</span>
                    <span className="block text-[11px] text-slate-500 truncate">{[c.telefone, c.cpf_cnpj, c.municipio].filter(Boolean).join(' · ') || 'sem contato'}</span>
                  </button>
                  <button type="button" onClick={() => editar(c)} className="text-xs font-bold text-blue-800 underline cursor-pointer">
                    editar
                  </button>
                  <button type="button" onClick={() => aoEscolher(c)} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-black text-white cursor-pointer">
                    Usar
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-2.5">
            <label className={`${rot} col-span-2`}>
              NOME *
              <input autoFocus value={f.nome} onChange={(e) => setForm({ ...f, nome: e.target.value })} className={campo} />
            </label>
            <label className={rot}>
              WHATSAPP / TELEFONE
              <input value={f.telefone} onChange={(e) => setForm({ ...f, telefone: e.target.value })} inputMode="tel" placeholder="(00) 00000-0000" className={campo} />
            </label>
            <label className={rot}>
              CPF / CNPJ
              <input value={f.cpf_cnpj} onChange={(e) => setForm({ ...f, cpf_cnpj: e.target.value })} inputMode="numeric" className={campo} />
            </label>
            <label className={rot}>
              E-MAIL
              <input value={f.email} onChange={(e) => setForm({ ...f, email: e.target.value })} inputMode="email" className={campo} />
            </label>
            <label className={rot}>
              ANIVERSÁRIO
              <input type="date" value={f.data_nascimento} onChange={(e) => setForm({ ...f, data_nascimento: e.target.value })} className={campo} />
            </label>

            <details className="col-span-2 rounded-lg border px-2.5 py-2" open={!!(f.cep || f.logradouro)}>
              <summary className="text-xs font-black text-slate-700 cursor-pointer">Endereço (precisa para NF-e e entrega)</summary>
              <div className="mt-2 grid grid-cols-2 gap-2.5">
                <label className={rot}>
                  CEP
                  <input
                    value={f.cep}
                    onChange={(e) => setForm({ ...f, cep: e.target.value })}
                    onBlur={(e) => buscarCep(e.target.value)}
                    inputMode="numeric"
                    className={campo}
                  />
                </label>
                <label className={rot}>
                  NÚMERO
                  <input value={f.numero} onChange={(e) => setForm({ ...f, numero: e.target.value })} className={campo} />
                </label>
                <label className={`${rot} col-span-2`}>
                  ENDEREÇO
                  <input value={f.logradouro} onChange={(e) => setForm({ ...f, logradouro: e.target.value })} className={campo} />
                </label>
                <label className={rot}>
                  BAIRRO
                  <input value={f.bairro} onChange={(e) => setForm({ ...f, bairro: e.target.value })} className={campo} />
                </label>
                <label className={rot}>
                  CIDADE
                  <input value={f.municipio} onChange={(e) => setForm({ ...f, municipio: e.target.value })} className={campo} />
                </label>
                <label className={rot}>
                  UF
                  <select value={f.uf} onChange={(e) => setForm({ ...f, uf: e.target.value })} className={`${campo} bg-white`}>
                    <option value=""></option>
                    {UFS.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </label>
              </div>
            </details>

            <label className="col-span-2 flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={f.aceita_contato} onChange={(e) => setForm({ ...f, aceita_contato: e.target.checked })} className="w-4 h-4" />
              Cliente aceita receber ofertas e novidades
            </label>

            <div className="col-span-2 flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setForm(null)} className="rounded-lg border px-3 py-2 text-sm font-bold text-slate-600 cursor-pointer">
                Voltar
              </button>
              <button type="button" onClick={salvar} disabled={salvando} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white cursor-pointer disabled:opacity-50">
                {salvando ? 'Salvando...' : 'Salvar e usar na venda'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
