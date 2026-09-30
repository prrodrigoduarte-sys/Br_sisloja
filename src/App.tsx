import React, { useEffect, useState } from 'react';
import { supabase } from './supabase';
import PdvModule from './PdvModule';
import ProdutosEstoqueModule from './ProdutosEstoqueModule';

type Aba = 'pdv' | 'produtos';

const ABAS: { id: Aba; rotulo: string; icone: string }[] = [
  { id: 'pdv', rotulo: 'PDV', icone: '🛒' },
  { id: 'produtos', rotulo: 'Produtos & Estoque', icone: '📦' },
];

const EM_BREVE = ['Contas a Pagar', 'Contas a Receber', 'Nota de Entrada (XML)', 'Nota Fiscal', 'Financeiro'];

export default function App() {
  const [sessao, setSessao] = useState<any>(null);
  const [iniciando, setIniciando] = useState(true);
  const [usuario, setUsuario] = useState<any>(null);
  const [erroPerfil, setErroPerfil] = useState('');
  const [aba, setAba] = useState<Aba>('pdv');

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [erroLogin, setErroLogin] = useState('');

  // sessão
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessao(data.session);
      setIniciando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => setSessao(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // perfil + loja do usuário logado
  useEffect(() => {
    let vivo = true;
    setUsuario(null);
    setErroPerfil('');
    if (!sessao?.user) return;
    (async () => {
      const { data, error } = await supabase
        .from('perfis')
        .select('nome, perfil, codigo_loja, ativo')
        .eq('user_id', sessao.user.id)
        .maybeSingle();
      if (!vivo) return;
      if (error || !data || !data.ativo) {
        setErroPerfil(
          error
            ? 'Erro ao ler o perfil: ' + error.message
            : 'Seu login existe, mas ainda não está ligado a uma loja ativa. Peça ao administrador para liberar o seu acesso.'
        );
        return;
      }
      const { data: loja } = await supabase.from('lojas').select('nome').eq('codigo_loja', data.codigo_loja).maybeSingle();
      setUsuario({
        id: sessao.user.id,
        email: sessao.user.email,
        nome: data.nome || sessao.user.email,
        perfil: data.perfil,
        codigo_loja: data.codigo_loja,
        loja_nome: loja?.nome || data.codigo_loja,
      });
    })();
    return () => {
      vivo = false;
    };
  }, [sessao]);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEntrando(true);
    setErroLogin('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    setEntrando(false);
    if (error) setErroLogin('E-mail ou senha incorretos.');
  };

  const sair = async () => {
    await supabase.auth.signOut();
    setUsuario(null);
  };

  if (iniciando) return <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">Carregando...</div>;

  // ---------- tela de login ----------
  if (!sessao) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <form onSubmit={entrar} className="w-full max-w-sm bg-white rounded-2xl p-6 space-y-4 shadow-2xl">
          <h1 className="text-2xl font-black text-blue-900 text-center">BR Sisloja</h1>
          <p className="text-center text-sm text-slate-500 -mt-2">Entre para continuar</p>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">E-MAIL</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              className="w-full border border-slate-300 rounded-xl px-3 py-3 text-sm outline-none focus:border-blue-700"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">SENHA</label>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full border border-slate-300 rounded-xl px-3 py-3 text-sm outline-none focus:border-blue-700"
            />
          </div>
          {erroLogin && <p className="text-sm font-semibold text-rose-700">{erroLogin}</p>}
          <button type="submit" disabled={entrando} className="w-full py-3 rounded-xl bg-blue-900 text-white font-black cursor-pointer disabled:opacity-60">
            {entrando ? 'Entrando...' : 'ENTRAR'}
          </button>
        </form>
      </div>
    );
  }

  // ---------- logado, mas sem loja ----------
  if (!usuario) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-100">
        <div className="max-w-sm bg-white rounded-2xl p-6 text-center space-y-4 shadow">
          <p className="text-sm text-slate-700">{erroPerfil || 'Carregando seu perfil...'}</p>
          {erroPerfil && (
            <button type="button" onClick={sair} className="px-5 py-2.5 bg-slate-100 rounded-xl font-bold text-sm cursor-pointer">
              Sair
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---------- sistema ----------
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-40 bg-blue-900 text-white">
        <div className="flex items-center justify-between gap-2 px-3 h-12">
          <div className="min-w-0">
            <p className="font-black text-sm leading-tight truncate">{usuario.loja_nome}</p>
            <p className="text-[10px] text-blue-200 leading-tight truncate">
              {usuario.nome} · {usuario.perfil}
            </p>
          </div>
          <button type="button" onClick={sair} className="text-xs font-bold bg-white/15 hover:bg-white/25 rounded-lg px-3 py-1.5 cursor-pointer">
            Sair
          </button>
        </div>
        <nav className="flex overflow-x-auto px-2 gap-1 pb-1.5">
          {ABAS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAba(a.id)}
              className={`whitespace-nowrap px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${aba === a.id ? 'bg-white text-blue-900' : 'text-blue-100 hover:bg-white/10'}`}
            >
              {a.icone} {a.rotulo}
            </button>
          ))}
          {EM_BREVE.map((n) => (
            <span key={n} className="whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-300/70" title="Próximas fases">
              {n} · em breve
            </span>
          ))}
        </nav>
      </header>

      <main className="p-2 sm:p-3">
        {aba === 'pdv' && <PdvModule loggedUser={usuario} />}
        {aba === 'produtos' && <ProdutosEstoqueModule loggedUser={usuario} />}
      </main>
    </div>
  );
}
