// BR Sisloja - Fase 2 - Cadastro de Fornecedores
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';

type Usuario = { id: string; email: string; nome: string; perfil: string; codigo_loja: string; loja_nome: string };

type Fornecedor = {
  id?: string;
  codigo_loja?: string;
  cnpj: string;
  nome: string;
  nome_fantasia: string;
  ie: string;
  telefone: string;
  email: string;
  contato: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  codigo_municipio: string;
  uf: string;
  prazo_pagamento_dias: number | null;
  observacoes: string;
  ativo: boolean;
  origem?: string;
  created_at?: string;
};

const VAZIO: Fornecedor = {
  cnpj: '',
  nome: '',
  nome_fantasia: '',
  ie: '',
  telefone: '',
  email: '',
  contato: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  codigo_municipio: '',
  uf: '',
  prazo_pagamento_dias: null,
  observacoes: '',
  ativo: true,
};

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

const digitos = (s: string) => (s || '').replace(/\D/g, '');

export function formatarDoc(s: string) {
  const d = digitos(s);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return s || '';
}

function formatarFone(s: string) {
  const d = digitos(s);
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return s || '';
}

function cnpjValido(c: string) {
  const d = digitos(c);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (base: string, pesos: number[]) => {
    const soma = base.split('').reduce((s, n, i) => s + parseInt(n, 10) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(d.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d.endsWith(`${d1}${d2}`);
}

function cpfValido(c: string) {
  const d = digitos(c);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += parseInt(d[i], 10) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === parseInt(d[9], 10) && calc(10) === parseInt(d[10], 10);
}

export default function FornecedoresModule({ loggedUser }: { loggedUser: Usuario }) {
  const [lista, setLista] = useState<Fornecedor[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [form, setForm] = useState<Fornecedor | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const podeEditar = ['admin', 'gerente', 'estoquista', 'financeiro'].includes((loggedUser?.perfil || '').toLowerCase());

  const carregar = async () => {
    setCarregando(true);
    const { data, error } = await supabase
      .from('fornecedores')
      .select('*')
      .eq('codigo_loja', loggedUser.codigo_loja)
      .order('nome');
    if (error) setMsg({ tipo: 'erro', texto: 'Erro ao carregar fornecedores: ' + error.message });
    setLista((data as Fornecedor[]) || []);
    setCarregando(false);
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedUser.codigo_loja]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const td = digitos(busca);
    return lista.filter((f) => {
      if (!mostrarInativos && !f.ativo) return false;
      if (!t) return true;
      return (
        (f.nome || '').toLowerCase().includes(t) ||
        (f.nome_fantasia || '').toLowerCase().includes(t) ||
        (f.cidade || '').toLowerCase().includes(t) ||
        (td.length >= 3 && digitos(f.cnpj).includes(td))
      );
    });
  }, [lista, busca, mostrarInativos]);

  const set = (campo: keyof Fornecedor, valor: any) => setForm((f) => (f ? { ...f, [campo]: valor } : f));

  // Preenche os dados pelo CNPJ (consulta pública da BrasilAPI)
  const buscarCnpj = async () => {
    if (!form) return;
    const d = digitos(form.cnpj);
    if (!cnpjValido(d)) {
      setMsg({ tipo: 'erro', texto: 'CNPJ inválido. Confira os números.' });
      return;
    }
    setBuscandoCnpj(true);
    setMsg(null);
    try {
      const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`);
      if (!r.ok) throw new Error(r.status === 404 ? 'CNPJ não encontrado na Receita.' : 'Consulta indisponível agora.');
      const j = await r.json();
      setForm((f) =>
        f
          ? {
              ...f,
              nome: f.nome || j.razao_social || '',
              nome_fantasia: f.nome_fantasia || j.nome_fantasia || '',
              telefone: f.telefone || digitos(j.ddd_telefone_1 || ''),
              email: f.email || (j.email || '').toLowerCase(),
              cep: f.cep || digitos(String(j.cep || '')),
              logradouro: f.logradouro || [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(' '),
              numero: f.numero || j.numero || '',
              complemento: f.complemento || j.complemento || '',
              bairro: f.bairro || j.bairro || '',
              cidade: f.cidade || j.municipio || '',
              codigo_municipio: f.codigo_municipio || String(j.codigo_municipio_ibge || ''),
              uf: f.uf || j.uf || '',
            }
          : f
      );
      setMsg({ tipo: 'ok', texto: `Dados da Receita carregados. Situação: ${j.descricao_situacao_cadastral || '—'}.` });
    } catch (e: any) {
      setMsg({ tipo: 'erro', texto: e.message || 'Não foi possível consultar o CNPJ.' });
    }
    setBuscandoCnpj(false);
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const doc = digitos(form.cnpj);
    if (doc && !(doc.length === 14 ? cnpjValido(doc) : cpfValido(doc))) {
      setMsg({ tipo: 'erro', texto: 'CNPJ/CPF inválido.' });
      return;
    }
    if (!form.nome.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe a razão social (ou o nome).' });
      return;
    }
    setSalvando(true);
    setMsg(null);
    const { id, created_at, origem, ...resto } = form;
    const dados = {
      ...resto,
      cnpj: doc || null,
      telefone: digitos(form.telefone),
      cep: digitos(form.cep),
      uf: (form.uf || '').toUpperCase(),
      nome: form.nome.trim(),
      codigo_loja: loggedUser.codigo_loja,
    };
    const { error } = id
      ? await supabase.from('fornecedores').update(dados).eq('id', id)
      : await supabase.from('fornecedores').insert(dados);
    setSalvando(false);
    if (error) {
      setMsg({
        tipo: 'erro',
        texto: error.code === '23505' ? 'Já existe um fornecedor com esse CNPJ/CPF.' : 'Erro ao salvar: ' + error.message,
      });
      return;
    }
    setForm(null);
    setMsg({ tipo: 'ok', texto: 'Fornecedor salvo.' });
    carregar();
  };

  const campo = (rotulo: string, nome: keyof Fornecedor, { className = '', ...props }: any = {}) => (
    <label className={`block ${className}`}>
      <span className="text-xs font-medium text-gray-600">{rotulo}</span>
      <input
        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        value={(form?.[nome] as any) ?? ''}
        onChange={(e) => set(nome, e.target.value)}
        disabled={!podeEditar}
        {...props}
      />
    </label>
  );

  // ---------- FORMULÁRIO ----------
  if (form) {
    return (
      <div className="mx-auto max-w-4xl p-3 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-800">{form.id ? 'Editar fornecedor' : 'Novo fornecedor'}</h2>
          <button onClick={() => setForm(null)} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">
            ← Voltar
          </button>
        </div>
        {msg && (
          <div className={`mb-3 rounded-lg p-3 text-sm ${msg.tipo === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {msg.texto}
          </div>
        )}
        {form.origem === 'xml' && (
          <div className="mb-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
            Este fornecedor foi cadastrado automaticamente pela entrada de uma nota (XML). Confira os dados.
          </div>
        )}
        <form onSubmit={salvar} className="space-y-4 rounded-xl bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <span className="text-xs font-medium text-gray-600">CNPJ ou CPF</span>
              <div className="mt-1 flex gap-2">
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  value={formatarDoc(form.cnpj)}
                  onChange={(e) => set('cnpj', digitos(e.target.value).slice(0, 14))}
                  inputMode="numeric"
                  disabled={!podeEditar}
                  autoFocus={!form.id}
                />
                {digitos(form.cnpj).length === 14 && podeEditar && (
                  <button
                    type="button"
                    onClick={buscarCnpj}
                    disabled={buscandoCnpj}
                    className="whitespace-nowrap rounded-lg bg-gray-800 px-3 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                    title="Buscar dados na Receita"
                  >
                    {buscandoCnpj ? '...' : '🔎 Receita'}
                  </button>
                )}
              </div>
            </div>
            {campo('Razão social / Nome *', 'nome', { className: 'sm:col-span-2', required: true })}
            {campo('Nome fantasia', 'nome_fantasia', { className: 'sm:col-span-2' })}
            {campo('Inscrição estadual', 'ie')}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Telefone</span>
              <input
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={formatarFone(form.telefone)}
                onChange={(e) => set('telefone', digitos(e.target.value).slice(0, 11))}
                inputMode="tel"
                disabled={!podeEditar}
              />
            </label>
            {campo('E-mail', 'email', { type: 'email' })}
            {campo('Contato / vendedor', 'contato')}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            {campo('CEP', 'cep', { inputMode: 'numeric' })}
            {campo('Endereço', 'logradouro', { className: 'col-span-2 sm:col-span-3' })}
            {campo('Número', 'numero')}
            {campo('Complemento', 'complemento', { className: 'col-span-2' })}
            {campo('Bairro', 'bairro', { className: 'col-span-2' })}
            {campo('Cidade', 'cidade')}
            <label className="block">
              <span className="text-xs font-medium text-gray-600">UF</span>
              <select
                className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
                value={form.uf || ''}
                onChange={(e) => set('uf', e.target.value)}
                disabled={!podeEditar}
              >
                <option value="">—</option>
                {UFS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Prazo padrão (dias)</span>
              <input
                type="number"
                min={0}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={form.prazo_pagamento_dias ?? ''}
                onChange={(e) => set('prazo_pagamento_dias', e.target.value === '' ? null : parseInt(e.target.value, 10))}
                disabled={!podeEditar}
              />
            </label>
            <label className="block sm:col-span-3">
              <span className="text-xs font-medium text-gray-600">Observações</span>
              <input
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={form.observacoes || ''}
                onChange={(e) => set('observacoes', e.target.value)}
                disabled={!podeEditar}
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.ativo} onChange={(e) => set('ativo', e.target.checked)} disabled={!podeEditar} />
            Fornecedor ativo
          </label>

          {podeEditar && (
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setForm(null)} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvando}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          )}
        </form>
      </div>
    );
  }

  // ---------- LISTA ----------
  return (
    <div className="mx-auto max-w-6xl p-3 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-gray-800">🚚 Fornecedores</h2>
        {podeEditar && (
          <button
            onClick={() => {
              setMsg(null);
              setForm({ ...VAZIO });
            }}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            + Novo fornecedor
          </button>
        )}
      </div>

      {msg && (
        <div className={`mb-3 rounded-lg p-3 text-sm ${msg.tipo === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg.texto}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          placeholder="Buscar por nome, CNPJ ou cidade..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} />
          Mostrar inativos
        </label>
      </div>

      {carregando ? (
        <p className="p-6 text-center text-gray-500">Carregando...</p>
      ) : filtrados.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-gray-500 shadow-sm">
          Nenhum fornecedor {busca ? 'encontrado' : 'cadastrado ainda'}. Eles também são cadastrados sozinhos ao importar o XML de uma nota.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          {/* celular: cartões */}
          <ul className="divide-y sm:hidden">
            {filtrados.map((f) => (
              <li key={f.id} className="p-3 active:bg-gray-50" onClick={() => setForm({ ...VAZIO, ...f })}>
                <div className="font-medium text-gray-800">
                  {f.nome_fantasia || f.nome} {!f.ativo && <span className="text-xs text-red-500">(inativo)</span>}
                </div>
                <div className="text-xs text-gray-500">
                  {formatarDoc(f.cnpj)} · {f.cidade}
                  {f.uf ? '/' + f.uf : ''}
                </div>
              </li>
            ))}
          </ul>
          {/* computador: tabela */}
          <table className="hidden w-full text-sm sm:table">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Fornecedor</th>
                <th className="px-4 py-2">CNPJ/CPF</th>
                <th className="px-4 py-2">Cidade</th>
                <th className="px-4 py-2">Telefone</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtrados.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <div className="font-medium text-gray-800">{f.nome}</div>
                    {f.nome_fantasia && <div className="text-xs text-gray-500">{f.nome_fantasia}</div>}
                    {!f.ativo && <span className="text-xs text-red-500">inativo</span>}
                    {f.origem === 'xml' && <span className="ml-1 rounded bg-blue-50 px-1 text-[10px] text-blue-600">via XML</span>}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{formatarDoc(f.cnpj)}</td>
                  <td className="px-4 py-2">
                    {f.cidade}
                    {f.uf ? '/' + f.uf : ''}
                  </td>
                  <td className="px-4 py-2">{formatarFone(f.telefone)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => {
                        setMsg(null);
                        setForm({ ...VAZIO, ...f });
                      }}
                      className="rounded px-2 py-1 text-blue-600 hover:bg-blue-50"
                    >
                      {podeEditar ? 'Editar' : 'Ver'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-gray-400">{filtrados.length} fornecedor(es)</p>
    </div>
  );
}
