import { useState } from 'react';
import PdvModule from './PdvModule';
import OrcamentoModule from './OrcamentoModule';

// Vendas: PDV (frente de caixa) e Orçamentos.
// Orçamento marcado como "pronto" aparece num quadro dentro do PDV e carrega na venda com um toque.
export default function VendasModule({ loggedUser }: { loggedUser: any }) {
  const [tela, setTela] = useState<'pdv' | 'orcamentos'>('pdv');

  const botao = (id: typeof tela, rotulo: string) => (
    <button
      type="button"
      onClick={() => setTela(id)}
      className={`px-4 py-2 rounded-xl text-sm font-bold cursor-pointer ${tela === id ? 'bg-blue-900 text-white' : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'}`}
    >
      {rotulo}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {botao('pdv', '🛒 PDV')}
        {botao('orcamentos', '📝 Orçamentos')}
      </div>
      {tela === 'pdv' ? <PdvModule loggedUser={loggedUser} /> : <OrcamentoModule loggedUser={loggedUser} />}
    </div>
  );
}
