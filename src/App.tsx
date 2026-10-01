import React, { useEffect, useState } from 'react';
import { supabase } from './supabase';
import PdvModule from './PdvModule';
import ProdutosEstoqueModule from './ProdutosEstoqueModule';
import FornecedoresModule from './FornecedoresModule';
import EntradaMercadoriaModule from './EntradaMercadoriaModule';
import FinanceiroModule from './FinanceiroModule';
import ConfiguracoesModule from './ConfiguracoesModule';
import RelatoriosModule from './RelatoriosModule';

type Aba = 'pdv' | 'produtos' | 'entrada' | 'fornecedores' | 'financeiro' | 'relatorios' | 'configuracoes';

type Usuario = {
  id: string;
  email: string;
  nome: string;
  perfil: string;
  codigo_loja: string;
  loja_nome: string;
};

const ABAS: { id: Aba; rotulo: string; icone: string }[] = [
  { id: 'pdv', rotulo: 'PDV', icone: '🛒' },
  { id: 'produtos', rotulo: 'Produtos & Estoque', icone: '📦' },
  { id: 'entrada', rotulo: 'Entrada de Mercadoria', icone: '📥' },
  { id: 'fornecedores', rotulo: 'Fornecedores', icone: '🚚' },
  { id: 'financeiro', rotulo: 'Financeiro', icone: '💰' },
  { id: 'relatorios', rotulo: 'Relatórios', icone: '📊' },
  { id: 'configuracoes', rotulo: 'Configurações', icone: '⚙️' },
];

// abas que só alguns perfis enxergam
const PERFIS_ABA: Partial<Record<Aba, string[]>> = {
  financeiro: ['admin', 'gerente', 'financeiro'],
  relatorios: ['admin', 'gerente', 'financeiro'],
  configuracoes: ['admin'],
};

const EM_BREVE = ['Nota Fiscal'];

export default function App() {
  const [carregando, setCarregando] = useState(true);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [aba, setAba] = useState<Aba>('pdv');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);

  async function carregarUsuario(user: { id: string; email?: string } | null) {
    if (!user) {
      setUsuario(null);
      setCarregando(false);
      return;
    }
    const { data: perfil } = await supabase
      .from('perfis')
      .select('nome, perfil, codigo_loja, ativo')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!perfil || !perfil.ativo || !perfil.codigo_loja) {
      setUsuario(null);
      setErro('Seu login existe, mas ainda não está ligado a uma loja ativa. Peça ao administrador para liberar o seu acesso.');
      setCarregando(false);
      return;
    }

    const { data: loja } = await supabase
      .from('lojas')
      .select('nome')
      .eq('codigo_loja', perfil.codigo_loja)
      .maybeSingle();

    setUsuario({
      id: user.id,
      email: user.email || '',
      nome: perfil.nome || user.email || '',
      perfil: perfil.perfil || '',
      codigo_loja: perfil.codigo_loja,
      loja_nome: loja?.nome || perfil.codigo_loja,
    });
    setErro('');
    setCarregando(false);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      carregarUsuario(data.session?.user ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, session) => {
      carregarUsuario(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setEntrando(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setEntrando(false);
    if (error) setErro('E-mail ou senha incorretos.');
  }

  async function sair() {
    await supabase.auth.signOut();
    setUsuario(null);
    setAba('pdv');
  }

  if (carregando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        Carregando...
      </div>
    );
  }

  if (!usuario) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
        <form onSubmit={entrar} className="bg-white rounded-xl shadow-xl p-8 w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-bold text-center text-slate-800">SisLoja</h1>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Senha</label>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              required
            />
          </div>
          {erro && <p className="text-sm text-red-600">{erro}</p>}
          <button
            type="submit"
            disabled={entrando}
            className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2 rounded-lg disabled:opacity-50"
          >
            {entrando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-blue-900 text-white shadow">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">SisLoja</h1>
            <p className="text-xs text-blue-200">
              {usuario.loja_nome} · {usuario.nome} ({usuario.perfil})
            </p>
          </div>
          <button onClick={sair} className="text-sm bg-blue-800 hover:bg-blue-700 px-3 py-1 rounded">
            Sair
          </button>
        </div>
        <nav className="px-4 flex flex-wrap gap-1 items-center">
          {ABAS.filter((a) => !PERFIS_ABA[a.id] || PERFIS_ABA[a.id]!.includes(usuario.perfil.toLowerCase())).map((a) => (
            <button
              key={a.id}
              onClick={() => setAba(a.id)}
              className={`px-4 py-2 rounded-t-lg text-sm font-medium ${
                aba === a.id ? 'bg-slate-100 text-blue-900' : 'text-blue-100 hover:bg-blue-800'
              }`}
            >
              {a.icone} {a.rotulo}
            </button>
          ))}
          {EM_BREVE.map((r) => (
            <span key={r} className="px-4 py-2 text-sm text-blue-300 cursor-not-allowed" title="Em breve">
              {r} (em breve)
            </span>
          ))}
        </nav>
      </header>
      <main className="p-4">
        {aba === 'pdv' && <PdvModule loggedUser={usuario} />}
        {aba === 'produtos' && <ProdutosEstoqueModule loggedUser={usuario} />}
        {aba === 'entrada' && <EntradaMercadoriaModule loggedUser={usuario} />}
        {aba === 'fornecedores' && <FornecedoresModule loggedUser={usuario} />}
        {aba === 'financeiro' && <FinanceiroModule loggedUser={usuario} />}
        {aba === 'relatorios' && <RelatoriosModule loggedUser={usuario} />}
        {aba === 'configuracoes' && <ConfiguracoesModule loggedUser={usuario} />}
      </main>
    </div>
  );
}
